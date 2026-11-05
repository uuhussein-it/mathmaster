"""Guild bosses: each class group (grade + track) is a guild that fights one
boss at a time. Members hit the boss by answering curriculum questions right;
every right answer takes damage off the boss's shared health. When the boss
falls, everyone who landed a hit can claim a reward, and a stronger boss
arrives a little later.

Answers are graded here against the stored answer keys, so a changed page
can't deal damage it didn't earn, and each question only counts once per
boss for each student.
"""
import json
import random
import time

from flask import Blueprint, abort, jsonify, request

import questlearn
import security
import userdb

bp = Blueprint("guild", __name__)

NEXT_BOSS_SECONDS = 120   # the victory screen stays up this long before the next boss
BASE_DAMAGE = 10
DAILY_HITS = 400

_current_student = None
_group = None


def init(app, current_student, group_info):
    global _current_student, _group
    _current_student = current_student
    _group = group_info
    userdb.create_tables("""
        CREATE TABLE IF NOT EXISTS ql_guild_boss (
            group_id TEXT PRIMARY KEY, boss INTEGER NOT NULL, hp INTEGER NOT NULL, max_hp INTEGER NOT NULL,
            started REAL NOT NULL, defeated REAL);
        CREATE TABLE IF NOT EXISTS ql_guild_hits (
            group_id TEXT NOT NULL, boss INTEGER NOT NULL, student_id INTEGER NOT NULL,
            damage INTEGER NOT NULL DEFAULT 0, hits INTEGER NOT NULL DEFAULT 0, misses INTEGER NOT NULL DEFAULT 0,
            combo INTEGER NOT NULL DEFAULT 0, refs TEXT, last_at REAL, claimed INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (group_id, boss, student_id));
        CREATE TABLE IF NOT EXISTS ql_guild_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL, boss INTEGER NOT NULL,
            student_id INTEGER NOT NULL, name TEXT, damage INTEGER NOT NULL, crit INTEGER NOT NULL DEFAULT 0, at REAL NOT NULL);
    """)
    app.register_blueprint(bp)


def _me():
    row = _current_student()
    if not row:
        abort(401, "please log in")
    info = _group(row["grade"], row["track"])
    if not info:
        abort(400, "Choose your level first.")
    return row, info


def _character(row):
    try:
        return json.loads(row["profile"] or "{}").get("character")
    except ValueError:
        return None


def max_hp(boss, members):
    return int((250 + 120 * max(1, members)) * (1 + 0.25 * (boss - 1)))


def reward(boss):
    return {"gold": 150 + 50 * boss, "insight": 3}


def _boss(conn, info):
    """The group's current boss, creating the first one or the next one when it's due."""
    gid = info["id"]
    row = conn.execute("SELECT * FROM ql_guild_boss WHERE group_id=?", (gid,)).fetchone()
    now = time.time()
    if row and not (row["defeated"] and now - row["defeated"] >= NEXT_BOSS_SECONDS):
        return row
    members = conn.execute("SELECT COUNT(*) AS n FROM ql_students WHERE grade=? AND track=?",
                           (info["grade"], info["track"])).fetchone()["n"]
    n = row["boss"] + 1 if row else 1
    hp = max_hp(n, members)
    conn.execute("INSERT INTO ql_guild_boss (group_id, boss, hp, max_hp, started, defeated) VALUES (?,?,?,?,?,NULL) "
                 "ON CONFLICT (group_id) DO UPDATE SET boss=excluded.boss, hp=excluded.hp, max_hp=excluded.max_hp, "
                 "started=excluded.started, defeated=NULL", (gid, n, hp, hp, now))
    conn.commit()
    return conn.execute("SELECT * FROM ql_guild_boss WHERE group_id=?", (gid,)).fetchone()


def _state(conn, me, info):
    boss = _boss(conn, info)
    gid, n = info["id"], boss["boss"]
    hits = conn.execute("SELECT h.*, s.name, s.profile FROM ql_guild_hits h JOIN ql_students s ON s.id = h.student_id "
                        "WHERE h.group_id=? AND h.boss=? ORDER BY h.damage DESC", (gid, n)).fetchall()
    mine = next((h for h in hits if h["student_id"] == me["id"]), None)
    log = conn.execute("SELECT id, name, damage, crit, at, student_id FROM ql_guild_log WHERE group_id=? AND boss=? "
                       "ORDER BY id DESC LIMIT 12", (gid, n)).fetchall()
    unclaimed = conn.execute("SELECT h.boss FROM ql_guild_hits h JOIN ql_guild_boss b ON b.group_id = h.group_id "
                             "WHERE h.group_id=? AND h.student_id=? AND h.claimed=0 AND h.hits > 0 "
                             "AND (h.boss < b.boss OR b.defeated IS NOT NULL) ORDER BY h.boss",
                             (gid, me["id"])).fetchall()
    now = time.time()
    return {
        "group": info,
        "boss": {"n": n, "hp": boss["hp"], "max_hp": boss["max_hp"], "started": boss["started"],
                 "defeated": boss["defeated"],
                 "next_in": max(0, int(boss["defeated"] + NEXT_BOSS_SECONDS - now)) if boss["defeated"] else None},
        "me": {"damage": mine["damage"] if mine else 0, "hits": mine["hits"] if mine else 0,
               "combo": mine["combo"] if mine else 0, "character": _character(me)},
        "top": [{"name": h["name"], "damage": h["damage"], "hits": h["hits"], "me": h["student_id"] == me["id"],
                 "character": _character(h)} for h in hits[:10]],
        "fighters": len(hits),
        "log": [{"id": r["id"], "name": r["name"], "damage": r["damage"], "crit": bool(r["crit"]), "ago": int(now - r["at"]),
                 "me": r["student_id"] == me["id"]} for r in log],
        "rewards": [{"boss": r["boss"], **reward(r["boss"])} for r in unclaimed],
    }


@bp.route("/api/guild")
def guild_state():
    me, info = _me()
    conn = userdb.connect()
    out = _state(conn, me, info)
    conn.close()
    return jsonify(out)


@bp.route("/api/guild/hit", methods=["POST"])
def guild_hit():
    """{ref, choice}: answer a question to hit the boss."""
    me, info = _me()
    security.rate_limit("guild-hit", 30, 60, key=me["id"], per_ip=False)
    security.rate_limit("guild-day", DAILY_HITS, 86400, key=me["id"], per_ip=False)
    data = request.get_json(silent=True) or {}
    ref = str(data.get("ref") or "")
    answer = questlearn.known_answer(ref)
    if answer is None:
        abort(400, "This question can't be used against the boss.")
    try:
        choice = int(data.get("choice"))
    except (TypeError, ValueError):
        abort(400, "Pick an answer.")
    conn = userdb.connect()
    boss = _boss(conn, info)
    if boss["defeated"]:
        conn.close()
        abort(409, "This boss has already fallen.")
    gid, n = info["id"], boss["boss"]
    row = conn.execute("SELECT * FROM ql_guild_hits WHERE group_id=? AND boss=? AND student_id=?",
                       (gid, n, me["id"])).fetchone()
    refs = set(json.loads(row["refs"] or "[]")) if row else set()
    correct = choice == answer
    repeat = correct and ref in refs
    combo = (row["combo"] if row else 0)
    damage, crit = 0, False
    character = _character(me)
    if correct and not repeat:
        combo += 1
        cap = 10 if character == "sage" else 5      # Sage: focus builds higher
        damage = BASE_DAMAGE + 2 * min(combo - 1, cap)
        if character == "warrior":                 # Warrior: hits harder
            damage = round(damage * 1.5)
        if character == "explorer" and random.random() < 0.25:  # Explorer: finds weak spots
            damage, crit = damage * 2, True
        refs.add(ref)
    elif not correct:
        combo = 0
    now = time.time()
    conn.execute("INSERT INTO ql_guild_hits (group_id, boss, student_id, damage, hits, misses, combo, refs, last_at) "
                 "VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (group_id, boss, student_id) DO UPDATE SET "
                 "damage = ql_guild_hits.damage + excluded.damage, hits = ql_guild_hits.hits + excluded.hits, "
                 "misses = ql_guild_hits.misses + excluded.misses, combo = excluded.combo, refs = excluded.refs, "
                 "last_at = excluded.last_at",
                 (gid, n, me["id"], damage, int(damage > 0), int(not correct), combo, json.dumps(sorted(refs)[-500:]), now))
    if damage:
        conn.execute("UPDATE ql_guild_boss SET hp = CASE WHEN hp > ? THEN hp - ? ELSE 0 END WHERE group_id=? AND boss=?",
                     (damage, damage, gid, n))
        conn.execute("UPDATE ql_guild_boss SET defeated=? WHERE group_id=? AND boss=? AND hp=0 AND defeated IS NULL",
                     (now, gid, n))
        userdb.insert(conn, "INSERT INTO ql_guild_log (group_id, boss, student_id, name, damage, crit, at) VALUES (?,?,?,?,?,?,?)",
                      (gid, n, me["id"], me["name"], damage, int(crit), now))
    conn.commit()
    out = _state(conn, me, info)
    conn.close()
    return jsonify({**out, "hit": {"correct": correct, "answer": answer, "damage": damage, "crit": crit,
                                   "repeat": repeat, "combo": combo}})


@bp.route("/api/guild/claim", methods=["POST"])
def guild_claim():
    """{boss}: collect the reward for a fallen boss you fought."""
    me, info = _me()
    try:
        n = int((request.get_json(silent=True) or {}).get("boss"))
    except (TypeError, ValueError):
        abort(400)
    conn = userdb.connect()
    current = _boss(conn, info)
    row = conn.execute("SELECT * FROM ql_guild_hits WHERE group_id=? AND boss=? AND student_id=?",
                       (info["id"], n, me["id"])).fetchone()
    fallen = n < current["boss"] or (n == current["boss"] and current["defeated"])
    if not row or not row["hits"] or row["claimed"] or not fallen:
        conn.close()
        abort(409, "There's no reward to claim for that boss.")
    conn.execute("UPDATE ql_guild_hits SET claimed=1 WHERE group_id=? AND boss=? AND student_id=?", (info["id"], n, me["id"]))
    conn.commit()
    conn.close()
    return jsonify({"boss": n, **reward(n)})

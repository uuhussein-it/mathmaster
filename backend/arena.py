"""The class arena: one-minute fights between classmates, powered by quiz progress.

Academic progress sets each fighter's stats (level -> health, accuracy ->
attack, best streak -> how fast the special meter fills) and unlocks special
moves and skins. Classmates in the same group challenge each other; the winner
takes XP from the loser.

The server runs the fight: browsers only send which buttons are held, and
every hit, special move and result is decided here, so nothing in the browser
can change damage, health or the XP at stake. Fights run in memory, so the app
must run as one gunicorn worker (see render.yaml); results go to the database.
"""
import json
import math
import os
import secrets
import threading
import time
from collections import deque

from flask import Blueprint, abort, jsonify, request, session

import gear
import security
import userdb

bp = Blueprint("arena", __name__)

UNLOCK_LEVEL = int(os.environ.get("ARENA_UNLOCK_LEVEL", "3"))
SPECIALS = [  # (id, name, unlock level, combo shown to players)
    ("fireball", "Fireball", UNLOCK_LEVEL, "↓ → + Punch"),
    ("shield", "Shield", UNLOCK_LEVEL + 2, "↓ ← + Punch"),
    ("critical", "Critical Strike", UNLOCK_LEVEL + 5, "↓ ↓ + Kick"),
]
SKINS = [(UNLOCK_LEVEL + 9, "gold"), (UNLOCK_LEVEL + 5, "silver"), (UNLOCK_LEVEL + 2, "bronze"), (0, "base")]
FAIR_PLAY = 1.25          # the stronger fighter's stats are capped at 125% of the weaker's
WIN_BONUS = 10
ROUND_SECONDS = 60
COUNTDOWN = 3
CHALLENGE_SECONDS = 45
ONLINE_SECONDS = 5 * 60

_lock = threading.Lock()
CHALLENGES = {}   # id -> {id, from, to, from_name, created, match}
MATCHES = {}      # id -> Match

_current_student = None
REALTIME = False  # flask-sock installed and the fight socket registered


def init(app, current_student):
    global _current_student, REALTIME
    _current_student = current_student
    userdb.create_tables("""
        CREATE TABLE IF NOT EXISTS ql_fights (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            grp TEXT, a_id INTEGER, b_id INTEGER, a_name TEXT, b_name TEXT,
            winner_id INTEGER, a_hp INTEGER, b_hp INTEGER, reason TEXT,
            stake INTEGER, created_at REAL);
        CREATE INDEX IF NOT EXISTS ql_fights_grp ON ql_fights (grp, created_at);
    """)
    app.register_blueprint(bp)
    try:
        from flask_sock import Sock
    except ImportError:  # without it the arena page explains fights are unavailable
        return
    Sock(app).route("/api/arena/ws/<mid>")(_socket)
    REALTIME = True


# ----------------------------------------------------------------- fighters
def _profile(row):
    try:
        return json.loads(row["profile"] or "{}")
    except ValueError:
        return {}


def stats(row):
    """Raw fight stats from a student's (server-checked) progress."""
    p = _profile(row)
    level = max(1, int(p.get("level") or row["level"] or 1))
    answered, correct = int(p.get("answered") or 0), int(p.get("correct") or 0)
    accuracy = correct / answered if answered >= 10 else 0.6
    streak = min(20, int(p.get("bestStreak") or 0))
    bonus = gear.bonuses(row)
    return {
        "level": level,
        "accuracy": round(accuracy, 2),
        "best_streak": streak,
        "hp": 100 + 10 * min(level, 20) + bonus["hp"],
        "attack": round(6 + 6 * accuracy + bonus["attack"], 1),
        "charge": round(1 + streak / 10 + bonus["charge"], 2),
        "gear": gear.looks(row),
        "specials": [s[0] for s in SPECIALS if level >= s[2]],
        "skin": next(name for lvl, name in SKINS if level >= lvl),
        "unlocked": level >= UNLOCK_LEVEL,
    }


def _balanced(a, b):
    """Fair play: neither side gets more than FAIR_PLAY times the other's stat."""
    a, b = dict(a), dict(b)
    for k in ("hp", "attack", "charge"):
        lo = min(a[k], b[k])
        a[k] = min(a[k], lo * FAIR_PLAY)
        b[k] = min(b[k], lo * FAIR_PLAY)
    return a, b


def _effective_xp(row):
    return max(0, int(_profile(row).get("totalXp") or 0) + int(row["arena_xp"] or 0))


def _fighter_card(row, now):
    st = stats(row)
    return {"id": row["id"], "name": row["name"], "character": _profile(row).get("character"),
            "online": bool(row["last_seen"]) and now - row["last_seen"] < ONLINE_SECONDS,
            "busy": _busy(row["id"]), **st}


def _busy(sid):
    return any(sid in m.ids and m.phase != "over" for m in MATCHES.values())


# ------------------------------------------------------------------- lobby
def _me():
    row = _current_student()
    if not row:
        abort(401, "please log in")
    if not row["grade"] or not row["track"]:
        abort(400, "Choose your level first.")
    return row


def _group_id(row):
    return f"{row['grade']}-{row['track']}"


def _expire():
    now = time.time()
    for cid, c in list(CHALLENGES.items()):
        if now - c["created"] > CHALLENGE_SECONDS or c.get("match") and c["match"] not in MATCHES:
            del CHALLENGES[cid]
    for mid, m in list(MATCHES.items()):
        if m.phase == "over" and now - m.ended > 120:
            del MATCHES[mid]


def _records(rows, fights):
    """Wins, losses, draws and current win streak per student id."""
    rec = {r["id"]: {"wins": 0, "losses": 0, "draws": 0, "streak": 0, "_open": True} for r in rows}
    for f in fights:  # newest first
        for sid in (f["a_id"], f["b_id"]):
            r = rec.get(sid)
            if not r:
                continue
            if f["winner_id"] is None:
                r["draws"] += 1
                r["_open"] = False
            elif f["winner_id"] == sid:
                r["wins"] += 1
                r["streak"] += r["_open"]
            else:
                r["losses"] += 1
                r["_open"] = False
    for r in rec.values():
        r.pop("_open")
    return rec


@bp.route("/api/arena")
def lobby():
    me = _me()
    gid = _group_id(me)
    now = time.time()
    conn = userdb.connect()
    rows = conn.execute("SELECT * FROM ql_students WHERE grade=? AND track=?", (me["grade"], me["track"])).fetchall()
    fights = conn.execute("SELECT * FROM ql_fights WHERE grp=? ORDER BY id DESC LIMIT 2000", (gid,)).fetchall()
    conn.close()
    rec = _records(rows, fights)
    with _lock:
        _expire()
        incoming = [c for c in CHALLENGES.values() if c["to"] == me["id"] and not c.get("match")]
        outgoing = [c for c in CHALLENGES.values() if c["from"] == me["id"]]
        live = next((m for m in MATCHES.values() if me["id"] in m.ids and m.phase != "over"), None)
    fighters = [{**_fighter_card(r, now), **rec[r["id"]]} for r in rows if r["id"] != me["id"]]
    fighters.sort(key=lambda f: (not f["online"], not f["unlocked"], f["name"].lower()))
    board = sorted(({"id": r["id"], "name": r["name"], "character": _profile(r).get("character"),
                     "arena_xp": r["arena_xp"] or 0, **rec[r["id"]]}
                    for r in rows if not r["hidden"] and (rec[r["id"]]["wins"] + rec[r["id"]]["losses"] + rec[r["id"]]["draws"])),
                   key=lambda b: (-b["wins"], -b["streak"], b["losses"], b["name"].lower()))[:20]
    history = [{"id": f["id"], "opponent": f["b_name"] if f["a_id"] == me["id"] else f["a_name"],
                "result": "draw" if f["winner_id"] is None else "win" if f["winner_id"] == me["id"] else "loss",
                "reason": f["reason"], "stake": f["stake"], "at": f["created_at"]}
               for f in fights if me["id"] in (f["a_id"], f["b_id"])][:10]
    return jsonify({
        "me": {**_fighter_card(me, now), **rec[me["id"]], "arena_xp": me["arena_xp"] or 0, "xp": _effective_xp(me)},
        "unlock_level": UNLOCK_LEVEL,
        "specials": [{"id": s[0], "name": s[1], "level": s[2], "combo": s[3]} for s in SPECIALS],
        "fighters": fighters, "board": board, "history": history,
        "incoming": [{"id": c["id"], "from": c["from_name"], "expires": int(c["created"] + CHALLENGE_SECONDS - now)}
                     for c in incoming],
        "outgoing": [{"id": c["id"], "to": c["to_name"], "match": c.get("match")} for c in outgoing],
        "match": live.id if live else None,
        "realtime": REALTIME,
    })


@bp.route("/api/arena/challenge", methods=["POST"])
def challenge():
    me = _me()
    security.rate_limit("arena-challenge", 20, 60)
    try:
        opp_id = int((request.get_json(silent=True) or {}).get("opponent"))
    except (TypeError, ValueError):
        abort(400, "Choose a classmate.")
    conn = userdb.connect()
    opp = conn.execute("SELECT * FROM ql_students WHERE id=?", (opp_id,)).fetchone()
    conn.close()
    if not opp or opp["id"] == me["id"] or (opp["grade"], opp["track"]) != (me["grade"], me["track"]):
        abort(400, "You can only challenge classmates in your group.")
    if not stats(me)["unlocked"]:
        abort(403, f"Reach level {UNLOCK_LEVEL} to unlock the arena.")
    if not stats(opp)["unlocked"]:
        abort(400, f"{opp['name']} hasn't unlocked the arena yet.")
    if not opp["last_seen"] or time.time() - opp["last_seen"] > ONLINE_SECONDS:
        abort(400, f"{opp['name']} isn't online right now.")
    with _lock:
        _expire()
        if _busy(me["id"]) or _busy(opp["id"]):
            abort(409, "One of you is already in a fight.")
        for c in list(CHALLENGES.values()):
            if c["from"] == me["id"]:
                del CHALLENGES[c["id"]]  # one open challenge at a time
        cid = secrets.token_urlsafe(8)
        CHALLENGES[cid] = {"id": cid, "from": me["id"], "to": opp["id"], "from_name": me["name"],
                           "to_name": opp["name"], "created": time.time()}
    return jsonify({"ok": True, "id": cid})


@bp.route("/api/arena/challenge/<cid>", methods=["POST", "DELETE"])
def answer_challenge(cid):
    """POST {accept: true|false} by the challenged student; DELETE cancels your own."""
    me = _me()
    with _lock:
        _expire()
        c = CHALLENGES.get(cid)
        if not c or me["id"] not in (c["from"], c["to"]):
            abort(404, "That challenge has expired.")
        if request.method == "DELETE" or not (request.get_json(silent=True) or {}).get("accept"):
            del CHALLENGES[cid]
            return jsonify({"ok": True})
        if me["id"] != c["to"]:
            abort(403)
        if _busy(c["from"]) or _busy(c["to"]):
            abort(409, "One of you is already in a fight.")
    conn = userdb.connect()
    a = conn.execute("SELECT * FROM ql_students WHERE id=?", (c["from"],)).fetchone()
    b = conn.execute("SELECT * FROM ql_students WHERE id=?", (c["to"],)).fetchone()
    conn.close()
    match = Match(a, b)
    with _lock:
        MATCHES[match.id] = match
        c["match"] = match.id
    match.start()
    return jsonify({"ok": True, "match": match.id})


@bp.route("/api/arena/match/<mid>")
def match_info(mid):
    me = _me()
    m = MATCHES.get(mid)
    if not m or me["id"] not in m.ids:
        abort(404, "This fight has ended.")
    return jsonify(m.snapshot(full=True))


# --------------------------------------------------------------- the fight
W = 960            # arena width (world units; the browser scales it)
SPEED = 270
JUMP = 640
GRAVITY = 1900
TICK = 1 / 30
MOVES = {          # duration, moment the hit lands, reach, damage multiplier, cooldown after
    "punch": (0.24, 0.09, 100, 1.0, 0.08),
    "kick": (0.40, 0.18, 130, 1.5, 0.12),
    "critical": (0.55, 0.25, 140, 3.0, 0.3),
}
COMBO_WINDOW = 0.7
SPECIAL_COST = {"fireball": 35, "shield": 30, "critical": 100}


class Fighter:
    def __init__(self, row, st, side):
        p = _profile(row)
        self.id, self.name, self.character = row["id"], row["name"], p.get("character") or "warrior"
        self.st = st
        self.max_hp = self.hp = float(st["hp"])
        self.x = W * (0.28 if side == 0 else 0.72)
        self.y = self.vy = self.vx = 0.0
        self.facing = 1 if side == 0 else -1
        self.meter = 0.0
        self.action = None
        self.action_t = 0.0
        self.hit_done = False
        self.cool = 0.0
        self.stun = 0.0
        self.shield = 0.0
        self.keys = {}
        self.prev = {}
        self.dirs = deque(maxlen=6)  # (time, "d"|"f"|"b"|"u") on each new press
        self.sockets = []
        self.last_contact = time.time()
        self.effective_xp = _effective_xp(row)

    def public(self):
        return {"id": self.id, "name": self.name, "character": self.character, "skin": self.st["skin"],
                "x": round(self.x, 1), "y": round(self.y, 1), "vx": round(self.vx), "facing": self.facing,
                "hp": round(max(0, self.hp), 1), "max_hp": self.max_hp, "meter": round(self.meter),
                "action": self.action, "action_t": round(self.action_t, 2), "stun": self.stun > 0,
                "block": self.blocking(), "shield": self.shield > 0, "specials": self.st["specials"],
                "gear": self.st["gear"]}

    def blocking(self):
        return bool(self.keys.get("block")) and self.y == 0 and self.action is None and self.stun <= 0


class Match:
    def __init__(self, a, b):
        self.id = secrets.token_urlsafe(10)
        self.grp = _group_id(a)
        sa, sb = _balanced(stats(a), stats(b))
        self.f = [Fighter(a, sa, 0), Fighter(b, sb, 1)]
        self.ids = {a["id"], b["id"]}
        # The stake: 10% of the poorer fighter's XP, between 5 and 50.
        self.stake = max(5, min(50, round(0.1 * min(f.effective_xp for f in self.f))))
        self.created = time.time()
        self.phase = "waiting"   # waiting -> countdown -> fight -> over
        self.phase_start = self.created
        self.projectiles = []
        self.events = []
        self.result = None
        self.ended = 0.0
        self.lock = threading.Lock()

    # -- sockets
    def fighter(self, sid):
        return next(f for f in self.f if f.id == sid)

    def attach(self, sid, ws):
        with self.lock:
            f = self.fighter(sid)
            f.sockets.append(ws)
            f.last_contact = time.time()

    def detach(self, sid, ws):
        with self.lock:
            f = self.fighter(sid)
            if ws in f.sockets:
                f.sockets.remove(ws)
            f.last_contact = time.time()

    def on_input(self, sid, msg):
        keys = msg.get("keys") if isinstance(msg, dict) else None
        if not isinstance(keys, dict):
            return
        with self.lock:
            f = self.fighter(sid)
            f.keys = {k: bool(keys.get(k)) for k in ("left", "right", "up", "down", "punch", "kick", "block")}
            f.last_contact = time.time()

    def start(self):
        threading.Thread(target=self._run, name=f"arena-{self.id}", daemon=True).start()

    # -- loop
    def _run(self):
        frame = 0
        next_t = time.time()
        while self.phase != "over":
            now = time.time()
            with self.lock:
                self._step(now)
                payload = None
                if frame % 2 == 0 or self.phase == "over":
                    payload = json.dumps(self.snapshot())
                    self.events = []  # sent; events pile up between sends so none are missed
                targets = [(f, ws) for f in self.f for ws in f.sockets]
            if payload:
                for f, ws in targets:
                    try:
                        ws.send(payload)
                    except Exception:
                        self.detach(f.id, ws)
            frame += 1
            next_t += TICK
            time.sleep(max(0.0, next_t - time.time()))
        self._save()
        final = json.dumps(self.snapshot())
        for f in self.f:
            for ws in list(f.sockets):
                try:
                    ws.send(final)
                except Exception:
                    pass

    def _step(self, now):
        connected = [bool(f.sockets) for f in self.f]
        if self.phase == "waiting":
            if all(connected):
                self._phase("countdown", now)
            elif now - self.created > 25:
                self._finish(now, next((f for f, c in zip(self.f, connected) if c), None),
                             "no-show" if not any(connected) else "forfeit")
            return
        if self.phase == "countdown":
            if now - self.phase_start >= COUNTDOWN:
                self._phase("fight", now)
            return
        # fight
        for f, c in zip(self.f, connected):
            if not c and now - f.last_contact > 8:
                return self._finish(now, self._other(f), "forfeit")
        for f in self.f:
            self._control(f, now)
        for f in self.f:
            self._physics(f)
        self._attacks()
        self._fly()
        a, b = self.f
        if a.hp <= 0 or b.hp <= 0:
            winner = None if a.hp <= 0 and b.hp <= 0 else (a if b.hp <= 0 else b)
            return self._finish(now, winner, "ko")
        if now - self.phase_start >= ROUND_SECONDS:
            winner = None if abs(a.hp / a.max_hp - b.hp / b.max_hp) < 0.005 else (a if a.hp / a.max_hp > b.hp / b.max_hp else b)
            self._finish(now, winner, "time")

    def _phase(self, name, now):
        self.phase, self.phase_start = name, now

    def _other(self, f):
        return self.f[1] if f is self.f[0] else self.f[0]

    def _control(self, f, now):
        k, prev = f.keys, f.prev
        f.prev = dict(k)
        opp = self._other(f)
        f.facing = 1 if opp.x >= f.x else -1
        for key, d in (("down", "d"), ("up", "u"), ("left", "f" if f.facing < 0 else "b"),
                       ("right", "f" if f.facing > 0 else "b")):
            if k.get(key) and not prev.get(key):
                f.dirs.append((now, d))
        f.meter = min(100.0, f.meter + 4 * f.st["charge"] * TICK)
        f.cool = max(0.0, f.cool - TICK)
        f.shield = max(0.0, f.shield - TICK)
        if f.stun > 0:
            f.stun -= TICK
            f.vx = 0.0
            return
        if f.action:
            return
        pressed = lambda key: k.get(key) and not prev.get(key)
        if pressed("punch") or pressed("kick"):
            special = self._combo(f, now, "punch" if pressed("punch") else "kick")
            if special == "fireball":
                f.meter -= SPECIAL_COST["fireball"]
                self.projectiles.append({"owner": f.id, "x": f.x + 50 * f.facing, "y": 70, "dir": f.facing,
                                         "dmg": f.st["attack"] * 2.2})
                self.events.append({"type": "special", "who": f.id, "move": "fireball"})
                f.cool = 0.35
                f.dirs.clear()
                return
            if special == "shield":
                f.meter -= SPECIAL_COST["shield"]
                f.shield = 2.0
                self.events.append({"type": "special", "who": f.id, "move": "shield"})
                f.dirs.clear()
                return
            if special == "critical":
                f.meter -= SPECIAL_COST["critical"]
                self.events.append({"type": "special", "who": f.id, "move": "critical"})
                f.dirs.clear()
                self._begin(f, "critical")
                return
            if f.cool <= 0:
                self._begin(f, "punch" if pressed("punch") else "kick")
                return
        f.vx = 0.0
        if not f.blocking():
            f.vx = SPEED * ((1 if k.get("right") else 0) - (1 if k.get("left") else 0))
        if k.get("up") and f.y == 0:
            f.vy = JUMP

    def _combo(self, f, now, button):
        recent = [d for t, d in f.dirs if now - t <= COMBO_WINDOW][-2:]
        wants = {("d", "f", "punch"): "fireball", ("d", "b", "punch"): "shield", ("d", "d", "kick"): "critical"}
        move = wants.get((*recent, button)) if len(recent) == 2 else None
        if move and move in f.st["specials"] and f.meter >= SPECIAL_COST[move]:
            return move
        return None

    def _begin(self, f, move):
        f.action, f.action_t, f.hit_done = move, 0.0, False
        f.vx = 0.0

    def _physics(self, f):
        if f.action:
            f.action_t += TICK
            dur, *_, cool = MOVES[f.action]
            if f.action_t >= dur:
                f.action, f.cool = None, cool
        f.x += f.vx * TICK
        if f.y > 0 or f.vy > 0:
            f.vy -= GRAVITY * TICK
            f.y = max(0.0, f.y + f.vy * TICK)
            if f.y == 0:
                f.vy = 0.0
        f.x = min(W - 40, max(40, f.x))
        opp = self._other(f)
        if abs(f.x - opp.x) < 60 and abs(f.y - opp.y) < 80:  # bodies don't overlap
            push = (60 - abs(f.x - opp.x)) / 2 * (1 if f.x < opp.x else -1)
            f.x = min(W - 40, max(40, f.x - push))

    def _attacks(self):
        for f in self.f:
            if not f.action or f.hit_done:
                continue
            dur, at, reach, mult, _ = MOVES[f.action]
            if f.action_t < at:
                continue
            f.hit_done = True
            opp = self._other(f)
            dx = (opp.x - f.x) * f.facing
            if 0 < dx <= reach and abs(opp.y - f.y) < 90:
                self._hit(f, opp, f.st["attack"] * mult, f.action)

    def _hit(self, f, opp, dmg, move):
        if opp.shield > 0:
            dmg, kind = 0.0, "shielded"
        elif opp.blocking() and opp.facing == -f.facing:
            dmg, kind = dmg * 0.2, "blocked"
        else:
            kind = "hit"
            opp.stun = 0.45 if move == "critical" else 0.22
            opp.action = None
            opp.x = min(W - 40, max(40, opp.x + f.facing * (60 if move == "critical" else 22)))
        opp.hp -= dmg
        f.meter = min(100.0, f.meter + (6 if kind == "hit" else 2))
        opp.meter = min(100.0, opp.meter + 3)
        self.events.append({"type": kind, "who": opp.id, "by": f.id, "move": move, "dmg": round(dmg, 1),
                            "x": round(opp.x, 1), "y": round(opp.y + 90, 1)})

    def _fly(self):
        keep = []
        for p in self.projectiles:
            p["x"] += 520 * p["dir"] * TICK
            target = next(f for f in self.f if f.id != p["owner"])
            owner = self._other(target)
            if abs(target.x - p["x"]) < 45 and target.y < 90:
                self._hit(owner, target, p["dmg"], "fireball")
                continue
            if 0 <= p["x"] <= W:
                keep.append(p)
        self.projectiles = keep

    def _finish(self, now, winner, reason):
        self.phase, self.ended = "over", now
        loser = self._other(winner) if winner else None
        taken = min(self.stake, loser.effective_xp) if loser else 0
        self.result = {"winner": winner.id if winner else None, "reason": reason,
                       "xp": {f.id: (taken + WIN_BONUS if f is winner else -taken if f is loser else 0) for f in self.f}}
        if reason == "no-show":
            self.result["xp"] = {f.id: 0 for f in self.f}

    def _save(self):
        if not self.result or self.result["reason"] == "no-show":
            return
        a, b = self.f
        conn = userdb.connect()
        try:
            conn.execute("INSERT INTO ql_fights (grp, a_id, b_id, a_name, b_name, winner_id, a_hp, b_hp, reason, stake, "
                         "created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                         (self.grp, a.id, b.id, a.name, b.name, self.result["winner"], round(max(0, a.hp)),
                          round(max(0, b.hp)), self.result["reason"], self.stake, self.ended))
            for f in self.f:
                if self.result["winner"] == f.id:
                    conn.execute("UPDATE ql_students SET arena_wins = arena_wins + 1 WHERE id=?", (f.id,))
                if self.result["xp"][f.id]:
                    conn.execute("UPDATE ql_students SET arena_xp = arena_xp + ? WHERE id=?",
                                 (self.result["xp"][f.id], f.id))
            conn.commit()
        finally:
            conn.close()

    def snapshot(self, full=False):
        now = time.time()
        left = {"waiting": ROUND_SECONDS, "countdown": ROUND_SECONDS,
                "fight": max(0.0, ROUND_SECONDS - (now - self.phase_start)), "over": 0}[self.phase]
        out = {"match": self.id, "phase": self.phase, "time_left": round(left, 1),
               "countdown": max(0, math.ceil(COUNTDOWN - (now - self.phase_start))) if self.phase == "countdown" else None,
               "fighters": [f.public() for f in self.f],
               "projectiles": [{"x": round(p["x"], 1), "y": p["y"], "dir": p["dir"], "owner": p["owner"]}
                               for p in self.projectiles],
               "events": self.events, "result": self.result, "stake": self.stake, "width": W,
               "connected": {f.id: bool(f.sockets) for f in self.f}}
        if full:
            out["stats"] = {f.id: f.st for f in self.f}
        return out


# -------------------------------------------------------------- websocket
def _socket(ws, mid):
    origin = request.headers.get("Origin")
    from urllib.parse import urlparse
    if origin and urlparse(origin).netloc != request.host:
        return  # another site can't open a fight socket with this student's cookie
    sid = session.get("student_id")
    m = MATCHES.get(mid)
    if not sid or not m or sid not in m.ids:
        return
    m.attach(sid, ws)
    try:
        ws.send(json.dumps(m.snapshot(full=True)))
        while m.phase != "over":
            msg = ws.receive(timeout=1)
            if msg is None:
                continue
            try:
                m.on_input(sid, json.loads(msg))
            except (ValueError, TypeError):
                pass
        time.sleep(0.5)  # let the final result reach the browser
    except Exception:
        pass
    finally:
        m.detach(sid, ws)

"""The armory: swords, armor and charms students unlock with their progress
(level from answering questions, wins in the class arena, best answer streak)
and equip on their hero. Equipped gear shows on the fighter and adds a small
bonus in arena fights (still capped by the arena's fair-play rule).

Unlocks are worked out on the server from the student's checked progress, so
a changed page can't equip something it hasn't earned.
"""
import json

from flask import Blueprint, abort, jsonify, request

import security
import userdb

bp = Blueprint("gear", __name__)

SLOTS = ("weapon", "armor", "charm")

# need: ("level", n) | ("wins", n) | ("streak", n); bonus adds to the arena stat named.
CATALOG = [
    {"id": "wooden-sword", "slot": "weapon", "name": "Wooden Sword", "icon": "🗡️", "need": ("level", 1), "bonus": ("attack", 0),
     "look": {"kind": "sword", "color": "#b07a45"}, "text": "Every hero starts somewhere."},
    {"id": "iron-sword", "slot": "weapon", "name": "Iron Sword", "icon": "⚔️", "need": ("level", 3), "bonus": ("attack", 0.5),
     "look": {"kind": "sword", "color": "#b9c3d6"}, "text": "Forged from your first wins over the course."},
    {"id": "steel-blade", "slot": "weapon", "name": "Steel Blade", "icon": "🔪", "need": ("level", 6), "bonus": ("attack", 1),
     "look": {"kind": "sword", "color": "#e8eef8"}, "text": "Sharp, like your algebra."},
    {"id": "crystal-staff", "slot": "weapon", "name": "Crystal Staff", "icon": "🪄", "need": ("level", 9), "bonus": ("attack", 1.5),
     "look": {"kind": "staff", "color": "#8fe6f5"}, "text": "Channels the power of patient thinking."},
    {"id": "flame-sword", "slot": "weapon", "name": "Flame Sword", "icon": "🔥", "need": ("level", 12), "bonus": ("attack", 2),
     "look": {"kind": "sword", "color": "#ff8a3d"}, "text": "Burns bright for level 12 heroes."},
    {"id": "thunder-hammer", "slot": "weapon", "name": "Thunder Hammer", "icon": "🔨", "need": ("wins", 10), "bonus": ("attack", 2),
     "look": {"kind": "hammer", "color": "#ffd34d"}, "text": "Earned with 10 arena victories."},
    {"id": "star-blade", "slot": "weapon", "name": "Star Blade", "icon": "🌟", "need": ("level", 20), "bonus": ("attack", 3),
     "look": {"kind": "sword", "color": "#f7e27a"}, "text": "Legendary. Only for level 20 masters."},

    {"id": "cloth-tunic", "slot": "armor", "name": "Cloth Tunic", "icon": "👕", "need": ("level", 1), "bonus": ("hp", 0),
     "look": {"color": ""}, "text": "Light and simple."},
    {"id": "leather-armor", "slot": "armor", "name": "Leather Armor", "icon": "🦺", "need": ("level", 4), "bonus": ("hp", 10),
     "look": {"color": "#8a5a32"}, "text": "Tough enough for daily practice."},
    {"id": "chainmail", "slot": "armor", "name": "Chainmail", "icon": "⛓️", "need": ("level", 7), "bonus": ("hp", 20),
     "look": {"color": "#9aa4b5"}, "text": "Linked rings, like linked equations."},
    {"id": "knight-plate", "slot": "armor", "name": "Knight Plate", "icon": "🛡️", "need": ("level", 11), "bonus": ("hp", 30),
     "look": {"color": "#d7dde8"}, "text": "Full plate for seasoned heroes."},
    {"id": "champion-cape", "slot": "armor", "name": "Champion Cape", "icon": "🦸", "need": ("wins", 25), "bonus": ("hp", 40),
     "look": {"color": "#c0392b", "cape": True}, "text": "For the class arena's champions: 25 wins."},
    {"id": "dragon-scale", "slot": "armor", "name": "Dragon Scale", "icon": "🐉", "need": ("level", 16), "bonus": ("hp", 45),
     "look": {"color": "#2fbf71"}, "text": "Scales of a dragon, for level 16 legends."},

    {"id": "no-charm", "slot": "charm", "name": "No charm", "icon": "▫️", "need": ("level", 1), "bonus": ("charge", 0),
     "look": {"color": ""}, "text": "Nothing equipped."},
    {"id": "lucky-coin", "slot": "charm", "name": "Lucky Coin", "icon": "🪙", "need": ("level", 2), "bonus": ("charge", 0.1),
     "look": {"color": "#e6c06a"}, "text": "A little luck for your special meter."},
    {"id": "owl-feather", "slot": "charm", "name": "Owl Feather", "icon": "🪶", "need": ("streak", 10), "bonus": ("charge", 0.2),
     "look": {"color": "#c8b8ff"}, "text": "Wisdom from a 10-answer streak."},
    {"id": "victory-medal", "slot": "charm", "name": "Victory Medal", "icon": "🏅", "need": ("wins", 5), "bonus": ("charge", 0.2),
     "look": {"color": "#ffcf5a"}, "text": "Won with 5 arena victories."},
    {"id": "phoenix-feather", "slot": "charm", "name": "Phoenix Feather", "icon": "🔥", "need": ("level", 15), "bonus": ("charge", 0.3),
     "look": {"color": "#ff6a3d"}, "text": "Rises again: level 15."},
]
BY_ID = {g["id"]: g for g in CATALOG}
DEFAULT = {"weapon": "wooden-sword", "armor": "cloth-tunic", "charm": "no-charm"}
NEED_TEXT = {"level": "Reach level {n}", "wins": "Win {n} arena fights", "streak": "Get {n} answers right in a row"}

_current_student = None


def init(app, current_student):
    global _current_student
    _current_student = current_student
    userdb.add_column("ql_students", "gear", "TEXT")
    userdb.add_column("ql_students", "arena_wins", "INTEGER NOT NULL DEFAULT 0")
    userdb.add_column("ql_students", "all_gear", "INTEGER NOT NULL DEFAULT 0")  # the admin unlocked everything
    app.register_blueprint(bp)


def _profile(row):
    try:
        return json.loads(row["profile"] or "{}")
    except ValueError:
        return {}


def progress(row):
    p = _profile(row)
    return {"level": max(1, int(p.get("level") or row["level"] or 1)),
            "wins": int(row["arena_wins"] or 0) if "arena_wins" in row.keys() else 0,
            "streak": int(p.get("bestStreak") or 0),
            "all": bool(row["all_gear"]) if "all_gear" in row.keys() else False}


def is_unlocked(item, prog):
    kind, n = item["need"]
    return prog.get("all") or prog[kind] >= n


def equipped(row):
    """slot -> item for a student, falling back to the starter item for any
    slot whose saved choice isn't (or is no longer) unlocked."""
    try:
        saved = json.loads(row["gear"] or "{}") if "gear" in row.keys() else {}
    except ValueError:
        saved = {}
    prog = progress(row)
    out = {}
    for slot in SLOTS:
        item = BY_ID.get(saved.get(slot))
        if not item or item["slot"] != slot or not is_unlocked(item, prog):
            item = BY_ID[DEFAULT[slot]]
        out[slot] = item
    return out


def bonuses(row):
    """Arena stat bonuses from equipped gear: {"attack": +x, "hp": +y, "charge": +z}."""
    out = {"attack": 0, "hp": 0, "charge": 0}
    for item in equipped(row).values():
        stat, value = item["bonus"]
        out[stat] += value
    return out


def looks(row):
    """What the fight screen draws: slot -> look (colours and shape)."""
    return {slot: {"id": item["id"], "icon": item["icon"], "name": item["name"], **item["look"]}
            for slot, item in equipped(row).items()}


def _public(item, prog, worn):
    kind, n = item["need"]
    stat, value = item["bonus"]
    return {"id": item["id"], "slot": item["slot"], "name": item["name"], "icon": item["icon"], "text": item["text"],
            "look": item["look"], "unlocked": is_unlocked(item, prog), "equipped": worn,
            "need": NEED_TEXT[kind].format(n=n), "progress": [min(prog[kind], n), n],
            "bonus": {"attack": f"+{value:g} attack", "hp": f"+{value:g} health", "charge": f"+{value:g} special"}[stat] if value else ""}


def _me():
    row = _current_student()
    if not row:
        abort(401, "please log in")
    return row


@bp.route("/api/gear", methods=["GET", "PUT"])
def gear_route():
    """GET: the armory. PUT {slot, item}: equip an unlocked item."""
    me = _me()
    if request.method == "PUT":
        security.rate_limit("gear", 60, 60)
        data = request.get_json(silent=True) or {}
        item = BY_ID.get(str(data.get("item") or ""))
        if not item or item["slot"] != data.get("slot"):
            abort(400, "Unknown item.")
        if not is_unlocked(item, progress(me)):
            abort(403, "You haven't unlocked that yet.")
        worn = {slot: it["id"] for slot, it in equipped(me).items()}
        worn[item["slot"]] = item["id"]
        conn = userdb.connect()
        conn.execute("UPDATE ql_students SET gear=? WHERE id=?", (json.dumps(worn), me["id"]))
        conn.commit()
        conn.close()
        me = _current_student()
    prog = progress(me)
    worn = {slot: it["id"] for slot, it in equipped(me).items()}
    return jsonify({"progress": prog, "equipped": worn, "bonus": bonuses(me),
                    "items": [_public(g, prog, worn[g["slot"]] == g["id"]) for g in CATALOG]})

"""QuestLearn API: serves the question bank in QuestLearn's format and adds
Gemini answer checking, hints/explanations and similar-question generation.

Questions are shown to students as their original screenshots (the extracted
text is unreliable for math), so items carry an image URL and lettered options.

Answer keys come from, in order: a teacher-entered `correct` value, the official
answer-key files (data/answer_keys.json, filled into blank `correct` cells at
startup), then a cached Gemini solution (table ql_keys).
"""
import json
import os
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor

from flask import Blueprint, abort, g, jsonify, request

import db
import practice_sets
import security
import userdb

bp = Blueprint("questlearn", __name__)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LETTERS = "ABCDEF"
TRACKS = [
    {"id": "asp", "name": "ASP", "full": "Advanced Science Program"},
    {"id": "advanced", "name": "Advanced", "full": "Advanced Mathematics"},
    {"id": "general", "name": "General", "full": "General Mathematics"},
]
SAT_TOPICS = {  # DB topic name -> QuestLearn SAT topic id
    "Algebra": "algebra",
    "Advanced math": "advanced",
    "Problem solving": "data",
    "Geometry and Trigonometry": "geometry",
}
# Free-response prompts that need drawing/plotting/tables can't be typed as a
# short answer. They're served only when data/widgets.json gives them an
# interactive widget (table, matching, graph, parts) with its answer key.
NEEDS_WIDGET = re.compile(
    r"\b(graph|plot|sketch|draw|table|match|shade|number line|complete|fill|label|construct|circle the|mark)\w*", re.I)

# Hooks provided by app.py (avoids a circular import).
_gemini = _images = _ai_ready = _is_admin = None


def init(app, gemini, images, ai_ready, is_admin):
    global _gemini, _images, _ai_ready, _is_admin
    _gemini, _images, _ai_ready, _is_admin = gemini, images, ai_ready, is_admin
    conn = db.get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS ql_keys (
            kind TEXT NOT NULL, qid INTEGER NOT NULL,
            answer TEXT, hint TEXT, explanation TEXT, created_at REAL,
            PRIMARY KEY (kind, qid));
        CREATE TABLE IF NOT EXISTS ql_generated (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT, qid TEXT, payload TEXT, created_at REAL);
        CREATE INDEX IF NOT EXISTS ql_generated_qid ON ql_generated (kind, qid);
        CREATE TABLE IF NOT EXISTS ql_checks (
            kind TEXT NOT NULL, qid INTEGER NOT NULL, answer TEXT NOT NULL,
            correct INTEGER, answer_text TEXT, explanation TEXT, created_at REAL,
            PRIMARY KEY (kind, qid, answer));
    """)
    _fill_answer_keys(conn)
    _load_ai_seed(conn)
    _apply_key_fixes(conn)
    conn.commit()
    # Teacher-made data lives in the user database (Neon when DATABASE_URL is set).
    userdb.create_tables("""
        CREATE TABLE IF NOT EXISTS ql_hidden (
            kind TEXT NOT NULL, qid INTEGER NOT NULL, PRIMARY KEY (kind, qid));
        CREATE TABLE IF NOT EXISTS ql_widget_edits (
            qid INTEGER PRIMARY KEY, spec TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ql_custom (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course TEXT NOT NULL, topic TEXT NOT NULL, type TEXT NOT NULL,
            prompt TEXT, image TEXT, options TEXT, answer TEXT, widget TEXT,
            hint TEXT, explanation TEXT, created_at REAL);
        CREATE TABLE IF NOT EXISTS ql_rechecks (
            ref TEXT NOT NULL, answer TEXT NOT NULL, verdict TEXT, created_at REAL,
            PRIMARY KEY (ref, answer));
        CREATE TABLE IF NOT EXISTS ql_answer_edits (
            kind TEXT NOT NULL, qid INTEGER NOT NULL, field TEXT NOT NULL, value TEXT,
            PRIMARY KEY (kind, qid, field));
    """)
    _apply_answer_edits(conn)
    conn.commit()
    conn.close()
    app.register_blueprint(bp)


def _fill_answer_keys(conn):
    """Copy official answer keys into blank `correct` cells (never overwrites)."""
    path = os.path.join(ROOT, "data", "answer_keys.json")
    if not os.path.exists(path):
        return
    keys = json.load(open(path))
    rows = conn.execute(
        "SELECT id, question_image FROM course_questions "
        "WHERE is_mcq=1 AND (correct IS NULL OR correct='') AND question_image IS NOT NULL").fetchall()
    for r in rows:
        m = re.match(r"(\w+?)_t\d+_s([\d.]+)_(\d+)\.png$", os.path.basename(r["question_image"]))
        key = m and keys.get(f"{m.group(1)}_s{m.group(2)}_{m.group(3)}")
        if key:
            conn.execute("UPDATE course_questions SET correct=? WHERE id=?", (key, r["id"]))


ANSWER_FIELDS = ("answer", "answer_text", "hint", "explanation")


def _write_answer_edit(conn, kind, qid, field, value):
    """Apply a teacher's answer edit to the bundled bank (SQLite)."""
    table = "course_questions" if kind == "course" else "questions"
    if field == "answer":
        conn.execute(f"UPDATE {table} SET correct=? WHERE id=?", (value, qid))
        conn.execute("UPDATE ql_keys SET answer=? WHERE kind=? AND qid=?", (value, kind, qid))
    elif field == "answer_text":
        conn.execute("INSERT INTO ql_keys (kind, qid, answer, created_at) VALUES (?,?,?,?) "
                     "ON CONFLICT(kind, qid) DO UPDATE SET answer=excluded.answer", (kind, qid, value, time.time()))
        conn.execute("DELETE FROM ql_checks WHERE kind=? AND qid=?", (kind, qid))  # old verdicts are stale
    else:
        conn.execute(f"UPDATE ql_keys SET {field}=? WHERE kind=? AND qid=?", (value, kind, qid))


def _apply_answer_edits(conn):
    """A deploy brings a fresh copy of the bank: replay the saved answer edits onto it."""
    users = userdb.connect()
    edits = users.execute("SELECT kind, qid, field, value FROM ql_answer_edits").fetchall()
    users.close()
    for e in edits:
        if e["field"] in ANSWER_FIELDS:
            _write_answer_edit(conn, e["kind"], e["qid"], e["field"], e["value"])


def _load_ai_seed(conn):
    """Load pre-computed Gemini solutions (data/ai_seed.json) so a fresh or
    reset database never has to ask Gemini about the bank again."""
    path = os.path.join(ROOT, "data", "ai_seed.json")
    if not os.path.exists(path):
        return
    rows = json.load(open(path))
    conn.executemany(
        "INSERT OR IGNORE INTO ql_keys (kind, qid, answer, hint, explanation, created_at) VALUES (?,?,?,?,?,?)",
        [(r["kind"], r["qid"], r["answer"], r.get("hint"), r.get("explanation"), r.get("at", 0)) for r in rows])


def _apply_key_fixes(conn):
    """Correct stored answers found wrong when the practice sets were written
    (data/key_fixes.json). MCQ fixes set the official letter (several letters
    mark a question with more than one right choice); typed-answer fixes set
    the stored answer. A teacher's own answer edit is replayed afterwards and wins."""
    path = os.path.join(ROOT, "data", "key_fixes.json")
    if not os.path.exists(path):
        return
    raw = json.load(open(path))
    kind = raw["kind"]
    table = "course_questions" if kind == "course" else "questions"
    for f in raw["fixes"]:
        answer = f.get("correct") or f["answer"]
        key = conn.execute("SELECT answer FROM ql_keys WHERE kind=? AND qid=?", (kind, f["qid"])).fetchone()
        if key and key["answer"] == answer:
            continue  # already applied
        if f.get("correct"):
            conn.execute(f"UPDATE {table} SET correct=? WHERE id=?", (f["correct"], f["qid"]))
        conn.execute("INSERT INTO ql_keys (kind, qid, answer, hint, explanation, created_at) VALUES (?,?,?,?,?,?) "
                     "ON CONFLICT(kind, qid) DO UPDATE SET answer=excluded.answer, hint=NULL, "
                     "explanation=excluded.explanation", (kind, f["qid"], answer, None, f.get("explanation"), time.time()))
        conn.execute("DELETE FROM ql_checks WHERE kind=? AND qid=?", (kind, f["qid"]))  # graded against the old key


# --------------------------------------------------------------------- bank
def _option_count(row, letters):
    filled = sum(1 for k in ("option_a", "option_b", "option_c", "option_d", "option_e", "option_f")
                 if k in row.keys() and (row[k] or "").strip())
    top = max((LETTERS.index(l) + 1 for l in letters), default=0)
    return min(6, max(4, filled, top))


def _cached_keys(kind):
    conn = db.get_conn()
    rows = conn.execute("SELECT qid, answer FROM ql_keys WHERE kind=?", (kind,)).fetchall()
    conn.close()
    return {r["qid"]: r["answer"] for r in rows}


def _is_mcq(kind, row):
    return bool(row["is_mcq"]) if kind == "course" else bool((row["option_a"] or "").strip())


_WIDGETS = None


def _widgets():
    """qid -> widget spec for course questions answered with a table, matching,
    graph or several parts (data/widgets.json). Specs carry their own answers."""
    global _WIDGETS
    if _WIDGETS is None:
        path = os.path.join(ROOT, "data", "widgets.json")
        raw = json.load(open(path)) if os.path.exists(path) else {}
        _WIDGETS = {int(k): v for k, v in raw.items() if v.get("widget")}
    return _WIDGETS


def _admin_state():
    """Hidden questions and admin-edited widget specs, read once per request."""
    if "ql_admin" not in g:
        conn = userdb.connect()
        hidden = {(r["kind"], r["qid"]) for r in conn.execute("SELECT kind, qid FROM ql_hidden")}
        edits = {r["qid"]: json.loads(r["spec"]) for r in conn.execute("SELECT qid, spec FROM ql_widget_edits")}
        conn.close()
        g.ql_admin = (hidden, edits)
    return g.ql_admin


def widget_spec(qid):
    """The widget spec for a course question: an admin's edit wins over widgets.json."""
    return _admin_state()[1].get(qid) or _widgets().get(qid)


def _item(kind, row, ai, cached, admin=False):
    """DB row -> QuestLearn question, or None when it can't be played here.
    With admin=True, hidden questions are returned too (flagged `hidden`)."""
    hidden = (kind, row["id"]) in _admin_state()[0]
    if hidden and not admin:
        return None
    item = _build_item(kind, row, ai, cached)
    if item and kind == "course" and practice_sets.for_source(row["id"]):
        item["more"] = True  # "more like this" draws on its practice set, no AI needed
    if item and admin:
        item["hidden"] = hidden
    return item


def _build_item(kind, row, ai, cached):
    spec = widget_spec(row["id"]) if kind == "course" else None
    if spec and spec["widget"] != "none":
        body = {k: v for k, v in spec.items() if k not in ("hint", "explanation")}
        return {"id": f"{kind}-{row['id']}", "ref": f"{kind}:{row['id']}", "type": "widget",
                "image": _image_url(kind, row["id"]), "q": "", "options": [], "answer": None,
                "widget": body, "hint": spec.get("hint"), "explanation": spec.get("explanation"),
                "source": kind}
    if not _is_mcq(kind, row):
        # "none" + answer: checked by hand and a typed short answer fits after all.
        typed_ok = spec and spec.get("answer")
        if kind == "course" and NEEDS_WIDGET.search(row["prompt"] or "") and not typed_ok:
            return None
        if not ai and not _short_answer(cached.get(row["id"])):
            return None  # nothing can grade it
        return {"id": f"{kind}-{row['id']}", "ref": f"{kind}:{row['id']}", "type": "free",
                "image": _image_url(kind, row["id"]), "q": "", "options": [], "answer": None,
                "hint": None, "explanation": None, "source": kind}
    letters = re.findall(r"[A-F]", row["correct"] or "") or re.findall(r"[A-F]", cached.get(row["id"]) or "")
    if len(set(letters)) > 1:
        return None  # "select all that apply" isn't a QuestLearn format
    if not letters and not ai:
        return None  # nothing can grade it
    n = _option_count(row, letters) if kind == "course" else 4
    return {"id": f"{kind}-{row['id']}", "ref": f"{kind}:{row['id']}", "type": "mcq",
            "image": _image_url(kind, row["id"]), "q": "", "options": [""] * n,
            "answer": LETTERS.index(letters[0]) if letters else None,
            "hint": None, "explanation": None, "source": kind}


def _image_url(kind, qid):
    return f"api/course-q-img/{qid}" if kind == "course" else f"api/q-img/{qid}"


def _course_meta(conn):
    out = []
    for c in conn.execute("SELECT * FROM courses ORDER BY grade, branch").fetchall():
        track = c["branch"].lower()
        name = next((t["full"] for t in TRACKS if t["id"] == track), c["branch"])
        out.append({"id": f"c{c['id']}", "dbid": c["id"], "grade": c["grade"], "track": track,
                    "term": c["term"] or 1, "code": c["code"], "title": name})
    return out


def _set_items(rows, admin=False):
    """Practice-set questions written for these curriculum questions. Removing a
    question on the admin page also removes its set."""
    hidden = _admin_state()[0]
    out = []
    for r in rows:
        if ("course", r["id"]) in hidden and not admin:
            continue
        for q in practice_sets.for_source(r["id"]):
            off = ("set", q["id"]) in hidden or ("course", r["id"]) in hidden
            if off and not admin:
                continue
            item = practice_sets.item(q, admin)
            if admin:
                item["hidden"] = off
            out.append(item)
    return out


def _topic_names():
    path = os.path.join(ROOT, "data", "topic_names.json")
    return json.load(open(path)) if os.path.exists(path) else {}


def _course_topics(conn, course_id, code, ai, cached, admin=False, cid=None):
    """Topics of a course, each with its lessons (subtopics such as 1.2) so a
    student can practise one lesson. Every question carries its `lesson` id;
    teacher questions belong to the topic, under a "Teacher questions" lesson."""
    names = _topic_names()
    custom = custom_items(cid, admin) if cid else {}
    topics = []
    for t in conn.execute("SELECT id, topic_no, name FROM course_topics WHERE course_id=? ORDER BY topic_no",
                          (course_id,)).fetchall():
        qs, lessons = [], []
        for s in conn.execute("SELECT id, ref, name FROM course_subtopics WHERE topic_id=? ORDER BY id", (t["id"],)):
            rows = conn.execute("SELECT * FROM course_questions WHERE subtopic_id=? ORDER BY number",
                                (s["id"],)).fetchall()
            items = [i for i in (_item("course", r, ai, cached, admin) for r in rows) if i] + _set_items(rows, admin)
            for i in items:
                i["lesson"] = s["ref"]
            if items:
                lessons.append({"id": s["ref"], "name": s["name"]})
                qs += items
        extra = custom.get(f"t{t['topic_no']}", [])
        for i in extra:
            i["lesson"] = "extra"
        if extra:
            lessons.append({"id": "extra", "ref": "✎", "name": "Teacher questions"})
            qs += extra
        for lesson in lessons:
            mine = [q for q in qs if q["lesson"] == lesson["id"]]
            lesson.update(count=len(mine), mcq=sum(q["type"] != "free" for q in mine))
        if qs or admin:
            name = names.get(f"{code}_t{t['topic_no']}") or t["name"]
            topics.append({"id": f"t{t['topic_no']}", "name": name, "lessons": lessons, "questions": qs})
    return topics


@bp.route("/api/ql/curriculum")
def curriculum_index():
    ai, cached = _ai_ready(), _cached_keys("course")
    conn = db.get_conn()
    courses = []
    for c in _course_meta(conn):
        topics = _course_topics(conn, c.pop("dbid"), c["code"], ai, cached, cid=c["id"])
        c["topics"] = [{"id": t["id"], "name": t["name"], "count": len(t["questions"]), "lessons": t["lessons"],
                        "mcq": sum(q["type"] != "free" for q in t["questions"])} for t in topics]
        if c["topics"]:
            courses.append(c)
    conn.close()
    return jsonify({"tracks": TRACKS, "terms": [1, 2, 3], "grades": [9, 10, 11, 12],
                    "courses": courses, "ai": ai})


@bp.route("/api/ql/course/<cid>")
def curriculum_course(cid):
    conn = db.get_conn()
    meta = next((c for c in _course_meta(conn) if c["id"] == cid), None)
    if not meta:
        conn.close()
        abort(404)
    admin = request.args.get("admin") == "1" and _is_admin()
    meta["topics"] = _course_topics(conn, meta.pop("dbid"), meta["code"], _ai_ready(), _cached_keys("course"),
                                    admin=admin, cid=cid)
    conn.close()
    return jsonify(meta)


# --------------------------------------------------------- teacher questions
def _custom_item(r):
    """A teacher-written question (table ql_custom) in QuestLearn's format."""
    item = {"id": f"custom-{r['id']}", "ref": f"custom:{r['id']}", "type": r["type"], "q": r["prompt"] or "",
            "image": f"api/ql/custom-img/{r['id']}" if r["image"] else None,
            "options": json.loads(r["options"] or "[]"), "answer": None,
            "hint": r["hint"], "explanation": r["explanation"], "source": "teacher"}
    if r["type"] == "mcq":
        item["answer"] = int(r["answer"]) if str(r["answer"] or "").isdigit() else None
    elif r["type"] == "widget":
        item["widget"] = json.loads(r["widget"] or "{}")
    return item


def custom_items(cid, admin=False):
    """topic id -> teacher questions for one course (admins also get typed-answer keys)."""
    conn = userdb.connect()
    rows = conn.execute("SELECT * FROM ql_custom WHERE course=? ORDER BY id", (cid,)).fetchall()
    conn.close()
    out = {}
    for r in rows:
        item = _custom_item(r)
        if admin and r["type"] == "free":
            item["answer_text"] = r["answer"]
        out.setdefault(r["topic"], []).append(item)
    return out


def custom_row(cid):
    conn = userdb.connect()
    row = conn.execute("SELECT * FROM ql_custom WHERE id=?", (cid,)).fetchone()
    conn.close()
    if not row:
        abort(404)
    return row


@bp.route("/api/ql/custom-img/<int:cid>")
def custom_image(cid):
    import base64
    m = re.match(r"data:(image/[\w+.-]+);base64,(.+)$", custom_row(cid)["image"] or "", re.S)
    if not m:
        abort(404)
    return base64.b64decode(m.group(2)), 200, {"Content-Type": m.group(1), "Cache-Control": "public, max-age=86400"}


@bp.route("/api/ql/sat")
def sat_bank():
    """SAT math from the database merged with QuestLearn's original keyed set
    (which also supplies Reading & Writing). Each topic lists its lessons (the
    database's subtopics, plus "Mixed practice" for the original set) and every
    question carries its `lesson` id."""
    bank = json.load(open(os.path.join(ROOT, "frontend", "data", "sat.json")))
    by_id = {t["id"]: t for t in bank["topics"]}
    for t in bank["topics"]:
        for q in t["questions"]:
            q["lesson"] = "mixed"
        t["lessons"] = []
    ai, cached = _ai_ready(), _cached_keys("sat")
    conn = db.get_conn()
    rows = conn.execute(
        """SELECT q.*, t.name AS topic, s.id AS lesson_id, s.name AS lesson_name FROM questions q
           JOIN subtopics s ON s.id=q.subtopic_id JOIN topics t ON t.id=s.topic_id ORDER BY s.id, q.id""").fetchall()
    conn.close()
    for r in rows:
        item = _item("sat", r, ai, cached)
        topic = by_id.get(SAT_TOPICS.get(r["topic"]))
        if item and topic:
            item["lesson"] = f"s{r['lesson_id']}"
            if not any(l["id"] == item["lesson"] for l in topic["lessons"]):
                topic["lessons"].append({"id": item["lesson"], "name": r["lesson_name"].replace("&", " & ")})
            topic["questions"].append(item)
    for t in bank["topics"]:
        if any(q["lesson"] == "mixed" for q in t["questions"]):
            t["lessons"].append({"id": "mixed", "name": "Mixed practice"})
        for n, lesson in enumerate(t["lessons"], 1):
            lesson["ref"] = "★" if lesson["id"] == "mixed" else str(n)
            mine = [q for q in t["questions"] if q["lesson"] == lesson["id"]]
            lesson.update(count=len(mine), mcq=sum(q.get("type", "mcq") != "free" for q in mine))
    bank["ai"] = ai
    return jsonify(bank)


@bp.route("/api/ql/status")
def status():
    return jsonify({"ai": _ai_ready()})


# ----------------------------------------------------------------- answers
def _parse_ref(ref):
    m = re.fullmatch(r"(course|sat|custom|set):(\d+)", str(ref or ""))
    if not m:
        abort(400)
    return m.group(1), int(m.group(2))


def _set_q(qid):
    q = practice_sets.get(qid)
    if not q:
        abort(404)
    return q


def _row(kind, qid):
    conn = db.get_conn()
    table = "course_questions" if kind == "course" else "questions"
    row = conn.execute(f"SELECT * FROM {table} WHERE id=?", (qid,)).fetchone()
    conn.close()
    if not row:
        abort(404)
    return row


def _text_block(row):
    """The (often garbled) extracted text, as a secondary clue next to the image."""
    opts = [row[k] for k in ("option_a", "option_b", "option_c", "option_d") if row[k]]
    text = f"Extracted text (may be garbled; trust the image): {row['prompt'] or ''}"
    if opts:
        text += "\nExtracted options: " + " | ".join(f"{LETTERS[i]}) {o}" for i, o in enumerate(opts))
    return text


STYLE = ("Write for a high-school student, in plain text with Unicode math (x², √, π, ≤, ½), "
         "never LaTeX or markdown.")


def solve(kind, qid):
    """Answer letter (MCQ), hint and explanation for a question, cached forever.
    Returns {} when nothing is known and Gemini is unavailable."""
    conn = db.get_conn()
    hit = conn.execute("SELECT * FROM ql_keys WHERE kind=? AND qid=?", (kind, qid)).fetchone()
    conn.close()
    row = _row(kind, qid)
    is_mcq = _is_mcq(kind, row)
    key = (re.findall(r"[A-F]", row["correct"] or "") or [None])[0]
    if hit and (hit["explanation"] or not _ai_ready()):
        return {"answer": key or hit["answer"], "hint": hit["hint"], "explanation": hit["explanation"]}
    if not _ai_ready():
        return {"answer": key} if key else {}
    n = _option_count(row, [key] if key else []) if kind == "course" else 4
    if is_mcq:
        known = f"The official answer is {key}; explain why it is correct.\n" if key else ""
        prompt = (f"Solve the multiple-choice math question in the image. Its options are labelled "
                  f"A to {LETTERS[n - 1]}.\n{known}{_text_block(row)}\n{STYLE}\n"
                  'Return ONLY JSON: {"answer": "<letter>", "hint": "one sentence that helps without '
                  'giving the answer away", "explanation": "short step-by-step solution"}')
    else:
        prompt = (f"Solve the math question in the image (a short-answer question).\n{_text_block(row)}\n{STYLE}\n"
                  'Return ONLY JSON: {"answer": "the final answer", "hint": "one sentence that helps without '
                  'giving the answer away", "explanation": "short step-by-step solution"}')
    out = _gemini(prompt, timeout=45, images=_images(kind, qid))
    if not isinstance(out, dict):
        return {"answer": key} if key else {}
    answer = str(out.get("answer") or "").strip()
    if is_mcq:
        answer = key or (answer[:1].upper() if answer[:1].upper() in LETTERS[:n] else None)
    result = {"answer": answer or None, "hint": out.get("hint"), "explanation": out.get("explanation")}
    if result["answer"]:
        conn = db.get_conn()
        conn.execute("INSERT OR REPLACE INTO ql_keys VALUES (?,?,?,?,?,?)",
                     (kind, qid, result["answer"], result["hint"], result["explanation"], time.time()))
        conn.commit()
        conn.close()
    return result


def _short_answer(answer):
    """A stored free-response answer simple enough to compare typed answers against."""
    return bool(answer) and len(answer) <= 40 and not re.search(
        r"[;\n]|\b[a-d]\)|\([a-d]\)|,\s*\w+\s*=|\b(and|or)\b", answer)


_SUPERS = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")


def _norm(text):
    """Same canonical form as normalize() in frontend/js/widgets.js."""
    t = str(text or "").lower()
    t = re.sub(r"[−–—]", "-", t)
    t = re.sub(r"[×·]", "*", t)
    t = re.sub(r"[⁰¹²³⁴⁵⁶⁷⁸⁹]+", lambda m: "^" + m.group(0).translate(_SUPERS), t)
    t = re.sub(r"\s+", "", t)
    t = t.replace("sqrt", "√").replace("cbrt", "∛").replace("theta", "θ")
    t = re.sub(r"(^|[^a-z])pi(?![a-z])", r"\1π", t)
    t = re.sub(r"(^|[^a-z])inf(inity)?(?![a-z])", r"\1∞", t)
    t = t.replace("<=", "≤").replace(">=", "≥")
    t = re.sub(r"!=|=/=", "≠", t)
    t = re.sub(r"\+/?-", "±", t)
    t = re.sub(r"°|degrees?$", "", t)
    t = re.sub(r"([√∛])\(([\w.π]+)\)", r"\1\2", t)  # √(3) ≡ √3
    t = re.sub(r"\^\((-?[\w.]+)\)", r"^\1", t)  # x^(2) ≡ x^2
    t = re.sub(r"([\w.)π])\*(?=[a-zπθ√∛(])", r"\1", t)  # 2*√3 ≡ 2√3
    t = re.sub(r"^([a-zθ]|f\([a-z]\)|y)=(?=.)", "", t)
    return re.sub(r"\.$", "", t)


_ABOUT = re.compile(r"^(?:[a-z]?≈|~|approximately|approx\.?|about|aed)")
_UNIT = re.compile(r"(?<=[\d.])(?:sq\.?)?(?:ft|feet|foot|in|inches|km|kilometers?|kilometres?|m|meters?|metres?|cm|"
                   r"centimeters?|mm|ml|l|pa|pascals?|miles?|mi|units?|aed|dirhams?|kg|g|seconds?|sec|s|minutes?|min|"
                   r"hours?|h)(?:\^[23])?$")


def _number(text):
    """A typed answer as a number, ignoring "≈", a currency and a trailing unit."""
    t = _norm(text).replace(",", "").replace("$", "")
    t = _UNIT.sub("", _ABOUT.sub("", t))
    m = re.match(r"^(-?)(\d+)\s+(\d+)/(\d+)$", re.sub(r"[−–]", "-", str(text or "").strip()))
    if m:
        return (-1 if m.group(1) else 1) * (int(m.group(2)) + int(m.group(3)) / int(m.group(4)))
    try:
        if re.fullmatch(r"-?\d*\.?\d+/-?\d*\.?\d+", t):
            a, b = t.split("/")
            return float(a) / float(b)
        if t.endswith("%"):
            return float(t[:-1]) / 100
        return float(t) if re.fullmatch(r"-?\d*\.?\d+", t) else None
    except (ValueError, ZeroDivisionError):
        return None


def same_answer(given, expected):
    """True when a typed answer means the same as the stored one."""
    a, b = _number(given), _number(expected)
    if a is not None and b is not None:
        return abs(a - b) <= 1e-6 * max(1, abs(b))
    return _norm(given) != "" and _norm(given) == _norm(expected)


def _letter_index(answer):
    return LETTERS.index(answer) if answer and answer in LETTERS else None


@bp.route("/api/ql/solve", methods=["POST"])
def solve_route():
    """Hint + explanation (and the key for MCQ, used by the Sage's skill)."""
    security.ai_guard("ql-solve", 200, 10 * 60)
    kind, qid = _parse_ref((request.get_json(silent=True) or {}).get("ref"))
    if kind == "set":
        q = _set_q(qid)
        return jsonify({"ai": _ai_ready(), "hint": q.get("hint"), "explanation": q.get("explanation"),
                        "answer": q["answer"] if q["type"] == "mcq" else None})
    if kind == "custom":
        r = custom_row(qid)
        return jsonify({"ai": _ai_ready(), "hint": r["hint"], "explanation": r["explanation"],
                        "answer": int(r["answer"]) if r["type"] == "mcq" and str(r["answer"]).isdigit() else None})
    s = solve(kind, qid)
    mcq = _is_mcq(kind, _row(kind, qid))
    return jsonify({"ai": _ai_ready(), "hint": s.get("hint"), "explanation": s.get("explanation"),
                    "answer": _letter_index(s.get("answer")) if mcq else None})


@bp.route("/api/ql/check", methods=["POST"])
def check_route():
    """Grade one answer. MCQ: {ref, choice: index}. Free response: {ref, text}."""
    security.ai_guard("ql-check", 400, 10 * 60)
    data = request.get_json(silent=True) or {}
    kind, qid = _parse_ref(data.get("ref"))
    if kind == "set":  # practice sets carry their own key
        q = _set_q(qid)
        if q["type"] == "mcq":
            return jsonify({"ai": _ai_ready(), "answer": q["answer"], "explanation": q.get("explanation"),
                            "hint": q.get("hint"), "correct": data.get("choice") == q["answer"]})
        keys = practice_sets.keys(q) if q["type"] == "free" else []
        return jsonify({"ai": _ai_ready(), "correct": any(same_answer(data.get("text"), k) for k in keys),
                        "answer_text": keys[0] if keys else None, "explanation": q.get("explanation"), "saved": True})
    if kind == "custom":  # teacher questions carry their own key
        r = custom_row(qid)
        if "text" not in data:
            answer = int(r["answer"]) if str(r["answer"] or "").isdigit() else None
            return jsonify({"ai": _ai_ready(), "answer": answer, "explanation": r["explanation"],
                            "correct": None if answer is None else data.get("choice") == answer})
        keys = [a for a in (r["answer"] or "").split("|") if a.strip()]
        return jsonify({"ai": _ai_ready(), "correct": any(same_answer(data.get("text"), k) for k in keys),
                        "answer_text": keys[0] if keys else None, "explanation": r["explanation"], "saved": True})
    if "text" not in data:
        s = solve(kind, qid)
        answer = _letter_index(s.get("answer"))
        return jsonify({"ai": _ai_ready(), "answer": answer, "explanation": s.get("explanation"),
                        "hint": s.get("hint"),
                        "correct": None if answer is None else data.get("choice") == answer})
    text = str(data.get("text") or "").strip()[:300]
    # Same typed answer to the same question -> reuse Gemini's earlier verdict.
    norm = re.sub(r"\s+", "", text).lower()
    conn = db.get_conn()
    hit = conn.execute("SELECT * FROM ql_checks WHERE kind=? AND qid=? AND answer=?", (kind, qid, norm)).fetchone()
    conn.close()
    if hit:
        return jsonify({"ai": _ai_ready(), "correct": bool(hit["correct"]), "answer_text": hit["answer_text"],
                        "explanation": hit["explanation"], "saved": True})
    s = solve(kind, qid)
    # A stored answer settles matching answers (and, without Gemini, wrong ones) with no AI call.
    if s.get("answer") and (same_answer(text, s["answer"]) or (not _ai_ready() and _short_answer(s["answer"]))):
        return jsonify({"ai": _ai_ready(), "correct": same_answer(text, s["answer"]), "answer_text": s["answer"],
                        "explanation": s.get("explanation"), "saved": True})
    if not _ai_ready():
        return jsonify({"ai": False, "correct": None, "explanation": "Answer checking needs Gemini to be switched on."})
    prompt = (f"Grade a student's answer to the math question in the image. Accept mathematically "
              f"equivalent forms (fractions vs decimals, rearranged expressions, missing units).\n"
              f"{_text_block(_row(kind, qid))}\nReference answer (may be wrong; check it): {s.get('answer') or 'unknown'}\n"
              f"Student answer: {text}\n{STYLE}\n"
              'Return ONLY JSON: {"correct": true|false, "answer": "the correct final answer", '
              '"explanation": "two or three sentences: what is right or wrong and the key step"}')
    out = _gemini(prompt, timeout=45, images=_images(kind, qid))
    if not isinstance(out, dict) or not isinstance(out.get("correct"), bool):
        return jsonify({"ai": True, "correct": None, "explanation": "Gemini couldn't check this one. Try again."})
    result = {"ai": True, "correct": out["correct"], "answer_text": out.get("answer") or s.get("answer"),
              "explanation": out.get("explanation") or s.get("explanation")}
    conn = db.get_conn()
    conn.execute("INSERT OR REPLACE INTO ql_checks VALUES (?,?,?,?,?,?,?)",
                 (kind, qid, norm, int(result["correct"]), result["answer_text"], result["explanation"], time.time()))
    conn.commit()
    conn.close()
    return jsonify(result)


def _set_key(qid):
    q = practice_sets.get(qid)
    return q["answer"] if q and q["type"] == "mcq" else None


@bp.route("/api/ql/keys", methods=["POST"])
def keys_route():
    """Answer keys for a finished quiz/simulator: {refs: [...]} -> {keys: {ref: index|null}}."""
    security.ai_guard("ql-keys", 40, 10 * 60)
    refs = [r for r in ((request.get_json(silent=True) or {}).get("refs") or [])][:120]
    parsed = [(r, _parse_ref(r)) for r in refs]
    with ThreadPoolExecutor(max_workers=6) as pool:
        answers = list(pool.map(lambda p: _set_key(p[1][1]) if p[1][0] == "set"
                                else _letter_index(solve(*p[1]).get("answer")), parsed))
    return jsonify({"ai": _ai_ready(), "keys": {r: a for (r, _), a in zip(parsed, answers)}})


# ----------------------------------------------------------- similar items
def _saved_similar(tag):
    conn = db.get_conn()
    rows = conn.execute("SELECT id, payload FROM ql_generated WHERE kind='similar' AND qid=?", (tag,)).fetchall()
    conn.close()
    return [{**json.loads(r["payload"]), "id": f"ai-{r['id']}"} for r in rows]


@bp.route("/api/ql/similar", methods=["POST"])
def similar_route():
    """Generate new practice questions like the given one.
    Body: {ref} for a bank question, or {question: {q, options, answer}} for a text one."""
    security.ai_guard("ql-similar", 30, 10 * 60)
    data = request.get_json(silent=True) or {}
    n = max(1, min(int(data.get("n") or 3), 5))
    q = data.get("question") or {}
    tag = data.get("ref") or str(q.get("id") or "text")
    ref = re.fullmatch(r"(course|set):(\d+)", str(data.get("ref") or ""))
    src = (int(ref.group(2)) if ref.group(1) == "course" else (practice_sets.get(int(ref.group(2))) or {}).get("src")) if ref else None
    hidden = _admin_state()[0]
    written = [practice_sets.item(s) for s in practice_sets.for_source(src)
               if ("set", s["id"]) not in hidden and s["id"] != (int(ref.group(2)) if ref.group(1) == "set" else None)]
    if ref and ref.group(1) == "set" and not written:
        return jsonify({"ai": _ai_ready(), "questions": []})
    if written:  # questions written for this one ahead of time: no AI call
        return jsonify({"ai": _ai_ready(), "questions": random.sample(written, min(n, len(written))), "saved": True})
    # Questions already written for this one are reused instead of asking Gemini again.
    saved = _saved_similar(tag)
    if len(saved) >= n:
        return jsonify({"ai": _ai_ready(), "questions": random.sample(saved, n), "saved": True})
    if not _ai_ready():
        return jsonify({"ai": False, "questions": saved})
    if data.get("ref"):
        kind, qid = _parse_ref(data["ref"])
        source, images = "the question in the image\n" + _text_block(_row(kind, qid)), _images(kind, qid)
    else:
        opts = q.get("options") or []
        source = f"this question:\n{q.get('q', '')}\n" + "\n".join(f"{LETTERS[i]}) {o}" for i, o in enumerate(opts[:6]))
        images = []
    prompt = (f"Write {n} new multiple-choice practice questions that test the same skill as {source}\n"
              "Change the numbers and context, keep the difficulty. Each must be fully self-contained "
              "text (no figures), have exactly 4 distinct options and exactly one correct option. "
              f"Solve each one yourself to make sure the key is right.\n{STYLE}\n"
              'Return ONLY a JSON array: [{"q": "...", "options": ["...", "...", "...", "..."], '
              '"answer": <index 0-3 of the correct option>, "hint": "one sentence", '
              '"explanation": "short step-by-step solution"}]')
    out = _gemini(prompt, timeout=60, images=images)
    if isinstance(out, dict):
        out = out.get("questions") or []
    clean = []
    for i, g in enumerate(out if isinstance(out, list) else []):
        opts = [str(o).strip() for o in (g.get("options") or [])] if isinstance(g, dict) else []
        ans = g.get("answer") if isinstance(g, dict) else None
        if len(opts) != 4 or len(set(opts)) != 4 or not isinstance(ans, int) or not 0 <= ans < 4 or not g.get("q"):
            continue
        clean.append({"q": str(g["q"]).strip(), "options": opts, "answer": ans,
                      "hint": g.get("hint") or "", "explanation": g.get("explanation") or "",
                      "type": "mcq", "source": "ai"})
    if clean:
        conn = db.get_conn()
        cur = conn.cursor()
        for g in clean:
            cur.execute("INSERT INTO ql_generated (kind, qid, payload, created_at) VALUES (?,?,?,?)",
                        ("similar", tag, json.dumps(g), time.time()))
            g["id"] = f"ai-{cur.lastrowid}"
        conn.commit()
        conn.close()
    return jsonify({"ai": True, "questions": clean})


# -------------------------------------------------------------- AI recheck
def recheck(ref, answer, argument):
    """A student disputes their grade: ask AI to look again at their answer
    (with their reasoning). The verdict is saved per (question, answer)."""
    kind, qid = _parse_ref(ref)
    norm = re.sub(r"\s+", "", str(answer)).lower()[:300]
    conn = userdb.connect()
    hit = conn.execute("SELECT verdict FROM ql_rechecks WHERE ref=? AND answer=?", (ref, norm)).fetchone()
    conn.close()
    if hit:
        return {**json.loads(hit["verdict"]), "saved": True}
    if not _ai_ready():
        return {"ai": False, "correct": None,
                "explanation": "AI checking is switched off right now, so your teacher will review this."}
    if kind == "set":
        q = _set_q(qid)
        source = (f"Question: {q['q']}\nOptions: {q.get('options') or 'none'}\n"
                  f"Answer key: {practice_sets.answer_text(q)}")
        images = []
    elif kind == "custom":
        r = custom_row(qid)
        source = (f"Question: {r['prompt']}\nOptions: {r['options'] or 'none'}\n"
                  f"Answer key (0-based option index or text): {r['answer'] or r['widget']}")
        images = []
    else:
        row = _row(kind, qid)
        key = solve(kind, qid).get("answer") if kind == "sat" or _is_mcq(kind, row) else (
            widget_spec(qid) or solve(kind, qid).get("answer"))
        source = f"The question is in the image.\n{_text_block(row)}\nCurrent answer key (may be wrong): {key}"
        images = _images(kind, qid)
    prompt = (f"A student thinks their answer to this math question was marked wrong unfairly. Solve the "
              f"question yourself, carefully, then judge the student's answer. Accept equivalent forms.\n{source}\n"
              f"Student's answer: {answer}\nStudent's note: {argument or '(none)'}\n{STYLE}\n"
              'Return ONLY JSON: {"correct": true|false, "answer": "the correct answer", '
              '"key_wrong": true|false (is the current answer key wrong?), '
              '"explanation": "for the student, in 3 to 5 short sentences: how to solve it step by step and, '
              'if their answer is wrong, where it went wrong"}')
    out = _gemini(prompt, timeout=60, images=images)
    if not isinstance(out, dict) or not isinstance(out.get("correct"), bool):
        return {"ai": True, "correct": None, "explanation": "AI couldn't check this one, so your teacher will review it."}
    verdict = {"ai": True, "correct": out["correct"], "answer": out.get("answer"),
               "key_wrong": bool(out.get("key_wrong")), "explanation": out.get("explanation")}
    conn = userdb.connect()
    conn.execute("INSERT INTO ql_rechecks VALUES (?,?,?,?) ON CONFLICT (ref, answer) DO UPDATE SET "
                 "verdict=excluded.verdict, created_at=excluded.created_at", (ref, norm, json.dumps(verdict), time.time()))
    conn.commit()
    conn.close()
    return verdict


# ------------------------------------------------------------ admin editing
def _require_admin():
    if not _is_admin():
        abort(401, "admin login required")


@bp.route("/api/admin/ql/item/<ref>", methods=["GET", "PUT", "DELETE"])
def admin_item(ref):
    """Read, fix the answer of, or remove (hide) one bank question.
    PUT body: {answer: "B"} (MCQ), {answer_text: "..."} (typed answer),
    {widget: spec} (table/matching/graph/parts), plus optional hint/explanation.
    DELETE hides it from students; PUT {restore: true} brings it back."""
    _require_admin()
    kind, qid = _parse_ref(ref.replace("-", ":"))
    if kind == "custom":
        abort(400, "use /api/admin/ql/custom")
    if kind == "set":
        return _admin_set_item(qid)
    _row(kind, qid)  # 404 for an unknown question
    users = userdb.connect()
    if request.method == "DELETE":
        users.execute("INSERT INTO ql_hidden VALUES (?,?) ON CONFLICT DO NOTHING", (kind, qid))
    elif request.method == "PUT":
        data = request.get_json(silent=True) or {}
        if data.get("restore"):
            users.execute("DELETE FROM ql_hidden WHERE kind=? AND qid=?", (kind, qid))
        edits = {}
        if data.get("answer"):
            edits["answer"] = str(data["answer"]).strip().upper()[:1]
            if edits["answer"] not in LETTERS:
                users.close()
                abort(400, "answer must be a letter A-F")
        if data.get("answer_text"):
            edits["answer_text"] = str(data["answer_text"]).strip()[:300]
        if isinstance(data.get("widget"), dict) and kind == "course":
            spec = data["widget"]
            if spec.get("widget") not in ("table", "matching", "graph", "parts", "multi"):
                users.close()
                abort(400, "unknown widget type")
            users.execute("INSERT INTO ql_widget_edits VALUES (?,?) ON CONFLICT (qid) DO UPDATE SET spec=excluded.spec",
                          (qid, json.dumps(spec)))
        for field in ("hint", "explanation"):
            if field in data:
                edits[field] = data[field] or None
        # Saved in the user database (so they outlive a deploy), then applied to the bank.
        for field, value in edits.items():
            users.execute("INSERT INTO ql_answer_edits VALUES (?,?,?,?) ON CONFLICT (kind, qid, field) "
                          "DO UPDATE SET value=excluded.value", (kind, qid, field, value))
        users.execute("DELETE FROM ql_rechecks WHERE ref=?", (f"{kind}:{qid}",))
        users.commit()  # before touching the bank: without Postgres both are the same SQLite file
        bank = db.get_conn()
        for field, value in edits.items():
            _write_answer_edit(bank, kind, qid, field, value)
        bank.commit()
        bank.close()
    users.commit()
    hidden = users.execute("SELECT 1 FROM ql_hidden WHERE kind=? AND qid=?", (kind, qid)).fetchone() is not None
    users.close()
    conn = db.get_conn()
    key = conn.execute("SELECT * FROM ql_keys WHERE kind=? AND qid=?", (kind, qid)).fetchone()
    conn.close()
    g.pop("ql_admin", None)
    row = _row(kind, qid)
    mcq = _is_mcq(kind, row)
    return jsonify({"ref": f"{kind}:{qid}", "image": _image_url(kind, qid), "hidden": hidden,
                    "type": "widget" if kind == "course" and (widget_spec(qid) or {}).get("widget", "none") != "none"
                    else "mcq" if mcq else "free",
                    "answer": (re.findall(r"[A-F]", row["correct"] or "") or [None])[0] or (key["answer"] if key else None),
                    "options": _option_count(row, []) if kind == "course" else 4,
                    "widget": widget_spec(qid) if kind == "course" else None,
                    "hint": key["hint"] if key else None, "explanation": key["explanation"] if key else None})


def _admin_set_item(qid):
    """Practice-set questions can be removed and restored, not edited."""
    q = _set_q(qid)
    users = userdb.connect()
    if request.method == "DELETE":
        users.execute("INSERT INTO ql_hidden VALUES (?,?) ON CONFLICT DO NOTHING", ("set", qid))
    elif request.method == "PUT":
        if not (request.get_json(silent=True) or {}).get("restore"):
            users.close()
            abort(400, "practice-set questions can only be removed or restored")
        users.execute("DELETE FROM ql_hidden WHERE kind=? AND qid=?", ("set", qid))
    users.commit()
    hidden = users.execute("SELECT 1 FROM ql_hidden WHERE kind=? AND qid=?", ("set", qid)).fetchone() is not None
    users.close()
    g.pop("ql_admin", None)
    return jsonify({**practice_sets.item(q, admin=True), "hidden": hidden})


QUESTION_TYPES = ("mcq", "free", "widget")


def _custom_fields(data):
    qtype = data.get("type")
    if qtype not in QUESTION_TYPES:
        abort(400, "type must be mcq, free or widget")
    prompt = str(data.get("prompt") or "").strip()[:4000]
    image = data.get("image") or None
    if image and (not re.match(r"data:image/[\w+.-]+;base64,", image) or len(image) > 3_000_000):
        abort(400, "the picture must be an image under 2 MB")
    if not prompt and not image:
        abort(400, "write the question or add a picture")
    options, answer, widget = [], None, None
    if qtype == "mcq":
        options = [str(o).strip()[:500] for o in data.get("options") or [] if str(o).strip()][:6]
        if len(options) < 2:
            abort(400, "add at least two options")
        try:
            answer = int(data.get("answer"))
            assert 0 <= answer < len(options)
        except (TypeError, ValueError, AssertionError):
            abort(400, "choose the correct option")
        answer = str(answer)
    elif qtype == "free":
        answer = "|".join(a.strip() for a in str(data.get("answer") or "").split("|") if a.strip())[:500]
        if not answer:
            abort(400, "write the correct answer")
    else:
        widget = data.get("widget")
        if not isinstance(widget, dict) or widget.get("widget") not in ("table", "matching", "graph", "parts", "multi"):
            abort(400, "set up the table, matching, graph or parts answer")
        widget = json.dumps(widget)
    return (qtype, prompt, image, json.dumps(options), answer, widget,
            str(data.get("hint") or "").strip()[:500] or None, str(data.get("explanation") or "").strip()[:2000] or None)


@bp.route("/api/admin/ql/custom", methods=["POST"])
def admin_custom_create():
    """Add a teacher question to a course topic: {course: "c227", topic: "t1", type, prompt,
    image (data URL), options + answer (index) | answer (text, "|" between accepted forms) | widget}."""
    _require_admin()
    data = request.get_json(silent=True) or {}
    course, topic = str(data.get("course") or ""), str(data.get("topic") or "")
    if not re.fullmatch(r"c\d+", course) or not re.fullmatch(r"t\d+", topic):
        abort(400, "choose a course and topic")
    conn = userdb.connect()
    new_id = userdb.insert(conn, "INSERT INTO ql_custom (course, topic, type, prompt, image, options, answer, widget, hint, "
                       "explanation, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                       (course, topic, *_custom_fields(data), time.time()))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "item": _custom_item(custom_row(new_id))})


@bp.route("/api/admin/ql/custom/<int:cid>", methods=["GET", "PUT", "DELETE"])
def admin_custom(cid):
    _require_admin()
    row = custom_row(cid)
    conn = userdb.connect()
    if request.method == "DELETE":
        conn.execute("DELETE FROM ql_custom WHERE id=?", (cid,))
        conn.commit()
        conn.close()
        return jsonify({"ok": True})
    if request.method == "PUT":
        data = {**dict(row), "options": json.loads(row["options"] or "[]"),
                "widget": json.loads(row["widget"] or "null"), **(request.get_json(silent=True) or {})}
        conn.execute("UPDATE ql_custom SET type=?, prompt=?, image=?, options=?, answer=?, widget=?, hint=?, "
                     "explanation=? WHERE id=?", (*_custom_fields(data), cid))
        conn.execute("DELETE FROM ql_rechecks WHERE ref=?", (f"custom:{cid}",))
        conn.commit()
        row = custom_row(cid)
    conn.close()
    item = _custom_item(row)
    item["answer_text"] = row["answer"] if row["type"] == "free" else None
    return jsonify({"ok": True, "item": item})

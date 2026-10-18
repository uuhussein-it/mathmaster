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

from flask import Blueprint, abort, jsonify, request

import db

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
# short answer; they stay in the classic site's interactive widgets.
NEEDS_WIDGET = re.compile(
    r"\b(graph|plot|sketch|draw|table|match|shade|number line|complete|fill|label|construct|circle the|mark)\w*", re.I)

# Hooks provided by app.py (avoids a circular import).
_gemini = _images = _ai_ready = None


def init(app, gemini, images, ai_ready):
    global _gemini, _images, _ai_ready
    _gemini, _images, _ai_ready = gemini, images, ai_ready
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


def _item(kind, row, ai, cached):
    """DB row -> QuestLearn question, or None when it can't be played here."""
    if not _is_mcq(kind, row):
        if not ai or (kind == "course" and NEEDS_WIDGET.search(row["prompt"] or "")):
            return None
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


def _topic_names():
    path = os.path.join(ROOT, "data", "topic_names.json")
    return json.load(open(path)) if os.path.exists(path) else {}


def _course_topics(conn, course_id, code, ai, cached):
    names = _topic_names()
    topics = []
    for t in conn.execute("SELECT id, topic_no, name FROM course_topics WHERE course_id=? ORDER BY topic_no",
                          (course_id,)).fetchall():
        rows = conn.execute(
            """SELECT q.* FROM course_questions q JOIN course_subtopics s ON s.id=q.subtopic_id
               WHERE s.topic_id=? ORDER BY s.ref, q.number""", (t["id"],)).fetchall()
        qs = [i for i in (_item("course", r, ai, cached) for r in rows) if i]
        if qs:
            name = names.get(f"{code}_t{t['topic_no']}") or t["name"]
            topics.append({"id": f"t{t['topic_no']}", "name": name, "questions": qs})
    return topics


@bp.route("/api/ql/curriculum")
def curriculum_index():
    ai, cached = _ai_ready(), _cached_keys("course")
    conn = db.get_conn()
    courses = []
    for c in _course_meta(conn):
        topics = _course_topics(conn, c.pop("dbid"), c["code"], ai, cached)
        c["topics"] = [{"id": t["id"], "name": t["name"], "count": len(t["questions"]),
                        "mcq": sum(q["type"] == "mcq" for q in t["questions"])} for t in topics]
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
    meta["topics"] = _course_topics(conn, meta.pop("dbid"), meta["code"], _ai_ready(), _cached_keys("course"))
    conn.close()
    return jsonify(meta)


@bp.route("/api/ql/sat")
def sat_bank():
    """SAT math from the database merged with QuestLearn's original keyed set
    (which also supplies Reading & Writing)."""
    bank = json.load(open(os.path.join(ROOT, "frontend", "data", "sat.json")))
    by_id = {t["id"]: t for t in bank["topics"]}
    ai, cached = _ai_ready(), _cached_keys("sat")
    conn = db.get_conn()
    rows = conn.execute(
        """SELECT q.*, t.name AS topic FROM questions q JOIN subtopics s ON s.id=q.subtopic_id
           JOIN topics t ON t.id=s.topic_id ORDER BY q.id""").fetchall()
    conn.close()
    for r in rows:
        item = _item("sat", r, ai, cached)
        topic = by_id.get(SAT_TOPICS.get(r["topic"]))
        if item and topic:
            topic["questions"].append(item)
    bank["ai"] = ai
    return jsonify(bank)


@bp.route("/api/ql/status")
def status():
    return jsonify({"ai": _ai_ready()})


# ----------------------------------------------------------------- answers
def _parse_ref(ref):
    m = re.fullmatch(r"(course|sat):(\d+)", str(ref or ""))
    if not m:
        abort(400)
    return m.group(1), int(m.group(2))


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


def _letter_index(answer):
    return LETTERS.index(answer) if answer and answer in LETTERS else None


@bp.route("/api/ql/solve", methods=["POST"])
def solve_route():
    """Hint + explanation (and the key for MCQ, used by the Sage's skill)."""
    kind, qid = _parse_ref((request.get_json(silent=True) or {}).get("ref"))
    s = solve(kind, qid)
    mcq = _is_mcq(kind, _row(kind, qid))
    return jsonify({"ai": _ai_ready(), "hint": s.get("hint"), "explanation": s.get("explanation"),
                    "answer": _letter_index(s.get("answer")) if mcq else None})


@bp.route("/api/ql/check", methods=["POST"])
def check_route():
    """Grade one answer. MCQ: {ref, choice: index}. Free response: {ref, text}."""
    data = request.get_json(silent=True) or {}
    kind, qid = _parse_ref(data.get("ref"))
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
    if not _ai_ready():
        return jsonify({"ai": False, "correct": None, "explanation": "Answer checking needs Gemini to be switched on."})
    s = solve(kind, qid)
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


@bp.route("/api/ql/keys", methods=["POST"])
def keys_route():
    """Answer keys for a finished quiz/simulator: {refs: [...]} -> {keys: {ref: index|null}}."""
    refs = [r for r in ((request.get_json(silent=True) or {}).get("refs") or [])][:120]
    parsed = [(r, _parse_ref(r)) for r in refs]
    with ThreadPoolExecutor(max_workers=6) as pool:
        answers = list(pool.map(lambda p: _letter_index(solve(*p[1]).get("answer")), parsed))
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
    data = request.get_json(silent=True) or {}
    n = max(1, min(int(data.get("n") or 3), 5))
    q = data.get("question") or {}
    tag = data.get("ref") or str(q.get("id") or "text")
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

import os
import random
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db

from flask import Flask, jsonify, request, send_from_directory, abort

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, "frontend")
OPTION_IMG_DIR = os.path.join(ROOT, "data", "option_imgs")
Q_IMG_DIR = os.path.join(ROOT, "data", "question_imgs")

app = Flask(__name__, static_folder=FRONTEND, static_url_path="")

MODULE1_SIZE = 22
MODULE2_SIZE = 22
MODULE1_MIN = 35
MODULE2_MIN = 35
ROUTE_THRESHOLD = 0.6  # fraction correct to route into the harder module 2


def option_image_slug(name):
    import re
    return re.sub(r"[^A-Za-z]", "", name)


def question_image_sql():
    """qid -> question-screenshot filename (built once)."""
    cache = getattr(question_image_sql, "_cache", None)
    if cache is not None:
        return cache
    conn = db.get_conn()
    rows = conn.execute(
        """SELECT q.id AS id, s.name AS sub, q.number AS number, q.id AS qid FROM questions q
           JOIN subtopics s ON s.id=q.subtopic_id"""
    ).fetchall()
    conn.close()
    out = {}
    for r in rows:
        name = os.path.join(Q_IMG_DIR, f"{option_image_slug(r['sub'])}_{r['number']}.png")
        if os.path.exists(name):
            out[r["id"]] = f"/api/q-img/{r['id']}"
    question_image_sql._cache = out
    return out


def _opt_img_map():
    """{qid: (subtopicslug, number)} for every question (built once)."""
    cache = getattr(_opt_img_map, "_cache", None)
    if cache is not None:
        return cache
    conn = db.get_conn()
    rows = conn.execute(
        """SELECT q.id AS id, s.name AS sub, q.number AS number
           FROM questions q JOIN subtopics s ON s.id=q.subtopic_id"""
    ).fetchall()
    conn.close()
    _opt_img_map._cache = {r["id"]: (option_image_slug(r["sub"]), r["number"]) for r in rows}
    return _opt_img_map._cache


_IMG_BEARER = {}


def _img_paths(qid):
    """(list of per-letter absolute paths, or None entry) for a question id."""
    info = _opt_img_map().get(qid)
    if not info:
        return [None] * 4
    slug, number = info
    return [os.path.join(OPTION_IMG_DIR, f"{slug}_{number}_{L}.png") for L in "ABCD"]


def image_bearer_qids():
    """qids that have at least one rendered option image."""
    if not _IMG_BEARER:
        for qid, paths in _opt_img_map().items():
            if any(os.path.exists(p) for p in _img_paths(qid)):
                _IMG_BEARER[qid] = True
    return _IMG_BEARER


def option_images_for(qid):
    """Return a 4-item list of image URLs (or None) for a question whose
    options are printed as graphs/tables/figures without usable text."""
    if qid not in image_bearer_qids():
        return [None] * 4
    return [
        f"/api/option-img/{qid}/{letter}" if os.path.exists(p) else None
        for letter, p in zip("ABCD", _img_paths(qid))
    ]


def q_to_dict(row, reveal=False):
    imgs = option_images_for(row["id"])
    d = {
        "id": row["id"],
        "number": row["number"],
        "source": row["source"],
        "prompt": row["prompt"],
        "options": [row["option_a"], row["option_b"], row["option_c"], row["option_d"]],
        "option_images": imgs,
        "question_image": question_image_sql().get(row["id"]),
        "difficulty": row["difficulty"],
        "domain": get_domain(row["subtopic_id"]),
        "type": "MCQ" if (
            any(x and x.strip() for x in [row["option_a"], row["option_b"], row["option_c"], row["option_d"]])
            or any(imgs)
        ) else "SPR",
    }
    if reveal:
        d["correct"] = row["correct"]
        d["clean"] = is_clean(row)
    return d


def subtopic_domain_map():
    """{subtopic_id: topic name} built once (avoids a DB round-trip per question)."""
    cache = getattr(subtopic_domain_map, "_cache", None)
    if cache is not None:
        return cache
    conn = db.get_conn()
    rows = conn.execute(
        "SELECT s.id AS sid, t.name AS tname FROM subtopics s JOIN topics t ON t.id=s.topic_id"
    ).fetchall()
    conn.close()
    subtopic_domain_map._cache = {r["sid"]: r["tname"] for r in rows}
    return subtopic_domain_map._cache


def get_domain(subtopic_id):
    return subtopic_domain_map().get(subtopic_id, "Unknown")


def image_bearer_qids():
    """qids that have at least one rendered option image (built once)."""
    cache = getattr(image_bearer_qids, "_cache", None)
    if cache is not None:
        return cache
    conn = db.get_conn()
    rows = conn.execute(
        """SELECT q.id AS id, s.name AS sub, q.number AS number
           FROM questions q JOIN subtopics s ON s.id=q.subtopic_id"""
    ).fetchall()
    conn.close()
    out = set()
    for r in rows:
        if any(
            os.path.exists(os.path.join(OPTION_IMG_DIR, f"{option_image_slug(r['sub'])}_{r['number']}_{L}.png"))
            for L in "ABCD"
        ):
            out.add(r["id"])
    image_bearer_qids._cache = out
    return out


def is_clean(row):
    """True when a question is usable in a mock: needs a real prompt, and an MC
    answer letter must have readable option text or a rendered option image."""
    if not (row["prompt"] or "").strip():
        return False
    correct = (row["correct"] or "").strip()
    opts = [row["option_a"], row["option_b"], row["option_c"], row["option_d"]]
    if correct.upper() in ("A", "B", "C", "D"):
        idx = {"A": 0, "B": 1, "C": 2, "D": 3}[correct.upper()]
        if opts[idx] and opts[idx].strip():
            return True
        return row["id"] in image_bearer_qids()
    return True


def select_module_questions(route, size=MODULE2_SIZE, excluded=None, subtopic=None):
    """Select questions appropriate for a module route."""
    conn = db.get_conn()
    if subtopic is not None:
        rows = conn.execute(
            "SELECT * FROM questions WHERE subtopic_id=?",
            (subtopic,),
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM questions").fetchall()
    conn.close()
    rows = [r for r in rows if is_clean(r)]

    if excluded:
        rows = [r for r in rows if r["id"] not in excluded]

    if route == "hard":
        buckets = {"easy": 0.1, "medium": 0.5, "hard": 0.4}
    elif route == "easy":
        buckets = {"easy": 0.5, "medium": 0.4, "hard": 0.1}
    else:  # module 1 mixed
        buckets = {"easy": 0.4, "medium": 0.4, "hard": 0.2}

    per_level = {lvl: max(1, round(size * frac)) for lvl, frac in buckets.items()}
    chosen = []
    for lvl, count in per_level.items():
        pool = [r for r in rows if r["difficulty"] == lvl]
        if len(pool) < count:
            pool = rows
        chosen.extend(random.sample(list(pool), min(count, len(pool))))

    # fill any shortfall
    while len(chosen) < size and rows:
        r = random.choice(rows)
        if r["id"] not in [c["id"] for c in chosen]:
            chosen.append(r)
    random.shuffle(chosen)
    return chosen[:size]


def build_module(session_id, module, route, minutes, subtopic=None, excluded=None, size=None):
    if size is None:
        size = MODULE2_SIZE if module == 2 else MODULE1_SIZE
    qs = select_module_questions(route, size, excluded, subtopic)
    conn = db.get_conn()
    cur = conn.execute(
        "INSERT INTO mock_tests(session_id, module, route, minutes) VALUES(?,?,?,?)",
        (session_id, module, route, minutes),
    )
    test_id = cur.lastrowid
    for order, row in enumerate(qs):
        conn.execute(
            "INSERT INTO mock_test_questions(test_id, question_id, module_order) VALUES(?,?,?)",
            (test_id, row["id"], order + 1),
        )
    conn.commit()
    conn.close()
    return test_id, qs


@app.route("/api/topics")
def topics():
    conn = db.get_conn()
    rows = conn.execute(
        """SELECT t.id tid, t.name tname, s.id sid, s.name sname,
                  (SELECT COUNT(*) FROM questions q WHERE q.subtopic_id=s.id) cnt
           FROM topics t JOIN subtopics s ON s.topic_id=t.id
           ORDER BY t.id, s.id"""
    ).fetchall()
    conn.close()
    result = {}
    for r in rows:
        result.setdefault(r["tname"], []).append(
            {"id": r["sid"], "name": r["sname"], "count": r["cnt"]}
        )
    return jsonify(result)


@app.route("/api/questions")
def questions():
    subtopic = request.args.get("subtopic", type=int)
    conn = db.get_conn()
    if subtopic:
        rows = conn.execute(
            "SELECT * FROM questions WHERE subtopic_id=?", (subtopic,)
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM questions ORDER BY id").fetchall()
    conn.close()
    return jsonify([q_to_dict(r, reveal=True) for r in rows])


@app.route("/api/questions/<int:qid>", methods=["PUT"])
def update_question(qid):
    body = request.get_json(force=True) or {}
    prompt = (body.get("prompt") or "").strip()
    opts = [str(body.get("option_a") or ""), str(body.get("option_b") or ""),
            str(body.get("option_c") or ""), str(body.get("option_d") or "")]
    correct = (body.get("correct") or "A").strip()
    number = body.get("number")
    source = (body.get("source") or "").strip()
    if not prompt:
        abort(400, "prompt required")
    if not any(o.strip() for o in opts):
        abort(400, "at least one option required")
    db.update_question(qid, prompt, opts, correct, number, source)
    return jsonify({"ok": True, "id": qid})


@app.route("/api/feedback", methods=["POST"])
def submit_feedback():
    body = request.get_json(force=True) or {}
    qid = body.get("question_id")
    message = (body.get("message") or "").strip()
    student_name = (body.get("student_name") or "").strip() or None
    if not qid:
        abort(400, "question_id required")
    if not message:
        abort(400, "message required")
    fid = db.add_feedback(int(qid), message, student_name)
    return jsonify({"ok": True, "id": fid})


@app.route("/api/feedback")
def list_feedback():
    conn = db.get_conn()
    rows = conn.execute(
        """SELECT f.id, f.question_id, f.student_name, f.message, f.created_at, f.resolved,
                  q.number, s.name AS subtopic
           FROM question_feedback f
           JOIN questions q ON q.id = f.question_id
           JOIN subtopics s ON s.id = q.subtopic_id
           ORDER BY f.id DESC LIMIT 500"""
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/results")
def results():
    return jsonify(db.student_results())


COURSE_IMG_DIR = os.path.join(ROOT, "data", "course_imgs")
FORMULA_DIR = os.path.join(ROOT, "data", "formulas")


def course_q_to_dict(row):
    opts = [row["option_a"], row["option_b"], row["option_c"],
            row["option_d"], row["option_e"], row["option_f"]]
    nonempty = sum(1 for o in opts if o and o.strip())
    letters = re.findall(r"[A-F]", row["correct"] or "") if row["is_mcq"] else []
    nopts = max(4, nonempty, (ord(letters[-1]) - ord("A") + 1) if letters else 0) if row["is_mcq"] else 4
    nopts = min(6, nopts)
    return {
        "id": row["id"],
        "number": row["number"],
        "prompt": row["prompt"],
        "options": opts,
        "question_image": f"/api/course-q-img/{row['id']}",
        "is_mcq": bool(row["is_mcq"]),
        "noptions": nopts,
        "topic": row["topic_name"] if "topic_name" in row.keys() else None,
        "subtopic": (row["subtopic_ref"] + " " + row["subtopic_name"]).strip()
                    if "subtopic_ref" in row.keys() else None,
    }


@app.route("/api/courses")
def course_list():
    courses = db.course_catalog()
    for c in courses:
        c["has_formula"] = os.path.exists(os.path.join(FORMULA_DIR, f"{c['code']}.pdf"))
    return jsonify(courses)


@app.route("/api/course-q-img/<int:qid>")
def course_q_image(qid):
    conn = db.get_conn()
    row = conn.execute(
        "SELECT question_image FROM course_questions WHERE id=?", (qid,)
    ).fetchone()
    conn.close()
    if not row or not row["question_image"]:
        abort(404)
    name = os.path.basename(row["question_image"])
    return send_from_directory(COURSE_IMG_DIR, name)


@app.route("/api/course-sessions", methods=["POST"])
def create_course_session_route():
    body = request.get_json(force=True) or {}
    course_id = body.get("course_id")
    subtopic_ids = body.get("subtopics", []) or []
    qsize = int(body.get("size", 0) or 0)
    student_name = (body.get("student_name") or "").strip() or None
    if not course_id:
        abort(400, "course_id required")
    if not subtopic_ids:
        abort(400, "select at least one lesson")
    rows = db.course_questions_for(subtopic_ids)
    if not rows:
        abort(404, "no questions for the selected lessons")
    random.shuffle(rows)
    if qsize > 0:
        rows = rows[:qsize]
    sid = db.create_course_session(course_id, student_name, qsize=len(rows))
    return jsonify(
        {
            "session_id": sid,
            "size": len(rows),
            "questions": [course_q_to_dict(r) for r in rows],
        }
    )


def _solution_parts(correct):
    """Split a stored free-response answer into its acceptable pieces.

    Curriculum answers are often worked solutions stored as
    'x = 6 | x = 1 | x = -2' (one step per line). A student who types any one
    of those steps -- or just the final value -- should be credited, so return
    the whole string plus each line and each trailing value of an assignment.
    """
    parts = {correct}
    for line in re.split(r"[|\n]", correct):
        line = line.strip()
        if not line:
            continue
        parts.add(line)
        m = re.search(r"[A-Za-z]\s*=\s*(-?\d+(?:\.\d+)?(?:/\d+)?)\s*$", line)
        if m:
            parts.add(m.group(1))
    return {p for p in parts if p}


def score_course_question(user, row):
    """Return (is_correct, correct_answer) for a course question.

    MCQ: user letters (e.g. "BD") compared against the stored correct
    letter(s).  FR: matches the whole stored answer, any single line of a
    stored worked solution, or the numeric value of either."""
    correct = (row["correct"] or "").strip()
    user = (user or "").strip()
    if not user or not correct:
        return None, correct
    if row["is_mcq"]:
        u = "".join(sorted(re.findall(r"[A-F]", user.upper())))
        c = "".join(sorted(re.findall(r"[A-F]", correct.upper())))
        return (u == c) if u and c else None, correct
    for part in _solution_parts(correct):
        if normalize_match(user, part):
            return True, correct
    return None, correct


@app.route("/api/course-sessions/<int:session_id>/submit", methods=["POST"])
def submit_course_session(session_id):
    body = request.get_json(force=True) or {}
    answers = body.get("answers", {}) or {}
    conn = db.get_conn()
    sess = conn.execute(
        "SELECT * FROM course_sessions WHERE id=?", (session_id,)
    ).fetchone()
    if not sess:
        conn.close()
        abort(404)
    qids = [int(k) for k in answers.keys()]
    if not qids:
        conn.close()
        abort(400, "no answers submitted")
    ph = ",".join("?" * len(qids))
    rows = conn.execute(
        f"SELECT * FROM course_questions WHERE id IN ({ph})", qids
    ).fetchall()
    results = []
    correct = total = 0
    for r in rows:
        user_ans = str(answers.get(str(r["id"]), "")).strip()
        is_ok, correct_ans = score_course_question(user_ans, r)
        graded = is_ok is True or is_ok is False
        is_ok = bool(is_ok)
        if graded:
            total += 1
            if is_ok:
                correct += 1
        results.append(
            {
                "question_id": r["id"],
                "user_answer": user_ans,
                "correct_answer": correct_ans,
                "is_correct": is_ok,
                "graded": graded,
            }
        )
        db.save_course_result(session_id, r["id"], user_ans, correct_ans, is_ok)
    conn.execute(
        "UPDATE course_sessions SET correct=?, total=? WHERE id=?",
        (correct, total, session_id),
    )
    conn.commit()
    conn.close()
    pct = round(correct * 100 / total, 1) if total else 0
    return jsonify(
        {
            "session_id": session_id,
            "total": total,
            "correct": correct,
            "percentage": pct,
            "results": results,
        }
    )


@app.route("/api/course-results")
def course_results_route():
    return jsonify(db.course_results())


@app.route("/api/formula/<code>")
def formula_sheet(code):
    name = f"{code}.pdf"
    p = os.path.join(FORMULA_DIR, name)
    if os.path.exists(p):
        return send_from_directory(FORMULA_DIR, name)
    abort(404)


@app.route("/api/sessions", methods=["POST"])
def create_session():
    body = request.get_json(force=True) or {}
    subtopic = body.get("subtopic")
    size = int(body.get("size", MODULE1_SIZE))
    minutes = int(body.get("minutes", MODULE1_MIN))
    student_name = (body.get("student_name") or "").strip() or None
    size = max(1, min(44, size))
    sid = db.create_session(minutes, qsize=size, student_name=student_name)
    test_id, qs = build_module(
        sid, 1, None, minutes, subtopic=subtopic, size=size
    )
    return jsonify(
        {
            "session_id": sid,
            "test_id": test_id,
            "module": 1,
            "minutes": minutes,
            "questions": [q_to_dict(r) for r in qs],
        }
    )


@app.route("/api/modules/<int:test_id>")
def get_module(test_id):
    conn = db.get_conn()
    t = conn.execute("SELECT * FROM mock_tests WHERE id=?", (test_id,)).fetchone()
    if not t:
        conn.close()
        abort(404)
    rows = conn.execute(
        """SELECT q.* FROM mock_test_questions mt
           JOIN questions q ON q.id=mt.question_id
           WHERE mt.test_id=? ORDER BY mt.module_order""",
        (test_id,),
    ).fetchall()
    conn.close()
    return jsonify(
        {
            "test_id": test_id,
            "session_id": t["session_id"],
            "module": t["module"],
            "route": t["route"],
            "minutes": t["minutes"],
            "questions": [q_to_dict(r) for r in rows],
        }
    )


@app.route("/api/modules/<int:test_id>/submit", methods=["POST"])
def submit_module(test_id):
    body = request.get_json(force=True) or {}
    answers = body.get("answers", {})
    conn = db.get_conn()
    t = conn.execute("SELECT * FROM mock_tests WHERE id=?", (test_id,)).fetchone()
    if not t:
        conn.close()
        abort(404)
    rows = conn.execute(
        """SELECT q.* FROM mock_test_questions mt
           JOIN questions q ON q.id=mt.question_id
           WHERE mt.test_id=? ORDER BY mt.module_order""",
        (test_id,),
    ).fetchall()
    conn.close()

    results = []
    correct_count = 0
    domain = None
    for r in rows:
        user_ans = str(answers.get(str(r["id"]), "")).strip().upper()
        correct = str(r["correct"]).strip().upper()
        is_correct = normalize_match(user_ans, correct)
        if is_correct:
            correct_count += 1
        domain = get_domain(r["subtopic_id"])
        results.append(
            {
                "question_id": r["id"],
                "domain": domain,
                "user_answer": user_ans,
                "correct_answer": correct,
                "is_correct": is_correct,
            }
        )

    # persist results for this module
    conn = db.get_conn()
    for res in results:
        conn.execute(
            """INSERT INTO session_results
               (session_id, test_id, question_id, domain, user_answer, correct_answer, is_correct)
               VALUES(?,?,?,?,?,?,?)""",
            (
                t["session_id"],
                test_id,
                res["question_id"],
                res["domain"],
                res["user_answer"],
                res["correct_answer"],
                1 if res["is_correct"] else 0,
            ),
        )
    conn.commit()
    conn.close()

    total = len(rows)
    pct = correct_count * 100 / total if total else 0

    if t["module"] == 1:
        # route to module 2
        route = "hard" if pct / 100 >= ROUTE_THRESHOLD else "easy"
        excluded = [r["id"] for r in rows]
        # module 2 mirrors module 1 sizing for consistency
        conn = db.get_conn()
        sess = conn.execute(
            "SELECT * FROM test_sessions WHERE id=?", (t["session_id"],)
        ).fetchone()
        conn.close()
        size2 = sess["qsize"] if sess else MODULE2_SIZE
        minutes2 = sess["minutes"] if sess else MODULE2_MIN
        test2_id, qs2 = build_module(
            t["session_id"], 2, route, minutes2, excluded=excluded, size=size2
        )
        return jsonify(
            {
                "module": 1,
                "total": total,
                "correct": correct_count,
                "percentage": round(pct, 1),
                "route": route,
                "route_threshold": ROUTE_THRESHOLD,
                "results": results,
                "next_module": {
                    "test_id": test2_id,
                    "module": 2,
                    "route": route,
                    "minutes": minutes2,
                    "questions": [q_to_dict(r) for r in qs2],
                },
            }
        )
    else:
        # final module: compute scaled score combining both modules
        combined_correct, combined_total, domain_stats = session_combined(
            t["session_id"]
        )
        scaled = scaled_score(combined_correct, combined_total, t["route"])
        return jsonify(
            {
                "module": 2,
                "route": t["route"],
                "total": total,
                "correct": correct_count,
                "percentage": round(pct, 1),
                "scaled_score": scaled,
                "combined_correct": combined_correct,
                "combined_total": combined_total,
                "domain_stats": domain_stats,
                "results": results,
                "session_complete": True,
            }
        )


def session_combined(session_id):
    """Sum correct answers and build domain breakdown from persisted results."""
    conn = db.get_conn()
    rows = conn.execute(
        "SELECT * FROM session_results WHERE session_id=?",
        (session_id,),
    ).fetchall()
    conn.close()
    combined_correct = sum(1 for r in rows if r["is_correct"])
    combined_total = len(rows)
    domain_stats = {}
    for r in rows:
        d = r["domain"]
        ds = domain_stats.setdefault(d, {"total": 0, "correct": 0})
        ds["total"] += 1
        if r["is_correct"]:
            ds["correct"] += 1
    return combined_correct, combined_total, domain_stats


def _to_number(s):
    """Parse a numeric answer tolerantly: '1/2', '0.5', '.5', '1,234', '2e3',
    unicode minus, and stray trailing periods. Returns float or None."""
    t = (s or "").strip().replace(",", "").replace("−", "-").replace("–", "-")
    t = t.replace("$", "").replace("%", "").strip().rstrip(".")
    if not t:
        return None
    try:
        return float(t)
    except ValueError:
        pass
    m = re.fullmatch(r"(-?)\s*(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)", t)
    if m:
        try:
            num, den = float(m.group(2)), float(m.group(3))
        except ValueError:
            return None
        if den == 0:
            return None
        return -num / den if m.group(1) else num / den
    return None


def normalize_match(user, correct):
    """True when the typed answer matches the stored one.

    Tries exact text, then case/punctuation-insensitive text, then numeric
    compare so 0.5, 1/2 and .5 are all accepted for a stored '1/2'."""
    if not user:
        return False
    user_s, correct_s = str(user).strip(), str(correct).strip()
    if user_s == correct_s:
        return True
    canon = lambda x: re.sub(r"[\s,]", "", x).upper().rstrip(".").replace("−", "-").replace("–", "-")
    if canon(user_s) == canon(correct_s):
        return True
    un, cn = _to_number(user_s), _to_number(correct_s)
    if un is not None and cn is not None:
        # 1e-6 relative tolerance: accepts values a student rounded by hand
        # (0.272727 for 3/11) without ever equalling a different answer.
        return abs(un - cn) <= 1e-6 * max(1.0, abs(cn))
    return False


def scaled_score(correct, total, route):
    """Heuristic conversion of raw fraction to SAT 200-800 scale with route factor."""
    frac = correct / total if total else 0
    if route == "easy":
        base = 200 + frac * 410  # max ~610 for easy route
    else:
        base = 200 + frac * 600  # max 800 for hard route
    return round(min(800, base))


@app.route("/api/report/<int:session_id>")
def report(session_id):
    conn = db.get_conn()
    tests = conn.execute(
        "SELECT * FROM mock_tests WHERE session_id=?", (session_id,)
    ).fetchall()
    all_rows = []
    for tx in tests:
        rows = conn.execute(
            """SELECT q.*, mt.module_order FROM mock_test_questions mt
               JOIN questions q ON q.id=mt.question_id
               WHERE mt.test_id=? ORDER BY mt.module_order""",
            (tx["id"],),
        ).fetchall()
        for r in rows:
            all_rows.append((tx, r))
    conn.close()
    domain_stats = {}
    total_correct = 0
    total = 0
    for tx, r in all_rows:
        domain = get_domain(r["subtopic_id"])
        total += 1
        ds = domain_stats.setdefault(domain, {"total": 0, "correct": 0})
        ds["total"] += 1
    return jsonify({"domains": domain_stats, "total": total})


@app.route("/api/option-img/<int:qid>/<letter>")
def option_img(qid, letter):
    letter = letter.upper()
    if letter not in "ABCD":
        abort(404)
    conn = db.get_conn()
    row = conn.execute(
        """SELECT s.name AS sub, q.number AS number, q.id AS qid FROM questions q
           JOIN subtopics s ON s.id=q.subtopic_id WHERE q.id=? """,
        (qid,),
    ).fetchone()
    conn.close()
    if not row:
        abort(404)
    name = f"{option_image_slug(row['sub'])}_{row['number']}_{letter}.png"
    return send_from_directory(OPTION_IMG_DIR, name)


@app.route("/api/q-img/<int:qid>")
def q_image(qid):
    conn = db.get_conn()
    row = conn.execute(
        """SELECT s.name AS sub, q.number AS number FROM questions q
           JOIN subtopics s ON s.id=q.subtopic_id WHERE q.id=? """,
        (qid,),
    ).fetchone()
    conn.close()
    if not row:
        abort(404)
    name = f"{option_image_slug(row['sub'])}_{row['number']}.png"
    return send_from_directory(Q_IMG_DIR, name)


@app.route("/")
def index():
    return send_from_directory(FRONTEND, "index.html")


db.init_db()

if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5000"))
    app.run(host=host, port=port)

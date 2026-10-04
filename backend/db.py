import os
import sqlite3

DB_PATH = os.environ.get("SAT_DB_PATH") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "sat.db"
)


def get_conn():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def init_db():
    conn = get_conn()
    c = conn.cursor()
    c.execute("PRAGMA journal_mode = WAL")
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS topics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS subtopics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            topic_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            FOREIGN KEY (topic_id) REFERENCES topics(id)
        );

        CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subtopic_id INTEGER NOT NULL,
            number INTEGER,
            source TEXT,
            prompt TEXT NOT NULL,
            option_a TEXT,
            option_b TEXT,
            option_c TEXT,
            option_d TEXT,
            correct TEXT NOT NULL,
            difficulty TEXT DEFAULT 'medium',
            FOREIGN KEY (subtopic_id) REFERENCES subtopics(id)
        );

        CREATE TABLE IF NOT EXISTS test_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT DEFAULT (datetime('now')),
            minutes INTEGER,
            qsize INTEGER DEFAULT 22,
            student_name TEXT
        );

        CREATE TABLE IF NOT EXISTS mock_tests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            module INTEGER NOT NULL,
            route TEXT,
            minutes INTEGER NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES test_sessions(id)
        );

        CREATE TABLE IF NOT EXISTS mock_test_questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            test_id INTEGER NOT NULL,
            question_id INTEGER NOT NULL,
            module_order INTEGER NOT NULL,
            FOREIGN KEY (test_id) REFERENCES mock_tests(id),
            FOREIGN KEY (question_id) REFERENCES questions(id)
        );

        CREATE TABLE IF NOT EXISTS session_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            test_id INTEGER NOT NULL,
            question_id INTEGER NOT NULL,
            domain TEXT,
            user_answer TEXT,
            correct_answer TEXT,
            is_correct INTEGER,
            FOREIGN KEY (session_id) REFERENCES test_sessions(id)
        );

        CREATE TABLE IF NOT EXISTS question_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question_id INTEGER NOT NULL,
            student_name TEXT,
            message TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            resolved INTEGER DEFAULT 0,
            FOREIGN KEY (question_id) REFERENCES questions(id)
        );

        CREATE TABLE IF NOT EXISTS courses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            grade INTEGER NOT NULL,
            branch TEXT NOT NULL,
            name TEXT NOT NULL,
            term INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS course_topics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL,
            topic_no INTEGER NOT NULL,
            name TEXT NOT NULL,
            UNIQUE(course_id, topic_no),
            FOREIGN KEY (course_id) REFERENCES courses(id)
        );

        CREATE TABLE IF NOT EXISTS course_subtopics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL,
            topic_id INTEGER NOT NULL,
            ref TEXT NOT NULL,
            name TEXT NOT NULL,
            UNIQUE(course_id, topic_id, ref),
            FOREIGN KEY (course_id) REFERENCES courses(id),
            FOREIGN KEY (topic_id) REFERENCES course_topics(id)
        );

        CREATE TABLE IF NOT EXISTS course_questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL,
            subtopic_id INTEGER NOT NULL,
            number INTEGER NOT NULL,
            prompt TEXT,
            option_a TEXT,
            option_b TEXT,
            option_c TEXT,
            option_d TEXT,
            option_e TEXT,
            option_f TEXT,
            correct TEXT,
            is_mcq INTEGER DEFAULT 0,
            question_image TEXT,
            UNIQUE(course_id, subtopic_id, number),
            FOREIGN KEY (course_id) REFERENCES courses(id),
            FOREIGN KEY (subtopic_id) REFERENCES course_subtopics(id)
        );

        CREATE TABLE IF NOT EXISTS course_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL,
            student_name TEXT,
            qsize INTEGER DEFAULT 15,
            correct INTEGER DEFAULT 0,
            total INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (course_id) REFERENCES courses(id)
        );

        CREATE TABLE IF NOT EXISTS course_session_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            question_id INTEGER NOT NULL,
            user_answer TEXT,
            correct_answer TEXT,
            is_correct INTEGER,
            FOREIGN KEY (session_id) REFERENCES course_sessions(id),
            FOREIGN KEY (question_id) REFERENCES course_questions(id)
        );
        """
    )
    conn.commit()
    _ensure_column(conn, "test_sessions", "student_name", "TEXT")
    _ensure_column(conn, "question_feedback", "student_name", "TEXT")
    conn.commit()
    conn.close()


def _ensure_column(conn, table, column, decl):
    cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


def add_feedback(question_id, message, student_name):
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO question_feedback(question_id, student_name, message) VALUES(?,?,?)",
        (question_id, student_name, message),
    )
    conn.commit()
    fid = cur.lastrowid
    conn.close()
    return fid


def add_topic(name):
    conn = get_conn()
    conn.execute("INSERT OR IGNORE INTO topics(name) VALUES(?)", (name,))
    conn.commit()
    row = conn.execute("SELECT id FROM topics WHERE name=?", (name,)).fetchone()
    conn.close()
    return row["id"]


def add_subtopic(topic_id, name):
    conn = get_conn()
    conn.execute("INSERT INTO subtopics(topic_id, name) VALUES(?,?)", (topic_id, name))
    conn.commit()
    row = conn.execute(
        "SELECT id FROM subtopics WHERE topic_id=? AND name=?", (topic_id, name)
    ).fetchone()
    conn.close()
    return row["id"]


def add_question(subtopic_id, number, source, prompt, opts, correct, difficulty="medium"):
    conn = get_conn()
    conn.execute(
        """INSERT INTO questions
           (subtopic_id, number, source, prompt, option_a, option_b, option_c, option_d, correct, difficulty)
           VALUES(?,?,?,?,?,?,?,?,?,?)""",
        (subtopic_id, number, source, prompt, *opts, correct, difficulty),
    )
    conn.commit()
    qid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.close()
    return qid


def create_session(minutes, qsize=22, student_name=None):
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO test_sessions(minutes, qsize, student_name) VALUES(?,?,?)",
        (minutes, qsize, student_name),
    )
    sid = cur.lastrowid
    conn.commit()
    conn.close()
    return sid


def student_results():
    """Per-student aggregates from final (module 2) submissions."""
    conn = get_conn()
    rows = conn.execute(
        """SELECT ts.id AS session_id,
                  ts.created_at,
                  COALESCE(NULLIF(TRIM(ts.student_name), ''), 'Unnamed') AS name,
                  COUNT(sr.id) AS total,
                  SUM(sr.is_correct) AS correct,
                  MIN(mt.module) AS started_module
           FROM test_sessions ts
           JOIN mock_tests mt ON mt.session_id = ts.id
           JOIN session_results sr ON sr.session_id = ts.id
           GROUP BY ts.id""",
    ).fetchall()
    conn.close()
    by_name = {}
    for r in rows:
        name = r["name"]
        a = by_name.setdefault(
            name,
            {
                "name": name,
                "attempts": 0,
                "total": 0,
                "correct": 0,
                "last_active": "",
            },
        )
        a["attempts"] += 1
        a["total"] += r["total"]
        a["correct"] += r["correct"]
        if r["created_at"] and r["created_at"] > a["last_active"]:
            a["last_active"] = r["created_at"]
    out = []
    for name, a in by_name.items():
        a["accuracy"] = round(a["correct"] * 100 / a["total"], 1) if a["total"] else 0
        out.append(a)
    out.sort(key=lambda x: (x["last_active"], x["name"].lower()), reverse=True)
    return out


def update_question(qid, prompt, opts, correct, number, source):
    """SAT question edit. Allows free-response saves: options may all be empty.

    `number`/`source` are kept as-is when not supplied.
    """
    conn = get_conn()
    conn.execute(
        """UPDATE questions
           SET prompt=?, option_a=?, option_b=?, option_c=?, option_d=?, correct=?,
               number=COALESCE(?, number), source=COALESCE(NULLIF(?,''), source)
           WHERE id=?""",
        (prompt, opts[0], opts[1], opts[2], opts[3], correct, number, source, qid),
    )
    conn.commit()
    conn.close()


def update_course_question(qid, prompt, opts, correct, is_mcq, number=None):
    """Curriculum question edit. opts is a list of up to 6 option strings.

    Free-response questions keep empty options, and `correct` holds the
    accepted answer (numbers, or '|'/newline separated solution steps).
    `number` is kept as-is when not supplied.
    """
    opts = list(opts) + [""] * (6 - len(opts))
    conn = get_conn()
    conn.execute(
        """UPDATE course_questions
           SET prompt=?, option_a=?, option_b=?, option_c=?, option_d=?,
               option_e=?, option_f=?, correct=?, is_mcq=?,
               number=COALESCE(?, number)
           WHERE id=?""",
        (prompt, opts[0], opts[1], opts[2], opts[3], opts[4], opts[5],
         correct, 1 if is_mcq else 0, number, qid),
    )
    conn.commit()
    conn.close()


def course_question(qid):
    conn = get_conn()
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        """SELECT cq.*, cs.name AS subtopic_name, cs.ref AS subtopic_ref,
                  c.code AS course_code, c.name AS course_name
           FROM course_questions cq
           LEFT JOIN course_subtopics cs ON cs.id = cq.subtopic_id
           LEFT JOIN courses c ON c.id = cq.course_id
           WHERE cq.id=?""",
        (qid,),
    ).fetchone()
    conn.close()
    return row


def upsert_course(code, grade, branch, name, term=1):
    conn = get_conn()
    conn.execute(
        """INSERT INTO courses(code, grade, branch, name, term)
           VALUES(?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET grade=?, branch=?, name=?, term=?""",
        (code, grade, branch, name, term, grade, branch, name, term),
    )
    row = conn.execute("SELECT id FROM courses WHERE code=?", (code,)).fetchone()
    cid = row["id"]
    conn.commit()
    conn.close()
    return cid


def upsert_course_topic(cid, topic_no, name):
    conn = get_conn()
    conn.execute(
        """INSERT INTO course_topics(course_id, topic_no, name) VALUES(?,?,?)
           ON CONFLICT(course_id, topic_no) DO UPDATE SET name=excluded.name""",
        (cid, topic_no, name),
    )
    row = conn.execute(
        "SELECT id FROM course_topics WHERE course_id=? AND topic_no=?", (cid, topic_no)
    ).fetchone()
    tid = row["id"]
    conn.commit()
    conn.close()
    return tid


def upsert_course_subtopic(cid, tid, ref, name):
    conn = get_conn()
    conn.execute(
        """INSERT INTO course_subtopics(course_id, topic_id, ref, name) VALUES(?,?,?,?)
           ON CONFLICT(course_id, topic_id, ref) DO UPDATE SET name=excluded.name""",
        (cid, tid, ref, name),
    )
    row = conn.execute(
        "SELECT id FROM course_subtopics WHERE course_id=? AND topic_id=? AND ref=?",
        (cid, tid, ref),
    ).fetchone()
    sid = row["id"]
    conn.commit()
    conn.close()
    return sid


def upsert_course_question(cid, sid, number, prompt, opts, correct, is_mcq, img):
    conn = get_conn()
    conn.execute(
        """INSERT INTO course_questions
           (course_id, subtopic_id, number, prompt, option_a, option_b, option_c,
            option_d, option_e, option_f, correct, is_mcq, question_image)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(course_id, subtopic_id, number) DO UPDATE SET
            prompt=excluded.prompt, option_a=excluded.option_a, option_b=excluded.option_b,
            option_c=excluded.option_c, option_d=excluded.option_d, option_e=excluded.option_e,
            option_f=excluded.option_f, correct=excluded.correct, is_mcq=excluded.is_mcq,
            question_image=excluded.question_image""",
        (
            cid,
            sid,
            number,
            prompt,
            *[(opts + [None] * 6)[i] for i in range(6)],
            correct,
            1 if is_mcq else 0,
            img,
        ),
    )
    conn.commit()
    conn.close()


def create_course_session(cid, student_name, qsize=15):
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO course_sessions(course_id, student_name, qsize) VALUES(?,?,?)",
        (cid, student_name, qsize),
    )
    sid = cur.lastrowid
    conn.commit()
    conn.close()
    return sid


def course_questions_for(subtopic_ids):
    if not subtopic_ids:
        return []
    ph = ",".join("?" * len(subtopic_ids))
    conn = get_conn()
    rows = conn.execute(
        f"""SELECT q.*, s.ref AS subtopic_ref, s.name AS subtopic_name,
                   t.topic_no, t.name AS topic_name
            FROM course_questions q
            JOIN course_subtopics s ON s.id = q.subtopic_id
            JOIN course_topics t ON t.id = s.topic_id
            WHERE q.subtopic_id IN ({ph})""",
        subtopic_ids,
    ).fetchall()
    conn.close()
    return rows


def save_course_result(sid, qid, user_answer, correct_answer, is_correct):
    conn = get_conn()
    conn.execute(
        """INSERT INTO course_session_results
           (session_id, question_id, user_answer, correct_answer, is_correct)
           VALUES(?,?,?,?,?)""",
        (sid, qid, user_answer, correct_answer, 1 if is_correct else 0),
    )
    conn.commit()
    conn.close()


def course_results():
    """Per-student aggregates across all course practice sessions."""
    conn = get_conn()
    rows = conn.execute(
        """SELECT cs.id AS session_id, cs.created_at, cs.correct, cs.total,
COALESCE(NULLIF(TRIM(cs.student_name), ''), 'Unnamed') AS name,
                   c.code AS course_code, c.grade, c.branch
           FROM course_sessions cs
           LEFT JOIN courses c ON c.id = cs.course_id"""
    ).fetchall()
    conn.close()
    by_name = {}
    for r in rows:
        name = r["name"]
        a = by_name.setdefault(
            name,
            {"name": name, "attempts": 0, "total": 0, "correct": 0, "last_active": ""},
        )
        a["attempts"] += 1
        a["total"] += r["total"]
        a["correct"] += r["correct"]
        if r["created_at"] and r["created_at"] > a["last_active"]:
            a["last_active"] = r["created_at"]
    out = []
    for name, a in by_name.items():
        a["accuracy"] = round(a["correct"] * 100 / a["total"], 1) if a["total"] else 0
        out.append(a)
    out.sort(key=lambda x: (x["last_active"], x["name"].lower()), reverse=True)
    return out


def course_catalog():
    """Courses with topics, subtopics and per-subtopic question counts."""
    conn = get_conn()
    rows = conn.execute(
        """SELECT c.id AS cid, c.code, c.grade, c.branch, c.term, c.name,
                  t.id AS tid, t.topic_no, t.name AS tname,
                  s.id AS sid, s.ref, s.name AS sname,
                  (SELECT COUNT(*) FROM course_questions q
                    WHERE q.subtopic_id = s.id) AS qcount
           FROM courses c
           LEFT JOIN course_topics t ON t.course_id = c.id
           LEFT JOIN course_subtopics s ON s.topic_id = t.id
           ORDER BY c.grade, c.branch, t.topic_no, s.ref"""
    ).fetchall()
    conn.close()
    courses = {}
    for r in rows:
        co = courses.setdefault(
            r["cid"],
            {"id": r["cid"], "code": r["code"], "grade": r["grade"],
             "branch": r["branch"], "term": r["term"], "name": r["name"], "topics": {}},
        )
        if r["tid"] is None:
            continue
        topic = co["topics"].setdefault(
            r["tid"],
            {"id": r["tid"], "topic_no": r["topic_no"], "name": r["tname"], "subtopics": []},
        )
        if r["sid"] is not None:
            topic["subtopics"].append(
                {"id": r["sid"], "ref": r["ref"], "name": r["sname"], "count": r["qcount"]}
            )
    out = []
    for co in courses.values():
        co["topics"] = sorted(co["topics"].values(), key=lambda t: t["topic_no"])
        out.append(co)
    out.sort(key=lambda c: (c["grade"], c["branch"]))
    return out


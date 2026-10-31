"""Student accounts, groups and the leaderboard, plus student feedback.

Students sign up with their school email and a password, pick their grade and
track, and land in their group's play area ("Grade 11 · Advanced"). Their
QuestLearn profile (hero, XP, score, mastery) is kept on the server so it
follows them between devices, and the score feeds the group leaderboard.

Admins (the existing teacher login) can hide students from the leaderboard,
reset passwords, remove accounts and read feedback.
"""
import json
import os
import re
import time

from flask import Blueprint, abort, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

import security
import userdb

bp = Blueprint("accounts", __name__)
TRACK_NAMES = {"asp": "ASP", "advanced": "Advanced", "general": "General"}
GRADES = (9, 10, 11, 12)
ONLINE_SECONDS = 5 * 60
EMAIL = re.compile(r"^[^@\s]+@([^@\s]+\.[^@\s]+)$")
# Comma-separated list such as "school.edu.qa,students.school.edu.qa". Empty means
# any email address is accepted.
SCHOOL_DOMAINS = [d.strip().lower().lstrip("@") for d in os.environ.get("SCHOOL_EMAIL_DOMAIN", "").split(",")
                  if d.strip()]

# Hooks provided by app.py.
_is_admin = _recheck = None


def init(app, is_admin, recheck):
    global _is_admin, _recheck
    _is_admin, _recheck = is_admin, recheck
    userdb.create_tables("""
        CREATE TABLE IF NOT EXISTS ql_students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            name TEXT NOT NULL,
            pw_hash TEXT NOT NULL,
            grade INTEGER, track TEXT,
            profile TEXT,
            score INTEGER NOT NULL DEFAULT 0,
            level INTEGER NOT NULL DEFAULT 1,
            hidden INTEGER NOT NULL DEFAULT 0,
            created_at REAL, last_seen REAL);
        CREATE TABLE IF NOT EXISTS ql_roster (
            email TEXT PRIMARY KEY COLLATE NOCASE,
            student_no TEXT, name TEXT, name_ar TEXT,
            grade INTEGER, section TEXT, cluster TEXT, track TEXT);
        CREATE TABLE IF NOT EXISTS ql_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER, student_name TEXT,
            ref TEXT, category TEXT, message TEXT,
            answer TEXT, ai_verdict TEXT,
            created_at REAL, resolved INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS ql_staff (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            name TEXT NOT NULL, pw_hash TEXT NOT NULL, created_at REAL);
    """)
    # XP won or lost in the arena (kept apart from quiz XP, which the browser
    # reports) and when the profile was last saved (for the tamper checks).
    userdb.add_column("ql_students", "arena_xp", "INTEGER NOT NULL DEFAULT 0")
    userdb.add_column("ql_students", "profile_at", "REAL")
    app.register_blueprint(bp)


# --------------------------------------------------------------------- helpers
def _group(grade, track):
    if grade not in GRADES or track not in TRACK_NAMES:
        return None
    return {"id": f"{grade}-{track}", "grade": grade, "track": track,
            "name": f"Grade {grade} · {TRACK_NAMES[track]}"}


def _public(row, me=False):
    """Student row -> what the browser may see (never the password hash)."""
    profile = json.loads(row["profile"] or "{}")
    out = {"id": row["id"], "name": row["name"], "grade": row["grade"], "track": row["track"],
           "group": _group(row["grade"], row["track"]), "score": row["score"], "level": row["level"],
           "character": profile.get("character"), "arena_xp": row["arena_xp"] or 0,
           "xp": max(0, int(profile.get("totalXp") or 0) + (row["arena_xp"] or 0)),
           "online": bool(row["last_seen"]) and time.time() - row["last_seen"] < ONLINE_SECONDS}
    if me:
        out.update(email=row["email"], profile=profile)
    return out


def current_student():
    sid = session.get("student_id")
    if not sid:
        return None
    conn = userdb.connect()
    row = conn.execute("SELECT * FROM ql_students WHERE id=?", (sid,)).fetchone()
    if row:
        conn.execute("UPDATE ql_students SET last_seen=? WHERE id=?", (time.time(), sid))
        conn.commit()
    conn.close()
    if not row:
        session.pop("student_id", None)
    return row


def _require_student():
    row = current_student()
    if not row:
        abort(401, "please log in")
    return row


def _require_admin():
    if not _is_admin():
        abort(401, "admin login required")


def staff_login(email, password):
    """A teacher account the admin created, or None."""
    email = str(email or "").strip().lower()
    security.rate_limit("staff-login-email", 8, 15 * 60, key=email)
    conn = userdb.connect()
    row = conn.execute("SELECT * FROM ql_staff WHERE email=?", (email,)).fetchone()
    conn.close()
    return row if row and check_password_hash(row["pw_hash"], str(password or "")) else None


def _sign_in(sid):
    session.clear()  # a fresh session on every sign-in (no session fixation)
    session["student_id"] = sid
    session.permanent = True


def _body():
    return request.get_json(silent=True) or {}


def _roster_entry(conn, email):
    """(roster in use?, this email's roster row or None)."""
    used = conn.execute("SELECT 1 FROM ql_roster LIMIT 1").fetchone() is not None
    return used, conn.execute("SELECT * FROM ql_roster WHERE email=?", (email,)).fetchone() if used else None


def _short_name(full):
    """'Abdulla Saeed Abdulla Emtair Alhebsi' -> 'Abdulla Alhebsi' for the leaderboard."""
    parts = str(full or "").split()
    return " ".join(parts[:1] + parts[-1:]) if len(parts) > 2 else " ".join(parts)


# ------------------------------------------------------------------------ auth
@bp.route("/api/auth/check", methods=["POST"])
def check_email():
    """First login step: does this email have an account yet, or is it on the
    school list and needs a password created?"""
    email = str(_body().get("email") or "").strip().lower()
    if not EMAIL.match(email):
        abort(400, "Enter a valid email address.")
    security.rate_limit("check-email", 600, 5 * 60)
    security.rate_limit("check-email-one", 30, 5 * 60, key=email)
    conn = userdb.connect()
    exists = conn.execute("SELECT 1 FROM ql_students WHERE email=?", (email,)).fetchone() is not None
    used, entry = _roster_entry(conn, email)
    conn.close()
    if not exists and used and not entry:
        abort(403, "This email isn't on the school's student list. Check it, or ask your teacher.")
    return jsonify({"exists": exists, "name": _short_name(entry["name"]) if entry else None,
                    "grade": entry["grade"] if entry else None, "track": entry["track"] if entry else None})

@bp.route("/api/auth/me")
def me():
    row = current_student()
    return jsonify({"student": _public(row, me=True) if row else None, "admin": bool(_is_admin()), "role": security.role(),
                    "domains": SCHOOL_DOMAINS})


@bp.route("/api/auth/signup", methods=["POST"])
def signup():
    data = _body()
    email = str(data.get("email") or "").strip().lower()
    name = re.sub(r"\s+", " ", str(data.get("name") or "")).strip()[:40]
    password = str(data.get("password") or "")
    m = EMAIL.match(email)
    if not m:
        abort(400, "Enter a valid email address.")
    security.rate_limit("signup", 300, 60 * 60)
    security.rate_limit("signup-email", 10, 60 * 60, key=email, per_ip=False)
    conn = userdb.connect()
    used, entry = _roster_entry(conn, email)
    if used and not entry:
        conn.close()
        abort(403, "This email isn't on the school's student list. Check it, or ask your teacher.")
    if not used and SCHOOL_DOMAINS and m.group(1) not in SCHOOL_DOMAINS:
        conn.close()
        abort(400, f"Use your school email (@{SCHOOL_DOMAINS[0]}).")
    name = name or (_short_name(entry["name"]) if entry else "")
    if not name:
        conn.close()
        abort(400, "Enter your name.")
    if len(password) < 8:
        conn.close()
        abort(400, "Choose a password of at least 8 characters.")
    if conn.execute("SELECT 1 FROM ql_students WHERE email=?", (email,)).fetchone():
        conn.close()
        abort(409, "This email already has an account. Log in instead.")
    now = time.time()
    # The roster's grade is only a starting point: students still choose their own level.
    sid = userdb.insert(
        conn, "INSERT INTO ql_students (email, name, pw_hash, grade, profile, created_at, last_seen) VALUES (?,?,?,?,?,?,?)",
        (email, name, generate_password_hash(password), entry["grade"] if entry else None, "{}", now, now))
    conn.commit()
    row = conn.execute("SELECT * FROM ql_students WHERE id=?", (sid,)).fetchone()
    conn.close()
    _sign_in(sid)
    return jsonify({"student": _public(row, me=True)})


@bp.route("/api/auth/login", methods=["POST"])
def login():
    data = _body()
    email = str(data.get("email") or "").strip().lower()
    security.rate_limit("login", 600, 15 * 60)
    # Only wrong passwords count towards an email's limit.
    security.rate_limit("login-email", 8, 15 * 60, key=email, count=False)
    conn = userdb.connect()
    row = conn.execute("SELECT * FROM ql_students WHERE email=?", (email,)).fetchone()
    conn.close()
    if not row or not check_password_hash(row["pw_hash"], str(data.get("password") or "")):
        security.rate_note("login-email", key=email)
        abort(401, "Wrong email or password.")
    _sign_in(row["id"])
    return jsonify({"student": _public(row, me=True)})


@bp.route("/api/auth/logout", methods=["POST"])
def logout():
    session.pop("student_id", None)
    return jsonify({"ok": True})


@bp.route("/api/me", methods=["PUT"])
def update_me():
    """Choose level (grade + track) and/or save the QuestLearn profile."""
    row = _require_student()
    data = _body()
    grade, track, profile = row["grade"], row["track"], json.loads(row["profile"] or "{}")
    if "grade" in data or "track" in data:
        try:
            grade = int(data.get("grade", grade))
        except (TypeError, ValueError):
            abort(400, "bad grade")
        track = str(data.get("track", track) or "")
        if not _group(grade, track):
            abort(400, "Choose a grade from 9 to 12 and a track.")
    now = time.time()
    if isinstance(data.get("profile"), dict):
        profile = checked_profile(profile, data["profile"], now - (row["profile_at"] or row["created_at"] or now))
    name = re.sub(r"\s+", " ", str(data.get("name") or row["name"])).strip()[:40] or row["name"]
    saved = json.dumps(profile)
    if len(saved) > 200_000:
        abort(413, "Your saved progress is too large.")
    conn = userdb.connect()
    conn.execute("UPDATE ql_students SET name=?, grade=?, track=?, profile=?, score=?, level=?, profile_at=? WHERE id=?",
                 (name, grade, track, saved, int(profile.get("score") or 0), max(1, int(profile.get("level") or 1)),
                  now, row["id"]))
    conn.commit()
    row = conn.execute("SELECT * FROM ql_students WHERE id=?", (row["id"],)).fetchone()
    conn.close()
    return jsonify({"student": _public(row, me=True)})


XP_PER_SECOND = 15   # well above what answering questions can earn (see scoring.js)
SCORE_PER_SECOND = 200
INT_FIELDS = ("level", "xp", "totalXp", "score", "streak", "bestStreak", "answered", "correct")


def xp_to_next(level):
    return 100 + (level - 1) * 50  # same as state.js


def level_for(total_xp):
    level, rest = 1, total_xp
    while rest >= xp_to_next(level):
        rest -= xp_to_next(level)
        level += 1
    return level, rest


def checked_profile(old, new, elapsed):
    """The browser reports quiz progress; keep it believable. Numbers are made
    whole and non-negative, gains are capped by the time since the last save,
    and level is recomputed from total XP, so editing the saved profile in the
    browser can't jump a student up the leaderboard or the arena."""
    out = dict(new)
    for f in INT_FIELDS:
        try:
            out[f] = max(0, int(new.get(f) or 0))
        except (TypeError, ValueError):
            out[f] = 0
    elapsed = max(0.0, min(elapsed, 3600.0))
    prev = {f: max(0, int(old.get(f) or 0)) for f in ("totalXp", "score", "answered")}
    out["totalXp"] = min(out["totalXp"], prev["totalXp"] + 400 + int(XP_PER_SECOND * elapsed))
    reset = out["totalXp"] == 0 and out["answered"] == 0  # "Reset progress" on the hub
    if out["totalXp"] < prev["totalXp"] - 300 and not reset:
        # Far below the saved total (skips only take a little): an old copy, e.g. a tab
        # open from before the admin set the level. Keep the server's total.
        out["totalXp"] = prev["totalXp"]
    out["score"] = min(out["score"], prev["score"] + 2000 + int(SCORE_PER_SECOND * elapsed))
    out["answered"] = min(out["answered"], prev["answered"] + 20 + int(elapsed))
    out["correct"] = min(out["correct"], out["answered"])
    out["bestStreak"] = min(out["bestStreak"], out["correct"])
    out["streak"] = min(out["streak"], out["bestStreak"])
    out["level"], out["xp"] = level_for(out["totalXp"])
    return out


# ---------------------------------------------------------------------- groups
@bp.route("/api/groups")
def groups():
    """Every group with how many students are in it and online now."""
    conn = userdb.connect()
    rows = conn.execute("SELECT grade, track, last_seen FROM ql_students WHERE grade IS NOT NULL").fetchall()
    conn.close()
    now, out = time.time(), {}
    for g in GRADES:
        for t in TRACK_NAMES:
            out[f"{g}-{t}"] = {**_group(g, t), "members": 0, "online": 0}
    for r in rows:
        grp = out.get(f"{r['grade']}-{r['track']}")
        if grp:
            grp["members"] += 1
            grp["online"] += bool(r["last_seen"]) and now - r["last_seen"] < ONLINE_SECONDS
    return jsonify({"groups": list(out.values())})


@bp.route("/api/groups/<gid>")
def group(gid):
    """A group's play area: its members (online first) and leaderboard."""
    m = re.match(r"^(\d+)-(\w+)$", gid)
    info = m and _group(int(m.group(1)), m.group(2))
    if not info:
        abort(404)
    current_student()  # counts as activity
    conn = userdb.connect()
    rows = conn.execute("SELECT * FROM ql_students WHERE grade=? AND track=? ORDER BY score DESC, name",
                        (info["grade"], info["track"])).fetchall()
    conn.close()
    members = [_public(r) for r in rows]
    board = [m for m, r in zip(members, rows) if not r["hidden"]][:20]
    for i, m in enumerate(board):
        m["rank"] = i + 1
    members.sort(key=lambda m: (not m["online"], m["name"].lower()))
    return jsonify({**info, "members": members, "leaderboard": board,
                    "online": sum(m["online"] for m in members)})


# -------------------------------------------------------------------- feedback
@bp.route("/api/ql/feedback", methods=["POST"])
def feedback():
    """A student's note about a question (or the site in general). With
    `recheck`, AI re-grades their answer first and the verdict is stored too."""
    data = _body()
    row = current_student()
    ref = str(data.get("ref") or "")[:40] or None
    answer = str(data.get("answer") or "")[:300] or None
    message = str(data.get("message") or "").strip()[:1500]
    category = str(data.get("category") or "other")[:30]
    if not message and not data.get("recheck"):
        abort(400, "Write a short message.")
    if data.get("recheck"):
        security.ai_guard("ai-recheck", 40, 10 * 60)
    verdict = _recheck(ref, answer, message) if data.get("recheck") and ref and answer else None
    conn = userdb.connect()
    fid = userdb.insert(
        conn, "INSERT INTO ql_feedback (student_id, student_name, ref, category, message, answer, ai_verdict, created_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (row["id"] if row else None, row["name"] if row else (str(data.get("name") or "")[:40] or None),
         ref, category, message, answer, json.dumps(verdict) if verdict else None, time.time()))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "id": fid, "verdict": verdict})


# ----------------------------------------------------------------------- admin
@bp.route("/api/admin/students")
def admin_students():
    _require_admin()
    conn = userdb.connect()
    rows = conn.execute("SELECT * FROM ql_students ORDER BY grade, track, score DESC").fetchall()
    conn.close()
    out = []
    for r in rows:
        s = _public(r)
        s.update(email=r["email"], hidden=bool(r["hidden"]), created_at=r["created_at"], last_seen=r["last_seen"],
                 all_gear=bool(r["all_gear"]) if "all_gear" in r.keys() else False)
        out.append(s)
    return jsonify({"students": out})


@bp.route("/api/admin/students/<int:sid>", methods=["PUT", "DELETE"])
def admin_student(sid):
    """PUT {hidden} hides/shows on the leaderboard, {password} resets it,
    {grade, track} moves groups, {level} sets the level (admin only) and
    {all_gear} unlocks every Armory item (admin only). DELETE removes the account."""
    _require_admin()
    data = _body()
    if request.method == "DELETE" or data.get("password") or "level" in data or "all_gear" in data:
        security.require_owner()  # teachers can hide and move students, not delete or reset them
    conn = userdb.connect()
    if not conn.execute("SELECT 1 FROM ql_students WHERE id=?", (sid,)).fetchone():
        conn.close()
        abort(404)
    if request.method == "DELETE":
        conn.execute("DELETE FROM ql_students WHERE id=?", (sid,))
    else:
        if "hidden" in data:
            conn.execute("UPDATE ql_students SET hidden=? WHERE id=?", (int(bool(data["hidden"])), sid))
        if data.get("password"):
            if len(str(data["password"])) < 8:
                conn.close()
                abort(400, "Passwords need at least 8 characters.")
            conn.execute("UPDATE ql_students SET pw_hash=? WHERE id=?",
                         (generate_password_hash(str(data["password"])), sid))
        if "level" in data:
            try:
                level = int(data["level"])
            except (TypeError, ValueError):
                level = 0
            if not 1 <= level <= 100:
                conn.close()
                abort(400, "Choose a level from 1 to 100.")
            row = conn.execute("SELECT profile FROM ql_students WHERE id=?", (sid,)).fetchone()
            try:
                profile = json.loads(row["profile"] or "{}")
            except ValueError:
                profile = {}
            profile.update(totalXp=sum(xp_to_next(n) for n in range(1, level)), level=level, xp=0)
            conn.execute("UPDATE ql_students SET profile=?, level=? WHERE id=?", (json.dumps(profile), level, sid))
        if "all_gear" in data:
            conn.execute("UPDATE ql_students SET all_gear=? WHERE id=?", (int(bool(data["all_gear"])), sid))
        grade = str(data.get("grade") or "")
        if grade.isdigit() and _group(int(grade), str(data.get("track") or "")):
            conn.execute("UPDATE ql_students SET grade=?, track=? WHERE id=?", (int(data["grade"]), data["track"], sid))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


def _track_for(cluster):
    c = str(cluster or "").strip().lower()
    return "asp" if c == "asp" else "general" if c == "general" else "advanced"


@bp.route("/api/admin/roster", methods=["GET", "POST"])
def admin_roster():
    """GET: how many students are on the school list, per grade.
    POST (multipart `file`, .xlsx or .csv): replace the list. Columns are found by
    header name (Email, Full Name English, Section, Cluster, Students ID); the
    grade comes from a Grade column or a sheet named like G09."""
    _require_admin()
    if request.method == "POST":
        security.require_owner()
    conn = userdb.connect()
    if request.method == "POST":
        f = request.files.get("file")
        if not f:
            conn.close()
            abort(400, "Choose a file.")
        try:
            rows = _parse_roster(f.filename or "", f.read())
        except Exception as e:  # malformed upload
            conn.close()
            abort(400, f"Couldn't read that file: {e}")
        if not rows:
            conn.close()
            abort(400, "No students with an email column were found.")
        conn.execute("DELETE FROM ql_roster")
        conn.executemany(
            "INSERT INTO ql_roster (email, student_no, name, name_ar, grade, section, cluster, track) "
            "VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (email) DO UPDATE SET student_no=excluded.student_no, "
            "name=excluded.name, name_ar=excluded.name_ar, grade=excluded.grade, section=excluded.section, "
            "cluster=excluded.cluster, track=excluded.track", rows)
        conn.commit()
    counts = {r["grade"]: r["n"] for r in conn.execute("SELECT grade, COUNT(*) AS n FROM ql_roster GROUP BY grade")}
    total = sum(counts.values())
    conn.close()
    return jsonify({"total": total, "grades": counts})


def _parse_roster(filename, data):
    import csv
    import io
    sheets = []
    if filename.lower().endswith(".csv"):
        sheets.append(("", list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))))
    else:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        sheets = [(ws.title, list(ws.iter_rows(values_only=True))) for ws in wb.worksheets]
    out = []
    for title, rows in sheets:
        if not rows:
            continue
        head = [str(h or "").strip().lower() for h in rows[0]]
        col = lambda *names: next((i for i, h in enumerate(head) if any(n in h for n in names)), None)
        ce, cn, car, cs, cc, cid, cg = (col("email"), col("name english", "full name", "name"), col("arabic"),
                                        col("section"), col("cluster", "track"), col("id"), col("grade"))
        if ce is None:
            continue
        sheet_grade = re.search(r"(\d{1,2})", title)
        for r in rows[1:]:
            cell = lambda i: str(r[i]).strip() if i is not None and i < len(r) and r[i] is not None else ""
            email = cell(ce).lower()
            if not EMAIL.match(email):
                continue
            grade = cell(cg) or (sheet_grade.group(1) if sheet_grade else "")
            grade = int(grade) if grade.isdigit() and int(grade) in GRADES else None
            out.append((email, cell(cid), cell(cn), cell(car), grade, cell(cs), cell(cc), _track_for(cell(cc))))
    return out


@bp.route("/api/admin/feedback")
def admin_feedback():
    _require_admin()
    conn = userdb.connect()
    rows = conn.execute("SELECT * FROM ql_feedback ORDER BY resolved, id DESC LIMIT 500").fetchall()
    conn.close()
    return jsonify({"feedback": [{**dict(r), "ai_verdict": json.loads(r["ai_verdict"]) if r["ai_verdict"] else None}
                                 for r in rows]})


@bp.route("/api/admin/feedback/<int:fid>", methods=["PUT"])
def admin_feedback_resolve(fid):
    _require_admin()
    conn = userdb.connect()
    conn.execute("UPDATE ql_feedback SET resolved=? WHERE id=?", (int(bool(_body().get("resolved", True))), fid))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------- staff
@bp.route("/api/admin/staff", methods=["GET", "POST"])
def admin_staff():
    """The admin's teacher accounts. POST {email, name, password} adds one or
    sets a new password; teachers sign in on the admin page with their email."""
    security.require_owner()
    conn = userdb.connect()
    if request.method == "POST":
        data = _body()
        email = str(data.get("email") or "").strip().lower()
        name = re.sub(r"\s+", " ", str(data.get("name") or "")).strip()[:60]
        password = str(data.get("password") or "")
        if not EMAIL.match(email) or not name:
            conn.close()
            abort(400, "Enter the teacher's name and email.")
        if len(password) < 10:
            conn.close()
            abort(400, "Teacher passwords need at least 10 characters.")
        conn.execute("INSERT INTO ql_staff (email, name, pw_hash, created_at) VALUES (?,?,?,?) "
                     "ON CONFLICT (email) DO UPDATE SET name=excluded.name, pw_hash=excluded.pw_hash",
                     (email, name, generate_password_hash(password), time.time()))
        conn.commit()
    rows = conn.execute("SELECT id, email, name, created_at FROM ql_staff ORDER BY name").fetchall()
    conn.close()
    return jsonify({"staff": [dict(r) for r in rows]})


@bp.route("/api/admin/staff/<int:tid>", methods=["DELETE"])
def admin_staff_delete(tid):
    security.require_owner()
    conn = userdb.connect()
    conn.execute("DELETE FROM ql_staff WHERE id=?", (tid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

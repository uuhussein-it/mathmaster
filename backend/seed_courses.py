"""Parse all uploaded course practice PDFs and seed the course DB tables.

Usage:
    python3 seed_courses.py   # walks the OneDrive download dir

Produces:
  * data/course_imgs/{code}_t{topic}_s{subtopic}_{qnum}.png  (screenshots)
  * db rows in courses/course_topics/course_subtopics/course_questions
"""
import glob
import os
import re
import sys

import fitz

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import course_parser as cp
import db

SRC = os.environ.get(
    "COURSE_SRC",
    "/Users/hussein/Downloads/OneDrive_2_9-28-2026",
)
IMG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "course_imgs")

COURSE_META = {
    "MAT41": (9, "ADV", "Equations"),   # placeholder, replaced below
}
# (code, grade, branch)
COURSES = [
    ("MAT41", 9, "Advanced"),
    ("MAT40A", 9, "ASP"),
    ("MAT50", 10, "General"),
    ("MAT51", 10, "Advanced"),
    ("MAT50A", 10, "ASP"),
    ("MAT60", 11, "General"),
    ("MAT61", 11, "Advanced"),
    ("MAT60A", 11, "ASP"),
    ("MAT70", 12, "General"),
    ("MAT71", 12, "Advanced"),
    ("MAT70A", 12, "ASP"),
]
COURSE_BY_CODE = {c[0]: c for c in COURSES}


def partner(akf):
    folder = os.path.dirname(akf)
    b = os.path.basename(akf)
    root = re.sub(r"[-. ]*A\.?K\s*\.pdf$", "", b, flags=re.I)
    for ext in ["QP", "Q.P", "Q"]:
        for cand in [os.path.join(folder, root + " -" + ext + ".pdf"),
                     os.path.join(folder, root + "-" + ext + ".pdf")]:
            if os.path.exists(cand):
                return cand
    cands = [x for x in glob.glob(os.path.join(folder, root + "*"))
             if re.search(r"Q\.?P?\.pdf$", x, re.I)]
    return cands[0] if cands else None


def topic_no_from(base):
    m = re.search(r"Topic\s*(\d+)", os.path.basename(base))
    return int(m.group(1)) if m else 0


def seed():
    db.init_db()
    os.makedirs(IMG_DIR, exist_ok=True)
    df = db.get_conn()
    df.execute("DELETE FROM course_session_results")
    df.execute("DELETE FROM course_sessions")
    df.execute("DELETE FROM course_questions")
    df.execute("DELETE FROM course_subtopics")
    df.execute("DELETE FROM course_topics")
    df.execute("DELETE FROM courses")
    df.commit()
    count = img_count = 0
    topic_stats = {}
    done_ak = set()
    for akf in sorted(glob.glob(os.path.join(SRC, "**", "Practice Questions", "*.pdf"), recursive=True)):
        if not re.search(r"A\.?K\s*\.pdf$", akf, re.I):
            continue
        if os.path.normpath(akf) in done_ak:
            continue
        qpf = partner(akf)
        if not qpf or not os.path.exists(qpf):
            continue
        done_ak.add(os.path.normpath(akf))
        done_ak.add(os.path.normpath(qpf))
        base = os.path.basename(qpf)
        m = re.match(r"(MAT\d+[A-Z]?)", base)
        if not m or m.group(1) not in COURSE_BY_CODE:
            continue
        code = m.group(1)
        grade, branch = COURSE_BY_CODE[code][1], COURSE_BY_CODE[code][2]
        tno = topic_no_from(qpf)
        tid_label = f"{code}-Topic {tno}"
        try:
            qp = fitz.open(qpf)
            ak = fitz.open(akf)
        except Exception as e:
            print("  OPEN ERR", base, e)
            continue
        qs = cp.parse_qp(qp)
        if not qs:
            qp.close(); ak.close()
            print("  0 QUESTIONS", base)
            continue
        ans = cp.extract_answers(ak, qp, qs)
        cid = db.upsert_course(code, grade, branch, code)
        name = re.sub(rf"^{re.escape(m.group(1))}-", "", base)
        name = re.sub(r"[-QP\.pdf]+$", "", name)
        name = re.sub(r"[- ]+$", "", name)
        tid = db.upsert_course_topic(cid, tno, f"Topic {tno}")
        # subtopic -> questions, preserving order
        subtopics = {}
        for q in qs:
            subtopics.setdefault(q["subtopic_ref"], q["subtopic_name"])
        sid_map = {}
        for ref, sname in subtopics.items():
            sid_map[ref] = db.upsert_course_subtopic(cid, tid, ref, sname or f"Subtopic {ref}")
        ok = 0
        for q, a in zip(qs, ans):
            ref = q["subtopic_ref"]
            sid = sid_map.get(ref)
            is_mcq = q["is_mcq"]
            opts = [q["options"].get(k) for k in "ABCDEF"]
            img = os.path.join(IMG_DIR, f"{code}_t{tno}_s{ref}_{q['number']}.png")
            done = cp.render_screen(qp, q, img)
            if done:
                img_count += 1
            rel_img = os.path.join("data", "course_imgs", os.path.basename(img))
            db.upsert_course_question(cid, sid, q["number"], q["prompt"], opts, a or "", is_mcq, rel_img)
            count += 1
            if a:
                ok += 1
        topic_stats[tid_label] = (len(qs), ok)
        print(f"{tid_label:22} {len(qs):>3} q  ans {ok*100//len(qs):>3}%  imgs ok")
        qp.close(); ak.close()
    db.init_db()
    print()
    print(f"SEEDED questions: {count}")
    print(f"SCREENSHOTS written: {img_count}")
    total = sum(v[0] for v in topic_stats.values())
    has = sum(v[1] for v in topic_stats.values())
    print(f"answer coverage: {has*100//total}%")


if __name__ == "__main__":
    seed()
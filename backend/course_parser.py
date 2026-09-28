"""Parse UAE Grades 9-12 course Practice Question papers (QP) with their
Answer Keys (AK) into structured questions + screenshot regions.

Layout facts (verified against MAT41/MAT51/MAT50/MAT60/MAT70/AK PDFs):
  * A4 portrait, single text column, footer line at y~809 ("Topic-N / Page
    X of Y / MATxx").
  * "Subtopic X.Y Name" lines start the question blocks of a subtopic.
  * Question markers match ^\\d{1,2}\\. at x<95; numbering restarts at 1
    for every subtopic.
  * MCQ options are lines whose leading token is [A-F]. at x in 60-115.
  * The AK is the same document with answers inserted: MCQ options are
    preceded by a "ü" line; free-response answers appear as added text.

Each question gets a rect (page idx, y0, y1 x0=36 x1~560) used to render a
PNG of the printed question paper region.
"""
import os
import re
import json
import difflib

import fitz

FOOTER_Y = 795
PAGE_W = 595.2
MARGIN = 36


def slug(s):
    return re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-")


def build_lines(page):
    """Ordered list of logical lines: {y, tokens, text, x0}."""
    ws = sorted(page.get_text("words"), key=lambda w: (w[1], w[0]))
    bands = {}
    for w in ws:
        if w[3] > FOOTER_Y:  # skip header/footer band
            continue
        k = round(w[1] / 4)
        bands.setdefault(k, []).append(w)
    out = []
    for k in sorted(bands):
        row = sorted(bands[k], key=lambda w: w[0])
        text = " ".join(w[4] for w in row).strip()
        if not text:
            continue
        out.append(
            {
                "y0": row[0][1],
                "y1": row[-1][3],
                "x0": row[0][0],
                "x1": row[-1][2],
                "text": text,
            }
        )
    return out


def classify(line):
    t = line["text"]
    m = re.match(r"^Subtopic\s+([\d.]+)\s+(.*)$", t)
    if m:
        return ("subtopic", m.group(1), m.group(2).strip())
    m = re.match(r"^(\d{1,2})\.\s+(.*)$", t)
    if m and line["x0"] < 95:
        return ("qmark", int(m.group(1)), m.group(2))
    m = re.match(r"^([A-F])(?:\.|\s+)\s*(.*)$", t)
    if m and line["x0"] < 120:
        return ("option", m.group(1), m.group(2).strip())
    return ("text", None, t)


def parse_qp(doc):
    """Return list of questions:
    {page, y0, y1, subtopic_ref, subtopic_name, number, prompt,
     options: {letter: text}, is_mcq}
    """
    questions = []
    cur_sub = ("", "")
    pending_num = None
    cur_sub_first = True  # first marker after a subtopic header is accepted
    for pi in range(len(doc)):
        for ln in build_lines(doc[pi]):
            kind, a, b = classify(ln)
            if kind == "subtopic":
                cur_sub = (a, b)
                pending_num = None
                cur_sub_first = True
            elif kind == "qmark":
                # two-column proofs renumber steps from 1 mid-question; only
                # accept contiguous numbers within a subtopic.
                expected = 1 if cur_sub_first else (pending_num + 1 if pending_num else 1)
                if a != expected:
                    continue
                cur_sub_first = False
                q = {
                    "page": pi,
                    "y0": ln["y0"] - 3,
                    "y1": None,
                    "subtopic_ref": cur_sub[0],
                    "subtopic_name": cur_sub[1],
                    "number": a,
                    "prompt": b,
                    "options": {},
                    "is_mcq": False,
                }
                questions.append(q)
                pending_num = a
            elif kind == "option" and questions and pending_num is not None:
                questions[-1]["options"][a] = b
                questions[-1]["is_mcq"] = True
            elif kind == "text":
                if questions and pending_num is not None:
                    nxt = questions[-1]["prompt"] + " " + b
                    questions[-1]["prompt"] = nxt
    # same-page upper bounds: y1 = next marker top on the same page
    for q, nxt in zip(questions, questions[1:]):
        if q["y1"] is None and nxt["page"] == q["page"]:
            q["y1"] = nxt["y0"] - 4
    for q in questions:
        if q["y1"] is None:
            q["y1"] = 788
        if q["y1"] <= q["y0"]:
            q["y1"] = 788
    return questions


def _ak_regions(ak_doc, qlist):
    """For each qp question, find AK marker position to bound the answer
    region. Returns dict {idx: (page, top_y, bot_y)} using AK markers."""
    ak_markers = []  # (page, idx_within_page, number, y0)
    for pi in range(len(ak_doc)):
        for li, ln in enumerate(build_lines(ak_doc[pi])):
            kind, a, b = classify(ln)
            if kind == "qmark":
                ak_markers.append((pi, a, ln["y0"]))
    out = {}
    for i, q in enumerate(qlist):
        if i >= len(ak_markers):
            out[i] = (q["page"], q["y0"], q["y1"])
            continue
        apg, anum, a_y = ak_markers[i]
        top = a_y - 3
        bot = (
            ak_markers[i + 1][2] - 4
            if i + 1 < len(ak_markers)
            and ak_markers[i + 1][0] == apg
            else (ak_doc[min(apg, len(ak_doc) - 1)].rect.y1 - 4)
        )
        out[i] = (apg, top, bot)
    return out


def _full_ak_inserts(ak_doc, qp_doc, qlist):
    """Diff whole QP vs whole AK documents; return per-question inserted
    (answer) lines. Question index of an AK line = number of question
    markers seen up to and excluding it in AK reading order."""
    qp_lines = []
    for pi in range(len(qp_doc)):
        for ln in build_lines(qp_doc[pi]):
            qp_lines.append(ln)
    ak_lines = []
    for pi in range(len(ak_doc)):
        for ln in build_lines(ak_doc[pi]):
            ak_lines.append(ln)

    qp_keys = [f"{classify(ln)[0]}:{classify(ln)[1]}:{classify(ln)[2]}" for ln in qp_lines]
    ap_keys = [f"{classify(ln)[0]}:{classify(ln)[1]}:{classify(ln)[2]}" for ln in ak_lines]

    qcount = []
    n = 0
    for ln in ak_lines:
        qcount.append(n)
        if classify(ln)[0] == "qmark":
            n += 1
    tot_ak_qmarks = n

    sm = difflib.SequenceMatcher(None, qp_keys, ap_keys, autojunk=False)
    buckets = [[] for _ in qlist]
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "insert":
            for j in range(j1, j2):
                k, a, b = classify(ak_lines[j])
                qi = qcount[j]
                if qi >= len(buckets):
                    continue
                if k == "qmark":
                    continue
                blk = ak_lines[j]["text"].strip()
                if blk and blk != "ü" and "^" not in blk:
                    buckets[qi].append(blk)
        elif tag == "replace":
            for j in range(j1, j2):
                k, a, b = classify(ak_lines[j])
                qi = qcount[j]
                if qi >= len(buckets):
                    continue
                blk = ak_lines[j]["text"].strip()
                if blk and blk != "ü" and "^" not in blk and classify(ak_lines[j])[0] != "qmark":
                    buckets[qi].append(blk)
    return buckets


def extract_answers(ak_doc, qp_doc, qlist):
    """Correct answer per question: letter(s) for MCQ, text for FR."""
    regions = _ak_regions(ak_doc, qlist)
    fr_buckets = _full_ak_inserts(ak_doc, qp_doc, qlist)
    answers = []
    for i, q in enumerate(qlist):
        if q["is_mcq"]:
            pg, top, bot = regions[i]
            if pg >= len(ak_doc):
                answers.append(None)
                continue
            clip = fitz.Rect(MARGIN, max(top - 14, 0), PAGE_W - 20, min(bot + 8, 790))
            aktext = ak_doc[pg].get_text("text", clip=clip)
            marks = re.findall(r"ü\s*\n?\s*([A-F])\.", aktext)
            if not marks:
                marks = re.findall(r"ü\s*([A-F])\b", aktext)
            if not marks:
                marks = re.findall(r"ü\s*\n?\s*([A-F])\b", aktext)
            answers.append("".join(marks) if marks else None)
        else:
            vals = fr_buckets[i] if i < len(fr_buckets) else []
            answers.append(" | ".join(vals).strip() or None)
    return answers


def _minus(aktext, qptext):
    """Remove the QP content lines from AK text via sequence diff."""
    ak_lines = [l for l in aktext.split("\n") if l.strip()]
    qued = [l for l in qptext.split("\n") if l.strip()]
    sm = difflib.SequenceMatcher(None, qued, ak_lines, autojunk=False)
    added = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "insert":
            for block in ak_lines[j1:j2]:
                if "^" not in block and block not in ("ü",):
                    added.append(block.strip())
    return " | ".join(added).strip()


def render_screen(doc, q, out_path, scale=3):
    """Crop the QP region for one question and save PNG."""
    pg = doc[q["page"]]
    clip = fitz.Rect(MARGIN, q["y0"], PAGE_W - 20, q["y1"]) & pg.rect
    if clip.is_empty or clip.height < 14:
        return False
    pix = pg.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    pix.save(out_path)
    return True
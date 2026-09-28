"""Render each MathBook 2.5 question (prompt + printed options) as a PNG.

Filenames are data/question_imgs/{slug}_{number}.png, keyed by (subtopic,
number) so DB reseeds never orphan them. This drives the "printed" view:
a gapless, faithful reproduction of how the question looked in the book.

Layout facts relied on:
  * Each section renumbers questions from 1, one section per page range.
  * Question markers ("N.") are the first token of their line within a
    column (x~42 left, x~309 right); axis labels like "x 4 8 12 16 20."
    are rejected because they never lead a line in those bands.
  * Columns flow left then right per page and numbers are contiguous 1..N.
  * Option blocks from /tmp/options.txt carry per-cell coordinates, reliable
    for the lower bound even when an option grid spans both columns.

A validation pass reports candidates for manual review (content clipped or
touching the page bottom, no option block and no clean next-marker bound).
"""
import os
import re
import sqlite3

import fitz

PDF = os.environ.get("MATHBOOK_PDF", "/Users/hussein/Downloads/MathBook 2.5.pdf")
QLINES = os.environ.get("MATHBOOK_TXT", "/tmp/book25_v3.txt")
BLOCKS = os.environ.get("MATHBOOK_OPTIONS", "/tmp/options.txt")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "question_imgs")
DB = os.path.join(os.path.dirname(__file__), "..", "data", "sat.db")
COL_SPLIT = 296
LEFT = (38, 296)
RIGHT = (296, 558)


def slug(name):
    return re.sub(r"[^A-Za-z]", "", name)


def section_specs():
    conn = sqlite3.connect(DB)
    rows = conn.execute(
        """SELECT s.name, COUNT(*) n FROM subtopics s
           JOIN questions q ON q.subtopic_id=s.id GROUP BY s.id ORDER BY s.id"""
    ).fetchall()
    conn.close()
    return rows


def find_anchors(doc):
    anchors = []
    for idx in range(len(doc)):
        for ln in doc[idx].get_text().split("\n"):
            if re.match(r"^\s*1\.\s*\[", ln):
                anchors.append(idx)
                break
    return anchors


def page_markers(doc, idx):
    words = doc[idx].get_text("words")
    cands = []
    for w in words:
        m = re.fullmatch(r"(\d{1,3})\.", w[4])
        if not m:
            continue
        x0, y0, y1 = w[0], w[1], w[3]
        col = 0 if x0 < COL_SPLIT else 1
        same = [u for u in words if (u[0] < COL_SPLIT) == (col == 0) and u[1] < y0 + 2 and u[3] > y1 - 2]
        if not same:
            continue
        minx = min(u[0] for u in same)
        band = (20 <= minx <= 65) if col == 0 else (COL_SPLIT <= minx <= 345)
        if not band:
            continue
        cands.append((col, y0, int(m.group(1))))
    cands.sort(key=lambda c: (c[0], c[1]))
    return cands


def assign_markers(doc, specs, anchors):
    """(subtopic,qnum)->(page, col, marker_y); per-page ordered marker lists."""
    per_q = {}
    order = {}
    for si, (name, nq) in enumerate(specs):
        start = anchors[si]
        end = anchors[si + 1] if si + 1 < len(anchors) else len(doc)
        nxt = 1
        for idx in range(start, end):
            ms = page_markers(doc, idx)
            order[idx] = ms
            for col, y, num in ms:
                if num == nxt:
                    per_q[(name, nxt)] = (idx + 1, col, y)
                    nxt += 1
                    if nxt > nq:
                        break
            if nxt > nq:
                break
    return per_q, order


def load_blocks_with_coords():
    """{page: [ {letter:(x,y), opts:{letter:str}} ]} in reading order."""
    out = {}
    for line in open(BLOCKS, encoding="utf-8"):
        line = line.rstrip("\n")
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        p = int(parts[0].split()[1])
        coords, opts = {}, {}
        for chunk in parts[1].split("|"):
            m = re.match(r"([A-D])\+(-?\d+)\+(-?\d+)", chunk)
            if m:
                coords[m.group(1)] = (int(m.group(2)), int(m.group(3)))
        for chunk in parts[2].split("|"):
            if "=" in chunk:
                k, v = chunk.split("=", 1)
                opts[k] = v
        out.setdefault(p, []).append({"coords": coords, "opts": opts})
    return out


def qnum_block_map():
    """(section_index, qnum) -> option block dict (with cell coords)."""
    import merge_options as mo

    lines = open(QLINES, encoding="utf-8").read().split("\n")
    slots = mo.build_slots(lines)
    blocks_by_page = load_blocks_with_coords()
    ordered, counts = [], {}
    for p in sorted(blocks_by_page):
        for b in blocks_by_page[p]:
            ordered.append((p, counts.get(p, 0), b))
            counts[p] = counts.get(p, 0) + 1
    bi = 0
    q2block = {}
    for (p, seq), (sec, qnum) in sorted(slots.items()):
        while bi < len(ordered) and ordered[bi][:2] < (p, seq):
            bi += 1
        if bi < len(ordered) and ordered[bi][:2] == (p, seq):
            q2block[(sec, qnum)] = ordered[bi][2]
            bi += 1
    return q2block


def ink_bbox(doc, idx, rect, step=2):
    clip = fitz.Rect(rect)
    pix = doc[idx].get_pixmap(matrix=fitz.Matrix(1, 1), clip=clip)
    w, h, n = pix.width, pix.height, pix.n
    s = pix.samples
    x0 = y0 = 1e9
    x1 = y1 = -1
    found = False
    for y in range(0, h, step):
        for x in range(0, w, step):
            i = (y * w + x) * n
            if max(s[i:i + 3]) < 205:
                found = True
                x0 = min(x0, x)
                x1 = max(x1, x)
                y0 = min(y0, y)
                y1 = max(y1, y)
    if not found:
        return None
    return (clip.x0 + x0, clip.y0 + y0, clip.x0 + x1, clip.y0 + y1)


def question_rect(doc, per_q, order, blocks_by_q, spec_idx, name, num):
    info = per_q.get((name, num))
    if not info:
        return None, "no-marker"
    page, col, my = info
    idx = page - 1
    xs = [LEFT if col == 0 else RIGHT]
    block = blocks_by_q.get((spec_idx[name], num))
    bottom_hint = 760
    if block:
        ys = [by for _, by in block["coords"].values()]
        if ys and max(ys) >= my - 10:
            for bx, by in block["coords"].values():
                xr = (38, 296) if bx < 296 else (296, 558)
                if xr not in xs:
                    xs.append(xr)
            bottom_hint = max(ys) + 55
        else:
            block = None
    if not block:
        for c, y, _ in order.get(idx, []):
            if c == col and y > my:
                bottom_hint = y - 4
                break

    x0 = min(lo for lo, _ in xs)
    x1 = max(hi for _, hi in xs)
    pg = doc[idx].rect
    search = fitz.Rect(x0 - 4, my - 3, x1 + 4, min(bottom_hint + 40, pg.y1)) & pg
    bbox = ink_bbox(doc, idx, search)
    if not bbox:
        return None, "no-ink"
    issues = []
    if bbox[3] >= pg.y1 - 3:
        issues.append("touches-page-bottom")
    if bbox[0] <= search.x0 + 1 or bbox[2] >= search.x1 - 1:
        issues.append("clipped-horiz")
    crop = (max(search.x0, bbox[0] - 2), search.y0, min(search.x1, bbox[2] + 2), min(bbox[3] + 2, pg.y1))
    return crop, issues or None


def render_all():
    os.makedirs(OUT_DIR, exist_ok=True)
    doc = fitz.open(PDF)
    specs = section_specs()
    anchors = find_anchors(doc)
    assert len(anchors) == len(specs), f"anchors {len(anchors)} vs specs {len(specs)}"
    per_q, order = assign_markers(doc, specs, anchors)
    blocks_by_q = qnum_block_map()
    spec_idx = {s[0]: i for i, s in enumerate(specs)}

    count = missed = 0
    flags = []
    for name, nq in specs:
        sl = slug(name)
        for num in range(1, nq + 1):
            rect, issues = question_rect(doc, per_q, order, blocks_by_q, spec_idx, name, num)
            if not rect:
                missed += 1
                flags.append((name, num, "NO-RECT", issues))
                continue
            page = per_q[(name, num)][0]
            clip = fitz.Rect(rect) & doc[page - 1].rect
            if clip.is_empty or clip.width < 5 or clip.height < 15:
                missed += 1
                flags.append((name, num, "EMPTY-CLIP", rect))
                continue
            pix = doc[page - 1].get_pixmap(matrix=fitz.Matrix(3, 3), clip=clip)
            pix.save(os.path.join(OUT_DIR, f"{sl}_{num}.png"))
            count += 1
            if issues:
                flags.append((name, num, issues, rect))
    doc.close()
    print(f"rendered {count} question images; missed {missed}; flagged {len(flags)}")
    for f in flags:
        print("  FLAG", f)
    return flags


if __name__ == "__main__":
    render_all()
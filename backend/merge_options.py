"""Merge coordinate-extracted option blocks into parser questions.

The v3 text extraction (label-split buckets) produces clean options except for
stacked-fraction glyphs and page-boundary spills. The coordinate extractor
(/tmp/options.txt) handles those samplings better. We align option blocks to
questions by (page, reading-order) and use the block's options whenever all
four letters are non-empty; otherwise the text options stand.
"""
import re
from collections import defaultdict

import book25_parser as bp

QNUM_RE = re.compile(r"^(\d{1,3})\.\s*\[")
OPT_RE = re.compile(r"\b[A-D]\)")


def load_blocks(path="/tmp/options.txt"):
    blocks = []
    for line in open(path, encoding="utf-8"):
        line = line.rstrip("\n")
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        p = int(parts[0].split()[1])
        d = {}
        for chunk in parts[2].split("|"):
            if "=" in chunk:
                k, v = chunk.split("=", 1)
                d[k] = v
        blocks.append({"page": p, "opts": d})
    return blocks


def build_slots(qlines):
    """Map (page, seq) -> (section_index, qnum) for first option row of each MCQ."""
    page = None
    cur_q = None
    sec = -1
    seen = set()
    page_seq = defaultdict(int)
    slots = {}
    for l in qlines:
        m = re.match(r"^@@PAGE (\d+)@@$", l)
        if m:
            page = int(m.group(1))
            continue
        if page is None:
            continue
        qm = QNUM_RE.match(l.strip())
        if qm:
            cur_q = int(qm.group(1))
            if cur_q == 1:
                sec += 1
                seen = set()
            continue
        if OPT_RE.search(l) and cur_q is not None and cur_q not in seen:
            seen.add(cur_q)
            key = (page, page_seq[page])
            slots[key] = (sec, cur_q)
            page_seq[page] += 1
    return slots


def align(questions, slots, blocks):
    """Return flat options list aligned to `questions` (in file order)."""
    flat = questions
    flat_pos = {}
    ci = -1
    num2idx = {}
    for i, (name, q) in enumerate(flat):
        n = q["number"]
        if n == 1:
            ci += 1
            num2idx = {}
        num2idx[n] = i
        flat_pos[(ci, n)] = i

    bseq = defaultdict(int)
    ordered_blocks = []
    for b in blocks:
        p = b["page"]
        ordered_blocks.append((p, bseq[p], b))
        bseq[p] += 1

    merged = {}
    # greedy two-pointer over (page, seq): blocks first, then slots
    bi = 0
    for (p, seq), (sec, qnum) in sorted(slots.items()):
        while bi < len(ordered_blocks) and ordered_blocks[bi][:2] < (p, seq):
            bi += 1
        if bi < len(ordered_blocks) and ordered_blocks[bi][:2] == (p, seq):
            block = ordered_blocks[bi][2]["opts"]
            bi += 1
            if all((block.get(k, "") or "").strip() for k in "ABCD"):
                fi = flat_pos.get((sec, qnum))
                if fi is not None:
                    merged[fi] = {k: (block.get(k) or "").strip() for k in "ABCD"}
    return merged


def merge(data, qlines, blocks_path="/tmp/options.txt"):
    """Return {flat_index: {A..D: str}} coordinate options to prefer."""
    slots = build_slots(qlines)
    flat = []
    for s in data:
        for q in s["questions"]:
            flat.append((s["name"], q))
    return align(flat, slots, blocks_path and load_blocks(blocks_path) or [])
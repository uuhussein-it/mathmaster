import re
import fitz

LABEL_RE = re.compile(r"^([A-D])\)$")
COL_SPLIT = 295.0
PAGE_W = 595.0


def _frac(a, b):
    overlap = min(a["x1"], b["x1"]) - max(a["x0"], b["x0"])
    if overlap < 4:
        return None
    if abs(a["xc"] - b["xc"]) > 24:
        return None
    top, bottom = (a, b) if a["y1"] < b["y0"] else (b, a)
    gap = bottom["y0"] - top["y1"]
    if gap > 6 or gap < -10:
        return None
    return f"{top['txt']}/{bottom['txt']}"


def _assemble(toks):
    toks = sorted(toks, key=lambda t: (t["y0"], t["x0"]))
    used = set()
    fracs = []
    for i, a in enumerate(toks):
        if i in used:
            continue
        for j, b in enumerate(toks):
            if j == i or j in used:
                continue
            r = _frac(a, b)
            if r:
                used.add(i)
                used.add(j)
                fracs.append((min(a["y0"], b["y0"]), min(a["x0"], b["x0"]), r))
                break
    parts = []
    for i, t in enumerate(toks):
        if i in used:
            continue
        parts.append((t["y0"], t["x0"], t["txt"]))
    parts.extend(fracs)
    parts.sort(key=lambda t: (t[0], t[1]))
    return " ".join(t[2] for t in parts)


def option_blocks(words):
    labels = [
        {
            "let": m.group(1),
            "x0": w[0],
            "x1": w[2],
            "y0": w[1],
            "y1": w[3],
            "xc": (w[0] + w[2]) / 2,
        }
        for w in words
        if (m := LABEL_RE.match(w[4]))
    ]
    for lab in labels:
        lab["col"] = 0 if lab["x0"] < COL_SPLIT else 1
    blocks = []
    for lab in sorted(labels, key=lambda l: l["y0"]):
        placed = None
        for b in blocks:
            if b["col"] != lab["col"]:
                continue
            prev = max(l["y1"] for l in b["labels"])
            if abs(lab["y1"] - prev) < 70:
                placed = b
                break
        if placed is None:
            blocks.append({"col": lab["col"], "labels": [lab]})
        else:
            placed["labels"].append(lab)
    # split any block that merged two questions (repeated letters)
    final = []
    for b in blocks:
        b["labels"].sort(key=lambda l: l["y0"])
        kept = [b["labels"]]
        for _ in range(10):
            needs_split = False
            for group in kept:
                seen = set()
                for l in group:
                    if l["let"] in seen:
                        needs_split = True
                        break
                    seen.add(l["let"])
                if needs_split:
                    break
            if not needs_split:
                break
            new_kept = []
            for group in kept:
                seen_letters = [l["let"] for l in group]
                if len(seen_letters) != len(set(seen_letters)):
                    split_idx = None
                    for i in range(1, len(group)):
                        if group[i]["y0"] - group[i - 1]["y1"] > 30:
                            split_idx = i
                            break
                    if split_idx:
                        new_kept.append(group[:split_idx])
                        new_kept.append(group[split_idx:])
                    else:
                        new_kept.append(group)
                else:
                    new_kept.append(group)
            if new_kept == kept:
                break
            kept = new_kept
        for group in kept:
            if len(group) >= 2:
                final.append({"labels": group, "col": b["col"]})
    return final


def _row_band(lab, items, idx, first_is_loose=True):
    if idx > 0:
        top = (items[idx - 1]["y0"] + lab["y0"]) / 2
    else:
        top = lab["y0"] - 8
    if idx + 1 < len(items):
        bot = (lab["y0"] + items[idx + 1]["y0"]) / 2
    else:
        bot = lab["y1"] + 40
    return top, bot


def extract_block_options(words, block):
    labels = block["labels"]
    col_left = block["col"] == 0
    lo = max(0, min(l["x0"] for l in labels) - 12) if col_left else COL_SPLIT
    hi = COL_SPLIT if col_left else PAGE_W

    xmin = min(l["x0"] for l in labels)
    xmax = max(l["x0"] for l in labels)
    single = (xmax - xmin) < 70
    if not single:
        mid = (xmax + xmin) / 2

    subs = {}
    for l in labels:
        key = "ONE" if single else ("AB" if l["x0"] < mid else "CD")
        subs.setdefault(key, []).append(l)

    result = {}
    for key, items in subs.items():
        items.sort(key=lambda l: l["y0"])
        if key == "ONE":
            x_lo = lo
            for idx, lab in enumerate(items):
                top, bot = _row_band(lab, items, idx)
                toks = []
                for w in words:
                    if w[4] and LABEL_RE.match(w[4]):
                        continue
                    if w[0] < x_lo or w[2] > hi:
                        continue
                    yc = (w[1] + w[3]) / 2
                    if yc < top or yc > bot:
                        continue
                    toks.append(
                        {
                            "x0": w[0],
                            "x1": w[2],
                            "y0": w[1],
                            "y1": w[3],
                            "xc": (w[0] + w[2]) / 2,
                            "txt": w[4],
                        }
                    )
                result[lab["let"]] = _assemble(toks)
        else:
            sub_lo = min(l["x0"] for l in items) - 10
            sub_hi = mid if key == "AB" else hi
            for idx, lab in enumerate(items):
                top, bot = _row_band(lab, items, idx)
                toks = []
                for w in words:
                    if w[4] and LABEL_RE.match(w[4]):
                        continue
                    if w[0] < sub_lo or w[2] > sub_hi:
                        continue
                    yc = (w[1] + w[3]) / 2
                    if yc < top or yc > bot:
                        continue
                    toks.append(
                        {
                            "x0": w[0],
                            "x1": w[2],
                            "y0": w[1],
                            "y1": w[3],
                            "xc": (w[0] + w[2]) / 2,
                            "txt": w[4],
                        }
                    )
                result[lab["let"]] = _assemble(toks)
    return result


def main(pdf_path, out_path):
    doc = fitz.open(pdf_path)
    with open(out_path, "w", encoding="utf-8") as f:
        for pno, pg in enumerate(doc):
            words = pg.get_text("words")
            blocks = option_blocks(words)
            blocks.sort(key=lambda b: (b["col"], min(l["y0"] for l in b["labels"])))
            for block in blocks:
                opts = extract_block_options(words, block)
                f.write(f"PAGE {pno + 1}\t")
                f.write(
                    "|".join(
                        f"{l['let']}+{l['x0']:.0f}+{l['y0']:.0f}"
                        for l in sorted(block["labels"], key=lambda l: (l["let"], l["y0"]))
                    )
                    + "\t"
                )
                f.write("|".join(f"{k}={v}" for k, v in sorted(opts.items())) + "\n")
    doc.close()


if __name__ == "__main__":
    main("/Users/hussein/Downloads/MathBook 2.5.pdf", "/tmp/options.txt")
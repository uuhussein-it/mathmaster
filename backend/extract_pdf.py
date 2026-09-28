import sys
import re
import fitz


def _split_bucket(words):
    """Split a y-bucket's words into visual lines.

    Option labels (A), B), C), D)) are reliable separators: the 2x2 option
    sub-grids put A/B beside C/D at the same y, which normal gap detection
    cannot always split (option text can nearly touch). When two or more
    distinct option labels appear, cut at each label boundary. Otherwise fall
    back to splitting at the largest horizontal gap if it is large enough.
    """
    words = sorted(words, key=lambda w: w[0])
    texts = [w[4] for w in words]
    xs = [w[0] for w in words]
    if len(words) < 2:
        return [" ".join(texts)]

    labels = [i for i, t in enumerate(texts) if re.fullmatch(r"[A-D]\)", t)]
    if len(labels) >= 2:
        out = []
        cuts = labels[1:]
        prev = 0
        for c in cuts + [len(words)]:
            piece = " ".join(texts[prev:c])
            if piece.strip():
                out.append(piece)
            prev = c
        return out

    gaps = [(xs[i + 1] - xs[i], i) for i in range(len(xs) - 1)]
    max_gap, split_at = max(gaps, key=lambda g: g[0])
    if max_gap < 85:
        return [" ".join(texts)]
    left = " ".join(t for t in texts[: split_at + 1])
    right = " ".join(t for t in texts[split_at + 1 :])
    out = []
    if left.strip():
        out.append(left)
    if right.strip():
        out.append(right)
    return out


def extract_cols(pdf_path, out_path):
    doc = fitz.open(pdf_path)
    col_split = 295.0
    with open(out_path, "w", encoding="utf-8") as f:
        for pno, pg in enumerate(doc):
            words = pg.get_text("words")
            buckets = {}
            for w in words:
                key = round(w[1] / 4.0)
                buckets.setdefault(key, []).append(w)
            left_lines = []
            right_lines = []
            for key in sorted(buckets):
                bw = buckets[key]
                left_words = [w for w in bw if w[0] < col_split]
                right_words = [w for w in bw if w[0] >= col_split]
                if left_words:
                    left_lines.extend(_split_bucket(left_words))
                if right_words:
                    right_lines.extend(_split_bucket(right_words))
            f.write(f"\n@@PAGE {pno + 1}@@\n")
            for line in left_lines + right_lines:
                clean = re.sub(r"@satashkent", "", line).strip()
                if clean:
                    f.write(clean + "\n")
    doc.close()


if __name__ == "__main__":
    extract_cols(sys.argv[1], sys.argv[2])
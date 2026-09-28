import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUESTION_PATH = os.path.join(BASE, "data", "book25_clean.txt")
KEY_PATH = os.path.join(BASE, "data", "book25.txt")

# Subtopic names in book order (order is preserved by the auto-detected
# section boundaries: each section renumbers its questions from 1).
SECTION_NAMES = [
    "Expressions",
    "Linear Equations",
    "Linear System",
    "Linear Functions",
    "Linear Inequalities",
    "Polynomials",
    "Exponents&Radicals",
    "Functions&Function Notation",
    "Exponential Functions",
    "Quadratics",
    "Percent",
    "Unit Conversion",
    "Probability",
    "Mean, Median, Mode, Range",
    "Scatterplots",
    "Research Organizing",
    "Lines&Angles",
    "Triangles",
    "Trigonometry",
    "Circles",
    "Areas&Volumes",
]

# ansqkey line number (1-indexed grep) per subtopic in book25.txt
KEY_STARTS = {
    "Expressions": 1617,
    "Linear Equations": 3173,
    "Linear System": 4640,
    "Linear Functions": 9101,
    "Linear Inequalities": 10281,
    "Polynomials": 10828,
    "Exponents&Radicals": 11090,
    "Functions&Function Notation": 12394,
    "Exponential Functions": 14795,
    "Quadratics": 17736,
    "Percent": 18843,
    "Unit Conversion": 19262,
    "Probability": 19590,
    "Mean, Median, Mode, Range": 20836,
    "Scatterplots": 21512,
    "Research Organizing": 21887,
    "Lines&Angles": 22721,
    "Triangles": 23777,
    "Trigonometry": 24218,
    "Circles": 24988,
    "Areas&Volumes": 26105,
}

# where the NEXT section's question block starts in book25.txt, to bound each
# answer key (1-indexed grep).
KEY_ENDS = {
    "Expressions": 1679,
    "Linear Equations": 3246,
    "Linear System": 4693,
    "Linear Functions": 9247,
    "Linear Inequalities": 10468,
    "Polynomials": 10851,
    "Exponents&Radicals": 11107,
    "Functions&Function Notation": 12443,
    "Exponential Functions": 14869,
    "Quadratics": 17893,
    "Percent": 18887,
    "Unit Conversion": 19281,
    "Probability": 19606,
    "Mean, Median, Mode, Range": 20871,
    "Scatterplots": 21533,
    "Research Organizing": 22127,
    "Lines&Angles": 22746,
    "Triangles": 23824,
    "Trigonometry": 24237,
    "Circles": 25025,
    "Areas&Volumes": 26195,
}


def load_lines(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read().split("\n")


_TOKEN = r"[A-D]|-?\d+(\.\d+)?|(-?\d+/\d+)|-?\d+\.\d*"
ANS_RE = re.compile(rf"^({_TOKEN})( or ({_TOKEN}))*$", re.I)

KEY_CORRECTIONS = {
    "print_misprints": {
        # The printed Quadratics answer table has a phantom '182 A' row; the
        # real answers for Q182..187 are shifted up by one (verified by solving).
        "Quadratics": {
            182: "-1146",
            183: "19",
            184: "-11",
            185: "25",
            186: "672",
            187: "B",
        },
        # Linear System Q82: "y = 5/7 x + 9" has infinitely many solutions, so
        # the second equation must share the same slope, 5/7 (option A in the
        # printed layout). The printed key wrongly lists C.
        "Linear System": {
            82: "A",
        },
    }
}


def valid_answer(s):
    return bool(s) and bool(ANS_RE.match(s.strip()))


def parse_answer_keys(lines=None):
    """Return {subtopic: {qnum: answer}} from book25.txt 4-column tables.

    Each data row is 'Number Answer Number Answer' (e.g. '1 D 2 D'), possibly
    with a multi-value last answer ('85 B 86 5 or 6'). Only rows whose answers
    look like real SAT answers (A-D letter or a number/fraction) are accepted;
    this skips stray formula-page lines like '1 2 3 4 5 6 x'."""
    if lines is None:
        lines = load_lines(KEY_PATH)
    row_re = re.compile(r"^\s*(\d{1,3})\s+(\S[^\s]*)\s+(\d{1,3})\s+(.+?)\s*$")
    pair_re = re.compile(r"^\s*(\d{1,3})\s+(.+?)\s*$")
    keys = {}
    for name in KEY_STARTS:
        start = KEY_STARTS[name] - 1
        stop = KEY_ENDS[name] - 1
        pairs = {}
        for raw in lines[start:stop]:
            t = raw.replace("\xa0", " ")
            t = t.replace("\u00ad", "").strip()
            m = row_re.match(t)
            if m:
                q1, a1, q2, a2 = m.group(1), m.group(2), m.group(3), m.group(4).strip()
                if valid_answer(a1) and valid_answer(a2):
                    pairs.setdefault(int(q1), a1)
                    pairs.setdefault(int(q2), a2)
                continue
            m2 = pair_re.match(t)
            # 'N Answer' single pair (used on some wide-layout pages)
            if m2 and valid_answer(m2.group(2)):
                pairs.setdefault(int(m2.group(1)), m2.group(2).strip())
        keys[name] = pairs
    # Print misprint: the printed Quadratics table inserted a phantom
    # '182 A' and shifted answers for Q182..187 up by one (no Q188 exists).
    for name, corrections in KEY_CORRECTIONS.get("print_misprints", {}).items():
        for qnum, answer in corrections.items():
            keys[name][qnum] = answer
    return keys


def split_options(text):
    """Split a line like 'A) 7yz3 + 5yz C) 12yz6' into {A:..., C:...}."""
    parts = re.split(r"(?=\b[A-D]\)\s)", text)
    out = {}
    for p in parts:
        m = re.match(r"\b([A-D])\)\s*(.*)", p.strip())
        if m:
            out[m.group(1)] = m.group(2).strip()
    return out


def _next_option_line(lines, i, end):
    """Return True if the next non-empty line in lines[i+1:end] has option labels."""
    for j in range(i + 1, min(i + 4, end)):
        t = lines[j].replace("\xa0", " ").replace("\u00ad", "").strip()
        if not t:
            continue
        return bool(re.search(r"\b[A-D]\)", t))
    return False


def parse_questions(lines, start, end):
    """Parse questions in lines[start:end]. Returns list of dicts."""
    questions = []
    current = None
    i = start
    qnum_re = re.compile(r"^(\d{1,3})\.\s*\[(.*?)\]\s*$")
    while i < end:
        raw = lines[i]
        norm = raw.replace("\xa0", " ").replace("\u00ad", "").strip()
        if not norm:
            i += 1
            continue
        m = qnum_re.match(norm)
        if m:
            if current is not None:
                questions.append(current)
            current = {
                "number": int(m.group(1)),
                "source": m.group(2).strip(),
                "prompt": "",
                "options": {},
            }
            i += 1
            continue
        opts = split_options(norm)
        if opts and current is not None:
            for label, text in opts.items():
                current["options"][label] = current["options"].get(label, "") + text
            i += 1
            continue
        if current is not None:
            if current["options"]:
                if _next_option_line(lines, i, end):
                    nxt = re.search(r"\b([A-D])\)", norm)
                    if nxt:
                        lbl = nxt.group(1)
                        current["options"][lbl] = current["options"].get(lbl, "") + " " + norm
                    else:
                        last = list(current["options"].keys())[-1]
                        current["options"][last] += " " + norm
                else:
                    last = list(current["options"].keys())[-1]
                    current["options"][last] += " " + norm
            else:
                current["prompt"] += " " + norm if current["prompt"] else norm
        i += 1
    if current is not None:
        questions.append(current)
    # drop questions that never accumulated text and renumber by occurrence
    kept = []
    for q in questions:
        if q["prompt"] or q["options"]:
            kept.append(q)
    return kept


def detect_sections(lines):
    """Return [(0-based qstart, 0-based answers_start)] for the 21 subtopics.

    Each subtopic renumbers its questions from 1 ('1. [Month Year]') and ends
    (answer-key block follows) at a standalone 'Answers:' line. Both patterns
    are found automatically so the extraction stays resilient to formatting
    changes.
    """
    qstarts = [i for i, l in enumerate(lines) if re.match(r"^1\.\s*\[", l)]
    ans_starts = [i for i, l in enumerate(lines) if re.match(r"^Answers:\s*$", l)]
    if len(qstarts) != len(SECTION_NAMES):
        raise ValueError(f"expected {len(SECTION_NAMES)} section Q1 markers, got {len(qstarts)}")
    if len(ans_starts) != len(SECTION_NAMES):
        raise ValueError(f"expected {len(SECTION_NAMES)} Answers blocks, got {len(ans_starts)}")
    sections = list(zip(SECTION_NAMES, qstarts, ans_starts))
    for i, (name, qs, an) in enumerate(sections):
        if not (qs < an):
            raise ValueError(f"{name}: Q1 marker at {qs} not before Answers at {an}")
        if i and not (sections[i - 1][2] < qs):
            raise ValueError(f"{name}: prev Answers not before Q1 marker")
    return sections


def extract_all():
    qlines = load_lines(QUESTION_PATH)
    klines = load_lines(KEY_PATH)
    keys = parse_answer_keys(klines)
    sections = detect_sections(qlines)
    result = []
    for name, start, answers_line in sections:
        questions = parse_questions(qlines, start, answers_line)
        answers = keys.get(name, {})
        missing = [q["number"] for q in questions if q["number"] not in answers]
        for q in questions:
            q["answer"] = answers.get(q["number"])
        result.append({"name": name, "questions": questions, "missing_keys": missing})
    return result


if __name__ == "__main__":
    data = extract_all()
    total = 0
    for sub in data:
        total += len(sub["questions"])
        print(f"{sub['name']:28s} q={len(sub['questions']):4d} "
              f"missingKeys={sub['missing_keys']}")
    print("TOTAL", total)
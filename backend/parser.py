import os
import re

TOPIC_MAP = [
    ("Algebra", ["Expressions", "Linear Equations", "Linear System", "Linear Functions", "Linear Inequalities"]),
    ("Advanced math", ["Polynomials", "Exponents&Radicals", "Functions&Function Notation", "Exponential Functions", "Quadratics"]),
    ("Problem solving", ["Percent", "Unit Conversion", "Probability", "Mean, Median, Mode, Range", "Scatterplots", "Research Organizing"]),
    ("Geometry and Trigonometry", ["Lines&Angles", "Triangles", "Trigonometry", "Circles", "Areas&Volumes"]),
]

# The answer key lines in the book, in order, per subtopic.
ANSWERS_MARKERS = [
    "Answers: Expressions", "Answers: Linear Equations", "Answers: Linear System",
    "Answers: Linear Functions", "Answers: Linear Inequalities", "Answers: Polynomials",
    "Answers: Exponents&Radicals", "Answers: Functions&Function Notation",
    "Answers: Exponential Functions", "Answers: Quadratics", "Answers: Percent,",
    "Answers: Unit Conversion", "Answers: Probability", "Answers: Mean, Median, Mode, Range",
    "Answers: Scatterplots", "Answers: Research Organizing", "Answers: Lines&Angles",
    "Answers: Triangles", "Answers: Trigonometry", "Answers: Circles", "Answers: Areas&Volumes",
]


def load_lines(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read().split("\n")


def _find_answers_line(lines, marker_base, name):
    """Find the exact line index whose text starts the answer block for
    'name', near the stored marker index. The title can wrap across lines
    (e.g. 'Answers: Linear System' + 'of Equations') and the stored marker
    can be off by a line."""
    for i in range(max(0, marker_base - 2), min(len(lines), marker_base + 3)):
        txt = re.sub(r"[\xa0\u00ad\s]+", "", lines[i])
        if "Answers:" in txt and name.replace("&", "").replace(" ", "") in txt.replace("&", "").replace(" ", ""):
            return i
    return marker_base


def parse_answer_keys(lines):
    """Return {subtopic_name: {qnum: answer}}.

    Answer keys live directly BEFORE the next section's question block.
    Layout is a 4-column table: 'Number | Answer | Number | Answer' followed by
    interleaved rows like:  7  72  8  A  9  8  10  C ...  (pairwise). Header
    rows repeat at page breaks.
    """
    keys = {}
    for name, marker_line in ANSWER_MARKERS.items():
        start = _find_answers_line(lines, marker_line, name) + 1
        stop = len(lines)
        for other in SECTION_STARTS:
            s = SECTION_STARTS[other]
            if s > start and s < stop:
                stop = s
        tokens = []
        for raw in lines[start:stop]:
            t = raw.replace("\xa0", " ").replace("\u00ad", "").strip()
            if not t:
                continue
            if t == "Number" or t == "Answer":
                continue
            tokens.append(t)
        # drop leading title-fragment tokens until the first integer
        while tokens and not re.fullmatch(r"\d{1,3}", tokens[0]):
            tokens.pop(0)
        pairs = {}
        i = 0
        while i + 1 < len(tokens):
            num_tok, ans_tok = tokens[i], tokens[i + 1]
            if re.fullmatch(r"\d{1,3}", num_tok):
                pairs[int(num_tok)] = ans_tok
            i += 2
        keys[name] = pairs
    return keys


def parse_questions(lines, start, end):
    """Parse questions in lines[start:end]. Returns list of dicts."""
    questions = []
    i = start
    qnum_re = re.compile(r"^\s*([\d]{1,3})\.\s*(\[.*?\])?\s*$")
    opt_re = re.compile(r"^\s*([A-D])\)\s*")
    current = None
    while i < end:
        line = lines[i]
        norm = line.replace("\xa0", " ").replace("\u00ad", "")
        m = qnum_re.match(norm)
        if m:
            if current and (current["prompt"] or current["options"]):
                if not current["options"]:
                    current["options"] = {"A": "", "B": "", "C": "", "D": ""}
                questions.append(current)
            current = {"number": int(m.group(1)), "source": m.group(2), "prompt": "", "options": {}}
            i += 1
            continue
        om = opt_re.match(norm)
        if om and current:
            label = om.group(1)
            current["options"][label] = norm[om.end():].strip()
            i += 1
            continue
        if current:
            txt = norm.strip()
            if txt:
                # decide prompt vs continuation of last option
                if current["options"]:
                    last = list(current["options"].keys())[-1]
                    current["options"][last] += " " + txt
                else:
                    current["prompt"] += " " + txt if current["prompt"] else txt
        i += 1
    if current and (current["prompt"] or current["options"]):
        if not current["options"]:
            current["options"] = {"A": "", "B": "", "C": "", "D": ""}
        questions.append(current)
    return questions


# question section start line numbers per subtopic (discovered from book text)
SECTION_STARTS = {
    "Expressions": 157, "Linear Equations": 1576, "Linear System": 2942,
    "Linear Functions": 4225, "Linear Inequalities": 8315, "Polynomials": 9420,
    "Exponents&Radicals": 9736, "Functions&Function Notation": 9947,
    "Exponential Functions": 11222, "Quadratics": 13451, "Percent": 16038,
    "Unit Conversion": 16939, "Probability": 17233, "Mean, Median, Mode, Range": 17683,
    "Scatterplots": 18824, "Research Organizing": 19422, "Lines&Angles": 19939,
    "Triangles": 20498, "Trigonometry": 21497, "Circles": 21811, "Areas&Volumes": 22446,
}

ANSWER_MARKERS = {
    "Expressions": 1374, "Linear Equations": 2692, "Linear System": 4042,
    "Linear Functions": 7809, "Linear Inequalities": 9198, "Polynomials": 9674,
    "Exponents&Radicals": 9911, "Functions&Function Notation": 11066,
    "Exponential Functions": 13197, "Quadratics": 15585, "Percent": 16794,
    "Unit Conversion": 17177, "Probability": 17639, "Mean, Median, Mode, Range": 18716,
    "Scatterplots": 19360, "Research Organizing": 19691, "Lines&Angles": 20416,
    "Triangles": 21342, "Trigonometry": 21757, "Circles": 22342, "Areas&Volumes": 23235,
}


def extract_all(lines=None):
    """Return list of subtopic dicts, each with 'name', 'questions'."""
    if lines is None:
        lines = load_lines(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "book_text.txt"))
    keys = parse_answer_keys(lines)
    result = []
    for name in SECTION_STARTS:
        start = SECTION_STARTS[name]
        end = ANSWER_MARKERS[name]
        questions = parse_questions(lines, start, end)
        answers = keys.get(name, {})
        for q in questions:
            q["answer"] = answers.get(q["number"])
        result.append({"name": name, "questions": questions})
    return result

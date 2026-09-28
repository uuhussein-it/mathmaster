import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import db
import latex
import book25_parser
import merge_options

TOPIC_MAP = {
    "Expressions": "Algebra",
    "Linear Equations": "Algebra",
    "Linear System": "Algebra",
    "Linear Functions": "Algebra",
    "Linear Inequalities": "Algebra",
    "Polynomials": "Advanced math",
    "Exponents&Radicals": "Advanced math",
    "Functions&Function Notation": "Advanced math",
    "Exponential Functions": "Advanced math",
    "Quadratics": "Advanced math",
    "Percent": "Problem solving",
    "Unit Conversion": "Problem solving",
    "Probability": "Problem solving",
    "Mean, Median, Mode, Range": "Problem solving",
    "Scatterplots": "Problem solving",
    "Research Organizing": "Problem solving",
    "Lines&Angles": "Geometry and Trigonometry",
    "Triangles": "Geometry and Trigonometry",
    "Trigonometry": "Geometry and Trigonometry",
    "Circles": "Geometry and Trigonometry",
    "Areas&Volumes": "Geometry and Trigonometry",
}


def clean(text):
    if text is None:
        return ""
    return " ".join(text.split())


# Options whose PDF glyphs cannot be assembled from text/coordinates alone
# (stacked-fraction or interleaved-column print quirks), verified by solving.
OPTION_CORRECTIONS = {
    "Quadratics": {
        # f has vertex (1, 7) through (2, 53), (-1, 191); f(-2) = 421, f(0) = 53,
        # answer 368 -> C. The print's two A/B sub-columns collided on extraction.
        146: {"A": "145", "B": "237", "C": "368", "D": "421"},
        # f passes through (10, 0) and (-5, 0) with integer a > 1; a+b = -4a,
        # and only a=2 gives a listed value (-8). Print sub-grids both label A.
        111: {"A": "-8", "B": "-4", "C": "5", "D": "6"},
        # system line/parabola "possible value of x"; grid values 4, 5, 6.4, 7.
        127: {"C": "6.4", "D": "7"},
    },
    "Probability": {
        # at-least-45 total is 110 of 135 -> D.
        16: {"A": "25/135", "B": "35/135", "C": "100/135", "D": "110/135"},
        # P(group A | at least 10 yrs) = (19+11)/(105-35) = 3/7 -> B.
        15: {"A": "2/7", "B": "3/7", "C": "19/35", "D": "6/7"},
        # SPR (answer 64/67): clear stray option noise; all option cells empty.
        18: {"A": "", "B": "", "C": "", "D": ""},
        # even integers in list A = 12 of 52 total -> 12/52 -> A.
        19: {"A": "12/52", "B": "12/56", "C": "52/100", "D": "52/56"},
    },
    "Linear System": {
        # Print labels options in 2x2 sub-grid (A/B here are printed as
        # parenthesised labels) with stacked fractions; key corrected to A.
        82: {"A": "5/7", "B": "7/5", "C": "-7/5", "D": "-5/7"},
        # y = 18x + 25 and y = -14x - 7 meet at (-1, 7) -> B. Print typo "E)"
        # for D and both sub-columns labelled A/B on extraction.
        3: {"A": "(-7, 25)", "B": "(-1, 7)", "C": "(7, -1)", "D": "(25, -7)"},
    },
    "Linear Equations": {
        # a(7x-14)+5a = 7(ax-2a)-35: infinitely many solutions forces a = -7 -> B.
        83: {"A": "0 only", "B": "-7 only", "C": "Any real number", "D": "No real number"},
    },
    "Exponential Functions": {
        # y = 2x + k, k from shown intercept; print reuses A in both sub-columns.
        21: {"A": "-7", "B": "-6", "C": "7", "D": "6"},
    },
    "Functions&Function Notation": {
        # p(3) = 450 with v=3 volts -> "potential difference of 3 volts =>
        # 450 watts" (A). Coordinate merge garbles this wrap-over; restore the
        # clean printed options in order.
        10: {
            "A": "For a potential difference of 3 volts, the instantaneous power is 450 watts.",
            "B": "For a current of 3 amperes, the instantaneous power is 450 watts.",
            "C": "For an instantaneous power of 3 watts, the potential difference is 450 volts.",
            "D": "For a current of 150 amperes, the potential difference is 450 volts.",
        },
    },
    "Linear Functions": {
        # predicted larvae for 46 ants is 0.67*46+2.6 ~ 33.4 -> 33 (A); stacked
        # values in print: 65, 150.
        60: {"C": "65", "D": "150"},
    },
    "Linear Inequalities": {
        # shaded region rx + ty >= 36; printed grid values 4, 2, -4, -2 (key A = 4).
        45: {"A": "4", "B": "2", "C": "-4", "D": "-2"},
    },
    "Percent": {
        # x = 33% of y  =>  y = 100x/33 (key A); tokens 33/67x/100 seen in print.
        45: {"A": "100x/33", "B": "33x/100", "C": "x/33", "D": "67x/100"},
    },
    "Scatterplots": {
        # line of best fit y ~ 0.6 + 1.5x; print mixes +/- signs across cells.
        23: {
            "A": "y = 0.6 + 1.5x",
            "B": "y = 0.6 - 1.5x",
            "C": "y = -0.6 + 1.5x",
            "D": "y = -0.6 - 1.5x",
        },
    },
}


def difficulty_for(idx, total):
    """Approximate difficulty by ordinal within a subtopic (book is roughly ordered)."""
    ratio = (idx + 1) / total
    if ratio <= 0.45:
        return "easy"
    if ratio <= 0.8:
        return "medium"
    return "hard"


def wipe():
    conn = db.get_conn()
    c = conn.cursor()
    c.executescript(
        """
        DELETE FROM session_results;
        DELETE FROM mock_test_questions;
        DELETE FROM mock_tests;
        DELETE FROM test_sessions;
        DELETE FROM questions;
        DELETE FROM subtopics;
        DELETE FROM topics;
        """
    )
    conn.commit()
    conn.close()


def seed():
    wipe()
    db.init_db()
    qpath = os.environ.get("MATHBOOK_TXT", "/tmp/book25_v3.txt")
    keypath = os.environ.get(
        "MATHBOOK_KEY",
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "book25.txt"),
    )
    blocks_path = os.environ.get("MATHBOOK_OPTIONS", "/tmp/options.txt")
    book25_parser.QUESTION_PATH = qpath
    book25_parser.KEY_PATH = keypath
    data = book25_parser.extract_all()
    lines = open(qpath, encoding="utf-8").read().split("\n")
    overrides = merge_options.merge(data, lines, blocks_path=blocks_path)
    inserted = 0
    no_answer = 0
    fi = 0
    for st in data:
        name = st["name"]
        topic_name = TOPIC_MAP.get(name, "General")
        topic_id = db.add_topic(topic_name)
        sub_id = db.add_subtopic(topic_id, name)
        total = len(st["questions"])
        for idx, q in enumerate(st["questions"]):
            answer = q.get("answer")
            if not answer:
                no_answer += 1
                continue
            correct = clean(answer)
            opts = [
                clean(q["options"].get("A", "")),
                clean(q["options"].get("B", "")),
                clean(q["options"].get("C", "")),
                clean(q["options"].get("D", "")),
            ]
            if fi in overrides:
                for i, k in enumerate("ABCD"):
                    opts[i] = clean(overrides[fi][k])
            corrects = OPTION_CORRECTIONS.get(name, {}).get(q["number"])
            if corrects:
                for i, k in enumerate("ABCD"):
                    if k in corrects:
                        opts[i] = clean(corrects[k])
            prompt = clean(q["prompt"])
            if not prompt.strip():
                no_answer += 1
                continue
            prompt, opts = latex.repair_block(prompt, opts)
            db.add_question(
                sub_id,
                q["number"],
                (q.get("source") or "").strip("[]"),
                prompt,
                opts,
                correct,
                difficulty_for(idx, total),
            )
            fi += 1
            inserted += 1
    print(f"Inserted {inserted} questions. skipped/no-answer {no_answer}.")


if __name__ == "__main__":
    seed()
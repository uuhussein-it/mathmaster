import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import db
import latex
import parser

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


def difficulty_for(idx, total):
    """Approximate difficulty by ordinal within a subtopic (book is roughly ordered)."""
    ratio = (idx + 1) / total
    if ratio <= 0.45:
        return "easy"
    if ratio <= 0.8:
        return "medium"
    return "hard"


def seed():
    db.init_db()
    data = parser.extract_all()
    inserted = 0
    for st in data:
        name = st["name"]
        topic_name = TOPIC_MAP.get(name, "General")
        topic_id = db.add_topic(topic_name)
        sub_id = db.add_subtopic(topic_id, name)
        total = len(st["questions"])
        for idx, q in enumerate(st["questions"]):
            answer = q.get("answer")
            correct = answer if answer else "A"
            opts = [
                clean(q["options"].get("A", "")),
                clean(q["options"].get("B", "")),
                clean(q["options"].get("C", "")),
                clean(q["options"].get("D", "")),
            ]
            prompt = clean(q["prompt"])
            if not prompt.strip():
                continue
            prompt, opts = latex.repair_block(prompt, opts)
            db.add_question(
                sub_id,
                q["number"],
                (q.get("source") or "").strip("[]"),
                prompt,
                opts,
                clean(correct),
                difficulty_for(idx, total),
            )
            inserted += 1
    print(f"Inserted {inserted} questions.")


if __name__ == "__main__":
    seed()

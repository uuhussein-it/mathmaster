"""Practice sets: 3-4 new questions written for each curriculum question
(data/practice_sets.json), in mixed formats: multiple choice, typed answer,
complete-the-parts, table, matching and graph. They carry their own answer
keys, so they are graded without AI. Refs look like "set:<id>"."""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "data", "practice_sets.json")

_by_id = None
_by_src = None


def _load():
    global _by_id, _by_src
    if _by_id is None:
        raw = json.load(open(PATH)) if os.path.exists(PATH) else {"questions": []}
        _by_id = {q["id"]: q for q in raw["questions"]}
        _by_src = {}
        for q in raw["questions"]:
            _by_src.setdefault(q["src"], []).append(q)
    return _by_id, _by_src


def get(set_id):
    return _load()[0].get(set_id)


def for_source(qid):
    return _load()[1].get(qid, [])


def keys(q):
    """Accepted typed answers of a typed-answer question."""
    return [str(a) for a in (q["answer"] if isinstance(q["answer"], list) else [q["answer"]])]


def item(q, admin=False):
    """A set question in QuestLearn's format."""
    out = {"id": f"set-{q['id']}", "ref": f"set:{q['id']}", "type": q["type"], "q": q["q"], "image": None,
           "options": q.get("options") or [], "answer": q["answer"] if q["type"] == "mcq" else None,
           "hint": q.get("hint"), "explanation": q.get("explanation"), "source": "set", "more": True}
    if q["type"] == "widget":
        out["widget"] = q["widget"]
    if admin and q["type"] == "free":
        out["answer_text"] = " | ".join(keys(q))
    return out


def answer_text(q):
    """The key as text, for AI rechecks and the admin page."""
    if q["type"] == "mcq":
        return f"{'ABCD'[q['answer']]}) {q['options'][q['answer']]}"
    if q["type"] == "free":
        return " or ".join(keys(q))
    return json.dumps(q["widget"], ensure_ascii=False)

import sys, json, sqlite3, os

# usage: python3 import_variants.py variants.json
os.chdir('/Users/hussein/Work/sat-math-site')
c = sqlite3.connect('data/sat.db')
cur = c.cursor()
# get max id
mx = cur.execute("SELECT MAX(id) FROM course_questions").fetchone()[0] or 0
with open(sys.argv[1]) if len(sys.argv)>1 else sys.exit(1) as f:
    vs = json.load(f)
added = 0
for v in vs:
    mx += 1
    pid = mx
    # insert (minimal cols matching schema)
    cur.execute("""
      INSERT INTO course_questions
        (id, course_id, subtopic_id, number, prompt,
         option_a,option_b,option_c,option_d,option_e,option_f,
         correct, is_mcq)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        pid,
        v.get('course_id'),
        v.get('subtopic_id'),
        None,  # number
        v.get('prompt'),
        v.get('option_a'),
        v.get('option_b'),
        v.get('option_c'),
        v.get('option_d'),
        v.get('option_e'),
        v.get('option_f'),
        v.get('correct') or '',
        1 if any(v.get(k) for k in ['option_a','option_b','option_c','option_d','option_e','option_f']) else 0
    ))
    added += 1
c.commit()
print('added', added, 'max', mx)

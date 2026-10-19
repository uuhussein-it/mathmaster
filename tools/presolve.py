"""Run questlearn.solve() over every playable bank question into a scratch DB."""
import os, sys, time, json
sys.path.insert(0, '/home/claude/mathmaster/backend')
import app, questlearn, db
from concurrent.futures import ThreadPoolExecutor
conn = db.get_conn()
done = {(r['kind'], r['qid']) for r in conn.execute("SELECT kind, qid FROM ql_keys WHERE explanation IS NOT NULL")}
refs = []
for r in conn.execute("SELECT * FROM course_questions"):
    if questlearn._item('course', r, True, {}): refs.append(('course', r['id']))
for r in conn.execute("SELECT * FROM questions"):
    refs.append(('sat', r['id']))
conn.close()
todo = [x for x in refs if x not in done][:int(os.environ.get('MAX', 10**6))]
print('total', len(refs), 'todo', len(todo), flush=True)
ok = fail = streak = 0
t0 = time.time()
def run(x):
    try:
        return bool(questlearn.solve(*x).get('explanation'))
    except Exception as e:
        return False
with ThreadPoolExecutor(int(os.environ.get('W', 8))) as pool:
    for i, good in enumerate(pool.map(run, todo)):
        ok += good; fail += not good
        streak = 0 if good else streak + 1
        if streak >= 30:
            print('STOP: 30 failures in a row (quota?)', flush=True); pool.shutdown(cancel_futures=True); break
        if i % 100 == 0: print(i, 'ok', ok, 'fail', fail, f'{time.time()-t0:.0f}s', flush=True)
print('DONE ok', ok, 'fail', fail, f'{time.time()-t0:.0f}s', flush=True)

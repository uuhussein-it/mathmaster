# SAT MathMaster — Render Deployment

This is a plain **Flask + SQLite** app. It runs on any host that can run
`gunicorn`. It is already configured for Render via `render.yaml` (or the
included `Procfile` + `wsgi.py`).

## What ships in the repo
- `wsgi.py` — production entrypoint (gunicorn target)
- `backend/app.py`, `backend/db.py` — the Flask app and SQLite helpers
- `frontend/` — QuestLearn, the gamified student site served at `/`
  (heroes, XP, Practice/Quiz, SAT Simulator; plain ES modules, no build step)
- `frontend/classic/index.html` — the original MathMaster UI, served at `/classic`
- `backend/questlearn.py` — QuestLearn's API (`/api/ql/*`): question banks,
  Gemini answer checking, hints/explanations and similar-question generation
- `data/answer_keys.json` — official MCQ keys from the answer-key PDFs, copied
  into blank `correct` cells at startup (never overwrites a teacher's fix)
- `data/sat.db` — pre-seeded database (SAT + Grades 9–12 curriculum questions)
- `data/question_imgs/`, `data/course_imgs/`, `data/option_imgs/` — the screenshots
- `Procfile`, `requirements.txt`, `render.yaml` — deployment config

Total repo size ~218 MB (mostly the ~3,200 screenshot PNGs). No single file
exceeds GitHub's 100 MB limit, so it pushes fine.

## Deploy to Render (via Git — no shell needed)

### 1. Push this folder to a GitHub repo
From your Mac, in this project folder:
```
cd <this folder>
git add -A
git commit -m "SAT + curriculum app for Render"
git branch -M main
git remote add origin https://github.com/<YOUR_USER>/<YOUR_REPO>.git
git push -u origin main
```
Create the (empty) repo on github.com first. If the repo is private, connect
Render to it via a GitHub Personal Access Token (Render dashboard).

### 2. Create the Render service
- Go to https://dashboard.render.com → **New → Blueprint** (easiest) and point
  it at the repo. `render.yaml` sets everything (build + start + health).
- OR **New → Web Service** → pick the repo, and use:
  - Build command: `pip install -r requirements.txt`
  - Start command: `gunicorn --workers 1 --threads 64 --timeout 120 --chdir . wsgi:application`
    (one worker: live arena fights are kept in that process's memory, so both
    players must reach the same one; the 64 threads serve everyone else)
  - (Leave Build/Start blank if you use the Blueprint — it fills them in.)

### 3. Deploy
Render builds automatically. Watch the **Logs** tab. When it says "Live", your
site is at `https://<your-service>.onrender.com`.

### 4. Verify
- `https://<your-service>.onrender.com/api/courses` → JSON with 10 courses
- Open the home page → click **Grades 9–12** tab.

## Notes / gotchas
- **Set these two environment variables in Render before going live** (Dashboard
  → your service → Environment):
  - `ADMIN_PASSWORD` — the password for the **Admin** page where you fix
    questions and answers. Any value you choose. Without it the app falls back
    to the literal `admin`, which is fine locally but not in production.
  - `SECRET_KEY` — any long random string, e.g. `openssl rand -hex 32`. It signs
    the admin login cookie. Without it a new key is generated on every restart,
    which logs you out each time the server restarts.
- The **Admin** button only appears in the nav bar once you are signed in, and
  the answer key is stripped from `/api/questions` for everyone else.
- **Free tier sleeps** when idle (~1 min cold start on first hit). Fine for a
  practice site. The paid tier ($7/mo) keeps it always-on and adds a persistent
  disk.
- **Keep accounts and edits: set `DATABASE_URL`.** The free tier resets its
  disk on every restart or deploy. Student accounts, progress, the school list,
  feedback and every admin edit are saved in Postgres when `DATABASE_URL` is
  set, so they survive (see "Save progress in Neon" below). Without it they
  live in SQLite and are lost on each deploy.
- The DB is already seeded — you do NOT need to run `seed.py`/`seed_courses.py`
  on the server. Those scripts are included only for reference / rebuilding.
- Health check: `/api/courses` (returns 200 once up).

## Local run (this Mac)
```
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
PORT=5000 gunicorn --chdir . wsgi:application
# open http://127.0.0.1:5000
```


## Gemini (answer checking + similar questions)

Set `GEMINI_API_KEY` in Render → your service → Environment (optional:
`GEMINI_MODEL`, default `gemini-3.5-flash-lite`). With it on, QuestLearn:

- checks every answer that has no stored key, and every typed (free-response)
  answer, by sending Gemini the question screenshot;
- writes hints and step-by-step explanations on demand;
- offers **"3 more like this"** after each practice question, which adds new
  Gemini-written questions on the same skill straight into the run.

Everything Gemini produces is saved and reused, so the same question never
goes to Gemini twice: solutions/hints/explanations in `ql_keys`, verdicts on
typed answers in `ql_checks` (per question + answer), and "more like this"
questions in `ql_generated` (pressing it again on the same question serves the
saved ones). This cache lives in the bundled SQLite file, so on the free plan
it starts again from `data/ai_seed.json` after each deploy.

Without a key the site still works: only questions with an answer key are
served (about 480 course MCQs plus QuestLearn's original SAT set).

## Student accounts, groups and the admin page

- Students sign in at `/` with their school email and create a password on their first visit, then pick a hero and their level (grade + track). That puts them in a group such as "Grade 11 · Advanced", whose play area and leaderboard open first.
- Teachers sign in at `/#/admin` with `TEACHER_USERNAME` / `ADMIN_PASSWORD`. The admin page can fix answers, remove questions, add questions of any type (multiple choice, short answer, table, matching, graph, multi-part), remove students from the leaderboard, reset passwords, read feedback and upload the school's student list.
- **School student list:** upload the Excel file on the admin page (School list tab). After that, only emails on the list can create an account. It is not stored in the repository because it holds students' personal data.
- Optional `SCHOOL_EMAIL_DOMAIN` (e.g. `actvet.gov.ae`): restricts sign-ups to that domain while no list is uploaded.

## Save progress in Neon (free)

1. Sign up at https://neon.tech and create a project (the free plan is enough;
   pick the region closest to Render's, e.g. Frankfurt).
2. On the project dashboard press **Connect** and copy the connection string.
   It looks like `postgresql://user:password@ep-....neon.tech/neondb?sslmode=require`.
3. In Render: your service → **Environment** → add `DATABASE_URL` with that
   string → **Save, rebuild and deploy**.
4. Sign in on the admin page and upload the school list again (it is now kept).

The tables are created on the first start. The question bank itself stays in
`data/sat.db` in the repository; answer fixes made on the admin page are saved
in Neon and re-applied to it on every start.

## Teachers and the admin

- The account set by `TEACHER_USERNAME` / `ADMIN_PASSWORD` is the **admin**: it can do everything, including uploading the school list, deleting students, resetting passwords and adding teachers (admin page → Teachers tab).
- **Teachers** sign in on the same page with their email and the password the admin gave them. They can fix questions, read feedback and manage the leaderboard, but cannot see or change the school list, delete accounts or reset passwords.

## Class arena (fights between classmates)

- Students reach the arena from the hub (🥊 Arena) once they are level 3 (change with `ARENA_UNLOCK_LEVEL`). They can only challenge classmates in their own group who are online.
- Health comes from the student's level, attack from quiz accuracy and the special meter from their best answer streak. Fireball (level 3), Shield (level 5) and Critical Strike (level 8) unlock with level, and so do bronze, silver and gold looks.
- A fight lasts 60 seconds. The winner takes 10% of the lower XP total (5 to 50) from the loser plus a 10 XP bonus; a draw changes nothing. The server runs the whole fight: the browser only sends which keys are held, so a changed page cannot fake hits or health.
- Fights use a WebSocket on the same address, which Render supports with no extra setup. **Keep a single gunicorn worker** (see the start command above).

## Security

- Sign-in cookies are HTTP-only, sent only over HTTPS on Render, and expire after 14 days. Every sign-in starts a fresh session.
- Requests that change data must come from the site's own pages; other sites get 403.
- Sign-in, sign-up and email checks are rate limited (too many tries give "Too many attempts").
- Saved progress is checked on the server: XP and score can only grow as fast as a student can really earn them, and the level is recomputed from XP.
- Security headers (Content-Security-Policy, no framing, no sniffing, HSTS on HTTPS) are sent on every page.

## Practice sets

`data/practice_sets.json` holds 3–4 new questions written for each curriculum question, in mixed formats (multiple choice, typed answer, complete-the-blanks, tables, matching and graphs). They carry their own answer keys, so no AI is needed to grade them. They appear in course practice with a "📘 Practice set" tag, and "3 more like this" uses them before asking Gemini. On the admin page, tick "Show practice sets" to see them; any one can be removed, and removing a curriculum question also removes its set.

While writing them, 111 stored answer keys were found wrong. `data/key_fixes.json` corrects them at startup (a teacher's own answer edit still wins). Questions with more than one right choice are stored with all their letters and left out, like other "select all that apply" questions. Typed answers now also match when the student adds or leaves off "≈", a currency or a unit (59.78 ft = 59.78).

## Armory (gear)

Students open 🛡️ Armory from the hub. Swords, armor and charms unlock with level, arena wins and best answer streak, show on the hero in fights, and add a small arena bonus (the fair-play cap still applies). Unlocks are checked on the server.

## Lessons

On the School Curriculum screen each topic opens to show its lessons (1.1, 1.2, …). Students can tick a whole topic or just the lessons they want; results and mastery are tracked per lesson. Teacher-written questions appear as a "Teacher questions" lesson in their topic. SAT Topics Practice works the same way: each SAT topic opens to its skills (Quadratics, Circles, …) plus "Mixed practice" for the original keyed set.

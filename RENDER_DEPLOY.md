# SAT MathMaster — Render Deployment

This is a plain **Flask + SQLite** app. It runs on any host that can run
`gunicorn`. It is already configured for Render via `render.yaml` (or the
included `Procfile` + `wsgi.py`).

## What ships in the repo
- `wsgi.py` — production entrypoint (gunicorn target)
- `backend/app.py`, `backend/db.py` — the Flask app and SQLite helpers
- `frontend/index.html` — the whole UI (single static file)
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
  - Start command: `gunicorn --workers 2 --threads 4 --timeout 120 --chdir . wsgi:application`
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
- **⚠️ Admin edits need a persistent disk.** SQLite lives on the container's
  ephemeral disk on the free tier, so **every answer you fix in the Admin page
  is lost when Render restarts or redeploys** — and student results reset too.
  To make your fixes stick, attach a **persistent disk** (paid) and point
  `SAT_DB_PATH` at it (see the comment in `render.yaml`), or move to Postgres.
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

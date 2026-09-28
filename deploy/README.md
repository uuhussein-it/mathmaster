# SAT MathMaster — Sharing & Deployment

## Option A — Same Wi-Fi (LAN) [works right now]

Your Mac runs the server and students on the same network open a URL.

1. Start the server:
   ```
   cd backend
   nohup python3 app.py > /tmp/flask.log 2>&1 &
   ```
2. Find your Mac's local IP, e.g. `ipconfig getifaddr en0`.
3. Share `http://<YOUR-IP>:5000` with students (same Wi-Fi only).
4. Stop it: `lsof -ti:5000 | xargs kill -9`

## Option B — PythonAnywhere (permanent public link, free)

Students anywhere in the world can use it 24/7. The SQLite database
(for tracking/reports) persists, so it survives restarts.

### 1. Create account + files
- Sign up at https://www.pythonanywhere.com (free plan = 1 web app, 512MB disk).
- `pip install flask` in your PythonAnywhere bash/console if not already there.

### 2. Upload the code
From your Mac, from the project root:
```
tar -czf /tmp/sat-math-site.tgz --exclude='deploy/upload' .
```
Then in PythonAnywhere **Files** tab, browse to `/home/<username>/`
and upload `sat-math-site.tgz`. In a bash console:
```
cd ~ && tar -xzf sat-math-site.tgz
mv sat-math-site satmath        # optional tidy name
ls satmath                      # should show backend/ frontend/ data/ deploy/
```
> The `data/` folder (~115MB of question images) is required. Free tier
> has 512MB, so you're fine. If upload is slow, cut `data/question_imgs`
> into smaller zips and merge after.

### 3. Point WSGI at the app
- Copy the WSGI file to the project root:
  ```
  cp ~/satmath/deploy/pa_wsgi.py ~/satmath/
  ```
- In the **Web** tab → "Add a new web app" → **Manual configuration** →
  Python 3.10/3.11.
- Set **Code** → "WSGI configuration file" to:
  `/home/<username>/satmath/pa_wsgi.py`
- If manual config didn't create a virtualenv, open a console and:
  ```
  mkvirtualenv --python=python3.10 satmath
  pip install flask==3.1.3
  ```
  then set **Virtualenv** to `/home/<username>/virtualenvs/satmath`.

### 4. Reload + share
- Click **Reload** on your web app.
- Your URL is `http://<username>.pythonanywhere.com/`

### Notes / gotchas
- The DB lives at `data/sat.db`. Back it up periodically from the Files tab.
- Free tier sleeps when idle; first visit each day is slower for ~1 min.
- Students working at the same time are fine — SQLite handles the traffic.
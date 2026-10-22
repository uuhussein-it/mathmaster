"""Arena mini-games: the shared real-time engine plus Car Race, Math Duel and
Number Hunt (the Fight lives in arena.py).

Every game runs on the server at 30 ticks a second. Browsers only send which
buttons are held and which answer they tapped; positions, scores, answers and
the result are decided here. A practice game pits the student against a bot:
nothing is at stake and nothing is saved.
"""
import json
import math
import random
import secrets
import threading
import time

import userdb

TICK = 1 / 30
COUNTDOWN = 3
FORFEIT_SECONDS = 8   # a player whose browser is gone this long loses
NO_SHOW_SECONDS = 25


class Player:
    def __init__(self, pid, name, character, effective_xp=0, bot=False):
        self.id, self.name, self.character = pid, name, character or "warrior"
        self.effective_xp = effective_xp
        self.bot = bot
        self.keys = {}
        self.prev = {}
        self.sockets = []
        self.last_contact = time.time()
        self.think = 0.0  # bots: next decision time

    def card(self):
        return {"id": self.id, "name": self.name, "character": self.character, "bot": self.bot}


class Game:
    kind = "game"
    keys = ("left", "right", "up", "down")
    seconds = 60

    def __init__(self, players, grp, stake, practice=False, grade=9):
        self.id = secrets.token_urlsafe(10)
        self.grp = grp
        self.p = players
        self.ids = {p.id for p in players if not p.bot}
        self.practice = practice
        self.stake = 0 if practice else stake
        self.grade = grade
        self.rng = random.Random()
        self.created = time.time()
        self.phase = "waiting"   # waiting -> countdown -> fight -> over
        self.phase_start = self.created
        self.events = []
        self.result = None
        self.ended = 0.0
        self.lock = threading.Lock()

    # -- players and sockets
    def player(self, sid):
        return next(p for p in self.p if p.id == sid)

    def other(self, p):
        return self.p[1] if p is self.p[0] else self.p[0]

    def attach(self, sid, ws):
        with self.lock:
            p = self.player(sid)
            p.sockets.append(ws)
            p.last_contact = time.time()

    def detach(self, sid, ws):
        with self.lock:
            p = self.player(sid)
            if ws in p.sockets:
                p.sockets.remove(ws)
            p.last_contact = time.time()

    def on_input(self, sid, msg):
        if not isinstance(msg, dict):
            return
        with self.lock:
            p = self.player(sid)
            p.last_contact = time.time()
            keys = msg.get("keys")
            if isinstance(keys, dict):
                p.keys = {k: bool(keys.get(k)) for k in self.keys}
            ans = msg.get("answer")
            if isinstance(ans, dict) and self.phase == "fight":
                try:
                    self.answer(p, str(ans.get("q")), int(ans.get("i")), time.time())
                except (TypeError, ValueError):
                    pass

    def quit(self, sid):
        """The player left: the other one wins (a practice game just ends)."""
        with self.lock:
            if self.phase != "over":
                self.finish(time.time(), self.other(self.player(sid)), "forfeit")

    @staticmethod
    def connected(p):
        return p.bot or bool(p.sockets)

    # -- loop
    def start(self):
        threading.Thread(target=self._run, name=f"arena-{self.id}", daemon=True).start()

    def _run(self):
        frame = 0
        next_t = time.time()
        while self.phase != "over":
            now = time.time()
            with self.lock:
                self._step(now)
                payload = None
                if frame % 2 == 0 or self.phase == "over":
                    payload = json.dumps(self.snapshot())
                    self.events = []  # sent; events pile up between sends so none are missed
                targets = [(p, ws) for p in self.p for ws in p.sockets]
            if payload:
                for p, ws in targets:
                    try:
                        ws.send(payload)
                    except Exception:
                        self.detach(p.id, ws)
            frame += 1
            next_t += TICK
            time.sleep(max(0.0, next_t - time.time()))
        self.save()
        final = json.dumps(self.snapshot())
        for p in self.p:
            for ws in list(p.sockets):
                try:
                    ws.send(final)
                except Exception:
                    pass

    def _step(self, now):
        connected = [self.connected(p) for p in self.p]
        if self.phase == "waiting":
            humans = [p for p in self.p if not p.bot]
            if all(connected):
                self.phase, self.phase_start = "countdown", now
            elif now - self.created > NO_SHOW_SECONDS:
                here = next((p for p in humans if p.sockets), None)
                self.finish(now, here, "forfeit" if here else "no-show")
            return
        if self.phase == "countdown":
            if now - self.phase_start >= COUNTDOWN:
                self.phase, self.phase_start = "fight", now
                self.begin(now)
            return
        for p, c in zip(self.p, connected):
            if not c and now - p.last_contact > FORFEIT_SECONDS:
                return self.finish(now, self.other(p), "forfeit")
        for p in self.p:
            if p.bot and now >= p.think:
                self.bot(p, now)
        self.tick(now)
        if self.phase == "fight" and now - self.phase_start >= self.seconds:
            self.timeout(now)

    # -- what each game fills in
    def begin(self, now):
        pass

    def tick(self, now):
        pass

    def bot(self, p, now):
        p.think = now + 1

    def answer(self, p, qid, i, now):
        pass

    def score(self, p):
        return 0

    def timeout(self, now):
        a, b = self.p
        sa, sb = self.score(a), self.score(b)
        self.finish(now, None if sa == sb else a if sa > sb else b, "time")

    def state(self, now, full):
        return {}

    # -- the end
    def finish(self, now, winner, reason):
        self.phase, self.ended = "over", now
        loser = self.other(winner) if winner else None
        taken = min(self.stake, loser.effective_xp) if loser and not loser.bot else 0
        win_bonus = 0 if self.practice else WIN_BONUS
        self.result = {"winner": winner.id if winner else None, "reason": reason,
                       "xp": {p.id: (taken + win_bonus if p is winner else -taken if p is loser else 0) for p in self.p}}
        if reason == "no-show" or self.practice:
            self.result["xp"] = {p.id: 0 for p in self.p}

    def save(self):
        if self.practice or not self.result or self.result["reason"] == "no-show":
            return
        a, b = self.p
        conn = userdb.connect()
        try:
            conn.execute("INSERT INTO ql_fights (grp, a_id, b_id, a_name, b_name, winner_id, a_hp, b_hp, reason, stake, "
                         "created_at, game) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                         (self.grp, a.id, b.id, a.name, b.name, self.result["winner"], round(max(0, self.score(a))),
                          round(max(0, self.score(b))), self.result["reason"], self.stake, self.ended, self.kind))
            for p in self.p:
                if self.result["winner"] == p.id:
                    conn.execute("UPDATE ql_students SET arena_wins = arena_wins + 1 WHERE id=?", (p.id,))
                if self.result["xp"][p.id]:
                    conn.execute("UPDATE ql_students SET arena_xp = arena_xp + ? WHERE id=?",
                                 (self.result["xp"][p.id], p.id))
            conn.commit()
        finally:
            conn.close()

    def snapshot(self, full=False):
        now = time.time()
        left = {"waiting": self.seconds, "countdown": self.seconds,
                "fight": max(0.0, self.seconds - (now - self.phase_start)), "over": 0}[self.phase]
        return {"match": self.id, "game": self.kind, "phase": self.phase, "time_left": round(left, 1),
                "countdown": max(0, math.ceil(COUNTDOWN - (now - self.phase_start))) if self.phase == "countdown" else None,
                "players": [p.card() for p in self.p], "events": self.events, "result": self.result,
                "stake": self.stake, "practice": self.practice,
                "connected": {p.id: self.connected(p) for p in self.p}, **self.state(now, full)}


WIN_BONUS = 10


# ------------------------------------------------------------ math questions
def _num(n):
    return f"−{-n}" if n < 0 else str(n)


SUPERSCRIPT = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")


def make_question(rng, grade=9, hard=0):
    """A quick mental-math question with four choices: {id, text, options, answer}."""
    kinds = ["mul", "add", "pct", "sqrt", "linear", "pow"]
    if grade >= 10:
        kinds += ["func", "slope"]
    kind = rng.choice(kinds)
    if kind == "mul":
        a, b = rng.randint(3, 12 + hard), rng.randint(3, 15)
        text, ans = f"{a} × {b}", a * b
    elif kind == "add":
        a, b, c = rng.randint(-25, 60), rng.randint(5, 45), rng.randint(5, 50)
        text, ans = f"{_num(a)} + {b} − {c}", a + b - c
    elif kind == "pct":
        p = rng.choice([5, 10, 20, 25, 50, 75])
        n = 20 * rng.randint(1, 20)
        text, ans = f"{p}% of {n}", p * n // 100
    elif kind == "sqrt":
        r = rng.randint(4, 20)
        text, ans = f"√{r * r}", r
    elif kind == "linear":
        x, a, b = rng.randint(-9, 12), rng.randint(2, 9), rng.randint(-20, 20)
        text, ans = f"{a}x {'−' if b < 0 else '+'} {abs(b)} = {_num(a * x + b)}, x = ?", x
    elif kind == "pow":
        base = rng.choice([2, 2, 3, 5])
        e = rng.randint(2, {2: 10, 3: 5, 5: 4}[base])
        text, ans = f"{base}{str(e).translate(SUPERSCRIPT)}", base ** e
    elif kind == "func":
        x, a = rng.randint(-5, 6), rng.randint(1, 6)
        text, ans = f"f(x) = x² − {a}x, f({_num(x)}) = ?", x * x - a * x
    else:  # slope
        x1, y1, dx, m = rng.randint(-5, 5), rng.randint(-5, 5), rng.randint(1, 4), rng.choice([-4, -3, -2, -1, 1, 2, 3, 4, 5])
        text, ans = f"Slope through ({_num(x1)}, {_num(y1)}) and ({_num(x1 + dx)}, {_num(y1 + m * dx)})", m
    wrong = set()
    for d in rng.sample([1, -1, 2, -2, 10, -10, 3, 5], 8):
        if len(wrong) == 3:
            break
        if ans + d != ans:
            wrong.add(ans + d)
    if ans and len(wrong) < 3:
        wrong.add(-ans)
    options = list(wrong)[:3] + [ans]
    rng.shuffle(options)
    return {"id": secrets.token_hex(4), "text": text, "options": [_num(o) for o in options], "answer": options.index(ans)}


def public_question(q):
    return {"id": q["id"], "text": q["text"], "options": q["options"]} if q else None


# ----------------------------------------------------------------- car race
LANES = (-0.66, 0.0, 0.66)


class Race(Game):
    """Two cars on a three-lane road. Steer around cones and oil, drive over
    boost pads, and answer math questions for nitro. First past the line wins."""
    kind = "race"
    keys = ("left", "right")
    LENGTH = 12000
    MAX = 380
    NITRO = 1.6
    BOT_SKILL = 0.7

    def __init__(self, *args, **kw):
        super().__init__(*args, **kw)
        self.track = []
        d = 900
        while d < self.LENGTH - 500:
            lanes = self.rng.sample(LANES, self.rng.choice([1, 1, 2]))
            for x in lanes:
                kind = self.rng.choices(["cone", "oil", "boost"], [5, 2, 2])[0]
                self.track.append({"id": len(self.track), "d": d, "x": x, "type": kind})
            d += self.rng.randint(380, 640)
        for i, p in enumerate(self.p):
            p.d, p.x, p.v = 0.0, (-0.33, 0.33)[i], 0.0
            p.spin = p.slow = p.nitro = 0.0
            p.hits = set()
            p.quiz, p.locked_until, p.answer_at = None, 0.0, 0.0
            p.done_at = None

    def begin(self, now):
        for p in self.p:
            self._new_question(p, now)

    def _new_question(self, p, now):
        p.quiz = make_question(self.rng, self.grade)
        p.answer_at = now + self.rng.uniform(2.5, 6.0)

    def answer(self, p, qid, i, now):
        if not p.quiz or p.quiz["id"] != qid or now < p.locked_until:
            return
        if i == p.quiz["answer"]:
            p.nitro = max(p.nitro, 2.2)
            self.events.append({"type": "nitro", "who": p.id})
        else:
            p.locked_until = now + 2.0
            self.events.append({"type": "wrong", "who": p.id, "answer": p.quiz["options"][p.quiz["answer"]]})
        self._new_question(p, now)

    def tick(self, now):
        for p in self.p:
            steer = (1 if p.keys.get("right") else 0) - (1 if p.keys.get("left") else 0)
            if p.spin > 0:
                steer = 0
            p.x = min(1.0, max(-1.0, p.x + steer * 2.2 * TICK))
            top = self.MAX * (self.NITRO if p.nitro > 0 else 1) * (0.5 if p.slow > 0 else 1) * (0.95 if p.bot else 1)
            p.v += max(-600 * TICK, min(top - p.v, (320 if p.nitro > 0 else 170) * TICK))
            before = p.d
            p.d += p.v * TICK
            p.spin, p.slow, p.nitro = max(0, p.spin - TICK), max(0, p.slow - TICK), max(0, p.nitro - TICK)
            for o in self.track:
                if before < o["d"] <= p.d and o["id"] not in p.hits and abs(p.x - o["x"]) < 0.3:
                    p.hits.add(o["id"])
                    if o["type"] == "cone":
                        p.v *= 0.45
                        p.spin = 0.5
                    elif o["type"] == "oil":
                        p.slow, p.spin = 1.3, 0.8
                    else:
                        p.nitro = max(p.nitro, 1.0)
                    self.events.append({"type": o["type"], "who": p.id})
        done = [p for p in self.p if p.d >= self.LENGTH]
        if done:
            winner = max(done, key=lambda p: p.d) if len(done) == 1 or done[0].d != done[1].d else None
            self.finish(now, winner, "finish")

    def score(self, p):
        return p.d

    def bot(self, p, now):
        p.think = now + 0.15
        if p.quiz and now >= p.answer_at and now >= p.locked_until:
            q = p.quiz
            ok = self.rng.random() < self.BOT_SKILL
            self.answer(p, q["id"], q["answer"] if ok else (q["answer"] + 1) % 4, now)
        ahead = lambda lane: [o for o in self.track if 0 < o["d"] - p.d < 650 and abs(o["x"] - lane) < 0.3]
        bad = lambda lane: any(o["type"] != "boost" for o in ahead(lane))
        here = min(LANES, key=lambda lane: abs(lane - p.x))
        target = here
        if bad(here):
            free = [lane for lane in LANES if not bad(lane)]
            target = min(free, key=lambda lane: abs(lane - p.x)) if free else here
        elif any(o["type"] == "boost" for lane in LANES for o in ahead(lane)) and self.rng.random() < 0.3:
            target = next(lane for lane in LANES if any(o["type"] == "boost" for o in ahead(lane)))
        p.keys = {"left": p.x > target + 0.08, "right": p.x < target - 0.08}

    def state(self, now, full):
        out = {"length": self.LENGTH, "cars": [{
            "id": p.id, "d": round(p.d, 1), "x": round(p.x, 3), "v": round(p.v), "nitro": p.nitro > 0,
            "spin": p.spin > 0, "slow": p.slow > 0, "locked": round(max(0.0, p.locked_until - now), 1),
            "quiz": public_question(p.quiz)} for p in self.p]}
        if full:
            out["track"] = self.track
        return out


# ---------------------------------------------------------------- math duel
class Duel(Game):
    """Both players see the same question; the first right answer scores.
    A wrong answer locks you out of that question. First to 7 wins."""
    kind = "duel"
    keys = ()
    TARGET = 7
    Q_SECONDS = 10
    REVEAL = 1.6
    BOT_SKILL = 0.65

    def __init__(self, *args, **kw):
        super().__init__(*args, **kw)
        self.points = {p.id: 0 for p in self.p}
        self.q = None
        self.q_start = 0.0
        self.tried = set()
        self.reveal = None      # {answer, by} while the answer shows
        self.reveal_until = 0.0
        self.round = 0

    def begin(self, now):
        self._next(now)

    def _next(self, now):
        self.round += 1
        self.q = make_question(self.rng, self.grade, hard=self.round // 3)
        self.q_start, self.tried, self.reveal = now, set(), None
        for p in self.p:
            p.answer_at = now + self.rng.uniform(2.5, 6.5)

    def _show(self, now, by):
        self.reveal = {"answer": self.q["answer"], "by": by.id if by else None}
        self.reveal_until = now + self.REVEAL

    def answer(self, p, qid, i, now):
        if self.reveal or not self.q or self.q["id"] != qid or p.id in self.tried:
            return
        self.tried.add(p.id)
        if i == self.q["answer"]:
            self.points[p.id] += 1
            self.events.append({"type": "point", "who": p.id})
            self._show(now, p)
            if self.points[p.id] >= self.TARGET:
                self.finish(now, p, "score")
        else:
            self.events.append({"type": "wrong", "who": p.id, "i": i})
            if len(self.tried) == len(self.p):
                self._show(now, None)

    def tick(self, now):
        if self.reveal:
            if now >= self.reveal_until:
                self._next(now)
        elif now - self.q_start >= self.Q_SECONDS:
            self._show(now, None)

    def bot(self, p, now):
        p.think = now + 0.2
        if self.q and not self.reveal and p.id not in self.tried and now >= p.answer_at:
            ok = self.rng.random() < self.BOT_SKILL
            self.answer(p, self.q["id"], self.q["answer"] if ok else (self.q["answer"] + 1) % 4, now)

    def score(self, p):
        return self.points[p.id]

    def state(self, now, full):
        return {"points": self.points, "target": self.TARGET, "round": self.round,
                "question": public_question(self.q), "tried": sorted(self.tried),
                "q_left": round(max(0.0, self.Q_SECONDS - (now - self.q_start)), 1) if not self.reveal else 0,
                "reveal": self.reveal}


# -------------------------------------------------------------- number hunt
def _prime(n):
    return n > 1 and all(n % d for d in range(2, int(n ** 0.5) + 1))


RULES = [
    ("Multiples of 3", lambda n: n % 3 == 0),
    ("Multiples of 4", lambda n: n % 4 == 0),
    ("Multiples of 7", lambda n: n % 7 == 0),
    ("Even numbers", lambda n: n % 2 == 0),
    ("Odd numbers", lambda n: n % 2 == 1),
    ("Prime numbers", _prime),
    ("Perfect squares", lambda n: int(n ** 0.5) ** 2 == n),
    ("Factors of 48", lambda n: 48 % n == 0),
    ("Factors of 60", lambda n: 60 % n == 0),
    ("Greater than 35", lambda n: n > 35),
]


class Hunt(Game):
    """Collect the numbers that fit the rule (multiples of 3, primes, …); a
    wrong number costs a point and stuns you. The rule changes every 15 s."""
    kind = "hunt"
    W, H = 960, 540
    SPEED = 270
    R = 26          # player radius
    GEM = 20        # gem radius
    GEMS = 12
    RULE_SECONDS = 15

    def __init__(self, *args, **kw):
        super().__init__(*args, **kw)
        for i, p in enumerate(self.p):
            p.x, p.y = (240.0, 720.0)[i], 300.0
            p.points, p.stun = 0, 0.0
            p.target = None
        self.rule = self.rng.randrange(len(RULES))
        self.rule_start = self.created
        self.gems = []
        self.next_gem = 0

    def fits(self, n):
        return RULES[self.rule][1](n)

    def _spawn(self, want_fit):
        for _ in range(200):
            n = self.rng.randint(1, 60)
            if self.fits(n) == want_fit:
                break
        for _ in range(50):
            x, y = self.rng.uniform(40, self.W - 40), self.rng.uniform(110, self.H - 40)
            if all(math.hypot(x - p.x, y - p.y) > 90 for p in self.p) and \
                    all(math.hypot(x - g["x"], y - g["y"]) > 56 for g in self.gems):
                break
        self.next_gem += 1
        self.gems.append({"id": self.next_gem, "x": round(x, 1), "y": round(y, 1), "n": n})

    def _refill(self):
        while len(self.gems) < self.GEMS:
            good = sum(self.fits(g["n"]) for g in self.gems)
            self._spawn(good < 6 or self.rng.random() < 0.4)

    def begin(self, now):
        self.rule_start = now
        self._refill()

    def tick(self, now):
        if now - self.rule_start >= self.RULE_SECONDS:
            self.rule = self.rng.choice([i for i in range(len(RULES)) if i != self.rule])
            self.rule_start = now
            self.gems = [g for g in self.gems if self.fits(g["n"])][:4]  # mostly fresh numbers for the new rule
            self.events.append({"type": "rule", "text": RULES[self.rule][0]})
            self._refill()
        for p in self.p:
            p.stun = max(0.0, p.stun - TICK)
            if p.stun > 0:
                continue
            dx = (1 if p.keys.get("right") else 0) - (1 if p.keys.get("left") else 0)
            dy = (1 if p.keys.get("down") else 0) - (1 if p.keys.get("up") else 0)
            if dx or dy:
                n = math.hypot(dx, dy)
                speed = self.SPEED * (0.62 if p.bot else 1)
                p.x = min(self.W - self.R, max(self.R, p.x + dx / n * speed * TICK))
                p.y = min(self.H - self.R, max(90 + self.R, p.y + dy / n * speed * TICK))
        a, b = self.p
        gap = math.hypot(a.x - b.x, a.y - b.y)
        if 0 < gap < 2 * self.R:  # bodies bump instead of overlapping
            push = (2 * self.R - gap) / 2
            ux, uy = (a.x - b.x) / gap, (a.y - b.y) / gap
            a.x, a.y, b.x, b.y = a.x + ux * push, a.y + uy * push, b.x - ux * push, b.y - uy * push
        for p in self.p:
            for g in list(self.gems):
                if math.hypot(p.x - g["x"], p.y - g["y"]) < self.R + self.GEM:
                    self.gems.remove(g)
                    if self.fits(g["n"]):
                        p.points += 1
                        self.events.append({"type": "good", "who": p.id, "n": g["n"], "x": g["x"], "y": g["y"]})
                    else:
                        p.points -= 1
                        p.stun = 0.6
                        self.events.append({"type": "bad", "who": p.id, "n": g["n"], "x": g["x"], "y": g["y"]})
        self._refill()

    def bot(self, p, now):
        p.think = now + 0.4
        good = [g for g in self.gems if self.fits(g["n"])]
        if self.rng.random() < 0.12 and self.gems:  # bots slip up sometimes
            good = self.gems
        if not good:
            p.keys = {}
            return
        g = min(good, key=lambda g: math.hypot(g["x"] - p.x, g["y"] - p.y))
        p.keys = {"left": g["x"] < p.x - 8, "right": g["x"] > p.x + 8, "up": g["y"] < p.y - 8, "down": g["y"] > p.y + 8}

    def score(self, p):
        return p.points

    def state(self, now, full):
        return {"width": self.W, "height": self.H, "rule": RULES[self.rule][0],
                "rule_left": round(max(0.0, self.RULE_SECONDS - (now - self.rule_start)), 1) if self.phase == "fight" else self.RULE_SECONDS,
                "gems": self.gems,
                "hunters": [{"id": p.id, "x": round(p.x, 1), "y": round(p.y, 1), "points": p.points, "stun": p.stun > 0}
                            for p in self.p]}

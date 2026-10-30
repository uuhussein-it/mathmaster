/**
 * A live arena game (Fight, Car Race, Math Duel or Number Hunt). The server
 * runs the game; this screen sends which buttons are held and which answer
 * was tapped, and draws the state it receives about 15 times a second,
 * smoothing movement between updates. Each game's drawing and controls live
 * in js/games/.
 *
 * On touch screens the game fills the screen with its buttons laid over it,
 * and double-tap / pinch zoom is switched off while it's open.
 */
import { h, mount, burst } from '../ui.js';
import { go } from '../router.js';
import { account, adminApi as api } from '../account.js';
import { W, H } from '../games/common.js';
import fight from '../games/fight.js';
import race from '../games/race.js';
import duel from '../games/duel.js';
import hunt from '../games/hunt.js';
import { drawPower } from '../games/powers.js';

const GAMES = { fight, race, duel, hunt };
const DELAY = 90; // ms behind the newest update, so there are two to blend between
const ANSWER_KEYS = { 1: 0, 2: 1, 3: 2, 4: 3 };

export function renderFight(app, { match }) {
  const me = account.student?.id;
  const keys = {};
  const snaps = [];
  const particles = [];
  const texts = [];
  const powers = [];   // super attacks being drawn
  let game = null;     // the renderer, once the first update says which game this is
  let track = null;    // static data sent once (the race track)
  let socket = null;
  let raf = 0;
  let heartbeat = 0;
  let ended = false;
  let closed = false;
  let retries = 0;
  let quizKey = '';
  let startShown = 0;
  let lastPhase = '';
  let practice = false;

  const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  const canvas = h('canvas.fight-canvas', { width: W, height: H, 'aria-label': 'Game' });
  const ctx = canvas.getContext('2d');
  const status = h('p.fight-status', { 'aria-live': 'polite' }, 'Connecting…');
  const overlay = h('div.fight-over', { hidden: true });
  const quizBox = h('div.game-quiz', { hidden: true });
  const padBox = h('div.game-pad');
  const help = h('p.muted.small.fight-help');
  const leave = h('button.btn.ghost.sm.fight-leave', {
    onclick: () => {
      if (!ended && !confirm(practice ? 'Leave this practice game?' : 'Leave the game? You’ll lose it.')) return;
      if (!ended) api(`api/arena/match/${match}`, { method: 'DELETE' }).catch(() => {});
      go('arena');
    },
  }, 'Leave');
  const stage = h(`div.fight-stage${touch ? '.full' : ''}`, {},
    canvas, quizBox, padBox, overlay, touch && leave, touch && h('p.game-rotate', {}, 'Turn your phone sideways for a bigger view'));

  // ------------------------------------------------------------------ input
  function send(extra) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ keys, ...extra }));
  }
  function setKey(name, down) {
    if (!!keys[name] === down) return;
    keys[name] = down;
    send();
  }
  function onKey(down) {
    return (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (down && e.key in ANSWER_KEYS) {
        answer(ANSWER_KEYS[e.key]);
        return;
      }
      const name = game?.keys[e.key] || game?.keys[e.key.toLowerCase?.()];
      if (!name) return;
      e.preventDefault();
      setKey(name, down);
    };
  }
  const keydown = onKey(true);
  const keyup = onKey(false);
  const blur = () => Object.keys(keys).forEach((k) => setKey(k, false));
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', blur);

  // Stop the page zooming or scrolling under the game: double taps, pinches and drags.
  const stop = (e) => { if (!e.target.closest?.('button')) e.preventDefault(); };
  const stopAll = (e) => e.preventDefault();
  stage.addEventListener('touchstart', stop, { passive: false });
  stage.addEventListener('touchmove', stopAll, { passive: false });
  stage.addEventListener('touchend', stop, { passive: false });
  stage.addEventListener('dblclick', stopAll);
  document.addEventListener('gesturestart', stopAll);
  const viewport = document.querySelector('meta[name="viewport"]');
  const viewportWas = viewport?.getAttribute('content');
  if (touch) {
    viewport?.setAttribute('content', `${viewportWas}, maximum-scale=1, user-scalable=no`);
    document.documentElement.classList.add('in-game');
  }

  const pad = ([name, text, cls]) => h(`button.fight-btn.${cls}`, {
    type: 'button', 'aria-label': name,
    onpointerdown: (e) => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic event */ } setKey(name, true); },
    onpointerup: () => setKey(name, false),
    onpointercancel: () => setKey(name, false),
    onpointerleave: () => setKey(name, false),
    oncontextmenu: (e) => e.preventDefault(),
  }, text);

  function setup(kind) {
    game = GAMES[kind] || fight;
    stage.dataset.game = kind;
    help.textContent = game.help;
    if (touch && game.pad) {
      padBox.replaceChildren(
        game.pad.left ? h('div.game-pad-left', { class: game.pad.left.length === 4 ? 'cross' : '' }, game.pad.left.map(pad)) : h('span'),
        game.pad.right ? h('div.game-pad-right', { class: game.pad.right.length === 3 ? 'actions' : '' }, game.pad.right.map(pad)) : h('span'));
    }
  }

  // ---------------------------------------------------------------- answers
  let currentQuiz = null;
  function answer(i) {
    const q = currentQuiz;
    if (!q || q.locked || q.reveal || i >= q.options.length) return;
    send({ answer: { q: q.id, i } });
    q.locked = true; // until the server's next update
    quizBox.querySelectorAll('.game-opt')[i]?.classList.add('picked');
  }

  function drawQuiz(s) {
    const q = game.quiz ? game.quiz(s, me) : null;
    const key = q ? `${q.id}|${q.locked}|${q.reveal?.text || ''}` : '';
    if (key === quizKey) return;
    quizKey = key;
    currentQuiz = q;
    quizBox.hidden = !q;
    if (!q) return;
    quizBox.className = `game-quiz ${game.quizPlace || 'top'}`;
    quizBox.replaceChildren(
      h('p.game-quiz-title', {}, q.reveal ? q.reveal.text : q.locked ? q.lockText : q.title),
      h('p.game-quiz-q', {}, q.text),
      h('div.game-opts', {}, q.options.map((o, i) => h('button.game-opt', {
        type: 'button',
        class: q.reveal ? (i === q.reveal.answer ? 'right' : 'dim') : '',
        disabled: q.locked || !!q.reveal,
        onpointerdown: (e) => { e.preventDefault(); answer(i); },
      }, h('kbd', {}, String(i + 1)), o))));
  }

  // ----------------------------------------------------------------- socket
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const base = location.pathname.replace(/[^/]*$/, '');
    socket = new WebSocket(`${proto}://${location.host}${base}api/arena/ws/${match}`);
    socket.onopen = () => { retries = 0; send(); };
    socket.onmessage = (e) => {
      const s = JSON.parse(e.data);
      if (!game) setup(s.game || 'fight');
      practice = s.practice;
      if (s.track) track = s.track;
      else if (track) s.track = track;
      s.at = performance.now();
      snaps.push(s);
      if (snaps.length > 30) snaps.shift();
      game.events?.(s, fx, me);
      drawQuiz(s);
      if (s.phase === 'over' && !ended) finish(s);
    };
    socket.onclose = () => {
      if (closed || ended) return;
      // Reconnect a few times (phones drop connections); the server waits 8 s before a forfeit.
      if (retries++ < 4) setTimeout(connect, 800);
      else status.textContent = 'Lost the connection to the game.';
    };
  }

  const fx = {
    burst(x, y, color, n) {
      for (let i = 0; i < n; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const v = 120 + Math.random() * 260;
        particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 0.45, color });
      }
    },
    say(text, x, y, color, size = 24, life = 0.8) { texts.push({ text, x, y, color, size, life }); },
    power(power, from, to) { powers.push({ power, from, to, start: performance.now() }); },
    shake() {
      canvas.classList.remove('shake');
      void canvas.offsetWidth; // restart the animation
      canvas.classList.add('shake');
    },
  };

  function finish(s) {
    ended = true;
    leave.textContent = 'Back to the arena';
    quizBox.hidden = true;
    const r = s.result;
    const delta = r.xp?.[me] ?? 0;
    const won = r.winner === me;
    const how = { ko: 'Knockout', time: 'Time’s up', forfeit: 'Opponent left', 'no-show': 'Opponent didn’t join',
      finish: 'Finish line', score: 'First to 7' }[r.reason] || '';
    const title = r.winner == null ? (r.reason === 'no-show' ? 'Game cancelled' : 'Draw') : won ? 'You win!' : 'You lost';
    if (won) burst();
    overlay.hidden = false;
    overlay.replaceChildren(h('div.fight-over-card', {},
      h('p.eyebrow', {}, how),
      h('h2.display', {}, title),
      h('p', { class: delta > 0 ? 'xp-up' : delta < 0 ? 'xp-down' : '' },
        s.practice ? 'Practice game: no XP at stake' : delta > 0 ? `+${delta} XP` : delta < 0 ? `${delta} XP` : 'No XP changed hands'),
      h('button.btn.primary', { onclick: () => go('arena') }, 'Back to the arena')));
    status.textContent = '';
  }

  // ------------------------------------------------------------------- draw
  /** The state DELAY ms ago, blended between the two updates around it. */
  function current(now) {
    if (!snaps.length) return null;
    const t = now - DELAY;
    let i = snaps.length - 1;
    while (i > 0 && snaps[i - 1].at > t) i -= 1;
    const b = snaps[i];
    const a = snaps[i - 1];
    if (!a || b.at <= t || a.phase !== b.phase) return b;
    const k = Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at)));
    return game.blend(a, b, k);
  }

  function countdown(s, now) {
    if (s.phase === 'countdown' || s.phase === 'waiting') {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd34d';
      ctx.font = '800 96px Cinzel, serif';
      ctx.fillText(s.phase === 'waiting' ? '…' : String(s.countdown || game.start), W / 2, H / 2);
      ctx.font = '600 20px Inter, sans-serif';
      ctx.fillStyle = '#fff';
      const other = s.players.find((p) => p.id !== me);
      ctx.fillText(s.phase === 'waiting' ? `Waiting for ${other?.name || 'your opponent'} to join…` : 'Get ready!', W / 2, H / 2 + 50);
    } else if (s.phase === 'fight' && now - startShown < 900) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd34d';
      ctx.font = '800 88px Cinzel, serif';
      ctx.fillText(game.start, W / 2, H / 2);
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const s = current(now);
    if (s && game) {
      if (s.phase !== lastPhase) {
        if (s.phase === 'fight') startShown = now;
        lastPhase = s.phase;
        status.textContent = s.phase === 'waiting' ? 'Waiting for your opponent…' : '';
      }
      game.draw(ctx, s, { now, dt, me });
      remove(powers, (p) => !drawPower(ctx, p, now));
      countdown(s, now);
    } else {
      ctx.fillStyle = '#120d26';
      ctx.fillRect(0, 0, W, H);
    }
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 600 * dt;
      ctx.globalAlpha = Math.max(0, p.life / 0.45);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
    }
    for (const tx of texts) {
      tx.life -= dt;
      tx.y -= 40 * dt;
      ctx.globalAlpha = Math.max(0, Math.min(1, tx.life * 2));
      ctx.fillStyle = tx.color;
      ctx.font = `800 ${tx.size}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(tx.text, tx.x, tx.y);
    }
    ctx.globalAlpha = 1;
    remove(particles, (p) => p.life <= 0);
    remove(texts, (t) => t.life <= 0);
    raf = requestAnimationFrame(frame);
  }
  const remove = (list, dead) => { for (let i = list.length - 1; i >= 0; i -= 1) if (dead(list[i])) list.splice(i, 1); };

  // ----------------------------------------------------------------- layout
  mount(app, h('section.fight', {}, stage, status, !touch && help, !touch && leave));

  connect();
  heartbeat = setInterval(() => send(), 250);
  raf = requestAnimationFrame(frame);

  return () => {
    closed = true;
    cancelAnimationFrame(raf);
    clearInterval(heartbeat);
    window.removeEventListener('keydown', keydown);
    window.removeEventListener('keyup', keyup);
    window.removeEventListener('blur', blur);
    document.removeEventListener('gesturestart', stopAll);
    if (touch) {
      if (viewportWas != null) viewport.setAttribute('content', viewportWas);
      document.documentElement.classList.remove('in-game');
    }
    socket?.close();
  };
}

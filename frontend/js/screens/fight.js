/**
 * A live arena fight. The server runs the fight; this screen sends which
 * buttons are held and draws the state it receives about 15 times a second,
 * smoothing movement between updates.
 *
 * Keys: ← → move, ↑ jump, ↓ crouch (for combos), J punch, K kick, L block
 * (also A/D/W/S and Z/X/C). Touch screens get on-screen buttons.
 */
import { h, mount, burst } from '../ui.js';
import { go } from '../router.js';
import { account } from '../account.js';
import { drawFighter } from '../fighter-art.js';

const W = 960;
const H = 540;
const FLOOR = 470;
const DELAY = 90; // ms behind the newest update, so there are two to blend between
const KEYMAP = {
  ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'up', w: 'up',
  ArrowDown: 'down', s: 'down', j: 'punch', z: 'punch', k: 'kick', x: 'kick', l: 'block', c: 'block',
};
const SPECIAL_NAMES = { fireball: 'Fireball!', shield: 'Shield!', critical: 'Critical Strike!' };

export function renderFight(app, { match }) {
  const me = account.student?.id;
  const keys = { left: false, right: false, up: false, down: false, punch: false, kick: false, block: false };
  const snaps = [];
  const particles = [];
  const texts = [];
  let socket = null;
  let raf = 0;
  let heartbeat = 0;
  let ended = false;
  let closed = false;
  let retries = 0;

  const canvas = h('canvas.fight-canvas', { width: W, height: H, 'aria-label': 'Fight' });
  const ctx = canvas.getContext('2d');
  const status = h('p.fight-status', { 'aria-live': 'polite' }, 'Connecting…');
  const overlay = h('div.fight-over', { hidden: true });

  // ------------------------------------------------------------------ input
  function send() {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ keys }));
  }
  function setKey(name, down) {
    if (keys[name] === down) return;
    keys[name] = down;
    send();
  }
  const onKey = (down) => (e) => {
    const name = KEYMAP[e.key] || KEYMAP[e.key.toLowerCase?.()];
    if (!name || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    setKey(name, down);
  };
  const keydown = onKey(true);
  const keyup = onKey(false);
  const blur = () => Object.keys(keys).forEach((k) => setKey(k, false));
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', blur);

  const pad = (name, label, cls = '') => h(`button.fight-btn${cls}`, {
    type: 'button', 'aria-label': name,
    onpointerdown: (e) => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic event */ } setKey(name, true); },
    onpointerup: () => setKey(name, false),
    onpointercancel: () => setKey(name, false),
    onpointerleave: () => setKey(name, false),
    oncontextmenu: (e) => e.preventDefault(),
  }, label);

  // ----------------------------------------------------------------- socket
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const base = location.pathname.replace(/[^/]*$/, '');
    socket = new WebSocket(`${proto}://${location.host}${base}api/arena/ws/${match}`);
    socket.onopen = () => { retries = 0; send(); };
    socket.onmessage = (e) => {
      const s = JSON.parse(e.data);
      s.at = performance.now();
      snaps.push(s);
      if (snaps.length > 30) snaps.shift();
      handleEvents(s);
      if (s.phase === 'over' && !ended) finish(s);
    };
    socket.onclose = () => {
      if (closed || ended) return;
      // Reconnect a few times (phones drop connections); the server waits 8 s before a forfeit.
      if (retries++ < 4) setTimeout(connect, 800);
      else status.textContent = 'Lost the connection to the fight.';
    };
  }

  function handleEvents(s) {
    for (const ev of s.events || []) {
      if (ev.type === 'special') {
        const f = s.fighters.find((x) => x.id === ev.who);
        texts.push({ text: SPECIAL_NAMES[ev.move], x: f.x, y: FLOOR - 230, color: '#ffd34d', life: 1.1, size: 30 });
        continue;
      }
      const x = ev.x;
      const y = FLOOR - ev.y;
      const color = ev.type === 'hit' ? (ev.move === 'critical' ? '#ff4d6d' : '#ffb347') : '#8ad8ff';
      const n = ev.type === 'hit' ? (ev.move === 'critical' ? 26 : 12) : 6;
      for (let i = 0; i < n; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const v = 120 + Math.random() * 260;
        particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 0.45, color });
      }
      texts.push({
        text: ev.type === 'hit' ? `-${Math.round(ev.dmg)}` : ev.type === 'blocked' ? 'Blocked' : 'Shield',
        x, y: y - 40, color, life: 0.8, size: ev.move === 'critical' ? 34 : 24,
      });
      if (ev.who === me && ev.type === 'hit') navigator.vibrate?.(40);
    }
  }

  function finish(s) {
    ended = true;
    const leave = app.querySelector('.fight-leave');
    if (leave) leave.textContent = 'Back to the arena';
    const r = s.result;
    const delta = r.xp?.[me] ?? 0;
    const won = r.winner === me;
    const how = { ko: 'Knockout', time: 'Time’s up', forfeit: 'Opponent left', 'no-show': 'Opponent didn’t join' }[r.reason] || '';
    const title = r.winner == null ? (r.reason === 'no-show' ? 'Fight cancelled' : 'Draw') : won ? 'You win!' : 'You lost';
    if (won) burst();
    overlay.hidden = false;
    overlay.replaceChildren(h('div.fight-over-card', {},
      h('p.eyebrow', {}, how),
      h('h2.display', {}, title),
      h('p', { class: delta > 0 ? 'xp-up' : delta < 0 ? 'xp-down' : '' },
        delta > 0 ? `+${delta} XP` : delta < 0 ? `${delta} XP` : 'No XP changed hands'),
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
    if (!a || b.at <= t) return b;
    const k = Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at)));
    const lerp = (p, q) => p + (q - p) * k;
    return {
      ...b,
      fighters: b.fighters.map((f, j) => ({ ...f, x: lerp(a.fighters[j].x, f.x), y: lerp(a.fighters[j].y, f.y) })),
      projectiles: b.projectiles,
    };
  }

  function drawStage() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#1a1f4a');
    sky.addColorStop(0.65, '#2c2160');
    sky.addColorStop(1, '#120d26');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 9; i += 1) ctx.fillRect(40 + i * 110, 260 - (i % 3) * 30, 70, FLOOR - 260 + (i % 3) * 30);
    const floor = ctx.createLinearGradient(0, FLOOR, 0, H);
    floor.addColorStop(0, '#3b2f6b');
    floor.addColorStop(1, '#1b1538');
    ctx.fillStyle = floor;
    ctx.fillRect(0, FLOOR, W, H - FLOOR);
    ctx.strokeStyle = 'rgba(230,192,106,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, FLOOR);
    ctx.lineTo(W, FLOOR);
    ctx.stroke();
  }

  function drawHud(s) {
    const [a, b] = s.fighters;
    bars(a, 24, 1);
    bars(b, W - 24, -1);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '700 40px Cinzel, serif';
    ctx.fillText(String(Math.ceil(s.time_left)), W / 2, 62);
    ctx.font = '600 13px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(`${s.stake} XP at stake`, W / 2, 84);
    if (s.phase === 'countdown' || s.phase === 'waiting') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffd34d';
      ctx.font = '800 96px Cinzel, serif';
      ctx.fillText(s.phase === 'waiting' ? '…' : String(s.countdown || 'FIGHT!'), W / 2, H / 2);
      ctx.font = '600 20px Inter, sans-serif';
      ctx.fillStyle = '#fff';
      const other = s.fighters.find((f) => f.id !== me);
      ctx.fillText(s.phase === 'waiting' ? `Waiting for ${other?.name || 'your opponent'} to join…` : 'Get ready!', W / 2, H / 2 + 50);
    } else if (s.phase === 'fight' && performance.now() - fightStart < 900) {
      ctx.fillStyle = '#ffd34d';
      ctx.font = '800 88px Cinzel, serif';
      ctx.fillText('FIGHT!', W / 2, H / 2);
    }
  }
  let fightStart = 0;
  let lastPhase = '';

  function bars(f, x, dir) {
    const w = 360;
    const left = dir > 0 ? x : x - w;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(left, 24, w, 22);
    const pct = Math.max(0, f.hp / f.max_hp);
    ctx.fillStyle = pct > 0.5 ? '#4ade80' : pct > 0.25 ? '#facc15' : '#f87171';
    ctx.fillRect(dir > 0 ? left : left + w * (1 - pct), 24, w * pct, 22);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.strokeRect(left, 24, w, 22);
    const meterW = w * 0.6;
    const meterLeft = dir > 0 ? left : left + w - meterW;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(meterLeft, 52, meterW, 8);
    ctx.fillStyle = f.meter >= 100 ? '#ffd34d' : '#60a5fa';
    const mw = meterW * (f.meter / 100);
    ctx.fillRect(dir > 0 ? meterLeft : meterLeft + meterW - mw, 52, mw, 8);
    ctx.fillStyle = '#fff';
    ctx.font = '700 16px Inter, sans-serif';
    ctx.textAlign = dir > 0 ? 'left' : 'right';
    ctx.fillText(`${f.name}${f.id === me ? ' (you)' : ''}  ${Math.ceil(f.hp)}`, dir > 0 ? left : left + w, 80);
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const s = current(now);
    drawStage();
    if (s) {
      if (s.phase !== lastPhase) {
        if (s.phase === 'fight') fightStart = now;
        lastPhase = s.phase;
        status.textContent = s.phase === 'waiting' ? 'Waiting for your opponent…' : '';
      }
      for (const p of s.projectiles) {
        const g = ctx.createRadialGradient(p.x, FLOOR - p.y, 4, p.x, FLOOR - p.y, 30);
        g.addColorStop(0, '#fff7c2');
        g.addColorStop(0.4, '#ff9f1c');
        g.addColorStop(1, 'rgba(255,80,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, FLOOR - p.y, 30, 0, Math.PI * 2);
        ctx.fill();
      }
      // draw yourself in front
      [...s.fighters].sort((a) => (a.id === me ? 1 : -1)).forEach((f) => drawFighter(ctx, f, { now, over: s.phase === 'over', floor: FLOOR }));
      drawHud(s);
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
  const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  mount(app,
    h('section.fight', {},
      h('div.fight-stage', {}, canvas, overlay),
      status,
      touch
        ? h('div.fight-pad', {},
          h('div.fight-dpad', {}, pad('left', '◀'), pad('up', '▲'), pad('down', '▼'), pad('right', '▶')),
          h('div.fight-actions', {}, pad('punch', 'Punch', '.p'), pad('kick', 'Kick', '.k'), pad('block', 'Block', '.b')))
        : h('p.muted.small.fight-help', {},
          'Move ← → · Jump ↑ · Punch J · Kick K · Block L (hold). ',
          'Specials: Fireball ↓ → J · Shield ↓ ← J · Critical ↓ ↓ K (when unlocked and the meter is full enough).'),
      h('button.btn.ghost.sm.fight-leave', {
        onclick: () => { if (ended || confirm('Leave the fight? You’ll lose it.')) go('arena'); },
      }, ended ? 'Back' : 'Leave fight')));

  connect();
  heartbeat = setInterval(send, 250);
  raf = requestAnimationFrame(frame);

  return () => {
    closed = true;
    cancelAnimationFrame(raf);
    clearInterval(heartbeat);
    window.removeEventListener('keydown', keydown);
    window.removeEventListener('keyup', keyup);
    window.removeEventListener('blur', blur);
    socket?.close();
  };
}

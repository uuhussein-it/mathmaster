/**
 * A live arena fight. The server runs the fight; this screen sends which
 * buttons are held and draws the state it receives about 15 times a second,
 * smoothing movement between updates.
 *
 * Keys: ← → move, ↑ jump, ↓ crouch (for combos), J punch, K kick, L block
 * (also A/D/W/S and Z/X/C). Touch screens get on-screen buttons.
 */
import { h, mount, burst } from '../ui.js';
import { CHARACTERS } from '../characters.js';
import { go } from '../router.js';
import { account } from '../account.js';

const W = 960;
const H = 540;
const FLOOR = 470;
const DELAY = 90; // ms behind the newest update, so there are two to blend between
const SKIN_COLORS = { base: null, bronze: '#d08a4c', silver: '#d6deeb', gold: '#ffd34d' };
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
  const portraits = {};
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
  function portrait(character) {
    if (!portraits[character]) {
      const img = new Image();
      img.src = (CHARACTERS[character] || CHARACTERS.warrior).portrait;
      portraits[character] = img;
    }
    return portraits[character];
  }

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

  function drawFighter(f, now, over) {
    const hero = CHARACTERS[f.character] || CHARACTERS.warrior;
    const ko = over && f.hp <= 0;
    const x = f.x;
    const base = FLOOR - f.y;
    const t = now / 1000;
    ctx.save();
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, FLOOR + 6, 46 - Math.min(30, f.y / 8), 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(x, base);
    ctx.scale(f.facing, 1);
    if (ko) ctx.rotate(-Math.PI / 2.2);
    else if (f.stun) ctx.rotate(-0.22);
    const aura = SKIN_COLORS[f.skin];
    if (aura) {
      ctx.shadowColor = aura;
      ctx.shadowBlur = 18 + Math.sin(t * 4) * 6;
    }
    const walking = !f.action && !f.block && f.y === 0 && f.vx !== 0;
    const bob = f.y > 0 ? 0 : Math.sin(t * (walking ? 12 : 3)) * (walking ? 3 : 2);
    const hip = -78 + bob;
    const shoulder = -138 + bob;
    const progress = f.action ? f.action_t : 0;
    ctx.lineCap = 'round';
    ctx.strokeStyle = shade(hero.color, -35);
    ctx.lineWidth = 15;
    // legs
    const kick = f.action === 'kick' || f.action === 'critical';
    const stride = walking ? Math.sin(t * 12) * 16 : 10;
    line(0, hip, kick ? 70 * ext(progress, f.action) + 8 : stride, kick ? hip - 10 * ext(progress, f.action) : 0);
    line(0, hip, -stride - 6, 0);
    // torso
    ctx.fillStyle = hero.color;
    roundRect(-22, shoulder, 44, hip - shoulder + 6, 14);
    ctx.fill();
    if (aura) {
      ctx.strokeStyle = aura;
      ctx.lineWidth = 3;
      roundRect(-22, shoulder, 44, hip - shoulder + 6, 14);
      ctx.stroke();
    }
    // belt
    ctx.fillStyle = aura || shade(hero.color, -70);
    ctx.fillRect(-22, hip - 12, 44, 8);
    // arms, with fists
    ctx.strokeStyle = shade(hero.color, -20);
    ctx.lineWidth = 12;
    let fists;
    if (f.block) {
      fists = [[34, shoulder - 14], [26, shoulder - 6]];
      line(10, shoulder + 10, ...fists[0]);
      line(-6, shoulder + 12, ...fists[1]);
    } else if (f.action === 'punch' || f.action === 'critical') {
      fists = [[30 + 62 * ext(progress, f.action), shoulder + 10], [18, shoulder + 30]];
      line(10, shoulder + 12, ...fists[0]);
      line(-8, shoulder + 14, ...fists[1]);
    } else {
      fists = [[30, shoulder + 30 + bob], [14, shoulder + 36 + bob]];
      line(10, shoulder + 12, ...fists[0]);
      line(-8, shoulder + 14, ...fists[1]);
    }
    ctx.fillStyle = f.action === 'critical' ? '#ff4d6d' : '#f5f5f5';
    for (const [fx, fy] of fists) {
      ctx.beginPath();
      ctx.arc(fx, fy, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    // head: the hero's portrait
    ctx.shadowBlur = 0;
    const img = portrait(f.character);
    ctx.save();
    ctx.beginPath();
    ctx.arc(4, shoulder - 26, 27, 0, Math.PI * 2);
    ctx.clip();
    if (img.complete && img.naturalWidth) {
      ctx.scale(f.facing, 1); // undo the mirroring so the face isn't flipped
      ctx.drawImage(img, 4 * f.facing - 27, shoulder - 53, 54, 54);
    } else {
      ctx.fillStyle = '#f2d2b6';
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = aura || hero.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(4, shoulder - 26, 27, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    if (f.shield) {
      ctx.save();
      ctx.strokeStyle = 'rgba(138,216,255,0.9)';
      ctx.fillStyle = 'rgba(138,216,255,0.18)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(x, base - 95, 70, 110, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  const ext = (t, move) => {
    const at = { punch: 0.09, kick: 0.18, critical: 0.25 }[move] || 0.1;
    return t < at ? t / at : Math.max(0, 1 - (t - at) / (at * 1.6));
  };
  function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  function roundRect(x, y, w, hgt, r) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, hgt, r) : ctx.rect(x, y, w, hgt);
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
      [...s.fighters].sort((a) => (a.id === me ? 1 : -1)).forEach((f) => drawFighter(f, now, s.phase === 'over'));
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

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

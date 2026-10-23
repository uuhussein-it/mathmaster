/**
 * Fight: two heroes on a stage. Move, jump, punch, kick, block and specials.
 */
import { drawFighter } from '../fighter-art.js';
import { W, H, lerp } from './common.js';

const FLOOR = 470;
const SPECIAL_NAMES = { fireball: 'Fireball!', shield: 'Shield!', critical: 'Critical Strike!' };

export default {
  keys: {
    ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'up', w: 'up',
    ArrowDown: 'down', s: 'down', j: 'punch', z: 'punch', k: 'kick', x: 'kick', l: 'block', c: 'block',
  },
  pad: {
    left: [['up', '▲', 'n'], ['left', '◀', 'w'], ['right', '▶', 'e'], ['down', '▼', 's']],
    right: [['block', 'Block', 'b'], ['kick', 'Kick', 'k'], ['punch', 'Punch', 'p']],
  },
  help: 'Move ← → · Jump ↑ · Punch J · Kick K · Block L (hold). Specials: Fireball ↓ → J · Shield ↓ ← J · Critical ↓ ↓ K (when unlocked and the meter is full enough).',
  start: 'FIGHT!',

  blend(a, b, k) {
    return { ...b, fighters: b.fighters.map((f, j) => ({ ...f, x: lerp(a.fighters[j].x, f.x, k), y: lerp(a.fighters[j].y, f.y, k) })) };
  },

  events(s, fx, me) {
    for (const ev of s.events || []) {
      if (ev.type === 'special') {
        const f = s.fighters.find((x) => x.id === ev.who);
        fx.say(SPECIAL_NAMES[ev.move], f.x, FLOOR - 230, '#ffd34d', 30, 1.1);
        continue;
      }
      const y = FLOOR - ev.y;
      const color = ev.type === 'hit' ? (ev.move === 'critical' ? '#ff4d6d' : '#ffb347') : '#8ad8ff';
      fx.burst(ev.x, y, color, ev.type === 'hit' ? (ev.move === 'critical' ? 26 : 12) : 6);
      fx.say(ev.type === 'hit' ? `-${Math.round(ev.dmg)}` : ev.type === 'blocked' ? 'Blocked' : 'Shield',
        ev.x, y - 40, color, ev.move === 'critical' ? 34 : 24, 0.8);
      if (ev.who === me && ev.type === 'hit') navigator.vibrate?.(40);
    }
  },

  draw(ctx, s, { now, me }) {
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

    const [a, b] = s.fighters;
    bars(ctx, a, 24, 1, me);
    bars(ctx, b, W - 24, -1, me);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '700 40px Cinzel, serif';
    ctx.fillText(String(Math.ceil(s.time_left)), W / 2, 62);
    ctx.font = '600 13px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(s.practice ? 'Practice · no XP' : `${s.stake} XP at stake`, W / 2, 84);
  },
};

function bars(ctx, f, x, dir, me) {
  const w = 340;
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

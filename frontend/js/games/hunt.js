/**
 * Number Hunt: run around and collect the numbers that fit the rule
 * (primes, multiples of 3, …). Wrong numbers cost a point and stun you.
 */
import { W, H, lerp, colorOf, roundRect, avatar, label } from './common.js';

const TOP = 90;

export default {
  keys: {
    ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down',
  },
  pad: { left: [['up', '▲', 'n'], ['left', '◀', 'w'], ['right', '▶', 'e'], ['down', '▼', 's']], right: null },
  help: 'Move with the arrow keys (or W A S D). Collect only the numbers that fit the rule at the top; the rule changes every 15 seconds.',
  start: 'GO!',

  blend(a, b, k) {
    return { ...b, hunters: b.hunters.map((p, j) => ({ ...p, x: lerp(a.hunters[j].x, p.x, k), y: lerp(a.hunters[j].y, p.y, k) })) };
  },

  events(s, fx, me) {
    for (const ev of s.events || []) {
      if (ev.type === 'rule') fx.say(`New rule: ${ev.text}`, W / 2, H / 2, '#ffd34d', 34, 1.6);
      if (ev.type === 'good') {
        fx.burst(ev.x, ev.y, '#4ade80', 14);
        fx.say('+1', ev.x, ev.y - 30, '#4ade80', 26, 0.8);
      }
      if (ev.type === 'bad') {
        fx.burst(ev.x, ev.y, '#f87171', 10);
        fx.say(`−1 (${ev.n})`, ev.x, ev.y - 30, '#f87171', 24, 0.9);
        if (ev.who === me) navigator.vibrate?.(80);
      }
    }
  },

  draw(ctx, s, { now, me }) {
    const t = now / 1000;
    const g = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, W * 0.7);
    g.addColorStop(0, '#1f5f4a');
    g.addColorStop(1, '#0f2f2a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 48) { ctx.beginPath(); ctx.moveTo(x, TOP); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = TOP; y <= H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.fillStyle = 'rgba(5,10,20,0.6)';
    ctx.fillRect(0, 0, W, TOP);

    for (const gem of s.gems) {
      const bob = Math.sin(t * 3 + gem.id) * 3;
      ctx.save();
      ctx.translate(gem.x, gem.y + bob);
      ctx.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 24, Math.sin(a) * 24);
      }
      ctx.closePath();
      const gg = ctx.createLinearGradient(0, -24, 0, 24);
      gg.addColorStop(0, '#a5b4fc');
      gg.addColorStop(1, '#6d28d9');
      ctx.fillStyle = gg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      label(ctx, String(gem.n), gem.x, gem.y + bob + 7, { size: 19, weight: 800 });
    }

    [...s.hunters].sort((a) => (a.id === me ? 1 : -1)).forEach((p) => {
      const pl = s.players.find((x) => x.id === p.id);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 26, 24, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      avatar(ctx, pl?.character, p.x, p.y, 24, colorOf(s, p.id));
      label(ctx, p.id === me ? 'You' : pl?.name || '', p.x, p.y - 34, { size: 14 });
      if (p.stun) label(ctx, '💫', p.x + 20 * Math.cos(t * 8), p.y - 20, { size: 20 });
    });

    // HUD: rule banner, rule timer, scores, clock
    label(ctx, `Collect: ${s.rule}`, W / 2, 40, { size: 26, weight: 800, color: '#ffd34d' });
    roundRect(ctx, W / 2 - 150, 54, 300, 7, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fill();
    roundRect(ctx, W / 2 - 150, 54, 300 * (s.rule_left / 15), 7, 4);
    ctx.fillStyle = '#ffd34d';
    ctx.fill();
    s.hunters.forEach((p, i) => {
      const pl = s.players.find((x) => x.id === p.id);
      const x = i === 0 ? 24 : W - 24;
      avatar(ctx, pl?.character, i === 0 ? x + 22 : x - 22, 44, 20, colorOf(s, p.id));
      label(ctx, `${p.points}`, i === 0 ? x + 56 : x - 56, 54, { size: 30, weight: 800, align: i === 0 ? 'left' : 'right' });
    });
    label(ctx, `⏱ ${Math.ceil(s.time_left)}s  ·  ${s.practice ? 'Practice · no XP' : `${s.stake} XP at stake`}`, W / 2, 80, { size: 14, weight: 600, color: 'rgba(255,255,255,0.85)' });
  },
};

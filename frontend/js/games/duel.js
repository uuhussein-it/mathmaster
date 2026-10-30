/**
 * Math Duel: the same question for both players; the fastest right answer
 * scores. A wrong answer locks you out of that question. First to 7 wins.
 */
import { W, H, colorOf, roundRect, avatar, clock, label } from './common.js';
import { POWERS, powerOf } from './powers.js';

export default {
  keys: {},
  pad: null,
  help: 'Tap an answer or press 1–4. The first right answer scores; a wrong one locks you out of that question.',
  start: 'GO!',
  quizPlace: 'center',

  blend(a, b) { return b; },

  quiz(s, me) {
    if (!s.question || s.phase !== 'fight') return null;
    const opp = s.players.find((p) => p.id !== me);
    const r = s.reveal;
    return {
      ...s.question,
      big: true,
      locked: !r && s.tried.includes(me),
      lockText: 'Wrong: wait for the next question',
      reveal: r ? { answer: r.answer, text: r.by == null ? 'No one got it' : r.by === me ? 'You scored! ⚡' : `${opp?.name || 'Your rival'} scored` } : null,
      title: `Question ${s.round}`,
    };
  },

  events(s, fx, me) {
    for (const ev of s.events || []) {
      if (ev.type === 'point') {
        const left = s.players[0].id === ev.who;
        const power = powerOf(s, ev.who);
        fx.power(power, { x: left ? 150 : W - 150, y: 112 }, { x: left ? W - 150 : 150, y: 120 });
        fx.burst(left ? 150 : W - 150, 120, colorOf(s, ev.who), 22);
        fx.say(`+1 ${POWERS[power].icon}`, left ? 150 : W - 150, 70, '#ffd34d', 34, 0.9);
      } else if (ev.type === 'wrong' && ev.who === me) {
        navigator.vibrate?.(80);
      }
    }
  },

  draw(ctx, s, { now }) {
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1d1650');
    bg.addColorStop(1, '#0d2a4a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // drifting symbols
    ctx.font = '700 36px Inter, sans-serif';
    ctx.textAlign = 'center';
    const sym = ['+', '−', '×', '÷', '√', 'π', '=', '%'];
    for (let i = 0; i < 18; i += 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      const y = (i * 97 + now / 30) % (H + 60) - 30;
      ctx.fillText(sym[i % sym.length], (i * 151) % W, H - y);
    }
    s.players.forEach((p, i) => {
      const x = i === 0 ? 150 : W - 150;
      const color = colorOf(s, p.id);
      avatar(ctx, p.character, x, 120, 44, color);
      label(ctx, p.name, x, 192, { size: 18 });
      const pts = s.points[p.id] ?? 0;
      for (let k = 0; k < s.target; k += 1) {
        const px = x + (k - (s.target - 1) / 2) * 22;
        ctx.beginPath();
        ctx.arc(px, 216, 8, 0, Math.PI * 2);
        ctx.fillStyle = k < pts ? '#ffd34d' : 'rgba(255,255,255,0.15)';
        ctx.fill();
      }
      if (s.tried.includes(p.id) && !s.reveal) label(ctx, '✗', x + 52, 92, { size: 26, color: '#f87171' });
    });
    clock(ctx, s, 54);
    // question timer
    if (s.phase === 'fight' && !s.reveal) {
      const w = 300;
      roundRect(ctx, W / 2 - w / 2, 92, w, 8, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fill();
      roundRect(ctx, W / 2 - w / 2, 92, w * (s.q_left / 10), 8, 4);
      ctx.fillStyle = s.q_left < 3 ? '#f87171' : '#4fd1e8';
      ctx.fill();
    }
  },
};

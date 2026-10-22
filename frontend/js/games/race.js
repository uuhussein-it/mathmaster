/**
 * Car Race: a three-lane road seen from behind your car. Steer around cones
 * and oil, drive over boost pads, and answer math questions for nitro.
 */
import { W, H, lerp, colorOf, roundRect, avatar, clock, label } from './common.js';

const HORIZON = 210;
const CAM = 260;       // camera distance: bigger = flatter road
const VIEW = 1500;     // how far ahead the road is drawn (world units)
const ROAD = 430;      // half road width on screen at the camera
const STRIPE = 160;    // world units per stripe
const ME_Z = 70;       // your car sits this far ahead of the camera

const project = (z) => {
  const k = CAM / (CAM + Math.max(z, -CAM + 1));
  return { y: HORIZON + (H - HORIZON) * k, half: ROAD * k, k };
};

export default {
  keys: { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' },
  pad: { left: [['left', '◀', 'big']], right: [['right', '▶', 'big']] },
  help: 'Steer ← → (or A / D). Answer the question with 1–4 or a tap: a right answer fires nitro, a wrong one locks it for 2 s.',
  start: 'GO!',
  quizPlace: 'top',

  blend(a, b, k) {
    return { ...b, track: b.track, cars: b.cars.map((c, j) => ({ ...c, d: lerp(a.cars[j].d, c.d, k), x: lerp(a.cars[j].x, c.x, k) })) };
  },

  quiz(s, me) {
    const c = s.cars.find((x) => x.id === me);
    if (!c?.quiz || s.phase !== 'fight') return null;
    return { ...c.quiz, locked: c.locked > 0, lockText: 'Nitro locked…', title: c.nitro ? '🔥 NITRO!' : 'Answer for nitro' };
  },

  events(s, fx, me) {
    for (const ev of s.events || []) {
      if (ev.who !== me) continue;
      const say = { nitro: ['NITRO!', '#ffb02e'], wrong: [`Not quite: it was ${ev.answer}`, '#f87171'],
        cone: ['Bump!', '#ff9f43'], oil: ['Oil slick!', '#8ad8ff'], boost: ['Boost!', '#4fd1e8'] }[ev.type];
      if (say) fx.say(say[0], W / 2, H - 170, say[1], ev.type === 'wrong' ? 22 : 34, 1.1);
      if (ev.type === 'cone' || ev.type === 'oil') navigator.vibrate?.(60);
    }
  },

  draw(ctx, s, { now, me }) {
    const mine = s.cars.find((c) => c.id === me) || s.cars[0];
    const rival = s.cars.find((c) => c !== mine);
    const t = now / 1000;
    // sky, hills, grass
    const sky = ctx.createLinearGradient(0, 0, 0, HORIZON);
    sky.addColorStop(0, '#1b2a6b');
    sky.addColorStop(1, '#f59e6b');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, HORIZON);
    ctx.fillStyle = '#ffd59a';
    ctx.beginPath();
    ctx.arc(W * 0.72, HORIZON - 30, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b2a5c';
    ctx.beginPath();
    ctx.moveTo(0, HORIZON);
    for (let x = 0; x <= W; x += 40) ctx.lineTo(x, HORIZON - 30 - 26 * Math.sin((x + mine.d * 0.02) / 90) - 14 * Math.sin(x / 37));
    ctx.lineTo(W, HORIZON);
    ctx.fill();
    ctx.fillStyle = '#1f6b3a';
    ctx.fillRect(0, HORIZON, W, H - HORIZON);

    // road, far to near, in bands so stripes scroll with your distance
    for (let z = VIEW; z > -CAM * 0.6; z -= 40) {
      const far = project(z);
      const near = project(z - 40);
      const stripe = Math.floor((mine.d + z) / STRIPE) % 2 === 0;
      ctx.fillStyle = stripe ? '#2ea155' : '#25904a';
      ctx.fillRect(0, far.y, W, near.y - far.y + 1);
      const quad = (half1, half2, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(W / 2 - half1, far.y);
        ctx.lineTo(W / 2 + half1, far.y);
        ctx.lineTo(W / 2 + half2, near.y + 1);
        ctx.lineTo(W / 2 - half2, near.y + 1);
        ctx.fill();
      };
      quad(far.half * 1.12, near.half * 1.12, stripe ? '#f4f4f4' : '#e23d3d');
      quad(far.half, near.half, stripe ? '#4a4a5c' : '#45455a');
      if (stripe) {
        for (const lx of [-0.33, 0.33]) {
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.beginPath();
          ctx.moveTo(W / 2 + lx * far.half - 3 * far.k, far.y);
          ctx.lineTo(W / 2 + lx * far.half + 3 * far.k, far.y);
          ctx.lineTo(W / 2 + lx * near.half + 3 * near.k, near.y);
          ctx.lineTo(W / 2 + lx * near.half - 3 * near.k, near.y);
          ctx.fill();
        }
      }
    }
    // finish line
    const toFinish = s.length - mine.d + ME_Z;
    if (toFinish < VIEW) {
      const f = project(toFinish);
      for (let i = 0; i < 12; i += 1) {
        ctx.fillStyle = i % 2 ? '#111' : '#fff';
        ctx.fillRect(W / 2 - f.half + (2 * f.half * i) / 12, f.y - 8 * f.k, (2 * f.half) / 12, 16 * f.k);
      }
    }

    // obstacles and the rival, far to near
    const things = [];
    for (const o of s.track || []) {
      const z = o.d - mine.d + ME_Z;
      if (z > -40 && z < VIEW) things.push({ z, draw: () => obstacle(ctx, o, project(z), t) });
    }
    if (rival) {
      const z = rival.d - mine.d + ME_Z;
      if (z > -CAM * 0.5 && z < VIEW) things.push({ z, draw: () => car(ctx, project(z), rival, colorOf(s, rival.id), t, s.players.find((p) => p.id === rival.id)?.name) });
    }
    things.sort((a, b) => b.z - a.z).forEach((x) => x.draw());
    car(ctx, project(ME_Z), mine, colorOf(s, mine.id), t, null);

    // HUD: progress bar with both cars, speed, clock
    const barX = 30;
    const barW = 300;
    roundRect(ctx, barX, 22, barW, 12, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    for (const c of [rival, mine].filter(Boolean)) {
      const x = barX + barW * Math.min(1, c.d / s.length);
      const p = s.players.find((pp) => pp.id === c.id);
      avatar(ctx, p?.character, x, 28, 11, colorOf(s, c.id));
    }
    label(ctx, '🏁', barX + barW + 16, 34, { size: 18 });
    const lead = rival ? Math.round((mine.d - rival.d) / 10) : 0;
    label(ctx, rival ? (lead >= 0 ? `You lead by ${lead} m` : `${-lead} m behind`) : '', barX, 62, { size: 15, align: 'left' });
    label(ctx, `${Math.round(mine.v / 3.2)} km/h`, W - 30, 40, { size: 26, align: 'right', weight: 800, color: mine.nitro ? '#ffb02e' : '#fff' });
    clock(ctx, s, 50);
  },
};

function obstacle(ctx, o, p, t) {
  const x = W / 2 + o.x * p.half;
  const s = p.k;
  if (o.type === 'cone') {
    ctx.fillStyle = '#ff7a1a';
    ctx.beginPath();
    ctx.moveTo(x, p.y - 64 * s);
    ctx.lineTo(x + 26 * s, p.y);
    ctx.lineTo(x - 26 * s, p.y);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - 13 * s, p.y - 34 * s, 26 * s, 8 * s);
  } else if (o.type === 'oil') {
    ctx.fillStyle = 'rgba(10,10,20,0.85)';
    ctx.beginPath();
    ctx.ellipse(x, p.y - 4 * s, 70 * s, 16 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(120,160,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(x - 18 * s, p.y - 8 * s, 22 * s, 5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const glow = 0.6 + 0.4 * Math.sin(t * 8);
    ctx.fillStyle = `rgba(79,209,232,${glow})`;
    for (let i = 0; i < 3; i += 1) {
      const y = p.y - i * 16 * s;
      ctx.beginPath();
      ctx.moveTo(x - 50 * s, y);
      ctx.lineTo(x, y - 14 * s);
      ctx.lineTo(x + 50 * s, y);
      ctx.lineTo(x + 50 * s, y - 6 * s);
      ctx.lineTo(x, y - 20 * s);
      ctx.lineTo(x - 50 * s, y - 6 * s);
      ctx.fill();
    }
  }
}

function car(ctx, p, c, color, t, name) {
  const x = W / 2 + c.x * p.half;
  const s = p.k * 1.15;
  ctx.save();
  ctx.translate(x, p.y);
  if (c.spin) ctx.rotate(Math.sin(t * 30) * 0.25);
  ctx.scale(s, s);
  if (c.nitro) {
    const len = 30 + 14 * Math.sin(t * 40);
    for (const fx of [-38, 38]) {
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, '#fff3b0');
      g.addColorStop(1, 'rgba(255,90,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(fx - 10, -6);
      ctx.lineTo(fx + 10, -6);
      ctx.lineTo(fx, len);
      ctx.fill();
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 80, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  // body
  ctx.fillStyle = '#111';
  ctx.fillRect(-74, -30, 22, 30);
  ctx.fillRect(52, -30, 22, 30);
  roundRect(ctx, -66, -66, 132, 50, 14);
  ctx.fillStyle = color;
  ctx.fill();
  roundRect(ctx, -44, -98, 88, 40, 12);
  ctx.fill();
  ctx.fillStyle = 'rgba(20,30,60,0.85)';
  roundRect(ctx, -34, -92, 68, 26, 8);
  ctx.fill();
  ctx.fillStyle = '#ffdf6e';
  ctx.fillRect(-58, -48, 20, 10);
  ctx.fillRect(38, -48, 20, 10);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(-20, -40, 40, 12);
  ctx.restore();
  if (name) label(ctx, name, x, p.y - 120 * s, { size: Math.max(12, 18 * s) });
}

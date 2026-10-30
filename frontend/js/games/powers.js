/**
 * Super powers fired in the arena when a student answers a power question
 * first: Thunder Storm, Eye Laser, Fire Tornado and Ice Blast. Each effect
 * flies from the attacker (`from`) to the target (`to`) over about 1.4 s.
 */
export const POWERS = {
  thunder: { name: 'Thunder Storm', icon: '⚡', color: '#ffe066' },
  laser: { name: 'Eye Laser', icon: '👁️', color: '#ff3b5c' },
  fire: { name: 'Fire Tornado', icon: '🌪️', color: '#ff8a3d' },
  ice: { name: 'Ice Blast', icon: '❄️', color: '#9be7ff' },
};
export const DURATION = 1400;

export const powerOf = (s, id) => s.players.find((p) => p.id === id)?.look?.power || 'thunder';

/** Draw one effect; returns false once it has finished. */
export function drawPower(ctx, e, now) {
  const k = (now - e.start) / DURATION;
  if (k >= 1) return false;
  if (k < 0) return true;
  ctx.save();
  ({ thunder, laser, fire, ice }[e.power] || thunder)(ctx, e, k, now);
  ctx.restore();
  return true;
}

const fade = (k) => Math.min(1, k * 6, (1 - k) * 4);

// Seeded jitter so a bolt flickers between a few shapes instead of every frame.
function jitter(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function bolt(ctx, x1, y1, x2, y2, seed, width) {
  const steps = 9;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    ctx.lineTo(x1 + (x2 - x1) * t + (jitter(seed + i) - 0.5) * 60, y1 + (y2 - y1) * t);
  }
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = 'rgba(255,240,150,0.55)';
  ctx.lineWidth = width * 3;
  ctx.stroke();
  ctx.strokeStyle = '#fffbe0';
  ctx.lineWidth = width;
  ctx.stroke();
}

function thunder(ctx, e, k, now) {
  const { width: w } = ctx.canvas;
  // storm clouds roll in over the target
  ctx.globalAlpha = fade(k) * 0.85;
  ctx.fillStyle = '#2a2d45';
  for (let i = 0; i < 7; i += 1) {
    ctx.beginPath();
    ctx.ellipse(e.to.x + (i - 3) * 55, 40 + (i % 2) * 18, 70, 34, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const flick = Math.floor(now / 70);
  if (k > 0.18 && k < 0.85) {
    ctx.shadowColor = '#fff6a0';
    ctx.shadowBlur = 24;
    for (let b = 0; b < 3; b += 1) {
      if (jitter(flick + b * 7) < 0.35) continue;
      bolt(ctx, e.to.x + (b - 1) * 70, 50, e.to.x + (b - 1) * 14, e.to.y + 40, flick * 3 + b * 11, 4);
    }
    if (jitter(flick) > 0.6) { // screen flash
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,230,0.18)';
      ctx.fillRect(0, 0, w, ctx.canvas.height);
    }
  }
  sparks(ctx, e.to, k, '#ffe066');
}

function laser(ctx, e, k, now) {
  const reach = Math.min(1, k / 0.25);
  const end = { x: e.from.x + (e.to.x - e.from.x) * reach, y: e.from.y + (e.to.y - e.from.y) * reach };
  const pulse = 1 + 0.3 * Math.sin(now / 30);
  ctx.globalAlpha = Math.min(1, (1 - k) * 4);
  ctx.lineCap = 'round';
  for (const dy of [-5, 5]) {
    ctx.beginPath();
    ctx.moveTo(e.from.x, e.from.y + dy);
    ctx.lineTo(end.x, end.y + dy * 0.4);
    ctx.shadowColor = '#ff2d55';
    ctx.shadowBlur = 22;
    ctx.strokeStyle = 'rgba(255,40,80,0.7)';
    ctx.lineWidth = 12 * pulse;
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  // glowing eyes
  ctx.fillStyle = '#fff';
  for (const dy of [-5, 5]) {
    ctx.beginPath();
    ctx.arc(e.from.x, e.from.y + dy, 5 * pulse, 0, Math.PI * 2);
    ctx.fill();
  }
  if (reach >= 1) {
    const g = ctx.createRadialGradient(e.to.x, e.to.y, 4, e.to.x, e.to.y, 60 * pulse);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.4, 'rgba(255,60,90,0.7)');
    g.addColorStop(1, 'rgba(255,0,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(e.to.x, e.to.y, 60 * pulse, 0, Math.PI * 2);
    ctx.fill();
  }
  sparks(ctx, e.to, k, '#ff3b5c');
}

function fire(ctx, e, k, now) {
  // a fireball flies over, then becomes a spinning tornado around the target
  const travel = Math.min(1, k / 0.3);
  const x = e.from.x + (e.to.x - e.from.x) * travel;
  const baseY = e.to.y + 90;
  const grow = Math.min(1, Math.max(0, (k - 0.2) / 0.25));
  const alpha = Math.min(1, (1 - k) * 4);
  ctx.globalAlpha = alpha;
  if (travel < 1) {
    const y = e.from.y + (e.to.y - e.from.y) * travel - Math.sin(travel * Math.PI) * 60;
    const g = ctx.createRadialGradient(x, y, 3, x, y, 34);
    g.addColorStop(0, '#fff3b0');
    g.addColorStop(0.5, '#ff8a3d');
    g.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 34, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = now / 1000;
  for (let i = 0; i < 14; i += 1) {
    const h = i / 13;
    const y = baseY - h * 230 * grow;
    const r = (18 + h * 70) * grow;
    const spin = t * 9 + i * 0.7;
    ctx.strokeStyle = `hsla(${20 + h * 25}, 100%, ${55 + h * 10}%, ${0.75 - h * 0.3})`;
    ctx.lineWidth = 9 - h * 4;
    ctx.beginPath();
    ctx.ellipse(e.to.x + Math.sin(spin) * 10 * h, y, r, r * 0.28, 0, spin % (Math.PI * 2), spin % (Math.PI * 2) + Math.PI * 1.4);
    ctx.stroke();
  }
  sparks(ctx, e.to, k, '#ff8a3d');
}

function ice(ctx, e, k) {
  const travel = Math.min(1, k / 0.35);
  ctx.globalAlpha = Math.min(1, (1 - k) * 3);
  // shards fly in a fan
  if (travel < 1) {
    for (let i = 0; i < 6; i += 1) {
      const off = (i - 2.5) * 16;
      const x = e.from.x + (e.to.x - e.from.x) * travel;
      const y = e.from.y + (e.to.y - e.from.y) * travel + off * (1 - travel);
      const ang = Math.atan2(e.to.y - e.from.y, e.to.x - e.from.x);
      ctx.save();
      ctx.translate(x - Math.cos(ang) * i * 10, y);
      ctx.rotate(ang);
      ctx.fillStyle = i % 2 ? '#e6fbff' : '#9be7ff';
      ctx.beginPath();
      ctx.moveTo(22, 0);
      ctx.lineTo(-10, -6);
      ctx.lineTo(-10, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  } else {
    // the target freezes in a block of ice
    const w = 120;
    const hgt = 200;
    const x = e.to.x - w / 2;
    const y = e.to.y + 90 - hgt;
    ctx.fillStyle = 'rgba(160,230,255,0.38)';
    ctx.strokeStyle = 'rgba(230,250,255,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 10, y);
    ctx.lineTo(x + w, y + 14);
    ctx.lineTo(x + w - 6, y + hgt);
    ctx.lineTo(x, y + hgt - 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 30, y + 30);
    ctx.lineTo(x + 52, y + 80);
    ctx.lineTo(x + 40, y + 120);
    ctx.moveTo(x + 80, y + 50);
    ctx.lineTo(x + 70, y + 100);
    ctx.stroke();
  }
  sparks(ctx, e.to, k, '#9be7ff');
}

/** A ring of sparks at the target as the hit lands. */
function sparks(ctx, at, k, color) {
  if (k < 0.3 || k > 0.75) return;
  const p = (k - 0.3) / 0.45;
  ctx.globalAlpha = 1 - p;
  ctx.fillStyle = color;
  for (let i = 0; i < 16; i += 1) {
    const a = (Math.PI * 2 * i) / 16;
    const r = 20 + p * 90;
    ctx.fillRect(at.x + Math.cos(a) * r - 3, at.y + Math.sin(a) * r - 3, 6, 6);
  }
}

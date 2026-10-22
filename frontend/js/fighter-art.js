/**
 * Draws an arena fighter: body in the hero's colour, the hero portrait as the
 * head, the skin's glow and the equipped gear (weapon, armor, cape, charm).
 * Shared by the fight screen and the armory preview.
 */
import { CHARACTERS } from './characters.js';

export const SKIN_COLORS = { base: null, bronze: '#d08a4c', silver: '#d6deeb', gold: '#ffd34d' };

const portraits = {};
export function portrait(character) {
  if (!portraits[character]) {
    const img = new Image();
    img.src = (CHARACTERS[character] || CHARACTERS.warrior).portrait;
    portraits[character] = img;
  }
  return portraits[character];
}

export function drawFighter(ctx, f, { now, over = false, floor }) {
  const line = (x1, y1, x2, y2) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  const roundRect = (x, y, w, hgt, r) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, hgt, r);
    else ctx.rect(x, y, w, hgt);
  };
  const gear = f.gear || {};
  const hero = CHARACTERS[f.character] || CHARACTERS.warrior;
  const ko = over && f.hp <= 0;
  const x = f.x;
  const base = floor - f.y;
  const t = now / 1000;
  ctx.save();
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, floor + 6, 46 - Math.min(30, f.y / 8), 10, 0, 0, Math.PI * 2);
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
  if (gear.armor?.cape) {
    const flap = Math.sin(t * 5) * 6;
    ctx.fillStyle = gear.armor.color;
    ctx.beginPath();
    ctx.moveTo(-14, shoulder + 4);
    ctx.lineTo(-48 + flap, hip + 40);
    ctx.lineTo(-12, hip + 30);
    ctx.closePath();
    ctx.fill();
  }
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
  if (gear.armor?.color && !gear.armor.cape) drawArmor(ctx, gear.armor.color, shoulder, hip, roundRect);
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
  if (gear.weapon?.color && !ko) drawWeapon(ctx, gear.weapon, fists[0], f.block ? -Math.PI / 2 : f.action === 'punch' || f.action === 'critical' ? -0.15 : -1.05);
  if (gear.charm?.color) {
    ctx.save();
    ctx.shadowColor = gear.charm.color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = gear.charm.color;
    ctx.beginPath();
    ctx.arc(-38, shoulder - 6 + Math.sin(t * 3) * 5, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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

/** Chest plate and shoulder pads in the armor's colour. */
function drawArmor(ctx, color, shoulder, hip, roundRect) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  roundRect(-20, shoulder + 6, 40, (hip - shoulder) * 0.55, 10);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = shade(color, -60);
  ctx.lineWidth = 2;
  ctx.stroke();
  for (const sx of [-18, 16]) {
    ctx.beginPath();
    ctx.ellipse(sx, shoulder + 6, 13, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** A sword, staff or hammer held in the front fist, pointing along `angle`. */
function drawWeapon(ctx, look, [fx, fy], angle) {
  ctx.save();
  ctx.translate(fx, fy);
  ctx.rotate(angle);
  ctx.lineCap = 'round';
  if (look.kind === 'staff') {
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(80, 0); ctx.stroke();
    ctx.shadowColor = look.color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = look.color;
    ctx.beginPath(); ctx.arc(88, 0, 11, 0, Math.PI * 2); ctx.fill();
  } else if (look.kind === 'hammer') {
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(62, 0); ctx.stroke();
    ctx.shadowColor = look.color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = look.color;
    ctx.fillRect(56, -18, 26, 36);
  } else {
    ctx.strokeStyle = '#4a3020';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(8, 0); ctx.stroke(); // grip
    ctx.strokeStyle = '#c9a04a';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(10, -12); ctx.lineTo(10, 12); ctx.stroke(); // guard
    ctx.fillStyle = look.color;
    ctx.shadowColor = look.color;
    ctx.shadowBlur = look.id === 'flame-sword' || look.id === 'star-blade' ? 14 : 4;
    ctx.beginPath();
    ctx.moveTo(12, -5); ctx.lineTo(78, -4); ctx.lineTo(90, 0); ctx.lineTo(78, 4); ctx.lineTo(12, 5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

const ext = (t, move) => {
  const at = { punch: 0.09, kick: 0.18, critical: 0.25 }[move] || 0.1;
  return t < at ? t / at : Math.max(0, 1 - (t - at) / (at * 1.6));
};

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

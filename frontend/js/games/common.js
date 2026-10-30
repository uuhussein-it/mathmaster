/**
 * Drawing helpers shared by the arena games.
 */
import { CHARACTERS } from '../characters.js';
import { portrait } from '../fighter-art.js';

export const W = 960;
export const H = 540;
const RIVAL_COLOR = '#b48cff';

/** The player's colour: their hero's, or purple for a rival who picked the same hero. */
export function colorOf(s, id) {
  const [a, b] = s.players;
  const p = s.players.find((x) => x.id === id) || a;
  const own = (x) => x.look?.body || (CHARACTERS[x.character] || CHARACTERS.warrior).color;
  if (p === b && a && own(a) === own(b)) return own(a) === RIVAL_COLOR ? '#7ddc7a' : RIVAL_COLOR;
  return own(p);
}

export const lerp = (p, q, k) => p + (q - p) * k;

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/** A hero portrait in a coloured ring. */
export function avatar(ctx, character, x, y, r, color) {
  const img = portrait(character);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r + 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  if (img.complete && img.naturalWidth) ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
  else { ctx.fillStyle = '#2a2350'; ctx.fill(); }
  ctx.restore();
}

/** Clock in the top middle. */
export function clock(ctx, s, y = 52) {
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = '700 38px Cinzel, serif';
  ctx.fillText(String(Math.ceil(s.time_left)), W / 2, y);
  if (s.practice || s.stake) {
    ctx.font = '600 13px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(s.practice ? 'Practice · no XP' : `${s.stake} XP at stake`, W / 2, y + 22);
  }
}

export function label(ctx, text, x, y, { size = 16, color = '#fff', align = 'center', weight = 700 } = {}) {
  ctx.font = `${weight} ${size}px Inter, sans-serif`;
  ctx.textAlign = align;
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

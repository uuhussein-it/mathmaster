/**
 * Pixel art for the realm, drawn in code (no image files): heroes for each
 * class and evolution tier with their cosmetics, buildings, decorations,
 * scenery for the world map, and the guild bosses. Each sprite is painted at
 * low resolution into a small canvas, given a dark outline, and handed to
 * Phaser as a texture (or shown directly, scaled up with smoothing off).
 */
export const T = 16;

function canvas(w = T, h = T) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const OUTLINE = '#1a1426';

/** Give every sprite a 1px dark outline around its filled pixels. */
function outline(c) {
  const g = c.getContext('2d');
  const { width: w, height: h } = c;
  const img = g.getImageData(0, 0, w, h);
  const a = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img.data[(y * w + x) * 4 + 3]);
  const edge = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (a(x, y) > 0) continue;
      if (a(x - 1, y) > 200 || a(x + 1, y) > 200 || a(x, y - 1) > 200 || a(x, y + 1) > 200) edge.push([x, y]);
    }
  }
  g.fillStyle = OUTLINE;
  edge.forEach(([x, y]) => g.fillRect(x, y, 1, 1));
  return c;
}

/** Paint rows of palette letters ('.' is transparent). */
function paint(rows, palette, w = T, h = rows.length) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  rows.forEach((row, y) => {
    [...row.padEnd(w, '.').slice(0, w)].forEach((ch, x) => {
      if (ch === '.' || !palette[ch]) return;
      g.fillStyle = palette[ch];
      g.fillRect(x, y, 1, 1);
    });
  });
  return c;
}

function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

/** Draw helper: rectangles in art pixels. */
function pen(c) {
  const g = c.getContext('2d');
  return (color, x, y, w = 1, h = 1) => {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  };
}

// ---------------------------------------------------------------- heroes
const HEAD = [
  '......kkkk......',
  '....kkhhhhkk....',
  '...khhhhhhhhk...',
  '...khhsssshhk...',
  '...kssssssssk...',
  '...kskssssksk...',
  '...kssssssssk...',
  '....kssmmssk....',
];
const BODY = [
  '...kcccccccck...',
  '..kcccyyyyccck..',
  '..ksccccccccsk..',
  '...kcddddddck...',
  '...kcccccccck...',
];
const LEGS = [
  ['....kbbkkbbk....', '....kbbk.kbbk...', '.....kk...kk....'],
  ['....kbbkkbbk....', '...kbbk..kbbk...', '...kk......kk...'],
];
const HAIR = { warrior: '#5a2b14', sage: '#dcdce8', explorer: '#7a4a1e' };
export const CLASS_COLOR = { sage: '#4fd1e8', warrior: '#ff6b5a', explorer: '#7ddc7a' };

const HATS = {
  'hat-wizard': { pal: { p: '#5b3fc4', y: '#ffd34d' }, rows: ['.......pp.......', '......pppp......', '.....pppypp.....', '..pppppppppppp..'] },
  'hat-laurel': { pal: { l: '#3ddc84', g: '#1e8f52' }, rows: ['', '....lgl..lgl....', '...l........l...', ''] },
  'hat-horns': { pal: { s: '#c9c4dc', w: '#f2ead3', g: '#8f88a8' }, rows: ['..w..........w..', '..ws.ssssss.sw..', '...ssggggggss...', ''] },
  'hat-crown': { pal: { y: '#ffd34d', r: '#e23d3d', o: '#c9971f' }, rows: ['....y.y..y.y....', '....yyyyyyyy....', '....yryoyyry....', ''] },
};
export const AURA = { 'aura-ember': '#ff7a3d', 'aura-frost': '#8fe6ff', 'aura-star': '#ffe066' };
export const BANNER = { 'banner-red': '#d64545', 'banner-green': '#2fbf71', 'banner-gold': '#ffd34d' };

/**
 * A hero facing the viewer: two walk frames. `tier` is the evolution stage
 * (0 Novice, 1 Adept with a cape, 2 Champion with a weapon and gold trim,
 * 3 Legend with a crown), `wear` the cosmetics { hat, aura }.
 */
export function heroFrames(character, tier = 0, wear = {}) {
  const cloak = CLASS_COLOR[character] || '#ff6b5a';
  const pal = {
    k: OUTLINE, h: HAIR[character] || '#5a2b14', s: '#f2c9a0', m: '#c98a6a',
    c: cloak, d: shade(cloak, -60), y: tier >= 2 ? '#ffd34d' : shade(cloak, 40), b: '#3a2a1e',
  };
  return LEGS.map((legs) => {
    const c = canvas();
    const g = c.getContext('2d');
    const p = pen(c);
    if (tier >= 1) { // cape behind the body
      p(shade(cloak, -80), 2, 8, 1, 6);
      p(shade(cloak, -80), 13, 8, 1, 6);
      p(shade(cloak, -80), 3, 13, 10, 1);
    }
    g.drawImage(paint([...HEAD, ...BODY, ...legs], pal), 0, 0);
    if (tier >= 2) { // shoulder pads and the class weapon
      p('#ffd34d', 2, 8, 2, 1);
      p('#ffd34d', 12, 8, 2, 1);
      if (character === 'sage') {
        p('#8a5a32', 14, 4, 1, 11);
        p('#7fe3f5', 13, 2, 3, 2);
        p('#ffffff', 14, 2);
      } else if (character === 'warrior') {
        p('#e8eef8', 14, 3, 1, 8);
        p('#ffd34d', 13, 11, 3, 1);
        p('#8a5a32', 14, 12, 1, 2);
      } else {
        p('#8a5a32', 14, 4, 1, 1);
        p('#8a5a32', 15, 5, 1, 6);
        p('#8a5a32', 14, 11, 1, 1);
        p('#f2ead3', 14, 5, 1, 6);
      }
    }
    const hat = wear.hat ? HATS[wear.hat] : tier >= 3 ? HATS['hat-crown'] : null;
    if (hat) g.drawImage(paint(hat.rows, hat.pal, T, 4), 0, wear.hat === 'hat-wizard' ? -2 : -1);
    return c;
  });
}

// ------------------------------------------------------------- buildings
function base(p, w = 14) { // a soft shadow on the grass
  p('rgba(0,0,0,0.28)', (16 - w) / 2, 14, w, 2);
}

function hut(p, { x = 3, y = 5, w = 10, h = 8, wall, roof, door = true }) {
  base(p, w + 2);
  p(wall, x, y + 3, w, h - 3);
  p(shade(wall.startsWith('#') ? wall : '#888888', -35), x, y + h - 1, w, 1);
  for (let i = 0; i < 4; i += 1) p(i % 2 ? shade(roof, -30) : roof, x - 1 + i, y - i + 2, w + 2 - i * 2, 1);
  p(shade(roof, 30), x + 3, y - 2, w - 6, 1);
  if (door) {
    p('#3a2414', x + Math.floor(w / 2) - 1, y + h - 4, 2, 3);
    p('#ffe9a0', x + 1, y + 4, 2, 2);
    p('#ffe9a0', x + w - 3, y + 4, 2, 2);
  }
}

const BUILD_DRAW = {
  hall(p) {
    base(p, 16);
    p('#cfc6e0', 2, 6, 12, 8);
    p('#9a90b8', 2, 13, 12, 1);
    p('#cfc6e0', 1, 3, 3, 11);
    p('#cfc6e0', 12, 3, 3, 11);
    [1, 3, 12, 14].forEach((x) => p('#cfc6e0', x, 2, 1, 1));
    p('#5b3fc4', 1, 1, 3, 1); p('#5b3fc4', 12, 1, 3, 1);
    p('#3a2414', 7, 9, 2, 5);
    p('#ffd34d', 7, 9, 2, 1);
    p('#ffe9a0', 4, 7, 1, 2); p('#ffe9a0', 11, 7, 1, 2);
    p('#8f88a8', 5, 4, 6, 2);
    p('#ffd34d', 7, 0, 1, 4);
    p('#d64545', 8, 0, 3, 2);
  },
  farm(p) {
    base(p, 16);
    for (let y = 9; y < 15; y += 1) for (let x = 1; x < 15; x += 1) p((x + y) % 3 ? '#e5c25a' : '#b8902f', x, y);
    p('#7a4a24', 1, 8, 14, 1);
    hut(p, { x: 4, y: 2, w: 7, h: 6, wall: '#e8d9b5', roof: '#b5403a', door: false });
    p('#3a2414', 7, 5, 2, 3);
  },
  mill(p) {
    hut(p, { x: 2, y: 5, w: 9, h: 8, wall: '#c9a36a', roof: '#6b4426' });
    p('#9aa4b5', 12, 5, 3, 3); p('#e8eef8', 13, 6); // saw blade
    p('#7a4a24', 10, 12, 6, 2); p('#b07a45', 10, 12, 1, 2); p('#b07a45', 13, 12, 1, 2); // logs
    p('#7a4a24', 11, 10, 4, 2); p('#b07a45', 11, 10, 1, 2);
  },
  quarry(p) {
    base(p, 16);
    p('#8f88a8', 1, 7, 9, 7); p('#c9c4dc', 2, 6, 6, 2); p('#69728a', 1, 12, 9, 2);
    p('#8f88a8', 9, 9, 6, 5); p('#c9c4dc', 10, 9, 3, 1);
    p('#e8eef8', 4, 8); p('#e8eef8', 11, 11);
    p('#7a4a24', 11, 3, 1, 6); p('#c9c4dc', 9, 3, 5, 1); p('#c9c4dc', 9, 4, 1, 1); // pickaxe
  },
  mine(p) {
    base(p, 16);
    p('#8f88a8', 1, 4, 14, 10); p('#c9c4dc', 3, 3, 10, 2);
    p('#120e1e', 5, 8, 6, 6); p('#7a4a24', 4, 7, 8, 1); p('#7a4a24', 4, 7, 1, 7); p('#7a4a24', 11, 7, 1, 7);
    p('#ffd34d', 6, 12, 2, 1); p('#ffd34d', 9, 11); p('#ffd34d', 2, 6); p('#ffd34d', 13, 9);
    p('#9aa4b5', 12, 12, 3, 2); p('#ffd34d', 12, 11, 3, 1); // cart of gold
  },
  library(p) {
    hut(p, { x: 2, y: 5, w: 12, h: 8, wall: '#e8e2f5', roof: '#3b6fd1' });
    p('#ffffff', 3, 8, 1, 5); p('#ffffff', 12, 8, 1, 5); // columns
    p('#a8323e', 6, 1, 4, 3); p('#ffd34d', 7, 2, 2, 1); // book on the roof
  },
  tower(p) {
    base(p, 10);
    p('#7d6fb0', 5, 5, 6, 9); p('#5b4f8f', 5, 13, 6, 1);
    for (let i = 0; i < 5; i += 1) p(i % 2 ? '#4f2c8f' : '#7d4bd1', 4 + Math.floor(i / 2), 4 - i, 8 - Math.floor(i / 2) * 2, 1);
    p('#7fe3f5', 7, 7, 2, 2); p('#ffffff', 7, 7);
    p('#3a2414', 7, 11, 2, 3);
    p('#ffe066', 7, -1 + 1, 2, 1);
  },
  scaffold(p) {
    base(p, 14);
    p('#c9a36a', 2, 9, 12, 5);
    p('#7a4a24', 2, 4, 1, 10); p('#7a4a24', 13, 4, 1, 10); p('#7a4a24', 7, 4, 1, 10);
    p('#b07a45', 2, 4, 12, 1); p('#b07a45', 2, 8, 12, 1);
    p('#ffd34d', 4, 6, 2, 2); // a little sign
  },
  'decor-flowers'(p) {
    p('rgba(0,0,0,0.25)', 2, 13, 12, 2);
    p('#6b4426', 2, 10, 12, 4);
    [[3, 8, '#ff6fb5'], [6, 7, '#ffd34d'], [9, 8, '#ff6b5a'], [12, 7, '#b48cff']].forEach(([x, y, c]) => {
      p('#2f8f46', x, y + 1, 1, 2); p(c, x - 1, y, 3, 1); p(c, x, y - 1, 1, 3);
    });
  },
  'decor-lantern'(p) {
    p('rgba(0,0,0,0.25)', 5, 14, 6, 2);
    p('#3a3a4a', 7, 4, 2, 10); p('#3a3a4a', 5, 13, 6, 1);
    p('#ffb347', 6, 1, 4, 4); p('#ffe9a0', 7, 2, 2, 2); p('#3a3a4a', 6, 0, 4, 1);
  },
  'decor-statue'(p) {
    p('rgba(0,0,0,0.25)', 3, 14, 10, 2);
    p('#8f88a8', 4, 11, 8, 3); p('#c9c4dc', 4, 11, 8, 1);
    p('#c9c4dc', 6, 4, 4, 7); p('#c9c4dc', 6, 1, 4, 3); p('#8f88a8', 5, 5, 1, 4); p('#8f88a8', 10, 5, 1, 4);
    p('#e8eef8', 11, 0, 1, 6);
  },
  'decor-fountain'(p) {
    p('rgba(0,0,0,0.25)', 1, 14, 14, 2);
    p('#c9c4dc', 1, 9, 14, 5); p('#5fb6ff', 2, 9, 12, 2); p('#8f88a8', 1, 13, 14, 1);
    p('#c9c4dc', 7, 4, 2, 5); p('#c9c4dc', 5, 4, 6, 1);
    p('#8fe6ff', 7, 1, 2, 3); p('#8fe6ff', 4, 5, 1, 3); p('#8fe6ff', 11, 5, 1, 3);
  },
};

export function buildingSprite(type) {
  const c = canvas();
  (BUILD_DRAW[type] || BUILD_DRAW.scaffold)(pen(c));
  return outline(c);
}

export function bannerSprite(color = '#5b8cff') {
  const c = canvas(8, 16);
  const p = pen(c);
  p('#7a4a24', 1, 0, 1, 16);
  p(color, 2, 1, 5, 6);
  p(shade(color, -50), 2, 6, 1, 1); p(shade(color, -50), 6, 6, 1, 1);
  p(color, 3, 7, 3, 1);
  p('#ffd34d', 4, 3);
  return outline(c);
}

// ------------------------------------------------------------- scenery
export function grassTile(seed, colors = ['#4f9a45', '#46893d', '#5bab50']) {
  const c = canvas();
  const p = pen(c);
  const r = rand(seed * 7919 + 3);
  p(colors[0], 0, 0, T, T);
  for (let i = 0; i < 10; i += 1) p(r() < 0.5 ? colors[1] : colors[2], Math.floor(r() * T), Math.floor(r() * T), 1, r() < 0.5 ? 1 : 2);
  if (r() < 0.25) p('#ffe066', Math.floor(r() * 14), Math.floor(r() * 14));
  if (r() < 0.2) p('#ff8fc8', Math.floor(r() * 14), Math.floor(r() * 14));
  return c;
}

const SCENERY = {
  tree: { pal: { l: '#2f8f46', g: '#4fbf63', t: '#6b4426', s: 'rgba(0,0,0,0.3)' }, rows: [
    '.....llllll.....', '...llllgllll....', '..llgllllllgl...', '.llllllgllllll..', '.llgllllllglll..',
    'llllllglllllll..', 'llgllllllllgll..', '.lllllgllllll...', '..llllllllll....', '...llllllll.....',
    '.......tt.......', '.......tt.......', '.......tt.......', '......tttt......', '....ssssssss....'] },
  pine: { pal: { l: '#1e6b3a', g: '#2f8f50', t: '#4e2f16', s: 'rgba(0,0,0,0.3)' }, rows: [
    '.......l........', '......lgl.......', '.....lllll......', '....llglll......', '......lll.......',
    '....lllglll.....', '...lllllllll....', '.....lllll......', '...llllglll.....', '..lllllllllll...',
    '.lllllgllllll...', '.......tt.......', '.......tt.......', '.....ssssss.....'] },
  rock: { pal: { s: '#9aa4b5', w: '#c9c4dc', d: '#69728a', x: 'rgba(0,0,0,0.3)' }, rows: [
    '', '', '', '', '', '', '', '.....ssss.......', '....swwsss......', '...swsssssd.....', '..ssssssssdd....',
    '..sssssssdddd...', '...ddddddddd....', '...xxxxxxxxx....'] },
  wheat: { pal: { h: '#e5c25a', H: '#b8902f', g: '#7a9a35' }, rows: [
    '', '', '', '', '', '', '...h...h..h.....', '..hHh.hHhhHh....', '...g...g..g.....', '...g.h.g..g.h...',
    '...ghHhg..ghHh..', '...g.g.g..g.g...', '...g.g.g..g.g...'] },
  house: { pal: { r: '#b5403a', R: '#7f2a26', w: '#e8d9b5', d: '#3a2414', t: '#ffe9a0', x: 'rgba(0,0,0,0.3)' }, rows: [
    '', '', '', '......rrrr......', '.....rrrrrr.....', '....RRRRRRRR....', '...rrrrrrrrrr...', '....wwwwwwww....',
    '....wtwwwwtw....', '....wwwddwww....', '....wwwddwww....', '...xxxxxxxxxx...'] },
  castle: { pal: { s: '#cfc6e0', d: '#9a90b8', p: '#5b3fc4', y: '#ffd34d', b: '#3a2414', t: '#ffe9a0' }, rows: [
    '..p..........p..', '.ppp...y....ppp.', '.s.s..yyy...s.s.', '.sss.sssss..sss.', '.sss.ss.ss..sss.', '.sssssssssssssss',
    '.stssssssssssts.', '.sssssssssssssss', '.sssssbbbssssss.', '.sssssbbbssssss.', '.ddddddddddddddd'] },
  cloud: { pal: { w: '#ffffff', g: '#dfe6f5' }, rows: [
    '', '', '', '', '', '.....wwww.......', '...wwwwwwww.....', '.wwwwwwwwwwww...', 'wwwwwwwwwwwwww..', '.gggggggggggg...'] },
};

export function scenery(id) {
  const s = SCENERY[id];
  const c = paint(s.rows, s.pal);
  return id === 'cloud' ? c : outline(c);
}

// --------------------------------------------------------------- bosses
/**
 * A guild boss, drawn from a few parts: a round body, a head with eyes and
 * teeth, arms, and optional horns, wings or a crown. 48x48 art pixels.
 */
export const BOSSES = [
  { name: 'Goblin King', body: '#5fae4a', belly: '#a8d878', eye: '#ffe066', crown: true },
  { name: 'Thornback Wyrm', body: '#2f7f5a', belly: '#b8d890', eye: '#ff6b5a', horns: true, wings: true },
  { name: 'Stone Golem', body: '#8f88a8', belly: '#c9c4dc', eye: '#7fe3f5', square: true },
  { name: 'Shadow Lich', body: '#3b2f6b', belly: '#6b5aa8', eye: '#b8ff6b', crown: true, horns: true },
  { name: 'Ember Drake', body: '#c0452e', belly: '#ffb347', eye: '#ffe066', horns: true, wings: true },
  { name: 'Frost Titan', body: '#5a8fc8', belly: '#cfeaff', eye: '#ffffff', square: true, horns: true },
  { name: 'Storm Dragon', body: '#4a3fa8', belly: '#9fd8ff', eye: '#ffe066', horns: true, wings: true, crown: true },
];
export const bossInfo = (n) => BOSSES[(n - 1) % BOSSES.length];

export function bossSprite(n) {
  const b = bossInfo(n);
  const W = 48;
  const c = canvas(W, W);
  const p = pen(c);
  const blob = (cx, cy, rx, ry, color) => {
    for (let y = -ry; y <= ry; y += 1) {
      for (let x = -rx; x <= rx; x += 1) {
        const inside = b.square ? Math.abs(x) <= rx && Math.abs(y) <= ry && !(Math.abs(x) === rx && Math.abs(y) === ry)
          : (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1;
        if (inside) p(color, cx + x, cy + y);
      }
    }
  };
  if (b.wings) {
    for (let i = 0; i < 12; i += 1) {
      p(shade(b.body, -40), 4 + i, 14 + Math.floor(i / 2), 1, 14 - i);
      p(shade(b.body, -40), 43 - i, 14 + Math.floor(i / 2), 1, 14 - i);
    }
  }
  blob(24, 31, 14, 13, b.body); // body
  blob(24, 33, 8, 8, b.belly);
  blob(9, 30, 4, 6, b.body); blob(39, 30, 4, 6, b.body); // arms
  p(shade(b.body, -50), 6, 35, 2, 2); p(shade(b.body, -50), 10, 35, 2, 2);
  p(shade(b.body, -50), 37, 35, 2, 2); p(shade(b.body, -50), 41, 35, 2, 2);
  blob(17, 43, 4, 3, shade(b.body, -30)); blob(31, 43, 4, 3, shade(b.body, -30)); // feet
  blob(24, 16, 10, 8, b.body); // head
  if (b.horns) {
    for (let i = 0; i < 6; i += 1) {
      p('#f2ead3', 14 - Math.floor(i / 2), 10 - i, 2, 1);
      p('#f2ead3', 32 + Math.floor(i / 2), 10 - i, 2, 1);
    }
  }
  if (b.crown) {
    p('#ffd34d', 18, 7, 13, 3);
    [18, 22, 26, 30].forEach((x) => p('#ffd34d', x, 5, 1, 2));
    p('#e23d3d', 24, 8, 1, 1);
  }
  p('#120e1e', 18, 14, 4, 4); p('#120e1e', 27, 14, 4, 4); // eyes
  p(b.eye, 19, 15, 2, 2); p(b.eye, 28, 15, 2, 2);
  p(shade(b.body, -60), 17, 12, 5, 1); p(shade(b.body, -60), 27, 12, 5, 1); // angry brows
  p('#120e1e', 19, 20, 11, 3); // mouth
  [19, 22, 25, 28].forEach((x) => p('#ffffff', x, 20, 2, 1));
  return outline(c);
}

// ------------------------------------------------------- world pieces
/** The shop: a striped market tent with a counter. 24x24. */
export function shopSprite() {
  const c = canvas(24, 24);
  const p = pen(c);
  p('rgba(0,0,0,0.28)', 1, 21, 22, 3);
  p('#8a5a32', 2, 10, 1, 12); p('#8a5a32', 21, 10, 1, 12);
  for (let x = 0; x < 24; x += 1) p(Math.floor(x / 3) % 2 ? '#ffffff' : '#d64545', x, 6, 1, 4);
  for (let i = 0; i < 6; i += 1) p(i % 2 ? '#b33636' : '#d64545', 2 + i, 6 - i, 20 - i * 2, 1);
  p('#ffd34d', 11, 0, 2, 1);
  p('#c9a36a', 3, 15, 18, 6); p('#a67c45', 3, 15, 18, 1);
  p('#ffd34d', 5, 13, 3, 2); p('#7fe3f5', 10, 13, 2, 2); p('#e23d3d', 15, 13, 3, 2); // goods on the counter
  p('#3ddc84', 19, 12, 2, 3);
  return outline(c);
}

/** The guild portal: a swirling stone ring. 24x24, two frames. */
export function portalFrames() {
  return [0, 1].map((f) => {
    const c = canvas(24, 28);
    const p = pen(c);
    p('rgba(0,0,0,0.3)', 2, 25, 20, 3);
    for (let y = 0; y < 26; y += 1) {
      for (let x = 0; x < 24; x += 1) {
        const dx = (x - 11.5) / 11;
        const dy = (y - 13) / 13;
        const d = dx * dx + dy * dy;
        if (d <= 1 && d > 0.62) p((x + y) % 4 ? '#8f88a8' : '#69728a', x, y);
        else if (d <= 0.62) p(((Math.atan2(dy, dx) * 3 + d * 8 + f * 1.6) % 2 + 2) % 2 > 1 ? '#b48cff' : '#5b3fc4', x, y);
      }
    }
    p('#ffffff', 11 + f, 12, 2, 2);
    return outline(c);
  });
}

/** A zone gate: stone posts with a wooden bar (closed) or open posts. 16x32. */
export function gateSprite(open) {
  const c = canvas(16, 32);
  const p = pen(c);
  p('rgba(0,0,0,0.28)', 1, 29, 14, 3);
  p('#8f88a8', 1, 6, 4, 24); p('#c9c4dc', 1, 6, 4, 2);
  p('#8f88a8', 11, 6, 4, 24); p('#c9c4dc', 11, 6, 4, 2);
  if (!open) {
    p('#8a5a32', 5, 12, 6, 3); p('#8a5a32', 5, 20, 6, 3);
    p('#ffd34d', 7, 16, 2, 3); // lock
  }
  return outline(c);
}

/** Tilled soil for a building plot. */
export function plotTile(seed) {
  const c = canvas();
  const p = pen(c);
  const r = rand(seed * 31 + 5);
  p('#8a6a3e', 0, 0, T, T);
  p('#7a5a32', 0, 0, T, 1); p('#7a5a32', 0, 0, 1, T);
  for (let i = 0; i < 8; i += 1) p(r() < 0.5 ? '#9c7a4a' : '#6e5230', Math.floor(r() * T), Math.floor(r() * T));
  return c;
}

/** A signpost with a little board. */
export function signSprite() {
  const c = canvas();
  const p = pen(c);
  p('rgba(0,0,0,0.28)', 5, 14, 6, 2);
  p('#8a5a32', 7, 6, 2, 9);
  p('#c9a36a', 2, 2, 12, 5); p('#8a5a32', 3, 4, 10, 1);
  return outline(c);
}

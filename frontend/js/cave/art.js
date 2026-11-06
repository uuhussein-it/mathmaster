/**
 * Pixel art for the Cave of Equations, drawn in code like the realm's art:
 * Aladdin in three looks (Sage, Warrior, Explorer), cave enemies, tiles for
 * each stage, the merchant, the sorcerer Zarkan, and parallax backgrounds.
 * Every sprite is a small canvas that Phaser takes as a texture.
 *
 * The designs are our own, taken from the folk tale (a young man, a lamp, a
 * cave of treasure and an evil sorcerer), not from any film.
 */
import { canvas, outline, paint, rand, pen, shade } from '../realm/art.js';

// ---------------------------------------------------------------- heroes
// 16 x 24, facing right. Letters: T turban, t turban shade, J jewel, h hair,
// s skin, S skin shade, e eye, R tunic, r tunic shade, B sash, P trousers,
// p trouser shade, F shoes.
const TOP = [
  '.....TTTTT......',
  '....TTTTTTT.....',
  '...TTTTTJTTT....',
  '...tTTTTTTTt....',
  '....hsssssss....',
  '....hssssesse...',
  '....sssssssss...',
  '.....ssSSsss....',
  '......ssss......',
];
const ARMS_DOWN = [
  '....RRRRRRRR....',
  '...RRRRRRRRRR...',
  '..sRRRrRRrRRRs..',
  '..sRRRrRRrRRRs..',
  '..sRRRRRRRRRRs..',
  '...BBBBBBBBBB...',
  '....RRRRRRRR....',
];
const ARMS_UP = [
  '..s.RRRRRRRR.s..',
  '..sRRRRRRRRRRs..',
  '...RRRrRRrRRR...',
  '...RRRrRRrRRR...',
  '...RRRRRRRRRR...',
  '...BBBBBBBBBB...',
  '....RRRRRRRR....',
];
const LEGS = {
  idle: [
    '....PPPPPPPP....',
    '....PPPppPPP....',
    '....PPP..PPP....',
    '....PPP..PPP....',
    '....pPP..PPp....',
    '....PPP..PPP....',
    '...FFFF..FFFF...',
    '...FFFF..FFFF...',
  ],
  run1: [
    '....PPPPPPPP....',
    '....PPPPPPPP....',
    '...PPP...PPP....',
    '..PPP.....PPP...',
    '.PPP.......PP...',
    '.PP........PPP..',
    'FFF.........FFF.',
    'FF...........FF.',
  ],
  run2: [
    '....PPPPPPPP....',
    '.....PPPPPP.....',
    '.....PPPPP......',
    '.....PPPPP......',
    '.....PP.PP......',
    '.....PP.PP......',
    '....FFF.FFF.....',
    '....FFF.FFF.....',
  ],
  jump: [
    '....PPPPPPPP....',
    '...PPPPPPPPP....',
    '..PPP....PPP....',
    '..PP......PPP...',
    '.FFF.......FF...',
    '.FF........FF...',
    '................',
    '................',
  ],
};

export const SKINS = {
  sage: {
    name: 'Sage', title: 'Aladdin the Sage', blurb: 'Blue robes and a crystal staff. Sees the answer before the others.',
    pal: { T: '#ece8f4', t: '#b8b0cc', J: '#4fd1e8', R: '#2f4fb0', r: '#22397f', B: '#e6c06a', P: '#d9d2c0', p: '#b5ac98', F: '#6b4a2b' },
  },
  warrior: {
    name: 'Warrior', title: 'Aladdin the Warrior', blurb: 'Bronze armour and a curved blade. Strong and brave.',
    pal: { T: '#c0392b', t: '#8e2a20', J: '#ffd34d', R: '#c8913a', r: '#9a6a25', B: '#5a2b14', P: '#3a2f5a', p: '#2a2244', F: '#2a1a12' },
  },
  explorer: {
    name: 'Explorer', title: 'Aladdin the Explorer', blurb: 'A green vest, a sand-coloured wrap and a satchel full of maps.',
    pal: { T: '#d9b77a', t: '#b08d50', J: '#7ddc7a', R: '#2f7a4a', r: '#225a36', B: '#7a4a1e', P: '#c9a46a', p: '#a5834c', F: '#5a3a1e' },
  },
};
const SKIN_BASE = { h: '#2a1a12', s: '#c98b5a', S: '#a86b40', e: '#1a1426' };

function gear(c, skin, frame) {
  const p = pen(c);
  const up = frame === 'jump';
  if (skin === 'sage') { // crystal staff in the front hand
    const y0 = up ? 6 : 8;
    p('#7a4a1e', 14, y0, 1, 24 - y0 - 2);
    p('#4fd1e8', 13, y0 - 3, 3, 3);
    p('#c9f6ff', 14, y0 - 2);
  } else if (skin === 'warrior') { // curved blade
    const y = up ? 6 : 11;
    p('#7a4a1e', 13, y + 2, 2, 2);
    p('#dfe6ee', 14, y - 4, 1, 6);
    p('#dfe6ee', 15, y - 6, 1, 3);
    p('#ffd34d', 12, y + 2, 4, 1);
  } else { // satchel on the hip
    p('#7a4a1e', 2, 13, 4, 4);
    p('#5a3412', 2, 13, 4, 1);
    p('#e6c06a', 3, 15);
  }
}

/** Aladdin's frames for one look: [idle, run1, run2, jump]. */
export function heroFrames(skin = 'sage') {
  const pal = { ...SKIN_BASE, ...(SKINS[skin] || SKINS.sage).pal };
  return ['idle', 'run1', 'run2', 'jump'].map((frame) => {
    const rows = [...TOP, ...(frame === 'jump' ? ARMS_UP : ARMS_DOWN), ...LEGS[frame]];
    const c = paint(rows, pal, 16, 24);
    gear(c, skin, frame);
    return outline(c);
  });
}

/** A big preview of a look (for the page, not the game). */
export const heroPreview = (skin) => heroFrames(skin)[0];

// ---------------------------------------------------------------- items
export function lampSprite() {
  return outline(paint([
    '.....yy.....',
    '....yYYy....',
    '.yyyYYYYyyy.',
    'yYYYYYYYYYYy',
    '.yYYYYYYYyy.',
    '..yyyyyyyy..',
    '...yyyyyy...',
  ], { y: '#c99a2e', Y: '#ffd34d' }, 12, 7));
}

export function coinFrames() {
  return [
    paint(['..yyyy..', '.yYYYYy.', 'yYYwYYYy', 'yYYwYYYy', 'yYYYYYYy', 'yYYYYYYy', '.yYYYYy.', '..yyyy..'], { y: '#b8860b', Y: '#ffd34d', w: '#fff6c4' }, 8, 8),
    paint(['...yy...', '..yYYy..', '..yYwy..', '..yYwy..', '..yYYy..', '..yYYy..', '..yYYy..', '...yy...'], { y: '#b8860b', Y: '#ffd34d', w: '#fff6c4' }, 8, 8),
  ].map(outline);
}

export function heartSprite(full = true) {
  return outline(paint([
    '.rr.rr..',
    'rRRrRRr.',
    'rRwRRRr.',
    'rRRRRRr.',
    '.rRRRr..',
    '..rRr...',
    '...r....',
  ], full ? { r: '#b8223a', R: '#ff4d6d', w: '#ffd0da' } : { r: '#3a2f4a', R: '#5a4a6a', w: '#6a5a7a' }, 8, 7));
}

export function carpetSprite() {
  return outline(paint([
    'o.o.o.o.o.o.o.o.o.o.o.o.',
    'TTTTTTTTTTTTTTTTTTTTTTTT',
    'TooTTyyTTooTTyyTTooTTyyT',
    'TTTTTTTTTTTTTTTTTTTTTTTT',
    'o.o.o.o.o.o.o.o.o.o.o.o.',
  ], { T: '#1f8f8a', o: '#ff9a3d', y: '#ffd34d' }, 24, 5));
}

export function ringSprite() {
  return outline(paint([
    '...bb...',
    '..bwwb..',
    '..yyyy..',
    '.y....y.',
    '.y....y.',
    '..yyyy..',
  ], { y: '#ffd34d', b: '#4fd1e8', w: '#c9f6ff' }, 8, 6));
}

// ---------------------------------------------------------------- enemies
export function batFrames() {
  const pal = { b: '#4a3a6a', B: '#6a5a8a', e: '#ff4d4d' };
  return [
    paint(['B..............B', 'BB............BB', 'BBB..bbbbbb..BBB', '.BBBbbebbebbBBB.', '..BBbbbbbbbbBB..', '.....bbbbbb.....', '......b..b......'], pal, 16, 7),
    paint(['................', '................', '.....bbbbbb.....', '..BBbbebbebbBB..', '.BBBbbbbbbbbBBB.', 'BBB..bbbbbb..BBB', 'B.....b..b.....B'], pal, 16, 7),
  ].map(outline);
}

export function ghostFrames() {
  const pal = { g: '#cfe3ff', G: '#8fa8d8', y: '#e6c06a', e: '#1a1426', s: '#9aa3b8' };
  const top = [
    '.....yyyyy......',
    '....yyyyyyy.....',
    '....gggggggg..s.',
    '...gggeggeggg.s.',
    '...ggggggggggGs.',
    '...gggGGGgggg.s.',
    '..gggggggggggGs.',
    '..ggggggggggggs.',
    '..gGggggggggGgs.',
    '..ggggggggggggs.',
    '..gggggggggggg..',
    '..ggggggggggggg.',
  ];
  return [
    paint([...top, '..gGgggGgggGgg..', '..g.gg.gg.gg.g..', '....g...g...g...'], pal, 16, 15),
    paint([...top, '..ggGgggGgggGg..', '..gg.gg.gg.gg...', '..g...g...g.....'], pal, 16, 15),
  ].map(outline);
}

export function spikeFrames() {
  const up = canvas(16, 16);
  const down = canvas(16, 16);
  [up, down].forEach((c, i) => {
    const p = pen(c);
    p('#4a4a5a', 0, 13, 16, 3);
    p('#2a2a36', 0, 15, 16, 1);
    if (i === 0) {
      for (let x = 0; x < 16; x += 4) {
        for (let y = 0; y < 9; y += 1) {
          const w = Math.max(1, Math.round((y + 1) / 3));
          p(y < 2 ? '#ffffff' : '#c8ccd8', x + 2 - Math.floor(w / 2), 4 + y, w, 1);
        }
      }
    } else {
      for (let x = 0; x < 16; x += 4) p('#c8ccd8', x + 1, 12, 2, 1);
    }
  });
  return [outline(up), outline(down)];
}

export function orbSprite() {
  const c = canvas(8, 8);
  const p = pen(c);
  p('#7b2fd6', 1, 1, 6, 6);
  p('#b07bff', 2, 2, 4, 4);
  p('#ffffff', 3, 3, 1, 1);
  return outline(c);
}

// ---------------------------------------------------------------- the sorcerer
/** Zarkan the Sorcerer, 40 x 52: a hooded figure in star-patterned robes holding an orb. */
export function sorcererFrames() {
  const pal = { h: '#1f3b3a', H: '#2f5a58', d: '#0b1414', e: '#d6a2ff', E: '#ffffff', s: '#e6c06a', o: '#9b5cff', O: '#e4cfff', g: '#8a6a3a', k: '#5a4a2a' };
  const rows = [
    '..................hh....................',
    '.................hHHh...................',
    '................hHHHHh..................',
    '...............hHHHHHHh.................',
    '..............hHHHHHHHHh................',
    '.............hHHHHHHHHHHh...............',
    '............hHHddddddddHHh..............',
    '...........hHHddddddddddHHh.............',
    '...........hHddeEddddeEddHh.............',
    '...........hHdddddddddddHHh.............',
    '...........hHHddddddddddHHh.............',
    '...........hHHHddkkkkddHHHh.............',
    '..........hhHHHHdkkkkdHHHHhh............',
    '.........hHHHHHHHkkkkHHHHHHHh...........',
    '........hHHHHHHHHHkkHHHHHHHHHh..........',
    '.......hHHHsHHHHHHHHHHHHHsHHHHh.........',
    '......hHHHHHHHHHHHHHHHHHHHHHHHHh........',
    '.....hHHHHHHHHHgggggggHHHHHHHHHHh.......',
    '....hHHHHHHHHHHgsssssgHHHHHHHHHHHh......',
    '...ggHHHHHsHHHHgggggggHHHHHsHHHHHgg.....',
    '..ggggHHHHHHHHHHHHHHHHHHHHHHHHHHgggg....',
    '..ggggHHHHHHHHHHHHHHHHHHHHHHHHHHgggg.oo.',
    '...gg.HHHHHHHHsHHHHHHHHHsHHHHHHH.gg.oOOo',
    '......HHHHHHHHHHHHHHHHHHHHHHHHHH....oOOo',
    '......HHHHHsHHHHHHHHHHHHHHHHsHHH.....oo.',
    '......HHHHHHHHHHHHHHHHHHHHHHHHHH........',
    '.......HHHHHHHHHHHHsHHHHHHHHHHH.........',
    '.......HHHHHHHHHHHHHHHHHHHHHHHH.........',
    '.......HHHHsHHHHHHHHHHHHHHsHHHH.........',
    '........HHHHHHHHHHHHHHHHHHHHHH..........',
    '........HHHHHHHHHHHHHHHHHHHHHH..........',
    '........HHHHHHHHHsHHHHHHHHHHHH..........',
    '.........HHHHHHHHHHHHHHHHHHHH...........',
    '.........HHHHHHHHHHHHHHHHHHHH...........',
    '..........HHHHHHHHHHHHHHHHHH............',
    '...........HHHHH.HHHHH.HHHH.............',
    '............HHH...HHH...HH..............',
    '.............H.....H.....H..............',
  ];
  const a = paint(rows, pal, 40, rows.length);
  const b = paint(rows.map((r) => r.replace('oOOo', 'oEEo')), { ...pal, E: '#ffffff' }, 40, rows.length);
  return [outline(a), outline(b)];
}

// ---------------------------------------------------------------- tiles
export const STAGE_STYLE = {
  1: { name: 'The Canyon of Algebra', term: 1, rock: '#5a4a6a', rock2: '#46385a', top: '#8a6a4a', sky: ['#0b0816', '#2a1220'] },
  2: { name: 'The Palace of Functions', term: 2, rock: '#d8d2c8', rock2: '#b8b0a4', top: '#e6c06a', sky: ['#0e0b22', '#2a2150'] },
  3: { name: 'The Vault of the Supreme Master', term: 3, rock: '#6a5420', rock2: '#4a3a14', top: '#ffd34d', sky: ['#120c04', '#3a2a0a'] },
};

/** A solid tile for a stage; `top` is a tile with open air above it. */
export function rockTile(stage, top, seed) {
  const st = STAGE_STYLE[stage];
  const c = canvas(16, 16);
  const p = pen(c);
  const r = rand(seed * 97 + stage);
  p(st.rock, 0, 0, 16, 16);
  if (stage === 2) { // marble blocks with gold seams
    p(st.rock2, 0, 7, 16, 1);
    p(st.rock2, 7, 0, 1, 7);
    p(st.rock2, 3, 8, 1, 8);
    for (let i = 0; i < 4; i += 1) p('#ece8e0', Math.floor(r() * 14), Math.floor(r() * 14), 2, 1);
  } else {
    p(st.rock2, 0, 5, 16, 1);
    p(st.rock2, 0, 11, 16, 1);
    p(st.rock2, 5, 0, 1, 5);
    p(st.rock2, 11, 6, 1, 5);
    p(st.rock2, 3, 12, 1, 4);
    for (let i = 0; i < 5; i += 1) p(shade(st.rock, 18), Math.floor(r() * 15), Math.floor(r() * 15), 1, 1);
    if (stage === 3) for (let i = 0; i < 3; i += 1) p('#fff2a8', Math.floor(r() * 15), Math.floor(r() * 15), 1, 1);
  }
  if (top) {
    p(st.top, 0, 0, 16, 3);
    p(shade(st.top, -40), 0, 3, 16, 1);
    if (stage === 1) for (let x = 0; x < 16; x += 3) p('#6a8a4a', x + Math.floor(r() * 2), 0, 1, 1);
  }
  return c;
}

export function platformTile(stage) {
  const st = STAGE_STYLE[stage];
  const c = canvas(16, 8);
  const p = pen(c);
  p(st.top, 0, 0, 16, 3);
  p(st.rock, 0, 3, 16, 4);
  p(st.rock2, 0, 7, 16, 1);
  p(shade(st.top, 30), 1, 0, 14, 1);
  return outline(c);
}

export function bridgeTile(solid) {
  const c = canvas(16, 8);
  const p = pen(c);
  if (!solid) { // a ghostly outline where the bridge will appear
    p('rgba(255, 211, 77, 0.35)', 0, 2, 16, 1);
    p('rgba(255, 211, 77, 0.35)', 0, 6, 16, 1);
    return c;
  }
  p('#5a3412', 0, 1, 16, 1);
  p('#8a5a2b', 0, 2, 16, 4);
  p('#5a3412', 4, 2, 1, 4);
  p('#5a3412', 10, 2, 1, 4);
  p('#3a2210', 0, 6, 16, 1);
  return outline(c);
}

export function lavaFrames() {
  return [0, 1].map((f) => {
    const c = canvas(16, 16);
    const p = pen(c);
    p('#c0391b', 0, 0, 16, 16);
    p('#ff7a1a', 0, 0, 16, 4);
    for (let x = 0; x < 16; x += 4) p('#ffd34d', (x + f * 2) % 16, 1, 2, 1);
    p('#8e1f10', 0, 10, 16, 6);
    p('#ff9a3d', (5 + f * 6) % 16, 7, 2, 2);
    return c;
  });
}

export function lavaDeep() {
  const c = canvas(16, 16);
  const p = pen(c);
  p('#8e1f10', 0, 0, 16, 16);
  p('#a8281a', 3, 4, 3, 2);
  p('#a8281a', 10, 10, 4, 2);
  return c;
}

/** The Number Gate: a stone tablet with a glowing equation, 16 x 24. */
export function gateSprite(solved = false) {
  const c = canvas(16, 24);
  const p = pen(c);
  p('#6a6a7a', 2, 2, 12, 22);
  p('#8a8a9a', 3, 3, 10, 18);
  p('#4a4a5a', 2, 22, 12, 2);
  const glow = solved ? '#7ddc7a' : '#ffd34d';
  // "x=?" in tiny pixels
  p(glow, 4, 6); p(glow, 6, 6); p(glow, 5, 7); p(glow, 4, 8); p(glow, 6, 8);
  p(glow, 8, 6, 3, 1); p(glow, 8, 8, 3, 1);
  p(glow, 5, 12, 6, 1); p(glow, 5, 14, 6, 1); p(glow, 7, 11, 2, 5);
  p(glow, 4, 18, 8, 1);
  return outline(c);
}

/** A palace door with a sand-timer on it, 16 x 32. */
export function doorSprite() {
  const c = canvas(16, 32);
  const p = pen(c);
  p('#5a3a1e', 1, 0, 14, 32);
  p('#7a4a1e', 2, 1, 12, 30);
  p('#e6c06a', 1, 0, 14, 2);
  p('#e6c06a', 7, 2, 2, 28);
  // sand-timer
  p('#e6c06a', 4, 10, 8, 1); p('#e6c06a', 4, 21, 8, 1);
  p('#c9f6ff', 5, 11, 6, 2); p('#c9f6ff', 6, 13, 4, 2); p('#c9f6ff', 7, 15, 2, 1);
  p('#c9f6ff', 6, 16, 4, 2); p('#c9f6ff', 5, 18, 6, 3);
  p('#ffd34d', 6, 11, 4, 1); p('#ffd34d', 5, 19, 6, 2);
  return outline(c);
}

export function torchFrames(lit) {
  return [0, 1].map((f) => {
    const c = canvas(8, 18);
    const p = pen(c);
    p('#5a3a1e', 3, 8, 2, 10);
    p('#8a6a3a', 2, 7, 4, 2);
    if (lit) {
      p('#ff7a1a', 2, 2 + f, 4, 5 - f);
      p('#ffd34d', 3, 3 + f, 2, 3 - f);
      p('#ffffff', 3, 5, 1, 1);
    } else {
      p('#3a3a4a', 3, 5, 2, 2);
    }
    return outline(c);
  });
}

/** The way out of a stage: a glowing arch, 24 x 32. */
export function exitSprite() {
  const c = canvas(24, 32);
  const p = pen(c);
  p('#6a5a3a', 0, 6, 4, 26); p('#6a5a3a', 20, 6, 4, 26);
  p('#6a5a3a', 2, 2, 20, 5);
  p('#e6c06a', 3, 3, 18, 2);
  for (let y = 7; y < 32; y += 1) p(y % 4 < 2 ? '#8fe6ff' : '#4fd1e8', 4, y, 16, 1);
  p('#ffffff', 10, 12, 4, 10);
  return outline(c);
}

/** The merchant's tent with the merchant, 32 x 28. */
export function merchantSprite() {
  const c = canvas(32, 28);
  const p = pen(c);
  for (let y = 0; y < 10; y += 1) p(y % 2 ? '#d64545' : '#f2e6c8', Math.round(15 - y * 1.5), y, 2 + y * 3, 1);
  p('#d64545', 0, 10, 32, 3);
  p('#f2e6c8', 0, 10, 32, 1);
  for (let x = 0; x < 32; x += 4) p('#ffd34d', x + 1, 13, 2, 2);
  p('#5a3a1e', 1, 13, 2, 15); p('#5a3a1e', 29, 13, 2, 15);
  p('#2a1a12', 3, 15, 26, 13);
  // merchant behind the counter
  p('#7b4fd6', 12, 14, 8, 3);        // turban
  p('#c98b5a', 13, 17, 6, 4);        // face
  p('#1a1426', 14, 18); p('#1a1426', 17, 18);
  p('#ece8f4', 13, 20, 6, 2);        // beard
  p('#2f7a4a', 11, 22, 10, 3);       // robe
  // counter with wares
  p('#8a5a2b', 3, 24, 26, 4);
  p('#ffd34d', 6, 22, 3, 2); p('#4fd1e8', 22, 22, 3, 2); p('#ff7a59', 25, 22, 2, 2);
  return outline(c);
}

/** A rune circle on the vault floor: stand on it and press E to cast a Number Spell. */
export function runeFrames() {
  return [0, 1].map((f) => {
    const c = canvas(24, 8);
    const p = pen(c);
    const col = f ? '#b07bff' : '#e4cfff';
    p(col, 4, 6, 16, 1); p(col, 2, 5, 2, 1); p(col, 20, 5, 2, 1); p(col, 1, 4, 1, 1); p(col, 22, 4, 1, 1);
    p(col, 4, 2, 16, 1); p(col, 2, 3, 2, 1); p(col, 20, 3, 2, 1);
    p('#ffd34d', 11, 3 + f, 2, 2);
    return c;
  });
}

// ---------------------------------------------------------------- parallax backgrounds
/** Three layers per scene (far, middle, near), each 320 x 180 and tiling sideways. */
export function backdrop(stage) {
  const W = 320;
  const H = 180;
  const r = rand(stage * 131);
  const far = canvas(W, H);
  const mid = canvas(W, H);
  const near = canvas(W, H);
  const fp = pen(far);
  const mp = pen(mid);
  const np = pen(near);
  const g = far.getContext('2d');
  const style = STAGE_STYLE[stage] || { sky: ['#0b1030', '#3a2a5a'] };
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, style.sky[0]);
  grad.addColorStop(1, style.sky[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  if (stage === 0) { // the desert at night
    for (let i = 0; i < 90; i += 1) fp(r() < 0.2 ? '#ffffff' : '#9aa3d8', Math.floor(r() * W), Math.floor(r() * 110), 1, 1);
    fp('#fff6c4', 250, 24, 14, 14); fp('#e6d9a0', 254, 28, 4, 4);
    for (let x = 0; x < W; x += 1) {
      const y = 120 + Math.round(10 * Math.sin(x / 40) + 6 * Math.sin(x / 13));
      mp('#6a4a3a', x, y, 1, H - y);
      const y2 = 145 + Math.round(8 * Math.sin(x / 30 + 1) + 4 * Math.sin(x / 9));
      np('#b0804a', x, y2, 1, H - y2);
      np('#d8a860', x, y2, 1, 1);
    }
    return { far, mid, near };
  }
  if (stage === 1) { // dark caverns with lava glow
    for (let i = 0; i < 40; i += 1) fp('#3a2240', Math.floor(r() * W), Math.floor(r() * H), 2, 2);
    for (let x = 0; x < W; x += 12 + Math.floor(r() * 10)) {
      const len = 10 + Math.floor(r() * 30);
      for (let y = 0; y < len; y += 1) fp('#1a1022', x + Math.floor(y / 6), y, Math.max(1, 6 - Math.floor(y / 5)), 1);
    }
    for (let x = 0; x < W; x += 40 + Math.floor(r() * 20)) mp('#2a1a30', x, 30 + Math.floor(r() * 40), 18, H);
    for (let x = 0; x < W; x += 1) np(`rgba(255, ${90 + (x % 30)}, 30, 0.18)`, x, 160 + Math.round(4 * Math.sin(x / 9)), 1, 20);
  } else if (stage === 2) { // palace arches and mosaics
    for (let x = 0; x < W; x += 40) {
      fp('#1a1640', x + 6, 40, 28, 140);
      fp('#2a2150', x + 10, 46, 20, 134);
      fp('#e6c06a', x + 18, 60, 4, 4);
    }
    for (let i = 0; i < 30; i += 1) fp(['#4fd1e8', '#e6c06a', '#b07bff'][i % 3], Math.floor(r() * W), 10 + Math.floor(r() * 20), 2, 2);
    for (let x = 0; x < W; x += 80) {
      mp('#8a8294', x + 20, 20, 14, H);
      mp('#a8a0b4', x + 22, 20, 4, H);
      mp('#e6c06a', x + 18, 20, 18, 4);
      if (r() < 0.6) mp('#0e0b22', x + 24, 60 + Math.floor(r() * 50), 8, 4); // cracks
    }
  } else { // the vault: piles of treasure that glitter
    for (let x = 0; x < W; x += 1) {
      const y = 110 + Math.round(12 * Math.sin(x / 25) + 6 * Math.sin(x / 7));
      fp('#5a4a14', x, y, 1, H - y);
    }
    for (let i = 0; i < 70; i += 1) fp(r() < 0.3 ? '#ffffff' : '#ffd34d', Math.floor(r() * W), 100 + Math.floor(r() * 80), 1, 1);
    for (let x = 0; x < W; x += 64) {
      mp('#7a5a1a', x + 10, 10, 16, H);
      mp('#ffd34d', x + 12, 10, 3, H);
    }
    for (let i = 0; i < 12; i += 1) np('rgba(255, 230, 120, 0.25)', Math.floor(r() * W), 150 + Math.floor(r() * 30), 6, 2);
  }
  return { far, mid, near };
}

/** The stone door in the sand for the intro, 32 x 40. */
export function stoneDoorSprite() {
  const c = canvas(32, 40);
  const p = pen(c);
  p('#7a6a5a', 0, 0, 32, 40);
  p('#5a4a3a', 2, 2, 28, 36);
  p('#9a8a6a', 4, 4, 24, 3);
  p('#e6c06a', 13, 12, 6, 6);
  p('#ffd34d', 15, 14, 2, 2);
  for (let y = 22; y < 38; y += 4) p('#4a3a2a', 4, y, 24, 1);
  return outline(c);
}

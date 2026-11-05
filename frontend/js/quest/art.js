/**
 * Pixel art for Knowledge Quest, drawn in code (no image files): the hero in
 * four directions, floor and wall tiles for each room theme, obstacles and
 * the collectible items. Everything is drawn once into small 16x16 canvases
 * and scaled up with smoothing off, so it stays crisp.
 */
export const T = 16; // tile size in art pixels

function canvas(w = T, h = T) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Paint a sprite from rows of palette letters ('.' is transparent). */
function paint(rows, palette, size = T) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  rows.forEach((row, y) => {
    [...row.padEnd(size, '.').slice(0, size)].forEach((ch, x) => {
      if (ch === '.' || !palette[ch]) return;
      g.fillStyle = palette[ch];
      g.fillRect(x, y, 1, 1);
    });
  });
  return c;
}

// A tiny seeded random, so tiles look the same every time.
function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

// ------------------------------------------------------------------ the hero
const HEAD = {
  down: [
    '......kkkk......',
    '....kkhhhhkk....',
    '...khhhhhhhhk...',
    '...khhsssshhk...',
    '...kssssssssk...',
    '...kskssssksk...',
    '...kssssssssk...',
    '....kssmmssk....',
  ],
  up: [
    '......kkkk......',
    '....kkhhhhkk....',
    '...khhhhhhhhk...',
    '...khhhhhhhhk...',
    '...khhhhhhhhk...',
    '...khhhhhhhhk...',
    '...kshhhhhhsk...',
    '....kssssssk....',
  ],
  side: [
    '......kkkk......',
    '....kkhhhhk.....',
    '...khhhhhhhk....',
    '...khhhhhsssk...',
    '...khhhssssk....',
    '...khhssskssk...',
    '...khsssssssk...',
    '....ksssssk.....',
  ],
};
const BODY = {
  front: [
    '...kcccccccck...',
    '..kcccyyyyccck..',
    '..ksccccccccsk..',
    '...kcddddddck...',
    '...kcccccccck...',
  ],
  side: [
    '....kcccccck....',
    '...kcccccccck...',
    '...kcccccsck....',
    '...kcddddddk....',
    '....kcccccck....',
  ],
};
const LEGS = {
  front: [
    ['....kbbkkbbk....', '....kbbk.kbbk...', '.....kk...kk....'],
    ['....kbbkkbbk....', '...kbbk..kbbk...', '...kk......kk...'],
  ],
  side: [
    ['....kbbbbk......', '....kbk.kbk.....', '....kk...kk.....'],
    ['....kbbbbk......', '.....kbbk.......', '.....kkk........'],
  ],
};
const HAIR = { warrior: '#5a2b14', sage: '#dcdce8', explorer: '#7a4a1e' };

/** The hero's frames: { down: [a, b], up: [a, b], right: [a, b] } (left is right mirrored). */
export function heroFrames(character, cloak) {
  const pal = {
    k: '#1a1426', h: HAIR[character] || '#5a2b14', s: '#f2c9a0', m: '#c98a6a',
    c: cloak, d: shade(cloak, -60), y: '#ffd34d', b: '#3a2a1e',
  };
  const make = (head, body, legs) => [...head, ...body, ...legs];
  return {
    down: LEGS.front.map((l) => paint(make(HEAD.down, BODY.front, l), pal)),
    up: LEGS.front.map((l) => paint(make(HEAD.up, BODY.front, l), pal)),
    right: LEGS.side.map((l) => paint(make(HEAD.side, BODY.side, l), pal)),
  };
}

// ------------------------------------------------------------------- tiles
const FLOORS = {
  stone: ['#3b3552', '#332d48', '#46405e'],
  carpet: ['#7a2335', '#6a1d2d', '#8c2b3f'],
  grass: ['#2f6b3a', '#285c32', '#3a7d45'],
  cave: ['#1f3a46', '#1a313c', '#27495a'],
  wood: ['#6b4a2b', '#5c3f24', '#7a5634'],
};

function floorTile(kind, seed) {
  const [base, dark, light] = FLOORS[kind];
  const c = canvas();
  const g = c.getContext('2d');
  const r = rand(seed * 7919 + kind.length);
  g.fillStyle = base;
  g.fillRect(0, 0, T, T);
  if (kind === 'stone' || kind === 'cave') {
    g.fillStyle = dark;
    g.fillRect(0, 7, T, 1);
    g.fillRect(seed % 2 ? 5 : 11, 0, 1, 7);
    g.fillRect(seed % 2 ? 12 : 3, 8, 1, 8);
  } else if (kind === 'wood') {
    g.fillStyle = dark;
    for (let y = 3; y < T; y += 4) g.fillRect(0, y, T, 1);
    g.fillRect((seed * 5) % T, 0, 1, 3);
    g.fillRect((seed * 3 + 7) % T, 8, 1, 4);
  } else if (kind === 'carpet') {
    g.fillStyle = '#d6a64a';
    g.fillRect(0, 0, T, 1);
    g.fillRect(0, 15, T, 1);
    g.fillStyle = dark;
    g.fillRect(7, 7, 2, 2);
  }
  for (let i = 0; i < 6; i += 1) {
    g.fillStyle = r() < 0.5 ? dark : light;
    g.fillRect(Math.floor(r() * T), Math.floor(r() * T), 1, 1);
  }
  if (kind === 'grass') {
    g.fillStyle = light;
    for (let i = 0; i < 5; i += 1) {
      const x = Math.floor(r() * 15);
      const y = Math.floor(r() * 14) + 1;
      g.fillRect(x, y, 1, 2);
    }
  }
  if (kind === 'cave' && r() < 0.3) {
    g.fillStyle = '#4fd1e8';
    g.fillRect(Math.floor(r() * 14), Math.floor(r() * 14), 1, 1);
  }
  return c;
}

function wallTile(front, seed) {
  const c = canvas();
  const g = c.getContext('2d');
  g.fillStyle = front ? '#4a3f66' : '#231d36';
  g.fillRect(0, 0, T, T);
  g.fillStyle = front ? '#3a3152' : '#1a1528';
  for (let y = 0; y < T; y += 4) {
    g.fillRect(0, y, T, 1);
    const off = (y / 4 + seed) % 2 ? 4 : 0;
    for (let x = off; x < T; x += 8) g.fillRect(x, y, 1, 4);
  }
  if (front) {
    g.fillStyle = '#5c5080';
    g.fillRect(0, 0, T, 1);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 13, T, 3);
  }
  return c;
}

function doorTile(open) {
  const c = canvas();
  const g = c.getContext('2d');
  g.fillStyle = '#231d36';
  g.fillRect(0, 0, T, T);
  if (open) {
    g.fillStyle = '#120e1e';
    g.fillRect(2, 0, 12, T);
    g.fillStyle = '#3b3552';
    g.fillRect(2, 12, 12, 4);
    g.fillStyle = '#ffd34d';
    g.fillRect(2, 0, 1, T);
    g.fillRect(13, 0, 1, T);
    return c;
  }
  g.fillStyle = '#7a4a24';
  g.fillRect(2, 0, 12, T);
  g.fillStyle = '#5c3618';
  for (let x = 5; x < 14; x += 3) g.fillRect(x, 0, 1, T);
  g.fillStyle = '#9aa4b5';
  g.fillRect(2, 3, 12, 2);
  g.fillRect(2, 11, 12, 2);
  g.fillStyle = '#ffd34d';
  g.fillRect(9, 6, 3, 4);
  g.fillStyle = '#1a1426';
  g.fillRect(10, 7, 1, 2);
  return c;
}

const OBSTACLES = {
  pillar: [
    '....kkkkkkkk....', '...kwwwwwwwwk...', '....kggggggk....', '....kgwgggwk....',
    '....kgwgggwk....', '....kgwgggwk....', '....kgwgggwk....', '....kgwgggwk....',
    '....kgwgggwk....', '....kgwgggwk....', '....kgwgggwk....', '....kgwgggwk....',
    '....kggggggk....', '...kwwwwwwwwk...', '..kkkkkkkkkkkk..', '..ssssssssssss..',
  ],
  shelf: [
    'kkkkkkkkkkkkkkkk', 'koooooooooooooook', 'kormbyrgmbrogybk', 'kormbyrgmbrogybk',
    'kormbyrgmbrogybk', 'koooooooooooooook', 'kgybrmogbyrmgrbk', 'kgybrmogbyrmgrbk',
    'kgybrmogbyrmgrbk', 'koooooooooooooook', 'kbrgmyobgrmybgok', 'kbrgmyobgrmybgok',
    'kbrgmyobgrmybgok', 'koooooooooooooook', 'kkkkkkkkkkkkkkkk', 'ssssssssssssssss',
  ],
  tree: [
    '.....kkkkkk.....', '...kkllllllkk...', '..kllgllllgllk..', '.klllllglllllllk',
    '.kllgllllllgllk.', 'klllllllglllllk.', 'kllgllllllllglk.', '.klllllgllllllk.',
    '..kllllllllllk..', '...kkllllllkk...', '.....kkttkk.....', '......kttk......',
    '......kttk......', '.....kttttk.....', '....ssssssss....', '................',
  ],
  crystal: [
    '................', '.......k........', '......kck.......', '......kcwk..k...',
    '.....kccwk.kck..', '.....kccck.kcwk.', '..k..kccck.kcck.', '.kck.kccck.kcck.',
    '.kcwkkccckkccck.', '.kcckkcdcckcdck.', '.kccckcdcckcdck.', 'kkdddkddddkddkk.',
    'kssssssssssssssk', '.ssssssssssssss.', '................', '................',
  ],
  table: [
    '................', '.......y........', '......yoy.......', '.......w........',
    '.......w........', 'kkkkkkkkkkkkkkkk', 'kooooooooooooook', 'kpppppppppppppok',
    'kpprrppppppppook', 'koooooooooooooook', 'kkkkkkkkkkkkkkkk', '.kb..........bk.',
    '.kb..........bk.', '.kb..........bk.', '.ss..........ss.', '................',
  ],
  pedestal: [
    '................', '................', '................', '................',
    '................', '....kkkkkkkk....', '...kwwwwwwwwk...', '....kggggggk....',
    '.....kgwggk.....', '.....kgwggk.....', '.....kgwggk.....', '.....kgwggk.....',
    '....kggggggk....', '...kwwwwwwwwk...', '..kkkkkkkkkkkk..', '..ssssssssssss..',
  ],
};
const OBSTACLE_PAL = {
  k: '#1a1426', w: '#c9c4dc', g: '#8f88a8', s: 'rgba(0,0,0,0.35)', o: '#6b4426',
  r: '#c0392b', m: '#2e86c1', b: '#27ae60', y: '#f1c40f', l: '#2f8f46', t: '#6b4426',
  c: '#7fe3f5', d: '#2a9fb8', p: '#c9a36a',
};

// ----------------------------------------------------------------- items
const ITEMS = {
  key: { name: 'Golden Key', pal: { k: '#1a1426', y: '#ffd34d', o: '#c9971f' }, rows: [
    '............', '..kkk.......', '.kyyyk......', 'kyokoyk.....', 'kyk.kyk.....', 'kyokoykkkkkk',
    '.kyyykyyyyyk', '..kkk.kkoko.', '.......kk.k.', '............', '............', '............'] },
  book: { name: 'Ancient Book', pal: { k: '#1a1426', r: '#a8323e', y: '#ffd34d', w: '#f2ead3' }, rows: [
    '............', '.kkkkkkkkk..', '.krrrrrrrrk.', '.kryyyyyyrk.', '.krrrrrrrrk.', '.krryyyyrrk.',
    '.krrrrrrrrk.', '.krrrrrrrrk.', '.kwwwwwwwwk.', '.kkkkkkkkkk.', '............', '............'] },
  compass: { name: 'Explorer’s Compass', pal: { k: '#1a1426', y: '#d6a64a', w: '#f2ead3', r: '#e23d3d', b: '#2e86c1' }, rows: [
    '............', '....kkkk....', '..kkyyyykk..', '.kywwwwwwyk.', '.kywwrwwwyk.', 'kywwwrrwwwyk',
    'kywwwbbwwwyk', '.kywwwbwwyk.', '.kywwwwwwyk.', '..kkyyyykk..', '....kkkk....', '............'] },
  crystal: { name: 'Glowing Crystal', pal: { k: '#1a1426', c: '#7fe3f5', w: '#ffffff', d: '#2a9fb8' }, rows: [
    '.....kk.....', '....kwck....', '...kwccck...', '..kwccccck..', '..kcccccck..', '.kccwccccdk.',
    '.kcccccdddk.', '..kccccddk..', '..kcccdddk..', '...kccddk...', '....kddk....', '.....kk.....'] },
  map: { name: 'Treasure Map', pal: { k: '#1a1426', p: '#e8d3a0', d: '#b8995a', r: '#e23d3d' }, rows: [
    '............', '.kkkkkkkkkk.', '.kppppdpppk.', '.kpdppppppk.', '.kppppprprk.', '.kppdppprpk.',
    '.kpppdprprk.', '.kppppppppk.', '.kdpppdpppk.', '.kkkkkkkkkk.', '............', '............'] },
  gem: { name: 'Emerald of Insight', pal: { k: '#1a1426', g: '#3ddc84', w: '#d7ffe9', d: '#1e8f52' }, rows: [
    '............', '...kkkkkk...', '..kwwgggggk.', '.kwgggggggdk', 'kgggggggggdk', 'kggggggggddk',
    '.kgggggggdk.', '..kggggddk..', '...kgggdk...', '....kgdk....', '.....kk.....', '............'] },
  scroll: { name: 'Scroll of Knowledge', pal: { k: '#1a1426', p: '#f2e2b0', d: '#c9a96a', r: '#c0392b' }, rows: [
    '............', '.kkkkkkkkkk.', 'kddddddddddk', '.kppppppppk.', '.kpdddddppk.', '.kppppppppk.',
    '.kpddddpppk.', '.kpppppprpk.', '.kppppprrrk.', 'kddddddddddk', '.kkkkkkkkkk.', '............'] },
};
export const ITEM_ORDER = ['key', 'book', 'compass', 'crystal', 'map', 'gem'];
export const itemName = (id) => ITEMS[id].name;

export const THEMES = [
  { name: 'The Entrance', floor: 'stone', obstacle: 'pillar' },
  { name: 'The Great Hall', floor: 'carpet', obstacle: 'shelf' },
  { name: 'The Overgrown Court', floor: 'grass', obstacle: 'tree' },
  { name: 'The Crystal Cavern', floor: 'cave', obstacle: 'crystal' },
  { name: 'The Map Room', floor: 'wood', obstacle: 'table' },
  { name: 'The Vault', floor: 'stone', obstacle: 'shelf' },
];
export const FINAL_THEME = { name: 'The Heart of the Archive', floor: 'carpet', obstacle: 'pillar' };

/** Every tile and item canvas, built once. */
export function buildArt() {
  const floors = {};
  for (const kind of Object.keys(FLOORS)) floors[kind] = [0, 1, 2, 3].map((s) => floorTile(kind, s + 1));
  const obstacles = {};
  for (const [id, rows] of Object.entries(OBSTACLES)) obstacles[id] = paint(rows, OBSTACLE_PAL);
  const items = {};
  for (const [id, it] of Object.entries(ITEMS)) items[id] = paint(it.rows, it.pal, 12);
  return {
    floors,
    wall: [wallTile(false, 0), wallTile(false, 1)],
    wallFront: [wallTile(true, 0), wallTile(true, 1)],
    door: doorTile(false),
    doorOpen: doorTile(true),
    obstacles,
    items,
  };
}

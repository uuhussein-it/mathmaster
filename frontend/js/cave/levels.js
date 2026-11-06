/**
 * The three stages of the Cave of Equations, built on a grid of 16px tiles
 * (13 rows). Letters:
 *   #  rock          =  floating ledge     L  lava (hurts, sends you back)
 *   ^  spike trap    b  bat               g  ghost guard
 *   c  coin          h  heart             K  torch (checkpoint)
 *   G  Number Gate   B  bridge (appears when the gate before it is solved)
 *   D  sand-timer door (opens when its question is answered)
 *   M  merchant      P  start             X  way out
 *   A  start of the boss's hall           Z  where the sorcerer floats
 */
export const ROWS = 13;

function grid(w) {
  const g = Array.from({ length: ROWS }, () => Array(w).fill('.'));
  const api = {
    g,
    ground(x0, x1, top) { for (let x = x0; x <= x1; x += 1) for (let y = top; y < ROWS; y += 1) g[y][x] = '#'; return api; },
    lava(x0, x1) { for (let x = x0; x <= x1; x += 1) { g[ROWS - 2][x] = 'L'; g[ROWS - 1][x] = 'L'; } return api; },
    ledge(x0, x1, y) { for (let x = x0; x <= x1; x += 1) g[y][x] = '='; return api; },
    bridge(x0, x1, y) { for (let x = x0; x <= x1; x += 1) g[y][x] = 'B'; return api; },
    put(x, y, ch) { g[y][x] = ch; return api; },
    coins(x0, x1, y) { for (let x = x0; x <= x1; x += 1) g[y][x] = 'c'; return api; },
  };
  return api;
}

function stage1() {
  const m = grid(102);
  m.ground(0, 12, 10).put(2, 9, 'P').put(8, 9, 'M').coins(4, 6, 8);
  m.lava(13, 16).ledge(14, 15, 8).coins(14, 15, 6);
  m.ground(17, 26, 10).put(20, 9, '^').put(23, 9, '^').put(24, 6, 'b').coins(18, 19, 8);
  m.put(25, 9, 'G').lava(27, 33).bridge(27, 33, 10).coins(29, 31, 8);
  m.ground(34, 44, 10).put(35, 9, 'K').ledge(38, 40, 7).coins(38, 40, 5).put(42, 5, 'b');
  m.lava(45, 52).ledge(46, 47, 8).ledge(50, 51, 7).coins(46, 47, 6).coins(50, 51, 5);
  m.ground(53, 60, 9).put(56, 8, '^').put(59, 8, 'G').lava(61, 68).bridge(61, 68, 9).coins(63, 66, 7);
  m.ground(69, 80, 10).put(70, 9, 'K').put(74, 6, 'b').put(77, 5, 'b').put(76, 9, '^').coins(72, 73, 8);
  m.put(79, 9, 'G').lava(81, 88).bridge(81, 88, 10).coins(83, 86, 8);
  m.ground(89, 101, 10).put(92, 8, 'h').coins(94, 96, 8).put(99, 9, 'X');
  return m.g;
}

function stage2() {
  const m = grid(106);
  m.ground(0, 30, 10).put(2, 9, 'P').put(9, 9, 'M').coins(4, 6, 8);
  m.put(16, 9, 'D').put(22, 9, 'g').ledge(24, 27, 7).coins(24, 27, 5).put(28, 9, '^');
  m.lava(31, 36).ledge(32, 33, 8).ledge(35, 36, 7).coins(32, 33, 6);
  m.ground(37, 55, 10).put(38, 9, 'K').put(44, 9, 'D').put(48, 9, 'g').put(52, 9, '^').coins(40, 42, 8).coins(49, 51, 6);
  m.lava(56, 64).ledge(57, 58, 8).ledge(60, 62, 6).ledge(63, 64, 8).coins(60, 62, 4);
  m.ground(65, 80, 9).put(66, 8, 'K').put(72, 8, 'D').put(76, 8, 'g').coins(68, 70, 7);
  m.put(79, 8, 'G').lava(81, 88).bridge(81, 88, 9).coins(83, 86, 7);
  m.ground(89, 105, 10).put(92, 8, 'h').put(96, 9, 'g').coins(98, 100, 8).put(103, 9, 'X');
  return m.g;
}

function stage3() {
  const m = grid(80);
  m.ground(0, 19, 10).put(2, 9, 'P').put(8, 9, 'M').coins(4, 6, 8).coins(11, 16, 7).put(14, 5, 'b');
  m.put(18, 9, 'G').lava(20, 27).bridge(20, 27, 10).coins(22, 25, 8);
  m.ground(28, 44, 10).put(30, 9, 'K').put(35, 9, 'g').put(40, 9, '^').coins(32, 34, 8).put(38, 9, 'h');
  m.ground(45, 79, 10).put(47, 9, 'A').ledge(52, 54, 7).ledge(61, 63, 6).put(68, 5, 'Z');
  for (let y = 0; y < 10; y += 1) m.put(79, y, '#');
  return m.g;
}

export const STAGES = { 1: stage1(), 2: stage2(), 3: stage3() };

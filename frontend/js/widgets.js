/**
 * Interactive answer widgets for bank questions that aren't multiple choice:
 *   table    – fill the blank cells of a table of values
 *   matching – pick a partner for each item on the left
 *   graph    – plot points on a coordinate plane
 *   parts    – one short answer per part (a), (b), (c)
 * Specs carry their answers, so grading happens here with no network call.
 *
 * renderWidget(spec, { locked, value, onChange }) draws it; gradeWidget(spec, value)
 * returns { correct, parts: [bool…] }; answerSummary(spec) describes the key.
 */
import { h } from './ui.js';

const letter = (j) => String.fromCharCode(65 + j);

// ------------------------------------------------------------ comparisons
const SUPERS = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

/** Canonical text form: lowercase, no spaces, ASCII minus/times, superscripts as ^n. */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[−–—]/g, '-')
    .replace(/[×·]/g, '*')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => `^${[...m].map((c) => SUPERS[c]).join('')}`)
    .replace(/\s+/g, '')
    .replace(/^([a-z]|f\([a-z]\)|y)=(?=.)/, '') // "x = 4" ≡ "4"
    .replace(/\.$/, '');
}

/** Number value of "3", "-2.5", "3/4", "-1 1/2", "50%"; NaN otherwise. */
function numeric(text) {
  const t = normalize(text).replace(/[,$]/g, '');
  let m = String(text ?? '').trim().replace(/[−–]/g, '-').match(/^(-?)(\d+)\s+(\d+)\/(\d+)$/); // mixed number
  if (m) return (m[1] ? -1 : 1) * (Number(m[2]) + Number(m[3]) / Number(m[4]));
  m = t.match(/^(-?\d*\.?\d+)\/(-?\d*\.?\d+)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  m = t.match(/^(-?\d*\.?\d+)%$/);
  if (m) return Number(m[1]) / 100;
  return /^-?\d*\.?\d+$/.test(t) ? Number(t) : NaN;
}

/** True when two answers mean the same thing (numerically or textually). */
export function sameAnswer(given, expected) {
  const options = Array.isArray(expected) ? expected : [expected];
  return options.some((e) => {
    const a = numeric(given);
    const b = numeric(e);
    if (!Number.isNaN(a) && !Number.isNaN(b)) return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
    return normalize(given) !== '' && normalize(given) === normalize(e);
  });
}

// ------------------------------------------------------------ rendering
export function emptyValue(spec) {
  if (spec.widget === 'multi') return spec.items.map(emptyValue);
  if (spec.widget === 'table') return spec.table.rows.map((row) => row.map(() => ''));
  if (spec.widget === 'matching') return spec.matching.left.map(() => '');
  if (spec.widget === 'graph') return [];
  return spec.parts.map(() => '');
}

export function renderWidget(spec, { locked, value, onChange, result }) {
  if (spec.widget === 'multi') {
    return h('div.w-multi', {}, spec.items.map((item, i) => h('div.w-step', {},
      h('span.w-step-num', {}, `Step ${i + 1}`),
      renderWidget(item, { locked, value: value[i], onChange, result: result?.items[i] }))));
  }
  const mark = (ok) => (result ? (ok ? 'good' : 'bad') : '');
  const body = spec.widget === 'table' ? tableWidget(spec, value, locked, onChange, result, mark)
    : spec.widget === 'matching' ? matchingWidget(spec, value, locked, onChange, result)
    : spec.widget === 'graph' ? graphWidget(spec, value, locked, onChange, result)
    : partsWidget(spec, value, locked, onChange, result, mark);
  return h('div.w-item', {}, spec.prompt && h('p.w-prompt', {}, spec.prompt), body);
}

function tableWidget(spec, value, locked, onChange, result, mark) {
  const { headers, rows } = spec.table;
  let k = -1;
  return h('div.w-table-wrap', {},
    h('table.w-table', {},
      h('thead', {}, h('tr', {}, headers.map((c) => h('th', {}, c)))),
      h('tbody', {}, rows.map((row, r) => h('tr', {}, row.map((cell, c) => {
        if (cell !== null) return h('td.given', { class: cell === '' ? 'empty' : '' }, cell);
        k += 1;
        const ok = result?.parts[k];
        return h('td', {}, h('input.w-cell', {
          class: mark(ok), value: value[r][c], disabled: locked, inputmode: 'decimal',
          'aria-label': `${headers[c]}, row ${r + 1}`,
          oninput: (e) => { value[r][c] = e.target.value; onChange(); },
        }));
      }))))));
}

/** Each left item gets a row of letter chips; tap the letter of its partner. */
function matchingWidget(spec, value, locked, onChange, result) {
  const { left, right } = spec.matching;
  const used = new Set(value.filter((v) => v !== ''));
  return h('div.w-match', {},
    h('ol.w-right', { 'aria-label': 'Choices' }, right.map((opt, j) => h('li', { class: used.has(String(j)) ? 'used' : '' },
      h('span.letter', {}, letter(j)), h('span', {}, opt)))),
    h('ol.w-left', {}, left.map((item, i) => {
      const ok = result?.parts[i];
      return h('li', { class: result ? (ok ? 'good' : 'bad') : '' },
        h('span.w-left-text', {}, item),
        h('div.w-chips', { role: 'radiogroup', 'aria-label': `Match for ${item}` }, right.map((_, j) => {
          const on = value[i] === String(j);
          const key = result && spec.matching.answers[i] === j;
          return h('button.w-chip', {
            type: 'button', disabled: locked, role: 'radio', 'aria-checked': String(on),
            class: [on && 'on', result && on && (ok ? 'good' : 'bad'), result && !ok && key && 'key'].filter(Boolean).join(' '),
            onclick: () => { value[i] = on ? '' : String(j); onChange(true); },
          }, letter(j));
        })));
    })));
}

/** "a" → "(a)"; word labels such as "Domain" read better as "Domain:". */
const partLabel = (label) => (String(label).length > 4 ? `${label}:` : `(${label})`);

function partsWidget(spec, value, locked, onChange, result, mark) {
  return h('div.w-parts', {}, spec.parts.map((p, i) => h('label.w-part', {},
    h('span.w-part-label', {}, partLabel(p.label), p.prompt ? ` ${p.prompt}` : ''),
    h('input.w-cell', {
      class: mark(result?.parts[i]), value: value[i], disabled: locked, autocomplete: 'off',
      oninput: (e) => { value[i] = e.target.value; onChange(); },
    }))));
}

/** SVG coordinate plane; tap/click a grid point to add or remove it. */
function graphWidget(spec, value, locked, onChange, result) {
  const g = spec.graph;
  const step = g.step || 1;
  const W = 360;
  const pad = 22;
  const sx = (W - 2 * pad) / (g.xmax - g.xmin);
  const sy = (W - 2 * pad) / (g.ymax - g.ymin);
  const px = (x) => pad + (x - g.xmin) * sx;
  const py = (y) => W - pad - (y - g.ymin) * sy;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };
  const svg = el('svg', { viewBox: `0 0 ${W} ${W}`, class: 'w-graph', role: 'img', 'aria-label': 'Coordinate plane' });
  for (let x = Math.ceil(g.xmin / step) * step; x <= g.xmax; x += step) {
    svg.append(el('line', { x1: px(x), y1: py(g.ymin), x2: px(x), y2: py(g.ymax), class: x === 0 ? 'axis' : 'grid' }));
    if (x !== 0) svg.append(el('text', { x: px(x), y: py(0) + 13, class: 'tick' }, x));
  }
  for (let y = Math.ceil(g.ymin / step) * step; y <= g.ymax; y += step) {
    svg.append(el('line', { x1: px(g.xmin), y1: py(y), x2: px(g.xmax), y2: py(y), class: y === 0 ? 'axis' : 'grid' }));
    if (y !== 0) svg.append(el('text', { x: px(0) - 6, y: py(y) + 4, class: 'tick end' }, y));
  }
  const key = new Set(g.mode === 'line' ? [] : (g.points || []).map(([x, y]) => `${x},${y}`));
  const good = ([x, y]) => (g.mode === 'line' ? onLine(g.points, x, y) : key.has(`${x},${y}`));
  if (result && g.mode === 'line') { // draw the correct line across the plane
    const [[x1, y1], [x2, y2]] = g.points;
    const ends = x1 === x2 ? [[x1, g.ymin], [x1, g.ymax]]
      : [g.xmin, g.xmax].map((x) => [x, y1 + ((y2 - y1) / (x2 - x1)) * (x - x1)]);
    svg.append(el('line', { x1: px(ends[0][0]), y1: py(ends[0][1]), x2: px(ends[1][0]), y2: py(ends[1][1]), class: 'w-key' }));
  }
  const sorted = [...value].sort((a, b) => a[0] - b[0]);
  if ((g.connect || g.mode === 'line') && sorted.length > 1) {
    svg.append(el('polyline', { points: sorted.map(([x, y]) => `${px(x)},${py(y)}`).join(' '), class: 'w-line' }));
  }
  for (const [x, y] of value) {
    const cls = result ? (good([x, y]) ? 'pt good' : 'pt bad') : 'pt';
    svg.append(el('circle', { cx: px(x), cy: py(y), r: 6, class: cls }));
  }
  if (result) { // show the points the student missed
    for (const p of key) {
      if (!value.some(([x, y]) => `${x},${y}` === p)) {
        const [x, y] = p.split(',').map(Number);
        svg.append(el('circle', { cx: px(x), cy: py(y), r: 6, class: 'pt missed' }));
      }
    }
  }
  if (!locked) {
    svg.addEventListener('click', (e) => {
      const box = svg.getBoundingClientRect();
      const ux = ((e.clientX - box.left) / box.width) * W;
      const uy = ((e.clientY - box.top) / box.height) * W;
      const x = Math.round((g.xmin + (ux - pad) / sx) / step) * step;
      const y = Math.round((g.ymin + (W - pad - uy) / sy) / step) * step;
      if (x < g.xmin || x > g.xmax || y < g.ymin || y > g.ymax) return;
      const at = value.findIndex(([a, b]) => a === x && b === y);
      if (at >= 0) value.splice(at, 1);
      else value.push([x, y]);
      onChange(true);
    });
  }
  return h('div.w-graph-wrap', {},
    svg,
    h('p.muted.w-graph-help', {}, locked ? '' : 'Tap the grid to plot a point; tap it again to remove it.'),
    h('p.w-graph-points', {}, value.length ? `Your points: ${sorted.map(([x, y]) => `(${x}, ${y})`).join(', ')}` : 'No points yet.'),
    !locked && value.length > 0 && h('button.btn.ghost.sm', { type: 'button', onclick: () => { value.length = 0; onChange(true); } }, 'Clear points'));
}

// ------------------------------------------------------------ grading
/** Is (x, y) on the line through the two key points? */
function onLine([[x1, y1], [x2, y2]], x, y) {
  return Math.abs((x2 - x1) * (y - y1) - (y2 - y1) * (x - x1)) < 1e-9;
}

export function isAnswered(spec, value) {
  if (spec.widget === 'multi') return spec.items.every((item, i) => isAnswered(item, value[i]));
  if (spec.widget === 'graph') return value.length > 0;
  if (spec.widget === 'table') return value.some((row) => row.some((c) => String(c).trim()));
  return value.some((v) => String(v).trim());
}

export function gradeWidget(spec, value) {
  if (spec.widget === 'multi') {
    const items = spec.items.map((item, i) => gradeWidget(item, value[i]));
    return { correct: items.every((r) => r.correct), parts: items.flatMap((r) => r.parts), items };
  }
  let parts;
  if (spec.widget === 'table') {
    parts = [];
    spec.table.rows.forEach((row, r) => row.forEach((cell, c) => {
      if (cell === null) parts.push(sameAnswer(value[r][c], spec.table.answers[r][c]));
    }));
  } else if (spec.widget === 'matching') {
    parts = spec.matching.answers.map((j, i) => value[i] === String(j));
  } else if (spec.widget === 'graph' && spec.graph.mode === 'line') {
    parts = [value.length >= 2 && value.every(([x, y]) => onLine(spec.graph.points, x, y))];
  } else if (spec.widget === 'graph') {
    const key = new Set(spec.graph.points.map(([x, y]) => `${x},${y}`));
    const got = new Set(value.map(([x, y]) => `${x},${y}`));
    parts = [got.size === key.size && [...key].every((p) => got.has(p))];
  } else {
    parts = spec.parts.map((p, i) => sameAnswer(value[i], p.answer));
  }
  return { correct: parts.length > 0 && parts.every(Boolean), parts };
}

/** Plain-text answer key, shown after a wrong attempt. */
export function answerSummary(spec) {
  if (spec.widget === 'multi') return spec.items.map(answerSummary).join(' | ');
  if (spec.widget === 'table') {
    const out = [];
    spec.table.rows.forEach((row, r) => row.forEach((cell, c) => {
      if (cell === null) out.push(`${spec.table.headers[c]} = ${[].concat(spec.table.answers[r][c])[0]}`);
    }));
    return out.join(', ');
  }
  if (spec.widget === 'matching') {
    return spec.matching.left.map((l, i) => `${l} → ${spec.matching.right[spec.matching.answers[i]]}`).join('; ');
  }
  if (spec.widget === 'graph') {
    const pts = spec.graph.points.map(([x, y]) => `(${x}, ${y})`).join(', ');
    return spec.graph.mode === 'line' ? `the line through ${pts}` : pts;
  }
  return spec.parts.map((p) => `${partLabel(p.label)} ${[].concat(p.answer)[0]}`).join('; ');
}

/** The student's value as text, for the review list. */
export function valueSummary(spec, value) {
  if (spec.widget === 'multi') return spec.items.map((item, i) => valueSummary(item, value[i])).join(' | ');
  if (spec.widget === 'graph') return value.map(([x, y]) => `(${x}, ${y})`).join(', ') || '—';
  if (spec.widget === 'matching') return spec.matching.left.map((l, i) => `${l} → ${spec.matching.right[value[i]] ?? '?'}`).join('; ');
  if (spec.widget === 'table') return value.flat().filter((v) => String(v).trim()).join(', ') || '—';
  return spec.parts.map((p, i) => `${partLabel(p.label)} ${value[i] || '—'}`).join('; ');
}

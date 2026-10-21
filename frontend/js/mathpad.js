/**
 * Math typing for typed answers: a row of symbol keys under the answer box and
 * a preview of how the answer reads (x^2 → x², sqrt(3) → √3).
 *
 * mathPad(scope) returns the key row. Keys type into the answer box in `scope`
 * that last had focus (or its first one) at the cursor, and fire `input` so the
 * screen sees the change. Typing "sqrt", "pi", "<=", ">=", "!=" or "+-" turns
 * into the symbol as you type.
 */
import { h } from './ui.js';

const KEYS = [
  ['√', '√', 'Square root'], ['∛', '∛', 'Cube root'], ['x²', '²', 'Squared'], ['x³', '³', 'Cubed'],
  ['xⁿ', '^', 'Power: type ^ then the exponent'], ['a/b', '/', 'Fraction bar'], ['( )', '()', 'Brackets'],
  ['π', 'π', 'Pi'], ['±', '±', 'Plus or minus'], ['≤', '≤', 'Less than or equal'],
  ['≥', '≥', 'Greater than or equal'], ['≠', '≠', 'Not equal'], ['°', '°', 'Degrees'],
  ['θ', 'θ', 'Theta'], ['∞', '∞', 'Infinity'], ['|x|', '||', 'Absolute value'], ['∪', '∪', 'Union'],
];

// Typed shortcuts, replaced as soon as they are complete.
const SHORTCUTS = [
  [/sqrt$/i, '√'], [/cbrt$/i, '∛'], [/(^|[^a-z])pi$/i, '$1π'], [/<=$/, '≤'], [/>=$/, '≥'],
  [/!=$/, '≠'], [/\+-$/, '±'], [/(^|[^a-z])theta$/i, '$1θ'], [/(^|[^a-z])inf$/i, '$1∞'],
];

/** Put `text` at the cursor; a pair such as "()" leaves the cursor inside it. */
function insert(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const pair = text.length === 2 && ['()', '||'].includes(text);
  const inner = input.value.slice(start, end);
  const put = pair ? text[0] + inner + text[1] : text;
  input.value = input.value.slice(0, start) + put + input.value.slice(end);
  const at = start + (pair ? 1 + inner.length : put.length);
  input.setSelectionRange(at, at);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Swap a shortcut just typed before the cursor for its symbol. */
function expandShortcut(input) {
  const at = input.selectionStart;
  if (at == null || at !== input.selectionEnd) return;
  const before = input.value.slice(0, at);
  for (const [re, to] of SHORTCUTS) {
    if (!re.test(before)) continue;
    const done = before.replace(re, to);
    input.value = done + input.value.slice(at);
    input.setSelectionRange(done.length, done.length);
    return;
  }
}

/** The answer as it would be written: exponents raised, roots with a bar. */
export function prettyMath(text) {
  const out = document.createDocumentFragment();
  let i = 0;
  const s = String(text);
  // A group after ^ or √: (…) with nesting, or a run of digits/letters/./π.
  const group = (from) => {
    if (s[from] === '(') {
      let depth = 0;
      for (let j = from; j < s.length; j += 1) {
        if (s[j] === '(') depth += 1;
        else if (s[j] === ')' && --depth === 0) return [s.slice(from + 1, j), j + 1];
      }
      return [s.slice(from + 1), s.length];
    }
    const m = s.slice(from).match(/^-?[\w.π]+/);
    return m ? [m[0], from + m[0].length] : ['', from];
  };
  let plain = '';
  const flush = () => { if (plain) out.append(plain); plain = ''; };
  while (i < s.length) {
    const c = s[i];
    if (c === '^') {
      const [g, next] = group(i + 1);
      flush();
      out.append(h('sup', {}, prettyMath(g)));
      i = next;
    } else if ((c === '√' || c === '∛') && s[i + 1] === '(') {
      const [g, next] = group(i + 1);
      flush();
      out.append(c, h('span.mp-root', {}, prettyMath(g)));
      i = next;
    } else {
      plain += c;
      i += 1;
    }
  }
  flush();
  return out;
}

const needsPreview = (v) => /\^|[√∛]\(/.test(v);

/**
 * The key row for the answer boxes inside `scope` (a form or widget box).
 * `preview: true` adds a "reads as" line under it for the first box.
 */
export function mathPad(scope, { preview = true } = {}) {
  let target = null;
  const boxes = () => [...scope.querySelectorAll('input[type=text], input:not([type])')].filter((el) => !el.disabled);
  const line = h('p.mp-preview', { hidden: true, 'aria-live': 'polite' });

  const show = (input) => {
    if (!preview) return;
    const v = input?.value || '';
    line.hidden = !needsPreview(v);
    if (!line.hidden) line.replaceChildren(h('span.muted', {}, 'Reads as '), h('span.mp-math', {}, prettyMath(v)));
  };

  scope.addEventListener('focusin', (e) => { if (e.target.matches('input')) { target = e.target; show(target); } });
  scope.addEventListener('input', (e) => {
    if (!e.target.matches('input')) return;
    if (e.isTrusted && e.inputType?.startsWith('insert')) {
      const before = e.target.value;
      expandShortcut(e.target);
      // The screen's own handler already ran with the raw text; tell it about the swap.
      if (e.target.value !== before) e.target.dispatchEvent(new Event('input', { bubbles: true }));
    }
    show(e.target);
  });

  const press = (text) => {
    const input = target && target.isConnected && !target.disabled ? target : boxes()[0];
    if (!input) return;
    input.focus();
    insert(input, text);
  };

  return h('div.mathpad', {},
    h('div.mp-keys', { role: 'toolbar', 'aria-label': 'Math symbols' }, KEYS.map(([label, text, title]) => h('button.mp-key', {
      type: 'button', title, 'aria-label': title, tabindex: -1,
      // Keep the answer box focused (and a phone's keyboard open) while tapping keys.
      onpointerdown: (e) => e.preventDefault(),
      onmousedown: (e) => e.preventDefault(),
      onclick: () => press(text),
    }, label))),
    line);
}

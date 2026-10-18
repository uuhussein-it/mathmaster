/**
 * Small DOM + effects helpers shared by every screen.
 */

/**
 * Create an element: h('button.btn.primary', { onclick }, 'Start').
 * The tag string accepts `tag`, `#id` and `.class` parts in any order. Children may be strings, nodes, arrays or null.
 */
export function h(tag, attrs = {}, ...children) {
  // Parse `tag#id.class` in any order; fail loudly rather than silently dropping parts.
  if (!/^[a-z0-9-]*([#.][\w-]+)*$/i.test(tag)) throw new Error(`h(): bad tag "${tag}"`);
  const el = document.createElement(tag.match(/^[a-z0-9-]*/i)[0] || 'div');
  for (const [, sigil, name] of tag.matchAll(/([#.])([\w-]+)/g)) {
    if (sigil === '#') el.id = name;
    else el.classList.add(name);
  }
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className += ` ${value}`;
    else if (key === 'style' && typeof value === 'object') {
      // setProperty handles CSS custom properties (--x), which Object.assign would drop.
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, v);
        else el.style[prop] = v;
      }
    }
    else if (key === 'html') el.innerHTML = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Replace the contents of a node. */
export function mount(target, ...children) {
  target.replaceChildren();
  append(target, children);
}

/** Show a toast. `tone` maps to a colour (skill, success, danger, level). */
export function toast(title, text = '', { tone = 'skill', icon = '✦', portrait } = {}) {
  const box = document.getElementById('toasts');
  const node = h(`div.toast.${tone}`, { role: 'status' },
    portrait ? h('img.toast-portrait', { src: portrait, alt: '' }) : h('span.toast-icon', {}, icon),
    h('div', {}, h('strong', {}, title), text && h('p', {}, text)));
  box.append(node);
  setTimeout(() => node.classList.add('out'), 2600);
  setTimeout(() => node.remove(), 3100);
}

/** Float a "+15 XP" label up from an element. */
export function floatText(anchor, text) {
  const rect = anchor.getBoundingClientRect();
  const node = h('div.float-text', { style: { left: `${rect.left + rect.width / 2}px`, top: `${rect.top}px` } }, text);
  document.body.append(node);
  setTimeout(() => node.remove(), 1200);
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Lightweight particle burst used for level-ups and great results. */
export function burst(colors = ['#f6d77a', '#4fd1e8', '#ff7a59', '#8be38b']) {
  if (reducedMotion()) return;
  const layer = h('div.burst');
  for (let i = 0; i < 48; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 120 + Math.random() * 260;
    layer.append(h('i', {
      style: {
        background: colors[i % colors.length],
        '--x': `${Math.cos(angle) * dist}px`,
        '--y': `${Math.sin(angle) * dist}px`,
        animationDelay: `${Math.random() * 120}ms`,
      },
    }));
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 1400);
}

/** Option labels (bank screenshots can go up to F). */
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const answerLabel = (q, i) => (q.options[i] ? `${LETTERS[i]}. ${q.options[i]}` : LETTERS[i]);

/**
 * The question itself: the original screenshot for bank questions (their math
 * only survives as an image), otherwise the text.
 */
export const questionBody = (q, { small = false } = {}) => (q.image
  ? h('figure.q-figure', { class: small ? 'small' : '' },
    h('button.zoomable', { type: 'button', title: 'Tap to enlarge', onclick: () => zoomImage(q.image) },
      h('img', { id: small ? null : 'q-text', src: q.image, alt: 'Question', loading: small ? 'lazy' : 'eager', decoding: 'async' })),
    !small && h('figcaption', {}, 'Tap the question to enlarge'))
  : h(small ? 'p.q' : 'h2.q-text', { id: small ? null : 'q-text' }, q.q));

/** Full-screen, scrollable view of a question screenshot (small phones). */
export function zoomImage(src) {
  const close = () => { layer.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const layer = h('div.zoom-layer', { role: 'dialog', 'aria-label': 'Question, enlarged', onclick: close },
    h('img', { src, alt: 'Question, enlarged' }),
    h('button.btn.primary.zoom-close', { type: 'button' }, 'Close'));
  document.addEventListener('keydown', onKey, true);
  document.body.append(layer);
  layer.querySelector('.zoom-close').focus();
}

/** Labelled stat tile. */
export const kpi = (label, value, sub) => h('div.kpi', {}, h('b', {}, value), h('span', {}, label), sub && h('small', {}, sub));

/** Timer pill; pair with startCountdown(). */
export const timerEl = (seconds) => h('div#timer.timer', { role: 'timer', 'aria-label': 'Time left' }, formatTime(seconds));

/**
 * Drive the #timer pill from a deadline getter. Writes to the DOM only when the
 * displayed second changes. Calls onExpire once at zero. Returns a stop function.
 */
export function startCountdown(getDeadline, { low = 30, onExpire }) {
  let shown = null;
  const id = setInterval(() => {
    const left = (getDeadline() - Date.now()) / 1000;
    const whole = Math.max(0, Math.ceil(left));
    const el = document.getElementById('timer');
    if (el && whole !== shown) {
      shown = whole;
      el.textContent = formatTime(whole);
      el.classList.toggle('low', whole <= low);
    }
    if (left <= 0) {
      clearInterval(id);
      onExpire();
    }
  }, 250);
  return () => clearInterval(id);
}

/** mm:ss */
export function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Read/write small UI preferences without ever throwing (private mode, blocked storage). */
export const prefs = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(`questlearn.${key}`)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`questlearn.${key}`, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

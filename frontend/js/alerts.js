/**
 * Challenge alerts on every screen. While a student is anywhere on the site
 * (a lesson, the hub, the armory…), this asks the server every few seconds
 * whether a classmate has challenged them. A new challenge shows a banner
 * with Accept / Not now, plays a chime, vibrates the phone, flashes the tab
 * title and, if the student allowed it, sends a system notification when the
 * tab is in the background. A game that has started (say, a challenge the
 * student sent was just accepted) opens straight away.
 *
 * The arena lobby and live games handle challenges themselves, so the alert
 * stays quiet there.
 */
import { h, toast } from './ui.js';
import { go } from './router.js';
import { account, adminApi as api } from './account.js';

const POLL_MS = 4000;
const HIDDEN_POLL_MS = 8000;
const QUIET = new Set(['fight', 'arena', 'login', 'admin', 'select', 'level']);

let box = null;
let timer = 0;
let ticker = 0;
let audio = null;
let titleTimer = 0;
const deadlines = new Map(); // challenge id -> when it expires (ms)
let shown = [];

export function startAlerts() {
  box = h('div.challenge-alerts', { 'aria-live': 'assertive' });
  document.body.append(box);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) stopTitle(); poll(); });
  window.addEventListener('hashchange', () => setTimeout(poll, 300));
  poll();
}

/** Ask once for permission to show system notifications (from a click). */
export async function askNotifications() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* older Safari */ }
  }
  return Notification.permission;
}

export const notificationsState = () => ('Notification' in window ? Notification.permission : 'unsupported');

async function poll() {
  clearTimeout(timer);
  const screen = document.body.dataset.screen;
  if (account.student && !QUIET.has(screen)) {
    try {
      const data = await api('api/arena/alerts');
      if (data.match && !QUIET.has(document.body.dataset.screen)) {
        clear();
        toast('Your game is starting!', 'Opening the arena…', { icon: '⚔️', tone: 'level' });
        go('fight', { match: data.match });
      } else {
        show(data.incoming);
      }
    } catch { /* offline or signed out: try again later */ }
  } else {
    clear();
  }
  timer = setTimeout(poll, document.hidden ? HIDDEN_POLL_MS : POLL_MS);
}

function show(incoming) {
  const fresh = incoming.filter((c) => !deadlines.has(c.id));
  for (const c of incoming) if (!deadlines.has(c.id)) deadlines.set(c.id, Date.now() + c.expires * 1000);
  for (const id of [...deadlines.keys()]) if (!incoming.some((c) => c.id === id)) deadlines.delete(id);
  shown = incoming;
  if (fresh.length) ring(fresh[0]);
  draw();
  clearInterval(ticker);
  if (shown.length) ticker = setInterval(draw, 1000);
}

function clear() {
  shown = [];
  clearInterval(ticker);
  box?.replaceChildren();
}

function draw() {
  shown = shown.filter((c) => deadlines.get(c.id) > Date.now());
  if (!shown.length) clearInterval(ticker);
  box.replaceChildren(...shown.map((c) => {
    const left = Math.max(0, Math.round((deadlines.get(c.id) - Date.now()) / 1000));
    return h('div.challenge-alert', { role: 'alertdialog', 'aria-label': `${c.from} challenges you` },
      h('span.challenge-alert-icon', { 'aria-hidden': 'true' }, c.icon),
      h('div.challenge-alert-text', {},
        h('b', {}, `${c.from} challenges you!`),
        h('span', {}, `${c.name} · ${left}s to answer`)),
      h('div.challenge-alert-actions', {},
        h('button.btn.primary.sm', { onclick: () => reply(c, true) }, 'Accept'),
        h('button.btn.ghost.sm', { onclick: () => reply(c, false) }, 'Not now')));
  }));
}

async function reply(c, accept) {
  deadlines.delete(c.id);
  shown = shown.filter((x) => x.id !== c.id);
  draw();
  stopTitle();
  try {
    const r = await api(`api/arena/challenge/${c.id}`, { method: 'POST', body: { accept } });
    if (accept && r.match) go('fight', { match: r.match });
  } catch (e) {
    toast('Arena', e.message, { icon: '⚠️', tone: 'danger' });
  }
}

/** Get the student's attention: chime, vibration, title flash, system notification. */
function ring(c) {
  chime();
  navigator.vibrate?.([150, 80, 150]);
  flashTitle(`⚔️ ${c.from} challenges you!`);
  if (document.hidden && notificationsState() === 'granted') {
    try {
      const n = new Notification(`${c.icon} ${c.from} challenges you!`, { body: `${c.name}: open QuestLearn to accept.`, tag: c.id });
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* some phones only allow notifications from a service worker */ }
  }
}

function chime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audio = audio || new Ctx();
    const t = audio.currentTime;
    [660, 880, 1175].forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      const at = t + i * 0.13;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
      o.connect(g).connect(audio.destination);
      o.start(at);
      o.stop(at + 0.32);
    });
  } catch { /* no audio until the page has been tapped once */ }
}

let baseTitle = '';
function flashTitle(text) {
  stopTitle();
  baseTitle = document.title;
  let on = false;
  titleTimer = setInterval(() => {
    on = !on;
    document.title = on ? text : baseTitle;
  }, 900);
  setTimeout(stopTitle, 20000);
}

function stopTitle() {
  if (!titleTimer) return;
  clearInterval(titleTimer);
  titleTimer = 0;
  document.title = baseTitle;
}

/**
 * Player profile: level, XP, score, streak and per-topic mastery.
 * Stored in localStorage so progress survives reloads; every access is guarded
 * so the app still works when storage is unavailable.
 */
const KEY = 'questlearn.profile.v1';
const listeners = new Set();

const blank = () => ({
  name: '',
  character: null,
  level: 1,
  xp: 0,          // XP inside the current level
  totalXp: 0,
  score: 0,       // lifetime points
  streak: 0,      // current answer streak
  bestStreak: 0,
  answered: 0,
  correct: 0,
  topics: {},     // { [topicKey]: { name, seen, correct } }
  history: [],    // most recent sessions first
  badges: [],     // [{ id, name, icon, at }] e.g. defeating a guild boss
  insight: 0,     // ✨ earned by right answers, spent in the realm
  realm: null,    // base, resources and cosmetics (see realm/economy.js)
  cave: null,     // Cave of Equations progress, coins and items (see screens/cave.js)
  mistakes: [],   // questions answered wrong, to try again: [{ ref, topicKey, topicName, at }]
  fixed: 0,       // mistakes later answered right
  days: null,     // daily goal and day streak (see tickDay)
  week: null,     // { id: '2026-W47', xp } for the weekly league (the server keeps the real count)
});

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    return saved ? { ...blank(), ...saved } : blank();
  } catch {
    return blank();
  }
}

export const profile = load();

// Writes are batched per microtask: settling a whole quiz at once does one
// localStorage write and one HUD refresh instead of two per answer.
let pending = false;
export function save() {
  if (pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* storage unavailable */ }
    listeners.forEach((fn) => fn(profile));
  });
}

/** Subscribe to profile changes (used by the HUD). */
export function onProfileChange(fn) {
  listeners.add(fn);
}

/** XP needed to go from `level` to `level + 1`. */
export const xpToNext = (level) => 100 + (level - 1) * 50;

export function chooseHero(character, name) {
  profile.character = character;
  profile.name = name.trim() || 'Adventurer';
  save();
}

/** Add XP and return how many levels were gained. */
/** Take XP away (skip penalty), never below the start of the current level. Returns what was taken. */
export function loseXp(amount) {
  const taken = Math.max(0, Math.min(amount, profile.xp));
  profile.xp -= taken;
  profile.totalXp -= taken;
  save();
  return taken;
}

export function addXp(amount) {
  let gained = 0;
  const wk = weekKey();
  if (profile.week?.id !== wk) profile.week = { id: wk, xp: 0 };
  profile.week.xp += Math.max(0, amount);
  profile.xp += amount;
  profile.totalXp += amount;
  while (profile.xp >= xpToNext(profile.level)) {
    profile.xp -= xpToNext(profile.level);
    profile.level += 1;
    gained += 1;
  }
  save();
  return gained;
}

// ------------------------------------------------------------ days and weeks
/** Right or wrong answers a day that keep the day streak going. */
export const DAILY_GOAL = 10;
const MAX_FREEZES = 2;
const MAX_MISTAKES = 40;

/** 'YYYY-MM-DD' in the student's own time. */
export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00`) - new Date(`${a}T12:00`)) / 86_400_000);

/** ISO week id such as '2026-W47' (weeks start on Monday). */
export function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function days() {
  return (profile.days ||= { streak: 0, best: 0, last: null, freezes: 0, log: {} });
}

/** The day streak as it stands now: 0 once a day was missed without a freeze to cover it. */
export function dayStreak() {
  const d = days();
  if (!d.last) return 0;
  const gap = daysBetween(d.last, dayKey());
  return gap <= 1 || (gap === 2 && d.freezes > 0) ? d.streak : 0;
}

/** Today's answers, the goal, and the streak, for the Home ring and the HUD. */
export function dailyGoal() {
  const d = days();
  const today = dayKey();
  return { done: d.log[today] || 0, goal: DAILY_GOAL, streak: dayStreak(), best: d.best || 0, freezes: d.freezes || 0, hitToday: d.last === today, log: d.log };
}

/** Count an answer towards today's goal; reaching it moves the day streak on. */
function tickDay() {
  const d = days();
  const today = dayKey();
  d.log[today] = (d.log[today] || 0) + 1;
  const keys = Object.keys(d.log).sort();
  keys.slice(0, Math.max(0, keys.length - 42)).forEach((k) => delete d.log[k]);
  if (d.log[today] < DAILY_GOAL || d.last === today) return;
  const gap = d.last ? daysBetween(d.last, today) : null;
  let usedFreeze = false;
  if (gap === 1) d.streak += 1;
  else if (gap === 2 && d.freezes > 0) { d.freezes -= 1; d.streak += 1; usedFreeze = true; }
  else d.streak = 1;
  d.last = today;
  d.best = Math.max(d.best || 0, d.streak);
  const earnedFreeze = d.streak % 7 === 0 && d.freezes < MAX_FREEZES;
  if (earnedFreeze) d.freezes += 1;
  queueMicrotask(() => window.dispatchEvent(new CustomEvent('ql:goal', { detail: { streak: d.streak, usedFreeze, earnedFreeze } })));
}

/** Keep wrong answers to try again later; a right answer fixes one. */
function trackMistake({ ref, topicKey, topicName, correct }) {
  profile.mistakes ||= [];
  const at = profile.mistakes.findIndex((m) => m.ref === ref);
  if (correct) {
    if (at >= 0) {
      profile.mistakes.splice(at, 1);
      profile.fixed = (profile.fixed || 0) + 1;
    }
    return;
  }
  if (at >= 0) profile.mistakes.splice(at, 1);
  profile.mistakes.unshift({ ref, topicKey, topicName, at: Date.now() });
  profile.mistakes.length = Math.min(profile.mistakes.length, MAX_MISTAKES);
}

/** The AI agreed a wrong answer was right after all: don't keep it as a mistake. */
export function forgiveMistake(ref) {
  const at = (profile.mistakes || []).findIndex((m) => m.ref === ref);
  if (at >= 0) { profile.mistakes.splice(at, 1); save(); }
}

/** Record one answer: updates streak, score, topic mastery, the daily goal and mistakes to retry. */
export function recordAnswer({ topicKey, topicName, correct, points, ref }) {
  profile.answered += 1;
  const topic = (profile.topics[topicKey] ||= { name: topicName, seen: 0, correct: 0 });
  topic.seen += 1;
  if (correct) {
    profile.correct += 1;
    topic.correct += 1;
    profile.streak += 1;
    profile.bestStreak = Math.max(profile.bestStreak, profile.streak);
    profile.score += points;
    profile.insight = (profile.insight || 0) + 1; // realm currency: studying speeds up the base
  } else {
    profile.streak = 0;
  }
  tickDay();
  if (ref && topicKey) trackMistake({ ref, topicKey, topicName, correct });
  save();
}

export function topicMastery(topicKey) {
  const t = profile.topics[topicKey];
  return t && t.seen ? { ...t, pct: Math.round((t.correct / t.seen) * 100) } : null;
}

export function recordSession(summary) {
  profile.history = [summary, ...profile.history].slice(0, 12);
  save();
}

/** Swap in another profile (the signed-in student's saved one, or a blank one). */
export function replaceProfile(saved) {
  Object.assign(profile, blank(), saved || {});
  save();
}

/** Give a badge once; returns true if it's new. */
export function awardBadge({ id, name, icon }) {
  profile.badges ||= [];
  if (profile.badges.some((b) => b.id === id)) return false;
  profile.badges.push({ id, name, icon, at: Date.now() });
  save();
  return true;
}

/** Clear all progress on this device. */
export function resetProfile() {
  Object.assign(profile, blank());
  save();
}

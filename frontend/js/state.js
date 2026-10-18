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
function save() {
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
export function addXp(amount) {
  let gained = 0;
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

/** Record one answer: updates streak, score and topic mastery. */
export function recordAnswer({ topicKey, topicName, correct, points }) {
  profile.answered += 1;
  const topic = (profile.topics[topicKey] ||= { name: topicName, seen: 0, correct: 0 });
  topic.seen += 1;
  if (correct) {
    profile.correct += 1;
    topic.correct += 1;
    profile.streak += 1;
    profile.bestStreak = Math.max(profile.bestStreak, profile.streak);
    profile.score += points;
  } else {
    profile.streak = 0;
  }
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

/** Clear all progress on this device. */
export function resetProfile() {
  Object.assign(profile, blank());
  save();
}

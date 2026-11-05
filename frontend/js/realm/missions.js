/**
 * Daily missions: three small goals a day, the same for everyone on a given
 * day, each with a reward, plus a bonus chest for finishing all three.
 * Progress is counted from where the student's numbers stood when the day's
 * missions were first shown, so only today's work counts.
 */
import { profile, save } from '../state.js';
import { realm, addInsight } from './economy.js';

const POOL = [
  { id: 'right10', text: 'Answer 10 questions right', icon: '✅', goal: 10, stat: 'correct', reward: { gold: 80, insight: 2 } },
  { id: 'right20', text: 'Answer 20 questions right', icon: '🎯', goal: 20, stat: 'correct', reward: { gold: 150, insight: 3 } },
  { id: 'collect', text: 'Collect 150 resources from your buildings', icon: '🧺', goal: 150, stat: 'collected', reward: { gold: 60, insight: 1 } },
  { id: 'build', text: 'Build or upgrade a building', icon: '🔨', goal: 1, stat: 'built', reward: { gold: 60, insight: 2 } },
  { id: 'boss', text: 'Hit the guild boss 3 times', icon: '🐉', goal: 3, stat: 'bossHits', reward: { gold: 100, insight: 2 } },
  { id: 'master', text: 'Master a new topic on the road', icon: '⭐', goal: 1, stat: 'mastered', reward: { gold: 120, insight: 3 } },
];
export const CHEST = { gold: 100, insight: 5 };

export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function hash(s) {
  let x = 2166136261;
  for (const ch of s) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  return x >>> 0;
}

/** Today's numbers for each stat. `mastered` comes from the world map (null until it's loaded). */
function current(mastered) {
  const st = realm().stats;
  return { correct: profile.correct || 0, collected: st.collected || 0, built: st.built || 0, bossHits: st.bossHits || 0, mastered };
}

/** Today's missions, creating them (and the day's starting point) on first look. */
export function daily(mastered = null) {
  const r = realm();
  const day = today();
  if (r.daily?.day !== day) {
    // One "answer questions" mission every day, plus two others picked by the date.
    const h = hash(day);
    const first = POOL[h % 2];
    const rest = POOL.slice(2);
    const a = rest[(h >>> 3) % rest.length];
    const b = rest.filter((m) => m !== a)[(h >>> 7) % (rest.length - 1)];
    r.daily = { day, ids: [first.id, a.id, b.id], base: current(mastered), claimed: [], chest: false };
    save();
  }
  if (r.daily.base.mastered == null && mastered != null) {
    r.daily.base.mastered = mastered;
    save();
  }
  const now = current(mastered);
  return r.daily.ids.map((id) => {
    const m = POOL.find((x) => x.id === id);
    const base = r.daily.base[m.stat];
    const done = now[m.stat] == null || base == null ? 0 : Math.max(0, now[m.stat] - base);
    return { ...m, progress: Math.min(m.goal, done), complete: done >= m.goal, claimed: r.daily.claimed.includes(id) };
  });
}

export function claim(id) {
  const r = realm();
  const m = daily().find((x) => x.id === id);
  if (!m || !m.complete || m.claimed) return null;
  r.daily.claimed.push(id);
  r.res.gold += m.reward.gold;
  addInsight(m.reward.insight); // saves
  return m.reward;
}

export const chestReady = () => {
  const list = daily();
  return list.every((m) => m.claimed) && !realm().daily.chest;
};

export function openChest() {
  if (!chestReady()) return null;
  const r = realm();
  r.daily.chest = true;
  r.res.gold += CHEST.gold;
  addInsight(CHEST.insight);
  return CHEST;
}

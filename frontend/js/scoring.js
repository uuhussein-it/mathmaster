/**
 * XP / score rules shared by Practice, Quiz and the SAT Simulator.
 * A scorer walks answers in order so streak multipliers stay consistent
 * whether answers are settled live (Practice) or at the end (Quiz, Simulator).
 */
import { profile, recordAnswer, addXp } from './state.js';
import { streakMultiplier, hintPenalty } from './characters.js';

const BASE_XP = { practice: 10, quiz: 15, sim: 15 };

export function createScorer(mode) {
  const s = { streak: 0, bestStreak: 0, xp: 0, score: 0, levels: 0 };

  /**
   * Settle one answered item: { correct, usedHint, doubleXp, topicKey, topicName }.
   * Returns what was earned so the UI can show it.
   */
  s.settle = (item) => {
    let xp = 0;
    let points = 0;
    let mult = 1;
    if (item.correct) {
      s.streak += 1;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
      mult = streakMultiplier(profile.character, s.streak);
      const hint = item.usedHint ? hintPenalty(profile.character) : 1;
      const boost = item.doubleXp ? 2 : 1;
      xp = Math.round(BASE_XP[mode] * mult * hint * boost);
      points = Math.round(100 * mult * boost);
    } else {
      s.streak = 0;
    }
    recordAnswer({ topicKey: item.topicKey, topicName: item.topicName, correct: item.correct, points });
    const levels = xp ? addXp(xp) : 0;
    s.xp += xp;
    s.score += points;
    s.levels += levels;
    return { xp, points, mult, levels };
  };

  /** Bonus XP for finishing a run (rewards accuracy, not just volume). */
  s.finishBonus = (correct, total) => {
    const accuracy = total ? correct / total : 0;
    const bonus = accuracy >= 0.9 ? 50 : accuracy >= 0.75 ? 30 : accuracy >= 0.5 ? 15 : 5;
    s.levels += addXp(bonus);
    s.xp += bonus;
    return bonus;
  };

  /**
   * Finish the run: award the completion bonus and build the payload the
   * results screen reads. `items` are questions with { chosen, correct }.
   */
  s.results = ({ config, modeLabel, items, startedAt, ...extra }) => {
    const correct = items.filter((i) => i.correct).length;
    const bonus = s.finishBonus(correct, items.length);
    return {
      config, modeLabel, items, correct, bonus, ...extra,
      title: config.title,
      total: items.length,
      xp: s.xp,
      score: s.score,
      bestStreak: s.bestStreak,
      levels: s.levels,
      seconds: Math.round((Date.now() - startedAt) / 1000),
    };
  };

  return s;
}

/** Text verdict for a percentage. */
export function evaluate(pct) {
  if (pct >= 90) return { rank: 'Legendary', text: 'Outstanding mastery. You are ready for harder challenges.' };
  if (pct >= 75) return { rank: 'Heroic', text: 'Strong work. Review the few misses and you will own this topic.' };
  if (pct >= 50) return { rank: 'Seasoned', text: 'Solid foundation. Practice mode on your weakest topic is your next step.' };
  return { rank: 'Apprentice', text: 'Every hero starts here. Try Practice mode and use hints to learn the patterns.' };
}

/** Simplified SAT section scale: 200–800 in steps of 10. */
export const satScaled = (correct, total) => 200 + Math.round(((total ? correct / total : 0) * 600) / 10) * 10;

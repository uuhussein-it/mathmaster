import { shuffle } from './ui.js';

/**
 * Playable heroes. Each has one passive (always on) and one active skill with
 * limited charges per session. Game rules that depend on the hero live here so
 * balancing happens in one place.
 */
export const CHARACTERS = {
  sage: {
    id: 'sage',
    name: 'The Sage',
    title: 'Keeper of Hidden Knowledge',
    color: '#4fd1e8',
    image: 'assets/characters/sage.jpg',
    portrait: 'assets/characters/sage-portrait.jpg',
    blurb: 'Reads the problem behind the problem. Best for learners who like to understand every step.',
    passive: { name: "Scholar's Calm", text: 'Hints never reduce the XP you earn.' },
    skill: { name: 'Arcane Insight', icon: '🔮', text: 'Eliminate two wrong answers and reveal a deep hint.' },
  },
  warrior: {
    id: 'warrior',
    name: 'The Warrior',
    title: 'Champion of the Unbroken Streak',
    color: '#ff6b5a',
    image: 'assets/characters/warrior.jpg',
    portrait: 'assets/characters/warrior-portrait.jpg',
    blurb: 'Gets stronger with every correct answer in a row. Best for learners who love momentum.',
    passive: { name: 'Battle Fury', text: 'Streak multiplier climbs 4× faster, up to ×3 XP.' },
    skill: { name: 'War Cry', icon: '⚔️', text: 'Double XP on the current question if you answer it correctly.' },
  },
  explorer: {
    id: 'explorer',
    name: 'The Explorer',
    title: 'Pathfinder of Uncharted Topics',
    color: '#7ddc7a',
    image: 'assets/characters/explorer.jpg',
    portrait: 'assets/characters/explorer-portrait.jpg',
    blurb: 'Maps strengths and weak spots. Best for learners who want to know where to focus.',
    passive: { name: 'Trailblazer', text: '+20% time on every timed quiz and SAT section.' },
    skill: { name: 'Compass', icon: '🧭', text: 'Reveal the category and your mastery of it, plus 30 bonus seconds when timed.' },
  },
};

export const SKILL_CHARGES = { practice: 3, quiz: 2, sim: 2 };

/** XP multiplier for the current streak. */
export function streakMultiplier(characterId, streak) {
  const steps = Math.min(streak, 10);
  return characterId === 'warrior' ? 1 + steps * 0.2 : 1 + steps * 0.05;
}

/** Time multiplier for timed modes. */
export function timeBonus(characterId) {
  return characterId === 'explorer' ? 1.2 : 1;
}

/** Hint XP multiplier: the Sage's passive removes the penalty. */
export function hintPenalty(characterId) {
  return characterId === 'sage' ? 1 : 0.5;
}

/** Seconds allowed for `count` questions at `perQuestion` pace, including the hero's time bonus. */
export function timedSeconds(count, perQuestion, characterId) {
  return Math.round(count * perQuestion * timeBonus(characterId));
}

/**
 * Apply the hero's active skill to the current question. Screens pass in the
 * pieces of state the skill may touch, so Practice, Quiz and the Simulator
 * share one implementation:
 *   ctx = { eliminated: Set, notes: [], mastery, timed: bool, addTime(ms), armDoubleXp() }
 * Returns the toast text to show.
 */
export function applySkill(hero, q, ctx) {
  if (hero.id === 'sage') {
    // Free-response questions (or an unresolved key) get the insight only.
    const wrong = q.answer == null ? [] : q.options.map((_, i) => i).filter((i) => i !== q.answer && !ctx.eliminated.has(i));
    shuffle(wrong).slice(0, 2).forEach((i) => ctx.eliminated.add(i));
    ctx.notes.push({ title: 'Deep insight', text: q.hint || 'Write down what the question gives you and what it asks for, then work one step at a time.' });
    return wrong.length ? 'Two wrong answers vanish.' : 'A deep insight appears.';
  }
  if (hero.id === 'warrior') {
    ctx.armDoubleXp();
    return 'This question earns double XP if you get it right.';
  }
  const m = ctx.mastery;
  const reading = m
    ? `Category: ${q.topicName}. Your mastery: ${m.pct}% (${m.correct}/${m.seen}).`
    : `Category: ${q.topicName}. New territory: no answers recorded here yet.`;
  if (ctx.timed) ctx.addTime(30_000);
  ctx.notes.push({ title: 'Compass reading', text: ctx.timed ? `${reading} +30 seconds added.` : reading });
  return ctx.timed ? '+30 seconds on the clock.' : 'Category insight revealed.';
}

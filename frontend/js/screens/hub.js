/**
 * Main hub: hero banner, lifetime stats and the two learning paths.
 */
import { h, mount, kpi } from '../ui.js';
import { CHARACTERS } from '../characters.js';
import { profile, resetProfile } from '../state.js';
import { go } from '../router.js';

export function renderHub(app) {
  const hero = CHARACTERS[profile.character];

  const path = ({ id, eyebrow, title, text, bullets, icon, onclick }) =>
    h(`button.path-card.${id}`, { type: 'button', onclick },
      h('span.path-icon', { 'aria-hidden': 'true' }, icon),
      h('span.eyebrow', {}, eyebrow),
      h('h2', {}, title),
      h('p', {}, text),
      h('ul', {}, bullets.map((b) => h('li', {}, b))),
      h('span.path-cta', {}, 'Enter ', h('span', { 'aria-hidden': 'true' }, '→')));

  mount(app,
    h('section.hub', {},
      h('div.hub-banner', {},
        h('img.hub-banner-art', { src: hero.image, alt: '' }),
        h('div.hub-banner-text', {},
          h('p.eyebrow', {}, `${hero.name} · ${hero.title}`),
          h('h1.display', {}, `Ready, ${profile.name}?`),
          h('p', {}, `${hero.passive.name}: ${hero.passive.text}`),
          h('div.kpis', {},
            kpi('Level', profile.level),
            kpi('Total XP', profile.totalXp.toLocaleString()),
            kpi('Accuracy', profile.answered ? `${Math.round((profile.correct / profile.answered) * 100)}%` : '—'),
            kpi('Best streak', profile.bestStreak)))),

      h('h2.section-title', {}, 'Choose your path'),
      h('div.paths', {},
        path({
          id: 'school', icon: '📘', eyebrow: 'Path A', title: 'School Curriculum',
          text: 'Grades 9–12 practice built from your course topics.',
          bullets: ['ASP, Advanced and General tracks', 'Terms 1–3', 'Practice or timed Quiz mode'],
          onclick: () => go('curriculum'),
        }),
        path({
          id: 'sat', icon: '🎯', eyebrow: 'Path B', title: 'SAT Preparation',
          text: 'Full section simulations and focused topic drills.',
          bullets: ['Timed SAT Simulator with scaled score', 'Math and Reading & Writing topics', 'Review every answer'],
          onclick: () => go('sat'),
        })),

      profile.history.length > 0 && h('div.panel.history', {},
        h('h3', {}, 'Recent quests'),
        h('ul', {}, profile.history.slice(0, 5).map((s) =>
          h('li', {},
            h('span.history-mode', {}, s.modeLabel),
            h('span.history-title', {}, s.title),
            h('span.history-score', {}, `${s.correct}/${s.total}`),
            h('span.history-xp', {}, `+${s.xp} XP`))))),

      h('div.hub-foot', {},
        h('button.btn.ghost', { onclick: () => go('select') }, 'Change hero'),
        h('a.btn.ghost', { href: 'classic' }, 'Classic MathMaster site'),
        h('button.btn.ghost.danger', {
          onclick: () => {
            if (confirm('Reset all progress? This clears your level, XP and history on this device.')) {
              resetProfile();
              go('select');
            }
          },
        }, 'Reset progress'))));
}

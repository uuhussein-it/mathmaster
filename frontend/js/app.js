/**
 * Entry point: renders the persistent HUD and registers every screen.
 */
import { h, mount } from './ui.js';
import { CHARACTERS } from './characters.js';
import { profile, onProfileChange, xpToNext } from './state.js';
import { register, startRouter, go } from './router.js';

import { renderSelect } from './screens/select.js';
import { renderHub } from './screens/hub.js';
import { renderCurriculum } from './screens/curriculum.js';
import { renderSat } from './screens/sat.js';
import { renderPlay } from './screens/play.js';
import { renderSimulator } from './screens/simulator.js';
import { renderResults } from './screens/results.js';

/** Top bar: hero portrait, level, XP progress, score and streak. */
function renderHud() {
  const hud = document.getElementById('hud');
  const hero = CHARACTERS[profile.character];
  hud.hidden = !hero;
  if (!hero) return;
  document.documentElement.style.setProperty('--hero', hero.color);

  const need = xpToNext(profile.level);
  const pct = Math.min(100, (profile.xp / need) * 100);
  mount(hud,
    h('button.brand', { onclick: () => go('hub'), 'aria-label': 'QuestLearn home' },
      h('img', { src: 'assets/favicon.svg', alt: '' }), h('span', {}, 'QuestLearn')),
    h('div.hud-hero', {},
      h('img.hud-portrait', { src: hero.portrait, alt: hero.name }),
      h('div.hud-level', { title: `Level ${profile.level}` }, h('small', {}, 'LVL'), profile.level),
      h('div.hud-xp', {},
        h('div.hud-name', {}, h('strong', {}, profile.name), h('span', {}, hero.name)),
        h('div.xp-bar', { role: 'progressbar', 'aria-label': 'Experience', 'aria-valuemin': 0, 'aria-valuemax': need, 'aria-valuenow': profile.xp },
          h('i', { style: { width: `${pct}%` } })),
        h('div.xp-label', {}, `${profile.xp} / ${need} XP`))),
    h('div.hud-stats', {},
      h('div.stat-pill.score', { title: 'Total score' }, h('span', { 'aria-hidden': 'true' }, '🏆'), h('b', {}, profile.score.toLocaleString()), h('small', {}, 'Score')),
      h('div.stat-pill.streak', { class: profile.streak >= 3 ? 'hot' : '', title: 'Current answer streak' },
        h('span', { 'aria-hidden': 'true' }, '🔥'), h('b', {}, profile.streak), h('small', {}, 'Streak'))));
}

register('select', renderSelect);
register('hub', renderHub);
register('curriculum', renderCurriculum);
register('sat', renderSat);
register('play', renderPlay, { needsPayload: true });
register('simulator', renderSimulator, { needsPayload: true });
register('results', renderResults, { needsPayload: true });

onProfileChange(renderHud);
renderHud();
startRouter();

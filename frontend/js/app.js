/**
 * Entry point: renders the persistent HUD and registers every screen.
 */
import { h, mount } from './ui.js';
import { CHARACTERS } from './characters.js';
import { profile, onProfileChange, xpToNext } from './state.js';
import { register, startRouter, go } from './router.js';
import { loadAccount, account } from './account.js';

import { renderSelect } from './screens/select.js';
import { renderHub } from './screens/hub.js';
import { renderCurriculum } from './screens/curriculum.js';
import { renderSat } from './screens/sat.js';
import { renderPlay } from './screens/play.js';
import { renderSimulator } from './screens/simulator.js';
import { renderExam } from './screens/exam.js';
import { renderResults } from './screens/results.js';
import { renderLogin } from './screens/login.js';
import { renderLevel } from './screens/level.js';
import { renderAdmin } from './screens/admin.js';
import { renderRealm } from './screens/realm.js';
import { renderCave } from './screens/cave.js';
import { renderLearn, renderGames, renderLeaderboard, renderMe } from './screens/pages.js';

/** Main menu entries and the screens that belong to each. */
const MENU = [
  { route: 'hub', icon: '🏠', label: 'Home', screens: ['hub'] },
  { route: 'learn', icon: '📘', label: 'Learn', screens: ['learn', 'curriculum', 'sat', 'play', 'simulator', 'results', 'exam'] },
  { route: 'games', icon: '🎮', label: 'Play', screens: ['games', 'realm', 'cave'] },
  { route: 'leaderboard', icon: '🏆', label: 'Leaderboard', screens: ['leaderboard'] },
  { route: 'me', icon: '🦸', label: 'Me', screens: ['me', 'select', 'level'] },
];

function renderNav(show) {
  const nav = document.getElementById('nav');
  nav.hidden = !show;
  if (!show) { nav.replaceChildren(); return; }
  const screen = location.hash.replace(/^#\/?/, '') || 'hub';
  mount(nav, h('div.mainnav-inner', {}, MENU.map((m) => {
    const on = m.screens.includes(screen);
    return h('button.mainnav-item', { type: 'button', class: on ? 'on' : '', 'aria-current': on ? 'page' : null, onclick: () => go(m.route) },
      h('span.mainnav-icon', { 'aria-hidden': 'true' }, m.icon), h('span.mainnav-label', {}, m.label));
  })));
}

/** Top bar: hero portrait, level, XP progress, score and streak. */
function renderHud() {
  const hud = document.getElementById('hud');
  const hero = account.student && CHARACTERS[profile.character];
  hud.hidden = !hero;
  renderNav(Boolean(hero && account.student?.group));
  if (!hero) {
    hud.replaceChildren(); // signed out: don't leave the last student's name and XP behind
    return;
  }
  document.documentElement.style.setProperty('--hero', hero.color);

  const need = xpToNext(profile.level);
  const pct = Math.min(100, (profile.xp / need) * 100);
  mount(hud,
    h('button.brand', { onclick: () => go('hub'), 'aria-label': 'QuestLearn home' },
      h('img', { src: 'assets/favicon.svg', alt: '' }), h('span', {}, 'QuestLearn')),
    h('button.hud-hero', { type: 'button', onclick: () => go('me'), title: 'My profile' },
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

register('login', renderLogin);
register('level', renderLevel);
register('admin', renderAdmin);
register('select', renderSelect);
register('hub', renderHub);
register('curriculum', renderCurriculum);
register('sat', renderSat);
register('play', renderPlay, { needsPayload: true });
register('simulator', renderSimulator, { needsPayload: true });
register('results', renderResults, { needsPayload: true });
register('exam', renderExam, { needsPayload: true });
register('realm', renderRealm);
register('cave', renderCave);
register('learn', renderLearn);
register('games', renderGames);
register('leaderboard', renderLeaderboard);
register('me', renderMe);

// The menu sticks just under the HUD, whatever height the HUD has on this screen.
new ResizeObserver(([e]) => document.documentElement.style.setProperty('--hud-h', `${Math.round(e.target.getBoundingClientRect().height)}px`))
  .observe(document.getElementById('hud'));

onProfileChange(renderHud);
window.addEventListener('hashchange', renderHud); // signing in or out changes the screen
renderHud();
loadAccount().then(() => {
  renderHud();
  startRouter();
});

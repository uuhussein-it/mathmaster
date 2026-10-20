/**
 * Main hub: the student's group play area (who's here, leaderboard), hero
 * banner, lifetime stats and the two learning paths.
 */
import { h, mount, kpi, prefs } from '../ui.js';
import { CHARACTERS } from '../characters.js';
import { profile, resetProfile } from '../state.js';
import { go } from '../router.js';
import { account, loadGroup, logout } from '../account.js';
import { openFeedback } from '../feedback.js';

const REFRESH_MS = 30_000;

export function renderHub(app) {
  const hero = CHARACTERS[profile.character];
  const me = account.student;
  const lobby = h('section.lobby.panel', { 'aria-label': 'Your group' }, h('p.muted', {}, 'Loading your group…'));

  function playCourse() {
    prefs.set('curriculum', { ...prefs.get('curriculum', {}), grade: me.grade, track: me.track });
    go('curriculum');
  }

  async function refresh() {
    try {
      drawLobby(await loadGroup(me.group.id));
    } catch {
      lobby.replaceChildren(h('p.muted', {}, 'Your group couldn’t load. Check your connection.'));
    }
  }

  function avatar(m) {
    const c = CHARACTERS[m.character];
    return h('span.avatar', { class: m.online ? 'online' : '', title: `${m.name}${m.online ? ' · online' : ''}` },
      c ? h('img', { src: c.portrait, alt: '' }) : h('span.avatar-letter', {}, m.name[0] || '?'));
  }

  function drawLobby(g) {
    const online = g.members.filter((m) => m.online);
    lobby.replaceChildren(
      h('div.lobby-head', {},
        h('div', {},
          h('p.eyebrow', {}, 'Your group'),
          h('h2', {}, g.name),
          h('p.muted', {}, `${g.members.length} ${g.members.length === 1 ? 'student' : 'students'} · `,
            h('span.online-dot', { 'aria-hidden': 'true' }), ` ${online.length} online now`)),
        h('div.lobby-actions', {},
          h('button.btn.primary', { onclick: playCourse }, '⚔️ Play my course'),
          h('button.btn', { onclick: () => go('sat') }, '🎯 SAT practice'),
          h('button.btn.ghost.sm', { onclick: () => go('level') }, 'Change level'))),
      h('div.lobby-members', { 'aria-label': 'Students online' },
        online.slice(0, 24).map((m) => h('div.member', {}, avatar(m), h('span', {}, m.id === me.id ? 'You' : m.name))),
        online.length === 0 && h('p.muted', {}, 'No one else is online right now.')),
      h('h3.sub-title', {}, '🏆 Leaderboard'),
      g.leaderboard.length
        ? h('ol.board', {}, g.leaderboard.slice(0, 10).map((m) =>
          h('li', { class: m.id === me.id ? 'me' : '' },
            h('span.board-rank', {}, m.rank <= 3 ? ['🥇', '🥈', '🥉'][m.rank - 1] : m.rank),
            avatar(m),
            h('span.board-name', {}, m.name, m.id === me.id && h('small', {}, ' (you)')),
            h('span.board-level', {}, `Lv ${m.level}`),
            h('span.board-score', {}, m.score.toLocaleString()))))
        : h('p.muted', {}, 'Answer questions to put your group on the board.'));
  }

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
      lobby,
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
        h('button.btn.ghost', { onclick: () => openFeedback() }, '💬 Send feedback'),
        h('button.btn.ghost', { onclick: () => go('select') }, 'Change hero'),
        h('a.btn.ghost', { href: 'classic' }, 'Classic MathMaster site'),
        h('button.btn.ghost.danger', {
          onclick: () => {
            if (confirm('Reset all progress? This clears your level, XP and history on this device.')) {
              resetProfile();
              go('select');
            }
          },
        }, 'Reset progress'),
        h('button.btn.ghost', { onclick: async () => { await logout(); go('login'); } }, 'Log out'))));

  refresh();
  const timer = setInterval(refresh, REFRESH_MS);
  return () => clearInterval(timer);
}

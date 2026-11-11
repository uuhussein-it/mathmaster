/**
 * The main menu's pages: Learn (course, Final Exam, SAT), Play (the Realm and
 * the Cave), Leaderboard (the class, ranked several ways) and Me (hero,
 * stats, badges, history and settings).
 */
import { h, mount, kpi } from '../ui.js';
import { CHARACTERS } from '../characters.js';
import { profile, resetProfile } from '../state.js';
import { go } from '../router.js';
import { account, loadGroup, logout } from '../account.js';
import { openFeedback } from '../feedback.js';
import { avatar } from './controls.js';
import { myCourse, openCurriculum } from './hub.js';
import * as missions from '../realm/missions.js';

const pageHead = (title, text) => h('div.page-head', {}, h('h1.display', {}, title), text && h('p.muted', {}, text));

/** A big card linking to one part of the site. */
function card({ id, icon, title, text, bullets = [], badge, cta = 'Open', onclick }) {
  return h(`button.path-card.${id}`, { type: 'button', onclick },
    h('span.path-icon', { 'aria-hidden': 'true' }, icon),
    badge && h('span.card-badge', {}, badge),
    h('h2', {}, title),
    h('p', {}, text),
    bullets.length > 0 && h('ul', {}, bullets.map((b) => h('li', {}, b))),
    h('span.path-cta', {}, `${cta} `, h('span', { 'aria-hidden': 'true' }, '→')));
}

// ------------------------------------------------------------------ Learn
export function renderLearn(app) {
  const me = account.student;
  const examCard = h('div');
  const draw = (course) => {
    const best = course && profile.exams?.[course.code];
    examCard.replaceWith(card({
      id: 'exam', icon: '🎓', title: 'Final Exam practice',
      text: course ? `A full ${course.code} End of Term paper, laid out like the real one.` : 'A full End of Term paper, laid out like the real one.',
      bullets: ['19 multiple choice + 13 written questions', '100 marks, 2 hours, every subtopic', 'Three versions, marked straight away'],
      badge: best ? `Best ${best.best}/100` : null,
      cta: 'Open the exam', onclick: () => openCurriculum('exam'),
    }));
  };
  myCourse().then(draw).catch(() => draw(null));

  mount(app,
    h('section.page', {},
      pageHead('Learn', 'Practise your course, sit a Final Exam, or train for the SAT.'),
      h('div.paths', {},
        card({
          id: 'school', icon: '📘', title: 'My course',
          text: `Practice and quizzes from ${me.group?.name || 'your course'}, by topic and lesson.`,
          bullets: ['Practice Mode: hints and explanations', 'Quiz Mode: timed, scored at the end', 'Pick whole topics or single lessons'],
          cta: 'Start practising', onclick: () => openCurriculum('practice'),
        }),
        examCard,
        card({
          id: 'sat', icon: '🎯', title: 'SAT Preparation',
          text: 'Full section simulations and focused topic drills.',
          bullets: ['Timed SAT Simulator with a scaled score', 'Math and Reading & Writing topics', 'Review every answer'],
          cta: 'Train for the SAT', onclick: () => go('sat'),
        })),
      h('p.muted.small.page-note', {}, 'Not your class? ', h('button.link', { onclick: () => go('level') }, 'Change your level'))));
}

// ------------------------------------------------------------------ Play
export function renderGames(app) {
  let missionText = 'Daily missions with rewards';
  try {
    const list = missions.daily();
    missionText = `Today’s missions: ${list.filter((m) => m.complete).length} of ${list.length} done`;
  } catch { /* not set up yet */ }
  const cave = profile.cave || {};
  const stars = Object.values(cave.stars || {}).reduce((n, s) => n + s, 0);
  const cleared = (cave.cleared || []).length;

  mount(app,
    h('section.page', {},
      pageHead('Play', 'Games that run on your answers. Every right answer helps you here.'),
      h('div.paths.two', {},
        card({
          id: 'realm', icon: '🏰', title: 'The Realm',
          text: 'Walk your pixel town, build it up and travel the road of your topics.',
          bullets: [missionText, 'Build farms and mines, shop for your hero', 'Beat the guild boss with your class'],
          badge: `✨ ${profile.insight || 0} Insight`,
          cta: 'Enter the Realm', onclick: () => go('realm'),
        }),
        card({
          id: 'cave', icon: '🪔', title: 'Cave of Equations',
          text: 'A retro platformer: help Aladdin escape by solving what blocks his way.',
          bullets: [`${cleared} of 3 stages cleared · ${stars} of 9 stars`, 'Number Gates, sand doors, stomp the bats', 'Defeat the sorcerer Zarkan with Number Spells'],
          badge: `🪙 ${cave.coins || 0}`,
          cta: cleared ? 'Keep playing' : 'Start the adventure', onclick: () => go('cave'),
        }))));
}

// ------------------------------------------------------------------ Leaderboard
const BOARDS = [
  { id: 'score', label: '🏆 Score', value: (m) => m.score, show: (m) => m.score.toLocaleString(), note: 'Points from every right answer.' },
  { id: 'xp', label: '⭐ XP', value: (m) => m.xp, show: (m) => `${m.xp.toLocaleString()} XP`, note: 'Experience from practice, quizzes, exams and games.' },
  { id: 'exam', label: '🎓 Final Exam', value: (m) => m.exam, show: (m) => `${m.exam} / 100`, note: 'Best Final Exam practice mark.' },
  { id: 'stars', label: '🪔 Cave stars', value: (m) => m.stars, show: (m) => `${'★'.repeat(m.stars)} ${m.stars}/9`, note: 'Stars earned in the Cave of Equations.' },
];

export function renderLeaderboard(app) {
  const me = account.student;
  let tab = 'score';
  let group = null;
  const body = h('div', {}, h('p.muted', {}, 'Loading your class…'));

  function draw() {
    if (!group) return;
    const b = BOARDS.find((x) => x.id === tab);
    const ranked = (group.players || group.leaderboard)
      .filter((m) => b.value(m) != null && b.value(m) > 0)
      .sort((x, y) => b.value(y) - b.value(x) || x.name.localeCompare(y.name));
    const online = group.members.filter((m) => m.online);
    body.replaceChildren(
      h('div.board-tabs', { role: 'tablist' }, BOARDS.map((x) => h('button.chip', {
        type: 'button', role: 'tab', 'aria-selected': String(x.id === tab), 'aria-checked': String(x.id === tab),
        onclick: () => { tab = x.id; draw(); },
      }, x.label))),
      h('p.muted.small', {}, b.note),
      ranked.length
        ? h('ol.board.full', {}, ranked.slice(0, 50).map((m, i) => h('li', { class: m.id === me.id ? 'me' : '' },
          h('span.board-rank', {}, i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1),
          avatar(m),
          h('span.board-name', {}, m.name, m.id === me.id && h('small', {}, ' (you)')),
          h('span.board-level', {}, `Lv ${m.level}`),
          h('span.board-score', {}, b.show(m)))))
        : h('p.muted.board-empty', {}, 'No one is on this board yet. Be the first!'),
      h('section.panel.board-online', {},
        h('h3', {}, h('span.online-dot', { 'aria-hidden': 'true' }), ` Online now (${online.length})`),
        h('div.lobby-members', {},
          online.slice(0, 40).map((m) => h('div.member', {}, avatar(m), h('span', {}, m.id === me.id ? 'You' : m.name))),
          online.length === 0 && h('p.muted', {}, 'No one else is online right now.'))));
  }

  async function refresh() {
    try {
      group = await loadGroup(me.group.id);
      draw();
    } catch {
      if (!group) body.replaceChildren(h('p.muted', {}, 'The leaderboard couldn’t load. Check your connection.'));
    }
  }

  mount(app, h('section.page', {}, pageHead('Leaderboard', me.group?.name ? `${me.group.name} · everyone in your class` : ''), h('div.panel', {}, body)));
  refresh();
  const timer = setInterval(refresh, 30_000);
  return () => clearInterval(timer);
}

// ------------------------------------------------------------------ Me
export function renderMe(app) {
  const hero = CHARACTERS[profile.character];
  const me = account.student;
  const accuracy = profile.answered ? `${Math.round((profile.correct / profile.answered) * 100)}%` : '—';
  const exams = Object.entries(profile.exams || {});
  const cave = profile.cave || {};
  const topics = Object.values(profile.topics || {}).filter((t) => t.seen >= 3)
    .map((t) => ({ ...t, pct: Math.round((t.correct / t.seen) * 100) }));
  const strong = [...topics].sort((a, b) => b.pct - a.pct).filter((t) => t.pct >= 75).slice(0, 3);
  const weak = [...topics].sort((a, b) => a.pct - b.pct).filter((t) => t.pct < 75).slice(0, 3);

  mount(app,
    h('section.page.me', {},
      h('div.hub-banner', {},
        h('img.hub-banner-art', { src: hero.image, alt: '' }),
        h('div.hub-banner-text', {},
          h('p.eyebrow', {}, `${hero.name} · ${hero.title}`),
          h('h1.display', {}, profile.name),
          h('p', {}, me.group?.name || ''),
          h('p', {}, `${hero.passive.name}: ${hero.passive.text}`),
          h('div.kpis', {},
            kpi('Level', profile.level),
            kpi('Total XP', profile.totalXp.toLocaleString()),
            kpi('Accuracy', accuracy),
            kpi('Best streak', profile.bestStreak)))),

      h('div.me-grid', {},
        h('section.panel', {},
          h('h3', {}, '📈 My topics'),
          topics.length === 0 && h('p.muted', {}, 'Answer at least 3 questions in a topic to see how you’re doing.'),
          strong.length > 0 && h('div', {}, h('p.eyebrow', {}, 'Strongest'),
            h('ul.bars', {}, strong.map((t) => h('li', {}, h('span', {}, t.name), h('div.bar', {}, h('i.good', { style: { width: `${t.pct}%` } })), h('b', {}, `${t.pct}%`))))),
          weak.length > 0 && h('div', {}, h('p.eyebrow', {}, 'Needs practice'),
            h('ul.bars', {}, weak.map((t) => h('li', {}, h('span', {}, t.name), h('div.bar', {}, h('i', { class: t.pct >= 50 ? 'ok' : 'low', style: { width: `${t.pct}%` } })), h('b', {}, `${t.pct}%`)))))),

        h('section.panel', {},
          h('h3', {}, '🏅 Achievements'),
          h('ul.me-facts', {},
            h('li', {}, h('span', {}, '🎓 Final Exam best'), h('b', {}, exams.length ? exams.map(([code, e]) => `${code}: ${e.best}/100`).join(' · ') : 'Not tried yet')),
            h('li', {}, h('span', {}, '🪔 Cave'), h('b', {}, `${(cave.cleared || []).length}/3 stages · ${Object.values(cave.stars || {}).reduce((n, s) => n + s, 0)}/9 ★`)),
            h('li', {}, h('span', {}, '✨ Insight'), h('b', {}, profile.insight || 0)),
            h('li', {}, h('span', {}, '✅ Questions answered'), h('b', {}, `${profile.correct} right of ${profile.answered}`))),
          h('div.me-badges', {}, (profile.badges || []).length
            ? profile.badges.map((b) => h('span.me-badge', { title: b.name }, h('span', { 'aria-hidden': 'true' }, b.icon), b.name))
            : h('p.muted.small', {}, 'Badges appear here: beat a guild boss, ace a Final Exam, or defeat Zarkan.')))),

      profile.history.length > 0 && h('div.panel.history', {},
        h('h3', {}, 'Recent activity'),
        h('ul', {}, profile.history.slice(0, 10).map((s) => h('li', {},
          h('span.history-mode', {}, s.modeLabel),
          h('span.history-title', {}, s.title),
          h('span.history-score', {}, `${s.correct}/${s.total}`),
          h('span.history-xp', {}, `${s.xp >= 0 ? '+' : ''}${s.xp} XP`))))),

      h('section.panel.me-settings', {},
        h('h3', {}, '⚙️ Settings'),
        h('div.hub-foot', {},
          h('button.btn.ghost', { onclick: () => go('select') }, '🦸 Change hero'),
          h('button.btn.ghost', { onclick: () => go('level') }, '🎚️ Change level'),
          h('button.btn.ghost', { onclick: () => openFeedback() }, '💬 Send feedback'),
          h('button.btn.ghost.danger', {
            onclick: () => {
              if (confirm('Reset all progress? This clears your level, XP and history on this device.')) {
                resetProfile();
                go('select');
              }
            },
          }, 'Reset progress'),
          h('button.btn.ghost', { onclick: async () => { await logout(); go('login'); } }, 'Log out')))));
}

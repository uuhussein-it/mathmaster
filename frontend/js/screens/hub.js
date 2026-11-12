/**
 * Home: a short greeting, the "Today" card (the next few things worth doing,
 * worked out from the student's own progress), shortcuts to Learn and Play,
 * and the top of the class leaderboard. Everything else lives on its own page
 * (Learn, Play, Leaderboard, Me) in the main menu.
 */
import { h, mount, prefs } from '../ui.js';
import { CHARACTERS } from '../characters.js';
import { profile } from '../state.js';
import { go } from '../router.js';
import { account, loadGroup } from '../account.js';
import { loadCurriculumIndex } from '../data.js';
import { avatar } from './controls.js';
import * as missions from '../realm/missions.js';

const REFRESH_MS = 30_000;

/** Morning, afternoon or evening, in the student's own time. */
function greeting() {
  const hr = new Date().getHours();
  return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}

/** The student's own Term 1 course, if the bank has one. */
export async function myCourse() {
  const me = account.student;
  const index = await loadCurriculumIndex();
  const mine = index.courses.filter((c) => c.grade === me?.grade && c.track === me?.track);
  return mine.sort((a, b) => b.term - a.term)[0] || null;
}

/** Open School Curriculum on the student's course, optionally in a given mode. */
export function openCurriculum(mode) {
  const me = account.student;
  prefs.set('curriculum', { ...prefs.get('curriculum', {}), grade: me.grade, track: me.track, ...(mode ? { mode } : {}) });
  go('curriculum');
}

/** Weakest topic with enough answers to judge (below 75%). */
function weakestTopic() {
  return Object.entries(profile.topics || {})
    .map(([key, t]) => ({ key, ...t, pct: t.seen ? Math.round((t.correct / t.seen) * 100) : 100 }))
    .filter((t) => t.seen >= 3 && t.pct < 75)
    .sort((a, b) => a.pct - b.pct)[0] || null;
}

export function renderHub(app) {
  const hero = CHARACTERS[profile.character];
  const me = account.student;
  const today = h('ul.today-list');
  const board = h('div.home-board', {}, h('p.muted', {}, 'Loading your class…'));

  const row = ({ icon, title, text, cta, onclick, done = false }) => h('li.today-item', { class: done ? 'done' : '' },
    h('span.today-icon', { 'aria-hidden': 'true' }, done ? '✅' : icon),
    h('div.today-text', {}, h('b', {}, title), text && h('small', {}, text)),
    cta && h('button.btn.sm', { class: done ? 'ghost' : 'primary', onclick }, cta));

  async function drawToday() {
    const items = [];

    // 1. Daily missions in the Realm.
    try {
      const list = missions.daily();
      const finished = list.filter((m) => m.complete).length;
      const unclaimed = list.filter((m) => m.complete && !m.claimed).length;
      const next = list.find((m) => !m.complete);
      items.push(row({
        icon: '📜',
        title: unclaimed ? `${unclaimed} mission reward${unclaimed === 1 ? '' : 's'} to claim` : `Daily missions: ${finished} of ${list.length} done`,
        text: unclaimed ? 'Collect them in the Realm.' : next ? `Next: ${next.text} (${next.progress}/${next.goal})` : 'All done for today. Come back tomorrow!',
        cta: unclaimed ? 'Claim' : next ? 'Go' : null,
        onclick: () => go('realm'),
        done: !unclaimed && !next,
      }));
    } catch { /* the realm isn't set up yet: skip */ }

    // 2. The weakest topic.
    const weak = weakestTopic();
    items.push(weak
      ? row({
        icon: '🎯', title: `Practise “${weak.name}”`, text: `Your weakest topic right now: ${weak.pct}% right.`,
        cta: 'Practise', onclick: () => (weak.key.startsWith('sat:') ? go('sat') : openCurriculum('practice')),
      })
      : row({
        icon: '📘', title: 'Practise your course', text: 'Answer a few questions to find your strong and weak topics.',
        cta: 'Start', onclick: () => openCurriculum('practice'),
      }));

    // 3. The Final Exam for their course.
    const course = await myCourse().catch(() => null);
    if (course) {
      const best = profile.exams?.[course.code];
      items.push(row({
        icon: '🎓',
        title: best ? `Final Exam: beat your best of ${best.best}/100` : `Try the ${course.code} Final Exam practice`,
        text: best ? `${best.attempts} attempt${best.attempts === 1 ? '' : 's'} so far. Three versions to try.` : 'A full End of Term paper: 100 marks, 2 hours.',
        cta: 'Open', onclick: () => openCurriculum('exam'),
      }));
    }

    // 4. The Cave.
    const cave = profile.cave || {};
    const cleared = cave.cleared || [];
    const stars = cave.stars || {};
    const nextStage = [1, 2, 3].find((n) => !cleared.includes(n));
    const polish = [1, 2, 3].find((n) => cleared.includes(n) && (stars[n] || 0) < 3);
    if (nextStage || polish) {
      items.push(row({
        icon: '🪔',
        title: nextStage ? `Cave of Equations: Stage ${nextStage} is waiting` : `Get 3 stars on Cave Stage ${polish}`,
        text: nextStage ? 'Help Aladdin escape by answering at the gates.' : `You have ${stars[polish] || 0} of 3 stars there.`,
        cta: 'Play', onclick: () => go('cave'),
      }));
    }
    today.replaceChildren(...items);
  }

  async function drawBoard() {
    try {
      const g = await loadGroup(me.group.id);
      const top = g.leaderboard.slice(0, 3);
      const mine = g.leaderboard.find((m) => m.id === me.id);
      board.replaceChildren(
        top.length ? h('ol.board.compact', {}, top.map((m) => h('li', { class: m.id === me.id ? 'me' : '' },
          h('span.board-rank', {}, ['🥇', '🥈', '🥉'][m.rank - 1]),
          avatar(m),
          h('span.board-name', {}, m.id === me.id ? 'You' : m.name),
          h('span.board-score', {}, m.score.toLocaleString())))) : h('p.muted', {}, 'Answer questions to put your class on the board.'),
        h('p.muted.small', {}, mine && mine.rank > 3 ? `You're #${mine.rank} of ${g.leaderboard.length}. ` : '',
          h('span.online-dot', { 'aria-hidden': 'true' }), ` ${g.online} online now`));
    } catch {
      board.replaceChildren(h('p.muted', {}, 'Your class couldn’t load. Check your connection.'));
    }
  }

  const tile = (icon, title, text, route, cls) => h(`button.home-tile.${cls}`, { type: 'button', onclick: () => go(route) },
    h('span.home-tile-icon', { 'aria-hidden': 'true' }, icon),
    h('span', {}, h('b', {}, title), h('small', {}, text)),
    h('span.home-tile-go', { 'aria-hidden': 'true' }, '→'));

  mount(app,
    h('section.home', {},
      h('div.home-hello', {},
        h('img.home-portrait', { src: hero.portrait, alt: '' }),
        h('div', {},
          h('p.eyebrow', {}, me.group?.name || ''),
          h('h1.display', {}, `${greeting()}, ${profile.name}!`),
          h('p.muted', {}, profile.streak >= 3 ? `🔥 ${profile.streak} right answers in a row. Keep it going!` : 'Here’s what to do today.'))),

      h('div.home-grid', {},
        h('section.panel.today', { 'aria-label': 'Today' },
          h('h2', {}, '☀️ Today'),
          today),
        h('div.home-side', {},
          tile('📘', 'Learn', 'Your course, Final Exam practice and the SAT', 'learn', 'learn'),
          tile('🎮', 'Play', 'The Realm and the Cave of Equations', 'games', 'play'),
          h('section.panel.home-class', {},
            h('div.home-class-head', {}, h('h3', {}, '🏆 Your class'), h('button.link', { onclick: () => go('leaderboard') }, 'Full leaderboard →')),
            board)))));

  drawToday();
  drawBoard();
  const timer = setInterval(drawBoard, REFRESH_MS);
  return () => clearInterval(timer);
}

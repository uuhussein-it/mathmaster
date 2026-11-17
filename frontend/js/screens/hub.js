/**
 * Home: a short greeting, the "Today" card (the next few things worth doing,
 * worked out from the student's own progress), shortcuts to Learn and Play,
 * and the top of the class leaderboard. Everything else lives on its own page
 * (Learn, Play, Leaderboard, Me) in the main menu.
 */
import { h, mount, prefs, modal, burst } from '../ui.js';
import { CHARACTERS } from '../characters.js';
import { profile, dailyGoal, dayKey } from '../state.js';
import { go } from '../router.js';
import { account, loadGroup, loadKudos, markKudosSeen } from '../account.js';
import { loadCurriculumIndex } from '../data.js';
import { avatar } from './controls.js';
import * as missions from '../realm/missions.js';
import { startReview, mistakeCount } from '../review.js';

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

/** A progress ring: today's answers towards the daily goal. */
export function goalRing(done, goal, size = 92) {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, done / goal);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', `goal-ring${frac >= 1 ? ' done' : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<circle class="goal-track" cx="${size / 2}" cy="${size / 2}" r="${r}"/>`
    + `<circle class="goal-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
  return h('div.goal-ring-wrap', {}, svg, h('div.goal-ring-label', {}, h('b', {}, Math.min(done, goal)), h('small', {}, `/ ${goal}`)));
}

/** The last 7 days as dots: filled when that day's goal was met. */
export function weekDots(log, goal) {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const n = log[dayKey(d)] || 0;
    out.push(h('span.day-dot', { class: n >= goal ? 'hit' : n > 0 ? 'some' : '', title: `${d.toLocaleDateString(undefined, { weekday: 'long' })}: ${n} answers` },
      d.toLocaleDateString(undefined, { weekday: 'narrow' })));
  }
  return h('div.day-dots', {}, out);
}

/** Show stickers the student hasn't seen yet, then mark them seen. */
async function showNewKudos() {
  let list;
  try { list = (await loadKudos()).filter((k) => !k.seen); } catch { return; }
  if (!list.length) return;
  burst();
  modal(list.length === 1 ? 'You got a sticker!' : `You got ${list.length} stickers!`,
    h('div.kudos-pop', {}, list.slice(0, 5).map((k) => h('div.kudos-item', {},
      h('span.kudos-icon', { 'aria-hidden': 'true' }, k.icon),
      h('div', {}, k.message && h('p.kudos-msg', {}, `“${k.message}”`), h('small.muted', {}, `From ${k.from || 'your teacher'}`))))),
    h('p.muted.small', {}, 'Your stickers stay on your Me page.'));
  markKudosSeen();
}

export function renderHub(app) {
  const hero = CHARACTERS[profile.character];
  const me = account.student;
  const today = h('ul.today-list');
  const board = h('div.home-board', {}, h('p.muted', {}, 'Loading your class…'));

  function goalHead() {
    const g = dailyGoal();
    const left = Math.max(0, g.goal - g.done);
    return h('div.goal-head', {},
      goalRing(g.done, g.goal),
      h('div.goal-text', {},
        h('p.eyebrow', {}, 'Daily goal'),
        h('h3', {}, g.hitToday ? `Done for today! 🔥 ${g.streak}-day streak` : g.streak ? `${left} more to keep your ${g.streak}-day streak` : `Answer ${left} question${left === 1 ? '' : 's'} to start a streak`),
        weekDots(g.log, g.goal),
        h('small.muted', {}, g.freezes ? `🧊 ${g.freezes} streak freeze${g.freezes === 1 ? '' : 's'} ready` : 'Keep a 7-day streak to earn a streak freeze 🧊', g.best > 1 ? ` · Best: ${g.best} days` : '')));
  }

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

    // 2b. Mistakes to fix.
    const mistakes = mistakeCount();
    if (mistakes) {
      items.push(row({
        icon: '🔁', title: `Fix ${Math.min(mistakes, 10)} mistake${mistakes === 1 ? '' : 's'}`,
        text: `Questions you got wrong come back until you get them right. ${profile.fixed ? `${profile.fixed} fixed so far.` : ''}`,
        cta: 'Fix', onclick: () => startReview(),
      }));
    }

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
          goalHead(),
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
  showNewKudos();
  const timer = setInterval(drawBoard, REFRESH_MS);
  return () => clearInterval(timer);
}

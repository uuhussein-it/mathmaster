/**
 * Choose your level: grade and track. This decides the student's group
 * (e.g. "Grade 11 · Advanced") and the course they practise by default.
 */
import { h, mount, prefs } from '../ui.js';
import { account, saveLevel } from '../account.js';
import { go } from '../router.js';

const TRACKS = [
  { id: 'asp', name: 'ASP', full: 'Advanced Science Program', icon: '🚀' },
  { id: 'advanced', name: 'Advanced', full: 'Advanced Mathematics', icon: '📐' },
  { id: 'general', name: 'General', full: 'General Mathematics', icon: '📘' },
];

export function renderLevel(app) {
  const s = account.student || {};
  let grade = s.grade || null;
  let track = s.track || null;
  let error = '';
  let busy = false;

  async function save() {
    busy = true;
    draw();
    try {
      await saveLevel(grade, track);
      // Start the curriculum screen on the student's own course.
      prefs.set('curriculum', { ...prefs.get('curriculum', {}), grade, track });
      go('hub');
    } catch (e) {
      error = e.message;
      busy = false;
      draw();
    }
  }

  function draw() {
    mount(app,
      h('section.level', {},
        h('div.select-head', {},
          h('p.eyebrow', {}, 'Last step'),
          h('h1.display', {}, 'Choose your level'),
          h('p.lede', {}, 'You’ll join the group for your grade and track, and play with them. You can change this later.')),
        h('div.panel', {},
          h('h3.sub-title', {}, 'Grade'),
          h('div.level-grades', {}, [9, 10, 11, 12].map((g) =>
            h('button.level-grade', { type: 'button', 'aria-pressed': String(grade === g), onclick: () => { grade = g; draw(); } },
              h('small', {}, 'Grade'), h('b', {}, g)))),
          h('h3.sub-title', {}, 'Track'),
          h('div.level-tracks', {}, TRACKS.map((t) =>
            h('button.level-track', { type: 'button', 'aria-pressed': String(track === t.id), onclick: () => { track = t.id; draw(); } },
              h('span.level-icon', { 'aria-hidden': 'true' }, t.icon),
              h('b', {}, t.name), h('span.muted', {}, t.full)))),
          error && h('p.auth-error', { role: 'alert' }, error),
          h('div.level-foot', {},
            grade && track && h('p', {}, 'Your group: ', h('b', {}, `Grade ${grade} · ${TRACKS.find((t) => t.id === track).name}`)),
            h('button.btn.primary.lg', { type: 'button', disabled: !grade || !track || busy, onclick: save },
              busy ? 'Saving…' : 'Join my group')))));
  }

  draw();
}

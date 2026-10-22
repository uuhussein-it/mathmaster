/**
 * Setup-screen controls shared by the Curriculum and SAT screens.
 */
import { h } from '../ui.js';
import { CHARACTERS } from '../characters.js';
import { account, loadGroup } from '../account.js';

/** A labelled row of single-choice chips. options: [{ value, label, badge?, disabled? }] */
export function chips(label, options, current, onPick) {
  return h('fieldset.filter', {},
    h('legend', {}, label),
    h('div.chips', { role: 'radiogroup' }, options.map((o) =>
      h('button.chip', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(o.value === current),
        disabled: o.disabled,
        onclick: () => onPick(o.value),
      }, o.label, o.badge && h('span.chip-badge', {}, o.badge)))));
}

/** A large selectable card (modes, formats). */
export function modeCard({ icon, title, text, pressed, onclick }) {
  return h('button.mode-card', { type: 'button', 'aria-pressed': String(pressed), onclick },
    h('span.mode-icon', { 'aria-hidden': 'true' }, icon), h('b', {}, title), h('p', {}, text));
}

/** Selection key of one lesson inside a topic. */
export const lessonKey = (topic, lesson) => `${topic.id}/${lesson.id}`;

/**
 * Topics with their lessons. Ticking a topic picks all its lessons; "Lessons"
 * opens the topic so single lessons can be picked. `selected` is a Set of
 * lessonKey()s and `open` a Set of expanded topic ids, both mutated in place.
 * A topic with a single lesson has nothing to open.
 */
export function lessonPicker(topics, selected, open, onChange, mark = (_, i) => i + 1) {
  return h('div.lesson-topics', {}, topics.map((t, i) => {
    const keys = t.lessons.map((l) => lessonKey(t, l));
    const picked = keys.filter((k) => selected.has(k)).length;
    const all = picked === keys.length;
    const expanded = open.has(t.id) && t.lessons.length > 1;
    const box = h('input', {
      type: 'checkbox', checked: all, 'aria-label': `All of ${t.name}`,
      onchange: () => { keys.forEach((k) => (all ? selected.delete(k) : selected.add(k))); onChange(); },
    });
    box.indeterminate = picked > 0 && !all;
    return h('div.lesson-topic', { class: `${all ? 'on' : picked ? 'some' : ''} ${expanded ? 'open' : ''}` },
      h('div.lesson-topic-head', {},
        h('label.topic', { class: picked ? 'on' : '' },
          box,
          h('span.topic-num', { 'aria-hidden': 'true' }, mark(t, i)),
          h('span.topic-name', {}, t.name),
          h('span.topic-count', {}, all ? `${t.count} Q` : `${picked}/${keys.length} lessons`)),
        t.lessons.length > 1 && h('button.lesson-toggle', {
          type: 'button', 'aria-expanded': String(expanded),
          onclick: () => { expanded ? open.delete(t.id) : open.add(t.id); onChange(); },
        }, `${keys.length} lessons`, h('span.lesson-caret', { 'aria-hidden': 'true' }, '▾'))),
      expanded && h('ul.lesson-list', {}, t.lessons.map((l) => {
        const k = lessonKey(t, l);
        return h('li', {}, h('label.lesson', { class: selected.has(k) ? 'on' : '' },
          h('input', {
            type: 'checkbox', checked: selected.has(k),
            onchange: (e) => { e.target.checked ? selected.add(k) : selected.delete(k); onChange(); },
          }),
          h('span.lesson-ref', {}, l.ref ?? l.id),
          h('span.lesson-name', {}, l.name),
          h('span.topic-count', {}, `${l.count} Q`)));
      })));
  }));
}

/** A classmate's portrait (or initial), lit when they're online. */
export function avatar(m) {
  const c = CHARACTERS[m.character];
  return h('span.avatar', { class: m.online ? 'online' : '', title: `${m.name}${m.online ? ' · online' : ''}` },
    c ? h('img', { src: c.portrait, alt: '' }) : h('span.avatar-letter', {}, m.name[0] || '?'));
}

/** The top 10 of a loaded group. */
export function boardList(g) {
  const me = account.student;
  return g.leaderboard.length
    ? h('ol.board', {}, g.leaderboard.slice(0, 10).map((m) =>
      h('li', { class: m.id === me?.id ? 'me' : '' },
        h('span.board-rank', {}, m.rank <= 3 ? ['🥇', '🥈', '🥉'][m.rank - 1] : m.rank),
        avatar(m),
        h('span.board-name', {}, m.name, m.id === me?.id && h('small', {}, ' (you)')),
        h('span.board-level', {}, `Lv ${m.level}`),
        h('span.board-score', {}, m.score.toLocaleString()))))
    : h('p.muted', {}, 'Answer questions to put your group on the board.');
}

/** The student's group leaderboard as a panel that loads itself (below the setup controls). */
export function groupBoard() {
  const panel = h('section.panel.group-board', { 'aria-label': 'Leaderboard' },
    h('h3', {}, '🏆 Leaderboard'), h('p.muted', {}, 'Loading your group…'));
  const id = account.student?.group?.id;
  if (!id) return null;
  loadGroup(id).then((g) => panel.replaceChildren(h('h3', {}, `🏆 Leaderboard · ${g.name}`), boardList(g)))
    .catch(() => panel.lastChild.replaceWith(h('p.muted', {}, 'The leaderboard couldn’t load.')));
  return panel;
}

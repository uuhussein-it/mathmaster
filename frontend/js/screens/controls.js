/**
 * Setup-screen controls shared by the Curriculum and SAT screens.
 */
import { h } from '../ui.js';

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

/**
 * Checkbox grid of topics. `selected` is a Set of ids that is mutated in place;
 * `onChange` re-renders. topics: [{ id, name, count }]
 */
export function topicGrid(topics, selected, onChange, mark = (_, i) => i + 1) {
  return h('div.topic-grid', {}, topics.map((t, i) =>
    h('label.topic', { class: selected.has(t.id) ? 'on' : '' },
      h('input', {
        type: 'checkbox', checked: selected.has(t.id),
        onchange: (e) => { e.target.checked ? selected.add(t.id) : selected.delete(t.id); onChange(); },
      }),
      h('span.topic-num', { 'aria-hidden': 'true' }, mark(t, i)),
      h('span.topic-name', {}, t.name),
      h('span.topic-count', {}, `${t.count} Q`))));
}

/** "Select all" / "Clear all" toggle for a topic Set. */
export function selectAllButton(topics, selected, onChange) {
  const all = selected.size === topics.length;
  return h('button.btn.ghost.sm', {
    onclick: () => {
      selected.clear();
      if (!all) topics.forEach((t) => selected.add(t.id));
      onChange();
    },
  }, all ? 'Clear all' : 'Select all');
}

/** Selection key of one lesson inside a topic. */
export const lessonKey = (topic, lesson) => `${topic.id}/${lesson.id}`;

/**
 * Topics with their lessons. Ticking a topic picks all its lessons; "Lessons"
 * opens the topic so single lessons can be picked. `selected` is a Set of
 * lessonKey()s and `open` a Set of expanded topic ids, both mutated in place.
 */
export function lessonPicker(topics, selected, open, onChange) {
  return h('div.lesson-topics', {}, topics.map((t, i) => {
    const keys = t.lessons.map((l) => lessonKey(t, l));
    const picked = keys.filter((k) => selected.has(k)).length;
    const all = picked === keys.length;
    const expanded = open.has(t.id);
    const box = h('input', {
      type: 'checkbox', checked: all, 'aria-label': `All of ${t.name}`,
      onchange: () => { keys.forEach((k) => (all ? selected.delete(k) : selected.add(k))); onChange(); },
    });
    box.indeterminate = picked > 0 && !all;
    return h('div.lesson-topic', { class: `${all ? 'on' : picked ? 'some' : ''} ${expanded ? 'open' : ''}` },
      h('div.lesson-topic-head', {},
        h('label.topic', { class: picked ? 'on' : '' },
          box,
          h('span.topic-num', { 'aria-hidden': 'true' }, i + 1),
          h('span.topic-name', {}, t.name),
          h('span.topic-count', {}, all ? `${t.count} Q` : `${picked}/${keys.length} lessons`)),
        h('button.lesson-toggle', {
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
          h('span.lesson-ref', {}, l.id === 'extra' ? '✎' : l.id),
          h('span.lesson-name', {}, l.name),
          h('span.topic-count', {}, `${l.count} Q`)));
      })));
  }));
}

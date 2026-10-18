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

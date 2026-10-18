/**
 * Character selection: pick a hero and enter a name.
 */
import { h, mount } from '../ui.js';
import { CHARACTERS } from '../characters.js';
import { profile, chooseHero } from '../state.js';
import { go } from '../router.js';

export function renderSelect(app) {
  let chosen = profile.character || null;
  const nameInput = h('input#hero-name', { type: 'text', maxlength: 20, placeholder: 'Your name', autocomplete: 'nickname', value: profile.name || '' });
  const startBtn = h('button.btn.primary.lg', { disabled: !chosen, onclick: start }, 'Begin your quest');

  function start() {
    if (!chosen) return;
    chooseHero(chosen, nameInput.value);
    go('hub');
  }

  const cards = Object.values(CHARACTERS).map((c) => {
    const card = h('button.hero-card', {
      type: 'button',
      style: { '--c': c.color },
      'aria-pressed': String(chosen === c.id),
      onclick: () => {
        chosen = c.id;
        cards.forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.id === c.id)));
        document.documentElement.style.setProperty('--hero', c.color);
        startBtn.disabled = false;
      },
    },
    h('div.hero-art', {}, h('img', { src: c.image, alt: `${c.name} character art`, loading: 'lazy' })),
    h('div.hero-body', {},
      h('h3', {}, c.name),
      h('p.hero-title', {}, c.title),
      h('p.hero-blurb', {}, c.blurb),
      h('ul.abilities', {},
        h('li', {}, h('span.tag.passive', {}, 'Passive'), h('div', {}, h('b', {}, c.passive.name), h('p', {}, c.passive.text))),
        h('li', {}, h('span.tag.skill', {}, 'Skill'), h('div', {}, h('b', {}, `${c.skill.icon} ${c.skill.name}`), h('p', {}, c.skill.text))))),
    h('span.hero-check', { 'aria-hidden': 'true' }, '✓'));
    card.dataset.id = c.id;
    return card;
  });

  nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && start());

  mount(app,
    h('section.select', {},
      h('div.select-head', {},
        h('img.select-crest', { src: 'assets/favicon.svg', alt: '' }),
        h('p.eyebrow', {}, 'QuestLearn Academy'),
        h('h1.display', {}, 'Choose your hero'),
        h('p.lede', {}, 'Every hero earns XP and levels up. Each one brings a different power to your practice.')),
      h('div.hero-grid', {}, cards),
      h('div.select-foot.panel', {},
        h('label', { for: 'hero-name' }, 'What should we call you?'),
        h('div.select-row', {}, nameInput, startBtn))));
}

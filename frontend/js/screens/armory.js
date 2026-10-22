/**
 * The armory: swords, armor and charms that unlock as the student levels up,
 * wins arena fights and builds answer streaks. Equipped gear shows on the hero
 * here and in arena fights, and gives a small arena bonus.
 */
import { h, mount, toast } from '../ui.js';
import { CHARACTERS } from '../characters.js';
import { profile } from '../state.js';
import { go } from '../router.js';
import { adminApi as api } from '../account.js';
import { drawFighter } from '../fighter-art.js';

const SLOTS = [['weapon', '⚔️ Weapons'], ['armor', '🛡️ Armor'], ['charm', '✨ Charms']];
const SEEN_KEY = 'ql-gear-seen';

/** Items unlocked since the student last opened the armory (for a hub toast). */
export async function newGear() {
  const data = await api('api/gear');
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || 'null'); } catch { /* private mode */ }
  const open = data.items.filter((i) => i.unlocked).map((i) => i.id);
  if (!seen) {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(open)); } catch { /* private mode */ }
    return [];
  }
  return data.items.filter((i) => i.unlocked && !seen.includes(i.id));
}

export function renderArmory(app) {
  let data = null;
  let error = '';
  let stopped = false;
  let raf = 0;
  const canvas = h('canvas.armory-canvas', { width: 300, height: 320, 'aria-label': 'Your hero with gear' });
  const ctx = canvas.getContext('2d');

  function looks() {
    const by = Object.fromEntries(data.items.map((i) => [i.id, i]));
    return Object.fromEntries(Object.entries(data.equipped).map(([slot, id]) => [slot, { id, ...by[id].look }]));
  }

  function preview(now) {
    if (stopped) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const glow = ctx.createRadialGradient(150, 200, 10, 150, 200, 150);
    glow.addColorStop(0, 'rgba(230,192,106,0.22)');
    glow.addColorStop(1, 'rgba(230,192,106,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (data) {
      drawFighter(ctx, {
        x: 140, y: 0, vx: 0, facing: 1, character: profile.character, skin: 'base', hp: 1,
        action: null, block: false, stun: false, shield: false, gear: looks(),
      }, { now, floor: 290 });
    }
    raf = requestAnimationFrame(preview);
  }

  async function load() {
    try {
      data = await api('api/gear');
      error = '';
      try { localStorage.setItem(SEEN_KEY, JSON.stringify(data.items.filter((i) => i.unlocked).map((i) => i.id))); } catch { /* private mode */ }
    } catch (e) {
      error = e.message;
    }
    draw();
  }

  async function equip(item) {
    try {
      data = await api('api/gear', { method: 'PUT', body: { slot: item.slot, item: item.id } });
      toast('Equipped', `${item.icon} ${item.name}`, { icon: '🛡️', tone: 'success' });
    } catch (e) {
      toast('Armory', e.message, { icon: '⚠️', tone: 'danger' });
    }
    draw();
  }

  function itemCard(item) {
    const [have, need] = item.progress;
    return h('li', { class: `armory-item ${item.unlocked ? '' : 'locked'} ${item.equipped ? 'on' : ''}` },
      h('span.armory-icon', { 'aria-hidden': 'true' }, item.unlocked ? item.icon : '🔒'),
      h('div.armory-body', {},
        h('b', {}, item.name),
        item.bonus && h('span.armory-bonus', {}, item.bonus),
        h('p.muted.small', {}, item.text),
        !item.unlocked && h('div.armory-need', {},
          h('span.small', {}, `${item.need} (${have}/${need})`),
          h('div.arena-stat-bar', {}, h('i', { style: { width: `${Math.round((have / need) * 100)}%` } })))),
      item.equipped
        ? h('span.armory-worn', {}, 'Equipped')
        : h('button.btn.sm', { disabled: !item.unlocked, onclick: () => equip(item) }, item.unlocked ? 'Equip' : 'Locked'));
  }

  function draw() {
    if (stopped) return;
    if (!data) {
      mount(app, h('section.armory', {}, h('p.muted', {}, error || 'Opening the armory…')));
      return;
    }
    const hero = CHARACTERS[profile.character] || CHARACTERS.warrior;
    const worn = data.items.filter((i) => i.equipped);
    const b = data.bonus;
    mount(app,
      h('section.armory', {},
        h('div.arena-head', {},
          h('div', {}, h('p.eyebrow', {}, 'Armory'), h('h1.display', {}, `Gear up, ${profile.name || hero.name}`)),
          h('button.btn.ghost.sm', { onclick: () => go('hub') }, '← Back')),
        error && h('p.auth-error', {}, error),
        h('div.armory-grid', {},
          h('section.panel.armory-hero', {},
            canvas,
            h('ul.armory-worn-list', {}, worn.map((i) => h('li', {}, h('span', { 'aria-hidden': 'true' }, i.icon), ` ${i.name}`))),
            h('p.muted.small', {},
              `Level ${data.progress.level} · ${data.progress.wins} arena wins · best streak ${data.progress.streak}`),
            (b.attack || b.hp || b.charge) ? h('p.armory-total', {},
              'In the arena: ', [b.attack && `+${b.attack} attack`, b.hp && `+${b.hp} health`, b.charge && `+${b.charge} special`]
                .filter(Boolean).join(' · ')) : null,
            h('button.btn.primary', { onclick: () => go('arena') }, '🥊 Go to the arena')),
          h('div.armory-slots', {}, SLOTS.map(([slot, title]) => h('section.panel', {},
            h('h3.sub-title', {}, title),
            h('ul.armory-list', {}, data.items.filter((i) => i.slot === slot).map(itemCard)))))),
        h('p.muted.small.arena-rules', {},
          'Answer questions to level up, win arena fights and keep your answer streaks going to unlock new gear. ',
          'Arena bonuses are small, and fights still cap the stronger fighter at 125% of the other, so practice matters most.')));
  }

  draw();
  load();
  raf = requestAnimationFrame(preview);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}

/**
 * The armory: swords, armor and charms that unlock as the student levels up,
 * wins arena fights and builds answer streaks. Equipped gear shows on the hero
 * here and in arena fights, and gives a small arena bonus. Students also pick
 * their look here: body colour, hat, super power, and their race car.
 */
import { h, mount, toast } from '../ui.js';
import { CHARACTERS } from '../characters.js';
import { profile } from '../state.js';
import { go } from '../router.js';
import { adminApi as api } from '../account.js';
import { drawFighter } from '../fighter-art.js';
import { POWERS, drawPower } from '../games/powers.js';
import { drawCar } from '../games/race.js';
import { W } from '../games/common.js';

const HATS = { none: ['✖️', 'None'], headband: ['🎗️', 'Headband'], cap: ['🧢', 'Cap'], crown: ['👑', 'Crown'], horns: ['😈', 'Horns'], wizard: ['🧙', 'Wizard hat'] };
const CAR_STYLES = { sport: ['🏎️', 'Sport'], kart: ['🛺', 'Kart'], truck: ['🚚', 'Monster truck'] };

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
  const carCanvas = h('canvas.armory-car', { width: 300, height: 170, 'aria-label': 'Your race car' });
  const carCtx = carCanvas.getContext('2d');
  let effect = null; // a super power being tried out on the preview

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
        action: null, block: false, stun: false, shield: false, gear: looks(), look: data.look,
      }, { now, floor: 290 });
      if (effect && !drawPower(ctx, effect, now)) effect = null;
      drawCarPreview(now);
    }
    raf = requestAnimationFrame(preview);
  }

  function drawCarPreview(now) {
    const hero = CHARACTERS[profile.character] || CHARACTERS.warrior;
    carCtx.clearRect(0, 0, carCanvas.width, carCanvas.height);
    carCtx.fillStyle = '#45455a';
    carCtx.fillRect(0, 110, carCanvas.width, 60);
    carCtx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let x = -((now / 4) % 60); x < carCanvas.width; x += 60) carCtx.fillRect(x, 150, 30, 5);
    carCtx.save();
    carCtx.translate(carCanvas.width / 2 - W / 2, 0);
    drawCar(carCtx, { y: 150, half: 100, k: 0.9 }, { x: 0 }, data.look.car_color || data.look.body || hero.color, now / 1000, null, data.look);
    carCtx.restore();
  }

  async function setLook(change) {
    const before = data.look;
    data.look = { ...data.look, ...change };
    draw();
    try {
      data.look = (await api('api/gear/look', { method: 'PUT', body: change })).look;
    } catch (e) {
      data.look = before;
      toast('Armory', e.message, { icon: '⚠️', tone: 'danger' });
    }
    draw();
  }

  function tryPower(id) {
    effect = { power: id, from: { x: 146, y: 124 }, to: { x: 262, y: 190 }, start: performance.now() };
  }

  function swatches(key, heroColor) {
    return h('div.look-swatches', { role: 'radiogroup', 'aria-label': key === 'body' ? 'Body colour' : 'Car colour' },
      data.look_options.colors.map((c) => h('button.look-swatch', {
        type: 'button', role: 'radio', 'aria-checked': String(data.look[key] === c),
        class: data.look[key] === c ? 'on' : '', title: c ? c : 'Hero colour',
        style: { background: c || heroColor }, onclick: () => setLook({ [key]: c }),
      }, c ? '' : '★')));
  }

  function choices(key, options) {
    return h('div.look-choices', { role: 'radiogroup' }, Object.entries(options).map(([id, [icon, name]]) =>
      h('button.look-choice', {
        type: 'button', role: 'radio', 'aria-checked': String(data.look[key] === id),
        class: data.look[key] === id ? 'on' : '', onclick: () => setLook({ [key]: id }),
      }, h('span', { 'aria-hidden': 'true' }, icon), name)));
  }

  function looksPanel() {
    const hero = CHARACTERS[profile.character] || CHARACTERS.warrior;
    return h('section.panel.armory-looks', {},
      h('h3.sub-title', {}, '🎨 Customize your hero'),
      h('p.look-label', {}, 'Body colour'), swatches('body', hero.color),
      h('p.look-label', {}, 'Hat'), choices('hat', HATS),
      h('h3.sub-title', {}, '💥 Super power'),
      h('p.muted.small', {}, 'In a fight, answer the ⚡ power question before your rival to fire it. In a race, every 3rd right answer fires it.'),
      h('ul.look-powers', {}, data.look_options.powers.map((p) => {
        const on = data.look.power === p.id;
        return h('li', { class: `${on ? 'on' : ''} ${p.unlocked ? '' : 'locked'}` },
          h('span.look-power-icon', { 'aria-hidden': 'true' }, p.unlocked ? p.icon : '🔒'),
          h('b', {}, p.name),
          h('span.muted.small', {}, p.unlocked ? (on ? 'Your power' : 'Unlocked') : `Reach level ${p.level}`),
          h('div.look-power-actions', {},
            h('button.btn.ghost.sm', { onclick: () => tryPower(p.id) }, '▶ Try'),
            !on && h('button.btn.sm', { disabled: !p.unlocked, onclick: () => setLook({ power: p.id }) }, 'Choose')));
      })),
      h('h3.sub-title', {}, '🏎️ Your race car'),
      carCanvas,
      h('p.look-label', {}, 'Colour'), swatches('car_color', data.look.body || hero.color),
      h('p.look-label', {}, 'Style'), choices('car_style', CAR_STYLES));
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
          h('div.armory-slots', {}, looksPanel(), SLOTS.map(([slot, title]) => h('section.panel', {},
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

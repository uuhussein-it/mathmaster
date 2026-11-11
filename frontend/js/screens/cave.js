/**
 * The Cave of Equations: a retro platformer. Aladdin is trapped in a cave and
 * must cross three stages (Term 1, Term 2, Term 3 + SAT) by answering
 * questions at Number Gates, sand-timer doors and, at the end, by casting
 * Number Spells at the sorcerer Zarkan.
 *
 * This screen owns everything outside the game world: the top bar (hearts,
 * XP, coins, progress), questions, the merchant's shop, touch controls, the
 * stage picker and full screen. The Phaser scenes live in cave/scene.js.
 */
import { h, mount, toast, burst, questionBody, answerLabel, LETTERS } from '../ui.js';
import { go } from '../router.js';
import { profile, save, xpToNext, recordAnswer, addXp, awardBadge } from '../state.js';
import { account } from '../account.js';
import { loadCurriculumIndex, loadCourse, loadSat } from '../data.js';
import { loadPhaser, startGame } from '../realm/phaser.js';
import { introScene, levelScene, VIEW } from '../cave/scene.js';
import * as art from '../cave/art.js';
import { sfx, isMuted, setMuted } from '../realm/sfx.js';

const MAX_HEARTS = 3;
const SHOP = [
  { id: 'carpet', name: 'Magic Carpet', icon: '🧞', price: 40, text: 'Fly for 6 seconds over a hard part. Press C (or the Carpet button).' },
  { id: 'ring', name: 'Ring of Wisdom', icon: '💍', price: 30, text: 'Removes two wrong answers from one question.' },
];
const SKIN_PRICE = 100;
const STAGE_REWARD = { 1: 40, 2: 60, 3: 100 };

/** The cave save, kept in the profile so it syncs with the account. */
function cave() {
  const c = (profile.cave ||= {});
  c.unlocked ||= 1;
  c.cleared ||= [];
  c.coins ||= 0;
  c.carpets ||= 0;
  c.rings ||= 0;
  c.skins ||= [];
  c.stars ||= {};
  const mine = profile.character || 'sage';
  if (!c.skins.includes(mine)) c.skins.push(mine);
  if (!c.skin || !c.skins.includes(c.skin)) c.skin = mine;
  return c;
}

function pixel(c, height) {
  const el = h('canvas.pixel', { width: c.width, height: c.height, style: { height: `${height}px`, width: `${(height * c.width) / c.height}px` }, 'aria-hidden': 'true' });
  el.getContext('2d').drawImage(c, 0, 0);
  return el;
}

// ------------------------------------------------------------------ questions
const pools = {};
async function questionPool(kind, stage) {
  const key = kind === 'spell' ? 'sat' : `term${stage}`;
  if (pools[key]) return pools[key];
  const usable = (q) => (q.type ?? 'mcq') === 'mcq' && q.answer != null && q.options?.length >= 2;
  let list = [];
  if (key === 'sat') {
    const sat = await loadSat();
    list = sat.topics.filter((t) => t.section === 'math').flatMap((t) => t.questions.filter(usable)
      .map((q) => ({ ...q, topicKey: `sat:${t.id}:${q.lesson}`, topicName: t.name })));
  } else {
    const index = await loadCurriculumIndex();
    const me = account.student;
    const term = stage;
    // The student's own course for this term; when that term isn't in the bank yet,
    // their latest term so far (never another grade's questions or the SAT).
    const mine = (t) => index.courses.filter((c) => c.grade === me?.grade && c.track === me?.track && c.term === t);
    const sameGrade = (t) => index.courses.filter((c) => c.grade === me?.grade && c.term === t);
    let courses = [];
    for (let t = term; t >= 1 && !courses.length; t -= 1) courses = mine(t);
    for (let t = term; t >= 1 && !courses.length; t -= 1) courses = sameGrade(t);
    if (!courses.length) courses = index.courses.filter((c) => c.term <= term).slice(0, 2);
    const loaded = await Promise.all(courses.map((c) => loadCourse(c.id)));
    list = loaded.flatMap((course) => course.topics.flatMap((t) => t.questions.filter(usable)
      .map((q) => ({ ...q, topicKey: `${course.id}:${t.id}:${q.lesson}`, topicName: t.name }))));
    if (!list.length) return questionPool('spell', stage); // no course questions yet: use SAT math
  }
  pools[key] = { list, used: new Set() };
  return pools[key];
}

function pick(pool) {
  let left = pool.list.filter((q) => !pool.used.has(q.ref || q.id));
  if (!left.length) { pool.used.clear(); left = pool.list; }
  const q = left[Math.floor(Math.random() * left.length)];
  pool.used.add(q.ref || q.id);
  return q;
}

// ------------------------------------------------------------------ screen
export function renderCave(app) {
  const save0 = cave();
  let alive = true;
  let game = null;
  let stage = Math.min(save0.unlocked, 3);
  let hearts = MAX_HEARTS;
  let progress = {};
  let overlayState = null;   // what the overlay shows
  let isFull = false;
  const touch = { left: false, right: false, up: false, down: false, jump: false, act: false, carpet: false };
  const level = () => game?.scene?.getScene('level');

  const hud = h('div.cave-hud');
  const stageEl = h('div.cave-stage', {}, h('p.cave-loading', {}, 'Lighting the torches…'));
  const overlay = h('div.cave-overlay', { hidden: true });
  const controls = h('div.cave-controls');
  const fsBtn = h('button.cave-fs-btn', { type: 'button', onclick: () => toggleFull() });
  const soundBtn = h('button.cave-sound-btn', { type: 'button', onclick: () => { setMuted(!isMuted()); drawSoundBtn(); if (!isMuted()) sfx('coin'); } });
  const drawSoundBtn = () => { soundBtn.textContent = isMuted() ? '🔇' : '🔊'; soundBtn.setAttribute('aria-label', isMuted() ? 'Sound off' : 'Sound on'); };
  const wrap = h('div.cave-wrap', {}, h('div.cave-screen', {}, stageEl, hud, overlay, h('div.game-corner', {}, soundBtn, fsBtn)), controls);
  const picker = h('div.cave-picker');
  const heroes = h('div.panel.cave-heroes');

  mount(app,
    h('section.cave', {},
      h('div.crumbs', {}, h('button.link', { onclick: () => go('hub') }, '← Hub'), h('span', {}, 'Cave of Equations')),
      h('div.cave-top', {},
        h('div', {},
          h('h1.display', {}, 'Cave of Equations'),
          h('p.muted', {}, 'Aladdin is trapped. Cross the cave with what you hold in your mind.')),
        picker),
      wrap,
      h('p.cave-rotate', {}, '📱 Turn your phone sideways or tap Full screen for a bigger cave.'),
      h('div.cave-info', {},
        heroes,
        h('div.panel.cave-help', {},
          h('h3', {}, 'How to play'),
          h('ul', {},
            h('li', {}, h('b', {}, 'Move: '), '← → or A D. ', h('b', {}, 'Jump: '), 'Space (or ↑ / W).'),
            h('li', {}, h('b', {}, 'Number Gates and doors: '), 'stand next to them and press E (or Enter) to answer.'),
            h('li', {}, h('b', {}, 'Hearts: '), 'you have 3. Enemies, spikes, lava and wrong answers cost one. A right answer gives one back.'),
            h('li', {}, h('b', {}, 'Coins: '), 'collect them and trade at the Merchant’s tent (press E there).'),
            h('li', {}, h('b', {}, 'Stage 1 → 2 → 3: '), 'Term 1, Term 2, then Term 3 and the SAT. Clearing Stage 1 teaches Aladdin to double jump.'),
            h('li', {}, h('b', {}, 'The sorcerer Zarkan: '), 'stand on a glowing rune and press E to cast a Number Spell. Five right answers break his shield.')),
          h('button.btn.ghost.sm', { onclick: () => playIntro() }, '🎬 Watch the intro again')))));

  // ---------------------------------------------------------------- drawing
  function drawPicker() {
    const c = cave();
    picker.replaceChildren(...[1, 2, 3].map((n) => {
      const open = n <= c.unlocked;
      const done = c.cleared.includes(n);
      const stars = c.stars[n] || 0;
      return h('button.chip', {
        type: 'button', disabled: !open, 'aria-pressed': String(n === stage),
        title: art.STAGE_STYLE[n].name,
        onclick: () => play(n),
      }, `${done ? '✅' : open ? '🔓' : '🔒'} Stage ${n}`, done && h('span.cave-chip-stars', {}, '★'.repeat(stars) + '☆'.repeat(3 - stars)));
    }));
  }

  function drawHud() {
    const c = cave();
    const need = xpToNext(profile.level);
    const parts = [`Stage ${stage}`];
    if (progress.coinsTotal) parts.push(`🪙 ${progress.coins}/${progress.coinsTotal}`);
    if (progress.gatesTotal) parts.push(`Gates ${progress.gates}/${progress.gatesTotal}`);
    if (progress.doorsTotal) parts.push(`Doors ${progress.doors}/${progress.doorsTotal}`);
    if (progress.shields != null) parts.push(`Shield ${'◆'.repeat(progress.shields)}${'◇'.repeat(5 - progress.shields)}`);
    hud.replaceChildren(
      h('div.cave-hearts', { 'aria-label': `${hearts} of ${MAX_HEARTS} hearts` },
        ...Array.from({ length: MAX_HEARTS }, (_, i) => pixel(art.heartSprite(i < hearts), 14))),
      h('div.cave-xp', { title: `Level ${profile.level}` },
        h('span', {}, `LV ${profile.level}`),
        h('div.cave-xp-bar', {}, h('i', { style: { width: `${Math.min(100, (profile.xp / need) * 100)}%` } }))),
      h('span.cave-coins', { title: 'Coins' }, pixel(art.coinFrames()[0], 12), ` ${c.coins}`),
      h('span.cave-items', {}, `🧞 ${c.carpets}`, progress.carpet ? ` (${progress.carpet}s)` : '', `  💍 ${c.rings}`),
      h('span.cave-progress', {}, parts.join(' · ')));
  }

  function drawHeroes() {
    const c = cave();
    heroes.replaceChildren(
      h('h3', {}, 'Your heroes'),
      h('p.muted', {}, 'Your class look is free. Buy the others at the Merchant’s tent inside the cave.'),
      h('div.cave-hero-list', {}, Object.entries(art.SKINS).map(([id, s]) => {
        const owned = c.skins.includes(id);
        return h('div.cave-hero', { class: c.skin === id ? 'on' : '' },
          pixel(art.heroPreview(id), 72),
          h('b', {}, s.title),
          h('small', {}, s.blurb),
          owned
            ? h('button.btn.sm', { type: 'button', disabled: c.skin === id, onclick: () => wear(id) }, c.skin === id ? 'Wearing' : 'Wear')
            : h('small.cave-price', {}, `🪙 ${SKIN_PRICE} at the Merchant`));
      })));
  }

  function wear(id) {
    const c = cave();
    if (!c.skins.includes(id)) return;
    c.skin = id;
    save();
    level()?.setSkin?.(id);
    drawHeroes();
    if (overlayState?.kind === 'shop') drawShop();
  }

  // ---------------------------------------------------------------- touch controls
  function drawControls() {
    const btn = (labelText, key, cls = '') => {
      const b = h(`button.cave-pad${cls}`, { type: 'button', 'aria-label': key });
      b.textContent = labelText;
      const on = (v) => (e) => { e.preventDefault(); touch[key] = v; b.classList.toggle('down', v); };
      b.addEventListener('pointerdown', on(true));
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => b.addEventListener(ev, on(false)));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      return b;
    };
    controls.replaceChildren(
      h('div.cave-pad-group', {}, btn('◀', 'left'), btn('▶', 'right'), btn('▼', 'down', '.small')),
      h('div.cave-pad-group', {}, btn('CARPET', 'carpet', '.small'), btn('E', 'act'), btn('JUMP', 'jump', '.big')));
  }

  // ---------------------------------------------------------------- overlay
  function hold(on) { level()?.hold?.(on); }

  function show(state) {
    overlayState = state;
    overlay.hidden = !state;
    if (!state) overlay.replaceChildren();
  }

  function ask(kind) {
    return new Promise(async (resolve) => {
      hold(true);
      let q;
      try {
        q = pick(await questionPool(kind, stage));
      } catch {
        toast('Cave', 'The questions couldn’t load. Check your connection.', { icon: '⚠️', tone: 'danger' });
        hold(false);
        resolve(false);
        return;
      }
      overlayState = { kind: 'question', type: kind, q, removed: new Set(), chosen: null, resolve };
      drawQuestion();
      overlay.hidden = false;
    });
  }

  function answer(i) {
    const st = overlayState;
    if (st?.kind !== 'question' || st.chosen != null || st.removed.has(i)) return;
    st.chosen = i;
    st.correct = i === st.q.answer;
    recordAnswer({ topicKey: st.q.topicKey, topicName: st.q.topicName, correct: st.correct, points: st.correct ? 30 : 0 });
    if (st.correct) {
      addXp(10);
      if (hearts < MAX_HEARTS) { hearts += 1; st.reward = '+1 heart'; } else { cave().coins += 5; save(); st.reward = '+5 coins'; }
      burst();
      sfx('right');
    } else {
      hearts = Math.max(0, hearts - 1);
      st.lostHeart = true;
      sfx('wrong');
    }
    drawHud();
    drawQuestion();
  }

  function finishQuestion() {
    const st = overlayState;
    if (st?.kind !== 'question' || st.chosen == null) return;
    show(null);
    if (st.lostHeart) wrongAnswers += 1;
    if (hearts <= 0) { st.resolve(false); gameOver(); return; }
    hold(false);
    st.resolve(st.correct);
  }

  function useRing() {
    const st = overlayState;
    const c = cave();
    if (st?.kind !== 'question' || st.chosen != null || st.removed.size || c.rings <= 0) return;
    const wrong = st.q.options.map((_, i) => i).filter((i) => i !== st.q.answer);
    wrong.sort(() => Math.random() - 0.5).slice(0, Math.min(2, Math.max(1, wrong.length - 1))).forEach((i) => st.removed.add(i));
    c.rings -= 1;
    save();
    drawHud();
    drawQuestion();
  }

  function drawQuestion() {
    const st = overlayState;
    const { q } = st;
    const done = st.chosen != null;
    const title = { gate: '🔢 Number Gate', door: '⏳ Sand Door', spell: '✨ Number Spell' }[st.type];
    const intro = {
      gate: 'Answer right and the broken bridge rebuilds itself.',
      door: 'Answer before the sand runs out. A wrong answer makes the sand fall faster.',
      spell: 'A right answer fires a blast of magic at Zarkan’s shield.',
    }[st.type];
    const c = cave();
    overlay.replaceChildren(h('div.cave-dialog', { role: 'dialog', 'aria-label': title },
      h('p.cave-dialog-title', {}, `${title} · ${q.topicName}`),
      h('p.cave-dialog-intro', {}, intro),
      h('div.realm-q', {}, questionBody(q)),
      h('div.realm-opts', {}, q.options.map((o, i) => h('button.realm-opt', {
        type: 'button',
        disabled: done || st.removed.has(i),
        class: done ? (i === q.answer ? 'right' : i === st.chosen ? 'wrong' : 'dim') : st.removed.has(i) ? 'dim' : '',
        onclick: () => answer(i),
      }, h('kbd', {}, LETTERS[i]), q.image ? '' : ` ${o}`))),
      done && (st.correct
        ? h('p.realm-good', {}, `Correct! ${st.reward}. +10 XP.`)
        : h('p.realm-bad', {}, 'Not quite. You lose a heart. The right answer was ', h('b', {}, answerLabel(q, q.answer)), '.')),
      h('div.realm-actions', {},
        !done && c.rings > 0 && !st.removed.size && h('button.btn.ghost.sm', { type: 'button', onclick: useRing }, `💍 Use a Ring of Wisdom (${c.rings})`),
        done && h('button.btn.primary', { type: 'button', onclick: finishQuestion }, hearts <= 0 ? 'Continue' : 'Continue ▶'))));
    overlay.querySelector(done ? '.btn.primary' : '.realm-opt:not(:disabled)')?.focus({ preventScroll: true });
  }

  function drawShop() {
    const c = cave();
    overlayState = { kind: 'shop' };
    const row = (icon, name, text, owned, action) => h('li.cave-shop-item', {}, h('span.cave-shop-icon', {}, icon), h('div', {}, h('b', {}, name), h('small', {}, text)), owned, action);
    overlay.replaceChildren(h('div.cave-dialog', { role: 'dialog', 'aria-label': 'Merchant' },
      h('p.cave-dialog-title', {}, '⛺ The Merchant’s Tent'),
      h('p.cave-dialog-intro', {}, `“Welcome, traveller! Coins for wonders.” You have 🪙 ${c.coins}.`),
      h('ul.cave-shop', {},
        ...SHOP.map((it) => row(it.icon, `${it.name} (🪙 ${it.price})`, it.text, h('small', {}, `You have ${it.id === 'carpet' ? c.carpets : c.rings}`),
          h('button.btn.sm', { type: 'button', disabled: c.coins < it.price, onclick: () => buy(it) }, 'Buy'))),
        ...Object.entries(art.SKINS).map(([id, s]) => {
          const owned = c.skins.includes(id);
          return row(pixel(art.heroPreview(id), 36), `${s.title}${owned ? '' : ` (🪙 ${SKIN_PRICE})`}`, s.blurb, null,
            owned
              ? h('button.btn.sm', { type: 'button', disabled: c.skin === id, onclick: () => wear(id) }, c.skin === id ? 'Wearing' : 'Wear')
              : h('button.btn.sm', { type: 'button', disabled: c.coins < SKIN_PRICE, onclick: () => buySkin(id) }, 'Buy'));
        })),
      h('div.realm-actions', {}, h('button.btn.primary', { type: 'button', onclick: closeShop }, 'Back to the cave ▶'))));
  }

  function buy(it) {
    const c = cave();
    if (c.coins < it.price) return;
    c.coins -= it.price;
    if (it.id === 'carpet') c.carpets += 1; else c.rings += 1;
    save();
    drawHud();
    drawShop();
  }

  function buySkin(id) {
    const c = cave();
    if (c.coins < SKIN_PRICE || c.skins.includes(id)) return;
    c.coins -= SKIN_PRICE;
    c.skins.push(id);
    save();
    wear(id);
    drawHud();
    drawShop();
  }

  function closeShop() { show(null); hold(false); }

  function gameOver() {
    hold(true);
    sfx('lose');
    runFlawless = false;
    overlayState = { kind: 'over' };
    overlay.hidden = false;
    overlay.replaceChildren(h('div.cave-dialog.center', { role: 'dialog' },
      h('p.cave-dialog-title', {}, '💔 Out of hearts'),
      h('p', {}, 'The cave pushes you back, but your coins are safe. Try again!'),
      h('div.realm-actions', {},
        h('button.btn.primary', { type: 'button', onclick: () => { hearts = MAX_HEARTS; show(null); level()?.respawn(); hold(false); drawHud(); } }, 'Try again from the last torch'),
        h('button.btn.ghost', { type: 'button', onclick: () => play(stage) }, 'Restart the stage'))));
  }

  /** Stars for a cleared stage: one for escaping, one for 70% of the coins, one for losing no hearts. */
  function starsFor(stats) {
    let n = 1;
    if (stats.coinsTotal && stats.coins / stats.coinsTotal >= 0.7) n += 1;
    if (runFlawless && !stats.hurts && !wrongAnswers) n += 1;
    return n;
  }

  function cleared(stats = {}) {
    const c = cave();
    const stars = starsFor(stats);
    const bestBefore = c.stars[stage] || 0;
    c.stars[stage] = Math.max(bestBefore, stars);
    const first = !c.cleared.includes(stage);
    const reward = first ? STAGE_REWARD[stage] : 10;
    c.coins += reward;
    if (first) c.cleared.push(stage);
    c.unlocked = Math.max(c.unlocked, Math.min(3, stage + 1));
    const learnt = stage === 1 && !c.doubleJump;
    if (stage >= 1) c.doubleJump = true;
    save();
    addXp(first ? 50 : 10);
    if (stage === 3) awardBadge({ id: 'cave-zarkan', name: 'Defeated Zarkan the Sorcerer', icon: '🪔' });
    burst();
    drawPicker();
    drawHud();
    overlayState = { kind: 'cleared' };
    overlay.hidden = false;
    overlay.replaceChildren(h('div.cave-dialog.center', { role: 'dialog' },
      h('p.cave-dialog-title', {}, stage === 3 ? '🏆 You escaped the Cave of Equations!' : `✨ Stage ${stage} cleared!`),
      h('p.cave-stars', { 'aria-label': `${stars} of 3 stars` }, [1, 2, 3].map((i) => h('span', { class: i <= stars ? 'on' : '', style: { animationDelay: `${i * 0.25}s` } }, '★'))),
      h('ul.cave-stats', {},
        h('li', { class: stats.coinsTotal && stats.coins / stats.coinsTotal >= 0.7 ? 'ok' : '' }, `🪙 Coins found: ${stats.coins ?? 0} / ${stats.coinsTotal ?? 0}`),
        h('li', { class: runFlawless && !stats.hurts && !wrongAnswers ? 'ok' : '' }, `❤️ Hearts lost: ${(stats.hurts || 0) + wrongAnswers}`),
        stats.stomps ? h('li', {}, `🥾 Enemies stomped: ${stats.stomps}`) : null),
      stars > bestBefore && bestBefore > 0 && h('p.realm-good', {}, 'New best for this stage!'),
      stars < 3 && h('p.muted.small', {}, stars === 1 ? 'Find more coins and keep your hearts for more stars.' : 'One more star: collect the coins and lose no hearts.'),
      h('p', {}, `${art.STAGE_STYLE[stage].name}: +🪙 ${reward} and +${first ? 50 : 10} XP.`),
      learnt && h('p.realm-good', {}, 'New power: Double Jump! Press jump again in the air.'),
      stage === 3 && h('p', {}, 'Zarkan is beaten and the treasure is yours: the knowledge you carried in.'),
      h('div.realm-actions', {},
        stage < 3 && h('button.btn.primary', { type: 'button', onclick: () => play(stage + 1) }, `Go to Stage ${stage + 1} ▶`),
        h('button.btn.ghost', { type: 'button', onclick: () => play(stage) }, 'Play this stage again'))));
  }

  // ---------------------------------------------------------------- the game
  const api = {
    get skin() { return cave().skin; },
    get doubleJump() { return !!cave().doubleJump; },
    touch,
    ask,
    stomp() { cave().coins += 3; coinsDirty = true; drawHud(); },
    hurt() {
      hearts = Math.max(0, hearts - 1);
      drawHud();
      if (hearts <= 0) setTimeout(gameOver, 250);
      return hearts;
    },
    heal() { hearts = Math.min(MAX_HEARTS, hearts + 1); drawHud(); },
    coin() { cave().coins += 1; coinsDirty = true; drawHud(); },
    shop() { hold(true); drawShop(); overlay.hidden = false; },
    carpet() {
      const c = cave();
      if (c.carpets <= 0) { toast('No carpet', 'Buy a Magic Carpet at the Merchant’s tent.', { icon: '🧞' }); return false; }
      c.carpets -= 1;
      save();
      drawHud();
      return true;
    },
    hud(info) { progress = info; drawHud(); },
    cleared,
    introDone() {
      cave().intro = true;
      save();
      play(stage);
    },
  };
  let coinsDirty = false;
  let runFlawless = true;  // no game over this run (for the third star)
  let wrongAnswers = 0;
  const coinSaver = setInterval(() => { if (coinsDirty) { coinsDirty = false; save(); } }, 3000);

  function play(n) {
    stage = n;
    hearts = MAX_HEARTS;
    runFlawless = true;
    wrongAnswers = 0;
    progress = {};
    show(null);
    drawPicker();
    drawHud();
    if (!game) return;
    game.scene.stop('intro');
    game.scene.stop('level');
    game.scene.start('level', { stage: n });
  }

  function playIntro() {
    if (!game) return;
    show(null);
    game.scene.stop('level');
    game.scene.start('intro');
    wrap.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // ---------------------------------------------------------------- full screen
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  function drawFsBtn() { fsBtn.textContent = isFull ? '✕ Exit' : '⛶ Full screen'; }
  function setFull(on) {
    if (on === isFull) return;
    isFull = on;
    wrap.classList.toggle('full', on);
    document.documentElement.classList.toggle('realm-locked', on);
    drawFsBtn();
    requestAnimationFrame(() => game?.scale?.refresh());
  }
  async function toggleFull() {
    if (isFull) {
      if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document)?.catch?.(() => {});
      setFull(false);
      return;
    }
    setFull(true);
    const req = wrap.requestFullscreen || wrap.webkitRequestFullscreen;
    try { await req?.call(wrap, { navigationUI: 'hide' }); } catch { /* the view over the page still works */ }
    try { await screen.orientation?.lock?.('landscape'); } catch { /* not allowed here */ }
    requestAnimationFrame(() => game?.scale?.refresh());
  }
  const onFsChange = () => { if (!fsElement() && isFull) setFull(false); else requestAnimationFrame(() => game?.scale?.refresh()); };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  const onKey = (e) => {
    const st = overlayState;
    if (st?.kind === 'question') {
      const i = '1234'.indexOf(e.key) >= 0 ? '1234'.indexOf(e.key) : 'abcd'.indexOf(e.key.toLowerCase());
      if (st.chosen == null && i >= 0 && i < st.q.options.length && e.key.length === 1) { e.preventDefault(); answer(i); }
      else if (st.chosen != null && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); finishQuestion(); }
    } else if (st?.kind === 'shop' && e.key === 'Escape') closeShop();
    else if (!st && e.key === 'Escape' && isFull) setFull(false);
  };
  window.addEventListener('keydown', onKey);

  drawPicker();
  drawHud();
  drawHeroes();
  drawControls();
  drawFsBtn();
  drawSoundBtn();

  (async () => {
    try {
      await Promise.race([document.fonts?.load("8px 'Press Start 2P'"), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
      const Phaser = await loadPhaser();
      if (!alive) return;
      stageEl.replaceChildren();
      const first = cave().intro ? 'level' : 'intro';
      class Boot extends Phaser.Scene {
        constructor() { super('boot'); }
        create() { this.scene.start(first, { stage }); }
      }
      game = startGame(Phaser, stageEl, [Boot, introScene(Phaser, api), levelScene(Phaser, api)], {
        ...VIEW, background: '#07050d', physics: { default: 'arcade', arcade: { gravity: { y: 650 } } },
      });
      stageEl.game = game; // handy for checking the game from the browser console
      questionPool('gate', stage).catch(() => {}); // warm up
    } catch (e) {
      mount(stageEl, h('p.cave-loading', {}, e.message));
    }
  })();

  return () => {
    alive = false;
    clearInterval(coinSaver);
    if (coinsDirty) save();
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('webkitfullscreenchange', onFsChange);
    if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document)?.catch?.(() => {});
    document.documentElement.classList.remove('realm-locked');
    game?.destroy(true);
  };
}

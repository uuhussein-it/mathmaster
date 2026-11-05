/**
 * The Realm: a world map whose zones open as the student masters their
 * course topics, a base of buildings that produce resources (sped up by
 * Insight from right answers), the hero's class, evolution and cosmetic
 * store, and guild boss fights with the rest of their class.
 *
 * The scenes are drawn with Phaser (realm/scenes.js); this screen holds the
 * tabs, panels and buttons around them.
 */
import { h, mount, toast, prefs, burst, questionBody, answerLabel, LETTERS } from '../ui.js';
import { go } from '../router.js';
import { CHARACTERS } from '../characters.js';
import { profile, xpToNext, recordAnswer, addXp, awardBadge } from '../state.js';
import { account, adminApi as api } from '../account.js';
import { loadCurriculumIndex, loadCourse } from '../data.js';
import { loadPhaser, startGame } from '../realm/phaser.js';
import { mapScene, baseScene, bossScene, MAP_SIZE, BASE_SIZE, BOSS_SIZE } from '../realm/scenes.js';
import { heroFrames, buildingSprite, bossInfo, bossSprite, AURA } from '../realm/art.js';
import { ZONES, NEED_PCT, loadNodes, layout, rememberZones, openZones, startNode } from '../realm/world.js';
import * as eco from '../realm/economy.js';

const TABS = [
  { id: 'map', icon: '🗺️', name: 'World Map' },
  { id: 'base', icon: '🏰', name: 'My Base' },
  { id: 'hero', icon: '🧙', name: 'Hero & Store' },
  { id: 'guild', icon: '🐉', name: 'Guild Boss' },
];
const ZONE_UNLOCKS = { plains: ['farm', 'mill'], forest: ['quarry', 'mine'], citadel: ['library', 'tower'] };
const BOSS_TRAIT = {
  sage: 'Arcane Focus: your combo keeps growing up to 10 right answers in a row (others stop at 5).',
  warrior: 'Battle Fury: every hit on a boss does 50% more damage.',
  explorer: 'Weak Spot: each hit has a 1 in 4 chance to be a critical hit for double damage.',
};
const GUILD_POLL_MS = 5000;

const fmtTime = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
};
const n0 = (v) => Math.floor(v).toLocaleString();

/** A sprite canvas shown large and crisp. */
function pixel(c, size, cls = '') {
  const el = h('canvas.pixel', { width: c.width, height: c.height, class: cls, style: { width: `${size}px`, height: `${size * (c.height / c.width)}px` }, 'aria-hidden': 'true' });
  el.getContext('2d').drawImage(c, 0, 0);
  return el;
}

const heroLook = () => ({ character: profile.character, tier: eco.tierOf(profile.level), wear: { ...eco.realm().wear } });

export function renderRealm(app) {
  eco.realm();
  let tab = prefs.get('realm-tab', 'map');
  if (!TABS.some((t) => t.id === tab)) tab = 'map';
  let game = null;
  let stopTab = null;
  let alive = true;

  const bar = h('div.realm-bar', { 'aria-label': 'Your resources' });
  function drawBar() {
    const r = eco.realm();
    bar.replaceChildren(
      ...Object.entries(eco.RESOURCES).map(([k, res]) => h('span.res', { title: res.name }, h('i', { 'aria-hidden': 'true' }, res.icon), h('b', {}, n0(r.res[k])), h('small', {}, res.name))),
      h('span.res.insight', { title: 'Insight: earned by answering questions right' }, h('i', { 'aria-hidden': 'true' }, eco.INSIGHT.icon), h('b', {}, n0(eco.insight())), h('small', {}, 'Insight')));
  }
  const tabs = h('div.realm-tabs', { role: 'tablist' });
  const body = h('div.realm-body');

  function drawTabs() {
    tabs.replaceChildren(...TABS.map((t) => h('button.realm-tab', {
      role: 'tab', 'aria-selected': String(t.id === tab), onclick: () => show(t.id),
    }, h('span', { 'aria-hidden': 'true' }, t.icon), ` ${t.name}`)));
  }

  function stopGame() {
    if (typeof stopTab === 'function') stopTab();
    stopTab = null;
    game?.destroy(true);
    game = null;
  }

  async function playScene(stage, Scene, size) {
    await Promise.race([document.fonts?.load("8px 'Press Start 2P'"), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
    const Phaser = await loadPhaser();
    if (!alive || !stage.isConnected) return null;
    game = startGame(Phaser, stage, Scene(Phaser), size);
    return game;
  }

  function show(id) {
    stopGame();
    tab = id;
    prefs.set('realm-tab', id);
    drawTabs();
    drawBar();
    stopTab = { map: mapTab, base: baseTab, hero: heroTab, guild: guildTab }[id]();
  }

  // ------------------------------------------------------------ world map
  function mapTab() {
    const path = prefs.get('realm-path', 'course');
    const stage = h('div.realm-stage.map', {}, h('p.realm-loading', {}, 'Loading the world map…'));
    const panel = h('div.panel.realm-panel', {}, h('p.muted', {}, 'Tap a topic on the map.'));
    const zoneList = h('div.realm-zones');
    mount(body,
      h('div.realm-row', {},
        h('p.muted', {}, 'Master every topic in a zone to open the next. Mastered means ',
          h('b', {}, `${NEED_PCT}% right`), ' with at least 5 right answers.'),
        h('div.chips', { role: 'group', 'aria-label': 'Which map' },
          [['course', '📘 My course'], ['sat', '🎯 SAT']].map(([v, label]) => h('button.chip', {
            role: 'radio', 'aria-checked': String(path === v), onclick: () => { prefs.set('realm-path', v); show('map'); },
          }, label)))),
      stage,
      h('div.realm-split', {}, panel, zoneList));

    function nodePanel(n) {
      const m = n.m;
      panel.replaceChildren(
        h('p.eyebrow', {}, `${ZONES.find((z) => z.id === n.zone).name} · ${n.group}`),
        h('h3', {}, n.name),
        h('div.realm-meter', {},
          h('div', {}, h('span', {}, 'Right answers'), h('b', {}, `${Math.min(m.correct, m.need)} / ${m.need}`)),
          h('div.meter', {}, h('i', { style: { width: `${Math.min(100, (m.correct / m.need) * 100)}%` } }))),
        h('div.realm-meter', {},
          h('div', {}, h('span', {}, 'Accuracy'), h('b', {}, m.seen ? `${m.pct}%` : '—')),
          h('div.meter', { class: m.pct >= NEED_PCT ? 'good' : '' }, h('i', { style: { width: `${m.pct}%` } }), h('em', { style: { left: `${NEED_PCT}%` } }))),
        h('p', { class: m.mastered ? 'realm-good' : 'muted' }, m.mastered ? '★ Mastered. Practice keeps it strong.'
          : m.seen ? `Keep going: you need ${m.need} right answers and ${NEED_PCT}% accuracy.` : 'New topic. Every right answer also earns ✨ Insight for your base.'),
        h('div.realm-actions', {},
          h('button.btn.primary', { onclick: () => startNode(n, 'practice', go) }, '📘 Practice'),
          h('button.btn', { onclick: () => startNode(n, 'quiz', go) }, '⏱️ Quiz')));
    }

    function lockedPanel(z) {
      const i = ZONES.findIndex((x) => x.id === z.id);
      panel.replaceChildren(
        h('p.eyebrow', {}, 'Locked zone'),
        h('h3', {}, `${z.icon} ${z.name}`),
        h('p.muted', {}, `Master every topic in ${ZONES[i - 1].name} to open it. It unlocks the `,
          ZONE_UNLOCKS[z.id].map((b) => eco.BUILDINGS[b].name).join(' and '), ' for your base.'));
    }

    (async () => {
      try {
        const nodes = await loadNodes(path);
        if (!alive || tab !== 'map') return;
        if (!nodes.length) {
          mount(stage, h('p.realm-loading', {}, path === 'sat' ? 'The SAT bank is empty right now.' : 'Your group has no course topics yet. Try the SAT map.'));
          return;
        }
        const zones = layout(nodes);
        rememberZones(zones);
        zoneList.replaceChildren(...zones.map((z) => {
          const done = z.nodes.filter((n) => n.m.mastered).length;
          return h('div.panel.realm-zone', { class: z.open ? (z.done ? 'cleared' : 'open') : 'locked' },
            h('span.realm-zone-icon', { 'aria-hidden': 'true' }, z.open ? z.icon : '🔒'),
            h('div', {},
              h('b', {}, z.name),
              h('small', {}, z.open ? `${done} of ${z.nodes.length} topics mastered` : 'Locked'),
              h('small', {}, 'Unlocks: ', ZONE_UNLOCKS[z.id].map((b) => eco.BUILDINGS[b].name).join(', '))),
            h('span.realm-zone-state', {}, z.done ? 'Cleared' : z.open ? 'Open' : ''));
        }));
        stage.replaceChildren();
        await playScene(stage, (P) => mapScene(P, {
          zones, hero: heroLook(), onNode: (n) => nodePanel(n), onLocked: (z) => lockedPanel(z),
        }), MAP_SIZE);
      } catch (e) {
        mount(stage, h('p.realm-loading', {}, e.message));
      }
    })();
  }

  // ----------------------------------------------------------------- base
  function baseTab() {
    let placing = null;   // building type or decor id
    let selected = null;  // { kind: 'hall' | 'building' | 'decor', x, y, uid }
    const stage = h('div.realm-stage.base', {}, h('p.realm-loading', {}, 'Loading your base…'));
    const side = h('div.realm-side');
    const info = h('div.panel.realm-panel');
    mount(body, h('div.realm-base', {}, h('div', {}, stage, info), side));

    const scene = () => game?.scene?.getScene('base');
    // On a phone the build list sits under the map: bring the map back into view to place.
    const showStage = () => {
      const r = stage.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight) stage.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    const resync = () => { drawBar(); drawSide(); drawInfo(); scene()?.sync(); };

    function thingAt(x, y) {
      if (x === eco.HALL.x && y === eco.HALL.y) return { kind: 'hall', x, y };
      const b = eco.realm().buildings.find((v) => v.x === x && v.y === y);
      if (b) return { kind: 'building', x, y, uid: b.uid };
      const d = eco.realm().decor.find((v) => v.x === x && v.y === y);
      return d ? { kind: 'decor', x, y, uid: d.uid } : null;
    }

    function act(fn) {
      try {
        const out = fn();
        resync();
        return out;
      } catch (e) {
        toast('Realm', e.message, { icon: '⚠️', tone: 'danger' });
        return null;
      }
    }

    function onTile(x, y) {
      if (placing) {
        const kind = placing;
        const ok = act(() => (eco.BUILDINGS[kind] ? eco.place(kind, x, y, openZones()) : eco.placeDecor(kind, x, y)));
        if (ok !== null) {
          placing = null;
          selected = thingAt(x, y);
          if (eco.BUILDINGS[kind]) toast('Construction started', `${eco.BUILDINGS[kind].name}. Spend ✨ Insight to finish it now.`, { icon: '🔨', tone: 'level' });
        }
        resync();
        return;
      }
      selected = thingAt(x, y);
      if (selected?.kind === 'building') {
        const got = eco.collect(selected.uid);
        if (got) toast('Collected', `+${got[1]} ${got[0] === 'insight' ? eco.INSIGHT.icon : eco.RESOURCES[got[0]].icon}`, { icon: '🧺', tone: 'level' });
      }
      resync();
    }

    // Kept between redraws so a click isn't lost when the panel refreshes.
    const collectBtn = h('button.btn.primary.block', {
      onclick: () => {
        const got = eco.collectAll();
        const text = Object.entries(got).map(([k, v]) => `+${v} ${k === 'insight' ? eco.INSIGHT.icon : eco.RESOURCES[k].icon}`).join('  ');
        if (text) toast('Collected', text, { icon: '🧺', tone: 'level' });
        resync();
      },
    });
    function updateCollect(now = Date.now()) {
      const ready = eco.realm().buildings.filter((b) => eco.pending(b, now) >= 1).length;
      collectBtn.disabled = !ready;
      collectBtn.textContent = ready ? `🧺 Collect all (${ready})` : '🧺 Nothing to collect yet';
    }

    function drawSide() {
      const zones = openZones();
      const now = Date.now();
      updateCollect(now);
      const decorOwned = eco.STORE.filter((s) => s.slot === 'decor' && eco.decorLeft(s.id) > 0);
      side.replaceChildren(
        h('div.panel.realm-panel', {},
          collectBtn,
          placing && h('p.realm-placing', {}, 'Tap an empty tile on your base. ',
            h('button.link', { onclick: () => { placing = null; resync(); } }, 'Cancel'))),
        h('div.panel.realm-panel', {},
          h('h3', {}, 'Build'),
          h('div.realm-builds', {}, Object.entries(eco.BUILDINGS).map(([type, def]) => {
            const why = eco.whyNot(type, zones);
            const { cost } = eco.stepCost(type, 0);
            const makes = def.makes === 'insight' ? `+${def.rate} ${eco.INSIGHT.icon}/h` : def.makes ? `+${def.rate} ${eco.RESOURCES[def.makes].icon}/h` : '+20% output';
            return h('button.realm-build', {
              type: 'button', 'aria-pressed': String(placing === type), class: why ? 'locked' : '', title: def.text,
              onclick: () => {
                if (why) { toast(def.name, why, { icon: '🔒', tone: 'danger' }); return; }
                placing = placing === type ? null : type;
                selected = null;
                resync();
                if (placing) showStage();
              },
            }, pixel(buildingSprite(type), 40),
            h('span', {}, h('b', {}, def.name), h('small', {}, `${makes} · ${eco.countOf(type)}/${def.max}`), h('small.cost', {}, eco.fmtCost(cost)),
              why && h('small.why', {}, why)));
          }))),
        decorOwned.length > 0 && h('div.panel.realm-panel', {},
          h('h3', {}, 'Decorations'),
          h('div.realm-builds', {}, decorOwned.map((s) => h('button.realm-build', {
            type: 'button', 'aria-pressed': String(placing === s.id),
            onclick: () => { placing = placing === s.id ? null : s.id; selected = null; resync(); if (placing) showStage(); },
          }, pixel(buildingSprite(s.id), 40), h('span', {}, h('b', {}, s.name), h('small', {}, `${eco.decorLeft(s.id)} to place`)))))));
    }

    let infoSig = '';
    const countdown = h('span');
    function sigOf(now) {
      const b = selected?.kind === 'building' && eco.building(selected.uid);
      if (!b) return JSON.stringify(selected);
      const next = b.level < eco.maxLevel && eco.stepCost(b.type, b.level);
      return JSON.stringify([b.uid, b.level, eco.isBuilding(b, now), Math.floor(eco.pending(b, now)), eco.isFull(b, now),
        next && eco.canAfford(next.cost), eco.isBuilding(b, now) && eco.finishCost(b, now), eco.insight()]);
    }
    function drawInfo() {
      const now = Date.now();
      infoSig = sigOf(now);
      if (!selected) {
        info.replaceChildren(h('p.muted', {}, 'Tap a building to collect what it made, upgrade it or speed it up with ✨ Insight. Pick something from Build to place it.'));
        return;
      }
      if (selected.kind === 'hall') {
        const hero = CHARACTERS[profile.character];
        info.replaceChildren(h('h3', {}, '🏰 Town Hall'),
          h('p.muted', {}, `The heart of ${profile.name}’s realm, flying the ${eco.realm().wear.banner ? eco.STORE_BY_ID[eco.realm().wear.banner].name : hero.name + '’s colours'}. New zones on the world map unlock new buildings here.`));
        return;
      }
      if (selected.kind === 'decor') {
        const d = eco.realm().decor.find((v) => v.uid === selected.uid);
        if (!d) { selected = null; drawInfo(); return; }
        info.replaceChildren(h('h3', {}, eco.STORE_BY_ID[d.type].name),
          h('div.realm-actions', {}, h('button.btn.ghost', { onclick: () => { eco.removeDecor(d.uid); selected = null; resync(); } }, 'Put it away')));
        return;
      }
      const b = eco.building(selected.uid);
      if (!b) { selected = null; drawInfo(); return; }
      const def = eco.BUILDINGS[b.type];
      const busy = eco.isBuilding(b, now);
      countdown.textContent = fmtTime(b.readyAt - now);
      const icon = def.makes === 'insight' ? eco.INSIGHT.icon : def.makes ? eco.RESOURCES[def.makes].icon : '';
      const next = b.level < eco.maxLevel ? eco.stepCost(b.type, b.level) : null;
      const rate = eco.ratePerHour(b);
      info.replaceChildren(
        h('div.realm-info-head', {}, pixel(buildingSprite(busy ? 'scaffold' : b.type), 48),
          h('div', {}, h('h3', {}, `${def.name} · level ${b.level}`), h('p.muted', {}, def.text))),
        busy ? h('p', {}, `🔨 ${b.level > 1 ? 'Upgrading' : 'Building'}: `, countdown, ' left.')
          : def.makes && h('p', {}, `Makes ${rate % 1 ? rate.toFixed(1) : rate} ${icon} per hour. Holding ${n0(eco.pending(b, now))} of ${n0(rate * eco.CAP_HOURS)}${eco.isFull(b, now) ? ' (full: collect it!)' : ''}.`),
        h('div.realm-actions', {},
          busy && h('button.btn.primary', { onclick: () => act(() => eco.finishNow(b.uid)) }, `✨ Finish now (${eco.finishCost(b, now)})`),
          !busy && def.makes && h('button.btn.primary', {
            disabled: eco.pending(b, now) < 1, onclick: () => act(() => eco.collect(b.uid)),
          }, `🧺 Collect ${n0(eco.pending(b, now))} ${icon}`),
          !busy && def.makes && def.makes !== 'insight' && h('button.btn', { onclick: () => act(() => {
            const [k, v] = eco.rush(b.uid);
            toast('Rushed!', `+${v} ${eco.RESOURCES[k].icon} right away.`, { icon: '✨', tone: 'level' });
          }) }, `✨ Rush 2h (${eco.RUSH_COST})`),
          !busy && next && h('button.btn', { disabled: !eco.canAfford(next.cost), onclick: () => act(() => eco.upgrade(b.uid)) },
            `⬆️ Level ${b.level + 1}: ${eco.fmtCost(next.cost)}`),
          h('button.btn.ghost.danger', { onclick: () => { if (confirm(`Demolish this ${def.name}? You won’t get its resources back.`)) { eco.demolish(b.uid); selected = null; resync(); } } }, 'Demolish')));
    }

    resync();
    const tick = setInterval(() => {
      const now = Date.now();
      const b = selected?.kind === 'building' && eco.building(selected.uid);
      if (sigOf(now) !== infoSig) drawInfo();
      else if (b) countdown.textContent = fmtTime(b.readyAt - now);
      updateCollect(now);
      drawBar();
    }, 1000);
    playScene(stage, (P) => baseScene(P, {
      hero: heroLook(), onTile, thingAt, placing: () => placing, selected: () => selected,
    }), BASE_SIZE).then(() => stage.querySelector('.realm-loading')?.remove())
      .catch((e) => mount(stage, h('p.realm-loading', {}, e.message)));
    return () => clearInterval(tick);
  }

  // ------------------------------------------------------- hero and store
  function heroTab() {
    const hero = CHARACTERS[profile.character];
    const skill = eco.REALM_SKILLS[profile.character];
    const look = heroLook();
    const tier = eco.TIERS[look.tier];
    const nextTier = eco.TIERS[look.tier + 1];
    const frames = heroFrames(look.character, look.tier, look.wear);
    const big = pixel(frames[0], 150, 'realm-hero-art');
    if (look.wear.aura) big.style.filter = `drop-shadow(0 0 14px ${AURA[look.wear.aura]})`;
    let f = 0;
    const anim = setInterval(() => { f = 1 - f; big.getContext('2d').clearRect(0, 0, 16, 16); big.getContext('2d').drawImage(frames[f], 0, 0); }, 300);
    const skillBox = h('div');

    function drawSkill() {
      const left = eco.skillReadyAt(profile.character) - Date.now();
      skillBox.replaceChildren(h('button.btn.primary', {
        disabled: left > 0,
        onclick: () => {
          try {
            const text = eco.useSkill(profile.character);
            toast(skill.name, text, { icon: skill.icon, tone: 'level' });
            drawBar();
            drawSkill();
          } catch (e) { toast(skill.name, e.message, { icon: '⏳', tone: 'danger' }); }
        },
      }, left > 0 ? `${skill.icon} Ready in ${fmtTime(left)}` : `${skill.icon} Use ${skill.name}`));
    }
    drawSkill();
    const tick = setInterval(drawSkill, 1000);

    const storeBox = h('div.realm-store');
    function drawStore() {
      const r = eco.realm();
      const slots = [['hat', 'Hats'], ['aura', 'Auras'], ['banner', 'Banners for your town hall'], ['decor', 'Decorations for your base']];
      storeBox.replaceChildren(...slots.map(([slot, title]) => h('div', {},
        h('h4', {}, title),
        h('div.realm-items', {}, eco.STORE.filter((s) => s.slot === slot).map((s) => {
          const owned = eco.owns(s.id);
          const worn = r.wear[slot] === s.id;
          let action;
          if (slot === 'decor') action = h('button.btn.sm', { onclick: () => buy(s) }, `Buy · 🪙 ${s.price}`);
          else if (worn) action = h('button.btn.ghost.sm', { onclick: () => { eco.wear(slot, null); show('hero'); } }, 'Take off');
          else if (owned) action = h('button.btn.sm', { onclick: () => { eco.wear(slot, s.id); show('hero'); } }, 'Wear');
          else action = h('button.btn.sm', { onclick: () => buy(s), disabled: r.res.gold < s.price }, `Buy · 🪙 ${s.price}`);
          return h('div.realm-item', { class: worn ? 'worn' : '' },
            slot === 'decor' ? pixel(buildingSprite(s.id), 40) : h('span.realm-item-icon', { 'aria-hidden': 'true' }, s.icon),
            h('b', {}, s.name),
            slot === 'decor' && eco.owns(s.id) && h('small', {}, `${r.owned.filter((x) => x === s.id).length} owned`),
            worn && h('small', {}, 'Wearing'),
            action);
        })))));
    }
    function buy(s) {
      try {
        eco.buy(s.id);
        toast('Bought!', s.slot === 'decor' ? `${s.name}. Place it from My Base.` : `${s.name}. You’re wearing it now.`, { icon: s.icon, tone: 'level' });
        show('hero');
      } catch (e) { toast('Store', e.message, { icon: '🪙', tone: 'danger' }); }
    }
    drawStore();

    const need = xpToNext(profile.level);
    mount(body,
      h('div.realm-hero', {},
        h('div.panel.realm-hero-card', { style: { '--hero': hero.color } },
          h('div.realm-hero-stage', {}, big),
          h('p.eyebrow', {}, `${hero.name} · ${tier.name}`),
          h('h2', {}, profile.name),
          h('p.muted', {}, `Level ${profile.level} · ${profile.xp} / ${need} XP`),
          h('div.meter', {}, h('i', { style: { width: `${(profile.xp / need) * 100}%` } })),
          h('p', {}, nextTier ? `Evolves into ${nextTier.name} at level ${nextTier.min}.` : 'Fully evolved. A true Legend!'),
          h('div.realm-tiers', {}, eco.TIERS.map((t, i) => h('div.realm-tier', { class: i <= look.tier ? 'have' : '' },
            pixel(heroFrames(look.character, i, {})[0], 44), h('small', {}, t.name), h('small', {}, `Lv ${t.min}`)))),
          h('button.btn.ghost.sm', { onclick: () => go('select') }, 'Change class')),
        h('div.realm-skills', {},
          h('div.panel.realm-panel', {},
            h('h3', {}, 'Class skills'),
            h('dl.realm-skill-list', {},
              h('dt', {}, `🛡️ ${hero.passive.name}`), h('dd', {}, hero.passive.text),
              h('dt', {}, `${hero.skill.icon} ${hero.skill.name}`), h('dd', {}, `In Practice and Quiz: ${hero.skill.text}`),
              h('dt', {}, `🐉 Boss trait`), h('dd', {}, BOSS_TRAIT[profile.character]),
              h('dt', {}, `${skill.icon} ${skill.name}`), h('dd', {}, `In your realm: ${skill.text} Recharges every ${skill.cooldownH} hours.`)),
            skillBox),
          h('div.panel.realm-panel', {}, h('h3', {}, '🛒 Cosmetic store'), h('p.muted', {}, 'Spend gold from your Gold Mines.'), storeBox))));
    return () => { clearInterval(anim); clearInterval(tick); };
  }

  // ----------------------------------------------------------------- guild
  function guildTab() {
    let state = null;
    let lastLog = 0;
    let questions = null;
    let used = new Set();
    let dialog = null;   // { q, state: 'ask' | 'sending' | 'done', result }
    const stage = h('div.realm-stage.boss', {}, h('p.realm-loading', {}, 'Entering the boss arena…'));
    const overlay = h('div.realm-dialog', { hidden: true });
    const head = h('div.realm-boss-head');
    const side = h('div.realm-side');
    const actions = h('div.realm-actions.center');
    mount(body, h('div.realm-base', {}, h('div', {}, head, h('div.realm-stage-wrap', {}, stage, overlay), actions), side));
    const scene = () => game?.scene?.getScene('boss');
    const attackBtn = h('button.btn.primary.lg', { onclick: () => ask() }, '⚔️ Attack: answer a question');

    async function loadQuestions() {
      if (questions) return questions;
      const index = await loadCurriculumIndex();
      const me = account.student;
      const mine = index.courses.filter((c) => c.grade === me?.grade && c.track === me?.track);
      const courses = await Promise.all(mine.map((c) => loadCourse(c.id)));
      questions = courses.flatMap((course) => course.topics.flatMap((t) => t.questions
        .filter((q) => (q.type ?? 'mcq') === 'mcq' && q.answer != null && q.options?.length)
        .map((q) => ({ ...q, topicKey: `${course.id}:${t.id}:${q.lesson}`, topicName: t.name }))));
      return questions;
    }

    function drawHead() {
      const b = state.boss;
      const info = bossInfo(b.n);
      const pct = (b.hp / b.max_hp) * 100;
      head.replaceChildren(
        h('div.realm-boss-title', {},
          pixel(bossSprite(b.n), 44),
          h('div', {},
            h('p.eyebrow', {}, `Guild: ${state.group.name} · Boss ${b.n}`),
            h('h2', {}, info.name),
            h('div.realm-hp', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': b.max_hp, 'aria-valuenow': b.hp, 'aria-label': 'Boss health' },
              h('i', { style: { width: `${pct}%` } }), h('span', {}, `${n0(b.hp)} / ${n0(b.max_hp)}`)))));
      if (b.defeated) actions.replaceChildren(h('p.realm-good', {}, `🏆 ${info.name} has fallen! The next boss arrives in ${fmtTime(b.next_in * 1000)}.`));
      else if (actions.firstChild !== attackBtn) actions.replaceChildren(attackBtn);
    }

    function drawSide() {
      const s = state;
      side.replaceChildren(
        s.rewards.length > 0 && h('div.panel.realm-panel.reward', {},
          h('h3', {}, '🎁 Rewards'),
          s.rewards.map((r) => h('div.realm-reward', {},
            h('span', {}, `${bossInfo(r.boss).name}: 🪙 ${r.gold} + ✨ ${r.insight}`),
            h('button.btn.primary.sm', { onclick: () => claim(r) }, 'Claim')))),
        h('div.panel.realm-panel', {},
          h('h3', {}, 'Your attack'),
          h('p', {}, `Damage dealt: `, h('b', {}, n0(s.me.damage)), ` · Hits: ${s.me.hits} · Combo: ${s.me.combo}`),
          h('p.muted', {}, BOSS_TRAIT[profile.character])),
        h('div.panel.realm-panel', {},
          h('h3', {}, `Top fighters (${s.fighters})`),
          s.top.length ? h('ol.realm-fighters', {}, s.top.map((t) => h('li', { class: t.me ? 'me' : '' },
            h('span', {}, t.me ? 'You' : t.name), h('b', {}, n0(t.damage)))))
            : h('p.muted', {}, 'No one has attacked yet. Be the first!')),
        s.log.length > 0 && h('div.panel.realm-panel', {},
          h('h3', {}, 'Recent hits'),
          h('ul.realm-log', {}, s.log.map((l) => h('li', {}, `${l.me ? 'You' : l.name} hit for ${l.damage}${l.crit ? ' (critical!)' : ''}`, h('small', {}, ` ${fmtTime(l.ago * 1000)} ago`))))));
    }

    function apply(next, { animate = true } = {}) {
      const wasDefeated = state?.boss.defeated;
      const prevBoss = state?.boss.n;
      state = next;
      const sc = scene();
      if (sc && animate) {
        if (prevBoss && prevBoss !== next.boss.n) sc.setBoss(next.boss.n);
        next.log.filter((l) => l.id > lastLog && !l.me).reverse().forEach((l, i) => setTimeout(() => sc.ally(l), i * 250));
        if (!wasDefeated && next.boss.defeated && prevBoss === next.boss.n) sc.fallen();
      }
      lastLog = Math.max(lastLog, ...next.log.map((l) => l.id), 0);
      drawHead();
      drawSide();
    }

    async function refresh() {
      try { apply(await api('api/guild')); } catch { /* try again next poll */ }
    }

    async function claim(r) {
      try {
        const got = await api('api/guild/claim', { method: 'POST', body: { boss: r.boss } });
        eco.claimReward(`boss-${state.group.id}-${got.boss}`, got);
        const info = bossInfo(got.boss);
        awardBadge({ id: `slayer-${state.group.id}-${got.boss}`, name: `Slayer of the ${info.name}`, icon: '🐉' });
        toast('Reward claimed!', `🪙 ${got.gold} gold and ✨ ${got.insight} Insight.`, { icon: '🎁', tone: 'level' });
        burst();
        drawBar();
        refresh();
      } catch (e) { toast('Guild', e.message, { icon: '⚠️', tone: 'danger' }); }
    }

    async function ask() {
      try {
        const qs = await loadQuestions();
        if (!qs.length) throw new Error('Your course has no multiple-choice questions with answer keys yet.');
        let pool = qs.filter((q) => !used.has(q.ref));
        if (!pool.length) { used = new Set(); pool = qs; }
        const q = pool[Math.floor(Math.random() * pool.length)];
        used.add(q.ref);
        dialog = { q, state: 'ask', result: null };
        drawDialog();
      } catch (e) { toast('Guild', e.message, { icon: '⚠️', tone: 'danger' }); }
    }

    async function answer(i) {
      if (!dialog || dialog.state !== 'ask') return;
      dialog.state = 'sending';
      dialog.chosen = i;
      drawDialog();
      try {
        const out = await api('api/guild/hit', { method: 'POST', body: { ref: dialog.q.ref, choice: i } });
        const hit = out.hit;
        dialog.state = 'done';
        dialog.result = hit;
        recordAnswer({ topicKey: dialog.q.topicKey, topicName: dialog.q.topicName, correct: hit.correct, points: hit.correct ? 50 : 0 });
        if (hit.correct) addXp(8);
        if (hit.damage) scene()?.strike(hit);
        else if (!hit.correct) scene()?.miss();
        apply(out, { animate: true });
        drawBar();
      } catch (e) {
        dialog.state = 'ask';
        toast('Guild', e.message, { icon: '⚠️', tone: 'danger' });
        refresh();
      }
      drawDialog();
    }

    function close() {
      dialog = null;
      drawDialog();
    }

    function drawDialog() {
      overlay.hidden = !dialog;
      if (!dialog) { overlay.replaceChildren(); return; }
      const { q, result } = dialog;
      const done = dialog.state === 'done';
      const opts = h('div.realm-opts', {}, q.options.map((o, i) => h('button.realm-opt', {
        type: 'button', disabled: dialog.state !== 'ask',
        class: done ? (i === result.answer ? 'right' : i === dialog.chosen ? 'wrong' : 'dim') : '',
        onclick: () => answer(i),
      }, h('kbd', {}, LETTERS[i]), q.image ? '' : ` ${o}`)));
      let note = null;
      if (done) {
        note = result.correct
          ? h('p.realm-good', {}, result.repeat ? 'Right, but you already used this question on this boss, so it does no damage. Try another!'
            : `Hit! ${result.crit ? 'Critical! ' : ''}${result.damage} damage. Combo ×${result.combo}.`)
          : h('p.realm-bad', {}, 'Missed. The right answer was ', h('b', {}, answerLabel(q, result.answer)), '.');
      }
      overlay.replaceChildren(h('div.realm-dialog-box', { role: 'dialog', 'aria-label': 'Boss question' },
        h('p.realm-dialog-title', {}, `${q.topicName}`),
        h('div.realm-q', {}, questionBody(q)),
        opts,
        note,
        h('div.realm-actions', {},
          done && !state.boss.defeated && h('button.btn.primary', { onclick: ask }, 'Next question ▶'),
          h('button.btn.ghost', { onclick: close }, done ? 'Close' : 'Back away'))));
    }

    const onKey = (e) => {
      if (!dialog) return;
      if (e.key === 'Escape') close();
      const i = '1234'.indexOf(e.key);
      if (i >= 0 && i < dialog.q.options.length) answer(i);
    };
    window.addEventListener('keydown', onKey);

    (async () => {
      try {
        state = await api('api/guild');
        lastLog = Math.max(0, ...state.log.map((l) => l.id));
        if (!alive || tab !== 'guild') return;
        drawHead();
        drawSide();
        stage.replaceChildren();
        await playScene(stage, (P) => bossScene(P, {
          hero: heroLook(), boss: () => state.boss.n, defeated: () => !!state.boss.defeated,
        }), BOSS_SIZE);
      } catch (e) {
        mount(stage, h('p.realm-loading', {}, e.message));
      }
    })();
    const poll = setInterval(() => { if (!document.hidden) refresh(); }, GUILD_POLL_MS);
    return () => { clearInterval(poll); window.removeEventListener('keydown', onKey); };
  }

  mount(app,
    h('section.realm', {},
      h('div.crumbs', {}, h('button.link', { onclick: () => go('hub') }, '← Hub'), h('span', {}, 'The Realm')),
      h('div.realm-top', {}, h('h1.display', {}, 'The Realm'), bar),
      tabs,
      body));
  const barTick = setInterval(drawBar, 2000);
  show(tab);
  return () => {
    alive = false;
    clearInterval(barTick);
    stopGame();
  };
}

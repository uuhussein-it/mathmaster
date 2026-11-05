/**
 * The Realm: one walkable pixel world. The student's town (building plots,
 * town hall, shop and the guild portal with the class boss) sits beside a road
 * of topic shrines through three zones that open as topics are mastered.
 *
 * Around the world: a "next step" line with a Show me button, today's three
 * missions, quick buttons to jump to each place, and one panel that shows
 * whatever place the student tapped.
 */
import { h, mount, toast, prefs, burst, questionBody, answerLabel, LETTERS } from '../ui.js';
import { go } from '../router.js';
import { CHARACTERS } from '../characters.js';
import { profile, xpToNext, recordAnswer, addXp, awardBadge } from '../state.js';
import { account, adminApi as api } from '../account.js';
import { loadCurriculumIndex, loadCourse } from '../data.js';
import { loadPhaser, startGame } from '../realm/phaser.js';
import { worldScene, viewFor } from '../realm/worldScene.js';
import { heroFrames, buildingSprite, bossInfo, AURA } from '../realm/art.js';
import { ZONES, NEED_PCT, loadNodes, layout, rememberZones, openZones, startNode } from '../realm/world.js';
import * as eco from '../realm/economy.js';
import * as missions from '../realm/missions.js';

const ZONE_UNLOCKS = { plains: ['farm', 'mill'], forest: ['quarry', 'mine'], citadel: ['library', 'tower'] };
const BOSS_TRAIT = {
  sage: 'Arcane Focus: your combo keeps growing up to 10 right answers in a row (others stop at 5).',
  warrior: 'Battle Fury: every hit on a boss does 50% more damage.',
  explorer: 'Weak Spot: each hit has a 1 in 4 chance to be a critical hit for double damage.',
};
const POLL_MS = 6000;

const fmtTime = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
};
const n0 = (v) => Math.floor(v).toLocaleString();
const resIcon = (k) => (k === 'insight' ? eco.INSIGHT.icon : eco.RESOURCES[k].icon);

function pixel(c, size, cls = '') {
  const el = h('canvas.pixel', { width: c.width, height: c.height, class: cls, style: { width: `${size}px`, height: `${size * (c.height / c.width)}px` }, 'aria-hidden': 'true' });
  el.getContext('2d').drawImage(c, 0, 0);
  return el;
}

const heroLook = () => ({ character: profile.character, tier: eco.tierOf(profile.level), wear: { ...eco.realm().wear } });

export function renderRealm(app) {
  eco.realm();
  let alive = true;
  let game = null;
  let zones = null;
  let guild = null;         // the class's boss state from the server
  let lastLog = 0;
  let open = { kind: 'help' }; // what the panel shows
  let dialog = null;        // boss question
  let questions = null;
  let used = new Set();
  const path = prefs.get('realm-path', 'course');
  const scene = () => game?.scene?.getScene('world');

  const bar = h('div.realm-bar', { 'aria-label': 'Your resources' });
  const guide = h('div.realm-guide');
  const stage = h('div.realm-stage.world', {}, h('p.realm-loading', {}, 'Loading your realm…'));
  const overlay = h('div.realm-dialog', { hidden: true });
  const panel = h('div.panel.realm-panel.realm-context');
  const missionBox = h('div.panel.realm-panel.realm-missions');
  const jumps = h('div.realm-jumps');

  // ------------------------------------------------------------ top bits
  function drawBar() {
    const r = eco.realm();
    bar.replaceChildren(
      ...Object.entries(eco.RESOURCES).map(([k, res]) => h('span.res', { title: res.name }, h('i', { 'aria-hidden': 'true' }, res.icon), h('b', {}, n0(r.res[k])), h('small', {}, res.name))),
      h('span.res.insight', { title: 'Insight: earned by answering questions right' }, h('i', { 'aria-hidden': 'true' }, eco.INSIGHT.icon), h('b', {}, n0(eco.insight())), h('small', {}, 'Insight')));
  }

  const masteredCount = () => (zones ? zones.flatMap((z) => z.nodes).filter((n) => n.m.mastered).length : null);

  /** The one thing to do next, and where it is in the world. */
  function nextStep() {
    const ms = missions.daily(masteredCount());
    if (ms.some((m) => m.complete && !m.claimed)) return { text: 'You finished a mission! Claim its reward in Today’s missions.', key: null };
    if (missions.chestReady()) return { text: 'All missions done! Open today’s chest.', key: null };
    if (guild?.rewards?.length) return { text: 'Your class beat a boss! Claim your reward at the Guild Portal.', key: 'portal' };
    const r = eco.realm();
    const now = Date.now();
    if (!r.buildings.length) return { text: 'Build your first Farm: tap an empty plot in your town.', key: 'plot:0,0' };
    const ready = r.buildings.find((b) => eco.pending(b, now) >= Math.max(5, eco.ratePerHour(b) * 0.5));
    if (ready) return { text: `Your ${eco.BUILDINGS[ready.type].name} has resources ready. Tap it to collect.`, key: `plot:${ready.x},${ready.y}` };
    const topic = zones?.flatMap((z) => (z.open ? z.nodes : [])).find((n) => !n.m.mastered);
    if (topic) return { text: `Practice “${topic.name}” on the road east (${Math.min(topic.m.correct, topic.m.need)} of ${topic.m.need} right answers).`, key: `topic:${topic.key}` };
    if (guild && !guild.boss.defeated) return { text: 'Help your class: attack the boss at the Guild Portal.', key: 'boss' };
    return { text: 'Great work! Upgrade your buildings or visit the shop.', key: 'shop' };
  }

  let guideSig = '';
  function drawGuide() {
    const step = nextStep();
    const sig = JSON.stringify(step) + !!scene();
    if (sig === guideSig) return;
    guideSig = sig;
    scene()?.pointAt(step.key);
    guide.replaceChildren(...[
      h('span.realm-guide-icon', { 'aria-hidden': 'true' }, '👉'),
      h('span', {}, h('b', {}, 'Next: '), step.text),
      step.key && h('button.btn.primary.sm', { onclick: () => scene()?.visit(step.key) }, 'Show me')].filter(Boolean));
  }

  let missionSig = '';
  function drawMissions() {
    const list = missions.daily(masteredCount());
    const chest = missions.chestReady();
    const doneAll = eco.realm().daily?.chest;
    const sig = JSON.stringify([list, chest, doneAll]);
    missionChip.classList.toggle('ready', chest || list.some((m) => m.complete && !m.claimed));
    if (sig === missionSig) return;
    missionSig = sig;
    missionBox.replaceChildren(
      h('h3', {}, '📜 Today’s missions'),
      h('ul.realm-mission-list', {}, list.map((m) => h('li', { class: m.claimed ? 'claimed' : m.complete ? 'complete' : '' },
        h('span.realm-mission-icon', { 'aria-hidden': 'true' }, m.claimed ? '✅' : m.icon),
        h('div', {},
          h('b', {}, m.text),
          h('div.meter', {}, h('i', { style: { width: `${(m.progress / m.goal) * 100}%` } })),
          h('small', {}, `${m.progress} / ${m.goal} · Reward: 🪙 ${m.reward.gold} + ✨ ${m.reward.insight}`)),
        m.complete && !m.claimed && h('button.btn.primary.sm', {
          onclick: () => {
            const got = missions.claim(m.id);
            if (got) { toast('Mission complete!', `🪙 ${got.gold} gold and ✨ ${got.insight} Insight.`, { icon: m.icon, tone: 'level' }); burst(); }
            refreshAll();
          },
        }, 'Claim')))),
      h('div.realm-chest', { class: chest ? 'ready' : doneAll ? 'opened' : '' },
        h('span', { 'aria-hidden': 'true' }, doneAll ? '📭' : '🎁'),
        h('span', {}, doneAll ? 'Chest opened. New missions tomorrow!' : `Finish all 3 for a chest: 🪙 ${missions.CHEST.gold} + ✨ ${missions.CHEST.insight}`),
        chest && h('button.btn.primary.sm', {
          onclick: () => {
            const got = missions.openChest();
            if (got) { toast('Daily chest!', `🪙 ${got.gold} gold and ✨ ${got.insight} Insight.`, { icon: '🎁', tone: 'level' }); burst(); }
            refreshAll();
          },
        }, 'Open')));
  }

  function drawJumps() {
    const topic = zones?.flatMap((z) => (z.open ? z.nodes : [])).find((n) => !n.m.mastered) || zones?.[0]?.nodes[0];
    const go2 = (key) => () => scene()?.visit(key);
    jumps.replaceChildren(...[
      h('button.chip', { onclick: go2('hall') }, '🏰 Town Hall'),
      h('button.chip', { onclick: go2('plots') }, '🌱 Plots'),
      h('button.chip', { onclick: go2('shop') }, '🛒 Shop'),
      h('button.chip', { onclick: go2('boss') }, '🐉 Boss'),
      topic && h('button.chip', { onclick: go2(`topic:${topic.key}`) }, '⭐ Next topic'),
      isFull && missionChip].filter(Boolean));
  }

  function refreshAll() {
    drawBar();
    drawGuide();
    drawMissions();
    drawPanel();
    scene()?.sync();
  }

  function act(fn) {
    try {
      const out = fn();
      refreshAll();
      return out;
    } catch (e) {
      toast('Realm', e.message, { icon: '⚠️', tone: 'danger' });
      return null;
    }
  }

  // ------------------------------------------------------------ panels
  let panelSig = '';
  function drawPanel(force = true) {
    const sig = signature();
    if (!force && sig === panelSig) { updateCountdowns(); return; }
    panelSig = sig;
    const body = {
      help: helpPanel, hall: hallPanel, shop: shopPanel, plots: plotsPanel, plot: plotPanel,
      topic: topicPanel, gate: gatePanel, boss: bossPanel,
    }[open.kind]();
    panel.replaceChildren(...[body].flat(Infinity).filter(Boolean));
  }

  // Redraw on the timer only when something visible changed, so a button isn't swapped under a tap.
  function signature() {
    const now = Date.now();
    const b = open.kind === 'plot' && eco.realm().buildings.find((v) => v.x === open.x && v.y === open.y);
    const extra = b ? [b.uid, b.level, eco.isBuilding(b, now), Math.floor(eco.pending(b, now)), eco.isBuilding(b, now) && eco.finishCost(b, now)] : [];
    const skill = open.kind === 'hall' ? eco.skillReadyAt(profile.character) > now : null;
    return JSON.stringify([open.kind, open.x, open.y, open.key, extra, skill, eco.insight(), eco.realm().res, guild?.boss, guild?.rewards?.length, guild?.me]);
  }
  const countdowns = [];
  function updateCountdowns() { countdowns.forEach((fn) => fn()); }

  function helpPanel() {
    return [
      h('h3', {}, 'How to play'),
      h('ul.realm-help', {},
        h('li', {}, h('b', {}, 'Walk: '), 'tap anywhere on the map (or use the arrow keys / WASD).'),
        h('li', {}, h('b', {}, 'Use a place: '), 'tap it, or stand next to it and press E.'),
        h('li', {}, '🌱 ', h('b', {}, 'Plots: '), 'build farms and mines. They make resources while you’re away.'),
        h('li', {}, '⭐ ', h('b', {}, 'Topic shrines: '), `practice a topic until you get ${NEED_PCT}% right. Master every topic in a zone to open the gate to the next.`),
        h('li', {}, '✨ ', h('b', {}, 'Insight: '), 'every right answer earns one. Spend it to finish buildings instantly.'),
        h('li', {}, '🛒 ', h('b', {}, 'Shop: '), 'spend gold on hats, auras, banners and decorations.'),
        h('li', {}, '🐉 ', h('b', {}, 'Guild Portal: '), 'answer questions to hit your class’s boss together.')),
    ];
  }

  function hallPanel() {
    const hero = CHARACTERS[profile.character];
    const skill = eco.REALM_SKILLS[profile.character];
    const look = heroLook();
    const tier = eco.TIERS[look.tier];
    const nextTier = eco.TIERS[look.tier + 1];
    const big = pixel(heroFrames(look.character, look.tier, look.wear)[0], 96, 'realm-hero-art');
    if (look.wear.aura) big.style.filter = `drop-shadow(0 0 10px ${AURA[look.wear.aura]})`;
    const need = xpToNext(profile.level);
    const left = eco.skillReadyAt(profile.character) - Date.now();
    const skillBtn = h('button.btn.primary', {
      disabled: left > 0,
      onclick: () => act(() => toast(skill.name, eco.useSkill(profile.character), { icon: skill.icon, tone: 'level' })),
    }, left > 0 ? `${skill.icon} Ready in ${fmtTime(left)}` : `${skill.icon} Use ${skill.name}`);
    countdowns.length = 0;
    if (left > 0) countdowns.push(() => { skillBtn.textContent = `${skill.icon} Ready in ${fmtTime(eco.skillReadyAt(profile.character) - Date.now())}`; });
    return [
      h('div.realm-hall-head', {},
        h('div.realm-hero-stage', { style: { '--hero': hero.color } }, big),
        h('div', {},
          h('p.eyebrow', {}, `Town Hall · ${hero.name} · ${tier.name}`),
          h('h3', {}, profile.name),
          h('p.muted', {}, `Level ${profile.level} · ${profile.xp} / ${need} XP`),
          h('div.meter', {}, h('i', { style: { width: `${(profile.xp / need) * 100}%` } })),
          h('p', {}, nextTier ? `Your hero evolves into ${nextTier.name} at level ${nextTier.min}.` : 'Fully evolved: a true Legend!'))),
      h('div.realm-tiers', {}, eco.TIERS.map((t, i) => h('div.realm-tier', { class: i <= look.tier ? 'have' : '' },
        pixel(heroFrames(look.character, i, {})[0], 36), h('small', {}, t.name), h('small', {}, `Lv ${t.min}`)))),
      h('dl.realm-skill-list', {},
        h('dt', {}, `${skill.icon} ${skill.name} (realm skill)`), h('dd', {}, `${skill.text} Recharges every ${skill.cooldownH} hours.`),
        h('dt', {}, `🛡️ ${hero.passive.name}`), h('dd', {}, hero.passive.text),
        h('dt', {}, `${hero.skill.icon} ${hero.skill.name}`), h('dd', {}, `In Practice and Quiz: ${hero.skill.text}`),
        h('dt', {}, '🐉 Boss trait'), h('dd', {}, BOSS_TRAIT[profile.character])),
      h('div.realm-actions', {}, skillBtn,
        h('button.btn.ghost', { onclick: () => go('select') }, 'Change class'),
        h('div.chips', { role: 'group', 'aria-label': 'Topics on the road' },
          [['course', '📘 Course road'], ['sat', '🎯 SAT road']].map(([v, l]) => h('button.chip', {
            role: 'radio', 'aria-checked': String(path === v), onclick: () => { prefs.set('realm-path', v); go('realm'); },
          }, l)))),
    ];
  }

  function shopPanel() {
    const r = eco.realm();
    const buy = (s) => act(() => {
      eco.buy(s.id);
      toast('Bought!', s.slot === 'decor' ? `${s.name}. Tap an empty plot to place it.` : `${s.name}. You’re wearing it now.`, { icon: s.icon, tone: 'level' });
      scene()?.setHero(heroLook());
    });
    const wear = (slot, id) => act(() => { eco.wear(slot, id); scene()?.setHero(heroLook()); });
    const slots = [['hat', 'Hats'], ['aura', 'Auras'], ['banner', 'Banners for your town hall'], ['decor', 'Decorations for your plots']];
    return [
      h('h3', {}, '🛒 Shop'),
      h('p.muted', {}, `You have 🪙 ${n0(r.res.gold)} gold. Gold Mines make more.`),
      ...slots.map(([slot, title]) => h('div', {},
        h('h4', {}, title),
        h('div.realm-items', {}, eco.STORE.filter((s) => s.slot === slot).map((s) => {
          const owned = eco.owns(s.id);
          const worn = r.wear[slot] === s.id;
          let action;
          if (slot === 'decor') action = h('button.btn.sm', { onclick: () => buy(s), disabled: r.res.gold < s.price }, `Buy · 🪙 ${s.price}`);
          else if (worn) action = h('button.btn.ghost.sm', { onclick: () => wear(slot, null) }, 'Take off');
          else if (owned) action = h('button.btn.sm', { onclick: () => wear(slot, s.id) }, 'Wear');
          else action = h('button.btn.sm', { onclick: () => buy(s), disabled: r.res.gold < s.price }, `Buy · 🪙 ${s.price}`);
          return h('div.realm-item', { class: worn ? 'worn' : '' },
            slot === 'decor' ? pixel(buildingSprite(s.id), 36) : h('span.realm-item-icon', { 'aria-hidden': 'true' }, s.icon),
            h('b', {}, s.name),
            slot === 'decor' && eco.decorLeft(s.id) > 0 && h('small', {}, `${eco.decorLeft(s.id)} to place`),
            worn && h('small', {}, 'Wearing'),
            action);
        })))),
    ];
  }

  function plotsPanel() {
    const r = eco.realm();
    const now = Date.now();
    const ready = r.buildings.filter((b) => eco.pending(b, now) >= 1).length;
    return [
      h('h3', {}, '🌱 Building plots'),
      h('p.muted', {}, 'Tap an empty plot to build on it. Tap a building to collect, upgrade or speed it up.'),
      h('div.realm-actions', {},
        h('button.btn.primary', {
          disabled: !ready,
          onclick: () => act(() => {
            const got = eco.collectAll();
            const text = Object.entries(got).map(([k, v]) => `+${v} ${resIcon(k)}`).join('  ');
            if (text) toast('Collected', text, { icon: '🧺', tone: 'level' });
          }),
        }, ready ? `🧺 Collect all (${ready})` : '🧺 Nothing to collect yet')),
      h('ul.realm-owned', {}, Object.entries(eco.BUILDINGS).map(([type, def]) => h('li', {},
        pixel(buildingSprite(type), 28), h('span', {}, `${def.name}: ${eco.countOf(type)} of ${def.max}`)))),
    ];
  }

  function plotPanel() {
    const { x, y } = open;
    const r = eco.realm();
    const now = Date.now();
    const b = r.buildings.find((v) => v.x === x && v.y === y);
    const d = r.decor.find((v) => v.x === x && v.y === y);
    countdowns.length = 0;
    if (d) {
      return [h('h3', {}, eco.STORE_BY_ID[d.type].name),
        h('div.realm-actions', {}, h('button.btn.ghost', { onclick: () => act(() => eco.removeDecor(d.uid)) }, 'Put it away'))];
    }
    if (!b) {
      const zonesOpen = openZones();
      const decor = eco.STORE.filter((s) => s.slot === 'decor' && eco.decorLeft(s.id) > 0);
      return [
        h('h3', {}, '🌱 Empty plot'),
        h('p.muted', {}, 'Choose what to build here.'),
        h('div.realm-builds', {}, Object.entries(eco.BUILDINGS).map(([type, def]) => {
          const why = eco.whyNot(type, zonesOpen);
          const { cost } = eco.stepCost(type, 0);
          const makes = def.makes ? `+${def.rate} ${resIcon(def.makes)}/h` : '+20% output';
          return h('button.realm-build', {
            type: 'button', class: why ? 'locked' : '', title: def.text,
            onclick: () => {
              if (why) { toast(def.name, why, { icon: '🔒', tone: 'danger' }); return; }
              act(() => {
                eco.place(type, x, y, zonesOpen);
                toast('Construction started', `${def.name}. Spend ✨ Insight to finish it now.`, { icon: '🔨', tone: 'level' });
              });
            },
          }, pixel(buildingSprite(type), 36),
          h('span', {}, h('b', {}, def.name), h('small', {}, `${makes} · ${eco.countOf(type)}/${def.max}`), h('small.cost', {}, eco.fmtCost(cost)),
            why && h('small.why', {}, why)));
        })),
        decor.length > 0 && h('h4', {}, 'Your decorations'),
        decor.length > 0 && h('div.realm-builds', {}, decor.map((s) => h('button.realm-build', {
          type: 'button', onclick: () => act(() => eco.placeDecor(s.id, x, y)),
        }, pixel(buildingSprite(s.id), 36), h('span', {}, h('b', {}, s.name), h('small', {}, `${eco.decorLeft(s.id)} to place`))))),
      ];
    }
    const def = eco.BUILDINGS[b.type];
    const busy = eco.isBuilding(b, now);
    const icon = def.makes ? resIcon(def.makes) : '';
    const next = b.level < eco.maxLevel ? eco.stepCost(b.type, b.level) : null;
    const rate = eco.ratePerHour(b);
    const clock = h('span', {}, fmtTime(b.readyAt - now));
    if (busy) countdowns.push(() => { clock.textContent = fmtTime(b.readyAt - Date.now()); });
    return [
      h('div.realm-info-head', {}, pixel(buildingSprite(busy ? 'scaffold' : b.type), 44),
        h('div', {}, h('h3', {}, `${def.name} · level ${b.level}`), h('p.muted', {}, def.text))),
      busy ? h('p', {}, `🔨 ${b.level > 1 ? 'Upgrading' : 'Building'}: `, clock, ' left.')
        : def.makes && h('p', {}, `Makes ${rate % 1 ? rate.toFixed(1) : rate} ${icon} per hour. Holding ${n0(eco.pending(b, now))} of ${n0(rate * eco.CAP_HOURS)}${eco.isFull(b, now) ? ' (full: collect it!)' : ''}.`),
      h('div.realm-actions', {},
        busy && h('button.btn.primary', { onclick: () => act(() => eco.finishNow(b.uid)) }, `✨ Finish now (${eco.finishCost(b, now)})`),
        !busy && def.makes && h('button.btn.primary', { disabled: eco.pending(b, now) < 1, onclick: () => act(() => eco.collect(b.uid)) }, `🧺 Collect ${n0(eco.pending(b, now))} ${icon}`),
        !busy && def.makes && def.makes !== 'insight' && h('button.btn', {
          onclick: () => act(() => { const [k, v] = eco.rush(b.uid); toast('Rushed!', `+${v} ${resIcon(k)} right away.`, { icon: '✨', tone: 'level' }); }),
        }, `✨ Rush 2h (${eco.RUSH_COST})`),
        !busy && next && h('button.btn', { disabled: !eco.canAfford(next.cost), onclick: () => act(() => eco.upgrade(b.uid)) }, `⬆️ Level ${b.level + 1}: ${eco.fmtCost(next.cost)}`),
        h('button.btn.ghost.danger', { onclick: () => { if (confirm(`Demolish this ${def.name}? You won’t get its resources back.`)) act(() => eco.demolish(b.uid)); } }, 'Demolish')),
    ];
  }

  function topicPanel() {
    const n = open.node;
    const m = n.m;
    return [
      h('p.eyebrow', {}, `${open.zone.name} · ${n.group}`),
      h('h3', {}, `⭐ ${n.name}`),
      h('div.realm-meter', {},
        h('div', {}, h('span', {}, 'Right answers'), h('b', {}, `${Math.min(m.correct, m.need)} / ${m.need}`)),
        h('div.meter', {}, h('i', { style: { width: `${Math.min(100, (m.correct / m.need) * 100)}%` } }))),
      h('div.realm-meter', {},
        h('div', {}, h('span', {}, 'Accuracy'), h('b', {}, m.seen ? `${m.pct}%` : '—')),
        h('div.meter', { class: m.pct >= NEED_PCT ? 'good' : '' }, h('i', { style: { width: `${m.pct}%` } }), h('em', { style: { left: `${NEED_PCT}%` } }))),
      h('p', { class: m.mastered ? 'realm-good' : 'muted' }, m.mastered ? '★ Mastered! Practice keeps it strong.'
        : `To master it: ${m.need} right answers and ${NEED_PCT}% accuracy. Every right answer also earns ✨ Insight.`),
      h('div.realm-actions', {},
        h('button.btn.primary', { onclick: () => startNode(n, 'practice', go) }, '📘 Practice'),
        h('button.btn', { onclick: () => startNode(n, 'quiz', go) }, '⏱️ Quiz')),
    ];
  }

  function gatePanel() {
    const z = open.zone;
    const i = ZONES.findIndex((x) => x.id === z.id);
    const prev = zones[i - 1];
    const left = prev.nodes.filter((n) => !n.m.mastered).map((n) => n.name);
    return [
      h('p.eyebrow', {}, z.open ? 'Gate open' : 'Locked gate'),
      h('h3', {}, `${z.icon} ${z.name}`),
      z.open ? h('p', {}, 'The gate is open. Walk on!')
        : h('div', {},
          h('p.muted', {}, `Master every topic in ${prev.name} to open this gate. It also unlocks the ${ZONE_UNLOCKS[z.id].map((b) => eco.BUILDINGS[b].name).join(' and ')} for your town.`),
          left.length > 0 && h('p', {}, 'Still to master: ', h('b', {}, left.join(', ')))),
    ];
  }

  function bossPanel() {
    if (!guild) return [h('h3', {}, '🐉 Guild Portal'), h('p.muted', {}, 'Opening the portal…')];
    const b = guild.boss;
    const info = bossInfo(b.n);
    const pct = (b.hp / b.max_hp) * 100;
    return [
      h('p.eyebrow', {}, `Guild: ${guild.group.name} · Boss ${b.n}`),
      h('h3.realm-boss-name', {}, info.name),
      h('div.realm-hp', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': b.max_hp, 'aria-valuenow': b.hp, 'aria-label': 'Boss health' },
        h('i', { style: { width: `${pct}%` } }), h('span', {}, `${n0(b.hp)} / ${n0(b.max_hp)}`)),
      b.defeated ? h('p.realm-good', {}, `🏆 ${info.name} has fallen! The next boss arrives in ${fmtTime(b.next_in * 1000)}.`)
        : h('p.muted', {}, 'Your whole class shares this boss. Every right answer hits it.'),
      guild.rewards.map((r) => h('div.realm-reward', {},
        h('span', {}, `🎁 ${bossInfo(r.boss).name}: 🪙 ${r.gold} + ✨ ${r.insight}`),
        h('button.btn.primary.sm', { onclick: () => claimBoss(r) }, 'Claim'))),
      !b.defeated && h('div.realm-actions', {}, h('button.btn.primary.lg', { onclick: () => ask() }, '⚔️ Attack: answer a question')),
      h('p', {}, `Your damage: `, h('b', {}, n0(guild.me.damage)), ` · Hits: ${guild.me.hits} · Combo: ${guild.me.combo}`),
      h('p.muted', {}, BOSS_TRAIT[profile.character]),
      guild.top.length > 0 && h('div', {}, h('h4', {}, `Top fighters (${guild.fighters})`),
        h('ol.realm-fighters', {}, guild.top.slice(0, 5).map((t) => h('li', { class: t.me ? 'me' : '' }, h('span', {}, t.me ? 'You' : t.name), h('b', {}, n0(t.damage)))))),
    ];
  }

  function openPlace(target) {
    open = target;
    sheetMissions = false;
    drawPanel();
    drawSheet();
    if (!isFull && innerWidth < 900) {
      const r = panel.getBoundingClientRect();
      if (r.top > innerHeight - 80) panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  // ------------------------------------------------------------ the boss
  function applyGuild(next) {
    const prev = guild;
    guild = next;
    const sc = scene();
    if (sc) {
      if (prev) {
        next.log.filter((l) => l.id > lastLog && !l.me).reverse().forEach((l, i) => setTimeout(() => sc.ally(l), i * 250));
        if (!prev.boss.defeated && next.boss.defeated && prev.boss.n === next.boss.n) sc.fallen();
      }
      sc.setBoss(next.boss.n, next.boss.defeated);
    }
    lastLog = Math.max(lastLog, 0, ...next.log.map((l) => l.id));
  }

  async function pollGuild() {
    try {
      applyGuild(await api('api/guild'));
      drawGuide();
      if (open.kind === 'boss') drawPanel(false);
    } catch { /* try again on the next poll */ }
  }

  async function claimBoss(r) {
    try {
      const got = await api('api/guild/claim', { method: 'POST', body: { boss: r.boss } });
      eco.claimReward(`boss-${guild.group.id}-${got.boss}`, got);
      awardBadge({ id: `slayer-${guild.group.id}-${got.boss}`, name: `Slayer of the ${bossInfo(got.boss).name}`, icon: '🐉' });
      toast('Reward claimed!', `🪙 ${got.gold} gold and ✨ ${got.insight} Insight.`, { icon: '🎁', tone: 'level' });
      burst();
      await pollGuild();
      refreshAll();
    } catch (e) { toast('Guild', e.message, { icon: '⚠️', tone: 'danger' }); }
  }

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

  async function ask() {
    try {
      const qs = await loadQuestions();
      if (!qs.length) throw new Error('Your course has no multiple-choice questions with answer keys yet.');
      let pool = qs.filter((q) => !used.has(q.ref));
      if (!pool.length) { used = new Set(); pool = qs; }
      const q = pool[Math.floor(Math.random() * pool.length)];
      used.add(q.ref);
      scene()?.visit('boss');
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
      if (hit.damage) { eco.bump('bossHits'); scene()?.strike(hit); } else if (!hit.correct) scene()?.miss();
      applyGuild(out);
      refreshAll();
    } catch (e) {
      dialog.state = 'ask';
      toast('Guild', e.message, { icon: '⚠️', tone: 'danger' });
      pollGuild();
    }
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
      h('p.realm-dialog-title', {}, `🐉 ${bossInfo(guild.boss.n).name} · ${q.topicName}`),
      h('div.realm-q', {}, questionBody(q)),
      opts,
      note,
      h('div.realm-actions', {},
        done && !guild.boss.defeated && h('button.btn.primary', { onclick: () => ask() }, 'Next question ▶'),
        h('button.btn.ghost', { onclick: () => { dialog = null; drawDialog(); } }, done ? 'Close' : 'Back away'))));
  }

  // ------------------------------------------------------------ full screen
  // In full screen the map fills the whole screen and shows more of the world.
  // The guide floats on top, the place buttons along the bottom, and a place's
  // panel (or today's missions) opens as a sheet over the map. Phones without
  // the browser's full-screen mode (iPhone) get the same view drawn over the page.
  let view = null;
  let isFull = false;
  let sheetMissions = false;
  const fsBtn = h('button.realm-fs-btn', { type: 'button', onclick: () => toggleFull() });
  const wrap = h('div.realm-stage-wrap', {}, stage, overlay, fsBtn);
  const main = h('div.realm-main', {}, wrap, jumps, panel);
  const side = h('div.realm-side', {}, missionBox);
  const layoutEl = h('div.realm-layout', {}, main, side);
  const closeSheet = h('button.realm-sheet-close', {
    type: 'button', 'aria-label': 'Close',
    onclick: () => { open = { kind: 'help' }; sheetMissions = false; drawPanel(); drawSheet(); },
  }, '✕');
  const sheet = h('div.realm-sheet', { hidden: true });
  const dock = h('div.realm-dock', {}, sheet, jumps);
  const missionChip = h('button.chip.realm-mission-chip', {
    type: 'button',
    onclick: () => { sheetMissions = !sheetMissions || open.kind !== 'help'; open = { kind: 'help' }; drawPanel(); drawSheet(); },
  }, '📜 Missions');
  const fsRoot = h('div.realm-fs', {}, guide, layoutEl);
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;

  function drawFsBtn() {
    fsBtn.textContent = isFull ? '✕ Exit' : '⛶ Full screen';
    fsBtn.setAttribute('aria-label', isFull ? 'Exit full screen' : 'Play full screen');
  }

  function drawSheet() {
    const showPanel = open.kind !== 'help' && !sheetMissions;
    sheet.hidden = !isFull || !(showPanel || sheetMissions);
    panel.hidden = isFull && !showPanel;
    missionBox.hidden = isFull && !sheetMissions;
    missionChip.classList.toggle('on', isFull && sheetMissions);
  }

  function fit() {
    const sc = scene();
    if (!sc || !view) return;
    if (isFull) {
      const box = fsRoot.getBoundingClientRect();
      const w = Math.round(box.width);
      const hgt = Math.round(box.height);
      // Zoom in on big screens, but keep at least ~180 art pixels across and
      // never show more than the world is tall.
      const zoom = Math.max(2, Math.ceil(hgt / 352), Math.min(Math.ceil(hgt / 300), Math.floor(w / 180)));
      sc.fitView(w, hgt, zoom);
    } else {
      sc.fitView(view.width * view.zoom, view.height * view.zoom, view.zoom);
    }
    game.scale.refresh();
  }

  function setFull(on) {
    if (on === isFull) return;
    isFull = on;
    if (on) {
      sheet.replaceChildren(closeSheet, panel, missionBox);
      jumps.append(missionChip);
      fsRoot.replaceChildren(wrap, guide, dock);
    } else {
      missionChip.remove();
      main.replaceChildren(wrap, jumps, panel);
      side.replaceChildren(missionBox);
      fsRoot.replaceChildren(guide, layoutEl);
    }
    sheetMissions = false;
    fsRoot.classList.toggle('full', on);
    document.documentElement.classList.toggle('realm-locked', on);
    drawFsBtn();
    drawSheet();
    requestAnimationFrame(fit);
  }

  async function toggleFull() {
    if (isFull) {
      if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document)?.catch?.(() => {});
      setFull(false);
      return;
    }
    setFull(true);
    const ask = fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen;
    try { await ask?.call(fsRoot, { navigationUI: 'hide' }); } catch { /* the view over the page still works */ }
    requestAnimationFrame(fit);
  }

  // Leaving the browser's full screen (Esc, back gesture) leaves ours too.
  const onFsChange = () => { if (!fsElement() && isFull) setFull(false); else requestAnimationFrame(fit); };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  const onResize = () => { if (isFull) requestAnimationFrame(fit); };
  window.addEventListener('resize', onResize);
  drawFsBtn();

  const onKey = (e) => {
    if (!dialog && e.key === 'Escape' && isFull) { setFull(false); return; }
    if (!dialog) return;
    if (e.key === 'Escape') { dialog = null; drawDialog(); }
    const i = '1234'.indexOf(e.key);
    if (i >= 0 && i < dialog.q.options.length) answer(i);
  };
  window.addEventListener('keydown', onKey);

  // ------------------------------------------------------------ start
  mount(app,
    h('section.realm', {},
      h('div.crumbs', {}, h('button.link', { onclick: () => go('hub') }, '← Hub'), h('span', {}, 'The Realm')),
      h('div.realm-top', {}, h('h1.display', {}, 'The Realm'), bar),
      fsRoot));
  drawBar();
  drawMissions();
  drawPanel();
  drawGuide();

  (async () => {
    try {
      const [nodes] = await Promise.all([loadNodes(path), pollGuild()]);
      if (!alive) return;
      if (!nodes.length) throw new Error(path === 'sat' ? 'The SAT bank is empty right now.' : 'Your group has no course topics yet. Switch to the SAT road in the Town Hall.');
      zones = layout(nodes);
      rememberZones(zones);
      await Promise.race([document.fonts?.load("8px 'Press Start 2P'"), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
      const Phaser = await loadPhaser();
      if (!alive) return;
      stage.replaceChildren();
      view = viewFor(stage.clientWidth);
      stage.style.aspectRatio = `${view.width} / ${view.height}`;
      const api2 = {
        zones, hero: heroLook(),
        boss: () => guild?.boss || null,
        open: (target) => openPlace(target),
      };
      game = startGame(Phaser, stage, worldScene(Phaser, api2, view), view);
      game.events.once('ready', () => {});
      const wait = setInterval(() => {
        if (!scene()?.places) return;
        clearInterval(wait);
        drawJumps();
        refreshAll();
      }, 100);
    } catch (e) {
      mount(stage, h('p.realm-loading', {}, e.message));
    }
  })();

  const tick = setInterval(() => { drawBar(); drawPanel(false); drawGuide(); drawMissions(); }, 2000);
  const poll = setInterval(() => { if (!document.hidden) pollGuild(); }, POLL_MS);
  return () => {
    alive = false;
    clearInterval(tick);
    clearInterval(poll);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('webkitfullscreenchange', onFsChange);
    if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document)?.catch?.(() => {});
    document.documentElement.classList.remove('realm-locked');
    game?.destroy(true);
  };
}

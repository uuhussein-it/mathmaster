/**
 * The realm's rules: buildings, what they cost and produce, the hero's realm
 * skill, and the cosmetic store. Everything here is plain data and functions
 * over the realm state, which lives in the student's profile (profile.realm)
 * so it is saved with the rest of their progress and follows them between
 * devices.
 *
 * Time-based production is worked out from timestamps when the student looks,
 * so buildings keep producing while the site is closed. Each building holds
 * at most CAP_HOURS of output, so coming back after a week isn't a jackpot.
 *
 * Insight (✨) is earned by answering curriculum questions right (one per
 * right answer, anywhere on the site). It finishes construction instantly and
 * rushes a building's output, so studying is what speeds the realm up.
 */
import { profile, save } from '../state.js';

export const RESOURCES = {
  food: { name: 'Food', icon: '🌾' },
  wood: { name: 'Wood', icon: '🪵' },
  stone: { name: 'Stone', icon: '🪨' },
  gold: { name: 'Gold', icon: '🪙' },
};
export const INSIGHT = { name: 'Insight', icon: '✨' };

export const GRID = { w: 8, h: 6 }; // building plots in the town
export const CAP_HOURS = 8;
const RUSH_HOURS = 2;
export const RUSH_COST = 2;
const MAX_LEVEL = 5;

/**
 * Buildings. `zone` is the world-map zone that must be open before it can be
 * built (plains is open from the start). `rate` is output per hour at level 1.
 */
export const BUILDINGS = {
  farm: { name: 'Farm', zone: 'plains', makes: 'food', rate: 60, cost: { wood: 30 }, secs: 20, max: 4,
    text: 'Fields of wheat. Food feeds every other building project.' },
  mill: { name: 'Lumber Mill', zone: 'plains', makes: 'wood', rate: 45, cost: { food: 30 }, secs: 30, max: 3,
    text: 'Saws logs into planks for new buildings.' },
  quarry: { name: 'Quarry', zone: 'forest', makes: 'stone', rate: 30, cost: { wood: 80, food: 40 }, secs: 60, max: 3,
    text: 'Cuts stone from the hills. Opens with the Whispering Forest.' },
  mine: { name: 'Gold Mine', zone: 'forest', makes: 'gold', rate: 20, cost: { wood: 100, stone: 60 }, secs: 90, max: 2,
    text: 'Digs gold for the cosmetic store. Opens with the Whispering Forest.' },
  library: { name: 'Grand Library', zone: 'citadel', makes: 'insight', rate: 0.5, cost: { wood: 150, stone: 120, gold: 60 }, secs: 120, max: 1,
    text: 'Scholars write new Insight, slowly. Opens with the Citadel.' },
  tower: { name: 'Arcane Tower', zone: 'citadel', makes: null, rate: 0, cost: { stone: 250, gold: 150 }, secs: 180, max: 2,
    text: 'Every tower makes all your buildings produce 20% more. Opens with the Citadel.' },
};

export const START = { food: 120, wood: 120, stone: 40, gold: 60 };

/** Hero realm skills, one per class, each with a cooldown. */
export const REALM_SKILLS = {
  sage: { name: 'Arcane Study', icon: '📖', cooldownH: 12, text: 'Gain 3 Insight on the spot.' },
  warrior: { name: 'Rally the Workers', icon: '📯', cooldownH: 8, text: 'Every building produces twice as fast for 1 hour.' },
  explorer: { name: 'Forage', icon: '🧺', cooldownH: 6, text: 'Bring back 2 hours of food and wood from the wilds.' },
};

/** Cosmetics bought with gold. Decorations are placed on the base grid. */
export const STORE = [
  { id: 'hat-wizard', slot: 'hat', name: 'Wizard Hat', icon: '🎩', price: 120 },
  { id: 'hat-laurel', slot: 'hat', name: 'Laurel Wreath', icon: '🌿', price: 200 },
  { id: 'hat-horns', slot: 'hat', name: 'Horned Helm', icon: '🪖', price: 260 },
  { id: 'hat-crown', slot: 'hat', name: 'Royal Crown', icon: '👑', price: 450 },
  { id: 'aura-ember', slot: 'aura', name: 'Ember Aura', icon: '🔥', price: 300 },
  { id: 'aura-frost', slot: 'aura', name: 'Frost Aura', icon: '❄️', price: 300 },
  { id: 'aura-star', slot: 'aura', name: 'Starlight Aura', icon: '🌟', price: 650 },
  { id: 'banner-red', slot: 'banner', name: 'Crimson Banner', icon: '🟥', price: 80 },
  { id: 'banner-green', slot: 'banner', name: 'Emerald Banner', icon: '🟩', price: 80 },
  { id: 'banner-gold', slot: 'banner', name: 'Golden Banner', icon: '🟨', price: 160 },
  { id: 'decor-flowers', slot: 'decor', name: 'Flower Bed', icon: '🌷', price: 40 },
  { id: 'decor-lantern', slot: 'decor', name: 'Lantern', icon: '🏮', price: 60 },
  { id: 'decor-statue', slot: 'decor', name: 'Hero Statue', icon: '🗿', price: 180 },
  { id: 'decor-fountain', slot: 'decor', name: 'Fountain', icon: '⛲', price: 260 },
];
export const STORE_BY_ID = Object.fromEntries(STORE.map((s) => [s.id, s]));

/** Visual evolution: the hero's look changes with their level. */
export const TIERS = [
  { min: 1, name: 'Novice' },
  { min: 5, name: 'Adept' },
  { min: 10, name: 'Champion' },
  { min: 15, name: 'Legend' },
];
export const tierOf = (level) => TIERS.reduce((t, x, i) => (level >= x.min ? i : t), 0);

const HOUR = 3600_000;

/** The realm state, created on first visit. */
export function realm() {
  if (!profile.realm || typeof profile.realm !== 'object') {
    profile.realm = {
      v: 1, res: { ...START }, buildings: [], decor: [], owned: [], wear: { hat: null, aura: null, banner: null },
      skillAt: 0, rallyFrom: 0, rallyUntil: 0, claimed: [], nextUid: 1,
    };
    save();
  }
  const r = profile.realm;
  r.res = { ...START, ...r.res };
  r.buildings ||= [];
  r.decor ||= [];
  r.owned ||= [];
  r.wear ||= {};
  r.claimed ||= [];
  r.stats ||= { collected: 0, built: 0, bossHits: 0 };
  // Older saves used a bigger grid: move anything outside the plots onto a free one.
  for (const list of [r.buildings, r.decor]) {
    for (const b of list) {
      if (b.x < GRID.w && b.y < GRID.h) continue;
      const free = freePlot(r);
      if (free) Object.assign(b, free);
    }
  }
  r.buildings = r.buildings.filter((b) => b.x < GRID.w && b.y < GRID.h);
  r.decor = r.decor.filter((b) => b.x < GRID.w && b.y < GRID.h);
  return r;
}

function freePlot(r) {
  for (let y = 0; y < GRID.h; y += 1) {
    for (let x = 0; x < GRID.w; x += 1) {
      if (![...r.buildings, ...r.decor].some((b) => b.x === x && b.y === y)) return { x, y };
    }
  }
  return null;
}

/** Count something for the daily missions. */
export function bump(key, n = 1) {
  const r = realm();
  r.stats[key] = (r.stats[key] || 0) + n;
  save();
}

export const insight = () => profile.insight || 0;

export function spendInsight(n) {
  if (insight() < n) return false;
  profile.insight -= n;
  save();
  return true;
}

export function addInsight(n) {
  profile.insight = insight() + n;
  save();
}

export const canAfford = (cost) => Object.entries(cost).every(([k, v]) => (realm().res[k] || 0) >= v);

function pay(cost) {
  const r = realm();
  for (const [k, v] of Object.entries(cost)) r.res[k] -= v;
}

/** Cost and build time to go from `level` to `level + 1` (level 0 = a new building). */
export function stepCost(type, level) {
  const def = BUILDINGS[type];
  const k = level === 0 ? 1 : 1.6 ** level;
  return {
    cost: Object.fromEntries(Object.entries(def.cost).map(([res, v]) => [res, Math.round(v * k)])),
    secs: Math.round(def.secs * (level + 1)),
  };
}

export const occupied = (x, y) => x < 0 || y < 0 || x >= GRID.w || y >= GRID.h
  || realm().buildings.some((b) => b.x === x && b.y === y)
  || realm().decor.some((d) => d.x === x && d.y === y);

export const countOf = (type) => realm().buildings.filter((b) => b.type === type).length;

/** Why a building can't be placed right now, or null. `openZones` is a Set of zone ids. */
export function whyNot(type, openZones) {
  const def = BUILDINGS[type];
  if (!openZones.has(def.zone)) return `Open the ${ZONE_NAMES[def.zone]} on the world map first.`;
  if (countOf(type) >= def.max) return `You have the most ${def.name}s allowed (${def.max}).`;
  if (!canAfford(stepCost(type, 0).cost)) return 'Not enough resources yet.';
  return null;
}

export const ZONE_NAMES = { plains: 'Golden Plains', forest: 'Whispering Forest', citadel: 'Sky Citadel' };

export function place(type, x, y, openZones, now = Date.now()) {
  const why = whyNot(type, openZones);
  if (why) throw new Error(why);
  if (occupied(x, y)) throw new Error('That tile is taken.');
  const r = realm();
  const { cost, secs } = stepCost(type, 0);
  pay(cost);
  const b = { uid: r.nextUid++, type, x, y, level: 1, readyAt: now + secs * 1000, collectedAt: now + secs * 1000, buildSecs: secs };
  r.buildings.push(b);
  r.stats.built = (r.stats.built || 0) + 1;
  save();
  return b;
}

export const building = (uid) => realm().buildings.find((b) => b.uid === uid);
export const isBuilding = (b, now = Date.now()) => now < b.readyAt;

export function upgrade(uid, now = Date.now()) {
  const b = building(uid);
  if (!b || isBuilding(b, now)) throw new Error('Wait for the work to finish.');
  if (b.level >= MAX_LEVEL) throw new Error('Already at the top level.');
  const { cost, secs } = stepCost(b.type, b.level);
  if (!canAfford(cost)) throw new Error('Not enough resources yet.');
  collect(uid, now); // bank what it made at the old rate
  pay(cost);
  b.level += 1;
  b.readyAt = now + secs * 1000;
  b.collectedAt = b.readyAt;
  b.buildSecs = secs;
  realm().stats.built += 1;
  save();
}

export const maxLevel = MAX_LEVEL;

/** Insight needed to finish a building's work now: 1 per started minute left. */
export const finishCost = (b, now = Date.now()) => Math.max(1, Math.ceil((b.readyAt - now) / 60_000));

export function finishNow(uid, now = Date.now()) {
  const b = building(uid);
  if (!b || !isBuilding(b, now)) return;
  if (!spendInsight(finishCost(b, now))) throw new Error('Not enough Insight. Answer questions right to earn more.');
  b.readyAt = now;
  b.collectedAt = now;
  save();
}

const towerBoost = () => 1 + 0.2 * realm().buildings.filter((b) => b.type === 'tower' && !isBuilding(b)).length;

/** Output per hour for a finished building, before Rally. */
export function ratePerHour(b) {
  const def = BUILDINGS[b.type];
  if (!def.makes) return 0;
  const boost = def.makes === 'insight' ? 1 : towerBoost();
  return def.rate * b.level * boost;
}

/** What a building has made since it was last collected (capped). */
export function pending(b, now = Date.now()) {
  if (isBuilding(b, now) || !BUILDINGS[b.type].makes) return 0;
  const r = realm();
  const from = b.collectedAt;
  const hours = Math.max(0, now - from) / HOUR;
  // Rally doubles output for the part of the time it overlaps.
  const rally = Math.max(0, Math.min(now, r.rallyUntil) - Math.max(from, r.rallyFrom)) / HOUR;
  const rate = ratePerHour(b);
  return Math.min(rate * CAP_HOURS, rate * (hours + rally));
}

export const isFull = (b, now = Date.now()) => pending(b, now) >= ratePerHour(b) * CAP_HOURS - 1e-9 && ratePerHour(b) > 0;

/** Bank a building's output; returns [resource, whole amount] or null. */
export function collect(uid, now = Date.now()) {
  const b = building(uid);
  if (!b) return null;
  const amount = Math.floor(pending(b, now));
  const makes = BUILDINGS[b.type].makes;
  if (!makes || amount < 1) return null;
  // Keep the fraction that didn't make a whole unit by moving the clock forward only for what was taken.
  const rate = ratePerHour(b);
  const taken = isFull(b, now) ? now : b.collectedAt + (amount / rate) * HOUR;
  b.collectedAt = Math.min(now, taken);
  if (makes === 'insight') profile.insight = insight() + amount;
  else {
    realm().res[makes] += amount;
    realm().stats.collected += amount;
  }
  save();
  return [makes, amount];
}

export function collectAll(now = Date.now()) {
  const got = {};
  for (const b of realm().buildings) {
    const c = collect(b.uid, now);
    if (c) got[c[0]] = (got[c[0]] || 0) + c[1];
  }
  return got;
}

/** Spend Insight to get RUSH_HOURS of a building's output right away. */
export function rush(uid, now = Date.now()) {
  const b = building(uid);
  const makes = b && BUILDINGS[b.type].makes;
  if (!makes || isBuilding(b, now)) throw new Error('This building has nothing to rush.');
  if (makes === 'insight') throw new Error('The library can’t be rushed.');
  if (!spendInsight(RUSH_COST)) throw new Error('Not enough Insight. Answer questions right to earn more.');
  const amount = Math.round(ratePerHour(b) * RUSH_HOURS);
  realm().res[makes] += amount;
  save();
  return [makes, amount];
}

export function demolish(uid) {
  const r = realm();
  r.buildings = r.buildings.filter((b) => b.uid !== uid);
  save();
}

// ---------------------------------------------------------------- hero skill
export const skillReadyAt = (character) => (realm().skillAt || 0) + REALM_SKILLS[character].cooldownH * HOUR;

export function useSkill(character, now = Date.now()) {
  const r = realm();
  if (now < skillReadyAt(character)) throw new Error('Your skill is still recharging.');
  let text;
  if (character === 'sage') {
    profile.insight = insight() + 3;
    text = '+3 Insight';
  } else if (character === 'warrior') {
    // Bank first so the doubled rate only applies from now on.
    collectAll(now);
    r.rallyFrom = now;
    r.rallyUntil = now + HOUR;
    text = 'All buildings ×2 for 1 hour';
  } else {
    const rate = (res) => r.buildings.filter((b) => BUILDINGS[b.type].makes === res && !isBuilding(b, now))
      .reduce((n, b) => n + ratePerHour(b), 0);
    const food = Math.max(40, Math.round(rate('food') * 2));
    const wood = Math.max(30, Math.round(rate('wood') * 2));
    r.res.food += food;
    r.res.wood += wood;
    text = `+${food} food, +${wood} wood`;
  }
  r.skillAt = now;
  save();
  return text;
}

// --------------------------------------------------------------------- store
export const owns = (id) => realm().owned.includes(id);
export const decorLeft = (id) => realm().owned.filter((x) => x === id).length - realm().decor.filter((d) => d.type === id).length;

export function buy(id) {
  const item = STORE_BY_ID[id];
  const r = realm();
  if (!item) throw new Error('Unknown item.');
  if (item.slot !== 'decor' && owns(id)) throw new Error('You already own this.');
  if (r.res.gold < item.price) throw new Error(`You need ${item.price - r.res.gold} more gold.`);
  r.res.gold -= item.price;
  r.owned.push(id);
  if (item.slot !== 'decor') r.wear[item.slot] = id;
  save();
}

export function wear(slot, id) {
  const r = realm();
  if (id && (!owns(id) || STORE_BY_ID[id].slot !== slot)) throw new Error('You don’t own that yet.');
  r.wear[slot] = id || null;
  save();
}

export function placeDecor(id, x, y) {
  if (decorLeft(id) < 1) throw new Error('Buy one in the store first.');
  if (occupied(x, y)) throw new Error('That tile is taken.');
  const r = realm();
  r.decor.push({ uid: r.nextUid++, type: id, x, y });
  save();
}

export function removeDecor(uid) {
  const r = realm();
  r.decor = r.decor.filter((d) => d.uid !== uid);
  save();
}

/** Boss rewards are claimed once per boss. */
export function claimReward(key, { gold = 0, insight: ins = 0 }) {
  const r = realm();
  if (r.claimed.includes(key)) return false;
  r.claimed.push(key);
  r.claimed = r.claimed.slice(-50);
  r.res.gold += gold;
  profile.insight = insight() + ins;
  save();
  return true;
}

export const fmtCost = (cost) => Object.entries(cost).map(([k, v]) => `${RESOURCES[k].icon} ${v}`).join('  ');

/**
 * The realm's three Phaser scenes: the world map, the student's base, and the
 * guild boss arena. Each is made by a factory that takes Phaser and an `api`
 * object from the realm screen, so the scenes only draw and report clicks;
 * the rules live in economy.js and world.js.
 */
import { tex, label } from './phaser.js';
import { T, heroFrames, buildingSprite, bannerSprite, grassTile, scenery, bossSprite, AURA, BANNER, CLASS_COLOR } from './art.js';
import { GRID, HALL, BUILDINGS, RESOURCES, INSIGHT, realm, isBuilding, pending, isFull } from './economy.js';

const EMOJI_FONT = 'system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

function heroTextures(scene, hero) {
  const key = `hero-${hero.character}-${hero.tier}-${hero.wear.hat || 'none'}`;
  if (!scene.textures.exists(`${key}-0`)) {
    heroFrames(hero.character, hero.tier, hero.wear).forEach((c, i) => scene.textures.addCanvas(`${key}-${i}`, c));
  }
  return [`${key}-0`, `${key}-1`];
}

/** A hero sprite that walks in place, with an aura glow if one is worn. */
function addHero(scene, hero, x, y) {
  const [a, b] = heroTextures(scene, hero);
  const glow = AURA[hero.wear.aura];
  const aura = glow ? scene.add.ellipse(x, y - 1, 18, 22, Phaser_color(glow), 0.22) : null;
  const sprite = scene.add.sprite(x, y, a).setOrigin(0.5, 0.75);
  let f = 0;
  scene.time.addEvent({ delay: 260, loop: true, callback: () => { f = 1 - f; sprite.setTexture(f ? b : a); } });
  if (aura) scene.tweens.add({ targets: aura, alpha: 0.08, scale: 1.15, duration: 900, yoyo: true, repeat: -1 });
  return { sprite, aura, move(nx, ny) { sprite.setPosition(nx, ny); aura?.setPosition(nx, ny + 2); } };
}

const Phaser_color = (hex) => parseInt(hex.replace('#', ''), 16);

// ------------------------------------------------------------- world map
export const MAP_SIZE = { width: 480, height: 240, zoom: 2 };
const ZONE_W = 160;
const ZONE_GROUND = {
  plains: ['#5aa04a', '#4f9141', '#68b357'],
  forest: ['#2f6b3a', '#285c32', '#3a7d45'],
  citadel: ['#8c93b8', '#7c83a8', '#9ca3c8'],
};
const ZONE_RING = { plains: '#ffd34d', forest: '#7ddc7a', citadel: '#b48cff' };

/** Where each node sits on the map (art pixels). */
export function nodePositions(zones) {
  const out = new Map();
  let g = 0;
  zones.forEach((z, zi) => {
    const k = z.nodes.length;
    z.nodes.forEach((n, i) => {
      const x = zi * ZONE_W + (k === 1 ? ZONE_W / 2 : 24 + ((ZONE_W - 48) * i) / (k - 1));
      const y = Math.max(52, Math.min(206, 132 + 58 * Math.sin(g * 1.25 + 0.6)));
      out.set(n.key, { x, y });
      g += 1;
    });
  });
  return out;
}

export function mapScene(Phaser, api) {
  return class MapScene extends Phaser.Scene {
    constructor() { super('map'); }

    create() {
      const { width: W, height: H, zoom } = MAP_SIZE;
      this.cameras.main.setZoom(zoom).centerOn(W / 2, H / 2);
      const zones = api.zones;
      const pos = nodePositions(zones);

      // Ground, one zone at a time.
      zones.forEach((z, zi) => {
        const colors = ZONE_GROUND[z.id];
        for (let i = 0; i < 4; i += 1) tex(this, `g-${z.id}-${i}`, () => grassTile(i + zi * 11 + 1, colors));
        for (let y = 0; y < H; y += T) {
          for (let x = zi * ZONE_W; x < (zi + 1) * ZONE_W; x += T) {
            this.add.image(x, y, `g-${z.id}-${(x * 7 + y * 13) % 4}`).setOrigin(0);
          }
        }
      });
      // A river between the plains and the forest, cliffs before the citadel.
      const gfx = this.add.graphics();
      gfx.fillStyle(0x3d7fd1, 1).fillRect(ZONE_W - 5, 0, 10, H);
      gfx.fillStyle(0x7fb8ff, 1).fillRect(ZONE_W - 3, 0, 2, H);
      gfx.fillStyle(0x5c556f, 1).fillRect(ZONE_W * 2 - 4, 0, 8, H);
      gfx.fillStyle(0x7c7593, 1).fillRect(ZONE_W * 2 - 4, 0, 2, H);

      // The road through every topic.
      const points = zones.flatMap((z) => z.nodes.map((n) => pos.get(n.key)));
      const road = [{ x: 4, y: points[0]?.y ?? H / 2 }, ...points, { x: W - 4, y: points.at(-1)?.y ?? H / 2 }];
      const curve = new Phaser.Curves.Spline(road.map((p) => new Phaser.Math.Vector2(p.x, p.y)));
      const path = this.add.graphics();
      path.lineStyle(9, 0x6b4a2b, 1);
      curve.draw(path, 128);
      path.lineStyle(6, 0xc9a36a, 1);
      curve.draw(path, 128);
      const roadPts = curve.getSpacedPoints(160);
      road.slice(1, -1).forEach((p) => roadPts.push(p));

      // Scenery, kept off the road.
      const SCENE = { plains: ['wheat', 'wheat', 'tree', 'house', 'rock'], forest: ['pine', 'pine', 'tree', 'pine', 'rock'], citadel: ['rock', 'rock', 'pine', 'rock', 'house'] };
      ['tree', 'pine', 'rock', 'wheat', 'house', 'castle', 'cloud'].forEach((id) => tex(this, `s-${id}`, () => scenery(id)));
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const props = [];
      zones.forEach((z, zi) => {
        const count = z.id === 'forest' ? 46 : 30;
        for (let i = 0; i < count; i += 1) {
          const x = zi * ZONE_W + 10 + rnd() * (ZONE_W - 20);
          const y = 30 + rnd() * (H - 34);
          if (roadPts.some((p) => Math.abs(p.x - x) < 14 && Math.abs(p.y - (y - 4)) < 14)) continue;
          props.push({ x, y, id: SCENE[z.id][Math.floor(rnd() * 5)] });
        }
      });
      props.sort((a, b) => a.y - b.y).forEach((p) => this.add.image(p.x, p.y, `s-${p.id}`).setOrigin(0.5, 1));
      this.add.image(W - 30, 70, 's-castle').setOrigin(0.5, 1).setScale(2.2);

      // Zone names, and fog over zones that are still closed.
      zones.forEach((z, zi) => {
        const cx = zi * ZONE_W + ZONE_W / 2;
        if (!z.open) {
          const fog = this.add.rectangle(zi * ZONE_W, 0, ZONE_W, H, 0x0b0816, 0.62).setOrigin(0);
          fog.setInteractive().on('pointerdown', () => api.onLocked(z));
          label(this, cx, H / 2 + 22, 'LOCKED', { size: 7, color: '#c9c4dc' });
          label(this, cx, H / 2 + 36, `Master every topic\nin ${zones[zi - 1].name}`, { size: 4, color: '#c9c4dc' });
          label(this, cx, H / 2, '🔒', { size: 18, font: EMOJI_FONT, stroke: '#00000000' });
        }
        const banner = this.add.rectangle(cx, 12, 118, 15, 0x1a1426, 0.82).setStrokeStyle(1, Phaser_color(ZONE_RING[z.id]));
        banner.setDepth(5);
        label(this, cx, 12.5, `${z.name.toUpperCase()}`, { size: 5, color: ZONE_RING[z.id] }).setDepth(6);
      });

      // Clouds over the citadel.
      for (let i = 0; i < 3; i += 1) {
        const c = this.add.image(ZONE_W * 2 + 20 + i * 50, 30 + i * 22, 's-cloud').setAlpha(0.85).setDepth(4);
        this.tweens.add({ targets: c, x: c.x + 30, duration: 6000 + i * 1500, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      }

      // Topic nodes.
      let num = 0;
      zones.forEach((z) => z.nodes.forEach((n) => {
        num += 1;
        const p = pos.get(n.key);
        const state = !z.open ? 'locked' : n.m.mastered ? 'mastered' : 'open';
        const ring = Phaser_color(state === 'locked' ? '#4a4560' : ZONE_RING[z.id]);
        const fill = { locked: 0x3a3550, mastered: 0xffd34d, open: 0xfffbe0 }[state];
        const node = this.add.container(p.x, p.y).setDepth(8);
        const shadow = this.add.ellipse(0, 7, 16, 5, 0x000000, 0.3);
        const disc = this.add.circle(0, 0, 7.5, fill).setStrokeStyle(2, ring);
        const txt = label(this, 0, 0.5, state === 'mastered' ? '★' : String(num), {
          size: state === 'mastered' ? 8 : 5, color: state === 'locked' ? '#8f88a8' : '#1a1426', stroke: '#00000000',
          font: state === 'mastered' ? EMOJI_FONT : "'Press Start 2P', monospace",
        });
        node.add([shadow, disc, txt]);
        node.setSize(18, 18).setInteractive({ useHandCursor: true });
        node.on('pointerover', () => node.setScale(1.18));
        node.on('pointerout', () => node.setScale(1));
        node.on('pointerdown', () => (z.open ? this.walkTo(n) : api.onLocked(z)));
        if (state === 'open') this.tweens.add({ targets: disc, scale: 1.12, duration: 700, yoyo: true, repeat: -1 });
        n.sprite = node;
      }));
      this.sel = this.add.circle(0, 0, 11).setStrokeStyle(1.5, 0xffffff).setDepth(7).setVisible(false);
      this.tweens.add({ targets: this.sel, scale: 1.2, alpha: 0.4, duration: 600, yoyo: true, repeat: -1 });

      // The hero waits at the next topic to master.
      const all = zones.flatMap((z) => (z.open ? z.nodes : []));
      const here = all.find((n) => !n.m.mastered) || all.at(-1);
      const start = here ? pos.get(here.key) : { x: 20, y: H / 2 };
      this.hero = addHero(this, api.hero, start.x, start.y - 6);
      this.hero.sprite.setDepth(9);
      this.hero.aura?.setDepth(8.5);
      this.pos = pos;
      if (here) this.select(here, false);
    }

    select(n, notify = true) {
      const p = this.pos.get(n.key);
      this.sel.setPosition(p.x, p.y).setVisible(true);
      if (notify) api.onNode(n);
      else api.onNode(n, { quiet: true });
    }

    walkTo(n) {
      const p = this.pos.get(n.key);
      const s = this.hero.sprite;
      const dist = Math.hypot(p.x - s.x, p.y - 6 - s.y);
      this.tweens.killTweensOf(s);
      s.setFlipX(p.x < s.x);
      this.tweens.add({
        targets: s, x: p.x, y: p.y - 6, duration: Math.min(1400, dist * 9), ease: 'Sine.inOut',
        onUpdate: () => this.hero.aura?.setPosition(s.x, s.y + 2),
      });
      this.select(n);
    }
  };
}

// ------------------------------------------------------------------ base
export const BASE_SIZE = { width: GRID.w * T, height: GRID.h * T, zoom: 4 };

export function baseScene(Phaser, api) {
  return class BaseScene extends Phaser.Scene {
    constructor() { super('base'); }

    create() {
      const { width: W, height: H, zoom } = BASE_SIZE;
      this.cameras.main.setZoom(zoom).centerOn(W / 2, H / 2);
      for (let i = 0; i < 4; i += 1) tex(this, `bg-${i}`, () => grassTile(i + 40));
      for (let y = 0; y < H; y += T) for (let x = 0; x < W; x += T) this.add.image(x, y, `bg-${(x * 3 + y * 5) % 4}`).setOrigin(0);
      // A dirt square around the town hall.
      this.add.rectangle((HALL.x - 0.5) * T, (HALL.y - 0.5) * T, T * 2, T * 2, 0xb08a5a, 0.55).setOrigin(0);
      ['hall', 'scaffold', ...Object.keys(BUILDINGS)].forEach((k) => tex(this, `b-${k}`, () => buildingSprite(k)));
      this.layer = this.add.container(0, 0);
      this.hover = this.add.rectangle(0, 0, T, T).setOrigin(0).setStrokeStyle(1, 0xffffff).setVisible(false).setDepth(50);
      this.selBox = this.add.rectangle(0, 0, T, T).setOrigin(0).setStrokeStyle(1, 0xffd34d).setVisible(false).setDepth(50);
      this.tweens.add({ targets: this.selBox, alpha: 0.3, duration: 500, yoyo: true, repeat: -1 });

      this.hero = addHero(this, api.hero, (HALL.x + 0.5) * T, (HALL.y + 1.6) * T);
      this.hero.sprite.setDepth(30);
      this.hero.aura?.setDepth(29);
      this.time.addEvent({ delay: 3200, loop: true, callback: () => this.wander() });

      const tile = (pointer) => {
        const p = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const x = Math.floor(p.x / T);
        const y = Math.floor(p.y / T);
        return x >= 0 && y >= 0 && x < GRID.w && y < GRID.h ? { x, y } : null;
      };
      this.input.on('pointermove', (pointer) => {
        const t = tile(pointer);
        this.hover.setVisible(!!t);
        if (!t) return;
        this.hover.setPosition(t.x * T, t.y * T);
        const placing = api.placing();
        const free = !api.thingAt(t.x, t.y);
        this.hover.setStrokeStyle(1, placing ? (free ? 0x5fd38a : 0xff6b6b) : 0xffffff);
        this.hover.setFillStyle(placing ? (free ? 0x5fd38a : 0xff6b6b) : 0xffffff, placing ? 0.25 : 0.08);
      });
      this.input.on('pointerdown', (pointer) => {
        const t = tile(pointer);
        if (t) api.onTile(t.x, t.y);
      });
      this.sync();
      this.time.addEvent({ delay: 1000, loop: true, callback: () => this.sync() });
    }

    wander() {
      const s = this.hero.sprite;
      const nx = Math.max(0, Math.min(GRID.w - 1, Math.floor(s.x / T) + Phaser.Math.Between(-2, 2)));
      const ny = Math.max(0, Math.min(GRID.h - 1, Math.floor(s.y / T) + Phaser.Math.Between(-1, 1)));
      if (api.thingAt(nx, ny)) return;
      s.setFlipX(nx * T + 8 < s.x);
      this.tweens.add({ targets: s, x: nx * T + 8, y: ny * T + 12, duration: 1400, ease: 'Sine.inOut',
        onUpdate: () => this.hero.aura?.setPosition(s.x, s.y + 2) });
    }

    /** Redraw buildings, timers and ready bubbles from the realm state. */
    sync() {
      const now = Date.now();
      const r = realm();
      this.layer.removeAll(true);
      const add = (o) => { this.layer.add(o); return o; };
      const hall = add(this.add.image(HALL.x * T, HALL.y * T, 'b-hall').setOrigin(0));
      hall.setDepth(HALL.y);
      const flag = r.wear.banner ? BANNER[r.wear.banner] : CLASS_COLOR[api.hero.character];
      add(this.add.image(HALL.x * T - 2, HALL.y * T - 8, tex(this, `flag-${flag}`, () => bannerSprite(flag))).setOrigin(0));
      for (const d of r.decor) add(this.add.image(d.x * T, d.y * T, tex(this, `d-${d.type}`, () => buildingSprite(d.type))).setOrigin(0));
      const t = this.time.now / 1000;
      for (const b of r.buildings) {
        const x = b.x * T;
        const y = b.y * T;
        if (isBuilding(b, now)) {
          add(this.add.image(x, y, 'b-scaffold').setOrigin(0).setAlpha(0.95));
          const total = (b.buildSecs || 60) * 1000;
          const k = 1 - Math.max(0, b.readyAt - now) / total;
          add(this.add.rectangle(x + 1, y - 3, 14, 3, 0x1a1426).setOrigin(0));
          add(this.add.rectangle(x + 2, y - 2, Math.max(1, 12 * k), 1, 0x5fd38a).setOrigin(0));
          continue;
        }
        add(this.add.image(x, y, `b-${b.type}`).setOrigin(0));
        if (b.level > 1) add(label(this, x + 13, y + 13, String(b.level), { size: 4, color: '#ffd34d' }));
        const makes = BUILDINGS[b.type].makes;
        if (makes && pending(b, now) >= 1) {
          const bob = Math.sin(t * 3 + b.uid) * 1.2;
          const full = isFull(b, now);
          add(this.add.circle(x + 8, y - 3 + bob, 5.5, 0xffffff).setStrokeStyle(1, full ? 0xff6b6b : 0x1a1426));
          add(label(this, x + 8, y - 3 + bob, makes === 'insight' ? INSIGHT.icon : RESOURCES[makes].icon,
            { size: 6, font: EMOJI_FONT, stroke: '#00000000' }));
        }
      }
      const sel = api.selected();
      this.selBox.setVisible(!!sel);
      if (sel) this.selBox.setPosition(sel.x * T, sel.y * T);
    }
  };
}

// ------------------------------------------------------------------ boss
export const BOSS_SIZE = { width: 320, height: 160, zoom: 3 };

export function bossScene(Phaser, api) {
  return class BossScene extends Phaser.Scene {
    constructor() { super('boss'); }

    create() {
      const { width: W, height: H, zoom } = BOSS_SIZE;
      this.cameras.main.setZoom(zoom).centerOn(W / 2, H / 2);
      const g = this.add.graphics();
      for (let i = 0; i < 10; i += 1) g.fillStyle(Phaser.Display.Color.GetColor(26 + i * 4, 18 + i * 2, 50 + i * 5), 1).fillRect(0, i * 11, W, 11);
      g.fillStyle(0x2a2340, 1).fillRect(0, 110, W, 50);
      g.fillStyle(0x352d52, 1);
      for (let x = 0; x < W; x += 16) for (let y = 110; y < H; y += 8) g.fillRect(x + ((y / 8) % 2) * 8, y, 15, 7);
      // Pillars with torches.
      [30, 130, 290].forEach((x) => {
        g.fillStyle(0x4a4166, 1).fillRect(x - 6, 30, 12, 82);
        g.fillStyle(0x5c5080, 1).fillRect(x - 8, 26, 16, 6).fillRect(x - 8, 108, 16, 4);
        const fire = this.add.ellipse(x, 22, 6, 9, 0xffb347);
        const glow = this.add.circle(x, 22, 16, 0xffb347, 0.15);
        this.tweens.add({ targets: [fire, glow], scaleY: 1.25, alpha: 0.7, duration: 180 + x, yoyo: true, repeat: -1 });
      });
      this.bossN = api.boss();
      this.boss = this.add.image(222, 112, tex(this, `boss-${this.bossN}`, () => bossSprite(this.bossN))).setOrigin(0.5, 1).setScale(2);
      this.add.ellipse(222, 113, 80, 10, 0x000000, 0.35).setDepth(-1);
      this.breath = this.tweens.add({ targets: this.boss, scaleY: 2.06, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      this.hero = addHero(this, api.hero, 78, 128);
      this.hero.sprite.setScale(2);
      this.hero.aura?.setScale(2);
      this.home = { x: 78, y: 128 };
      if (api.defeated()) this.fallen(true);
    }

    setBoss(n) {
      if (n === this.bossN) return;
      this.bossN = n;
      this.boss.setTexture(tex(this, `boss-${n}`, () => bossSprite(n))).setAlpha(1).setAngle(0).setScale(2);
      this.breath.resume();
    }

    float(text, x, y, color, size = 8) {
      const t = label(this, x, y, text, { size, color }).setDepth(20);
      this.tweens.add({ targets: t, y: y - 26, alpha: 0, duration: 1300, ease: 'Cubic.out', onComplete: () => t.destroy() });
    }

    /** The student's own hit: dash in, slash, damage number. */
    strike({ damage, crit }) {
      const s = this.hero.sprite;
      this.tweens.add({ targets: s, x: 180, duration: 160, yoyo: true, ease: 'Quad.in' });
      this.time.delayedCall(150, () => {
        const slash = this.add.graphics().setDepth(15);
        slash.lineStyle(3, crit ? 0xffd34d : 0xffffff, 1);
        slash.beginPath(); slash.moveTo(196, 50); slash.lineTo(248, 100); slash.strokePath();
        slash.lineStyle(2, 0x7fe3f5, 0.8);
        slash.beginPath(); slash.moveTo(204, 46); slash.lineTo(254, 94); slash.strokePath();
        this.tweens.add({ targets: slash, alpha: 0, duration: 300, onComplete: () => slash.destroy() });
        this.boss.setTintFill(0xffffff);
        this.time.delayedCall(90, () => this.boss.clearTint());
        this.cameras.main.shake(crit ? 220 : 120, crit ? 0.01 : 0.005);
        this.float(crit ? `CRIT! -${damage}` : `-${damage}`, 222, 50, crit ? '#ffd34d' : '#ffffff', crit ? 10 : 9);
      });
    }

    /** A wrong answer: the boss lunges at the hero. */
    miss() {
      this.tweens.add({ targets: this.boss, x: 170, duration: 180, yoyo: true, ease: 'Quad.in' });
      this.time.delayedCall(170, () => {
        this.hero.sprite.setTintFill(0xff6b6b);
        this.time.delayedCall(120, () => this.hero.sprite.clearTint());
        this.cameras.main.shake(160, 0.008);
        this.float('MISS', this.home.x, 90, '#ff6b6b', 8);
      });
    }

    /** Someone else in the guild landed a hit. */
    ally({ name, damage, crit }) {
      this.boss.setTint(0xff9a9a);
      this.time.delayedCall(80, () => this.boss.clearTint());
      this.float(`${name} -${damage}${crit ? '!' : ''}`, 222 + Phaser.Math.Between(-30, 30), 70, '#b8f2ff', 5);
    }

    fallen(still = false) {
      this.breath.pause();
      if (still) {
        this.boss.setAlpha(0.35).setAngle(-12);
        return;
      }
      this.tweens.add({ targets: this.boss, angle: -12, alpha: 0.35, y: 116, duration: 900, ease: 'Bounce.out' });
      const colors = [0xffd34d, 0x7fe3f5, 0xff6b5a, 0x7ddc7a, 0xb48cff];
      for (let i = 0; i < 40; i += 1) {
        const c = this.add.rectangle(160, 40, 3, 3, colors[i % 5]).setDepth(30);
        this.tweens.add({ targets: c, x: 160 + Phaser.Math.Between(-150, 150), y: Phaser.Math.Between(60, 160), angle: 360,
          alpha: 0, duration: 1600 + Phaser.Math.Between(0, 600), ease: 'Cubic.out', onComplete: () => c.destroy() });
      }
    }
  };
}

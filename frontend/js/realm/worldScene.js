/**
 * The realm as one walkable pixel world. On the left is the student's town:
 * building plots, the town hall, the shop and the guild portal, where the
 * class's boss stands. A road leads east through the Golden Plains, the
 * Whispering Forest and the Sky Citadel, with a shrine for each topic; gates
 * stay shut until the zone before is mastered.
 *
 * Tap anywhere to walk; tap a place (or press E next to it) to use it. The
 * scene only draws and reports what was tapped; the realm screen shows the
 * panel for it.
 */
import { tex, label } from './phaser.js';
import {
  T, heroFrames, buildingSprite, bannerSprite, grassTile, scenery, bossSprite, shopSprite, portalFrames,
  gateSprite, plotTile, signSprite, AURA, BANNER, CLASS_COLOR,
} from './art.js';
import { GRID, BUILDINGS, RESOURCES, INSIGHT, realm, isBuilding, pending, isFull } from './economy.js';

const EMOJI = 'system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const hex = (c) => parseInt(c.replace('#', ''), 16);

export const WORLD = { w: 62 * T, h: 22 * T };
export const PLOTS = { x: 3, y: 9 };                // first plot tile
const HALL = { x: 13 * T, y: 6 * T + 4 };
const SHOP = { x: 17 * T + 4, y: 10 * T + 6 };
const PORTAL = { x: 11 * T + 8, y: 17 * T + 4 };
const BOSS = { x: 16 * T, y: 17 * T + 8 };
const SPEED = 120;                                    // art pixels per second
const ZONE_X = { plains: [21, 33], forest: [34, 46], citadel: [47, 61] };
const ZONE_GROUND = {
  town: ['#63ad52', '#58a048', '#70bb5e'],
  plains: ['#5aa04a', '#4f9141', '#68b357'],
  forest: ['#2f6b3a', '#285c32', '#3a7d45'],
  citadel: ['#8c93b8', '#7c83a8', '#9ca3c8'],
};
const ZONE_RING = { plains: '#ffd34d', forest: '#7ddc7a', citadel: '#b48cff' };

/** Pick the art size and zoom for the space available. */
export function viewFor(width) {
  return width < 640 ? { width: 224, height: 248, zoom: 2 } : { width: 320, height: 180, zoom: 3 };
}

/** Where each topic shrine stands (world pixels). */
export function nodePositions(zones) {
  const out = new Map();
  let g = 0;
  for (const z of zones) {
    const [a, b] = ZONE_X[z.id];
    const k = z.nodes.length;
    z.nodes.forEach((n, i) => {
      const tx = k === 1 ? (a + b) / 2 : a + 2 + ((b - a - 4) * i) / (k - 1);
      const ty = 11 + 5 * Math.sin(g * 1.25 + 0.6);
      out.set(n.key, { x: tx * T + 8, y: ty * T + 8 });
      g += 1;
    });
  }
  return out;
}

export const plotCenter = (x, y) => ({ x: (PLOTS.x + x) * T + 8, y: (PLOTS.y + y) * T + 8 });

function heroTextures(scene, hero) {
  const key = `hero-${hero.character}-${hero.tier}-${hero.wear.hat || 'none'}`;
  if (!scene.textures.exists(`${key}-0`)) heroFrames(hero.character, hero.tier, hero.wear).forEach((c, i) => scene.textures.addCanvas(`${key}-${i}`, c));
  return [`${key}-0`, `${key}-1`];
}

export function worldScene(Phaser, api, view) {
  return class WorldScene extends Phaser.Scene {
    constructor() { super('world'); }

    create() {
      const cam = this.cameras.main;
      cam.setZoom(view.zoom);
      cam.setBounds(0, 0, WORLD.w, WORLD.h);
      this.zones = api.zones;
      this.pos = nodePositions(this.zones);
      this.places = new Map(); // key -> { x, y, target }
      this.drawGround();
      this.drawRoad();
      this.drawScenery();
      this.drawTown();
      this.drawZones();
      this.plotLayer = this.add.container(0, 0).setDepth(2);
      this.drawPlots();
      this.drawHero();
      this.drawPointer();
      this.sync();
      this.time.addEvent({ delay: 1000, loop: true, callback: () => this.sync() });

      this.keys = this.input.keyboard.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D');
      this.input.keyboard.on('keydown-E', () => this.useNearest());
      this.input.keyboard.on('keydown-SPACE', () => this.useNearest());
      this.input.on('pointerdown', (pointer, over) => {
        if (over.length) return; // a place handles its own tap
        const p = cam.getWorldPoint(pointer.x, pointer.y);
        this.walk(p.x, p.y);
      });
      this.events.emit('ready');
    }

    // ------------------------------------------------------------ drawing
    drawGround() {
      const c = document.createElement('canvas');
      c.width = WORLD.w;
      c.height = WORLD.h;
      const g = c.getContext('2d');
      const tiles = {};
      for (const [zone, colors] of Object.entries(ZONE_GROUND)) tiles[zone] = [0, 1, 2, 3].map((i) => grassTile(i + zone.length * 7 + 1, colors));
      for (let y = 0; y < WORLD.h; y += T) {
        for (let x = 0; x < WORLD.w; x += T) {
          const tx = x / T;
          const zone = tx < 21 ? 'town' : tx < 34 ? 'plains' : tx < 47 ? 'forest' : 'citadel';
          g.drawImage(tiles[zone][(tx * 7 + (y / T) * 13) % 4], x, y);
        }
      }
      // A river between town and plains is crossed by a bridge; cliffs before the citadel.
      g.fillStyle = '#3d7fd1'; g.fillRect(20 * T + 2, 0, 10, WORLD.h);
      g.fillStyle = '#7fb8ff'; g.fillRect(20 * T + 4, 0, 2, WORLD.h);
      g.fillStyle = '#5c556f'; g.fillRect(47 * T - 4, 0, 8, WORLD.h);
      this.textures.addCanvas('ground', c);
      this.add.image(0, 0, 'ground').setOrigin(0).setDepth(-10);
    }

    drawRoad() {
      const pts = [{ x: 13 * T, y: 9 * T + 8 }, { x: 20 * T, y: 10 * T + 8 }];
      for (const z of this.zones) for (const n of z.nodes) pts.push(this.pos.get(n.key));
      pts.push({ x: WORLD.w - 12, y: (pts.at(-1)?.y ?? WORLD.h / 2) });
      const curve = new Phaser.Curves.Spline(pts.map((p) => new Phaser.Math.Vector2(p.x, p.y)));
      const g = this.add.graphics().setDepth(-9);
      g.lineStyle(11, 0x6b4a2b, 1);
      curve.draw(g, 256);
      g.lineStyle(8, 0xc9a36a, 1);
      curve.draw(g, 256);
      // Town square paths to the shop and the portal.
      g.lineStyle(8, 0xc9a36a, 1);
      g.lineBetween(HALL.x, HALL.y + 12, SHOP.x - 4, SHOP.y + 8);
      g.lineBetween(HALL.x, HALL.y + 12, PORTAL.x, PORTAL.y);
      g.lineBetween(HALL.x, HALL.y + 12, (PLOTS.x + GRID.w) * T, (PLOTS.y + 2) * T);
      // bridge
      g.fillStyle(0x8a5a32, 1).fillRect(20 * T - 2, 10 * T - 2, 18, 20);
      g.fillStyle(0xb07a45, 1);
      for (let i = 0; i < 18; i += 3) g.fillRect(20 * T - 2 + i, 10 * T - 2, 2, 20);
      this.roadPts = curve.getSpacedPoints(300);
    }

    drawScenery() {
      ['tree', 'pine', 'rock', 'wheat', 'house', 'castle', 'cloud'].forEach((id) => tex(this, `s-${id}`, () => scenery(id)));
      const kinds = { town: ['tree', 'tree', 'rock', 'wheat'], plains: ['wheat', 'wheat', 'tree', 'house', 'rock'], forest: ['pine', 'pine', 'tree', 'pine', 'rock'], citadel: ['rock', 'rock', 'pine', 'house'] };
      let seed = 11;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const props = [];
      const busy = (x, y) => this.roadPts.some((p) => Math.abs(p.x - x) < 16 && Math.abs(p.y - (y - 4)) < 16)
        || (x < 22 * T && y > 3 * T && y < 20 * T && x > 2 * T); // keep the town clear
      const ranges = { town: [0, 20], plains: [21, 33], forest: [34, 46], citadel: [47, 61] };
      for (const [zone, [a, b]] of Object.entries(ranges)) {
        const count = { town: 22, plains: 34, forest: 60, citadel: 34 }[zone];
        for (let i = 0; i < count; i += 1) {
          const x = (a + rnd() * (b - a + 1)) * T;
          const y = 16 + rnd() * (WORLD.h - 18);
          if (!busy(x, y)) props.push({ x, y, id: kinds[zone][Math.floor(rnd() * kinds[zone].length)] });
        }
      }
      props.forEach((p) => this.add.image(p.x, p.y, `s-${p.id}`).setOrigin(0.5, 1).setDepth(p.y));
      this.add.image(58 * T, 7 * T, 's-castle').setOrigin(0.5, 1).setScale(2.4).setDepth(7 * T);
      for (let i = 0; i < 4; i += 1) {
        const c = this.add.image(49 * T + i * 60, 30 + (i % 2) * 40, 's-cloud').setAlpha(0.85).setDepth(5000);
        this.tweens.add({ targets: c, x: c.x + 36, duration: 7000 + i * 1300, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      }
    }

    /** A labelled place the student can tap. */
    place(key, x, y, obj, name, target, { labelY = -20, color = '#ffffff' } = {}) {
      obj.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.visit(key));
      this.places.set(key, { x, y, target, obj });
      if (name) label(this, x, y + labelY, name, { size: 4, color }).setDepth(6000);
    }

    drawTown() {
      ['hall', 'scaffold', ...Object.keys(BUILDINGS)].forEach((k) => tex(this, `b-${k}`, () => buildingSprite(k)));
      const hall = this.add.image(HALL.x, HALL.y + 8, 'b-hall').setOrigin(0.5, 1).setScale(2).setDepth(HALL.y);
      this.place('hall', HALL.x, HALL.y + 14, hall, 'TOWN HALL', { kind: 'hall' }, { labelY: -42, color: '#ffd34d' });
      const flag = realm().wear.banner ? BANNER[realm().wear.banner] : CLASS_COLOR[api.hero.character];
      this.flag = this.add.image(HALL.x - 18, HALL.y - 2, tex(this, `flag-${flag}`, () => bannerSprite(flag))).setOrigin(0.5, 1).setDepth(HALL.y + 1);

      const shop = this.add.image(SHOP.x, SHOP.y + 10, tex(this, 'shop', shopSprite)).setOrigin(0.5, 1).setScale(1.2).setDepth(SHOP.y);
      this.place('shop', SHOP.x, SHOP.y + 14, shop, 'SHOP', { kind: 'shop' }, { labelY: -36, color: '#ff9a8a' });

      const frames = portalFrames();
      frames.forEach((c, i) => tex(this, `portal-${i}`, () => c));
      const portal = this.add.sprite(PORTAL.x, PORTAL.y + 10, 'portal-0').setOrigin(0.5, 1).setDepth(PORTAL.y);
      let f = 0;
      this.time.addEvent({ delay: 220, loop: true, callback: () => { f = 1 - f; portal.setTexture(`portal-${f}`); } });
      this.place('portal', PORTAL.x, PORTAL.y + 14, portal, 'GUILD PORTAL', { kind: 'boss' }, { labelY: -36, color: '#c9b0ff' });

      // The guild's boss stands in the arena beside the portal.
      this.add.ellipse(BOSS.x, BOSS.y + 2, 70, 16, 0x5b3fc4, 0.25).setDepth(-5);
      const b = api.boss();
      this.bossN = b?.n || 1;
      this.boss = this.add.image(BOSS.x, BOSS.y, tex(this, `boss-${this.bossN}`, () => bossSprite(this.bossN))).setOrigin(0.5, 1).setDepth(BOSS.y);
      this.bossBreath = this.tweens.add({ targets: this.boss, scaleY: 1.04, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      this.place('boss', BOSS.x - 26, BOSS.y - 2, this.boss, null, { kind: 'boss' });
      this.places.get('boss').arrow = { x: BOSS.x, y: BOSS.y };
      this.bossBar = this.add.graphics().setDepth(6000);
      this.drawBossBar();
      if (b?.defeated) this.boss.setAlpha(0.35).setAngle(-12);

      const sign = this.add.image((PLOTS.x + GRID.w / 2) * T, PLOTS.y * T - 4, tex(this, 'sign', signSprite)).setOrigin(0.5, 1).setDepth(PLOTS.y * T);
      label(this, (PLOTS.x + GRID.w / 2) * T, PLOTS.y * T - 22, 'BUILDING PLOTS', { size: 4, color: '#c9f2a0' }).setDepth(6000);
      sign.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.visit('plots'));
      this.places.set('plots', { ...plotCenter(GRID.w / 2 - 1, 0), target: { kind: 'plots' } });
    }

    drawBossBar() {
      const b = api.boss();
      const g = this.bossBar;
      g.clear();
      if (!b) return;
      const w = 44;
      g.fillStyle(0x1a1426, 1).fillRect(BOSS.x - w / 2 - 1, BOSS.y - 56, w + 2, 5);
      g.fillStyle(0xc0392b, 1).fillRect(BOSS.x - w / 2, BOSS.y - 55, Math.max(0, (w * b.hp) / b.max_hp), 3);
    }

    drawZones() {
      const open = new Set(this.zones.filter((z) => z.open).map((z) => z.id));
      this.limitX = WORLD.w - 10;
      tex(this, 'gate-0', () => gateSprite(false));
      tex(this, 'gate-1', () => gateSprite(true));
      this.zones.forEach((z, i) => {
        const [a, b] = ZONE_X[z.id];
        const cx = ((a + b) / 2) * T;
        const banner = this.add.rectangle(cx, 14, 120, 14, 0x1a1426, 0.82).setStrokeStyle(1, hex(ZONE_RING[z.id])).setDepth(5500);
        banner.setScrollFactor(1);
        label(this, cx, 14.5, z.name.toUpperCase(), { size: 5, color: ZONE_RING[z.id] }).setDepth(5501);
        if (i > 0) {
          const gx = a * T - 4;
          const gy = (this.pos.get(z.nodes[0]?.key)?.y ?? 11 * T) + 2;
          const gate = this.add.image(gx, gy + 10, z.open ? 'gate-1' : 'gate-0').setOrigin(0.5, 1).setDepth(gy);
          this.place(`gate:${z.id}`, gx, gy, gate, z.open ? null : 'LOCKED', { kind: 'gate', zone: z }, { labelY: -30, color: '#c9c4dc' });
          if (!z.open && this.limitX > gx - 10) this.limitX = gx - 12;
          if (!z.open) this.add.rectangle(a * T, 0, (b - a + 1) * T, WORLD.h, 0x0b0816, 0.5).setOrigin(0).setDepth(5400);
        }
      });
      // Topic shrines.
      let num = 0;
      for (const z of this.zones) {
        for (const n of z.nodes) {
          num += 1;
          const p = this.pos.get(n.key);
          const state = !z.open ? 'locked' : n.m.mastered ? 'mastered' : 'open';
          const node = this.add.container(p.x, p.y).setDepth(p.y);
          const disc = this.add.circle(0, 0, 8, { locked: 0x3a3550, mastered: 0xffd34d, open: 0xfffbe0 }[state])
            .setStrokeStyle(2, hex(state === 'locked' ? '#4a4560' : ZONE_RING[z.id]));
          node.add([this.add.ellipse(0, 8, 18, 5, 0x000000, 0.3), disc,
            label(this, 0, 0.5, state === 'mastered' ? '★' : String(num), { size: state === 'mastered' ? 8 : 5, color: state === 'locked' ? '#8f88a8' : '#1a1426', stroke: '#00000000', font: state === 'mastered' ? EMOJI : undefined })]);
          node.setSize(20, 20);
          if (state === 'open') this.tweens.add({ targets: disc, scale: 1.12, duration: 700, yoyo: true, repeat: -1 });
          this.place(`topic:${n.key}`, p.x, p.y + 10, node, null, { kind: 'topic', node: n, zone: z });
          if (open.has(z.id)) {
            const short = n.name.length > 18 ? `${n.name.slice(0, 17)}…` : n.name;
            label(this, p.x, p.y - 14, short, { size: 3.5, color: '#ffffff' }).setDepth(5000);
          }
        }
      }
    }

    drawPlots() {
      for (let i = 0; i < 4; i += 1) tex(this, `plot-${i}`, () => plotTile(i));
      const g = this.add.graphics().setDepth(-4);
      g.fillStyle(0x8a5a32, 1);
      const x0 = PLOTS.x * T - 3;
      const y0 = PLOTS.y * T - 3;
      const w = GRID.w * T + 6;
      const h = GRID.h * T + 6;
      g.fillRect(x0, y0, w, 2).fillRect(x0, y0 + h - 2, w, 2).fillRect(x0, y0, 2, h).fillRect(x0 + w - 2, y0, 2, h);
      for (let y = 0; y < GRID.h; y += 1) {
        for (let x = 0; x < GRID.w; x += 1) {
          const c = plotCenter(x, y);
          const img = this.add.image(c.x, c.y, `plot-${(x + y * 3) % 4}`).setDepth(-3);
          img.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.visit(`plot:${x},${y}`));
          this.places.set(`plot:${x},${y}`, { x: c.x, y: c.y + 10, target: { kind: 'plot', x, y } });
        }
      }
      this.selBox = this.add.rectangle(0, 0, T, T).setStrokeStyle(1, 0xffd34d).setVisible(false).setDepth(5000);
      this.tweens.add({ targets: this.selBox, alpha: 0.3, duration: 500, yoyo: true, repeat: -1 });
    }

    drawHero() {
      const hero = api.hero;
      const [a, b] = heroTextures(this, hero);
      const glow = AURA[hero.wear.aura];
      this.aura = glow ? this.add.ellipse(0, 0, 18, 22, hex(glow), 0.22) : null;
      if (this.aura) this.tweens.add({ targets: this.aura, alpha: 0.08, scale: 1.15, duration: 900, yoyo: true, repeat: -1 });
      this.hero = this.add.sprite(HALL.x, HALL.y + 30, a).setOrigin(0.5, 0.85);
      this.frames = [a, b];
      this.frame = 0;
      this.time.addEvent({ delay: 200, loop: true, callback: () => { if (this.moving) { this.frame = 1 - this.frame; this.hero.setTexture(this.frames[this.frame]); } } });
      this.cameras.main.startFollow(this.hero, true, 0.12, 0.12);
      this.target = null;
    }

    drawPointer() {
      this.arrow = label(this, 0, 0, '▼', { size: 9, color: '#ffd34d', font: EMOJI }).setDepth(7000).setVisible(false);
      this.tweens.add({ targets: this.arrow, y: '+=4', duration: 450, yoyo: true, repeat: -1 });
    }

    /** Point the bouncing arrow at a place (the "next step"), or hide it. */
    pointAt(key) {
      const place = key && this.places.get(key);
      this.arrow.setVisible(!!place);
      if (!place) return;
      const p = place.arrow || place;
      const lift = key === 'hall' ? 52 : key === 'shop' || key === 'portal' ? 44 : key === 'boss' ? 66 : 26;
      this.tweens.killTweensOf(this.arrow);
      this.arrow.setPosition(p.x, p.y - lift);
      this.tweens.add({ targets: this.arrow, y: p.y - lift + 4, duration: 450, yoyo: true, repeat: -1 });
    }

    // ------------------------------------------------------------ moving
    walk(x, y, then = null) {
      this.target = {
        x: Math.max(8, Math.min(this.limitX, x)),
        y: Math.max(26, Math.min(WORLD.h - 8, y)),
        then,
      };
    }

    /** Walk to a place and open it. */
    visit(key) {
      const p = this.places.get(key);
      if (!p) return;
      api.open(p.target, key);
      this.selBox.setVisible(p.target.kind === 'plot');
      if (p.target.kind === 'plot') this.selBox.setPosition(plotCenter(p.target.x, p.target.y).x, plotCenter(p.target.x, p.target.y).y);
      this.walk(p.x, p.y);
    }

    useNearest() {
      let best = null;
      for (const [key, p] of this.places) {
        const d = Math.hypot(p.x - this.hero.x, p.y - this.hero.y);
        if (d < 26 && (!best || d < best.d)) best = { key, d };
      }
      if (best) this.visit(best.key);
    }

    update(_, dtMs) {
      const dt = dtMs / 1000;
      const k = this.keys;
      let dx = (k.RIGHT.isDown || k.D.isDown) - (k.LEFT.isDown || k.A.isDown);
      let dy = (k.DOWN.isDown || k.S.isDown) - (k.UP.isDown || k.W.isDown);
      if (dx || dy) this.target = null;
      else if (this.target) {
        const vx = this.target.x - this.hero.x;
        const vy = this.target.y - this.hero.y;
        const d = Math.hypot(vx, vy);
        if (d < 2) {
          const then = this.target.then;
          this.target = null;
          then?.();
        } else {
          dx = vx / d;
          dy = vy / d;
        }
      }
      this.moving = !!(dx || dy);
      if (this.moving) {
        const len = Math.hypot(dx, dy) || 1;
        this.hero.x = Math.max(8, Math.min(this.limitX, this.hero.x + (dx / len) * SPEED * dt));
        this.hero.y = Math.max(26, Math.min(WORLD.h - 8, this.hero.y + (dy / len) * SPEED * dt));
        if (dx) this.hero.setFlipX(dx < 0);
      }
      this.hero.setDepth(this.hero.y + 2);
      this.aura?.setPosition(this.hero.x, this.hero.y - 6).setDepth(this.hero.y + 1);
    }

    // ------------------------------------------------------------ the town
    /** Redraw buildings, timers and ready bubbles from the realm state. */
    sync() {
      const now = Date.now();
      const r = realm();
      this.plotLayer.removeAll(true);
      const add = (o) => { this.plotLayer.add(o); return o; };
      const t = this.time.now / 1000;
      for (const d of r.decor) {
        const c = plotCenter(d.x, d.y);
        add(this.add.image(c.x, c.y, tex(this, `d-${d.type}`, () => buildingSprite(d.type))));
      }
      for (const b of r.buildings) {
        const c = plotCenter(b.x, b.y);
        if (isBuilding(b, now)) {
          add(this.add.image(c.x, c.y, 'b-scaffold'));
          const k = 1 - Math.max(0, b.readyAt - now) / ((b.buildSecs || 60) * 1000);
          add(this.add.rectangle(c.x - 7, c.y - 11, 14, 3, 0x1a1426).setOrigin(0));
          add(this.add.rectangle(c.x - 6, c.y - 10, Math.max(1, 12 * k), 1, 0x5fd38a).setOrigin(0));
          continue;
        }
        add(this.add.image(c.x, c.y, `b-${b.type}`));
        if (b.level > 1) add(label(this, c.x + 5, c.y + 5, String(b.level), { size: 4, color: '#ffd34d' }));
        const makes = BUILDINGS[b.type].makes;
        if (makes && pending(b, now) >= 1) {
          const bob = Math.sin(t * 3 + b.uid) * 1.2;
          add(this.add.circle(c.x, c.y - 11 + bob, 5.5, 0xffffff).setStrokeStyle(1, isFull(b, now) ? 0xff6b6b : 0x1a1426));
          add(label(this, c.x, c.y - 11 + bob, makes === 'insight' ? INSIGHT.icon : RESOURCES[makes].icon, { size: 6, font: EMOJI, stroke: '#00000000' }));
        }
      }
      const flag = r.wear.banner ? BANNER[r.wear.banner] : CLASS_COLOR[api.hero.character];
      this.flag.setTexture(tex(this, `flag-${flag}`, () => bannerSprite(flag)));
      this.drawBossBar();
    }

    /** The hero changed (level, class or cosmetics). */
    setHero(hero) {
      api.hero = hero;
      this.frames = heroTextures(this, hero);
      this.hero.setTexture(this.frames[0]);
      const glow = AURA[hero.wear.aura];
      this.aura?.destroy();
      this.aura = glow ? this.add.ellipse(this.hero.x, this.hero.y, 18, 22, hex(glow), 0.22) : null;
      if (this.aura) this.tweens.add({ targets: this.aura, alpha: 0.08, scale: 1.15, duration: 900, yoyo: true, repeat: -1 });
    }

    // ------------------------------------------------------------ the boss
    float(text, x, y, color, size = 7) {
      const t = label(this, x, y, text, { size, color }).setDepth(8000);
      this.tweens.add({ targets: t, y: y - 24, alpha: 0, duration: 1300, ease: 'Cubic.out', onComplete: () => t.destroy() });
    }

    setBoss(n, defeated) {
      if (n !== this.bossN) {
        this.bossN = n;
        this.boss.setTexture(tex(this, `boss-${n}`, () => bossSprite(n))).setAlpha(1).setAngle(0);
      }
      if (!defeated) this.boss.setAlpha(1).setAngle(0);
      this.drawBossBar();
    }

    strike({ damage, crit }) {
      const h = this.hero;
      const home = { x: h.x, y: h.y };
      this.target = null;
      this.tweens.add({ targets: h, x: BOSS.x - 16, y: BOSS.y - 4, duration: 160, yoyo: true, ease: 'Quad.in', onComplete: () => h.setPosition(home.x, home.y) });
      this.time.delayedCall(150, () => {
        const s = this.add.graphics().setDepth(8000);
        s.lineStyle(3, crit ? 0xffd34d : 0xffffff, 1);
        s.beginPath(); s.moveTo(BOSS.x - 18, BOSS.y - 44); s.lineTo(BOSS.x + 16, BOSS.y - 10); s.strokePath();
        this.tweens.add({ targets: s, alpha: 0, duration: 300, onComplete: () => s.destroy() });
        this.boss.setTintFill(0xffffff);
        this.time.delayedCall(90, () => this.boss.clearTint());
        this.cameras.main.shake(crit ? 200 : 110, crit ? 0.008 : 0.004);
        this.float(crit ? `CRIT! -${damage}` : `-${damage}`, BOSS.x, BOSS.y - 60, crit ? '#ffd34d' : '#ffffff', crit ? 9 : 8);
        this.drawBossBar();
      });
    }

    miss() {
      this.tweens.add({ targets: this.boss, x: BOSS.x - 12, duration: 160, yoyo: true, ease: 'Quad.in' });
      this.time.delayedCall(150, () => {
        this.hero.setTintFill(0xff6b6b);
        this.time.delayedCall(120, () => this.hero.clearTint());
        this.float('MISS', this.hero.x, this.hero.y - 26, '#ff6b6b', 7);
      });
    }

    ally({ name, damage, crit }) {
      this.boss.setTint(0xff9a9a);
      this.time.delayedCall(80, () => this.boss.clearTint());
      this.float(`${name} -${damage}${crit ? '!' : ''}`, BOSS.x + Phaser.Math.Between(-20, 20), BOSS.y - 50, '#b8f2ff', 4);
      this.drawBossBar();
    }

    fallen() {
      this.tweens.add({ targets: this.boss, angle: -12, alpha: 0.35, duration: 900, ease: 'Bounce.out' });
      const colors = [0xffd34d, 0x7fe3f5, 0xff6b5a, 0x7ddc7a, 0xb48cff];
      for (let i = 0; i < 36; i += 1) {
        const c = this.add.rectangle(BOSS.x, BOSS.y - 30, 3, 3, colors[i % 5]).setDepth(8000);
        this.tweens.add({ targets: c, x: BOSS.x + Phaser.Math.Between(-90, 90), y: BOSS.y + Phaser.Math.Between(-60, 30), angle: 360, alpha: 0, duration: 1500 + Phaser.Math.Between(0, 600), onComplete: () => c.destroy() });
      }
    }
  };
}

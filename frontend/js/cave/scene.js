/**
 * The Cave of Equations in Phaser: the intro scene (Aladdin finds the cave)
 * and the level scene (a side-scrolling platformer with Number Gates,
 * sand-timer doors, enemies, lava, the merchant and the sorcerer's hall).
 *
 * The scene knows nothing about questions, hearts or the shop: it calls the
 * screen through `api`, which shows questions and keeps the score.
 *   api.ask(kind)       -> Promise<boolean>  ('gate' | 'door' | 'spell'); the game is held meanwhile
 *   api.hurt(why)       -> hearts left (0 = the screen ends the run)
 *   api.heal()          a heart picked up
 *   api.coin()          a coin picked up
 *   api.shop()          the merchant was asked to trade
 *   api.carpet()        -> true if a carpet was used up
 *   api.hud(info)       progress for the top bar
 *   api.cleared()       the way out was reached
 *   api.introDone()     the intro finished or was skipped
 *   api.skin, api.doubleJump, api.touch {left, right, up, down, jump, act, carpet}
 */
import { tex, label } from '../realm/phaser.js';
import * as art from './art.js';
import { STAGES, ROWS } from './levels.js';

export const VIEW = { width: 320, height: 180, zoom: 3 };
// Things fixed to the screen (scroll factor 0) are zoomed about the canvas
// centre, so they sit at this offset to line up with the view's top-left.
const OX = (VIEW.width * (VIEW.zoom - 1)) / 2;
const OY = (VIEW.height * (VIEW.zoom - 1)) / 2;
const T = 16;
const GRAVITY = 650;
const SPEED = 95;
const JUMP = 255;
const DOOR_SECONDS = 30;
const BOSS_SHIELDS = 5;
const CARPET_MS = 6000;

function frames(scene, key, list) {
  list.forEach((c, i) => tex(scene, `${key}-${i}`, () => c));
  return list.map((_, i) => ({ key: `${key}-${i}` }));
}

function anim(scene, key, frameList, rate = 6, repeat = -1) {
  if (!scene.anims.exists(key)) scene.anims.create({ key, frames: frameList, frameRate: rate, repeat });
}

function parallax(scene, stage, fixed = true) {
  const b = art.backdrop(stage);
  const layers = ['far', 'mid', 'near'].map((name, i) => {
    tex(scene, `bg${stage}-${name}`, () => b[name]);
    const t = scene.add.tileSprite(fixed ? OX : 0, fixed ? OY : 0, VIEW.width, VIEW.height, `bg${stage}-${name}`)
      .setOrigin(0, 0).setDepth(-30 + i);
    if (fixed) t.setScrollFactor(0);
    return t;
  });
  return (scrollX) => {
    layers[0].tilePositionX = scrollX * 0.08;
    layers[1].tilePositionX = scrollX * 0.25;
    layers[2].tilePositionX = scrollX * 0.5;
  };
}

function heroAnims(scene, skin) {
  const key = `hero-${skin}`;
  const f = frames(scene, key, art.heroFrames(skin));
  anim(scene, `${key}-idle`, [f[0]], 1);
  anim(scene, `${key}-run`, [f[1], f[0], f[2], f[0]], 10);
  anim(scene, `${key}-jump`, [f[3]], 1);
  return key;
}

// ======================================================================= intro
export function introScene(Phaser, api) {
  return class Intro extends Phaser.Scene {
    constructor() { super('intro'); }

    create() {
      const cam = this.cameras.main;
      cam.setZoom(VIEW.zoom);
      cam.centerOn(VIEW.width / 2, VIEW.height / 2);
      const scroll = parallax(this, 0, false);
      this.events.on('update', () => scroll(this.time.now / 60));
      const key = heroAnims(this, api.skin);
      tex(this, 'lamp', art.lampSprite);
      tex(this, 'stone-door', art.stoneDoorSprite);
      const groundY = 150;
      const door = this.add.image(220, groundY + 44, 'stone-door').setOrigin(0.5, 1).setDepth(1);
      const sand = this.add.rectangle(VIEW.width / 2, groundY + 15, VIEW.width, 30, 0xb0804a).setDepth(2);
      this.add.rectangle(VIEW.width / 2, groundY, VIEW.width, 1, 0xd8a860).setDepth(2);
      const hero = this.add.sprite(-20, groundY, `${key}-0`).setOrigin(0.5, 1).setDepth(3);
      const lamp = this.add.image(-12, groundY - 9, 'lamp').setDepth(4);
      this.hero = hero;
      this.lamp = lamp;
      this.done = false;
      this.step = 0;
      const follow = () => lamp.setPosition(hero.x + 8, hero.y - 9);
      this.events.on('update', follow);

      const say = (text, x, y) => {
        const t = label(this, x, y, text, { size: 6, color: '#ffffff' }).setDepth(10);
        this.time.delayedCall(1800, () => t.destroy());
      };

      hero.play(`${key}-run`);
      this.tweens.add({
        targets: hero, x: 120, duration: 2400,
        onComplete: () => {
          hero.play(`${key}-idle`);
          this.events.off('update', follow);
          this.tweens.add({ targets: lamp, y: lamp.y - 14, duration: 500, yoyo: true, hold: 900 });
          this.time.delayedCall(300, () => this.sparkle(lamp.x, lamp.y - 14));
          say('An old lamp...?', 120, groundY - 40);
          this.time.delayedCall(2000, () => this.events.on('update', follow));
          this.time.delayedCall(2100, () => this.openDoor(door, sand, groundY, key));
        },
      });
      this.input.keyboard.on('keydown', (e) => { if (['Space', 'Enter'].includes(e.code)) this.skip(); });
      this.input.on('pointerdown', () => this.skip());
    }

    sparkle(x, y) {
      for (let i = 0; i < 8; i += 1) {
        const s = this.add.rectangle(x, y, 2, 2, 0xfff6c4).setDepth(6);
        const a = (i / 8) * Math.PI * 2;
        this.tweens.add({ targets: s, x: x + Math.cos(a) * 14, y: y + Math.sin(a) * 14, alpha: 0, duration: 700, onComplete: () => s.destroy() });
      }
    }

    openDoor(door, sand, groundY, key) {
      this.cameras.main.shake(900, 0.006);
      for (let i = 0; i < 14; i += 1) {
        const d = this.add.rectangle(200 + Math.random() * 40, groundY, 3, 3, 0xd8a860).setDepth(3);
        this.tweens.add({ targets: d, y: groundY - 10 - Math.random() * 20, alpha: 0, duration: 900 + Math.random() * 400, onComplete: () => d.destroy() });
      }
      this.tweens.add({
        targets: door, y: groundY, duration: 1200,
        onComplete: () => {
          this.hero.play(`${key}-run`);
          this.tweens.add({
            targets: this.hero, x: 220, duration: 1100,
            onComplete: () => {
              this.tweens.add({ targets: [this.hero, this.lamp], alpha: 0, duration: 400 });
              this.time.delayedCall(500, () => this.slam());
            },
          });
        },
      });
    }

    slam() {
      const cam = this.cameras.main;
      cam.fadeOut(400, 0, 0, 0);
      this.time.delayedCall(450, () => {
        cam.resetFX();
        this.children.removeAll(true);
        this.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width * 2, VIEW.height * 2, 0x07050d).setDepth(0);
        const slab = this.add.rectangle(VIEW.width / 2, -60, 120, 110, 0x5a4a3a).setStrokeStyle(2, 0x2a1a12).setDepth(1);
        this.tweens.add({
          targets: slab, y: 70, duration: 260, ease: 'Quad.easeIn',
          onComplete: () => {
            cam.shake(500, 0.02);
            label(this, VIEW.width / 2, 70, 'BOOM!', { size: 12, color: '#ffd34d' }).setDepth(2);
            this.time.delayedCall(900, () => this.voice());
          },
        });
      });
    }

    voice() {
      this.children.removeAll(true);
      this.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width * 2, VIEW.height * 2, 0x07050d);
      for (let i = 0; i < 30; i += 1) this.add.rectangle(Math.random() * VIEW.width, Math.random() * 90, 1, 1, 0x6a5a8a);
      label(this, VIEW.width / 2, 34, 'A VOICE ECHOES IN THE DARK', { size: 6, color: '#b07bff' });
      this.add.rectangle(VIEW.width / 2, 112, 296, 86, 0x15124a).setStrokeStyle(2, 0xffffff);
      const full = 'You shall not escape with gold or jewels, but with what you hold in your mind! Cross the path of numbers and pass the trials of the sages if you wish to survive.';
      const text = this.add.text(22, 74, '', {
        fontFamily: "'Press Start 2P', monospace", fontSize: '6px', color: '#ffffff', lineSpacing: 5,
        wordWrap: { width: 276 }, resolution: 8,
      });
      this.typing = { full, text, i: 0 };
      this.typer = this.time.addEvent({
        delay: 32, loop: true,
        callback: () => {
          const tp = this.typing;
          tp.i += 1;
          tp.text.setText(tp.full.slice(0, tp.i));
          if (tp.i >= tp.full.length) this.finishTyping();
        },
      });
      this.step = 1;
    }

    finishTyping() {
      if (!this.typing || this.step !== 1) return;
      this.typer?.remove();
      this.typing.text.setText(this.typing.full);
      this.step = 2;
      const go = label(this, VIEW.width / 2, 166, '> PRESS SPACE OR TAP TO ENTER THE CAVE', { size: 5, color: '#ffd34d' });
      this.tweens.add({ targets: go, alpha: 0.3, duration: 500, yoyo: true, repeat: -1 });
    }

    skip() {
      if (this.done) return;
      if (this.step === 1) { this.finishTyping(); return; }
      if (this.step === 2) { this.done = true; api.introDone(); }
    }
  };
}

// ======================================================================= level
export function levelScene(Phaser, api) {
  return class Level extends Phaser.Scene {
    constructor() { super('level'); }

    init(data) {
      this.stage = data.stage || 1;
      this.map = STAGES[this.stage];
      this.cols = this.map[0].length;
      // The same scene object is reused for every stage: start clean.
      Object.assign(this, {
        done: false, over: false, held: false, boss: null, bossStarted: false, bossGate: null,
        bossAt: null, rune: null, exitAt: null, exit: null, hurtUntil: 0, carpetUntil: 0, lastTouch: {},
      });
    }

    create() {
      const stage = this.stage;
      const W = this.cols * T;
      const H = ROWS * T;
      this.physics.world.gravity.y = GRAVITY;
      this.physics.world.setBounds(0, -400, W, H + 800);
      const cam = this.cameras.main;
      cam.setZoom(VIEW.zoom);
      cam.setBounds(0, 0, W, H);
      this.scrollBg = parallax(this, stage);
      this.held = false;
      this.hurtUntil = 0;
      this.over = false;

      // textures
      for (let v = 0; v < 3; v += 1) {
        tex(this, `rock${stage}-t${v}`, () => art.rockTile(stage, true, v + 1));
        tex(this, `rock${stage}-${v}`, () => art.rockTile(stage, false, v + 7));
      }
      tex(this, `ledge${stage}`, () => art.platformTile(stage));
      tex(this, 'bridge', () => art.bridgeTile(true));
      tex(this, 'bridge-ghost', () => art.bridgeTile(false));
      tex(this, 'gate', () => art.gateSprite(false));
      tex(this, 'gate-ok', () => art.gateSprite(true));
      tex(this, 'door', art.doorSprite);
      tex(this, 'exit', art.exitSprite);
      tex(this, 'merchant', art.merchantSprite);
      tex(this, 'heart', () => art.heartSprite(true));
      tex(this, 'orb', art.orbSprite);
      tex(this, 'carpet', art.carpetSprite);
      tex(this, 'lava-deep', art.lavaDeep);
      anim(this, 'coin', frames(this, 'coin', art.coinFrames()), 6);
      anim(this, 'bat', frames(this, 'bat', art.batFrames()), 8);
      anim(this, 'ghost', frames(this, 'ghost', art.ghostFrames()), 4);
      anim(this, 'lava', frames(this, 'lava', art.lavaFrames()), 3);
      anim(this, 'torch-off', frames(this, 'torch0', art.torchFrames(false)), 1);
      anim(this, 'torch-on', frames(this, 'torch1', art.torchFrames(true)), 6);
      anim(this, 'rune', frames(this, 'rune', art.runeFrames()), 4);
      anim(this, 'zarkan', frames(this, 'zarkan', art.sorcererFrames()), 3);
      const spikes = frames(this, 'spike', art.spikeFrames());
      this.heroKey = heroAnims(this, api.skin);

      this.solids = this.physics.add.staticGroup();
      this.lavas = this.physics.add.staticGroup();
      this.spikes = this.physics.add.staticGroup();
      this.coins = this.physics.add.staticGroup();
      this.pickups = this.physics.add.staticGroup();
      this.doorsGroup = this.physics.add.staticGroup();
      this.enemies = this.physics.add.group({ allowGravity: false });
      this.orbs = this.physics.add.group({ allowGravity: false });
      this.places = [];  // things you press E at: {x, y, r, kind, ...}
      this.gates = [];
      this.doors = [];
      this.torches = [];
      let start = { x: 32, y: 120 };
      let lastGate = null;

      const at = (x, y) => this.map[y]?.[x];
      for (let y = 0; y < ROWS; y += 1) {
        for (let x = 0; x < this.cols; x += 1) {
          const ch = this.map[y][x];
          const cx = x * T + T / 2;
          const cy = y * T + T / 2;
          const floor = (y + 1) * T;
          if (ch === '#') {
            const top = at(x, y - 1) !== '#';
            this.solids.create(cx, cy, `rock${stage}-${top ? 't' : ''}${(x * 7 + y * 3) % 3}`);
          } else if (ch === '=') {
            this.solids.create(cx, y * T + 4, `ledge${stage}`);
          } else if (ch === 'L') {
            if (at(x, y - 1) === 'L') { this.add.image(cx, cy, 'lava-deep'); continue; } // only the surface hurts
            this.lavas.create(cx, cy, 'lava-0').play('lava').setSize(16, 10).setOffset(0, 6);
          } else if (ch === '^') {
            const s = this.spikes.create(cx, cy, spikes[0].key);
            s.setData('phase', x % 2);
            s.setSize(12, 8).setOffset(2, 8);
          } else if (ch === 'c') {
            this.coins.create(cx, cy, 'coin-0').play('coin').setSize(8, 8);
          } else if (ch === 'h') {
            this.pickups.create(cx, cy, 'heart').setData('kind', 'heart');
          } else if (ch === 'b') {
            const bat = this.enemies.create(cx, cy, 'bat-0').play('bat');
            bat.setData({ kind: 'bat', bx: cx, by: cy, t: Math.random() * 6 });
            bat.body.setSize(12, 6);
          } else if (ch === 'g') {
            let x0 = x; let x1 = x;
            while (x0 > 0 && at(x0 - 1, y + 1) === '#' && !'#D'.includes(at(x0 - 1, y))) x0 -= 1;
            while (x1 < this.cols - 1 && at(x1 + 1, y + 1) === '#' && !'#D'.includes(at(x1 + 1, y))) x1 += 1;
            const gh = this.enemies.create(cx, floor - 9, 'ghost-0').play('ghost').setAlpha(0.85);
            gh.setData({ kind: 'ghost', x0: x0 * T + 8, x1: x1 * T + 8, by: floor - 9, t: Math.random() * 6 });
            gh.body.setSize(10, 13);
            gh.setVelocityX(28);
          } else if (ch === 'K') {
            const t = this.add.sprite(cx, floor - 9, 'torch0-0').play('torch-off');
            this.torches.push({ x: cx, y: floor - 12, sprite: t, lit: false });
          } else if (ch === 'G') {
            const s = this.add.image(cx, floor - 12, 'gate');
            lastGate = { x: cx, y: floor - 12, sprite: s, solved: false, bridge: [] };
            this.gates.push(lastGate);
            this.places.push({ kind: 'gate', x: cx, y: floor - 12, r: 20, gate: lastGate });
          } else if (ch === 'B') {
            const ghost = this.add.image(cx, y * T + 4, 'bridge-ghost');
            lastGate?.bridge.push({ x: cx, y: y * T + 4, ghost });
          } else if (ch === 'D') {
            const d = this.doorsGroup.create(cx, floor - 16, 'door');
            const door = { x: cx, y: floor - 16, sprite: d, open: false, left: DOOR_SECONDS, started: false };
            door.label = label(this, cx, floor - 40, '', { size: 6, color: '#ffd34d' }).setDepth(8);
            this.doors.push(door);
            this.places.push({ kind: 'door', x: cx - 10, y: floor - 16, r: 22, door });
          } else if (ch === 'M') {
            this.add.image(cx + 8, floor - 14, 'merchant');
            label(this, cx + 8, floor - 34, 'MERCHANT', { size: 5, color: '#ffd34d' });
            this.places.push({ kind: 'shop', x: cx + 8, y: floor - 14, r: 22 });
          } else if (ch === 'X') {
            this.exitAt = { x: cx, y: floor - 16 };
          } else if (ch === 'P') {
            start = { x: cx, y: floor - 12 };
          } else if (ch === 'A') {
            this.bossGate = x * T;
          } else if (ch === 'Z') {
            this.bossAt = { x: cx, y: cy };
          }
        }
      }
      this.stageName = label(this, 0, 0, art.STAGE_STYLE[stage].name.toUpperCase(), { size: 8, color: '#ffd34d' })
        .setScrollFactor(0).setPosition(VIEW.width / 2 + OX, 62 + OY).setDepth(20);
      this.tweens.add({ targets: this.stageName, alpha: 0, delay: 2200, duration: 800 });

      // the hero
      this.player = this.physics.add.sprite(start.x, start.y, `${this.heroKey}-0`).setDepth(5);
      this.player.body.setSize(10, 20).setOffset(3, 4);
      this.player.setCollideWorldBounds(true);
      this.safe = { ...start };
      this.checkpoint = { ...start };
      this.jumps = 0;
      this.carpetUntil = 0;
      this.carpet = this.add.image(0, 0, 'carpet').setVisible(false).setDepth(4);
      cam.startFollow(this.player, true, 0.15, 0.15);

      this.physics.add.collider(this.player, this.solids);
      this.physics.add.collider(this.player, this.doorsGroup);
      this.physics.add.overlap(this.player, this.lavas, () => this.fall());
      this.physics.add.overlap(this.player, this.spikes, (_, s) => { if (s.getData('up')) this.hurt('spikes'); });
      this.physics.add.overlap(this.player, this.enemies, () => this.hurt('enemy'));
      this.physics.add.overlap(this.player, this.orbs, (_, o) => { o.destroy(); this.hurt('magic'); });
      this.physics.add.overlap(this.player, this.coins, (_, c) => {
        c.destroy();
        api.coin();
        this.pop(c.x, c.y, '+1', '#ffd34d');
      });
      this.physics.add.overlap(this.player, this.pickups, (_, p) => {
        p.destroy();
        api.heal();
        this.pop(p.x, p.y, '+1 HEART', '#ff4d6d');
      });
      if (this.exitAt) this.makeExit();

      // spikes pop up and down
      this.spikeUp = false;
      this.time.addEvent({
        delay: 900, loop: true,
        callback: () => {
          if (this.held) return;
          this.spikeUp = !this.spikeUp;
          this.spikes.getChildren().forEach((s) => {
            const up = this.spikeUp === !!s.getData('phase');
            s.setData('up', up);
            s.setTexture(up ? 'spike-0' : 'spike-1');
          });
        },
      });

      this.keys = this.input.keyboard.addKeys('LEFT,RIGHT,UP,DOWN,A,D,W,S,SPACE,E,ENTER,C');
      this.prompt = label(this, 0, 0, 'E', { size: 6, color: '#ffd34d' }).setDepth(9).setVisible(false);
      this.lastTouch = {};
      this.report();
    }

    makeExit() {
      const e = this.exitAt;
      this.exit = this.physics.add.staticImage(e.x, e.y, 'exit').setDepth(2);
      this.exit.setSize(12, 28);
      this.physics.add.overlap(this.player, this.exit, () => this.finish());
      label(this, e.x, e.y - 24, 'WAY OUT', { size: 5, color: '#8fe6ff' });
    }

    // ------------------------------------------------------------- helpers
    pop(x, y, text, color) {
      const t = label(this, x, y - 6, text, { size: 6, color }).setDepth(12);
      this.tweens.add({ targets: t, y: y - 22, alpha: 0, duration: 700, onComplete: () => t.destroy() });
    }

    hold(on) {
      this.held = on;
      if (on) this.physics.world.pause(); else this.physics.world.resume();
    }

    report() {
      api.hud({
        gates: this.gates.filter((g) => g.solved).length,
        gatesTotal: this.gates.length,
        doors: this.doors.filter((d) => d.open).length,
        doorsTotal: this.doors.length,
        shields: this.boss ? this.boss.shields : null,
        carpet: this.carpetUntil > this.time.now ? Math.ceil((this.carpetUntil - this.time.now) / 1000) : 0,
      });
    }

    hurt(why) {
      if (this.over || this.held || this.time.now < this.hurtUntil) return;
      this.hurtUntil = this.time.now + 1300;
      this.cameras.main.shake(160, 0.006);
      const left = api.hurt(why);
      if (left <= 0) { this.over = true; return; }
      const p = this.player;
      p.setVelocity(p.flipX ? 120 : -120, -160);
      this.tweens.add({ targets: p, alpha: 0.3, duration: 100, yoyo: true, repeat: 5, onComplete: () => p.setAlpha(1) });
    }

    fall() {
      if (this.over || this.held) return;
      const p = this.player;
      if (this.time.now >= this.hurtUntil) this.hurt('lava');
      if (this.over) return;
      p.setPosition(this.safe.x, this.safe.y - 4);
      p.setVelocity(0, 0);
      this.pop(p.x, p.y - 10, 'OUCH!', '#ff7a1a');
    }

    nearest() {
      const p = this.player;
      let best = null;
      let bestD = Infinity;
      for (const pl of this.places) {
        if (pl.gate?.solved || pl.door?.open || pl.used) continue;
        const d = Math.hypot(pl.x - p.x, pl.y - p.y);
        if (d < pl.r && d < bestD) { best = pl; bestD = d; }
      }
      return best;
    }

    async use(place) {
      if (place.kind === 'shop') { api.shop(); return; }
      if (place.kind === 'gate') {
        const ok = await api.ask('gate');
        if (!ok || this.over) return;
        const g = place.gate;
        g.solved = true;
        g.sprite.setTexture('gate-ok');
        g.bridge.forEach((b, i) => this.time.delayedCall(i * 70, () => {
          b.ghost.destroy();
          const plank = this.solids.create(b.x, b.y, 'bridge');
          plank.setAlpha(0);
          this.tweens.add({ targets: plank, alpha: 1, duration: 200 });
        }));
        this.pop(g.x, g.y - 16, 'BRIDGE!', '#7ddc7a');
      } else if (place.kind === 'door') {
        const d = place.door;
        const ok = await api.ask('door');
        if (this.over) return;
        if (!ok) { d.left = Math.max(5, d.left - 10); this.pop(d.x, d.y - 30, '-10s', '#ff4d4d'); return; }
        d.open = true;
        d.label.setText('');
        this.tweens.add({ targets: d.sprite, y: d.y - 30, alpha: 0, duration: 500, onComplete: () => { d.sprite.disableBody(true, true); } });
      } else if (place.kind === 'spell') {
        const ok = await api.ask('spell');
        if (this.over || !this.boss) return;
        place.used = true;
        this.rune?.destroy();
        this.rune = null;
        if (ok) this.blast(); else this.time.delayedCall(800, () => this.spawnRune());
      }
      this.report();
    }

    // ------------------------------------------------------------- the boss
    startBoss() {
      this.bossStarted = true;
      const x0 = this.bossGate;
      for (let y = 0; y < ROWS - 3; y += 1) this.solids.create(x0 - T / 2, y * T + T / 2, `rock${this.stage}-0`);
      this.cameras.main.setBounds(x0 - T, 0, this.cols * T - x0 + T, ROWS * T);
      this.checkpoint = { x: x0 + 48, y: 9 * T };
      const z = this.bossAt;
      const sprite = this.add.sprite(z.x, z.y, 'zarkan-0').play('zarkan').setDepth(6);
      const shield = this.add.circle(z.x, z.y, 34, 0x9b5cff, 0.18).setStrokeStyle(2, 0xd6a2ff, 0.9).setDepth(7);
      this.boss = { sprite, shield, shields: BOSS_SHIELDS, t: 0, nextShot: this.time.now + 2500, bx: z.x, by: z.y };
      const name = label(this, 0, 0, 'ZARKAN THE SORCERER', { size: 8, color: '#d6a2ff' }).setScrollFactor(0).setPosition(VIEW.width / 2 + OX, 30 + OY).setDepth(20);
      const sub = label(this, 0, 0, 'STAND ON A RUNE AND PRESS E TO CAST A NUMBER SPELL', { size: 5, color: '#ffffff' }).setScrollFactor(0).setPosition(VIEW.width / 2 + OX, 44 + OY).setDepth(20);
      this.tweens.add({ targets: [name, sub], alpha: 0, delay: 3500, duration: 800 });
      this.cameras.main.flash(300, 155, 92, 255);
      this.spawnRune();
      this.report();
    }

    spawnRune() {
      if (!this.boss || this.boss.shields <= 0) return;
      const view = this.cameras.main.worldView;
      const x0 = Math.max(this.bossGate + T * 2, view.x + 24);
      const x1 = Math.min(this.cols * T - T * 3, view.right - 24);
      let x = x0 + Math.random() * (x1 - x0);
      if (Math.abs(x - this.player.x) < 40) x = x > (x0 + x1) / 2 ? x - 80 : x + 80;
      const y = 10 * T - 4;
      this.rune = this.add.sprite(x, y, 'rune-0').play('rune').setDepth(3);
      this.places = this.places.filter((p) => p.kind !== 'spell');
      this.places.push({ kind: 'spell', x, y: y - 8, r: 16 });
    }

    blast() {
      const b = this.boss;
      const p = this.player;
      const bolt = this.add.circle(p.x, p.y - 6, 5, 0xffd34d).setDepth(9);
      this.tweens.add({
        targets: bolt, x: b.sprite.x, y: b.sprite.y, duration: 380, ease: 'Quad.easeIn',
        onComplete: () => {
          bolt.destroy();
          for (let i = 0; i < 14; i += 1) {
            const s = this.add.rectangle(b.sprite.x, b.sprite.y, 3, 3, i % 2 ? 0xffd34d : 0xd6a2ff).setDepth(9);
            const a = Math.random() * Math.PI * 2;
            this.tweens.add({ targets: s, x: s.x + Math.cos(a) * 40, y: s.y + Math.sin(a) * 40, alpha: 0, duration: 600, onComplete: () => s.destroy() });
          }
          b.shields -= 1;
          this.cameras.main.shake(250, 0.01);
          b.sprite.setTintFill(0xffffff);
          this.time.delayedCall(120, () => b.sprite.clearTint());
          this.pop(b.sprite.x, b.sprite.y - 30, 'SHIELD BROKEN!', '#ffd34d');
          this.report();
          if (b.shields <= 0) this.defeatBoss(); else this.time.delayedCall(900, () => this.spawnRune());
        },
      });
    }

    defeatBoss() {
      const b = this.boss;
      this.orbs.clear(true, true);
      b.shield.destroy();
      b.dead = true;
      this.tweens.add({ targets: b.sprite, alpha: 0, angle: 20, y: b.sprite.y + 30, duration: 1600 });
      this.cameras.main.flash(500, 255, 230, 120);
      this.pop(b.sprite.x, b.sprite.y - 40, 'ZARKAN IS DEFEATED!', '#ffd34d');
      for (let i = 0; i < 10; i += 1) {
        const c = this.coins.create(b.sprite.x - 60 + i * 12, 8 * T, 'coin-0').play('coin');
        c.setSize(8, 8);
      }
      this.exitAt = { x: (this.cols - 4) * T + 8, y: 10 * T - 16 };
      this.time.delayedCall(1200, () => this.makeExit());
    }

    updateBoss(dt) {
      const b = this.boss;
      if (!b || b.dead) return;
      b.t += dt / 1000;
      // Hover near the hero so he's always on screen, keeping out of reach.
      const lo = this.bossGate + 48;
      const hi = this.cols * T - 48;
      const side = this.player.x < (lo + hi) / 2 ? 1 : -1;
      const want = Math.max(lo, Math.min(hi, this.player.x + side * 110));
      b.bx += (want - b.bx) * Math.min(1, dt / 900);
      const x = b.bx + Math.sin(b.t * 0.8) * 16;
      const y = b.by + Math.sin(b.t * 2) * 8;
      b.sprite.setPosition(x, y).setFlipX(this.player.x > x);
      b.shield.setPosition(x, y).setAlpha(0.3 + 0.7 * (b.shields / BOSS_SHIELDS));
      if (this.time.now > b.nextShot) {
        b.nextShot = this.time.now + Math.max(1300, 2600 - (BOSS_SHIELDS - b.shields) * 250);
        const o = this.orbs.create(x, y + 10, 'orb');
        const a = Math.atan2(this.player.y - (y + 10), this.player.x - x);
        const speed = 75 + (BOSS_SHIELDS - b.shields) * 8;
        o.setVelocity(Math.cos(a) * speed, Math.sin(a) * speed);
        o.body.setSize(6, 6);
        this.time.delayedCall(4500, () => o.destroy());
      }
    }

    finish() {
      if (this.over || this.done) return;
      this.done = true;
      this.hold(true);
      api.cleared();
    }

    // ------------------------------------------------------------- the loop
    update(_, dt) {
      const cam = this.cameras.main;
      this.scrollBg(cam.scrollX);
      if (this.held || this.over || this.done) return;
      const p = this.player;
      const k = this.keys;
      const t = api.touch;
      const edge = (name, down) => { const was = this.lastTouch[name]; this.lastTouch[name] = down; return down && !was; };
      const left = k.LEFT.isDown || k.A.isDown || t.left;
      const right = k.RIGHT.isDown || k.D.isDown || t.right;
      const upHeld = k.UP.isDown || k.W.isDown || t.up || k.SPACE.isDown || t.jump;
      const downHeld = k.DOWN.isDown || k.S.isDown || t.down;
      const jumpPressed = Phaser.Input.Keyboard.JustDown(k.SPACE) || Phaser.Input.Keyboard.JustDown(k.UP) || Phaser.Input.Keyboard.JustDown(k.W) || edge('jump', t.jump);
      const actPressed = Phaser.Input.Keyboard.JustDown(k.E) || Phaser.Input.Keyboard.JustDown(k.ENTER) || edge('act', t.act);
      const carpetPressed = Phaser.Input.Keyboard.JustDown(k.C) || edge('carpet', t.carpet);

      const flying = this.carpetUntil > this.time.now;
      p.setVelocityX(left ? -SPEED : right ? SPEED : 0);
      if (left) p.setFlipX(true); else if (right) p.setFlipX(false);
      const onFloor = p.body.blocked.down;
      if (onFloor) {
        this.jumps = 0;
        this.safe = { x: p.x, y: p.y };
      }
      if (flying) {
        p.setVelocityY(upHeld ? -SPEED : downHeld ? SPEED : 0);
        this.carpet.setVisible(true).setPosition(p.x, p.y + 13);
      } else {
        if (this.carpet.visible) {
          this.carpet.setVisible(false);
          p.body.setAllowGravity(true);
          this.report();
        }
        if (jumpPressed && (onFloor || (api.doubleJump && this.jumps < 2))) {
          this.jumps = onFloor ? 1 : 2;
          p.setVelocityY(-JUMP);
        }
      }
      if (carpetPressed && !flying && api.carpet()) {
        this.carpetUntil = this.time.now + CARPET_MS;
        p.body.setAllowGravity(false);
        p.setVelocityY(-40);
        this.report();
        this.time.delayedCall(CARPET_MS + 50, () => this.report());
      }
      const key = this.heroKey;
      const want = flying ? `${key}-idle` : !onFloor ? `${key}-jump` : p.body.velocity.x ? `${key}-run` : `${key}-idle`;
      if (p.anims.currentAnim?.key !== want) p.play(want);

      // enemies
      this.enemies.getChildren().forEach((e) => {
        const d = e.data.values;
        d.t += dt / 1000;
        if (d.kind === 'bat') {
          e.setPosition(d.bx + Math.sin(d.t * 1.3) * 28, d.by + Math.sin(d.t * 3) * 10);
          e.setFlipX(Math.cos(d.t * 1.3) < 0);
        } else {
          if (e.x <= d.x0) e.setVelocityX(28);
          if (e.x >= d.x1) e.setVelocityX(-28);
          e.setFlipX(e.body.velocity.x < 0);
          e.y = d.by + Math.sin(d.t * 3) * 2;
        }
      });

      // checkpoints
      this.torches.forEach((tc) => {
        if (!tc.lit && Math.abs(tc.x - p.x) < 14 && Math.abs(tc.y - p.y) < 30) {
          tc.lit = true;
          tc.sprite.play('torch-on');
          this.checkpoint = { x: tc.x, y: tc.y };
          this.pop(tc.x, tc.y - 14, 'CHECKPOINT', '#ffd34d');
        }
      });

      // sand-timer doors count down once you're close
      this.doors.forEach((d) => {
        if (d.open) return;
        if (!d.started && Math.abs(d.x - p.x) < 80) d.started = true;
        if (!d.started) return;
        d.left -= dt / 1000;
        d.label.setText(`${Math.ceil(d.left)}s`).setColor(d.left < 10 ? '#ff4d4d' : '#ffd34d');
        if (d.left <= 0) {
          d.left = DOOR_SECONDS;
          this.hurt('timer');
          this.pop(d.x, d.y - 30, 'TIME!', '#ff4d4d');
        }
      });

      // the boss's hall
      if (this.bossGate && !this.bossStarted && p.x > this.bossGate + 40) this.startBoss();
      this.updateBoss(dt);

      // press E
      const near = this.nearest();
      this.prompt.setVisible(!!near);
      if (near) this.prompt.setPosition(near.x, near.y - (near.kind === 'spell' ? 20 : 30)).setText(near.kind === 'shop' ? 'E: TRADE' : 'E');
      if (near?.kind === 'shop') this.prompt.setY(near.y - 44);
      if (actPressed && near) this.use(near);

      if (p.y > ROWS * T + 30) this.fall();
    }

    setSkin(skin) {
      this.heroKey = heroAnims(this, skin);
      this.player.play(`${this.heroKey}-idle`);
    }

    respawn() {
      this.over = false;
      this.player.setPosition(this.checkpoint.x, this.checkpoint.y).setVelocity(0, 0).setAlpha(1);
    }
  };
}

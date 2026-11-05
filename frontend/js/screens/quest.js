/**
 * Knowledge Quest: The Lost Archives. A 2D pixel-art adventure through the
 * student's own term: one room per topic, in course order. Each room hides an
 * item (a key, a book, a crystal…); walking up to it and pressing E (or tapping
 * it) asks one question from that topic. A right answer collects the item and
 * opens the door to the next topic; a wrong one shows the answer and offers
 * another question from the same topic. The last room holds the Scroll of
 * Knowledge: completing it ends the quest with score, XP and a badge.
 */
import { h, mount, toast, burst, answerLabel, questionBody, LETTERS } from '../ui.js';
import { go } from '../router.js';
import { loadCourse, loadCurriculumIndex, prepareQuestions, checkAnswer, ensureSolved } from '../data.js';
import { createScorer } from '../scoring.js';
import { CHARACTERS } from '../characters.js';
import { profile, awardBadge } from '../state.js';
import { aiCheck } from '../feedback.js';
import { T, buildArt, heroFrames, THEMES, FINAL_THEME, ITEM_ORDER, itemName } from '../quest/art.js';

const VIEW_W = 320;           // art pixels shown across (scaled up to the canvas)
const VIEW_H = 180;
const SCALE = 3;
const ROOM_W = 14;            // tiles per room (rooms share their side walls)
const ROOM_H = 11;
const DOOR_ROW = 5;
const SPEED = 62;             // art pixels per second
const REACH = 22;             // how close the hero must be to an item

export function renderQuest(app, { courseId }) {
  let stopped = false;
  let raf = 0;
  mount(app, h('section.loading', {}, 'Opening the Lost Archives…'));
  Promise.all([loadCourse(courseId), loadCurriculumIndex()]).then(([course, index]) => {
    if (!stopped) start(course, index);
  }).catch((err) => mount(app, h('section.panel.error', {}, err.message)));

  function start(course, index) {
    // One room per topic that has multiple-choice questions, in course order.
    const topics = course.topics.map((t) => ({
      id: t.id, name: t.name,
      queue: prepareQuestions([{ key: `${course.id}:${t.id}`, name: t.name, questions: t.questions }], { mcqOnly: true })
        .filter((q) => q.type !== 'widget' && q.options?.length >= 2)
        .sort((a, b) => (a.answer == null) - (b.answer == null)), // known keys first: no wait to grade
      tried: 0,
    })).filter((t) => t.queue.length);
    if (!topics.length) {
      mount(app, h('section.panel.error', {}, 'This term has no questions for the quest yet.'));
      return;
    }
    const scorer = createScorer('practice');
    const startedAt = Date.now();
    const answered = [];
    const art = buildArt();
    const hero = CHARACTERS[profile.character] || CHARACTERS.warrior;
    const frames = heroFrames(profile.character, hero.color);
    const rooms = topics.length + 1; // + the final room
    const map = buildMap(topics.length);
    const collected = new Set();
    const doors = new Set(); // rooms whose right-hand door is open
    const player = { x: (2 + 0.5) * T, y: (DOOR_ROW + 0.8) * T, dir: 'down', moving: false, step: 0 };
    const keys = {};
    const sparkles = [];
    let camX = 0;
    let dialog = null;   // the open question, if any
    let banner = { text: `Topic 1 · ${topics[0].name}`, sub: THEMES[0].name, t: 3 };
    let lastRoom = 0;
    let finished = false;

    // ----------------------------------------------------------------- layout
    const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    const canvas = h('canvas.quest-canvas', { width: VIEW_W * SCALE, height: VIEW_H * SCALE, 'aria-label': 'Knowledge Quest map' });
    const ctx = canvas.getContext('2d');
    const view = document.createElement('canvas');
    view.width = VIEW_W;
    view.height = VIEW_H;
    const vctx = view.getContext('2d');
    const box = h('div.quest-dialog', { hidden: true, role: 'dialog', 'aria-modal': 'true' });
    const hold = (name) => ({
      onpointerdown: (e) => { e.preventDefault(); keys[name] = true; },
      onpointerup: () => { keys[name] = false; },
      onpointerleave: () => { keys[name] = false; },
      onpointercancel: () => { keys[name] = false; },
      oncontextmenu: (e) => e.preventDefault(),
    });
    const pad = touch && h('div.quest-pad', {},
      h('div.quest-dpad', {},
        h('button.qp-up', { type: 'button', 'aria-label': 'Up', ...hold('up') }, '▲'),
        h('button.qp-left', { type: 'button', 'aria-label': 'Left', ...hold('left') }, '◀'),
        h('button.qp-right', { type: 'button', 'aria-label': 'Right', ...hold('right') }, '▶'),
        h('button.qp-down', { type: 'button', 'aria-label': 'Down', ...hold('down') }, '▼')),
      h('button.quest-a', { type: 'button', 'aria-label': 'Look', onpointerdown: (e) => { e.preventDefault(); interact(); } }, 'A'));
    canvas.addEventListener('pointerdown', (e) => {
      // Tapping the item (or anywhere when it's in reach) inspects it.
      const r = canvas.getBoundingClientRect();
      const wx = ((e.clientX - r.left) / r.width) * VIEW_W + camX;
      const wy = ((e.clientY - r.top) / r.height) * VIEW_H;
      const target = nearTarget();
      if (target && Math.hypot(wx - target.cx, wy - target.cy) < 24) interact();
    });

    mount(app, h('section.quest', {},
      h('div.crumbs', {}, h('button.link', { onclick: () => go('curriculum') }, '← School Curriculum'), h('span', {}, 'Knowledge Quest')),
      h('div.quest-head', {},
        h('div', {}, h('p.eyebrow', {}, `Term ${course.term} · ${topics.length} topics`), h('h1.display', {}, 'The Lost Archives')),
        h('button.btn.ghost.sm', { onclick: () => { if (finished || confirm('Leave the quest? Your progress in this run will be lost.')) go('curriculum'); } }, 'Leave')),
      h('div.quest-stage', {}, canvas, box),
      pad,
      h('p.muted.small.quest-help', {}, touch
        ? 'Walk with the arrows. Stand next to the glowing item and press A (or tap it) to read its riddle.'
        : 'Walk with the arrow keys or W A S D. Stand next to the glowing item and press E, Space or Enter to read its riddle. Answer with 1–4.')));

    // ------------------------------------------------------------------ input
    const KEYMAP = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const down = e.type === 'keydown';
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (dialog) {
        if (down && /^[1-4]$/.test(k)) dialog.pick?.(Number(k) - 1);
        if (down && k === 'Escape') closeDialog();
        return;
      }
      if (KEYMAP[k]) {
        keys[KEYMAP[k]] = down;
        e.preventDefault();
      } else if (down && (k === 'e' || k === ' ' || k === 'Enter')) {
        e.preventDefault();
        interact();
      }
    }
    const clearKeys = () => Object.keys(keys).forEach((k) => { keys[k] = false; });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', clearKeys);

    // -------------------------------------------------------------------- map
    function buildMap(topicRooms) {
      const total = topicRooms + 1;
      const w = total * ROOM_W + 1;
      const tiles = Array.from({ length: ROOM_H }, () => new Array(w).fill(null));
      const things = []; // { room, x, y, kind: 'item'|'pedestal', item }
      for (let r = 0; r < total; r += 1) {
        const x0 = r * ROOM_W;
        const theme = r === topicRooms ? FINAL_THEME : THEMES[r % THEMES.length];
        let seed = (course.id.length * 131 + r * 977) >>> 0;
        const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        for (let y = 0; y < ROOM_H; y += 1) {
          for (let x = x0; x <= x0 + ROOM_W; x += 1) {
            const edge = y === 0 || y === ROOM_H - 1 || x === x0 || x === x0 + ROOM_W;
            if (edge && tiles[y][x]?.kind === 'door') continue;
            tiles[y][x] = edge
              ? { kind: 'wall', front: y === 0, room: r }
              : { kind: 'floor', floor: theme.floor, v: Math.floor(rnd() * 4), room: r };
          }
        }
        if (r < topicRooms) tiles[DOOR_ROW][x0 + ROOM_W] = { kind: 'door', room: r };
        // Obstacles stand on even/even cells only, so every room stays walkable.
        const spots = [];
        for (let ly = 2; ly <= ROOM_H - 3; ly += 2) for (let lx = 2; lx <= ROOM_W - 2; lx += 2) spots.push([x0 + lx, ly]);
        let item = null;
        if (r < topicRooms) {
          const far = spots.filter(([x]) => x - x0 >= 7);
          item = far[Math.floor(rnd() * far.length)];
          things.push({ room: r, x: item[0], y: item[1], kind: 'item', item: ITEM_ORDER[r % ITEM_ORDER.length] });
        } else {
          item = [x0 + 8, 4];
          things.push({ room: r, x: item[0], y: item[1], kind: 'pedestal', item: 'scroll' });
        }
        for (const [x, y] of spots) {
          if (x === item[0] && y === item[1]) continue;
          if (r === 0 && x - x0 <= 2) continue; // keep the start clear
          if (rnd() < (r === topicRooms ? 0.3 : 0.45)) tiles[y][x] = { ...tiles[y][x], obstacle: theme.obstacle };
        }
      }
      return { tiles, things, w };
    }

    const solid = (tx, ty) => {
      const t = map.tiles[ty]?.[tx];
      if (!t) return true;
      if (t.kind === 'wall') return true;
      if (t.kind === 'door') return !doors.has(t.room);
      if (t.obstacle) return true;
      return map.things.some((it) => it.x === tx && it.y === ty && !(it.kind === 'item' && collected.has(it.room)));
    };
    const blocked = (x, y) => {
      // the hero's feet: a 10x6 box
      const pts = [[x - 5, y - 5], [x + 5, y - 5], [x - 5, y], [x + 5, y]];
      return pts.some(([px, py]) => solid(Math.floor(px / T), Math.floor(py / T)));
    };
    const roomOf = (x) => Math.max(0, Math.min(rooms - 1, Math.floor(x / T / ROOM_W)));

    function nearTarget() {
      const r = roomOf(player.x);
      const it = map.things.find((t) => t.room === r && !(t.kind === 'item' && collected.has(r)));
      if (!it) return null;
      const cx = (it.x + 0.5) * T;
      const cy = (it.y + 0.5) * T;
      return Math.hypot(player.x - cx, player.y - 4 - cy) < REACH ? { ...it, cx, cy } : null;
    }

    // -------------------------------------------------------------- riddles
    function interact() {
      if (dialog || finished) return;
      const it = nearTarget();
      if (!it) return;
      clearKeys();
      if (it.kind === 'pedestal') finish();
      else ask(it.room);
    }

    function nextQuestion(topic) {
      const q = topic.queue[topic.tried % topic.queue.length];
      topic.tried += 1;
      return q;
    }

    function ask(room) {
      const topic = topics[room];
      const q = nextQuestion(topic);
      dialog = { room, q, state: 'asking' };
      dialog.pick = (i) => answer(i);
      drawDialog();
    }

    function closeDialog() {
      if (dialog?.state === 'checking') return;
      dialog = null;
      box.hidden = true;
      canvas.focus?.();
    }

    async function answer(i) {
      const d = dialog;
      if (!d || d.state !== 'asking' || i >= d.q.options.length) return;
      d.chosen = i;
      let correct;
      if (d.q.answer != null) {
        correct = i === d.q.answer;
      } else {
        d.state = 'checking';
        drawDialog();
        try {
          const r = await checkAnswer(d.q, { choice: i });
          if (r.answer != null) d.q.answer = r.answer;
          correct = r.correct;
        } catch { correct = null; }
        if (dialog !== d) return;
        if (correct == null) {
          d.state = 'asking';
          toast('Couldn’t check that one', 'Check your connection and try again.', { icon: '⚠️', tone: 'danger' });
          drawDialog();
          return;
        }
      }
      const record = { ...d.q, chosen: i, correct, topicKey: d.q.topicKey, topicName: d.q.topicName };
      Object.assign(record, scorer.settle(record));
      answered.push(record);
      d.record = record;
      d.state = correct ? 'right' : 'wrong';
      if (correct) unlock(d.room);
      else ensureSolved(d.q).then(() => { if (dialog === d) drawDialog(); }).catch(() => {});
      drawDialog();
    }

    function unlock(room) {
      collected.add(room);
      doors.add(room);
      const it = map.things.find((t) => t.room === room);
      for (let i = 0; i < 26; i += 1) {
        const a = Math.random() * Math.PI * 2;
        sparkles.push({ x: (it.x + 0.5) * T, y: (it.y + 0.5) * T, vx: Math.cos(a) * 50, vy: Math.sin(a) * 50 - 20, life: 0.9 });
      }
      for (let i = 0; i < 16; i += 1) {
        sparkles.push({ x: (room + 1) * ROOM_W * T + T / 2, y: (DOOR_ROW + Math.random()) * T, vx: (Math.random() - 0.5) * 30, vy: -20 - Math.random() * 30, life: 1.2 });
      }
    }

    function drawDialog() {
      const d = dialog;
      if (!d) { box.hidden = true; return; }
      box.hidden = false;
      const topic = topics[d.room];
      const item = map.things.find((t) => t.room === d.room).item;
      const title = h('p.quest-dialog-title', {}, `Topic ${d.room + 1}/${topics.length} · ${topic.name}`);
      const intro = h('p.quest-dialog-intro', {}, d.state === 'right'
        ? `✦ Correct! You take the ${itemName(item)}. ${d.room + 1 < topics.length ? 'The door to the next topic creaks open…' : 'The door to the Heart of the Archive opens…'}`
        : d.state === 'wrong' ? '✗ Not this time. The page fades… another riddle appears from the same topic.'
          : `A page of the Great Book of Knowledge glows beside the ${itemName(item)}. Solve its riddle:`);
      const opts = h('div.quest-opts', {}, d.q.options.map((o, i) => h('button.quest-opt', {
        type: 'button',
        class: d.state === 'asking' ? '' : i === d.q.answer ? 'right' : i === d.chosen ? 'wrong' : 'dim',
        disabled: d.state !== 'asking',
        onclick: () => answer(i),
      }, h('kbd', {}, LETTERS[i]), d.q.image ? '' : o)));
      const given = d.chosen != null ? answerLabel(d.q, d.chosen) : '';
      const after = [];
      if (d.state === 'checking') after.push(h('p.quest-dialog-note', {}, 'Checking your answer…'));
      if (d.state === 'wrong') {
        if (d.q.answer != null) after.push(h('p.quest-dialog-note', {}, 'Correct answer: ', h('b', {}, answerLabel(d.q, d.q.answer))));
        if (d.q.explanation) after.push(h('p.quest-dialog-note', {}, d.q.explanation));
        if (d.q.ref && given) {
          after.push(aiCheck(d.ai ||= {}, {
            q: d.q, answer: given, redraw: drawDialog,
            onAgree: () => {
              const r = scorer.regrade();
              Object.assign(d.record, { correct: true, aiAgreed: true, xp: r.xp });
              d.state = 'right';
              unlock(d.room);
            },
          }));
        }
      }
      const actions = d.state === 'right'
        ? [h('button.btn.primary', { onclick: closeDialog }, 'Continue ▶')]
        : d.state === 'wrong'
          ? [h('button.btn.primary', { onclick: () => ask(d.room) }, 'Try another riddle'), h('button.btn.ghost', { onclick: closeDialog }, 'Step away')]
          : [h('button.btn.ghost', { onclick: closeDialog, disabled: d.state === 'checking' }, 'Step away')];
      box.replaceChildren(h('div.quest-dialog-box', {},
        title, intro, h('div.quest-q', {}, questionBody(d.q, { small: false })), opts, ...after,
        h('div.quest-dialog-actions', {}, actions)));
      box.querySelector('.quest-opt:not(:disabled), .quest-dialog-actions .btn')?.focus({ preventScroll: true });
    }

    // ----------------------------------------------------------------- finish
    function finish() {
      finished = true;
      const badge = { id: `quest-${course.id}`, name: `Archivist of Term ${course.term}`, icon: '📜' };
      const fresh = awardBadge(badge);
      const result = scorer.results({
        config: { title: `Knowledge Quest · Term ${course.term}`, origin: 'curriculum', restart: () => go('quest', { courseId }) },
        modeLabel: 'Knowledge Quest',
        items: answered,
        startedAt,
        subtitle: `Grade ${course.grade} · Term ${course.term}`,
      });
      burst([hero.color, '#ffd34d', '#ffffff']);
      box.hidden = false;
      box.replaceChildren(h('div.quest-dialog-box.quest-end', {},
        h('div.quest-end-scroll', { 'aria-hidden': 'true' }, '📜'),
        h('p.quest-dialog-title', {}, 'The Scroll of Knowledge is complete!'),
        h('p.quest-dialog-intro', {}, `You restored all ${topics.length} pages of the Great Book, in order.`),
        h('div.quest-end-stats', {},
          h('div', {}, h('b', {}, result.score.toLocaleString()), h('span', {}, 'Score')),
          h('div', {}, h('b', {}, `+${result.xp}`), h('span', {}, 'XP')),
          h('div', {}, h('b', {}, `${result.correct}/${result.total}`), h('span', {}, 'Right answers'))),
        h('p.quest-badge', {}, h('span', { 'aria-hidden': 'true' }, '🏅'), ` ${fresh ? 'New badge' : 'Badge'}: ${badge.name}`),
        h('div.quest-dialog-actions', {},
          h('button.btn.primary', { onclick: () => go('results', result) }, 'See my answers ▶'),
          h('button.btn.ghost', { onclick: () => go('curriculum') }, 'Back to my course'))));
    }

    // ------------------------------------------------------------------- loop
    let last = performance.now();
    function frame(now) {
      if (stopped) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      update(dt);
      render(now / 1000);
      raf = requestAnimationFrame(frame);
    }

    function update(dt) {
      if (!dialog && !finished) {
        let dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        let dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
        player.moving = Boolean(dx || dy);
        if (player.moving) {
          if (dx && dy) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
          player.dir = dy < 0 && !dx ? 'up' : dy > 0 && !dx ? 'down' : dx > 0 ? 'right' : dx < 0 ? 'left' : player.dir;
          const nx = player.x + dx * SPEED * dt;
          const ny = player.y + dy * SPEED * dt;
          if (!blocked(nx, player.y)) player.x = nx;
          if (!blocked(player.x, ny)) player.y = ny;
          player.step += dt;
        }
      } else {
        player.moving = false;
      }
      const room = roomOf(player.x);
      if (room !== lastRoom && player.x > room * ROOM_W * T + T) {
        lastRoom = room;
        banner = room < topics.length
          ? { text: `Topic ${room + 1} · ${topics[room].name}`, sub: THEMES[room % THEMES.length].name, t: 3 }
          : { text: 'The Heart of the Archive', sub: 'Place the pages on the pedestal', t: 3 };
      }
      banner.t -= dt;
      const target = Math.max(0, Math.min(map.w * T - VIEW_W, player.x - VIEW_W / 2));
      camX += (target - camX) * Math.min(1, dt * 6);
      for (const s of sparkles) {
        s.life -= dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 40 * dt;
      }
      for (let i = sparkles.length - 1; i >= 0; i -= 1) if (sparkles[i].life <= 0) sparkles.splice(i, 1);
    }

    function render(t) {
      const g = vctx;
      g.imageSmoothingEnabled = false;
      g.fillStyle = '#0b0816';
      g.fillRect(0, 0, VIEW_W, VIEW_H);
      const ox = Math.round(camX);
      const oy = Math.floor((VIEW_H - ROOM_H * T) / 2);
      const x0 = Math.max(0, Math.floor(ox / T));
      const x1 = Math.min(map.w - 1, Math.ceil((ox + VIEW_W) / T));
      // floor, walls and doors
      for (let y = 0; y < ROOM_H; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const tile = map.tiles[y][x];
          if (!tile) continue;
          const px = x * T - ox;
          const py = y * T + oy;
          if (tile.kind === 'floor') g.drawImage(art.floors[tile.floor][tile.v], px, py);
          else if (tile.kind === 'door') g.drawImage(doors.has(tile.room) ? art.doorOpen : art.door, px, py);
          else g.drawImage((tile.front ? art.wallFront : art.wall)[(x + y) % 2], px, py);
        }
      }
      // torches on the top wall, flickering
      for (let r = 0; r < rooms; r += 1) {
        for (const lx of [4, 10]) {
          const px = (r * ROOM_W + lx) * T - ox + 8;
          if (px < -30 || px > VIEW_W + 30) continue;
          const fl = 0.8 + 0.2 * Math.sin(t * 13 + lx + r);
          const glow = g.createRadialGradient(px, oy + 10, 1, px, oy + 10, 34 * fl);
          glow.addColorStop(0, 'rgba(255,180,80,0.35)');
          glow.addColorStop(1, 'rgba(255,180,80,0)');
          g.fillStyle = glow;
          g.fillRect(px - 36, oy - 26, 72, 72);
          g.fillStyle = '#6b4426';
          g.fillRect(px - 1, oy + 9, 2, 5);
          g.fillStyle = '#ffb347';
          g.fillRect(px - 2, oy + 5 - Math.round(fl * 2), 4, 4);
          g.fillStyle = '#fff3b0';
          g.fillRect(px - 1, oy + 6 - Math.round(fl * 2), 2, 2);
        }
      }
      // obstacles, items and the hero, drawn top to bottom
      const draws = [];
      for (let y = 0; y < ROOM_H; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const tile = map.tiles[y][x];
          if (tile?.obstacle) draws.push({ z: (y + 1) * T, f: () => g.drawImage(art.obstacles[tile.obstacle], x * T - ox, y * T + oy) });
        }
      }
      for (const it of map.things) {
        const px = it.x * T - ox;
        const py = it.y * T + oy;
        if (px < -T || px > VIEW_W) continue;
        if (it.kind === 'pedestal') {
          draws.push({ z: (it.y + 1) * T, f: () => {
            g.drawImage(art.obstacles.pedestal, px, py);
            g.globalAlpha = 0.6 + 0.4 * Math.sin(t * 3);
            g.drawImage(art.items.scroll, px + 2, py - 2 + Math.round(Math.sin(t * 2) * 2));
            g.globalAlpha = 1;
          } });
        } else if (!collected.has(it.room)) {
          draws.push({ z: (it.y + 1) * T, f: () => {
            const bob = Math.round(Math.sin(t * 3 + it.room) * 2);
            const glow = g.createRadialGradient(px + 8, py + 8, 1, px + 8, py + 8, 14);
            glow.addColorStop(0, 'rgba(255,230,140,0.55)');
            glow.addColorStop(1, 'rgba(255,230,140,0)');
            g.fillStyle = glow;
            g.fillRect(px - 8, py - 8, 32, 32);
            g.drawImage(art.items[it.item], px + 2, py + 2 + bob);
            // the "?" marker above it
            g.fillStyle = '#ffd34d';
            g.font = 'bold 9px monospace';
            g.textAlign = 'center';
            g.fillText('?', px + 8, py - 3 + bob);
          } });
        }
      }
      const fr = frames[player.dir === 'left' ? 'right' : player.dir][player.moving ? Math.floor(player.step * 8) % 2 : 0];
      draws.push({ z: player.y, f: () => {
        const px = Math.round(player.x - ox);
        const py = Math.round(player.y + oy);
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(px - 5, py - 1, 10, 2);
        if (player.dir === 'left') {
          g.save();
          g.translate(px, 0);
          g.scale(-1, 1);
          g.drawImage(fr, -8, py - 16);
          g.restore();
        } else {
          g.drawImage(fr, px - 8, py - 16);
        }
      } });
      draws.sort((a, b) => a.z - b.z).forEach((d) => d.f());
      for (const s of sparkles) {
        g.globalAlpha = Math.max(0, Math.min(1, s.life * 1.5));
        g.fillStyle = s.life > 0.5 ? '#fff3b0' : '#ffd34d';
        g.fillRect(Math.round(s.x - ox), Math.round(s.y + oy), 2, 2);
      }
      g.globalAlpha = 1;

      // scale the art up, crisp
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(view, 0, 0, VIEW_W * SCALE, VIEW_H * SCALE);
      hud(t);
    }

    const PIXEL = '"Press Start 2P", ui-monospace, monospace';
    function hud(t) {
      const W = VIEW_W * SCALE;
      ctx.fillStyle = 'rgba(8,6,20,0.78)';
      ctx.fillRect(0, 0, W, 46);
      ctx.fillStyle = '#ffd34d';
      ctx.font = `12px ${PIXEL}`;
      ctx.textAlign = 'left';
      const room = Math.min(roomOf(player.x), topics.length - 1);
      ctx.fillText(`TOPIC ${Math.min(collected.size + 1, topics.length)}/${topics.length}`, 14, 20);
      ctx.fillStyle = '#e6e2f5';
      ctx.font = `9px ${PIXEL}`;
      const name = topics[room].name;
      ctx.fillText(name.length > 34 ? `${name.slice(0, 33)}…` : name, 14, 37);
      // item slots
      const slots = Math.min(topics.length, 12);
      const sx = W / 2 - (slots * 30) / 2;
      for (let i = 0; i < slots; i += 1) {
        const x = sx + i * 30;
        ctx.fillStyle = collected.has(i) ? 'rgba(255,211,77,0.22)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(x, 8, 26, 30);
        ctx.strokeStyle = collected.has(i) ? '#ffd34d' : 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, 8, 26, 30);
        const img = art.items[ITEM_ORDER[i % ITEM_ORDER.length]];
        ctx.globalAlpha = collected.has(i) ? 1 : 0.22;
        ctx.drawImage(img, x + 1, 11, 24, 24);
        ctx.globalAlpha = 1;
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffd34d';
      ctx.font = `12px ${PIXEL}`;
      ctx.fillText(`${scorer.score}`, W - 14, 20);
      ctx.fillStyle = '#e6e2f5';
      ctx.font = `9px ${PIXEL}`;
      ctx.fillText(`+${scorer.xp} XP`, W - 14, 37);
      // the "press E" prompt
      const target = !dialog && !finished && nearTarget();
      if (target) {
        const px = (target.cx - camX) * SCALE;
        const py = (target.cy + Math.floor((VIEW_H - ROOM_H * T) / 2)) * SCALE - 46;
        const label = target.kind === 'pedestal' ? (touch ? 'A: complete the scroll' : 'E: complete the scroll') : (touch ? 'A: read the riddle' : 'E: read the riddle');
        ctx.font = `9px ${PIXEL}`;
        ctx.textAlign = 'center';
        const w = ctx.measureText(label).width + 18;
        ctx.fillStyle = 'rgba(8,6,20,0.85)';
        ctx.fillRect(px - w / 2, py - 18 + Math.sin(t * 4) * 2, w, 24);
        ctx.strokeStyle = '#ffd34d';
        ctx.strokeRect(px - w / 2, py - 18 + Math.sin(t * 4) * 2, w, 24);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, px, py - 2 + Math.sin(t * 4) * 2);
      }
      // room banner
      if (banner.t > 0) {
        ctx.globalAlpha = Math.min(1, banner.t);
        ctx.fillStyle = 'rgba(8,6,20,0.82)';
        ctx.fillRect(W / 2 - 300, 200, 600, 84);
        ctx.strokeStyle = '#ffd34d';
        ctx.lineWidth = 3;
        ctx.strokeRect(W / 2 - 300, 200, 600, 84);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd34d';
        ctx.font = `14px ${PIXEL}`;
        const text = banner.text.length > 40 ? `${banner.text.slice(0, 39)}…` : banner.text;
        ctx.fillText(text, W / 2, 236);
        ctx.fillStyle = '#e6e2f5';
        ctx.font = `10px ${PIXEL}`;
        ctx.fillText(banner.sub, W / 2, 264);
        ctx.globalAlpha = 1;
      }
    }

    // read-only view of the game for automated tests
    canvas.questState = { player, map, collected, doors, get dialog() { return dialog; }, get finished() { return finished; } };
    raf = requestAnimationFrame(frame);
    cleanupInput = () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', clearKeys);
    };
  }

  let cleanupInput = () => {};
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    cleanupInput();
  };
}

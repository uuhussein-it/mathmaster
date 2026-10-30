/**
 * The class arena lobby: pick a game (Fight, Car Race, Math Duel, Number
 * Hunt), challenge a classmate or practise against a bot. Also your fighter
 * (stats come from your quiz progress), incoming challenges, the leaderboard
 * and your recent games. An accepted challenge opens the game for both.
 */
import { h, mount, toast, prefs } from '../ui.js';
import { CHARACTERS } from '../characters.js';
import { go } from '../router.js';
import { adminApi as api } from '../account.js';
import { askNotifications, notificationsState } from '../alerts.js';
import { POWERS } from '../games/powers.js';

const POLL_MS = 2500;
const SKIN_NAMES = { base: 'Recruit', bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

export function renderArena(app) {
  let data = null;
  let error = '';
  let timer = null;
  let stopped = false;
  let pick = prefs.get('arena-game', 'fight');

  async function refresh() {
    try {
      data = await api('api/arena');
      error = '';
      if (data.match) {
        stopped = true;
        go('fight', { match: data.match });
        return;
      }
    } catch (e) {
      error = e.message;
    }
    if (!stopped) {
      draw();
      timer = setTimeout(refresh, POLL_MS);
    }
  }

  async function act(fn, done) {
    try {
      const r = await fn();
      if (done) done(r);
    } catch (e) {
      toast('Arena', e.message, { icon: '⚠️', tone: 'danger' });
    }
    if (stopped) return;
    clearTimeout(timer);
    refresh();
  }

  const gameOf = (id) => data.games.find((g) => g.id === id) || data.games[0];
  const challenge = (f) => act(() => api('api/arena/challenge', { method: 'POST', body: { opponent: f.id, game: pick } }),
    () => toast('Challenge sent', `${gameOf(pick).name}: waiting for ${f.name} to accept…`, { icon: gameOf(pick).icon }));
  const practise = (g) => act(() => api('api/arena/practice', { method: 'POST', body: { game: g.id } }),
    (r) => { if (r.match) { stopped = true; go('fight', { match: r.match }); } });
  const choose = (id) => { pick = id; prefs.set('arena-game', id); draw(); };
  const answer = (c, accept) => act(() => api(`api/arena/challenge/${c.id}`, { method: 'POST', body: { accept } }),
    (r) => { if (r.match) { stopped = true; go('fight', { match: r.match }); } });
  const cancel = (c) => act(() => api(`api/arena/challenge/${c.id}`, { method: 'DELETE' }));

  const portrait = (character, cls = '') => {
    const c = CHARACTERS[character];
    return c ? h(`img.arena-portrait${cls}`, { src: c.portrait, alt: '' }) : h(`span.arena-portrait.empty${cls}`, {}, '?');
  };

  function statBar(label, value, max, text) {
    return h('div.arena-stat', {},
      h('span', {}, label),
      h('div.arena-stat-bar', {}, h('i', { style: { width: `${Math.min(100, (value / max) * 100)}%` } })),
      h('b', {}, text));
  }

  function meCard(me) {
    const specials = data.specials.map((s) => {
      const open = me.specials.includes(s.id);
      return h('li', { class: open ? 'open' : 'locked' },
        h('b', {}, open ? s.name : `🔒 ${s.name}`),
        h('span', {}, open ? s.combo : `Level ${s.level}`));
    });
    return h('section.panel.arena-me', {},
      h('div.arena-me-head', {},
        h('div', { class: `arena-skin skin-${me.skin}` }, portrait(me.character)),
        h('div', {},
          h('p.eyebrow', {}, `${SKIN_NAMES[me.skin]} fighter · Level ${me.level}`),
          h('h2', {}, me.name),
          h('p.muted', {}, `${me.wins} wins · ${me.losses} losses · ${me.draws} draws`,
            me.streak > 1 ? ` · 🔥 ${me.streak} win streak` : ''),
          h('p.muted', {}, `Arena XP ${me.arena_xp >= 0 ? '+' : ''}${me.arena_xp} · total ${me.xp.toLocaleString()} XP`))),
      h('div.arena-stats', {},
        statBar('❤️ Health', me.hp, 300, `${me.hp}`),
        statBar('⚔️ Attack', me.attack, 12, `${me.attack}`),
        statBar('⚡ Special', me.charge, 3, `×${me.charge}`)),
      h('p.muted.small', {}, 'Health grows with your level, attack with your quiz accuracy, and the special meter with your best answer streak.'),
      h('div.arena-gear', {},
        Object.values(me.gear).filter((g) => g.color).map((g) => h('span.arena-gear-item', { title: g.name }, g.icon, ' ', g.name)),
        h('button.btn.ghost.sm', { onclick: () => go('armory') }, '🎨 Gear & looks')),
      me.look && h('p.muted.small', {}, `Super power: ${POWERS[me.look.power]?.icon} ${POWERS[me.look.power]?.name}. `,
        'In a fight, answer the ⚡ power question first to fire it; in a race, every 3rd right answer fires it.'),
      h('h3.sub-title', {}, 'Special moves'),
      h('ul.arena-specials', {}, specials));
  }

  function lockedCard(me) {
    const pct = Math.min(100, Math.round((me.level / data.unlock_level) * 100));
    return h('section.panel.arena-locked', {},
      h('p.eyebrow', {}, 'Arena locked'),
      h('h2', {}, `Reach level ${data.unlock_level} to fight`),
      h('p.muted', {}, `You're level ${me.level}. Answer questions to earn XP; your progress powers your fighter.`),
      h('div.arena-stat-bar.wide', {}, h('i', { style: { width: `${pct}%` } })),
      h('button.btn.primary', { onclick: () => go('curriculum') }, '⚔️ Play my course'));
  }

  function challenges() {
    const rows = [
      ...data.incoming.map((c) => h('div.arena-challenge.incoming', {},
        h('span', {}, `${gameOf(c.game).icon} `, h('b', {}, c.from), ` challenges you to ${c.game === 'fight' ? 'a fight' : gameOf(c.game).name}!`),
        h('div', {},
          h('button.btn.primary.sm', { onclick: () => answer(c, true) }, 'Fight!'),
          h('button.btn.ghost.sm', { onclick: () => answer(c, false) }, 'Not now')))),
      ...data.outgoing.map((c) => h('div.arena-challenge', {},
        h('span', {}, `⏳ ${gameOf(c.game).name}: waiting for `, h('b', {}, c.to), ' to accept…'),
        h('button.btn.ghost.sm', { onclick: () => cancel(c) }, 'Cancel'))),
    ];
    return rows.length ? h('section.arena-challenges', { 'aria-live': 'polite' }, rows) : null;
  }

  function fighters(me) {
    const list = data.fighters;
    return h('section.panel', {},
      h('h3.sub-title', {}, 'Classmates'),
      list.length ? h('ul.arena-list', {}, list.map((f) => {
        const why = !f.online ? 'Offline' : !f.unlocked ? `Level ${f.level}` : f.busy ? 'Fighting' : '';
        return h('li', {},
          h('span', { class: `arena-dot ${f.online ? 'on' : ''}` }),
          portrait(f.character, '.sm'),
          h('span.arena-name', {}, f.name, h('small', {}, `Lv ${f.level} · ${f.wins}W ${f.losses}L`)),
          why ? h('span.muted.small', {}, why)
            : h('button.btn.sm', { disabled: !me.unlocked, onclick: () => challenge(f) }, `${gameOf(pick).icon} Challenge`));
      })) : h('p.muted', {}, 'No classmates have joined yet.'));
  }

  function board() {
    return h('section.panel', {},
      h('h3.sub-title', {}, '🏆 Top fighters'),
      data.board.length ? h('ol.board', {}, data.board.map((b, i) =>
        h('li', { class: b.id === data.me.id ? 'me' : '' },
          h('span.board-rank', {}, i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1),
          portrait(b.character, '.sm'),
          h('span.board-name', {}, b.name, b.streak > 1 && h('small', {}, ` 🔥${b.streak}`)),
          h('span.board-level', {}, `${b.wins}W ${b.losses}L`),
          h('span.board-score', {}, `${b.arena_xp >= 0 ? '+' : ''}${b.arena_xp} XP`))))
        : h('p.muted', {}, 'No fights yet. Be the first!'));
  }

  function history() {
    if (!data.history.length) return null;
    const label = { win: 'Won', loss: 'Lost', draw: 'Draw' };
    const how = { ko: 'KO', time: 'time', forfeit: 'forfeit', finish: 'finish line', score: 'first to 7' };
    return h('section.panel', {},
      h('h3.sub-title', {}, 'Your recent games'),
      h('ul.arena-history', {}, data.history.map((f) => h('li', { class: f.result },
        h('span', {}, `${gameOf(f.game).icon} `), h('b', {}, label[f.result]), h('span', {}, ` vs ${f.opponent} (${how[f.reason] || f.reason})`)))));
  }

  function gamePicker(me) {
    return h('section.panel.arena-games', {},
      h('div.arena-games-head', {},
        h('h3.sub-title', {}, '🎮 Choose a game'),
        h('p.muted.small', {}, 'Challenge a classmate to the game you pick, or practise against a bot (no XP at stake).')),
      h('div.arena-game-grid', { role: 'radiogroup', 'aria-label': 'Game' }, data.games.map((g) =>
        h('div.arena-game', { class: g.id === pick ? 'on' : '' },
          h('button.arena-game-pick', { type: 'button', role: 'radio', 'aria-checked': String(g.id === pick), onclick: () => choose(g.id) },
            h('span.arena-game-icon', { 'aria-hidden': 'true' }, g.icon),
            h('b', {}, g.name),
            h('span', {}, g.text)),
          h('button.btn.ghost.sm', { disabled: !me.unlocked || !data.realtime, onclick: () => practise(g) }, '🤖 Practice')))));
  }

  function draw() {
    if (!data) {
      mount(app, h('section.arena', {}, h('p.muted', {}, error || 'Entering the arena…')));
      return;
    }
    const me = data.me;
    mount(app,
      h('section.arena', {},
        h('div.arena-head', {},
          h('div', {}, h('p.eyebrow', {}, 'Class arena'), h('h1.display', {}, 'Battle your classmates')),
          h('div.arena-head-actions', {},
            notificationsState() === 'default' && h('button.btn.ghost.sm', {
              onclick: async () => {
                const r = await askNotifications();
                toast('Challenge alerts', r === 'granted' ? 'You’ll get a notification when someone challenges you.' : 'Alerts will still show on the page while QuestLearn is open.', { icon: '🔔' });
                draw();
              },
            }, '🔔 Alert me'),
            h('button.btn.ghost.sm', { onclick: () => go('hub') }, '← Back'))),
        !data.realtime && h('p.auth-error', {}, 'Live fights aren’t available on this server yet.'),
        error && h('p.auth-error', {}, error),
        challenges(),
        gamePicker(me),
        h('div.arena-grid', {},
          h('div', {}, me.unlocked ? meCard(me) : lockedCard(me), history()),
          h('div', {}, fighters(me), board())),
        h('p.muted.small.arena-rules', {},
          'Every game lasts up to 60 seconds. ',
          'You’ll see a challenge on any page of QuestLearn, not just here. ',
          'The winner takes XP from the loser (10% of the lower total, 5 to 50) plus a 10 XP bonus. A draw changes nothing. Practice games against the bot don’t change XP.')));
  }

  draw();
  refresh();
  return () => { stopped = true; clearTimeout(timer); };
}

/**
 * End-of-run summary: score ring, evaluation, XP, per-topic breakdown and review.
 */
import { h, mount, burst, formatTime, answerLabel, questionBody, kpi } from '../ui.js';
import { CHARACTERS } from '../characters.js';
import { profile, recordSession } from '../state.js';
import { evaluate } from '../scoring.js';
import { go } from '../router.js';
import { reportSession } from '../data.js';

export function renderResults(app, r) {
  const hero = CHARACTERS[profile.character];
  const pct = r.total ? Math.round((r.correct / r.total) * 100) : 0;
  const verdict = evaluate(pct);

  // Save once (re-rendering the same payload must not duplicate history).
  if (!r.saved) {
    r.saved = true;
    recordSession({ modeLabel: r.modeLabel, title: r.title, correct: r.correct, total: r.total, xp: r.xp, at: Date.now() });
    reportSession({
      student_name: profile.name, source: `questlearn ${r.modeLabel.toLowerCase()}`, quiz_id: r.title,
      correct: r.correct, total: r.total, pct,
      mistakes: r.items.filter((q) => !q.correct).length,
      skill_summary: JSON.stringify({ hero: hero.id, level: profile.level, xp: r.xp }),
    });
    if (pct >= 75 || r.levels) setTimeout(() => burst([hero.color, '#f6d77a', '#ffffff']), 250);
  }

  // Per-topic breakdown, weakest first.
  const byTopic = {};
  for (const item of r.items) {
    const t = (byTopic[item.topicName] ||= { name: item.topicName, seen: 0, correct: 0 });
    t.seen += 1;
    if (item.correct) t.correct += 1;
  }
  const topics = Object.values(byTopic).map((t) => ({ ...t, pct: Math.round((t.correct / t.seen) * 100) })).sort((a, b) => a.pct - b.pct);
  const weakest = topics.find((t) => t.pct < 100);

  const ring = h('div.ring', { style: { '--p': pct, '--c': hero.color }, role: 'img', 'aria-label': `${pct}% correct` },
    h('div', {}, h('b', {}, `${pct}%`), h('span', {}, `${r.correct} / ${r.total}`)));

  mount(app,
    h('section.results', {},
      h('div.results-hero.panel', {},
        ring,
        h('div.results-text', {},
          h('p.eyebrow', {}, `${r.modeLabel} complete · ${r.title}`),
          h('h1.display', {}, verdict.rank),
          h('p', {}, verdict.text),
          r.levels > 0 && h('p.level-up', {}, `⭐ Level up! You reached level ${profile.level}.`),
          h('div.kpis', {},
            kpi('XP earned', `+${r.xp}`, `incl. +${r.bonus} completion bonus`),
            kpi('Points', `+${r.score.toLocaleString()}`),
            kpi('Best streak', r.bestStreak),
            kpi('Time', formatTime(r.seconds))))),

      r.sat && h('div.panel.sat-score', {},
        h('div', {}, h('p.eyebrow', {}, 'Estimated SAT score'), h('b.sat-total', {}, r.sat.total), h('span', {}, ` / ${r.sat.sections.length * 800}`)),
        r.sat.sections.map((s) => h('div.sat-section', {}, h('span', {}, s.name), h('b', {}, s.scaled), h('small', {}, `${s.correct}/${s.total} correct`))),
        h('p.muted', {}, r.subtitle)),

      h('div.results-grid', {},
        h('div.panel', {},
          h('h3', {}, hero.id === 'explorer' ? '🧭 Explorer’s map' : 'Topic breakdown'),
          h('ul.bars', {}, topics.map((t) =>
            h('li', {}, h('span', {}, t.name), h('div.bar', {}, h('i', { style: { width: `${t.pct}%` }, class: t.pct >= 75 ? 'good' : t.pct >= 50 ? 'ok' : 'low' })), h('b', {}, `${t.correct}/${t.seen}`)))),
          weakest && h('p.tip', {}, hero.id === 'explorer'
            ? `Trail ahead: “${weakest.name}” is your weakest area (${weakest.pct}%). Practice it next for the biggest gain.`
            : `Focus next on “${weakest.name}”.`)),
        h('div.panel.actions-panel', {},
          h('h3', {}, 'What next?'),
          h('button.btn.primary.lg', { onclick: () => r.config.restart() }, 'Play again'),
          h('button.btn.ghost', { onclick: () => go(r.config.origin) }, 'Change settings'),
          h('button.btn.ghost', { onclick: () => go('hub') }, 'Back to hub'))),

      h('details.panel.review', { open: r.total <= 10 },
        h('summary', {}, `Review answers (${r.total})`),
        h('ol', {}, r.items.map((q) =>
          h('li.review-item', { class: q.correct ? 'good' : 'bad' },
            questionBody(q, { small: true }),
            h('p', {}, h('span.muted', {}, 'Your answer: '), q.text || (q.chosen >= 0 ? answerLabel(q, q.chosen) : '—'), ' ', h('b', {}, q.correct ? '✓' : '✗')),
            !q.correct && (q.type === 'free' ? q.answerText : q.answer != null)
              && h('p', {}, h('span.muted', {}, 'Correct: '), q.type === 'free' ? q.answerText : answerLabel(q, q.answer)),
            q.explanation && h('p.explanation', {}, q.explanation)))))));
}


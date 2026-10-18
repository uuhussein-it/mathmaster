/**
 * SAT Simulator: timed sections with free navigation, mark-for-review,
 * a review page before submitting, and a break between sections.
 * No feedback until the end, then scaled 200–800 section scores.
 */
import { h, mount, toast, formatTime, LETTERS, questionBody, timerEl, startCountdown } from '../ui.js';
import { CHARACTERS, SKILL_CHARGES, applySkill } from '../characters.js';
import { profile, topicMastery } from '../state.js';
import { createScorer, satScaled } from '../scoring.js';
import { go } from '../router.js';
import { ensureSolved } from '../data.js';
import { resolveKeys } from './play.js';

export function renderSimulator(app, config) {
  const hero = CHARACTERS[profile.character];
  const startedAt = Date.now();
  const sections = config.sections.map((s) => ({
    ...s,
    picks: s.questions.map(() => null),
    flags: new Set(),
    eliminated: s.questions.map(() => new Set()),
    doubleXp: new Set(),
    notes: s.questions.map(() => []),
  }));
  let si = 0;          // section index
  let qi = 0;          // question index inside section
  let view = 'intro';  // intro | question | review | break
  let deadline = null;
  let stopTimer = () => {};
  let charges = SKILL_CHARGES.sim;

  const section = () => sections[si];

  function startSection() {
    view = 'question';
    qi = 0;
    deadline = Date.now() + section().timeLimit * 1000;
    stopTimer = startCountdown(() => deadline, {
      low: 60,
      onExpire: () => {
        toast("Time's up", `${section().name} submitted.`, { icon: '⏰', tone: 'danger' });
        submitSection();
      },
    });
    if (hero.id === 'explorer') toast(hero.passive.name, hero.passive.text, { portrait: hero.portrait });
    draw();
  }

  function submitSection() {
    stopTimer();
    deadline = null;
    if (si + 1 < sections.length) {
      si += 1;
      view = 'break';
      draw();
    } else {
      finish();
    }
  }

  const goTo = (nextView, nextQ = qi) => { view = nextView; qi = nextQ; draw(); };

  // ---------------------------------------------------------------- views
  function draw() {
    const s = section();
    const top = h('div.play-top', {},
      h('button.link', { onclick: () => confirm('Exit the simulator? This test will not be scored.') && go(config.origin) }, '✕ Exit'),
      h('div.play-title', {}, h('b', {}, s.name), h('span', {}, `Section ${si + 1} of ${sections.length} · ${config.title}`)),
      deadline ? timerEl((deadline - Date.now()) / 1000) : h('span'));

    if (view === 'intro' || view === 'break') {
      mount(app, h('section.play', {}, top,
        h('div.panel.sim-intro', {},
          h('p.eyebrow', {}, view === 'break' ? 'Break' : 'Get ready'),
          h('h2', {}, view === 'break' ? `Next: ${s.name}` : s.name),
          h('p', {}, `${s.questions.length} questions · ${formatTime(s.timeLimit)} on the clock.`),
          h('ul.rules', {},
            h('li', {}, 'Use the navigator to jump between questions and mark any for review.'),
            h('li', {}, `${hero.skill.icon} ${hero.skill.name} has ${charges} charge${charges === 1 ? '' : 's'} left for the whole test.`),
            h('li', {}, 'When time runs out, the section is submitted automatically.')),
          h('button.btn.primary.lg', { onclick: startSection }, view === 'break' ? 'Start next section' : 'Start section'))));
      return;
    }

    if (view === 'review') {
      mount(app, h('section.play', {}, top,
        h('div.panel', {},
          h('h2', {}, 'Check your work'),
          h('p', {}, `${s.picks.filter((p) => p !== null).length} of ${s.questions.length} answered · ${s.flags.size} marked for review.`),
          navigator(),
          h('div.actions', {},
            h('button.btn.ghost', { onclick: () => goTo('question') }, '← Back to questions'),
            h('span.spacer'),
            h('button.btn.primary', { onclick: () => confirm(`Submit ${s.name}? You can't return to it.`) && submitSection() }, 'Submit section')))));
      return;
    }

    const q = s.questions[qi];
    const flagged = s.flags.has(qi);
    mount(app, h('section.play', {}, top,
      h('div.play-bar', {},
        h('span.counter', {}, `Question ${qi + 1} of ${s.questions.length}`),
        h('button.btn.ghost.sm.flag', { 'aria-pressed': String(flagged), onclick: () => { flagged ? s.flags.delete(qi) : s.flags.add(qi); draw(); } },
          flagged ? '🚩 Marked' : '⚐ Mark for review')),
      h('article.q-card', {},
        questionBody(q),
        h('div.options', { class: q.image ? 'letters' : '', role: 'radiogroup', 'aria-labelledby': 'q-text' }, q.options.map((opt, i) =>
          h('button.option', {
            type: 'button', role: 'radio', 'aria-checked': String(s.picks[qi] === i),
            class: `${s.picks[qi] === i ? 'selected' : ''} ${s.eliminated[qi].has(i) ? 'eliminated' : ''}`,
            disabled: s.eliminated[qi].has(i),
            onclick: () => { s.picks[qi] = s.picks[qi] === i ? null : i; draw(); },
          }, h('span.letter', {}, LETTERS[i]), h('span.opt-text', {}, opt)))),
        s.notes[qi].map((n) => h('div.note.insight', {}, h('b', {}, n.title), h('p', {}, n.text)))),
      h('div.actions', {},
        h('button.btn.skill', {
          style: { '--c': hero.color }, disabled: charges === 0 || s.doubleXp.has(qi), onclick: useSkill, title: hero.skill.text,
        }, hero.skill.icon, ` ${hero.skill.name}`, h('span.charges', {}, charges)),
        h('span.spacer'),
        h('button.btn.ghost', { disabled: qi === 0, onclick: () => goTo('question', qi - 1) }, '← Back'),
        qi + 1 < s.questions.length
          ? h('button.btn.primary', { onclick: () => goTo('question', qi + 1) }, 'Next →')
          : h('button.btn.primary', { onclick: () => goTo('review') }, 'Review section')),
      h('details.nav-drawer', {}, h('summary', {}, 'Question navigator'), navigator())));
  }

  function navigator() {
    const s = section();
    return h('div.navigator', {}, s.questions.map((_, i) =>
      h('button.nav-cell', {
        type: 'button',
        class: `${s.picks[i] !== null ? 'answered' : ''} ${s.flags.has(i) ? 'flagged' : ''} ${i === qi && view === 'question' ? 'current' : ''}`,
        'aria-label': `Question ${i + 1}${s.picks[i] !== null ? ', answered' : ''}${s.flags.has(i) ? ', marked' : ''}`,
        onclick: () => goTo('question', i),
      }, i + 1)));
  }

  async function useSkill() {
    const s = section();
    const q = s.questions[qi];
    if (charges === 0 || s.doubleXp.has(qi)) return;
    if (hero.id === 'sage' && q.ref && q.answer == null) {
      charges -= 1; // reserve while Gemini solves it
      await ensureSolved(q).catch(() => {});
      charges += 1;
      if (section() !== s || s.questions[qi] !== q) return;
    }
    const message = applySkill(hero, q, {
      eliminated: s.eliminated[qi],
      notes: s.notes[qi],
      mastery: topicMastery(q.topicKey),
      timed: true,
      addTime: (ms) => { deadline += ms; },
      armDoubleXp: () => s.doubleXp.add(qi),
    });
    if (s.eliminated[qi].has(s.picks[qi])) s.picks[qi] = null;
    toast(hero.skill.name, message, { portrait: hero.portrait });
    charges -= 1;
    draw();
  }

  async function finish() {
    stopTimer();
    await resolveKeys(app, sections.flatMap((s) => s.questions));
    const scorer = createScorer('sim');
    const items = [];
    const report = sections.map((s) => {
      let correct = 0;
      s.questions.forEach((q, i) => {
        const ok = s.picks[i] === q.answer;
        if (ok) correct += 1;
        scorer.settle({ correct: ok, doubleXp: s.doubleXp.has(i), topicKey: q.topicKey, topicName: q.topicName });
        items.push({ ...q, chosen: s.picks[i] ?? -1, correct: ok });
      });
      return { name: s.name, correct, total: s.questions.length, scaled: satScaled(correct, s.questions.length) };
    });
    go('results', scorer.results({
      config,
      modeLabel: 'SAT Sim',
      items,
      startedAt,
      subtitle: 'Scaled scores are an estimate based on this practice bank.',
      sat: { sections: report, total: report.reduce((n, r) => n + r.scaled, 0) },
    }));
  }

  draw();
  return () => stopTimer();
}

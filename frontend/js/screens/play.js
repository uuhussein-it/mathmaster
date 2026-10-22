/**
 * Practice and Quiz player.
 *  - Practice: instant feedback, hints, hero skills, explanation after each question.
 *    Answers without a stored key (and all free-response answers) are checked by
 *    Gemini on the server; "More like this" adds AI-written questions to the run.
 *  - Quiz: one shared timer, questions back-to-back, results at the end.
 */
import { h, mount, toast, floatText, burst, LETTERS, answerLabel, questionBody, timerEl, startCountdown } from '../ui.js';
import { CHARACTERS, SKILL_CHARGES, streakMultiplier, applySkill } from '../characters.js';
import { profile, topicMastery } from '../state.js';
import { createScorer } from '../scoring.js';
import { go } from '../router.js';
import { checkAnswer, ensureSolved, fetchKeys, fetchSimilar } from '../data.js';
import { openFeedback } from '../feedback.js';
import { renderWidget, emptyValue, gradeWidget, isAnswered, answerSummary, valueSummary, typesText } from '../widgets.js';
import { mathPad } from '../mathpad.js';

export function renderPlay(app, config) {
  const { mode, questions } = config;
  const practice = mode === 'practice';
  const hero = CHARACTERS[profile.character];
  const scorer = createScorer(mode);
  const answers = [];
  const startedAt = Date.now();
  let index = 0;
  let charges = SKILL_CHARGES[mode];
  let deadline = config.timeLimit ? Date.now() + config.timeLimit * 1000 : null;
  let finished = false;

  // Per-question state, reset in show()
  let q, locked, usedHint, doubleXp, eliminated, notes, checking, draft, addedSimilar, widgetValue, widgetResult;

  if (deadline && hero.id === 'explorer') {
    setTimeout(() => toast(hero.passive.name, hero.passive.text, { portrait: hero.portrait }), 300);
  }

  function show() {
    q = questions[index];
    locked = false;
    usedHint = false;
    doubleXp = false;
    eliminated = new Set();
    notes = [];
    checking = false;
    draft = '';
    addedSimilar = false;
    widgetValue = q.type === 'widget' ? emptyValue(q.widget) : null;
    widgetResult = null;
    draw();
  }

  function draw() {
    const mult = streakMultiplier(hero.id, scorer.streak);
    const card = h('article.q-card', {},
      h('div.q-meta', {},
        h('span.q-topic', {}, q.topicName),
        sourceTag(q)),
      questionBody(q),
      q.type === 'widget' ? widgetArea()
      : q.type === 'free' ? freeAnswer()
        : h('div.options', { class: q.image ? 'letters' : '', role: 'group', 'aria-labelledby': 'q-text' }, q.options.map((opt, i) => optionButton(opt, i))),
      notes.map((n) => h(`div.note.${n.tone || 'insight'}`, {}, h('b', {}, n.title), h('p', {}, n.text))),
      checking && h('div.checking', { role: 'status' }, h('span.spinner', { 'aria-hidden': 'true' }), 'Gemini is checking your answer…'),
      practice && locked && !checking && feedback());

    mount(app,
      h('section.play', {},
        h('div.play-top', {},
          h('button.link', { onclick: quit }, '✕ Quit'),
          h('div.play-title', {}, h('b', {}, config.title), h('span', {}, `${practice ? 'Practice' : 'Quiz'} · ${config.subtitle}`)),
          deadline ? timerEl((deadline - Date.now()) / 1000) : h('span')),
        h('div.progress', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': questions.length, 'aria-valuenow': index + 1 },
          h('i', { style: { width: `${((index + (locked ? 1 : 0)) / questions.length) * 100}%` } })),
        h('div.play-bar', {},
          h('span.counter', {}, `Question ${index + 1} of ${questions.length}`),
          h('span.chip-stat', {}, `Session ${scorer.score.toLocaleString()} pts`),
          h('span.chip-stat.mult', { class: mult > 1 ? 'on' : '' }, `×${mult.toFixed(2)} streak`)),
        card,
        h('div.actions', {},
          h('button.btn.skill', {
            class: doubleXp ? 'active' : '',
            style: { '--c': hero.color },
            disabled: locked || charges === 0 || doubleXp,
            onclick: useSkill,
            title: hero.skill.text,
          }, h('span', { 'aria-hidden': 'true' }, hero.skill.icon), ` ${hero.skill.name}`, h('span.charges', {}, charges), h('kbd', {}, 'S')),
          practice && h('button.btn.ghost', { onclick: hint, disabled: locked || usedHint }, '💡 Hint', h('kbd', {}, 'H')),
          h('span.spacer'),
          !practice && h('button.btn.ghost', { onclick: () => choose(-1) }, 'Skip'))));
    if (practice && locked && !checking) app.querySelector('.next-btn')?.focus();
    else if (q.type === 'free' && !locked) app.querySelector('.free-answer input')?.focus();
  }

  function sourceTag(item) {
    if (item.source === 'ai') return h('span.q-source.ai', { title: 'Written by Gemini from a question you answered' }, '✨ AI practice');
    if (item.source === 'set') return h('span.q-source.set', { title: 'A new question written to practise the same skill as a course question' }, '📘 Practice set');
    if (item.source === 'course') return h('span.q-source', { title: 'From your course practice questions' }, 'Course bank');
    if (item.source === 'sat') return h('span.q-source', { title: 'From the SAT question bank' }, 'SAT bank');
    return null;
  }

  function freeAnswer() {
    const form = h('form.free-answer', {
      onsubmit: (e) => { e.preventDefault(); submitFree(e.currentTarget.elements.answer.value); },
    },
    h('label', { for: 'free-input' }, 'Your answer'),
    h('div.free-row', {},
      h('input#free-input', {
        name: 'answer', autocomplete: 'off', value: draft, disabled: locked, placeholder: 'e.g. x = 4, 3/5, 12√2',
        oninput: (e) => { draft = e.target.value; },
      }),
      h('button.btn.primary', { type: 'submit', disabled: locked }, 'Check')));
    if (!locked) form.append(mathPad(form));
    return form;
  }

  /** Table / matching / graph / multi-part answer, graded locally from its spec. */
  function widgetArea() {
    const box = h('div.widget-box');
    const fill = () => box.replaceChildren(...[
      renderWidget(q.widget, { locked, value: widgetValue, result: widgetResult, onChange: (redraw) => redraw && fill() }),
      !locked && typesText(q.widget) && pad,
      !locked && h('button.btn.primary.w-check', { type: 'button', onclick: submitWidget }, 'Check answer'),
    ].filter(Boolean));
    const pad = mathPad(box);
    fill();
    return box;
  }

  function submitWidget() {
    if (locked || finished) return;
    if (!isAnswered(q.widget, widgetValue)) {
      toast('Answer first', 'Fill in or plot your answer, then check it.', { icon: '✏️', tone: 'danger' });
      return;
    }
    locked = true;
    widgetResult = gradeWidget(q.widget, widgetValue);
    const record = {
      chosen: -1, text: valueSummary(q.widget, widgetValue), correct: widgetResult.correct,
      usedHint, doubleXp, topicKey: q.topicKey, topicName: q.topicName,
    };
    answers[index] = record;
    if (!practice) { next(); return; }
    reveal(record);
  }

  function optionButton(text, i) {
    let state = '';
    if (eliminated.has(i)) state = 'eliminated';
    if (locked && practice) {
      if (i === q.answer) state = 'correct';
      else if (i === answers[index]?.chosen) state = 'wrong';
      else state = 'dim';
    }
    return h('button.option', {
      type: 'button', class: state, disabled: locked || eliminated.has(i),
      onclick: (e) => choose(i, e.currentTarget),
    }, h('span.letter', {}, LETTERS[i]), h('span.opt-text', {}, text));
  }

  function feedback() {
    const a = answers[index];
    const correctLabel = q.type === 'widget' ? answerSummary(q.widget)
      : q.type === 'free' ? q.answerText : q.answer != null && answerLabel(q, q.answer);
    return h('div.feedback', { class: a.correct ? 'good' : 'bad', role: 'status' },
      h('div.feedback-head', {},
        h('b', {}, a.correct ? 'Correct!' : 'Not quite'),
        a.correct && h('span.earned', {}, `+${a.xp} XP · +${a.points} pts`)),
      !a.correct && correctLabel && h('p', {}, 'Correct answer: ', h('b', {}, correctLabel)),
      q.explanation
        ? h('p.explanation', {}, q.explanation)
        : config.ai && q.ref && h('p.explanation.muted', {}, 'Gemini is writing an explanation…'),
      h('div.feedback-actions', {},
        (config.ai || q.more) && h('button.btn.ghost.similar-btn', { onclick: addSimilar, disabled: addedSimilar },
          addedSimilar ? '✨ Added to this run' : '✨ 3 more like this'),
        q.ref && h('button.btn.ghost.report-btn', {
          onclick: () => openFeedback({ q, answer: a.text || (a.chosen >= 0 ? answerLabel(q, a.chosen) : ''), wrong: !a.correct }),
        }, a.correct ? '⚑ Report a problem' : '⚑ I think I’m right'),
        h('span.spacer'),
        h('button.btn.primary.next-btn', { onclick: next }, index + 1 < questions.length ? 'Next question →' : 'See results →')));
  }

  // ---------------------------------------------------------------- actions
  function choose(i, el) {
    if (locked || finished) return;
    locked = true;
    const record = { chosen: i, correct: i === q.answer, usedHint, doubleXp, topicKey: q.topicKey, topicName: q.topicName };
    answers[index] = record;

    if (!practice) {
      el?.classList.add('picked');
      setTimeout(next, el ? 220 : 0);
      return;
    }
    if (q.answer == null) {
      // No stored key: the server checks it (Gemini solves it once, then it's cached).
      serverCheck(record, { choice: i }, (r) => {
        q.answer = r.answer;
        return r.answer == null ? null : r.correct;
      });
      return;
    }
    reveal(record);
  }

  function submitFree(text) {
    if (locked || finished || !text.trim()) return;
    locked = true;
    const record = { chosen: -1, text: text.trim(), correct: false, usedHint, doubleXp, topicKey: q.topicKey, topicName: q.topicName };
    answers[index] = record;
    serverCheck(record, { text: record.text }, (r) => {
      q.answerText = r.answer_text;
      return r.correct;
    });
  }

  /** Ask the server to grade, then reveal. `read` maps the reply to correct/incorrect (null = couldn't tell). */
  async function serverCheck(record, answer, read) {
    const asked = q;
    checking = true;
    draw();
    let ok = null;
    let reply = {};
    try {
      reply = await checkAnswer(asked, answer);
      ok = read(reply);
    } catch { /* handled below */ }
    if (finished || asked !== q) return;
    checking = false;
    if (ok == null) {
      locked = false;
      answers[index] = undefined;
      toast('Couldn’t check that one', reply.explanation || 'Check your connection and try again.', { icon: '⚠️', tone: 'danger' });
      draw();
      return;
    }
    record.correct = ok;
    q.explanation ||= reply.explanation;
    q.hint ||= reply.hint;
    reveal(record);
  }

  function reveal(record) {
    const earned = scorer.settle(record);
    Object.assign(record, earned);
    draw();
    if (record.correct) {
      floatText(app.querySelector('.option.correct') || app.querySelector('.feedback'), `+${earned.xp} XP`);
      streakToasts();
    } else {
      app.querySelector('.option.wrong')?.classList.add('shake');
    }
    if (earned.levels) {
      burst([hero.color, '#f6d77a', '#ffffff']);
      toast(`Level ${profile.level}!`, 'Your hero grows stronger.', { icon: '⭐', tone: 'level' });
    }
    if (!q.explanation && config.ai && q.ref) {
      const asked = q;
      ensureSolved(asked).then(() => { if (asked === q && locked) draw(); }).catch(() => {});
    }
  }

  async function addSimilar() {
    if (addedSimilar) return;
    addedSimilar = true;
    const asked = q;
    const at = index;
    const button = app.querySelector('.similar-btn');
    if (button) { button.disabled = true; button.textContent = '✨ Writing questions…'; }
    try {
      const extra = await fetchSimilar(asked, 3);
      if (!extra.length) throw new Error('none');
      questions.splice(at + 1, 0, ...extra);
      toast('More like this', `${extra.length} new question${extra.length > 1 ? 's' : ''} added next.`, { icon: '✨', tone: 'success' });
    } catch {
      if (asked === q) addedSimilar = false;
      toast('Couldn’t write new questions', 'Gemini didn’t answer. Try again in a moment.', { icon: '⚠️', tone: 'danger' });
    }
    if (asked === q && !finished) draw();
  }

  function streakToasts() {
    if (hero.id === 'warrior' && [3, 5, 10].includes(scorer.streak)) {
      toast(hero.passive.name, `${scorer.streak} in a row! XP ×${streakMultiplier(hero.id, scorer.streak).toFixed(1)}`, { portrait: hero.portrait });
    } else if ([5, 10].includes(scorer.streak)) {
      toast(`${scorer.streak} streak!`, 'Keep the chain going.', { icon: '🔥', tone: 'success' });
    }
  }

  async function hint() {
    if (locked || usedHint) return;
    usedHint = true;
    const asked = q;
    if (!q.hint && q.ref && config.ai) {
      notes.push({ tone: 'hint', title: 'Hint', text: 'Gemini is thinking of a hint…' });
      draw();
      await ensureSolved(asked).catch(() => {});
      if (asked !== q) return;
      notes.pop();
    }
    notes.push({ tone: 'hint', title: 'Hint', text: q.hint || 'Write down what you know, what you need, and the formula that links them.' });
    if (hero.id === 'sage') toast(hero.passive.name, hero.passive.text, { portrait: hero.portrait });
    draw();
  }

  async function useSkill() {
    if (locked || charges === 0 || doubleXp) return;
    if (hero.id === 'sage' && q.ref && (q.answer == null || !q.hint) && config.ai) {
      const asked = q;
      charges -= 1; // reserve the charge while Gemini answers
      await ensureSolved(asked).catch(() => {});
      charges += 1;
      if (asked !== q || locked) return;
    }
    const message = applySkill(hero, q, {
      eliminated,
      notes,
      mastery: topicMastery(q.topicKey),
      timed: Boolean(deadline),
      addTime: (ms) => { deadline += ms; },
      armDoubleXp: () => { doubleXp = true; },
    });
    toast(hero.skill.name, message, { portrait: hero.portrait });
    charges -= 1;
    draw();
  }

  function next() {
    if (finished) return;
    if (index + 1 < questions.length) {
      index += 1;
      show();
    } else {
      finish();
    }
  }

  async function finish() {
    if (finished) return;
    finished = true;
    stopTimer();
    if (!practice) await resolveKeys(app, questions);
    // Unanswered questions (time ran out) count as wrong; Quiz answers are scored now.
    const items = questions.map((qq, i) => {
      const a = (answers[i] ||= { chosen: -1, correct: false, topicKey: qq.topicKey, topicName: qq.topicName });
      if (!practice) {
        a.correct = a.chosen >= 0 && a.chosen === qq.answer;
        scorer.settle(a);
      }
      return { ...qq, chosen: a.chosen, text: a.text, correct: a.correct };
    });
    go('results', scorer.results({ config, modeLabel: practice ? 'Practice' : 'Quiz', items, startedAt }));
  }

  function quit() {
    const kept = practice ? 'XP from answered questions is kept.' : 'This quiz will not be scored.';
    if (confirm(`Leave this session? ${kept}`)) go(config.origin);
  }

  function onKey(e) {
    if (e.target.matches('input, textarea') || e.metaKey || e.ctrlKey || e.altKey || checking) return;
    const k = e.key.toUpperCase();
    const n = q.options.length;
    const pick = k.length === 1 && '123456'.slice(0, n).includes(k) ? Number(k) - 1 : LETTERS.slice(0, n).indexOf(k);
    if (!locked && q.type !== 'free' && q.type !== 'widget' && pick >= 0 && !eliminated.has(pick)) {
      choose(pick, app.querySelectorAll('.option')[pick]);
    } else if (k === 'ENTER' && locked && practice) {
      e.preventDefault();
      next();
    } else if (k === 'H' && practice) {
      hint();
    } else if (k === 'S') {
      useSkill();
    }
  }

  const stopTimer = deadline
    ? startCountdown(() => deadline, {
      onExpire: () => {
        toast("Time's up!", 'Let’s see how you did.', { icon: '⏰', tone: 'danger' });
        finish();
      },
    })
    : () => {};

  document.addEventListener('keydown', onKey);
  show();

  return () => {
    finished = true;
    stopTimer();
    document.removeEventListener('keydown', onKey);
  };
}

/**
 * Fill missing answer keys (bank questions Gemini hasn't solved yet) before a
 * timed run is scored. Shows a short "grading" screen while it waits.
 */
export async function resolveKeys(app, questions) {
  const missing = questions.filter((q) => q.answer == null && q.ref && (q.type ?? 'mcq') === 'mcq');
  if (!missing.length) return;
  mount(app, h('section.loading', {}, h('span.spinner', { 'aria-hidden': 'true' }), ' Gemini is grading your answers…'));
  try {
    const { keys } = await fetchKeys(missing.map((q) => q.ref));
    for (const q of missing) q.answer = keys[q.ref] ?? null;
  } catch {
    toast('Grading was incomplete', 'Some answers couldn’t be checked and count as unanswered.', { icon: '⚠️', tone: 'danger' });
  }
}

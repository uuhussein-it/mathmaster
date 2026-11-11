/**
 * Final Exam practice: an online End-of-Term exam for one course, laid out like
 * the school's paper (cover page, Section I multiple choice with an answer
 * table, Section II written answers, 100 marks, 2 hours). Questions come from
 * the course's practice bank, one per subtopic where possible. Each version
 * (V1, V2, V3) is a fixed paper, so a whole class can sit the same one.
 * Everything is marked in the browser: MCQs by key, Section II by its parts
 * (partial marks per correct part).
 */
import { h, mount, toast, burst, formatTime, LETTERS, questionBody, timerEl, startCountdown } from '../ui.js';
import { loadCourse } from '../data.js';
import { go } from '../router.js';
import { profile, recordAnswer, recordSession, addXp, awardBadge, save } from '../state.js';
import { account } from '../account.js';
import { reportSession } from '../data.js';
import { renderWidget, emptyValue, gradeWidget, isAnswered, answerSummary, valueSummary, typesText } from '../widgets.js';
import { mathPad } from '../mathpad.js';

export const EXAM_MINUTES = 120;
const MCQ_COUNT = 19;            // Section I: 19 × 2 marks = 38
const MCQ_MARKS = 2;
const FRQ_MARKS = [9, 4, 3, 4, 6, 4, 3, 6, 3, 5, 6, 3, 6]; // Section II: 62 marks
export const VERSIONS = [1, 2, 3];

const TRACK_NAMES = { asp: 'ASP', advanced: 'Advanced', general: 'General' };

// ------------------------------------------------------------ paper builder
/** Small seeded random generator, so "V2 of MAT51" is the same paper for everyone. */
function seeded(text) {
  let s = 2166136261;
  for (const ch of text) s = Math.imul(s ^ ch.charCodeAt(0), 16777619);
  return () => {
    s = Math.imul(s ^ (s >>> 15), 2246822507);
    s = Math.imul(s ^ (s >>> 13), 3266489909);
    s ^= s >>> 16;
    return (s >>> 0) / 4294967296;
  };
}

const lessonOrder = (a, b) => a.localeCompare(b, undefined, { numeric: true });

/** n lesson slots spread over the lessons in order (evenly spaced, cycling if there are fewer lessons). */
function spread(lessons, n) {
  if (!lessons.length) return [];
  if (lessons.length >= n) return Array.from({ length: n }, (_, i) => lessons[Math.floor((i * lessons.length) / n)]);
  return Array.from({ length: n }, (_, i) => lessons[i % lessons.length]).sort((a, b) => lessonOrder(a.id, b.id));
}

/** How many separately-marked answers a written question has. */
export function partCount(spec) {
  if (spec.widget === 'multi') return spec.items.reduce((n, item) => n + partCount(item), 0);
  if (spec.widget === 'table') return spec.table.rows.flat().filter((c) => c === null).length;
  if (spec.widget === 'matching') return spec.matching.left.length;
  if (spec.widget === 'graph') return 1;
  return spec.parts.length;
}

function pick(pool, rand, used, avoid = new Set()) {
  const fresh = pool.filter((q) => !used.has(q.id) && !avoid.has(q.id));
  const free = fresh.length ? fresh : pool.filter((q) => !used.has(q.id));
  if (!free.length) return null;
  const q = free[Math.floor(rand() * free.length)];
  used.add(q.id);
  return q;
}

/**
 * Build one version of the exam from a loaded course. Earlier versions are
 * built first so a new version avoids their questions while the bank allows.
 */
export function buildPaper(course, version) {
  const avoid = new Set();
  for (let v = 1; v < version; v += 1) {
    buildOne(course, v, avoid).sections.forEach((s) => s.questions.forEach((q) => avoid.add(q.id)));
  }
  return buildOne(course, version, avoid);
}

function buildOne(course, version, avoid) {
  const rand = seeded(`${course.id}-v${version}`);
  const lessons = course.topics.flatMap((t) => t.lessons.filter((l) => l.id !== 'extra').map((l) => ({
    ...l, topic: t,
    mcq: t.questions.filter((q) => q.lesson === l.id && q.type === 'mcq' && q.answer != null && q.options.length),
    frq: t.questions.filter((q) => q.lesson === l.id && q.type === 'widget' && q.widget && partCount(q.widget) > 0),
  }))).sort((a, b) => lessonOrder(a.id, b.id));
  const used = new Set();
  const tag = (q, l, marks) => ({
    ...q, marks, subtopic: l.id, lessonName: l.name,
    topicKey: `${course.id}:${l.topic.id}:${l.id}`, topicName: `${l.id} ${l.name}`,
  });

  const mcq = [];
  for (const l of spread(lessons.filter((x) => x.mcq.length), MCQ_COUNT)) {
    const q = pick(l.mcq, rand, used, avoid) || pick(lessons.flatMap((x) => x.mcq), rand, used, avoid);
    if (!q) continue;
    const owner = lessons.find((x) => x.id === q.lesson) || l;
    // Text options get shuffled; screenshot questions print their letters, so they keep their order.
    const order = q.image ? q.options.map((_, i) => i) : q.options.map((_, i) => i).sort(() => rand() - 0.5);
    mcq.push(tag({ ...q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) }, owner, MCQ_MARKS));
  }

  const frqPicks = [];
  // Written questions go first to subtopics Section I missed, so the paper covers every subtopic it can.
  const withFrq = lessons.filter((x) => x.frq.length);
  const covered = new Set(mcq.map((q) => q.subtopic));
  const missed = withFrq.filter((x) => !covered.has(x.id)).slice(0, FRQ_MARKS.length);
  const rest = spread(withFrq.filter((x) => !missed.includes(x)), FRQ_MARKS.length - missed.length);
  const frqSlots = [...missed, ...rest].sort((a, b) => lessonOrder(a.id, b.id));
  for (const l of frqSlots) {
    const q = pick(l.frq, rand, used, avoid) || pick(lessons.flatMap((x) => x.frq), rand, used, avoid);
    if (q) frqPicks.push({ q, l: lessons.find((x) => x.id === q.lesson) || l });
  }
  // Bigger questions carry bigger marks, the way the paper weights them.
  const marks = FRQ_MARKS.slice(0, frqPicks.length).sort((a, b) => b - a);
  const bySize = [...frqPicks].sort((a, b) => partCount(b.q.widget) - partCount(a.q.widget));
  bySize.forEach((p, i) => { p.marks = marks[i]; });
  // If the bank ran short, scale so Section II still totals 62.
  const got = marks.reduce((n, m) => n + m, 0);
  if (got && got !== 62) frqPicks.forEach((p) => { p.marks = Math.round((p.marks * 62) / got * 2) / 2; });
  const frq = frqPicks.map((p) => tag(p.q, p.l, p.marks));

  return {
    course, version,
    sections: [
      { id: 'I', name: 'Section I', title: 'Multiple choice', marks: mcq.length * MCQ_MARKS, questions: mcq },
      { id: 'II', name: 'Section II', title: 'Written answers', marks: frq.reduce((n, q) => n + q.marks, 0), questions: frq },
    ],
  };
}

// ------------------------------------------------------------ marking
const half = (x) => Math.round(x * 2) / 2;

function markQuestion(q, value) {
  if (q.type === 'mcq') {
    const ok = value === q.answer;
    return { got: ok ? q.marks : 0, correct: ok, answered: value != null };
  }
  const answered = isAnswered(q.widget, value);
  const result = gradeWidget(q.widget, value);
  const right = result.parts.filter(Boolean).length;
  const got = answered ? half((q.marks * right) / Math.max(1, result.parts.length)) : 0;
  return { got, correct: result.correct, answered, result, right, of: result.parts.length };
}

const gradeBand = (pct) => (pct >= 90 ? { band: 'A', text: 'Outstanding. You are ready for the real exam.' }
  : pct >= 80 ? { band: 'B', text: 'Very good. Polish the subtopics marked below.' }
  : pct >= 70 ? { band: 'C', text: 'Good. A little more practice on your weak subtopics will lift you a band.' }
  : pct >= 60 ? { band: 'D', text: 'You passed. Revise the red subtopics, then try another version.' }
  : { band: 'F', text: 'Not yet. Practise the red subtopics in Practice Mode, then sit another version.' });

// ------------------------------------------------------------ screen
export function renderExam(app, config) {
  let paper = null;
  let view = 'loading';  // loading | cover | question | table | results
  let si = 0;
  let qi = 0;
  let deadline = null;
  let stopTimer = () => {};
  let startedAt = 0;
  let answers = null;     // [section][question] → mcq index | widget value
  let flags = null;
  let report = null;

  mount(app, h('section.loading', {}, 'Preparing your exam paper…'));
  loadCourse(config.courseId).then((course) => {
    paper = buildPaper(course, config.version || 1);
    answers = paper.sections.map((s) => s.questions.map((q) => (q.type === 'mcq' ? null : emptyValue(q.widget))));
    flags = paper.sections.map(() => new Set());
    view = 'cover';
    draw();
  }).catch((err) => mount(app, h('section.panel.error', {}, err.message)));

  const course = () => paper.course;
  const gradeLine = () => `${course().grade} | ${TRACK_NAMES[course().track] || course().track}`;
  const answered = (s, i) => {
    const q = paper.sections[s].questions[i];
    return q.type === 'mcq' ? answers[s][i] != null : isAnswered(q.widget, answers[s][i]);
  };
  const totalQuestions = () => paper.sections.reduce((n, s) => n + s.questions.length, 0);
  const numberOf = (s, i) => (s === 0 ? i + 1 : paper.sections[0].questions.length + i + 1);

  function begin() {
    view = 'question';
    si = 0; qi = 0;
    startedAt = Date.now();
    deadline = startedAt + EXAM_MINUTES * 60 * 1000;
    stopTimer = startCountdown(() => deadline, {
      low: 300,
      onExpire: () => { toast("Time's up", 'Your exam was handed in.', { icon: '⏰', tone: 'danger' }); finish(); },
    });
    draw();
  }

  function goTo(nextView, s = si, i = qi) {
    view = nextView; si = s; qi = i;
    draw();
    window.scrollTo({ top: 0 });
  }

  function draw() {
    if (view === 'cover') return mount(app, cover());
    if (view === 'table') return mount(app, examShell(answerTable(false)));
    if (view === 'results') return mount(app, results());
    return mount(app, examShell(questionView()));
  }

  // ---------------- cover page (mirrors the paper's front page)
  function cover() {
    const c = course();
    const me = account.student;
    const row = (k, v) => h('tr', {}, h('th', {}, k), h('td', {}, v));
    const best = profile.exams?.[c.code];
    return h('section.exam', {},
      h('div.crumbs', {}, h('button.link', { onclick: () => go('curriculum') }, '← School Curriculum'), h('span', {}, 'Final Exam practice')),
      h('div.panel.exam-cover', {},
        h('div.exam-cover-head', {},
          h('div', {}, h('p.eyebrow', {}, `Version ${paper.version} · T${c.term}-EoT-V${paper.version}`),
            h('h1.display', {}, `End of Term ${c.term} Exam`)),
          h('span.exam-seal', { 'aria-hidden': 'true' }, '🎓')),
        h('table.exam-meta', {}, h('tbody', {},
          row('Subject | Course code', `Mathematics | ${c.code}`),
          row('Grade | Stream', gradeLine()),
          row('Time', `${EXAM_MINUTES / 60} hrs`),
          row('Student name', me?.name || profile.name || '—'),
          row('Section', me?.group?.name || '—'))),
        h('h3.sub-title', {}, 'Instructions'),
        h('ol.exam-rules', {},
          h('li', {}, 'Answer all questions. You can move between questions and sections freely.'),
          h('li', {}, `You have ${EXAM_MINUTES / 60} hours. When the time runs out, your exam is handed in automatically.`),
          h('li', {}, h('b', {}, 'Section I: '), `choose the best answer. The marking only uses your Answer Table (${MCQ_MARKS} marks each).`),
          h('li', {}, h('b', {}, 'Section II: '), 'type each answer in the boxes. Every correct part earns its share of the marks.'),
          h('li', {}, 'A scientific calculator is allowed. You may use the List of Formulae.')),
        h('table.exam-marks', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Section'), h('th', {}, 'Questions'), h('th', {}, 'Marks'))),
          h('tbody', {},
            paper.sections.map((s) => h('tr', {}, h('td', {}, `${s.id} · ${s.title}`), h('td', {}, s.questions.length), h('td', {}, s.marks))),
            h('tr.total', {}, h('td', {}, 'Total'), h('td', {}, totalQuestions()), h('td', {}, paper.sections.reduce((n, s) => n + s.marks, 0))))),
        best && h('p.muted.exam-best', {}, `Your best so far on ${c.code}: ${best.best} / 100 (${best.attempts} attempt${best.attempts === 1 ? '' : 's'}).`),
        h('div.exam-cover-actions', {},
          h('a.btn.ghost', { href: `api/formula/${encodeURIComponent(c.code)}`, target: '_blank', rel: 'noopener' }, '📄 List of Formulae'),
          h('span.spacer'),
          h('button.btn.primary.lg', { onclick: begin }, 'Start exam'))));
  }

  // ---------------- exam frame: top bar, section tabs
  function examShell(body) {
    const done = paper.sections.reduce((n, s, k) => n + s.questions.filter((_, i) => answered(k, i)).length, 0);
    return h('section.play.exam', {},
      h('div.play-top', {},
        h('button.link', { onclick: () => confirm('Leave the exam? Your answers will be lost.') && (stopTimer(), go('curriculum')) }, '✕ Exit'),
        h('div.play-title', {}, h('b', {}, `${course().code} · End of Term ${course().term}`), h('span', {}, `Version ${paper.version} · ${done}/${totalQuestions()} answered`)),
        timerEl((deadline - Date.now()) / 1000)),
      h('div.exam-tabs', { role: 'tablist' },
        paper.sections.map((s, k) => h('button.exam-tab', {
          type: 'button', role: 'tab', 'aria-selected': String(view === 'question' && si === k),
          onclick: () => goTo('question', k, 0),
        }, h('b', {}, s.name), h('span', {}, `${s.title} · ${s.marks} marks`))),
        h('button.exam-tab', { type: 'button', role: 'tab', 'aria-selected': String(view === 'table'), onclick: () => goTo('table') },
          h('b', {}, 'Answer Table'), h('span', {}, 'Check & hand in'))),
      body);
  }

  function questionView() {
    const s = paper.sections[si];
    const q = s.questions[qi];
    const flagged = flags[si].has(qi);
    const last = si === paper.sections.length - 1 && qi === s.questions.length - 1;
    return h('div', {},
      h('div.play-bar', {},
        h('span.counter', {}, `Question ${numberOf(si, qi)} · Subtopic ${q.subtopic}`),
        h('span.exam-qmarks', {}, `[${q.marks} mark${q.marks === 1 ? '' : 's'}]`),
        h('button.btn.ghost.sm.flag', { 'aria-pressed': String(flagged), onclick: () => { flagged ? flags[si].delete(qi) : flags[si].add(qi); draw(); } },
          flagged ? '🚩 Marked' : '⚐ Mark for review')),
      h('article.q-card', {},
        questionBody(q),
        q.type === 'mcq' ? options(q) : writtenArea(q)),
      h('div.actions', {},
        h('button.btn.ghost', { disabled: si === 0 && qi === 0, onclick: prev }, '← Back'),
        h('span.spacer'),
        last ? h('button.btn.primary', { onclick: () => goTo('table') }, 'Answer Table →')
          : h('button.btn.primary', { onclick: next }, 'Next →')),
      h('details.nav-drawer', { open: window.innerWidth > 900 }, h('summary', {}, 'Question navigator'), navigator()));
  }

  function next() {
    const s = paper.sections[si];
    if (qi + 1 < s.questions.length) goTo('question', si, qi + 1);
    else if (si + 1 < paper.sections.length) goTo('question', si + 1, 0);
  }
  function prev() {
    if (qi > 0) goTo('question', si, qi - 1);
    else if (si > 0) goTo('question', si - 1, paper.sections[si - 1].questions.length - 1);
  }

  function options(q) {
    return h('div.options', { class: q.image ? 'letters' : '', role: 'radiogroup', 'aria-labelledby': 'q-text' }, q.options.map((opt, i) =>
      h('button.option', {
        type: 'button', role: 'radio', 'aria-checked': String(answers[si][qi] === i),
        class: answers[si][qi] === i ? 'selected' : '',
        onclick: () => { answers[si][qi] = answers[si][qi] === i ? null : i; draw(); },
      }, h('span.letter', {}, LETTERS[i]), h('span.opt-text', {}, opt))));
  }

  function writtenArea(q) {
    const box = h('div.widget-box');
    const value = answers[si][qi];
    const fill = () => box.replaceChildren(...[
      renderWidget(q.widget, { locked: false, value, onChange: (redraw) => redraw && fill() }),
      typesText(q.widget) && pad,
    ].filter(Boolean));
    const pad = mathPad(box);
    fill();
    return box;
  }

  function navigator() {
    return h('div.exam-nav', {}, paper.sections.map((s, k) => h('div', {},
      h('p.eyebrow', {}, `${s.name} · ${s.title}`),
      h('div.navigator', {}, s.questions.map((_, i) => h('button.nav-cell', {
        type: 'button',
        class: `${answered(k, i) ? 'answered' : ''} ${flags[k].has(i) ? 'flagged' : ''} ${k === si && i === qi && view === 'question' ? 'current' : ''}`,
        'aria-label': `Question ${numberOf(k, i)}${answered(k, i) ? ', answered' : ''}${flags[k].has(i) ? ', marked' : ''}`,
        onclick: () => goTo('question', k, i),
      }, numberOf(k, i)))))));
  }

  /** The paper's Answer Table: subtopic, marks, question, the student's answer (and, after marking, the mark). */
  function answerTable(marked) {
    const blanks = paper.sections.reduce((n, s, k) => n + s.questions.filter((_, i) => !answered(k, i)).length, 0);
    const rows = [];
    paper.sections.forEach((s, k) => {
      s.questions.forEach((q, i) => {
        const r = marked ? report.items[k][i] : null;
        const yours = q.type === 'mcq'
          ? (answers[k][i] == null ? '—' : LETTERS[answers[k][i]])
          : (answered(k, i) ? '✎ written' : '—');
        rows.push(h('tr', { class: [r && (r.got === q.marks ? 'good' : r.got > 0 ? 'part' : 'bad'), flags[k].has(i) && 'flagged'].filter(Boolean).join(' ') },
          h('td', {}, q.subtopic),
          h('td', {}, q.marks),
          h('td', {}, h('button.link', { onclick: () => (marked ? document.getElementById(`rv-${k}-${i}`)?.scrollIntoView({ behavior: 'smooth' }) : goTo('question', k, i)) }, numberOf(k, i))),
          h('td.yours', {}, yours),
          marked && h('td', {}, q.type === 'mcq' ? LETTERS[q.answer] : `${r.right}/${r.of} parts`),
          marked && h('td.got', {}, r.got)));
      });
      rows.push(h('tr.total', {}, h('td', {}, `${s.id === 'I' ? 'MCQ' : 'Written'} total`), h('td', {}, s.marks), h('td', {}, '—'), h('td', {}, '—'),
        marked && h('td', {}, '—'), marked && h('td.got', {}, report.sections[k].got)));
    });
    const table = h('div.exam-table-wrap', {}, h('table.exam-answer-table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Subtopic'), h('th', {}, 'Marks'), h('th', {}, 'Question'), h('th', {}, 'Your answer'),
        marked && h('th', {}, 'Key'), marked && h('th', {}, 'Mark'))),
      h('tbody', {}, rows)));
    if (marked) return table;
    return h('div.panel', {},
      h('h2', {}, 'Answer Table'),
      h('p', {}, blanks ? `${blanks} question${blanks === 1 ? '' : 's'} still blank. Tap a question number to go back to it.` : 'Every question has an answer. Hand in when you are ready.'),
      table,
      h('div.actions', {},
        h('button.btn.ghost', { onclick: () => goTo('question', 0, 0) }, '← Back to questions'),
        h('span.spacer'),
        h('button.btn.primary', {
          onclick: () => confirm(`Hand in your exam?${blanks ? `\n\n${blanks} question${blanks === 1 ? ' is' : 's are'} blank and will score 0.` : ''}`) && finish(),
        }, 'Hand in exam')));
  }

  // ---------------- marking and results
  function finish() {
    if (report) return;
    stopTimer();
    const items = paper.sections.map((s, k) => s.questions.map((q, i) => markQuestion(q, answers[k][i])));
    const sections = paper.sections.map((s, k) => ({ ...s, got: half(items[k].reduce((n, r) => n + r.got, 0)) }));
    const total = half(sections.reduce((n, s) => n + s.got, 0));
    const outOf = sections.reduce((n, s) => n + s.marks, 0);
    const pct = outOf ? Math.round((total / outOf) * 100) : 0;
    report = { items, sections, total, outOf, pct, seconds: Math.round((Date.now() - startedAt) / 1000) };

    // Mastery per subtopic, XP, history and the teacher's results table.
    paper.sections.forEach((s, k) => s.questions.forEach((q, i) => recordAnswer({
      topicKey: q.topicKey, topicName: q.topicName, correct: items[k][i].correct, points: items[k][i].got * 10,
    })));
    const c = course();
    report.xp = Math.round(total);
    report.levels = addXp(report.xp);
    profile.exams ||= {};
    const prevBest = profile.exams[c.code]?.best ?? null;
    profile.exams[c.code] = { best: Math.max(prevBest ?? 0, total), last: total, attempts: (profile.exams[c.code]?.attempts || 0) + 1, at: Date.now() };
    report.newBest = prevBest != null && total > prevBest;
    save();
    const title = `${c.code} Final Exam V${paper.version}`;
    recordSession({ modeLabel: 'Final Exam', title, correct: total, total: outOf, xp: report.xp, at: Date.now() });
    reportSession({
      student_name: profile.name, source: 'questlearn final exam', quiz_id: title,
      correct: total, total: outOf, pct,
      mistakes: items.flat().filter((r) => !r.correct).length,
      skill_summary: JSON.stringify({ course: c.code, version: paper.version, sections: sections.map((s) => [s.id, s.got, s.marks]) }),
    });
    if (pct >= 90) awardBadge({ id: `exam-${c.code}`, name: `${c.code} exam ace`, icon: '🎓' });
    if (pct >= 70) setTimeout(() => burst(['#f6d77a', '#4fd1e8', '#ffffff']), 250);
    goTo('results');
  }

  function results() {
    const c = course();
    const verdict = gradeBand(report.pct);
    // Subtopics, weakest first.
    const subs = {};
    paper.sections.forEach((s, k) => s.questions.forEach((q, i) => {
      const t = (subs[q.subtopic] ||= { id: q.subtopic, name: q.lessonName, got: 0, of: 0 });
      t.got += report.items[k][i].got;
      t.of += q.marks;
    }));
    const topics = Object.values(subs).map((t) => ({ ...t, pct: Math.round((t.got / t.of) * 100) })).sort((a, b) => a.pct - b.pct);

    return h('section.results.exam', {},
      h('div.results-hero.panel', {},
        h('div.ring', { style: { '--p': report.pct, '--c': '#e6c06a' }, role: 'img', 'aria-label': `${report.total} out of ${report.outOf}` },
          h('div', {}, h('b', {}, report.total), h('span', {}, `/ ${report.outOf}`))),
        h('div.results-text', {},
          h('p.eyebrow', {}, `End of Term ${c.term} Exam · ${c.code} · Version ${paper.version}`),
          h('h1.display', {}, `Grade ${verdict.band}`),
          h('p', {}, verdict.text),
          report.newBest && h('p.level-up', {}, '🏅 New personal best!'),
          report.levels > 0 && h('p.level-up', {}, `⭐ Level up! You reached level ${profile.level}.`),
          h('table.exam-marks.compact', {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Section'), h('th', {}, 'Mark'), h('th', {}, 'Out of'))),
            h('tbody', {},
              report.sections.map((s) => h('tr', {}, h('td', {}, `${s.id} · ${s.title}`), h('td', {}, s.got), h('td', {}, s.marks))),
              h('tr.total', {}, h('td', {}, 'Total'), h('td', {}, report.total), h('td', {}, report.outOf)))),
          h('p.muted.small', {}, `Time used: ${formatTime(report.seconds)} · +${report.xp} XP`))),

      h('div.results-grid', {},
        h('div.panel', {},
          h('h3', {}, 'Subtopic breakdown'),
          h('ul.bars', {}, topics.map((t) => h('li', {},
            h('span', {}, `${t.id} ${t.name}`),
            h('div.bar', {}, h('i', { style: { width: `${t.pct}%` }, class: t.pct >= 75 ? 'good' : t.pct >= 50 ? 'ok' : 'low' })),
            h('b', {}, `${half(t.got)}/${t.of}`)))),
          topics[0] && topics[0].pct < 100 && h('p.tip', {}, `Revise “${topics[0].id} ${topics[0].name}” first: it cost you the most marks.`)),
        h('div.panel.actions-panel', {},
          h('h3', {}, 'What next?'),
          VERSIONS.filter((v) => v !== paper.version).map((v) =>
            h('button.btn.ghost', { onclick: () => go('exam', { courseId: c.id, version: v }) }, `Sit Version ${v}`)),
          h('button.btn.primary', { onclick: () => go('exam', { courseId: c.id, version: paper.version }) }, `Retake Version ${paper.version}`),
          h('button.btn.ghost', { onclick: () => go('curriculum') }, 'Back to School Curriculum'))),

      h('div.panel', {}, h('h3', {}, 'Marked Answer Table'), answerTable(true)),

      h('details.panel.review', {},
        h('summary', {}, 'Review every question'),
        paper.sections.map((s, k) => h('div', {},
          h('h3.sub-title', {}, `${s.name} · ${s.title} (${report.sections[k].got}/${s.marks})`),
          h('ol.exam-review', { start: numberOf(k, 0) }, s.questions.map((q, i) => reviewItem(q, k, i)))))));
  }

  function reviewItem(q, k, i) {
    const r = report.items[k][i];
    const cls = r.got === q.marks ? 'good' : r.got > 0 ? 'part' : 'bad';
    let yours;
    let key;
    if (q.type === 'mcq') {
      yours = answers[k][i] == null ? 'Blank' : `${LETTERS[answers[k][i]]}. ${q.options[answers[k][i]] || ''}`;
      key = `${LETTERS[q.answer]}. ${q.options[q.answer] || ''}`;
    } else {
      yours = r.answered ? valueSummary(q.widget, answers[k][i]) : 'Blank';
      key = answerSummary(q.widget);
    }
    return h('li.review-item', { id: `rv-${k}-${i}`, class: cls },
      h('p.exam-review-head', {}, h('span.muted', {}, `Subtopic ${q.subtopic} · `), h('b', {}, `${r.got} / ${q.marks} marks`)),
      questionBody(q, { small: true }),
      h('p', {}, h('span.muted', {}, 'Your answer: '), yours),
      r.got < q.marks && h('p', {}, h('span.muted', {}, 'Correct: '), key),
      q.explanation && h('p.explanation', {}, q.explanation));
  }

  return () => stopTimer();
}

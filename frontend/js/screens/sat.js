/**
 * Path B: SAT Prep. Choose the timed Simulator or Topics Practice.
 */
import { h, mount, prefs } from '../ui.js';
import { loadSat, prepareQuestions } from '../data.js';
import { go } from '../router.js';
import { timedSeconds } from '../characters.js';
import { profile } from '../state.js';
import { chips, modeCard, lessonPicker, lessonKey, groupBoard } from './controls.js';

const FORMATS = [
  { id: 'full', label: 'Full test', sections: ['rw', 'math'], text: 'Reading & Writing, a short break, then Math.' },
  { id: 'rw', label: 'Reading & Writing', sections: ['rw'], text: 'One timed Reading & Writing section.' },
  { id: 'math', label: 'Math', sections: ['math'], text: 'One timed Math section.' },
];

// Questions per simulated section, as on the digital SAT (capped by the bank).
const SIM_SIZE = { rw: 54, math: 44 };

export function renderSat(app) {
  const sel = { mode: 'sim', format: 'full', count: 10, ...prefs.get('sat', {}), lessons: new Set() };
  const open = new Set(); // topics showing their lessons
  let bank = null;
  const board = groupBoard(); // loads once; kept across redraws

  mount(app, h('section.loading', {}, 'Loading SAT bank…'));
  loadSat().then((data) => { bank = data; draw(); }).catch((err) => mount(app, h('section.panel.error', {}, err.message)));

  function update(patch) {
    Object.assign(sel, patch);
    prefs.set('sat', { mode: sel.mode, format: sel.format, count: sel.count });
    draw();
  }

  /** Topics of one section, keyed for stats and with a question count for the picker. */
  const sectionTopics = (section) => bank.topics
    .filter((t) => t.section === section)
    .map((t) => ({ ...t, key: `sat:${t.id}`, count: t.questions.length }));
  const simCount = (section) => Math.min(SIM_SIZE[section],
    sectionTopics(section).reduce((n, t) => n + t.questions.filter((q) => (q.type ?? 'mcq') === 'mcq').length, 0));
  const sectionSeconds = (section, count = simCount(section)) =>
    timedSeconds(count, bank.sections[section].secondsPerQuestion, profile.character);

  function draw() {
    const simPanel = h('div.panel.sat-panel', {},
      h('h3', {}, 'Simulator format'),
      h('div.format-grid', {}, FORMATS.map((f) =>
        h('button.format-card', { type: 'button', 'aria-pressed': String(sel.format === f.id), onclick: () => update({ format: f.id }) },
          h('b', {}, f.label),
          h('p', {}, f.text),
          h('span.format-meta', {}, f.sections.map((s) =>
            `${simCount(s)} Q · ${Math.round(sectionSeconds(s) / 60)} min`).join('  +  '))))),
      h('ul.rules', {},
        h('li', {}, 'Each section has its own clock, paced like the digital SAT.'),
        h('li', {}, 'Move freely inside a section, mark questions for review, then submit.'),
        h('li', {}, 'No feedback until the end. You get a scaled score from 200–800 per section.')),
      h('button.btn.primary.lg', { onclick: startSim }, 'Start simulator'));

    const allKeys = [...sectionTopics('math'), ...sectionTopics('rw')].flatMap((t) => t.lessons.map((l) => lessonKey(t, l)));
    const everything = allKeys.every((k) => sel.lessons.has(k));
    const topicPanel = h('div.panel.sat-panel', {},
      h('div.course-head', {}, h('h3', {}, 'Pick topics or lessons'),
        h('button.btn.ghost.sm', { onclick: () => { sel.lessons = new Set(everything ? [] : allKeys); draw(); } },
          everything ? 'Clear all' : 'Select all')),
      h('div.start-row', {},
        chips('Questions', [5, 10, 20].map((n) => ({ value: n, label: String(n) })), sel.count, (count) => update({ count })),
        h('button.btn.primary.lg', { disabled: sel.lessons.size === 0, onclick: startTopics },
          sel.lessons.size ? 'Start practice' : 'Pick at least one lesson')),
      h('p.muted.small.lesson-tip', {}, 'Tick a whole topic, or open its lessons to practise just one.'),
      ['math', 'rw'].map((section) => h('div.sat-group', {},
        h('p.eyebrow', {}, bank.sections[section].name),
        lessonPicker(sectionTopics(section), sel.lessons, open, draw, () => (section === 'math' ? '∑' : '¶')))));

    mount(app,
      h('section', {},
        h('div.crumbs', {}, h('button.link', { onclick: () => go('hub') }, '← Hub'), h('span', {}, 'SAT Preparation')),
        h('h1.display', {}, 'SAT Preparation'),
        h('div.mode-grid', {},
          modeCard({
            icon: '🏛️', title: 'SAT Simulator', pressed: sel.mode === 'sim', onclick: () => update({ mode: 'sim' }),
            text: 'Timed section exams in realistic test conditions, with scaled scoring.',
          }),
          modeCard({
            icon: '🧩', title: 'Topics Practice', pressed: sel.mode === 'topics', onclick: () => update({ mode: 'topics' }),
            text: 'Drill one SAT skill at a time with hints, skills and explanations.',
          })),
        sel.mode === 'sim' ? simPanel : topicPanel,
        board));
  }

  function startSim() {
    const format = FORMATS.find((f) => f.id === sel.format);
    const sections = format.sections.map((id) => {
      const questions = prepareQuestions(sectionTopics(id), { limit: SIM_SIZE[id], mcqOnly: true });
      return { name: bank.sections[id].name, questions, timeLimit: sectionSeconds(id, questions.length) };
    });
    go('simulator', { title: `SAT Simulator · ${format.label}`, origin: 'sat', sections, restart: startSim });
  }

  function startTopics() {
    // One group per picked lesson, so results and mastery are tracked per lesson.
    const topics = [...sectionTopics('math'), ...sectionTopics('rw')].flatMap((t) => t.lessons
      .filter((l) => sel.lessons.has(lessonKey(t, l)))
      .map((l) => ({
        key: `sat:${t.id}:${l.id}`,
        name: t.lessons.length > 1 ? `${t.name} · ${l.name}` : t.name,
        topic: t.name,
        questions: t.questions.filter((q) => q.lesson === l.id),
      })));
    const whole = new Set(topics.map((g) => g.topic));
    go('play', {
      mode: 'practice',
      origin: 'sat',
      title: topics.length === 1 ? topics[0].name : whole.size === 1 ? [...whole][0] : `SAT · ${topics.length} lessons`,
      subtitle: 'SAT Topics Practice',
      questions: prepareQuestions(topics, { limit: sel.count }),
      timeLimit: null,
      ai: bank.ai,
      restart: startTopics,
    });
  }
}

/**
 * Path A: School Curriculum. Filter Grade → Track → Term, pick topics or single lessons, and a mode.
 */
import { h, mount, prefs } from '../ui.js';
import { loadCurriculumIndex, loadCourse, prepareQuestions } from '../data.js';
import { go } from '../router.js';
import { timedSeconds } from '../characters.js';
import { profile } from '../state.js';
import { chips, modeCard, lessonPicker, lessonKey, groupBoard } from './controls.js';

const SECONDS_PER_QUIZ_QUESTION = 75;
const COUNTS = [5, 10, 15, 0]; // 0 = all

export function renderCurriculum(app) {
  const saved = prefs.get('curriculum', {});
  const sel = { grade: 9, track: 'advanced', term: 1, mode: 'practice', count: 10, ...saved, lessons: null };
  const open = new Set(); // topics showing their lessons
  let index = null;
  const board = groupBoard(); // loads once; kept across redraws

  mount(app, h('section.loading', {}, 'Loading courses…'));
  loadCurriculumIndex()
    .then((data) => { index = data; draw(); })
    .catch((err) => mount(app, h('section.panel.error', {}, err.message)));

  const findCourse = (grade, track, term) => index.courses.find((c) => c.grade === grade && c.track === track && c.term === term);
  const trackOffered = (grade, track) => index.courses.some((c) => c.grade === grade && c.track === track);
  const trackName = (id) => index.tracks.find((t) => t.id === id)?.full ?? id;

  function update(patch) {
    Object.assign(sel, patch);
    if ('grade' in patch || 'track' in patch || 'term' in patch) { sel.lessons = null; open.clear(); }
    prefs.set('curriculum', { grade: sel.grade, track: sel.track, term: sel.term, mode: sel.mode, count: sel.count });
    draw();
  }

  function draw() {
    const course = findCourse(sel.grade, sel.track, sel.term);
    if (course) {
      loadCourse(course.id); // warm the cache so Start is instant
      sel.lessons ||= new Set(); // nothing ticked: students pick their own lessons
    }
    const available = course ? course.topics.flatMap((t) => t.lessons.filter((l) => sel.lessons.has(lessonKey(t, l))))
      .reduce((n, l) => n + (sel.mode === 'quiz' ? l.mcq : l.count), 0) : 0;

    let body;
    if (!trackOffered(sel.grade, sel.track)) {
      body = h('div.empty', {}, h('span', { 'aria-hidden': 'true' }, '🗺️'),
        h('h3', {}, `${trackName(sel.track)} isn't offered in Grade ${sel.grade}`),
        h('p', {}, 'Pick another track above.'));
    } else if (!course) {
      body = h('div.empty', {}, h('span', { 'aria-hidden': 'true' }, '🔒'),
        h('h3', {}, `Term ${sel.term} unlocks soon`),
        h('p', {}, 'Questions for this term haven’t been added yet. Term 1 is ready to play.'));
    } else {
      body = h('div.course', {},
        h('div.course-head', {},
          h('div', {}, h('p.eyebrow', {}, `${course.code} · Grade ${course.grade} · Term ${course.term}`), h('h2', {}, course.title)),
          selectAllLessons(course)),
        h('h3.sub-title', {}, 'Mode'),
        h('div.mode-grid', {},
          modeCard({
            icon: '🛡️', title: 'Practice Mode', pressed: sel.mode === 'practice', onclick: () => update({ mode: 'practice' }),
            text: 'Instant feedback, hints, hero skills and a full explanation after each question.',
          }),
          modeCard({
            icon: '⏱️', title: 'Quiz Mode', pressed: sel.mode === 'quiz', onclick: () => update({ mode: 'quiz' }),
            text: `Timed, back-to-back questions (${SECONDS_PER_QUIZ_QUESTION}s each). Score and evaluation at the end.`,
          })),

        h('div.start-row', {},
          chips('Questions', COUNTS.map((n) => ({ value: n, label: n ? String(n) : 'All' })), sel.count, (count) => update({ count })),
          h('button.btn.primary.lg', { disabled: available === 0, onclick: () => start(course) },
            available ? `Start ${sel.mode} · ${Math.min(available, sel.count || available)} Q` : 'Pick at least one lesson')),

        h('h3.sub-title', {}, 'Topics'),
        h('p.muted.small.lesson-tip', {}, 'Tick a whole topic, or open its lessons to practise just one.'),
        lessonPicker(course.topics, sel.lessons, open, draw));
    }

    mount(app,
      h('section', {},
        h('div.crumbs', {}, h('button.link', { onclick: () => go('hub') }, '← Hub'), h('span', {}, 'School Curriculum')),
        h('h1.display', {}, 'School Curriculum'),
        h('div.panel.filters', {},
          chips('Grade', index.grades.map((g) => ({ value: g, label: `Grade ${g}` })), sel.grade, (grade) => update({ grade })),
          chips('Stream / Track', index.tracks.map((t) => ({
            value: t.id, label: t.name, badge: trackOffered(sel.grade, t.id) ? null : 'N/A',
          })), sel.track, (track) => update({ track })),
          chips('Academic term', index.terms.map((term) => ({
            value: term, label: `Term ${term}`, badge: findCourse(sel.grade, sel.track, term) ? null : 'Soon',
          })), sel.term, (term) => update({ term }))),
        body,
        board));
  }

  function allLessons(course) {
    return course.topics.flatMap((t) => t.lessons.map((l) => lessonKey(t, l)));
  }

  function selectAllLessons(course) {
    const keys = allLessons(course);
    const all = keys.every((k) => sel.lessons.has(k));
    return h('button.btn.ghost.sm', {
      onclick: () => { sel.lessons = new Set(all ? [] : keys); draw(); },
    }, all ? 'Clear all' : 'Select all');
  }

  async function start(meta) {
    const course = await loadCourse(meta.id);
    // One group per picked lesson, so results and mastery are tracked per lesson.
    const topics = course.topics.flatMap((t) => t.lessons
      .filter((l) => sel.lessons.has(lessonKey(t, l)))
      .map((l) => ({
        key: `${course.id}:${t.id}:${l.id}`,
        name: l.id === 'extra' ? `${t.name} · ${l.name}` : `${l.id} ${l.name}`,
        topic: t.name,
        questions: t.questions.filter((q) => q.lesson === l.id),
      })));
    const whole = new Set(topics.map((g) => g.topic));
    // Free-response needs Gemini to check each answer, so it's Practice-only.
    const questions = prepareQuestions(topics, { limit: sel.count || Infinity, mcqOnly: sel.mode === 'quiz' });
    go('play', {
      mode: sel.mode,
      origin: 'curriculum',
      title: topics.length === 1 ? topics[0].name
        : whole.size === 1 ? [...whole][0] : `${course.code} · ${topics.length} lessons`,
      subtitle: `Grade ${course.grade} · ${trackName(course.track)} · Term ${course.term}`,
      questions,
      ai: index.ai,
      timeLimit: sel.mode === 'quiz' ? timedSeconds(questions.length, SECONDS_PER_QUIZ_QUESTION, profile.character) : null,
      restart: () => start(meta),
    });
  }
}

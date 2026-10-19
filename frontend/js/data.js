/**
 * Question bank loading and the Gemini-backed answer service.
 * Banks come from the MathMaster database via /api/ql/*; bank questions are
 * shown as screenshots (`image`) with lettered options, and may arrive without
 * an answer key (`answer: null`), in which case the server resolves it.
 */
import { shuffle } from './ui.js';

const cache = new Map();

async function getJson(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(path).then((res) => {
      if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
      return res.json();
    }));
  }
  return cache.get(path);
}

export const loadCurriculumIndex = () => getJson('api/ql/curriculum');
export const loadCourse = (id) => getJson(`api/ql/course/${id}`);
export const loadSat = () => getJson('api/ql/sat');

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} failed (${res.status})`);
  return res.json();
}

/** Grade one answer on the server: { choice } for MCQ or { text } for free response. */
export const checkAnswer = (q, answer) => post('api/ql/check', { ref: q.ref, ...answer });

/** Answer keys for a list of bank questions, resolved by Gemini where missing. */
export const fetchKeys = (refs) => post('api/ql/keys', { refs });

/** Generate practice questions like `q` (text questions are sent as text). */
export async function fetchSimilar(q, n = 3) {
  const body = q.ref ? { ref: q.ref, n } : { n, question: { id: q.id, q: q.q, options: q.options } };
  const res = await post('api/ql/similar', body);
  return res.questions.map((g) => ({ ...g, topicKey: q.topicKey, topicName: q.topicName, similarTo: q.id }));
}

/**
 * Fill a question's missing hint / explanation (and MCQ key) from the server.
 * Mutates and returns q; cached per question so repeat calls are free.
 */
const solving = new Map();
export function ensureSolved(q) {
  if (!q.ref || q.type === 'widget' || (q.hint && q.explanation && (q.answer != null || q.type === 'free'))) return Promise.resolve(q);
  if (!solving.has(q.id)) {
    solving.set(q.id, post('api/ql/solve', { ref: q.ref }).then((r) => {
      if (q.answer == null && r.answer != null) q.answer = r.answer;
      q.hint ||= r.hint;
      q.explanation ||= r.explanation;
      return q;
    }).catch((err) => { solving.delete(q.id); throw err; }));
  }
  return solving.get(q.id);
}

/** Share a finished session with the teacher's results feed (best effort). */
export function reportSession(payload) {
  post('api/progress', payload).catch(() => {});
}

/**
 * Turn raw bank questions into playable items: options shuffled (answer index
 * remapped) and tagged with their topic for stats and insights.
 */
export function prepareQuestions(topics, { limit = Infinity, mcqOnly = false } = {}) {
  const items = topics.flatMap((topic) => topic.questions.map((q) => {
    // Screenshot questions print their letters in the image, so keep that order.
    const order = q.image ? q.options.map((_, i) => i) : shuffle(q.options.map((_, i) => i));
    return {
      ...q,
      options: order.map((i) => q.options[i]),
      answer: q.answer == null ? null : order.indexOf(q.answer),
      topicKey: topic.key,
      topicName: topic.name,
    };
  }));
  // Timed quizzes can't wait on a typed-answer check, so they take MCQ and widget items only.
  return shuffle(mcqOnly ? items.filter((q) => q.type !== 'free') : items).slice(0, limit);
}

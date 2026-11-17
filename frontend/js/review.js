/**
 * "Fix my mistakes": questions the student got wrong come back in a Practice
 * run. A right answer takes a question off the list (see state.trackMistake).
 */
import { profile } from './state.js';
import { go } from './router.js';
import { toast } from './ui.js';
import { loadCourse, loadSat, loadCurriculumIndex, prepareQuestions } from './data.js';

const PER_RUN = 10;

/** Every question object (a ref plus options or a type) anywhere inside a bank. */
function collect(node, out = new Map()) {
  if (Array.isArray(node)) node.forEach((n) => collect(n, out));
  else if (node && typeof node === 'object') {
    if (typeof node.ref === 'string' && ('options' in node || 'type' in node)) out.set(node.ref, node);
    else Object.values(node).forEach((v) => collect(v, out));
  }
  return out;
}

export const mistakeCount = () => (profile.mistakes || []).length;

/** Start a Practice run on the newest mistakes. Resolves false if none could be loaded. */
export async function startReview() {
  const list = (profile.mistakes || []).slice(0, PER_RUN);
  if (!list.length) return false;
  const sources = [...new Set(list.map((m) => (m.topicKey.startsWith('sat:') ? 'sat' : m.topicKey.split(':')[0])))];
  const banks = new Map();
  let ai = false;
  await Promise.all(sources.map(async (src) => {
    try {
      const bank = src === 'sat' ? await loadSat() : await loadCourse(src);
      ai ||= Boolean(bank.ai);
      banks.set(src, collect(bank));
    } catch { /* that course is gone: skip its mistakes */ }
  }));
  try { ai ||= Boolean((await loadCurriculumIndex()).ai); } catch { /* offline */ }

  const topics = list.map((m) => {
    const q = banks.get(m.topicKey.startsWith('sat:') ? 'sat' : m.topicKey.split(':')[0])?.get(m.ref);
    return q && { key: m.topicKey, name: m.topicName, questions: [q] };
  }).filter(Boolean);
  if (!topics.length) {
    // Nothing loadable (the bank changed): clear the stale entries so the count stays honest.
    const stale = new Set(list.map((m) => m.ref));
    profile.mistakes = profile.mistakes.filter((m) => !stale.has(m.ref));
    toast('Those questions aren’t available any more', 'They were changed or removed, so they’ve been cleared.', { icon: '🔁' });
    return false;
  }
  go('play', {
    mode: 'practice',
    origin: 'learn',
    title: 'Fix my mistakes',
    subtitle: `${topics.length} question${topics.length === 1 ? '' : 's'} you missed before`,
    questions: prepareQuestions(topics),
    ai,
    timeLimit: null,
    restart: startReview,
  });
  return true;
}

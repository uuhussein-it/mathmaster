/**
 * The world map's content: a student's topics (their course for Grades 9–12,
 * or the SAT bank) spread over three zones in course order. A zone opens when
 * every topic in the zone before it is mastered, so the map follows the
 * curriculum.
 *
 * Mastery comes from the answers already recorded in the profile (per lesson,
 * keyed like the School Curriculum and SAT screens), so practice done anywhere
 * on the site counts here too.
 */
import { loadCurriculumIndex, loadCourse, loadSat, prepareQuestions } from '../data.js';
import { account } from '../account.js';
import { profile, save } from '../state.js';
import { timedSeconds } from '../characters.js';
import { realm } from './economy.js';

export const ZONES = [
  { id: 'plains', name: 'Golden Plains', icon: '🌾', text: 'Rolling farmland where every journey starts.' },
  { id: 'forest', name: 'Whispering Forest', icon: '🌲', text: 'Ancient trees that only open to steady minds.' },
  { id: 'citadel', name: 'Sky Citadel', icon: '🏰', text: 'The fortress of masters, high above the clouds.' },
];

export const NEED_PCT = 70;
const NEED_CORRECT = 5;
const SESSION = 10;
const QUIZ_SECONDS = 75;

/** Load the nodes for 'course' or 'sat': [{ key, name, group, lessons, questions, ai }]. */
export async function loadNodes(path) {
  if (path === 'sat') {
    const bank = await loadSat();
    return bank.topics.filter((t) => t.questions.length).map((t) => ({
      key: `sat:${t.id}`, name: t.name, group: t.section === 'math' ? 'SAT Math' : 'SAT Reading & Writing',
      lessons: t.lessons, questions: t.questions, ai: bank.ai, origin: 'sat',
    }));
  }
  const index = await loadCurriculumIndex();
  const me = account.student;
  const mine = index.courses.filter((c) => c.grade === me?.grade && c.track === me?.track).sort((a, b) => a.term - b.term);
  const courses = await Promise.all(mine.map((c) => loadCourse(c.id)));
  return courses.flatMap((course) => course.topics.filter((t) => t.questions.length).map((t) => ({
    key: `${course.id}:${t.id}`, name: t.name, group: `Term ${course.term}`,
    lessons: t.lessons, questions: t.questions, ai: index.ai, origin: 'curriculum',
  })));
}

/** Answers recorded for a node across its lessons. */
export function mastery(node) {
  let seen = 0;
  let correct = 0;
  for (const [key, t] of Object.entries(profile.topics || {})) {
    if (key === node.key || key.startsWith(`${node.key}:`)) {
      seen += t.seen;
      correct += t.correct;
    }
  }
  const need = Math.min(NEED_CORRECT, node.questions.length);
  const pct = seen ? Math.round((correct / seen) * 100) : 0;
  return { seen, correct, pct, need, mastered: correct >= need && pct >= NEED_PCT };
}

/** Split nodes over the zones and work out which zones are open. */
export function layout(nodes) {
  const per = Math.ceil(nodes.length / ZONES.length) || 1;
  let open = true;
  return ZONES.map((z, i) => {
    const zn = nodes.slice(i * per, (i + 1) * per).map((n) => ({ ...n, zone: z.id, m: mastery(n) }));
    const zone = { ...z, nodes: zn, open, done: zn.length > 0 && zn.every((n) => n.m.mastered) };
    open = open && zone.done;
    return zone;
  });
}

/** Remember the furthest zone reached, so the base knows what can be built. */
export function rememberZones(zones) {
  const r = realm();
  const had = new Set(r.zones || ['plains']);
  zones.filter((z) => z.open).forEach((z) => had.add(z.id));
  if (had.size !== (r.zones || []).length) {
    r.zones = [...had];
    save();
  }
  return had;
}

export const openZones = () => new Set(realm().zones || ['plains']);

/** Start a Practice or Quiz session on one node; results come back to the realm. */
export function startNode(node, mode, go) {
  const groups = (node.lessons?.length ? node.lessons : [{ id: null, name: node.name }]).map((l) => ({
    key: l.id == null ? node.key : `${node.key}:${l.id}`,
    name: node.lessons?.length > 1 ? `${node.name} · ${l.name}` : node.name,
    questions: l.id == null ? node.questions : node.questions.filter((q) => q.lesson === l.id),
  }));
  const questions = prepareQuestions(groups, { limit: SESSION, mcqOnly: mode === 'quiz' });
  go('play', {
    mode,
    origin: 'realm',
    title: node.name,
    subtitle: `World map · ${node.group}`,
    questions,
    ai: node.ai,
    timeLimit: mode === 'quiz' ? timedSeconds(questions.length, QUIZ_SECONDS, profile.character) : null,
    restart: () => startNode(node, mode, go),
  });
}

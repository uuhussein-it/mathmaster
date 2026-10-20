/**
 * Plain-text formats a teacher can type to build answer widgets, and the
 * reverse (spec → text) for editing an existing one.
 *
 *   table     first line = headers; "|" between cells; a blank the student
 *             fills is written [answer] (";" between accepted forms)
 *               x | y
 *               0 | [-3]
 *   matching  one pair per line "left => right"; a line "=> extra" adds a
 *             choice that matches nothing
 *   parts     one part per line "label | prompt | answer" (";" between forms)
 *   graph     built by tapping the grid; points are stored as [[x, y], …]
 */
const forms = (text) => text.split(';').map((s) => s.trim()).filter(Boolean);
const one = (list) => (list.length === 1 ? list[0] : list);
const joinForms = (a) => [].concat(a).join('; ');

export function parseTable(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('Write a header line and at least one row.');
  const headers = lines[0].split('|').map((c) => c.trim());
  const rows = [];
  const answers = [];
  let blanks = 0;
  lines.slice(1).forEach((line, i) => {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length !== headers.length) throw new Error(`Row ${i + 1} has ${cells.length} cells but there are ${headers.length} headers.`);
    rows.push(cells.map((c) => (/^\[.*\]$/.test(c) ? null : c)));
    answers.push(cells.map((c) => {
      const m = c.match(/^\[(.*)\]$/);
      if (!m) return null;
      if (!forms(m[1]).length) throw new Error(`Row ${i + 1} has an empty [ ] blank.`);
      blanks += 1;
      return one(forms(m[1]));
    }));
  });
  if (!blanks) throw new Error('Mark at least one cell to fill in, like [5].');
  return { widget: 'table', table: { headers, rows, answers } };
}

export const tableText = (spec) => [spec.table.headers.join(' | '),
  ...spec.table.rows.map((row, r) => row.map((c, j) => (c === null ? `[${joinForms(spec.table.answers[r][j])}]` : c)).join(' | '))].join('\n');

export function parseMatching(text) {
  const left = [];
  const right = [];
  const answers = [];
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const [l, r] = line.split('=>').map((s) => (s ?? '').trim());
    if (r === undefined || !r) throw new Error(`"${line}" needs "=>" and a match on the right.`);
    let j = right.indexOf(r);
    if (j < 0) { right.push(r); j = right.length - 1; }
    if (l) { left.push(l); answers.push(j); }
  }
  if (left.length < 2) throw new Error('Add at least two pairs.');
  return { widget: 'matching', matching: { left, right, answers } };
}

export function matchingText(spec) {
  const { left, right, answers } = spec.matching;
  const used = new Set(answers);
  return [...left.map((l, i) => `${l} => ${right[answers[i]]}`),
    ...right.filter((_, j) => !used.has(j)).map((r) => `=> ${r}`)].join('\n');
}

export function parseParts(text) {
  const parts = text.split('\n').map((l) => l.trim()).filter(Boolean).map((line, i) => {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 2) throw new Error(`Line ${i + 1}: write "label | prompt | answer".`);
    const [label, prompt, answer] = cells.length === 2 ? [cells[0], '', cells[1]] : cells;
    if (!forms(answer || '').length) throw new Error(`Line ${i + 1} has no answer.`);
    return { label, prompt, answer: one(forms(answer)) };
  });
  if (!parts.length) throw new Error('Add at least one part.');
  return { widget: 'parts', parts };
}

export const partsText = (spec) => spec.parts.map((p) => `${p.label} | ${p.prompt || ''} | ${joinForms(p.answer)}`).join('\n');

export const EXAMPLES = {
  table: 'x | y\n0 | [-3]\n1 | [0]\n2 | [3]',
  matching: 'y = 2x + 1 => slope 2\ny = -x => slope -1\n=> slope 0',
  parts: 'a | x = | 4\nb | y = | -2; -2.0',
};

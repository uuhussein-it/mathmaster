/**
 * Teacher admin page (#/admin): fix answers, remove or add questions (any
 * type), manage students and the leaderboard, read feedback, and upload the
 * school's student list. Signs in with the existing teacher account.
 */
import { h, mount, modal, toast, LETTERS } from '../ui.js';
import { account, adminApi, adminLogin, adminLogout } from '../account.js';
import { renderWidget, emptyValue, gradeWidget, answerSummary } from '../widgets.js';
import { parseTable, tableText, parseMatching, matchingText, parseParts, partsText, EXAMPLES } from '../widget-text.js';
import { go } from '../router.js';

const TABS = [['questions', '📚 Questions'], ['students', '🧑‍🎓 Students'], ['feedback', '💬 Feedback'],
  ['roster', '📋 School list', 'admin'], ['teachers', '👩‍🏫 Teachers', 'admin']];
const TYPES = [
  ['mcq', 'Multiple choice'], ['free', 'Short answer'], ['table', 'Fill-in table'],
  ['matching', 'Matching'], ['graph', 'Plot on a graph'], ['parts', 'Multi-part'],
];
const TRACK_NAMES = { asp: 'ASP', advanced: 'Advanced', general: 'General' };
const when = (t) => (t ? new Date(t * 1000).toLocaleString() : '—');

export function renderAdmin(app) {
  let tab = 'questions';
  const state = { index: null, course: null, topic: null, data: null, students: null, group: '', search: '', feedback: null, roster: null, staff: null };
  const owner = () => account.role === 'admin';

  if (!account.admin) return drawLogin();
  draw();

  // ------------------------------------------------------------- sign in
  function drawLogin(error = '') {
    const form = h('form.auth-form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const { username, password } = e.target.elements;
        try {
          await adminLogin(username.value, password.value);
          draw();
        } catch (err) {
          drawLogin(err.message.includes('401') || /wrong/i.test(err.message) ? 'Wrong username or password.' : err.message);
        }
      },
    },
    h('label.field', {}, h('span', {}, 'Username or email'), h('input', { name: 'username', required: true, autocomplete: 'username' })),
    h('label.field', {}, h('span', {}, 'Password'), h('input', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' })),
    h('button.btn.primary.lg', { type: 'submit' }, 'Sign in'));
    mount(app, h('section.auth', {},
      h('div.select-head', {}, h('p.eyebrow', {}, 'QuestLearn'), h('h1.display', {}, 'Teacher sign-in')),
      h('div.panel.auth-panel', {}, form, error && h('p.auth-error', { role: 'alert' }, error)),
      h('a.auth-teacher', { href: '#/hub' }, '← Back to the student site')));
  }

  // ---------------------------------------------------------------- shell
  function draw() {
    const body = h('div.admin-body', {}, h('p.muted', {}, 'Loading…'));
    mount(app, h('section.admin', {},
      h('div.admin-head', {},
        h('div', {}, h('p.eyebrow', {}, owner() ? 'Admin' : 'Teacher'), h('h1.display', {}, 'Admin')),
        h('div.admin-head-actions', {},
          h('a.btn.ghost.sm', { href: '#/hub' }, 'Student view'),
          h('button.btn.ghost.sm', { onclick: async () => { await adminLogout(); go('login'); } }, 'Sign out'))),
      h('nav.admin-tabs', { role: 'tablist' }, TABS.filter(([, , who]) => !who || owner()).map(([id, label]) =>
        h('button.chip', { role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; draw(); } }, label))),
      body));
    ({ questions: questionsTab, students: studentsTab, feedback: feedbackTab, roster: rosterTab, teachers: teachersTab })[tab](body)
      .catch((e) => body.replaceChildren(h('p.auth-error', {}, e.message)));
  }

  // ------------------------------------------------------------ questions
  async function questionsTab(body) {
    state.index ||= await adminApi('api/ql/curriculum');
    state.course ||= state.index.courses[0]?.id;
    const courses = state.index.courses;
    if (!state.data || state.data.id !== state.course) state.data = await adminApi(`api/ql/course/${state.course}?admin=1`);
    const topics = state.data.topics;
    if (!topics.some((t) => t.id === state.topic)) state.topic = topics[0]?.id;
    const topic = topics.find((t) => t.id === state.topic);
    const reload = async () => { state.data = null; draw(); };

    body.replaceChildren(
      h('div.admin-filters', {},
        h('label.field', {}, h('span', {}, 'Course'), h('select', {
          onchange: (e) => { state.course = e.target.value; state.topic = null; draw(); },
        }, courses.map((c) => h('option', { value: c.id, selected: c.id === state.course },
          `Grade ${c.grade} · ${TRACK_NAMES[c.track] || c.track} · Term ${c.term} (${c.code})`)))),
        h('label.field', {}, h('span', {}, 'Topic'), h('select', {
          onchange: (e) => { state.topic = e.target.value; draw(); },
        }, topics.map((t) => h('option', { value: t.id, selected: t.id === state.topic }, `${t.name} (${t.questions.length})`)))),
        h('label.admin-check', {}, h('input', {
          type: 'checkbox', checked: !!state.showSets, onchange: (e) => { state.showSets = e.target.checked; draw(); },
        }), ` Show practice sets (${topic ? topic.questions.filter((q) => q.source === 'set').length : 0})`),
        h('button.btn.primary', { onclick: () => editCustom(null, reload) }, '＋ Add question')),
      topic ? h('div.admin-qs', {}, topic.questions.filter((q) => state.showSets || q.source !== 'set')
        .map((q, i) => questionCard(q, i, reload)))
        : h('p.muted', {}, 'This course has no topics.'));
  }

  function questionCard(q, i, reload) {
    const teacher = q.source === 'teacher';
    const set = q.source === 'set';
    const typeName = q.type === 'widget' ? (TYPES.find(([id]) => id === q.widget.widget)?.[1] || 'Steps')
      : TYPES.find(([id]) => id === q.type)?.[1];
    const key = q.type === 'widget' ? answerSummary(q.widget)
      : q.type === 'mcq' && q.answer != null ? (set ? `${LETTERS[q.answer]}) ${q.options[q.answer]}` : LETTERS[q.answer])
        : q.answer_text || null;
    return h('article.admin-q', { class: q.hidden ? 'hidden-q' : '' },
      h('div.admin-q-media', {},
        q.image ? h('img', { src: q.image, alt: `Question ${i + 1}`, loading: 'lazy' }) : h('p', {}, q.q)),
      h('div.admin-q-info', {},
        h('div.admin-q-tags', {},
          h('span.q-tag', {}, `#${i + 1}`), h('span.q-tag', {}, typeName),
          teacher && h('span.q-tag.teacher', {}, 'Teacher question'),
          set && h('span.q-tag.set', {}, 'Practice set'),
          q.hidden && h('span.q-tag.removed', {}, 'Removed')),
        key && h('p.admin-key', {}, h('span.muted', {}, 'Answer: '), key),
        h('div.admin-q-actions', {},
          teacher
            ? [h('button.btn.ghost.sm', { onclick: () => editCustom(q, reload) }, '✏️ Edit'),
              h('button.btn.ghost.sm.danger', {
                onclick: async () => {
                  if (!confirm('Delete this question for good?')) return;
                  await adminApi(`api/admin/ql/custom/${q.ref.split(':')[1]}`, { method: 'DELETE' });
                  reload();
                },
              }, '🗑 Delete')]
            : [!set && h('button.btn.ghost.sm', { onclick: () => editAnswer(q.ref, reload) }, '✏️ Edit answer'),
              q.hidden
                ? h('button.btn.ghost.sm', { onclick: async () => { await itemApi(q.ref, 'PUT', { restore: true }); reload(); } }, '↩ Restore')
                : h('button.btn.ghost.sm.danger', { onclick: async () => { await itemApi(q.ref, 'DELETE'); reload(); } }, '🚫 Remove')])));
  }

  function itemApi(ref, method, body) {
    return adminApi(`api/admin/ql/item/${ref.replace(':', '-')}`, { method, body });
  }

  /** Fix the answer key of a bank question (and its hint/explanation). */
  async function editAnswer(ref, done) {
    const item = await itemApi(ref, 'GET');
    let pick = item.answer;
    const hint = h('textarea', { rows: 2 }, item.hint || '');
    const explanation = h('textarea', { rows: 3 }, item.explanation || '');
    let answerField;
    let builder;
    if (item.type === 'mcq') {
      const chips = h('div.w-chips', {}, LETTERS.slice(0, item.options).map((l) => h('button.w-chip', {
        type: 'button', class: pick === l ? 'on' : '',
        onclick: (e) => { pick = l; chips.querySelectorAll('.w-chip').forEach((c) => c.classList.toggle('on', c === e.target)); },
      }, l)));
      answerField = h('label.field', {}, h('span', {}, 'Correct option'), chips);
    } else if (item.type === 'free') {
      answerField = h('label.field', {}, h('span', {}, 'Correct answer'), h('input', { value: item.answer || '', name: 'answer' }));
    } else {
      builder = widgetBuilder(item.widget);
      answerField = builder.el;
    }
    const error = h('p.auth-error');
    const close = modal('Edit answer',
      h('img.admin-preview-img', { src: item.image, alt: 'Question' }),
      answerField,
      h('label.field', {}, h('span', {}, 'Hint (optional)'), hint),
      h('label.field', {}, h('span', {}, 'Explanation (optional)'), explanation),
      error,
      h('div.fb-actions', {}, h('button.btn.primary', {
        onclick: async () => {
          try {
            const body = { hint: hint.value, explanation: explanation.value };
            if (item.type === 'mcq') body.answer = pick;
            else if (item.type === 'free') body.answer_text = answerField.querySelector('input').value;
            else body.widget = builder.spec();
            await itemApi(ref, 'PUT', body);
            close();
            toast('Saved', 'Students get the new answer right away.', { icon: '✅', tone: 'success' });
            done();
          } catch (e) { error.textContent = e.message; }
        },
      }, 'Save')));
  }

  /** Add (q = null) or edit a teacher question of any type. */
  function editCustom(q, done) {
    const id = q && q.ref.split(':')[1];
    let type = !q ? 'mcq' : q.type === 'widget' ? q.widget.widget : q.type;
    let image = null;
    const prompt = h('textarea', { rows: 3, placeholder: 'Write the question…' }, q?.q || '');
    const hint = h('textarea', { rows: 2 }, q?.hint || '');
    const explanation = h('textarea', { rows: 3 }, q?.explanation || '');
    const answerBox = h('div');
    const error = h('p.auth-error');
    let getAnswer = () => ({});

    const options = (q?.type === 'mcq' ? q.options : ['', '', '', '']).slice();
    let correct = q?.type === 'mcq' ? q.answer : 0;

    function drawAnswer() {
      if (type === 'mcq') {
        const rows = h('div.mcq-edit', {});
        const paint = () => rows.replaceChildren(...options.map((o, i) => h('div.mcq-row', {},
          h('input', { type: 'radio', name: 'correct', checked: correct === i, onchange: () => { correct = i; }, 'aria-label': `Option ${LETTERS[i]} is correct` }),
          h('span.letter', {}, LETTERS[i]),
          h('input', { value: o, placeholder: `Option ${LETTERS[i]}`, oninput: (e) => { options[i] = e.target.value; } }),
          options.length > 2 && h('button.btn.ghost.sm', { type: 'button', 'aria-label': 'Remove option', onclick: () => { options.splice(i, 1); correct = Math.min(correct, options.length - 1); paint(); } }, '✕'))),
        options.length < 6 && h('button.btn.ghost.sm', { type: 'button', onclick: () => { options.push(''); paint(); } }, '＋ Option'));
        paint();
        answerBox.replaceChildren(h('p.muted', {}, 'Tick the correct option.'), rows);
        getAnswer = () => ({ type: 'mcq', options: options.map((o) => o.trim()), answer: correct });
      } else if (type === 'free') {
        const input = h('input', { value: q?.answer_text || '', placeholder: 'e.g. 3/4 | 0.75' });
        answerBox.replaceChildren(h('label.field', {}, h('span', {}, 'Correct answer (put | between other accepted forms)'), input));
        getAnswer = () => ({ type: 'free', answer: input.value });
      } else {
        const builder = widgetBuilder(q?.type === 'widget' && q.widget.widget === type ? q.widget : { widget: type });
        answerBox.replaceChildren(builder.el);
        getAnswer = () => ({ type: 'widget', widget: builder.spec() });
      }
    }

    const typeSelect = h('select', { onchange: (e) => { type = e.target.value; drawAnswer(); } },
      TYPES.map(([v, label]) => h('option', { value: v, selected: v === type }, label)));
    const file = h('input', {
      type: 'file', accept: 'image/*',
      onchange: () => {
        const f = file.files[0];
        if (!f) return;
        if (f.size > 2_000_000) { error.textContent = 'Pick a picture under 2 MB.'; return; }
        const reader = new FileReader();
        reader.onload = () => { image = reader.result; };
        reader.readAsDataURL(f);
      },
    });
    drawAnswer();
    const close = modal(q ? 'Edit question' : 'Add a question',
      !q && h('p.muted', {}, `Adds to: ${state.data.topics.find((t) => t.id === state.topic)?.name}`),
      h('label.field', {}, h('span', {}, 'Question type'), typeSelect),
      h('label.field', {}, h('span', {}, 'Question'), prompt),
      h('label.field', {}, h('span', {}, q?.image ? 'Replace picture (optional)' : 'Picture (optional)'), file),
      answerBox,
      h('label.field', {}, h('span', {}, 'Hint (optional)'), hint),
      h('label.field', {}, h('span', {}, 'Explanation (optional)'), explanation),
      error,
      h('div.fb-actions', {}, h('button.btn.primary', {
        onclick: async () => {
          try {
            const body = { ...getAnswer(), prompt: prompt.value, hint: hint.value, explanation: explanation.value };
            if (image) body.image = image;
            if (q) await adminApi(`api/admin/ql/custom/${id}`, { method: 'PUT', body });
            else await adminApi('api/admin/ql/custom', { method: 'POST', body: { ...body, course: state.course, topic: state.topic } });
            close();
            toast('Saved', q ? 'Question updated.' : 'Question added for students.', { icon: '✅', tone: 'success' });
            done();
          } catch (e) { error.textContent = e.message; }
        },
      }, q ? 'Save' : 'Add question')));
  }

  /**
   * Build a table/matching/parts answer from typed text, or a graph answer by
   * tapping the grid; shows a live preview. Steps (multi) are edited as JSON.
   */
  function widgetBuilder(spec) {
    const kind = spec.widget;
    const preview = h('div.builder-preview');
    const error = h('p.auth-error');
    let current = null;

    if (kind === 'graph') {
      const g = { xmin: -10, xmax: 10, ymin: -10, ymax: 10, step: 1, mode: 'points', points: [], ...(spec.graph || {}) };
      const points = g.points.map((p) => [...p]);
      const num = (key) => h('label.field.sm', {}, h('span', {}, key), h('input', {
        type: 'number', value: g[key], oninput: (e) => { g[key] = Number(e.target.value); paint(); },
      }));
      const mode = h('select', { onchange: (e) => { g.mode = e.target.value; paint(); } },
        h('option', { value: 'points', selected: g.mode !== 'line' }, 'Plot exactly these points'),
        h('option', { value: 'line', selected: g.mode === 'line' }, 'Any points on this line (tap 2)'));
      const paint = () => {
        current = { widget: 'graph', prompt: spec.prompt, graph: { ...g, points } };
        preview.replaceChildren(renderWidget(current, { locked: false, value: points, onChange: (redraw) => redraw && paint() }));
      };
      paint();
      return {
        el: h('div.builder', {},
          h('p.muted', {}, 'Tap the grid to place the correct points.'),
          h('div.builder-row', {}, num('xmin'), num('xmax'), num('ymin'), num('ymax'), num('step')),
          h('label.field', {}, h('span', {}, 'Students must'), mode),
          preview),
        spec: () => {
          if (g.mode === 'line' && points.length !== 2) throw new Error('Tap exactly two points on the line.');
          if (!points.length) throw new Error('Tap the grid to place at least one point.');
          return current;
        },
      };
    }

    const formats = { table: [parseTable, tableText], matching: [parseMatching, matchingText], parts: [parseParts, partsText] };
    const json = !formats[kind];
    const [parse, toText] = formats[kind] || [(t) => JSON.parse(t), (s) => JSON.stringify(s, null, 2)];
    const has = spec.table || spec.matching || spec.parts || spec.items;
    const text = h('textarea.mono', { rows: json ? 12 : 6 }, has ? toText(spec) : EXAMPLES[kind] || '');
    const help = {
      table: 'First line: headers. Use | between cells. Write a cell students fill in as [answer]; use ; between accepted forms.',
      matching: 'One pair per line: left => right. A line starting with => adds an extra choice.',
      parts: 'One part per line: label | prompt | answer. Use ; between accepted forms.',
    }[kind] || 'Steps are edited as JSON.';
    const update = () => {
      try {
        current = { ...parse(text.value), ...(spec.prompt && !json ? { prompt: spec.prompt } : {}) };
        const check = gradeWidget(current, emptyValue(current));
        if (check.correct) throw new Error('Every answer is blank.');
        error.textContent = '';
        preview.replaceChildren(h('p.muted', {}, 'Preview'), renderWidget(current, { locked: false, value: emptyValue(current), onChange: () => {} }));
      } catch (e) {
        current = null;
        error.textContent = e.message;
      }
    };
    text.addEventListener('input', update);
    update();
    return {
      el: h('div.builder', {}, h('p.muted', {}, help), text, error, preview),
      spec: () => { if (!current) throw new Error(error.textContent || 'Fix the answer first.'); return current; },
    };
  }

  // ------------------------------------------------------------- students
  async function studentsTab(body) {
    state.students ||= (await adminApi('api/admin/students')).students;
    const reload = async () => { state.students = null; draw(); };
    const groups = [...new Set(state.students.filter((s) => s.group).map((s) => s.group.name))].sort();
    const rows = state.students.filter((s) => (!state.group || s.group?.name === state.group)
      && (!state.search || `${s.name} ${s.email}`.toLowerCase().includes(state.search.toLowerCase())));
    const set = async (s, data, msg) => { await adminApi(`api/admin/students/${s.id}`, { method: 'PUT', body: data }); toast(msg, '', { icon: '✅', tone: 'success' }); reload(); };

    body.replaceChildren(
      h('div.admin-filters', {},
        h('label.field', {}, h('span', {}, 'Group'), h('select', { onchange: (e) => { state.group = e.target.value; draw(); } },
          h('option', { value: '' }, `All groups (${state.students.length})`),
          groups.map((g) => h('option', { value: g, selected: g === state.group }, g)))),
        h('label.field', {}, h('span', {}, 'Search'), h('input', {
          type: 'search', value: state.search, placeholder: 'Name or email',
          onchange: (e) => { state.search = e.target.value; draw(); },
        }))),
      rows.length ? h('div.table-wrap', {}, h('table.admin-table', {},
        h('thead', {}, h('tr', {}, ['Student', 'Group', 'Score', 'Last seen', 'Leaderboard', ''].map((c) => h('th', {}, c)))),
        h('tbody', {}, rows.map((s) => h('tr', {},
          h('td', {}, h('b', {}, s.name), h('br'), h('small.muted', {}, s.email)),
          h('td', {}, s.group ? s.group.name : h('span.muted', {}, 'Not chosen')),
          h('td', {}, `${s.score.toLocaleString()} · Lv ${s.level}`),
          h('td', {}, s.online ? h('span.q-tag.online', {}, 'Online') : when(s.last_seen)),
          h('td', {}, h('button.btn.ghost.sm', {
            onclick: () => set(s, { hidden: !s.hidden }, s.hidden ? 'Back on the leaderboard' : 'Removed from the leaderboard'),
          }, s.hidden ? '↩ Show' : '🚫 Remove')),
          owner() && h('td.admin-row-actions', {},
            h('button.btn.ghost.sm', {
              onclick: () => {
                const pw = prompt(`New password for ${s.name} (at least 8 characters):`);
                if (pw) set(s, { password: pw }, 'Password reset').catch((e) => toast('Not saved', e.message, { tone: 'danger', icon: '⚠️' }));
              },
            }, 'Reset password'),
            h('button.btn.ghost.sm', {
              onclick: () => {
                const lv = prompt(`Set ${s.name}'s level (1–100). Their XP is set to the start of that level:`, String(s.level));
                if (lv) set(s, { level: Number(lv) }, `${s.name} is now level ${lv}`).catch((e) => toast('Not saved', e.message, { tone: 'danger', icon: '⚠️' }));
              },
            }, 'Set level'),
            h('button.btn.ghost.sm', {
              onclick: () => set(s, { all_gear: !s.all_gear }, s.all_gear ? 'Armory back to normal unlocks' : 'Every Armory item unlocked'),
            }, s.all_gear ? '🔒 Normal gear' : '🔓 Unlock all gear'),
            h('button.btn.ghost.sm.danger', {
              onclick: async () => {
                if (!confirm(`Delete ${s.name}'s account and progress?`)) return;
                await adminApi(`api/admin/students/${s.id}`, { method: 'DELETE' });
                reload();
              },
            }, 'Delete'))))))) : h('p.muted', {}, 'No students yet. They appear here after they sign in.'));
  }

  // ------------------------------------------------------------- feedback
  async function feedbackTab(body) {
    state.feedback ||= (await adminApi('api/admin/feedback')).feedback;
    const reload = async () => { state.feedback = null; draw(); };
    const open = state.feedback.filter((f) => !f.resolved).length;
    body.replaceChildren(
      h('p.muted', {}, `${open} open · ${state.feedback.length} total`),
      state.feedback.length ? h('div.admin-feedback', {}, state.feedback.map((f) => {
        const v = f.ai_verdict;
        const [kind, qid] = (f.ref || '').split(':');
        return h('article.panel.fb-item', { class: f.resolved ? 'resolved' : '' },
          kind && kind !== 'custom' && h('img.fb-img', { src: kind === 'course' ? `api/course-q-img/${qid}` : `api/q-img/${qid}`, alt: 'Question', loading: 'lazy' }),
          h('div', {},
            h('div.admin-q-tags', {},
              h('span.q-tag', {}, f.category || 'other'),
              v?.correct === true && h('span.q-tag.teacher', {}, 'AI agrees with the student'),
              v?.key_wrong && h('span.q-tag.removed', {}, 'AI says the key is wrong'),
              f.resolved ? h('span.q-tag', {}, 'Resolved') : null),
            h('p', {}, h('b', {}, f.student_name || 'Anonymous'), h('span.muted', {}, ` · ${when(f.created_at)}`)),
            f.message && h('p', {}, f.message),
            f.answer && h('p', {}, h('span.muted', {}, 'Student answer: '), f.answer),
            v && h('p', {}, h('span.muted', {}, 'AI: '), v.answer ? `${v.answer}. ` : '', v.explanation || ''),
            h('div.admin-q-actions', {},
              f.ref && kind !== 'custom' && h('button.btn.ghost.sm', { onclick: () => editAnswer(f.ref, reload) }, '✏️ Fix answer'),
              h('button.btn.ghost.sm', {
                onclick: async () => { await adminApi(`api/admin/feedback/${f.id}`, { method: 'PUT', body: { resolved: !f.resolved } }); reload(); },
              }, f.resolved ? 'Reopen' : '✓ Resolve'))));
      })) : h('p.muted', {}, 'No feedback yet.'));
  }

  // --------------------------------------------------------------- roster
  async function rosterTab(body) {
    state.roster ||= await adminApi('api/admin/roster');
    const r = state.roster;
    const file = h('input', { type: 'file', accept: '.xlsx,.csv' });
    const status = h('p');
    body.replaceChildren(h('div.panel', {},
      h('h3', {}, 'School student list'),
      h('p', {}, r.total
        ? `${r.total} students on the list (${Object.entries(r.grades).map(([g, n]) => `Grade ${g}: ${n}`).join(', ')}). Only these emails can create an account.`
        : 'No list uploaded yet, so anyone can create an account.'),
      h('p.muted', {}, 'Upload the Excel file (one sheet per grade, like G09, G10…) or a CSV with an Email column. Uploading replaces the old list; existing accounts stay.'),
      h('div.builder-row', {}, file, h('button.btn.primary', {
        onclick: async () => {
          if (!file.files[0]) { status.textContent = 'Choose a file first.'; return; }
          const fd = new FormData();
          fd.append('file', file.files[0]);
          status.textContent = 'Uploading…';
          const res = await fetch('api/admin/roster', { method: 'POST', body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) { status.textContent = data.error || 'Upload failed.'; return; }
          state.roster = data;
          toast('Student list saved', `${data.total} students`, { icon: '✅', tone: 'success' });
          draw();
        },
      }, 'Upload')),
      status));
  }

  // ------------------------------------------------------------- teachers
  async function teachersTab(body) {
    state.staff ||= (await adminApi('api/admin/staff')).staff;
    const reload = () => { state.staff = null; draw(); };
    const form = h('form.panel.auth-form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const { name, email, password } = e.target.elements;
        try {
          await adminApi('api/admin/staff', { method: 'POST', body: { name: name.value, email: email.value, password: password.value } });
          toast('Teacher saved', `${name.value} can sign in with their email.`, { icon: '✅', tone: 'success' });
          reload();
        } catch (err) {
          toast('Not saved', err.message, { tone: 'danger', icon: '⚠️' });
        }
      },
    },
    h('h3', {}, 'Add a teacher'),
    h('p.muted', {}, 'Teachers can fix questions, read feedback and hide students from the leaderboard. Only you can upload the school list, reset passwords, delete accounts and manage teachers. Saving an existing email sets a new password.'),
    h('label.field', {}, h('span', {}, 'Name'), h('input', { name: 'name', required: true })),
    h('label.field', {}, h('span', {}, 'Email'), h('input', { name: 'email', type: 'email', required: true })),
    h('label.field', {}, h('span', {}, 'Password (at least 10 characters)'), h('input', { name: 'password', type: 'password', minlength: 10, required: true, autocomplete: 'new-password' })),
    h('button.btn.primary', { type: 'submit' }, 'Save teacher'));
    body.replaceChildren(form,
      state.staff.length ? h('div.table-wrap', {}, h('table.admin-table', {},
        h('thead', {}, h('tr', {}, ['Teacher', 'Email', ''].map((c) => h('th', {}, c)))),
        h('tbody', {}, state.staff.map((t) => h('tr', {},
          h('td', {}, h('b', {}, t.name)), h('td', {}, t.email),
          h('td.admin-row-actions', {}, h('button.btn.ghost.sm.danger', {
            onclick: async () => {
              if (!confirm(`Remove ${t.name}'s teacher account?`)) return;
              await adminApi(`api/admin/staff/${t.id}`, { method: 'DELETE' });
              reload();
            },
          }, 'Remove'))))))) : h('p.muted', {}, 'No teacher accounts yet.'));
  }
}

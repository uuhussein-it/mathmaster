/**
 * "Report a problem" dialog. From a question it can also ask AI to check the
 * student's answer again; the note (and AI's verdict) reach the teacher's
 * admin page either way.
 */
import { h, modal, toast } from './ui.js';
import { sendFeedback } from './account.js';

const CATEGORIES = [
  ['wrong-key', 'I think the answer key is wrong'],
  ['unclear', 'The question is unclear'],
  ['picture', 'The picture is missing or cut off'],
  ['site', 'Something on the site isn’t working'],
  ['idea', 'An idea or suggestion'],
  ['other', 'Something else'],
];

/** q: the question (optional); answer: the student's answer as text; wrong: it was marked wrong. */
export function openFeedback({ q = null, answer = '', wrong = false } = {}) {
  const canRecheck = Boolean(q?.ref && answer && wrong);
  const category = h('select', { name: 'category' },
    CATEGORIES.filter(([id]) => q || !['wrong-key', 'unclear', 'picture'].includes(id))
      .map(([id, label]) => h('option', { value: id, selected: id === (canRecheck ? 'wrong-key' : q ? 'unclear' : 'site') }, label)));
  const message = h('textarea', { name: 'message', rows: 4, maxlength: 1500, placeholder: 'Tell your teacher what you noticed…' });
  const recheck = h('input', { type: 'checkbox', name: 'recheck', checked: canRecheck });
  const result = h('div.fb-result', { 'aria-live': 'polite' });
  const submit = h('button.btn.primary', { type: 'submit' }, 'Send');

  async function onSubmit(e) {
    e.preventDefault();
    if (!message.value.trim() && !(canRecheck && recheck.checked)) {
      result.replaceChildren(h('p.auth-error', {}, 'Write a short message first.'));
      return;
    }
    submit.disabled = true;
    submit.textContent = canRecheck && recheck.checked ? 'AI is checking…' : 'Sending…';
    try {
      const r = await sendFeedback({
        ref: q?.ref, answer, category: category.value, message: message.value.trim(),
        recheck: canRecheck && recheck.checked,
      });
      form.replaceWith(verdictView(r.verdict));
      if (!r.verdict) toast('Thanks!', 'Your teacher will see your note.', { icon: '📨', tone: 'success' });
    } catch (err) {
      result.replaceChildren(h('p.auth-error', {}, err.message));
      submit.disabled = false;
      submit.textContent = 'Send';
    }
  }

  const form = h('form.fb-form', { onsubmit: onSubmit },
    q && h('p.muted', {}, 'About this question', answer ? ` · your answer: ${answer}` : ''),
    h('label.field', {}, h('span', {}, 'What’s the problem?'), category),
    h('label.field', {}, h('span', {}, 'Details'), message),
    canRecheck && h('label.fb-check', {}, recheck, h('span', {}, 'Ask AI to check my answer again')),
    result,
    h('div.fb-actions', {}, submit));

  const close = modal(q ? 'Report a problem' : 'Send feedback', form);

  function verdictView(v) {
    const done = h('button.btn.primary', { type: 'button', onclick: () => close() }, 'Done');
    if (!v) return h('div.fb-done', {}, h('p', {}, '📨 Sent. Your teacher will read it.'), done);
    const tone = v.correct === true ? 'good' : v.correct === false ? 'bad' : '';
    return h('div.fb-done', {},
      h(`div.feedback.${tone || 'neutral'}`, {},
        h('div.feedback-head', {}, h('b', {},
          v.correct === true ? 'AI agrees with you!' : v.correct === false ? 'AI still marks it wrong' : 'Sent to your teacher')),
        v.answer && h('p', {}, h('span.muted', {}, 'Correct answer: '), v.answer),
        v.explanation && h('p', {}, v.explanation),
        v.correct === true && h('p.muted', {}, 'Your teacher will review the answer key.')),
      done);
  }
}

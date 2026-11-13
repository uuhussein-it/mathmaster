/**
 * Student sign-in with a school email. First visit: the email is checked against
 * the school's student list and the student creates a password. Later visits:
 * email + password. Forgot password: the student asks their teacher, who makes
 * a 6-digit code on the admin page; the code and a new password sign them in.
 */
import { h, mount } from '../ui.js';
import { checkEmail, login, signup, requestReset, resetPassword } from '../account.js';
import { profile } from '../state.js';
import { go } from '../router.js';

export function renderLogin(app) {
  let step = 'email'; // email → password (existing account) | create (first visit); password → forgot → reset
  let sent = false;
  let email = '';
  let info = {};
  let error = '';
  let busy = false;

  const next = () => go(profile.character ? 'hub' : 'select');

  async function run(fn) {
    busy = true;
    error = '';
    draw();
    try {
      await fn();
    } catch (e) {
      error = e.message;
    }
    busy = false;
    draw();
  }

  function onEmail(e) {
    e.preventDefault();
    const value = e.target.elements.email.value.trim().toLowerCase();
    run(async () => {
      info = await checkEmail(value);
      email = value;
      step = info.exists ? 'password' : 'create';
    });
  }

  function onPassword(e) {
    e.preventDefault();
    const password = e.target.elements.password.value;
    run(async () => { await login(email, password); next(); });
  }

  function onCreate(e) {
    e.preventDefault();
    const { password, confirm, name } = e.target.elements;
    if (password.value.length < 8) { error = 'Choose a password of at least 8 characters.'; draw(); return; }
    if (password.value !== confirm.value) { error = 'The two passwords don’t match.'; draw(); return; }
    run(async () => { await signup(email, password.value, name.value); next(); });
  }

  function onForgot() {
    run(async () => { await requestReset(email); sent = true; step = 'reset'; });
  }

  function onReset(e) {
    e.preventDefault();
    const { code, password, confirm } = e.target.elements;
    if (password.value.length < 8) { error = 'Choose a password of at least 8 characters.'; draw(); return; }
    if (password.value !== confirm.value) { error = 'The two passwords don’t match.'; draw(); return; }
    run(async () => { await resetPassword(email, code.value, password.value); next(); });
  }

  const to = (s) => () => { step = s; error = ''; draw(); };
  const field = (label, attrs) => h('label.field', {}, h('span', {}, label), h('input', { required: true, ...attrs }));
  const back = () => h('button.btn.ghost.sm', { type: 'button', onclick: () => { step = 'email'; error = ''; draw(); } }, '← Use another email');

  function form() {
    if (step === 'email') {
      return h('form.auth-form', { onsubmit: onEmail },
        field('School email', { name: 'email', type: 'email', autocomplete: 'username', placeholder: 'yourID@actvet.gov.ae', value: email, autofocus: true }),
        h('button.btn.primary.lg', { type: 'submit', disabled: busy }, busy ? 'Checking…' : 'Continue'));
    }
    if (step === 'password') {
      return h('form.auth-form', { onsubmit: onPassword },
        h('p.auth-who', {}, 'Welcome back', info.name ? `, ${info.name}` : '', '. ', h('span.muted', {}, email)),
        field('Password', { name: 'password', type: 'password', autocomplete: 'current-password', autofocus: true }),
        h('button.btn.primary.lg', { type: 'submit', disabled: busy }, busy ? 'Signing in…' : 'Log in'),
        h('button.link.auth-forgot', { type: 'button', onclick: to('forgot') }, 'Forgot your password?'),
        back());
    }
    if (step === 'forgot') {
      return h('div.auth-form', {},
        h('p.auth-who', {}, 'No problem. Your teacher can give you a ', h('b', {}, '6-digit reset code'), ' for ', h('b', {}, email), '.'),
        h('ol.auth-steps', {},
          h('li', {}, 'Tap the button below. Your teacher sees your request.'),
          h('li', {}, 'Your teacher gives you a code.'),
          h('li', {}, 'Type the code here and choose a new password.')),
        h('button.btn.primary.lg', { type: 'button', disabled: busy, onclick: onForgot }, busy ? 'Sending…' : 'Ask my teacher for a code'),
        h('button.link.auth-forgot', { type: 'button', onclick: () => { sent = false; to('reset')(); } }, 'I already have a code'),
        h('button.btn.ghost.sm', { type: 'button', onclick: to('password') }, '← Back to log in'));
    }
    if (step === 'reset') {
      return h('form.auth-form', { onsubmit: onReset },
        sent
          ? h('p.auth-ok', { role: 'status' }, '✅ Request sent. When your teacher gives you the code, type it here. It works for 24 hours.')
          : h('p.auth-who', {}, 'Type the code your teacher gave you for ', h('b', {}, email), '.'),
        field('Reset code', { name: 'code', type: 'text', inputmode: 'numeric', pattern: '[0-9 ]{6,7}', maxlength: 7, autocomplete: 'one-time-code', placeholder: '123456', autofocus: true }),
        field('New password', { name: 'password', type: 'password', minlength: 8, autocomplete: 'new-password' }),
        field('Type it again', { name: 'confirm', type: 'password', minlength: 8, autocomplete: 'new-password' }),
        h('button.btn.primary.lg', { type: 'submit', disabled: busy }, busy ? 'Saving…' : 'Save new password'),
        h('button.btn.ghost.sm', { type: 'button', onclick: to('password') }, '← Back to log in'));
    }
    return h('form.auth-form', { onsubmit: onCreate },
      h('p.auth-who', {}, info.name ? `Hi ${info.name}! ` : 'Hi! ', 'Create a password for ', h('b', {}, email), '.'),
      field('Your name', { name: 'name', type: 'text', maxlength: 40, autocomplete: 'name', value: info.name || '' }),
      field('New password', { name: 'password', type: 'password', minlength: 8, autocomplete: 'new-password', autofocus: true }),
      field('Type it again', { name: 'confirm', type: 'password', minlength: 8, autocomplete: 'new-password' }),
      h('button.btn.primary.lg', { type: 'submit', disabled: busy }, busy ? 'Creating…' : 'Create account'),
      back());
  }

  function draw() {
    mount(app,
      h('section.auth', {},
        h('div.select-head', {},
          h('img.select-crest', { src: 'assets/favicon.svg', alt: '' }),
          h('p.eyebrow', {}, 'QuestLearn Academy'),
          h('h1.display', {}, step === 'create' ? 'Create your account' : step === 'forgot' || step === 'reset' ? 'Reset your password' : 'Sign in'),
          h('p.lede', {}, 'Use your school email to save your progress and join your class group.')),
        h('div.panel.auth-panel', {},
          form(),
          error && h('p.auth-error', { role: 'alert' }, error)),
        h('a.auth-teacher', { href: '#/admin' }, 'Teacher sign-in')));
    app.querySelector('[autofocus]')?.focus();
  }

  draw();
}

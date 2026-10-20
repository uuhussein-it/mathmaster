/**
 * The signed-in student (school email + password) and the teacher session.
 * A student's QuestLearn profile lives on the server so it follows them between
 * devices and feeds their group's leaderboard; this module keeps the local
 * profile and the server copy in step.
 */
import { profile, onProfileChange, replaceProfile } from './state.js';

export const account = { student: null, admin: false, ready: false };

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}).`);
  return data;
}

/** Make the server profile the local one (or seed the server from this device). */
function adopt(student) {
  account.student = student;
  if (!student) return;
  const saved = student.profile || {};
  if (saved.character) replaceProfile(saved);
  else if (profile.character) pushProfile();
}

export async function loadAccount() {
  try {
    const me = await api('api/auth/me');
    account.admin = me.admin;
    adopt(me.student);
  } catch { /* offline: carry on signed out */ }
  account.ready = true;
}

export const checkEmail = (email) => api('api/auth/check', { method: 'POST', body: { email } });

export async function login(email, password) {
  adopt((await api('api/auth/login', { method: 'POST', body: { email, password } })).student);
}

export async function signup(email, password, name) {
  replaceProfile({}); // a new account starts fresh, not with someone else's device progress
  adopt((await api('api/auth/signup', { method: 'POST', body: { email, password, name } })).student);
}

export async function logout() {
  await api('api/auth/logout', { method: 'POST' }).catch(() => {});
  account.student = null;
  replaceProfile({});
}

/** Choose the student's level: grade (9-12) and track (asp | advanced | general). */
export async function saveLevel(grade, track) {
  account.student = (await api('api/me', { method: 'PUT', body: { grade, track, profile, name: profile.name } })).student;
}

let timer = null;
function pushProfile() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!account.student) return;
    api('api/me', { method: 'PUT', body: { profile, name: profile.name } })
      .then((r) => { account.student = r.student; })
      .catch(() => {});
  }, 800);
}
onProfileChange(() => account.student && pushProfile());

export const loadGroup = (id) => api(`api/groups/${id}`);

/** Feedback about a question (ref) or the site; `recheck` asks AI to grade the answer again. */
export const sendFeedback = (body) => api('api/ql/feedback', { method: 'POST', body });

// ---------------------------------------------------------------- teacher
export async function adminLogin(username, password) {
  await api('api/admin/login', { method: 'POST', body: { username, password } });
  account.admin = true;
}

export async function adminLogout() {
  await api('api/admin/logout', { method: 'POST' }).catch(() => {});
  account.admin = false;
}

export const adminApi = api;

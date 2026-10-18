/**
 * Minimal hash router. Screens register a render function that receives the
 * #app element and an optional payload (e.g. the session to play). A render
 * function may return a cleanup callback (used to stop timers).
 */
import { profile } from './state.js';

const routes = new Map();
let payload = null;
let cleanup = null;

export function register(name, render, { needsPayload = false } = {}) {
  routes.set(name, { render, needsPayload });
}

export function go(name, data = null) {
  payload = data;
  if (location.hash === `#/${name}`) render();
  else location.hash = `#/${name}`;
}

function render() {
  let name = location.hash.replace(/^#\/?/, '') || 'hub';
  if (!profile.character) name = 'select';
  let route = routes.get(name);
  // Session screens can't be restored after a reload, so fall back to the hub.
  if (!route || (route.needsPayload && !payload)) {
    name = 'hub';
    route = routes.get('hub');
  }
  if (typeof cleanup === 'function') cleanup();
  const app = document.getElementById('app');
  document.body.dataset.screen = name;
  cleanup = route.render(app, payload);
  window.scrollTo({ top: 0 });
  app.focus({ preventScroll: true });
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  render();
}

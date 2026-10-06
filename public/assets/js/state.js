// Shared app state: counts and AI status from the server, plus hash-query helpers.

import { get } from './api.js';
import { toastError } from './ui.js';

export const app = { state: null };

/** Fetches counts and AI status, and updates the navigation badges. */
export async function refreshState() {
  try {
    app.state = await get('state');
  } catch (err) {
    toastError(err);
    return app.state;
  }
  for (const el of document.querySelectorAll('[data-count]')) {
    const n = app.state.counts[el.dataset.count] ?? 0;
    el.textContent = n > 0 ? String(n) : '';
    el.classList.toggle('attention', el.dataset.count === 'pending' && n > 0);
  }
  return app.state;
}

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  return { path: decodeURIComponent(path), query: new URLSearchParams(qs) };
}

/** Updates the query part of the current hash without re-rendering the view. */
export function setQuery(params) {
  const { path } = parseHash();
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
  history.replaceState(null, '', `#/${path}${qs ? `?${qs}` : ''}`);
}

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

export function storedTheme() {
  try {
    return localStorage.getItem('theme') ?? 'system';
  } catch {
    return 'system';
  }
}

export function saveTheme(theme) {
  try {
    localStorage.setItem('theme', theme);
  } catch {
    // storage blocked: the choice lasts for this page only
  }
  applyTheme(theme);
}

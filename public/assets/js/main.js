// App shell: hash router, active navigation, theme and mobile menu.

import { h } from './ui.js';
import { app, applyTheme, parseHash, refreshState, storedTheme } from './state.js';
import * as queue from './views/queue.js';
import * as library from './views/library.js';
import * as sources from './views/sources.js';
import * as study from './views/study.js';
import * as dashboard from './views/dashboard.js';
import * as guides from './views/guides.js';
import * as settings from './views/settings.js';

const routes = [
  [/^queue$/, queue.render],
  [/^library$/, library.renderLibrary],
  [/^item\/(\d+)$/, library.renderItem],
  [/^sources$/, sources.renderSources],
  [/^source\/(\d+)$/, sources.renderSource],
  [/^add$/, sources.renderAdd],
  [/^flashcards$/, study.renderFlashcards],
  [/^quiz$/, study.renderQuiz],
  [/^session$/, study.renderSession],
  [/^dashboard$/, dashboard.render],
  [/^guides$/, guides.render],
  [/^settings$/, settings.render],
];

let cleanups = [];

async function route() {
  cleanups.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  cleanups = [];
  document.body.classList.remove('focus-mode');
  closeMenu();

  let { path, query } = parseHash();
  if (app.state) refreshState(); // keep the sidebar counts current (changes may come from another tab)
  if (!path) {
    const s = app.state ?? (await refreshState());
    const target = !s ? 'queue' : s.counts.pending > 0 ? 'queue' : s.counts.library > 0 ? 'dashboard' : 'add';
    history.replaceState(null, '', `#/${target}`);
    path = target;
  }

  for (const link of document.querySelectorAll('.nav-link[data-route]')) {
    const r = link.dataset.route;
    const active = path === r || (r === 'library' && path.startsWith('item/')) || (r === 'sources' && path.startsWith('source/'));
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }

  const main = document.getElementById('main');
  const page = h('div', { class: 'page' });
  main.replaceChildren(page);
  window.scrollTo(0, 0);

  const match = routes.find(([re]) => re.test(path));
  if (!match) {
    page.append(h('div', { class: 'empty' },
      h('h2', { text: 'Page not found' }),
      h('a', { class: 'btn', href: '#/queue', text: 'Go to the review queue' })));
    return;
  }
  const [re, view] = match;
  try {
    await view(page, { params: path.match(re).slice(1), query, onLeave: (fn) => cleanups.push(fn) });
  } catch (err) {
    console.error(err);
    page.replaceChildren(h('div', { class: 'empty' },
      h('h2', { text: 'This page could not load' }),
      h('p', { text: err?.message ?? String(err) }),
      h('button', { class: 'btn', type: 'button', text: 'Try again', on: { click: route } })));
  }
}

// ---------- mobile menu ----------

const sidebar = document.getElementById('sidebar');
const scrim = document.querySelector('.scrim');
const toggle = document.querySelector('.nav-toggle');

function openMenu() {
  sidebar.classList.add('open');
  scrim.hidden = false;
  toggle.setAttribute('aria-expanded', 'true');
  sidebar.querySelector('.nav-link')?.focus();
}
function closeMenu() {
  sidebar.classList.remove('open');
  scrim.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
}
toggle.addEventListener('click', () => (sidebar.classList.contains('open') ? closeMenu() : openMenu()));
scrim.addEventListener('click', closeMenu);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sidebar.classList.contains('open')) closeMenu();
});

applyTheme(storedTheme());
window.addEventListener('hashchange', route);
refreshState().then(route);

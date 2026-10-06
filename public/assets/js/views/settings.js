// Settings: study goal ("make it yours"), AI status, backup and restore, appearance, password.

import { post } from '../api.js';
import { h, toast, toastError, confirmDialog } from '../ui.js';
import { refreshState, saveTheme, storedTheme } from '../state.js';

const FOCUSES = ['', 'concept recall', 'exam review', 'practical how-to knowledge', 'meeting preparation'];

export async function render(page) {
  page.classList.add('page-narrow');
  const state = await refreshState();

  page.append(h('header', { class: 'page-head' },
    h('div', {}, h('h1', { text: 'Settings & backup' }),
      h('p', { class: 'sub', text: 'Point the guide at what you are studying for, keep a backup, and manage your sign-in.' }))));

  // Make it yours
  const subject = h('input', { type: 'text', maxlength: 200, value: state?.goal?.subject ?? '', placeholder: 'e.g. Psychology 101 midterm, or the onboarding meeting on Friday' });
  const focus = h('select', {}, FOCUSES.map((f) => h('option', { value: f, text: f ? f[0].toUpperCase() + f.slice(1) : 'No particular focus', selected: f === (state?.goal?.focus ?? '') })));
  page.append(h('form', {
    class: 'card stack',
    on: {
      submit: async (e) => {
        e.preventDefault();
        try {
          const r = await post('settings.goal', { subject: subject.value, focus: focus.value });
          toast(r.goal ? `Saved. New drafts will prioritise: ${r.goal}.` : 'Saved.');
          refreshState();
        } catch (err) {
          toastError(err);
        }
      },
    },
  },
  h('h2', { text: 'Make it yours' }),
  h('p', { class: 'muted small', text: 'Exam review leans on flashcards and recall. Meeting prep leans on how-to steps and open questions. Claude uses this when drafting new items; existing items do not change, and every draft still waits for your approval.' }),
  h('label', { class: 'field' }, h('span', { text: 'What are you studying for?' }), subject),
  h('label', { class: 'field' }, h('span', { text: 'Prioritise' }), focus),
  h('div', {}, h('button', { class: 'btn btn-primary', type: 'submit', text: 'Save goal' }))));

  // AI status
  const ai = state?.ai ?? {};
  page.append(h('section', { class: 'card stack' },
    h('h2', { text: 'Who drafts your study items' }),
    ai.claude
      ? h('p', { class: 'notice notice-ok', text: `Claude is connected (${ai.model}, effort “${ai.effort}”). Drafts quote the sentence they came from; you approve every one.` })
      : h('div', { class: 'notice notice-warn' },
        h('p', { text: 'Claude is not configured, so new notes use the offline extractor.' }),
        h('p', { class: 'small', style: { marginTop: '6px' } }, 'To enable Claude, copy ', h('code', { text: '.env.example' }), ' to ', h('code', { text: '.env' }), ' in the app folder and set ', h('code', { text: 'ANTHROPIC_API_KEY' }), '. Reload this page afterwards.'))));

  // Backup
  const restoreInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  restoreInput.addEventListener('change', async () => {
    const f = restoreInput.files?.[0];
    restoreInput.value = '';
    if (!f) return;
    let data;
    try {
      data = JSON.parse(await f.text());
    } catch {
      return toast('That file is not valid JSON.', { kind: 'error' });
    }
    const ok = await confirmDialog({
      title: 'Restore this backup?',
      message: `This replaces everything in your study guide — sources, cards, study history and settings — with the contents of ${f.name}. Your sign-in stays the same. Download a backup of the current state first if you might need it.`,
      confirm: 'Replace with backup', danger: true,
    });
    if (!ok) return;
    try {
      const r = await post('restore', { backup: data });
      toast(`Restored ${r.sources} sources and ${r.items} items.`);
      await refreshState();
      location.hash = '#/library';
    } catch (err) {
      toastError(err);
    }
  });
  page.append(h('section', { class: 'card stack' },
    h('h2', { text: 'Backup' }),
    h('p', { class: 'muted small', text: 'A full backup holds your notes, every item (approved, waiting or discarded), study history and settings — everything except your password. Keep one somewhere safe; a hosted app can be wiped or expire.' }),
    h('div', { class: 'row' },
      h('a', { class: 'btn btn-primary', href: 'api.php?action=backup', text: 'Download full backup (.json)' }),
      h('a', { class: 'btn', href: 'api.php?action=export.md', text: 'Export library as Markdown' }),
      h('button', { class: 'btn', type: 'button', text: 'Restore from backup…', on: { click: () => restoreInput.click() } }),
      restoreInput)));

  // Appearance
  const theme = h('select', { 'aria-label': 'Theme', on: { change: () => saveTheme(theme.value) } },
    [['system', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, t]) => h('option', { value: v, text: t, selected: v === storedTheme() })));
  page.append(h('section', { class: 'card stack' }, h('h2', { text: 'Appearance' }), h('label', { class: 'field' }, h('span', { text: 'Theme' }), theme)));

  // Account
  const current = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const next = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10, required: true });
  const confirm = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10, required: true });
  page.append(h('form', {
    class: 'card stack',
    on: {
      submit: async (e) => {
        e.preventDefault();
        try {
          await post('settings.password', { current: current.value, new: next.value, confirm: confirm.value });
          current.value = next.value = confirm.value = '';
          toast('Password changed.');
        } catch (err) {
          toastError(err);
        }
      },
    },
  },
  h('h2', { text: 'Account' }),
  h('p', { class: 'muted small', text: `Signed in as ${state?.user ?? ''}. This guide has a single owner account; nobody else can sign up.` }),
  h('div', { class: 'grid-2' },
    h('label', { class: 'field' }, h('span', { text: 'Current password' }), current),
    h('span'),
    h('label', { class: 'field' }, h('span', { text: 'New password (10+ characters)' }), next),
    h('label', { class: 'field' }, h('span', { text: 'Confirm new password' }), confirm)),
  h('div', {}, h('button', { class: 'btn', type: 'submit', text: 'Change password' }))));
}

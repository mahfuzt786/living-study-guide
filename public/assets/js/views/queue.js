// Review queue: every draft is checked against its source excerpt before it can reach the library.
// There is deliberately no "approve all" — each item gets a human look.

import { get, post } from '../api.js';
import { h, toast, toastError, modal, kindBadge, originLabel, excerptBlock, plural, KINDS } from '../ui.js';
import { itemEditor } from '../editor.js';
import { refreshState } from '../state.js';

export async function render(page, { query, onLeave }) {
  page.classList.add('page-wide');
  const sourceId = query.get('source_id') ?? '';
  const [items, sources] = await Promise.all([get('queue', { source_id: sourceId }), get('sources')]);

  let index = Math.max(0, items.findIndex((i) => String(i.id) === query.get('item')));
  let mode = query.get('view') === 'list' ? 'list' : 'one';
  let editor = null;
  let busy = false;

  const viewToggle = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Queue view' });
  const sourceFilter = h('select', { 'aria-label': 'Filter by source', on: { change: () => { location.hash = `#/queue${sourceFilter.value ? `?source_id=${sourceFilter.value}` : ''}`; } } },
    h('option', { value: '', text: 'All sources' }),
    sources.map((s) => h('option', { value: s.id, selected: String(s.id) === sourceId, text: `${s.title} (${s.pending})` })));

  page.append(h('header', { class: 'page-head' },
    h('div', {},
      h('h1', { text: 'Review queue' }),
      h('p', { class: 'sub', text: 'Each draft waits here beside the sentence it came from. Read your notes first, then the draft. Nothing reaches your library until you approve it.' })),
    h('div', { class: 'head-actions' }, sources.length > 1 ? sourceFilter : null, viewToggle)));
  const body = h('div', { class: 'stack' });
  page.append(body);

  const drawToggle = () => {
    viewToggle.replaceChildren(
      ...[['one', 'One at a time'], ['list', 'List']].map(([m, label]) => h('button', {
        type: 'button', role: 'tab', 'aria-selected': String(mode === m), text: label,
        on: { click: () => { mode = m; draw(); } },
      })));
    viewToggle.hidden = items.length === 0;
  };

  function draw() {
    drawToggle();
    if (items.length === 0) return drawEmpty();
    index = Math.min(index, items.length - 1);
    if (mode === 'list') drawList(); else drawOne();
  }

  function drawEmpty() {
    const hasSources = sources.length > 0;
    body.replaceChildren(h('div', { class: 'card empty' },
      h('h2', { text: hasSources ? 'The queue is clear' : 'Nothing to review yet' }),
      h('p', { text: hasSources
        ? 'Every draft has been approved, edited, merged or discarded. Your approved cards are in the library.'
        : 'Add some notes you are allowed to use. The app drafts study items from them and puts each one here for you to check.' }),
      h('div', { class: 'row' },
        hasSources
          ? [h('a', { class: 'btn btn-primary', href: '#/flashcards', text: 'Study flashcards' }),
            h('a', { class: 'btn', href: '#/library', text: 'Open library' }),
            h('a', { class: 'btn', href: '#/add', text: 'Add more notes' })]
          : [h('a', { class: 'btn btn-primary', href: '#/add', text: 'Add your notes' }),
            h('a', { class: 'btn', href: '#/add?demo=1', text: 'Try the demo notes' })])));
  }

  function drawList() {
    body.replaceChildren(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', { text: plural(items.length, 'draft') + ' waiting' }),
        h('span', { class: 'muted small', text: 'Choose one to review it.' })),
      h('div', { class: 'table-scroll' }, h('table', { class: 'queue-list' },
        h('thead', {}, h('tr', {}, ['Draft', 'Kind', 'Excerpt', 'Source'].map((t) => h('th', { text: t })))),
        h('tbody', {}, items.map((item, i) => h('tr', {
          tabindex: '0',
          on: {
            click: () => { index = i; mode = 'one'; draw(); },
            keydown: (e) => { if (e.key === 'Enter') { index = i; mode = 'one'; draw(); } },
          },
        },
        h('td', {}, h('b', { text: item.title })),
        h('td', { text: KINDS[item.kind] ?? item.kind }),
        h('td', {}, matchSummary(item)),
        h('td', { class: 'muted', text: item.source_title }))))))));
  }

  function drawOne() {
    const item = items[index];
    editor = itemEditor(item);
    const pct = `${Math.round(((index) / items.length) * 100)}%`;

    const progress = h('div', { class: 'queue-progress' },
      h('span', {}, h('b', { text: `Draft ${index + 1}` }), ` of ${items.length}`),
      h('div', { class: 'progress', 'aria-hidden': 'true' }, h('span', { style: { width: pct } })),
      h('span', { class: 'muted', text: item.source_title }));

    const sourcePanel = h('section', { class: 'card review-source', 'aria-label': 'Your notes' },
      h('div', { class: 'panel-label' }, h('span', { class: 'step', text: '1' }), 'Read your notes first'),
      item.excerpts.length
        ? item.excerpts.map((x) => excerptBlock(x))
        : h('p', { class: 'notice notice-warn', text: 'This draft has no excerpt, so nothing ties it to your notes. Discard it unless you can confirm it yourself.' }));

    const draftPanel = h('section', { class: 'card review-draft', 'aria-label': 'Draft' },
      h('div', { class: 'row-between' },
        h('div', { class: 'panel-label' }, h('span', { class: 'step', text: '2' }), 'Check the draft'),
        h('div', { class: 'row' }, kindBadge(item.kind), h('span', { class: 'muted small', text: originLabel(item) }))),
      h('ol', { class: 'checklist' },
        h('li', {}, h('b', { text: 'Is it accurate? ' }), 'Does it say only what the excerpt says — no added causes, dates or names?'),
        h('li', {}, h('b', { text: 'Is it worth studying? ' }), 'Will you need to remember this?')),
      editor.el);

    const actions = h('div', { class: 'review-actions' },
      h('div', { class: 'row' },
        button('Discard', 'D', discard, 'btn btn-danger'),
        button('Merge into…', 'M', openMerge, 'btn')),
      h('div', { class: 'row' },
        items.length > 1 ? h('button', { class: 'btn btn-ghost', type: 'button', 'aria-label': 'Previous draft', text: '←', on: { click: () => move(-1) } }) : null,
        items.length > 1 ? button('Skip', 'S', () => move(1), 'btn') : null,
        button('Approve', 'A', approve, 'btn btn-primary')));

    body.replaceChildren(progress, h('div', { class: 'review' }, sourcePanel, draftPanel), actions);
  }

  function button(label, key, fn, cls) {
    return h('button', { class: cls, type: 'button', on: { click: fn }, 'aria-keyshortcuts': key }, label, h('kbd', { text: key }));
  }

  async function approve() {
    if (busy || !items.length) return;
    const item = items[index];
    const fields = editor.getFields();
    if (!fields.title) return toast('Give the item a title before approving it.', { kind: 'error' });
    if (fields.kind !== 'question' && (!fields.card_front || !fields.card_back)) {
      return toast('Fill in both sides of the flashcard, or change the kind to “Open question”.', { kind: 'error' });
    }
    busy = true;
    try {
      const saved = await post('item.approve', { id: item.id, fields });
      const at = index;
      items.splice(index, 1);
      toast(`Approved “${saved.title}”${saved.edited ? ' with your edits' : ''}.`, { action: 'Undo', onAction: () => undo(saved.id, at) });
      changed();
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
    }
  }

  async function discard() {
    if (busy || !items.length) return;
    const item = items[index];
    busy = true;
    try {
      await post('item.discard', { id: item.id });
      const at = index;
      items.splice(index, 1);
      toast(`Discarded “${item.title}”.`, { action: 'Undo', onAction: () => undo(item.id, at) });
      changed();
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
    }
  }

  async function undo(id, at) {
    try {
      const restored = await post('item.restore', { id });
      items.splice(Math.min(at, items.length), 0, restored);
      index = Math.min(at, items.length - 1);
      mode = 'one';
      changed();
    } catch (err) {
      toastError(err);
    }
  }

  /** Moves to another draft, saving any edits first so nothing typed is lost. */
  async function move(step) {
    if (busy || items.length < 2) return;
    if (editor?.isDirty()) {
      busy = true;
      try {
        items[index] = await post('item.update', { id: items[index].id, fields: editor.getFields() });
        toast('Your edits were saved. The draft stays in the queue.');
      } catch (err) {
        toastError(err);
        return;
      } finally {
        busy = false;
      }
    }
    index = (index + step + items.length) % items.length;
    draw();
    window.scrollTo({ top: 0 });
  }

  async function openMerge() {
    if (busy || !items.length) return;
    const item = items[index];
    const search = h('input', { type: 'search', placeholder: 'Search drafts and library items…', 'aria-label': 'Search items to merge into' });
    const list = h('ul', { class: 'pick-list' });
    let candidates = items.filter((i) => i.id !== item.id).map((i) => ({ ...i }));
    const m = modal({
      title: `Merge “${item.title}” into…`,
      wide: true,
      body: h('div', { class: 'stack' },
        h('p', { class: 'muted small', text: 'Use this when two drafts cover the same idea. This draft’s excerpt and tags move to the item you pick, and this draft is retired. Afterwards, edit the combined item so it covers both excerpts.' }),
        search, list),
      actions: [h('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => m.close() } })],
    });
    const drawList = () => {
      const q = search.value.trim().toLowerCase();
      const shown = candidates.filter((c) => !q || `${c.title} ${c.statement}`.toLowerCase().includes(q)).slice(0, 40);
      list.replaceChildren(...(shown.length ? shown.map((c) => h('li', {}, h('button', {
        type: 'button',
        on: { click: () => doMerge(c) },
      }, h('span', { text: c.title }), h('span', { class: 'meta' }, `${KINDS[c.kind] ?? c.kind} · `, c.status === 'approved' ? 'in your library' : 'waiting for review', c.source_title ? ` · ${c.source_title}` : ''))))
        : [h('li', { class: 'muted small', text: 'No matching items.' })]));
    };
    search.addEventListener('input', drawList);
    drawList();
    try {
      const approved = await get('items', { status: 'approved' });
      candidates = candidates.concat(approved);
      drawList();
    } catch (err) {
      toastError(err);
    }

    async function doMerge(target) {
      m.close();
      busy = true;
      try {
        const merged = await post('item.merge', { id: item.id, into: target.id });
        items.splice(index, 1);
        const pos = items.findIndex((i) => i.id === merged.id);
        if (pos >= 0) {
          items[pos] = merged;
          index = pos;
          toast(`Merged into “${merged.title}”. Check that it now covers both excerpts.`);
        } else {
          toast(`Merged into “${merged.title}” in your library.`, { action: 'Open it', onAction: () => { location.hash = `#/item/${merged.id}`; } });
        }
        changed();
      } catch (err) {
        toastError(err);
      } finally {
        busy = false;
      }
    }
  }

  function changed() {
    draw();
    refreshState();
    window.scrollTo({ top: 0 });
  }

  const onKey = (e) => {
    if (mode !== 'one' || !items.length || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('.modal-backdrop')) return;
    const k = e.key.toLowerCase();
    const actions = { a: approve, d: discard, m: openMerge, s: () => move(1), e: () => editor?.focus() };
    if (actions[k]) { e.preventDefault(); actions[k](); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
  };
  document.addEventListener('keydown', onKey);
  onLeave(() => document.removeEventListener('keydown', onKey));

  draw();
}

function matchSummary(item) {
  const m = item.excerpts[0]?.match ?? 'missing';
  const label = { exact: 'Exact quote', close: 'Closest match', missing: 'Not found' }[m] ?? m;
  const cls = { exact: 'badge-ok', close: 'badge-warn', missing: 'badge-bad' }[m] ?? '';
  return h('span', { class: `badge ${cls}`, text: label });
}

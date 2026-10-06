// Library: approved items only — searchable, filterable, each with its own concept page.

import { get, post } from '../api.js';
import { h, fill, toast, toastError, confirmDialog, kindBadge, statusBadge, originLabel, excerptBlock, boxes, fmtDue, fmtDate, debounce, plural, KINDS } from '../ui.js';
import { itemEditor } from '../editor.js';
import { refreshState, setQuery } from '../state.js';

export async function renderLibrary(page, { query }) {
  const [tags, sources] = await Promise.all([get('tags'), get('sources')]);
  const state = { q: query.get('q') ?? '', kind: query.get('kind') ?? '', tag: query.get('tag') ?? '', source_id: query.get('source_id') ?? '', sort: query.get('sort') ?? '' };

  const search = h('input', { type: 'search', class: 'search', placeholder: 'Search titles, answers, excerpts and tags…', value: state.q, 'aria-label': 'Search the library' });
  const kind = select('Kind', [['', 'All kinds'], ...Object.entries(KINDS)], state.kind);
  const tag = select('Tag', [['', 'All tags'], ...tags.map((t) => [t.tag, `${t.tag} (${t.count})`])], state.tag);
  const source = select('Source', [['', 'All sources'], ...sources.map((s) => [String(s.id), s.title])], state.source_id);
  const sort = select('Sort', [['', 'Recently approved'], ['title', 'A–Z'], ['source', 'Order in notes'], ['weakest', 'Weakest first']], state.sort);
  const count = h('span', { class: 'muted small' });
  const results = h('div', { class: 'item-list', 'aria-live': 'polite' });

  page.append(
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', { text: 'Library' }),
        h('p', { class: 'sub', text: 'Only items you approved live here. Each one keeps the excerpt it came from.' })),
      h('div', { class: 'head-actions' }, h('a', { class: 'btn', href: '#/flashcards', text: 'Study these' }))),
    h('div', { class: 'filters' }, search, kind, tags.length ? tag : null, sources.length > 1 ? source : null, sort),
    count,
    results);

  let seq = 0;
  const load = async () => {
    Object.assign(state, { q: search.value.trim(), kind: kind.value, tag: tag.value, source_id: source.value, sort: sort.value });
    setQuery(state);
    const mine = ++seq;
    results.style.opacity = '0.6';
    try {
      const items = await get('items', state);
      if (mine !== seq) return;
      count.textContent = plural(items.length, 'item');
      results.replaceChildren(...(items.length ? items.map(itemRow) : [emptyLibrary(state)]));
    } catch (err) {
      toastError(err);
    } finally {
      results.style.opacity = '';
    }
  };
  search.addEventListener('input', debounce(load, 220));
  for (const s of [kind, tag, source, sort]) s.addEventListener('change', load);
  await load();
}

function select(label, options, value) {
  return h('select', { 'aria-label': label }, options.map(([v, text]) => h('option', { value: v, text, selected: v === value })));
}

function emptyLibrary(state) {
  const filtered = state.q || state.kind || state.tag || state.source_id;
  return h('div', { class: 'card empty' },
    h('h2', { text: filtered ? 'No items match' : 'Your library is empty' }),
    h('p', { text: filtered ? 'Try a different search or clear the filters.' : 'Approve drafts in the review queue and they will appear here.' }),
    filtered ? null : h('a', { class: 'btn btn-primary', href: '#/queue', text: 'Open the review queue' }));
}

export function itemRow(item) {
  return h('a', { class: 'item-row', href: `#/item/${item.id}` },
    h('span', { class: 'title', text: item.title }),
    h('span', { class: 'row' }, kindBadge(item.kind)),
    h('span', { class: 'statement', text: item.statement || item.card_back }),
    h('span', { class: 'meta' },
      item.kind !== 'question' ? [boxes(item.box), h('span', { text: fmtDue(item.due_at) })] : null,
      item.source_title ? h('span', { text: `· ${item.source_title}` }) : null,
      item.tags.length ? h('span', { class: 'chips' }, item.tags.map((t) => h('span', { class: 'chip', text: t }))) : null));
}

// ---------- item (concept) page ----------

export async function renderItem(page, { params }) {
  page.classList.add('page-narrow', 'item-page');
  let item = await get('item', { id: params[0] });

  const draw = () => {
    fill(page,
      h('a', { class: 'back-link', href: item.status === 'pending' ? '#/queue' : '#/library', text: item.status === 'pending' ? '← Review queue' : '← Library' }),
      h('header', { class: 'page-head' },
        h('div', { class: 'stack' },
          h('div', { class: 'row' }, kindBadge(item.kind), statusBadge(item.status), item.edited ? h('span', { class: 'badge badge-accent', text: 'Edited by you' }) : null),
          h('h1', { text: item.title })),
        actionsFor(item)),
      statusNotice(item),
      item.statement ? h('p', { class: 'lead', text: item.statement }) : null,
      item.steps.length ? h('section', { class: 'card' }, h('h2', { text: 'Steps' }), h('ol', { class: 'steps' }, item.steps.map((s) => h('li', { text: s })))) : null,
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', { text: 'From your notes' }), h('span', { class: 'muted small', text: originLabel(item) })),
        item.excerpts.length ? item.excerpts.map((x) => excerptBlock(x)) : h('p', { class: 'muted', text: 'No excerpt is linked to this item.' })),
      item.card_front ? h('section', { class: 'card card-preview' },
        h('h2', { text: item.kind === 'question' ? 'Open question' : 'Flashcard' }),
        h('p', { class: 'q', text: item.card_front }),
        item.card_back ? h('p', { class: 'a', text: item.card_back }) : null) : null,
      item.interpretation ? h('section', { class: 'ai-box' },
        h('div', { class: 'ai-label' }, h('span', { 'aria-hidden': 'true', text: '✦' }), 'AI interpretation — not from your notes'),
        h('p', { text: item.interpretation })) : null,
      h('section', { class: 'card' },
        h('h2', { text: 'Study record' }),
        h('div', { class: 'facts', style: { marginTop: '12px' } },
          fact('Leitner box', item.kind === 'question' ? '—' : `${item.box} of 5`),
          fact('Next review', item.kind === 'question' ? '—' : fmtDue(item.due_at)),
          fact('Right / wrong', `${item.times_right} / ${item.times_wrong}`),
          fact('Approved', item.reviewed_at ? fmtDate(item.reviewed_at) : '—')),
        item.tags.length ? h('div', { class: 'chips', style: { marginTop: '14px' } }, item.tags.map((t) => h('a', { class: 'chip', href: `#/library?tag=${encodeURIComponent(t)}`, text: t }))) : null),
      related);
  };

  const related = h('section', { class: 'stack' });
  const loadRelated = async () => {
    if (!item.tags.length || item.status !== 'approved') return related.replaceChildren();
    const others = (await get('items', { tag: item.tags[0] })).filter((i) => i.id !== item.id).slice(0, 5);
    fill(related, others.length ? [h('h2', { text: `Also tagged “${item.tags[0]}”` }), h('div', { class: 'item-list' }, others.map(itemRow))] : null);
  };

  function actionsFor(it) {
    const acts = [];
    if (it.status === 'approved' || it.status === 'pending') acts.push(h('button', { class: 'btn', type: 'button', text: 'Edit', on: { click: edit } }));
    if (it.status === 'pending') acts.push(h('a', { class: 'btn btn-primary', href: `#/queue?item=${it.id}`, text: 'Review in queue' }));
    if (it.status === 'approved') {
      acts.push(h('button', { class: 'btn', type: 'button', text: 'Send back to queue', on: { click: () => act('item.restore', 'Sent back to the review queue.') } }));
      acts.push(h('button', { class: 'btn btn-danger', type: 'button', text: 'Remove', on: { click: removeItem } }));
    }
    if (it.status === 'discarded') acts.push(h('button', { class: 'btn', type: 'button', text: 'Send back to queue', on: { click: () => act('item.restore', 'Sent back to the review queue.') } }));
    return h('div', { class: 'head-actions' }, acts);
  }

  async function act(action, message) {
    try {
      item = await post(action, { id: item.id });
      toast(message);
      refreshState();
      draw();
      loadRelated();
    } catch (err) {
      toastError(err);
    }
  }

  async function removeItem() {
    const ok = await confirmDialog({
      title: 'Remove from your library?',
      message: 'The item is marked as discarded and stops appearing in study modes. You can send it back to the queue later.',
      confirm: 'Remove', danger: true,
    });
    if (ok) act('item.discard', 'Removed from your library.');
  }

  function edit() {
    const editor = itemEditor(item);
    const save = h('button', { class: 'btn btn-primary', type: 'button', text: 'Save changes' });
    save.addEventListener('click', async () => {
      try {
        save.disabled = true;
        item = await post('item.update', { id: item.id, fields: editor.getFields() });
        toast('Saved.');
        draw();
        loadRelated();
      } catch (err) {
        toastError(err);
        save.disabled = false;
      }
    });
    fill(page,
      h('a', { class: 'back-link', href: '#', text: '← Cancel editing', on: { click: (e) => { e.preventDefault(); draw(); loadRelated(); } } }),
      h('h1', { text: `Edit “${item.title}”` }),
      h('div', { class: 'grid-2' },
        h('section', { class: 'card' }, h('div', { class: 'panel-label', text: 'Your notes' }), item.excerpts.map((x) => excerptBlock(x, { link: false }))),
        h('section', { class: 'card' }, editor.el)),
      h('div', { class: 'review-actions' }, h('span', { class: 'muted small', text: 'Keep the item to what the excerpt says.' }),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => { draw(); loadRelated(); } } }), save)));
    editor.focus();
  }

  draw();
  loadRelated();
}

function statusNotice(item) {
  if (item.status === 'merged') {
    return h('p', { class: 'notice' }, 'This item was merged into another one. ', item.merged_into ? h('a', { href: `#/item/${item.merged_into}`, text: 'Open the combined item' }) : null);
  }
  if (item.status === 'discarded') return h('p', { class: 'notice', text: 'You discarded this item. It is not studied or searched.' });
  if (item.status === 'pending') return h('p', { class: 'notice notice-warn', text: 'This draft has not been reviewed yet, so it is not in your library.' });
  return null;
}

function fact(k, v) {
  return h('div', { class: 'fact' }, h('div', { class: 'k', text: k }), h('div', { class: 'v', text: v }));
}

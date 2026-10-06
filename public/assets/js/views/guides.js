// Guides & summaries: source-linked summaries and how-to guides assembled from approved items only.

import { get } from '../api.js';
import { h, plural } from '../ui.js';

const SUMMARY_KINDS = new Set(['concept', 'term', 'system']);

export async function render(page) {
  const items = await get('items', { sort: 'source', status: 'approved' });

  page.append(h('header', { class: 'page-head' },
    h('div', {}, h('h1', { text: 'Guides & summaries' }),
      h('p', { class: 'sub', text: 'Written only from items you approved, in the order they appear in your notes. Every line links back to the sentence it came from.' })),
    h('div', { class: 'head-actions no-print' },
      h('button', { class: 'btn', type: 'button', text: 'Print or save as PDF', on: { click: () => window.print() } }),
      h('a', { class: 'btn', href: 'api.php?action=export.md', text: 'Export Markdown' }))));

  if (!items.length) {
    page.append(h('div', { class: 'card empty' }, h('h2', { text: 'No guides yet' }),
      h('p', { text: 'Guides are assembled from approved items. Review some drafts first.' }),
      h('a', { class: 'btn btn-primary', href: '#/queue', text: 'Open the review queue' })));
    return;
  }

  const bySource = new Map();
  for (const item of items) {
    const key = item.source_id ?? 0;
    if (!bySource.has(key)) bySource.set(key, { title: item.source_title || 'Other items', id: item.source_id, items: [] });
    bySource.get(key).items.push(item);
  }

  for (const group of bySource.values()) {
    const ordered = group.items.slice().sort((a, b) => position(a) - position(b));
    let n = 0;
    const cite = (item) => (item.excerpts ?? []).filter((x) => x.match !== 'missing').map((x) => {
      n++;
      return h('a', { class: 'cite', href: `#/source/${x.source_id}?excerpt=${x.id}`, title: `“${x.text}”`, 'aria-label': `Source sentence ${n}`, text: String(n) });
    });

    const summary = ordered.filter((i) => SUMMARY_KINDS.has(i.kind));
    const guides = ordered.filter((i) => i.kind === 'howto' || i.kind === 'process');
    const questions = ordered.filter((i) => i.kind === 'question');

    page.append(h('article', { class: 'card guide' },
      h('div', { class: 'card-head' },
        h('h2', {}, group.id ? h('a', { href: `#/source/${group.id}`, text: group.title }) : group.title),
        h('span', { class: 'muted small', text: plural(ordered.length, 'approved item') })),
      summary.length ? h('section', { class: 'guide-section' }, h('h3', { text: 'Summary' }),
        h('ol', { class: 'summary-list' }, summary.map((i) => h('li', {},
          h('a', { href: `#/item/${i.id}`, class: 'nowrap', text: i.title }), ' — ', i.statement || i.card_back, cite(i))))) : null,
      guides.length ? h('section', { class: 'guide-section' }, h('h3', { text: 'How-to guides' }),
        guides.map((g) => h('div', { class: 'stack', style: { marginBottom: '14px' } },
          h('b', {}, h('a', { href: `#/item/${g.id}`, text: g.title }), cite(g)),
          g.steps.length ? h('ol', { class: 'steps' }, g.steps.map((s) => h('li', { text: s }))) : h('p', { text: g.statement })))) : null,
      questions.length ? h('section', { class: 'guide-section' }, h('h3', { text: 'Open questions' }),
        h('ul', { class: 'summary-list' }, questions.map((q) => h('li', {}, h('a', { href: `#/item/${q.id}`, text: q.title }), cite(q))))) : null));
  }
}

function position(item) {
  const starts = (item.excerpts ?? []).map((x) => x.start).filter((s) => s !== null);
  return starts.length ? Math.min(...starts) : Number.MAX_SAFE_INTEGER;
}

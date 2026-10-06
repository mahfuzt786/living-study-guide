// Understanding dashboard: what you can recall, what is shaky, and how the review queue went.
// Charts follow the dataviz rules: one series = one hue, ordered states = one-hue ramp,
// thin marks, hairline grid, per-mark tooltips, and a table view for every chart.

import { get } from '../api.js';
import { h, kindBadge, plural, withTip } from '../ui.js';

const STATES = [
  ['new', 'New', 'not studied yet'],
  ['learning', 'Learning', 'Box 1–2'],
  ['mastered', 'Mastered', 'Box 3+'],
];

export async function render(page) {
  const d = await get('dashboard');
  const c = d.counts;

  page.append(h('header', { class: 'page-head' },
    h('div', {},
      h('h1', { text: 'Understanding' }),
      h('p', { class: 'sub' },
        d.goal ? ['Studying for ', h('b', { text: d.goal }), '. '] : null,
        'What you can recall, what is still shaky, and how your review went.',
        d.goal ? null : [' ', h('a', { href: '#/settings', text: 'Set a study goal' })])),
    h('div', { class: 'head-actions' }, h('a', { class: 'btn btn-primary', href: '#/session', text: 'Start a session' }))));

  if (!c.approved && !c.pending) {
    page.append(h('div', { class: 'card empty' }, h('h2', { text: 'No data yet' }),
      h('p', { text: 'Add notes and approve a few drafts. This page then shows what you have mastered and what needs another look.' }),
      h('a', { class: 'btn btn-primary', href: '#/add', text: 'Add notes' })));
    return;
  }

  const pct = c.cards ? Math.round((c.mastered / c.cards) * 100) : 0;
  page.append(h('section', { class: 'card hero' },
    h('div', {},
      h('div', { class: 'hero-figure' }, String(c.mastered), h('small', { text: ` of ${plural(c.cards, 'card')} mastered` })),
      h('p', { class: 'muted small', text: `Mastered means you recalled it correctly on reviews spread over several days (Leitner box ${d.mastered_box} or higher).` })),
    h('div', { class: 'meter', role: 'img', 'aria-label': `${pct}% mastered` }, h('span', { style: { width: `${pct}%` } }))));

  const acc = d.accuracy.answers ? `${Math.round((d.accuracy.right / d.accuracy.answers) * 100)}%` : '—';
  page.append(h('div', { class: 'tiles' },
    tile('In your library', String(c.approved), `${c.studied} studied so far`),
    linkTile('Waiting for review', String(c.pending), c.pending ? '#/queue' : null, c.pending ? 'Open the queue' : 'Queue is clear'),
    linkTile('Due now', String(c.due), c.due ? '#/flashcards' : null, c.due ? 'Study them' : 'Nothing due'),
    tile('Recall accuracy', acc, d.accuracy.answers ? `${d.accuracy.answers} answers, last 30 days` : 'no answers yet')));

  page.append(h('div', { class: 'grid-2' }, activityCard(d.activity), masteryCard(d)));
  page.append(reviewCard(d));
  page.append(h('div', { class: 'grid-2' }, weakCard(d.weakest), questionsCard(d.questions)));
}

function tile(label, value, note) {
  return h('div', { class: 'tile' }, h('div', { class: 'label', text: label }), h('div', { class: 'value', text: value }), note ? h('div', { class: 'note', text: note }) : null);
}

function linkTile(label, value, href, note) {
  return h('div', { class: 'tile' }, h('div', { class: 'label', text: label }), h('div', { class: 'value', text: value }),
    h('div', { class: 'note' }, href ? h('a', { href, text: note }) : note));
}

// ---------- activity: answers per day, last 14 days (single series → one hue) ----------

function activityCard(timestamps) {
  const days = [];
  const counts = new Map();
  for (const ts of timestamps) {
    const key = new Date(ts).toLocaleDateString('en-CA');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (let i = 13; i >= 0; i--) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - i);
    days.push({ date, n: counts.get(date.toLocaleDateString('en-CA')) ?? 0 });
  }
  const total = days.reduce((s, d) => s + d.n, 0);
  const top = niceTop(Math.max(...days.map((d) => d.n)));
  const ticks = [0, top / 2, top];

  const plot = h('div', { class: 'plot' });
  for (const t of ticks.slice(1)) plot.append(h('div', { class: 'gridline', style: { bottom: `${(t / top) * 100}%` } }));
  for (const d of days) {
    const label = d.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    const col = h('div', { class: 'col', tabindex: '0', role: 'img', 'aria-label': `${label}: ${plural(d.n, 'answer')}` },
      h('div', { class: 'bar', style: { height: `${(d.n / top) * 100}%` } }));
    withTip(col, plural(d.n, 'answer'), label);
    plot.append(col);
  }

  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', { text: 'Study activity' }), h('span', { class: 'muted small', text: `${plural(total, 'answer')} in the last 14 days` })),
    h('div', { class: 'chart colchart' },
      h('div', { class: 'yaxis', 'aria-hidden': 'true' }, ticks.map((t) => h('span', { style: { bottom: `${(t / top) * 100}%` }, text: String(t) }))),
      plot,
      h('div', { class: 'xaxis', 'aria-hidden': 'true' }, days.map((d) => h('span', { text: String(d.date.getDate()) })))),
    tableView(['Day', 'Answers'], days.map((d) => [d.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }), d.n])));
}

/** A clean axis maximum: 2 × the smallest 1/2/5 step that covers half the peak. */
function niceTop(max) {
  if (max <= 4) return 4;
  const half = max / 2;
  const pow = 10 ** Math.floor(Math.log10(half));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= half);
  return step * 2;
}

// ---------- mastery by topic / source (ordered states → one-hue ordinal ramp) ----------

function masteryCard(d) {
  const groups = {
    topic: d.by_tag.map((r) => ({ ...r, href: `#/library?tag=${encodeURIComponent(r.label)}` })),
    source: d.by_source.map((r) => ({ ...r, href: `#/library?source_id=${r.source_id}` })),
  };
  let current = groups.topic.length ? 'topic' : 'source';
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Group mastery by' });
  const body = h('div');

  const draw = () => {
    tabs.replaceChildren(...[['topic', 'By topic'], ['source', 'By source']].map(([k, label]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(current === k), text: label,
      on: { click: () => { current = k; draw(); } },
    })));
    const rows = groups[current].map((r) => ({ ...r, new: r.total - r.mastered - r.learning }));
    body.replaceChildren(rows.length ? stackChart(rows) : h('p', { class: 'muted', text: current === 'topic' ? 'Tag your items to see mastery by topic.' : 'No approved cards yet.' }));
  };
  draw();

  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', { text: 'Mastery' }), tabs),
    body);
}

function stackChart(rows) {
  const legend = h('div', { class: 'legend', style: { marginBottom: '12px' } },
    STATES.map(([, label, note], i) => h('span', {}, h('span', { class: `sw seg-${i}` }), `${label} `, h('span', { class: 'muted', text: `(${note})` }))));
  const chart = h('div', { class: 'stackchart' }, rows.map((r) => {
    const track = h('div', { class: 'track' });
    STATES.forEach(([key, label], i) => {
      const v = r[key];
      if (!v) return;
      const seg = h('div', { class: `seg seg-${i}`, tabindex: '0', role: 'img', 'aria-label': `${r.label}: ${label} ${v} of ${r.total}`, style: { flex: `${v} 1 0` } });
      withTip(seg, `${v} of ${r.total}`, `${label} · ${r.label}`);
      track.append(seg);
    });
    return h('div', { class: 'stackrow' },
      h('a', { class: 'lbl', href: r.href, title: r.label, text: r.label }),
      track,
      h('span', { class: 'tot', text: plural(r.total, 'card') }));
  }));
  return h('div', {}, legend, chart,
    tableView(['Group', 'New', 'Learning', 'Mastered', 'Total'], rows.map((r) => [r.label, r.new, r.learning, r.mastered, r.total])));
}

// ---------- the review queue's story ----------

function reviewCard(d) {
  const r = d.review;
  const g = d.grounding;
  const approved = r.approved + r.approved_edited;
  const decided = approved + r.discarded + r.merged;
  const excerpts = g.exact + g.close + g.missing;
  return h('section', { class: 'card stack' },
    h('div', { class: 'card-head' }, h('h2', { text: 'How the review queue went' }),
      h('span', { class: 'muted small', text: `${plural(decided, 'decision')} so far` })),
    decided ? h('p', { text: `You approved ${plural(approved, 'draft')}${r.approved_edited ? ` (${r.approved_edited} only after correcting ${r.approved_edited === 1 ? 'it' : 'them'})` : ' as written'}, discarded ${r.discarded} and merged ${r.merged}.` }) : h('p', { class: 'muted', text: 'Decisions you make in the review queue are summarised here.' }),
    h('div', { class: 'tiles tiles-inset' },
      tile('Approved as drafted', String(r.approved)),
      tile('Edited, then approved', String(r.approved_edited)),
      tile('Discarded', String(r.discarded)),
      tile('Merged', String(r.merged))),
    excerpts ? h('p', { class: 'muted small' },
      `Of ${plural(excerpts, 'excerpt')} behind your drafts and cards, ${g.exact} matched your notes word for word`,
      g.close ? `, ${g.close} only approximately` : '',
      g.missing ? `, and ${g.missing} could not be found in your notes at all` : '', '.') : null);
}

function weakCard(rows) {
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', { text: 'Weak spots' }), rows.length ? h('a', { class: 'small', href: '#/library?sort=weakest', text: 'See all' }) : null),
    rows.length
      ? h('ul', { class: 'list-plain' }, rows.map((r) => h('li', {},
        h('a', { href: `#/item/${r.id}`, text: r.title }),
        h('span', { class: 'muted small nowrap', text: `${r.times_wrong} missed · ${r.times_right} right` }))))
      : h('p', { class: 'muted', text: 'Cards you miss will show up here.' }));
}

function questionsCard(rows) {
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', { text: 'Questions to investigate' })),
    rows.length
      ? h('ul', { class: 'list-plain' }, rows.map((r) => h('li', {}, h('a', { href: `#/item/${r.id}`, text: r.title }), kindBadge('question'))))
      : h('p', { class: 'muted', text: 'Open questions you approve from your notes are collected here.' }));
}

function tableView(headers, rows) {
  return h('details', { class: 'table-view' },
    h('summary', { text: 'Show as a table' }),
    h('table', { class: 'data-table' },
      h('thead', {}, h('tr', {}, headers.map((t) => h('th', { text: t })))),
      h('tbody', {}, rows.map((r) => h('tr', {}, r.map((v) => h('td', { text: String(v) })))))));
}

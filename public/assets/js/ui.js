// DOM helpers. All text goes in through textContent / text nodes — notes are untrusted data.

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'indeterminate', 'multiple', 'required']);

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  setProps(el, props);
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) if (v != null) el.setAttribute(k, v);
  append(el, children);
  return el;
}

function setProps(el, props) {
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') Object.assign(el.style, v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/**
 * Replaces an element's children, skipping null/false like h() does
 * (the DOM's own replaceChildren/append would insert the text "null").
 */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// ---------- feedback ----------

export function toast(message, { kind = 'info', action, onAction, timeout = 4500 } = {}) {
  const host = document.querySelector('.toasts');
  const el = h('div', { class: `toast${kind === 'error' ? ' error' : ''}`, role: kind === 'error' ? 'alert' : 'status' }, h('span', { text: message }));
  if (action) {
    el.append(h('button', { type: 'button', text: action, on: { click: () => { el.remove(); onAction?.(); } } }));
  }
  host.append(el);
  setTimeout(() => el.remove(), timeout);
}

export function toastError(err) {
  toast(err?.message ?? String(err), { kind: 'error', timeout: 7000 });
}

/** A modal dialog. `body` is a node; `actions` render right-aligned. Returns { close }. */
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const previous = document.activeElement;
  const backdrop = h('div', { class: 'modal-backdrop' });
  const box = h('div', { class: `modal${wide ? ' modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h2', { text: title }), body,
    actions.length ? h('div', { class: 'modal-actions' }, actions) : null);
  backdrop.append(box);
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
    previous?.focus?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(backdrop);
  (box.querySelector('input, textarea, select, button.btn-primary') ?? box.querySelector('button'))?.focus();
  return { close, el: box };
}

export function confirmDialog({ title, message, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; m.close(); resolve(v); } };
    const m = modal({
      title,
      body: h('p', { class: 'muted', text: message }),
      actions: [
        h('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => finish(false) } }),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', text: confirm, on: { click: () => finish(true) } }),
      ],
      onClose: () => { if (!done) { done = true; resolve(false); } },
    });
  });
}

// ---------- formatting ----------

export const KINDS = {
  concept: 'Concept',
  term: 'Term',
  system: 'System',
  process: 'Process',
  howto: 'How-to',
  question: 'Open question',
};

export function kindBadge(kind) {
  return h('span', { class: 'badge', text: KINDS[kind] ?? kind });
}

export function statusBadge(status) {
  const map = {
    pending: ['badge-warn', 'Waiting for review'],
    approved: ['badge-ok', 'In your library'],
    discarded: ['', 'Discarded'],
    merged: ['', 'Merged'],
  };
  const [cls, label] = map[status] ?? ['', status];
  return h('span', { class: `badge ${cls}`, text: label });
}

export function originLabel(item) {
  if (item.origin === 'claude') return `Drafted by Claude${item.model ? ` (${item.model})` : ''}`;
  if (item.origin === 'local') return 'Drafted by the offline extractor';
  return 'Written by you';
}

export function fmtDate(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, opts);
}

export function fmtDue(iso) {
  if (!iso) return 'new';
  const days = Math.round((new Date(iso) - Date.now()) / 86400000);
  if (days <= 0) return 'due now';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function boxes(box) {
  return h('span', { class: 'boxes', title: `Box ${box} of 5`, 'aria-label': `Box ${box} of 5` },
    [1, 2, 3, 4, 5].map((n) => h('i', { class: n <= box ? 'on' : '' })));
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Grows a textarea to fit its content. */
export function autosize(textarea) {
  const fit = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  };
  textarea.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return textarea;
}

// ---------- the learner's own words ----------

/** Light clean-up of markdown so notes read naturally: headings lose '#', bullets become '•'. */
export function cleanMd(s) {
  return (s ?? '').replace(/^#{1,6}[ \t]+/gm, '').replace(/^[ \t]*[-*+][ \t]+/gm, '• ');
}

const MATCH = {
  exact: ['badge-ok', '✓', 'Exact quote from your notes'],
  close: ['badge-warn', '≈', 'Closest sentence in your notes'],
  missing: ['badge-bad', '!', 'Not found in your notes'],
};

export function matchBadge(match) {
  const [cls, icon, label] = MATCH[match] ?? MATCH.missing;
  return h('span', { class: `badge ${cls}` }, h('span', { class: 'icon', 'aria-hidden': 'true', text: icon }), label);
}

/**
 * The excerpt an item came from, shown inside its surrounding text with the quoted part marked.
 * When the draft's quote did not match the notes, both the closest real sentence and the
 * draft's claimed quote are shown, so the reviewer can see the difference.
 */
export function excerptBlock(x, { link = true } = {}) {
  const block = h('div', { class: 'excerpt-block' });
  block.append(h('div', { class: 'excerpt-src' },
    matchBadge(x.match),
    x.source_title ? h('span', { text: x.source_title }) : null,
    link && x.source_id ? h('a', { href: `#/source/${x.source_id}?excerpt=${x.id}`, text: 'Show in source' }) : null));

  if (x.match === 'missing') {
    block.append(h('p', { class: 'notice notice-warn', text: 'The draft quoted a passage that does not appear in your notes. Treat every claim in this item as unverified.' }));
    if (x.quoted) block.append(h('blockquote', { class: 'quote quote-sm' }, `“${x.quoted}”`));
    return block;
  }

  const c = x.context;
  const q = h('blockquote', { class: 'excerpt' });
  if (c) {
    if (c.cut_before) q.append(h('span', { class: 'ctx', text: '… ' }));
    q.append(h('span', { class: 'ctx', text: cleanMd(c.before) }));
    q.append(h('mark', { text: cleanMd(c.text) }));
    q.append(h('span', { class: 'ctx', text: cleanMd(c.after) }));
    if (c.cut_after) q.append(h('span', { class: 'ctx', text: ' …' }));
  } else {
    q.append(h('mark', { text: cleanMd(x.text) }));
  }
  block.append(q);
  if (x.match === 'close' && x.quoted) {
    block.append(h('details', { class: 'quoted' },
      h('summary', { text: 'The draft’s quote was not word-for-word — compare' }),
      h('blockquote', { class: 'quote quote-sm' }, `Draft quoted: “${x.quoted}”`)));
  }
  return block;
}

// Words that carry no claim of their own (plus the scaffolding of generated questions).
const STOP = new Set(('a an the and or but nor of to in on at for by with as is are was were be been being it its this that these those ' +
  'from into than then so not no do does did can could will would should may might must there their they them you your we our ' +
  'i me my he she his her what which who whom whose how why when where while about also just very more most some any each every ' +
  'such only other own same too has have had having one two if else above below up down out off over under again further once ' +
  'meant mean means describe describes defined define refer refers called explain steps step answer question true false notes').split(' '));

function stem(w) {
  for (const suffix of ['ing', 'ed', 'es', 's', 'ly']) {
    if (w.length > suffix.length + 3 && w.endsWith(suffix)) return w.slice(0, -suffix.length);
  }
  return w;
}

function words(text) {
  return (text ?? '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
}

/**
 * Words in `text` that appear nowhere in `reference` (the excerpt and the sentences around it).
 * This is how an added cause, date or name gets noticed: "Rome fell in 476 AD because of
 * barbarian invasions" against a note that only says "Rome fell in 476 AD."
 */
export function novelWords(text, reference) {
  const known = new Set(words(reference).flatMap((w) => [w, stem(w), ...w.split(/[-'’]/).map(stem)]));
  const seen = new Set();
  const out = [];
  for (const raw of words(text)) {
    const w = raw.replace(/['’]s$/, '');
    if (w.length < 3 || STOP.has(w) || /^\d{1,2}$/.test(w)) continue;
    const s = stem(w);
    if (known.has(w) || known.has(s) || seen.has(s)) continue;
    if (w.includes('-') && w.split('-').every((p) => known.has(stem(p)) || STOP.has(p))) continue;
    seen.add(s);
    out.push(w);
  }
  return out;
}

/** Reference text for the novelty check: every excerpt of the item plus its surrounding sentences. */
export function referenceText(item) {
  return (item.excerpts ?? []).map((x) => [x.context?.before, x.context?.text ?? x.text, x.context?.after].join(' ')).join(' ');
}

/** A live "words not in your notes" warning bound to an input. */
export function noveltyHint(input, getReference, { label = 'Not in your notes nearby:' } = {}) {
  const hint = h('div', { class: 'novel', 'aria-live': 'polite' });
  const update = () => {
    const extra = novelWords(input.value, getReference());
    hint.replaceChildren();
    hint.hidden = extra.length === 0;
    if (extra.length) {
      hint.append(h('b', { text: label }));
      for (const w of extra.slice(0, 12)) hint.append(h('span', { class: 'word', text: w }));
      if (extra.length > 12) hint.append(h('span', { text: `+${extra.length - 12} more` }));
    }
  };
  input.addEventListener('input', update);
  update();
  return hint;
}

// ---------- tags ----------

export function tagInput(initial, onChange) {
  let tags = [...initial];
  const input = h('input', { type: 'text', placeholder: 'Add a tag…', 'aria-label': 'Add a tag' });
  const wrap = h('div', { class: 'chip-input', on: { click: () => input.focus() } });
  const render = () => {
    wrap.replaceChildren(
      ...tags.map((t) => h('span', { class: 'chip' }, t,
        h('button', { type: 'button', 'aria-label': `Remove tag ${t}`, text: '×', on: { click: (e) => { e.stopPropagation(); tags = tags.filter((x) => x !== t); render(); onChange?.(tags); } } }))),
      input);
  };
  const add = () => {
    const parts = input.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    let changed = false;
    for (const t of parts) {
      if (!tags.includes(t) && tags.length < 6) { tags.push(t.slice(0, 40)); changed = true; }
    }
    input.value = '';
    if (changed) { render(); onChange?.(tags); input.focus(); }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
    else if (e.key === 'Backspace' && input.value === '' && tags.length) { tags.pop(); render(); onChange?.(tags); input.focus(); }
  });
  input.addEventListener('blur', add);
  render();
  return { el: wrap, get: () => (input.value.trim() ? (add(), tags) : tags) };
}

// ---------- shared tooltip for charts ----------

let tip;
export function showTip(target, value, label) {
  tip ??= document.body.appendChild(h('div', { class: 'tooltip', role: 'tooltip' }));
  tip.replaceChildren(h('strong', { text: value }), h('span', { text: label }));
  tip.hidden = false;
  const r = target.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2));
  const top = r.top - t.height - 8 < 8 ? r.bottom + 8 : r.top - t.height - 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
export function hideTip() {
  if (tip) tip.hidden = true;
}
export function withTip(el, value, label) {
  const show = () => showTip(el, value, label);
  el.addEventListener('pointerenter', show);
  el.addEventListener('focus', show);
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('blur', hideTip);
  return el;
}

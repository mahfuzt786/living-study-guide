// Sources: adding notes, drafting items from them, and reading them with every used sentence highlighted.

import { get, post } from '../api.js';
import { h, fill, toast, toastError, confirmDialog, modal, autosize, debounce, fmtDate, plural } from '../ui.js';
import { itemEditor } from '../editor.js';
import { app, refreshState } from '../state.js';

const MAX_CHARS = 400000;

// ---------- add notes ----------

export async function renderAdd(page, { query, onLeave }) {
  page.classList.add('page-narrow');
  const state = app.state ?? (await refreshState());
  const claude = Boolean(state?.ai?.claude);

  const title = h('input', { type: 'text', required: true, maxlength: 160, placeholder: 'e.g. Lecture 4 — Cell respiration', 'aria-label': 'Title' });
  const topic = h('input', { type: 'text', maxlength: 120, value: state?.goal?.subject ?? '', placeholder: 'e.g. BIO 101', 'aria-label': 'Course or topic' });
  const notes = h('textarea', { class: 'notes-input', placeholder: 'Paste your notes, a lecture transcript or a chapter summary…', 'aria-label': 'Notes' });
  const counter = h('span', { class: 'drop-hint' });
  const file = h('input', { type: 'file', accept: '.txt,.md,.markdown,.text,.vtt,.srt', 'aria-label': 'Upload a text file' });
  const allowed = h('input', { type: 'checkbox', required: true });
  const modeClaude = h('input', { type: 'radio', name: 'mode', value: 'claude', checked: claude, disabled: !claude });
  const modeLocal = h('input', { type: 'radio', name: 'mode', value: 'local', checked: !claude });
  const submit = h('button', { class: 'btn btn-primary btn-lg', type: 'submit', text: 'Create drafts for review' });
  const output = h('div', { class: 'stack' });

  const updateCounter = () => {
    const n = notes.value.length;
    counter.textContent = n ? `${n.toLocaleString()} characters${n > MAX_CHARS ? ' — too long, split it into parts' : ''}` : 'Plain text or Markdown. PDFs and Word files: copy the text and paste it here.';
  };
  notes.addEventListener('input', updateCounter);
  updateCounter();

  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) return toast('That file is larger than 4 MB. Split it into smaller parts.', { kind: 'error' });
    let text = await f.text();
    if (/\.(vtt|srt)$/i.test(f.name)) text = cleanTranscript(text);
    notes.value = text;
    if (!title.value.trim()) title.value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    updateCounter();
  });

  const form = h('form', { class: 'card stack', on: { submit: onSubmit } },
    h('div', { class: 'grid-2' },
      h('label', { class: 'field' }, h('span', { text: 'Title' }), title),
      h('label', { class: 'field' }, h('span', { text: 'Course or topic (optional)' }), topic)),
    h('label', { class: 'field' }, h('span', { text: 'Your notes' }), notes),
    h('div', { class: 'row-between' }, counter,
      h('button', { class: 'btn btn-sm', type: 'button', text: 'Upload .txt, .md or a transcript', on: { click: () => file.click() } }), file),
    h('div', { class: 'field' },
      h('span', { text: 'Who drafts the study items?' }),
      h('div', { class: 'radio-cards' },
        h('label', { class: 'radio-card' }, modeClaude, h('span', {},
          h('b', { text: 'Claude' }),
          h('span', { class: 'small muted', text: claude
            ? `${state.ai.model} writes cards and quiz questions from your notes, quoting the sentence each one came from.`
            : 'Add ANTHROPIC_API_KEY to the .env file to enable this.' }))),
        h('label', { class: 'radio-card' }, modeLocal, h('span', {},
          h('b', { text: 'Offline extractor' }),
          h('span', { class: 'small muted', text: 'No AI. Turns definitions, dated facts, steps and questions in your own sentences into cards.' }))))),
    h('label', { class: 'checkbox' }, allowed, h('span', {},
      h('b', { text: 'I’m allowed to use this material here. ' }),
      'Your own notes, your own recordings, public papers or government documents are safe. A course reading licensed to you alone, or work material your employer would not want in a personal app, is not.')),
    h('div', { class: 'row' }, submit, h('span', { class: 'muted small', text: 'Every draft goes to the review queue first.' })));
  file.hidden = true;

  page.append(
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', { text: 'Add notes' }),
        h('p', { class: 'sub', text: 'Pick one real thing you want to study or search later — class notes, a lecture transcript, a chapter, meeting notes.' })),
      h('div', { class: 'head-actions' }, h('button', { class: 'btn', type: 'button', text: 'Load demo notes', on: { click: loadDemo } }))),
    form,
    output);

  const busy = (on) => { submit.disabled = on; };

  async function onSubmit(e) {
    e.preventDefault();
    if (!allowed.checked) return toast('Confirm that you are allowed to use this material first.', { kind: 'error' });
    if (notes.value.length > MAX_CHARS) return toast('That is too long for one source. Split it into parts.', { kind: 'error' });
    busy(true);
    try {
      const source = await post('source.create', { title: title.value, topic: topic.value, content: notes.value });
      form.hidden = true;
      await runExtraction(source, modeClaude.checked ? 'claude' : 'local', output);
    } catch (err) {
      toastError(err);
    } finally {
      busy(false);
    }
  }

  async function loadDemo() {
    busy(true);
    try {
      const source = await post('source.demo', {});
      form.hidden = true;
      await runExtraction(source, claude ? 'claude' : 'local', output);
    } catch (err) {
      toastError(err);
    } finally {
      busy(false);
    }
  }

  if (query.get('demo') === '1') loadDemo();
  onLeave(() => { /* extraction keeps running server-side per part; nothing to clean up */ });
}

/** Strips cue numbers and timestamps from .vtt/.srt captions and joins the text into paragraphs. */
export function cleanTranscript(text) {
  const lines = text.replace(/\r/g, '').split('\n')
    .filter((l) => !/^\s*(WEBVTT|NOTE\b|\d+\s*$|\d{1,2}:\d{2}(:\d{2})?[.,]\d{3}\s*-->)/.test(l))
    .map((l) => l.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
  const merged = [];
  for (const l of lines) if (merged[merged.length - 1] !== l) merged.push(l);
  const sentences = merged.join(' ').split(/(?<=[.!?])\s+/);
  const paragraphs = [];
  for (let i = 0; i < sentences.length; i += 6) paragraphs.push(sentences.slice(i, i + 6).join(' '));
  return paragraphs.join('\n\n');
}

/**
 * Drafts items for a source one part at a time, showing progress, and offers a retry
 * (or the offline extractor) if a part fails.
 */
export async function runExtraction(source, mode, host) {
  const bar = h('span', { style: { width: '0%' } });
  const log = h('ul', { class: 'run-log' });
  const status = h('p', { class: 'muted small' });
  const actions = h('div', { class: 'row' });
  const card = h('section', { class: 'card stack', 'aria-live': 'polite' },
    h('h2', { text: `Drafting study items from “${source.title}”` }),
    h('div', { class: 'progress' }, bar),
    status, log, actions);
  host.replaceChildren(card);

  const parts = source.chunk_count;
  let created = 0;
  let skipped = 0;

  const runFrom = async (start, currentMode) => {
    actions.replaceChildren();
    for (let i = start; i < parts; i++) {
      const started = Date.now();
      const tick = () => {
        const secs = Math.round((Date.now() - started) / 1000);
        status.textContent = currentMode === 'claude'
          ? `Claude is reading part ${i + 1} of ${parts}… ${secs}s (a part can take a minute or two)`
          : `Reading part ${i + 1} of ${parts}…`;
      };
      tick();
      const timer = setInterval(tick, 1000);
      try {
        const r = await post('source.extract', { id: source.id, chunk: i, mode: currentMode });
        created += r.created;
        skipped += r.skipped;
        log.append(h('li', {}, h('span', { class: 'ok', 'aria-hidden': 'true', text: '✓' }),
          h('span', { text: `Part ${i + 1} of ${parts}: ${plural(r.created, 'new draft')}${r.skipped ? `, ${r.skipped} already drafted before` : ''}` })));
        bar.style.width = `${Math.round(((i + 1) / parts) * 100)}%`;
      } catch (err) {
        clearInterval(timer);
        status.textContent = '';
        log.append(h('li', {}, h('span', { class: 'err', 'aria-hidden': 'true', text: '!' }), h('span', { text: `Part ${i + 1}: ${err.message}` })));
        fill(actions,
          h('button', { class: 'btn btn-primary', type: 'button', text: 'Retry', on: { click: () => runFrom(i, currentMode) } }),
          currentMode === 'claude' ? h('button', { class: 'btn', type: 'button', text: 'Use the offline extractor for the rest', on: { click: () => runFrom(i, 'local') } }) : null,
          created ? h('a', { class: 'btn', href: `#/queue?source_id=${source.id}`, text: 'Review what was drafted' }) : null);
        refreshState();
        return;
      }
      clearInterval(timer);
    }
    status.textContent = '';
    await refreshState();
    card.append(h('div', { class: created ? 'notice notice-ok' : 'notice' },
      created
        ? `${plural(created, 'draft')} are waiting in your review queue. Each one sits beside the sentence it came from.`
        : `No new drafts${skipped ? ' — everything in these notes was drafted before' : '. The notes may be too short, or the offline extractor found no definitions, dates, steps or questions'}.`));
    fill(actions,
      created ? h('a', { class: 'btn btn-primary', href: `#/queue?source_id=${source.id}`, text: 'Start reviewing' }) : null,
      h('a', { class: 'btn', href: `#/source/${source.id}`, text: 'Open the source' }),
      h('a', { class: 'btn btn-ghost', href: '#/add', text: 'Add more notes', on: { click: () => { if (location.hash === '#/add') location.reload(); } } }));
    if (created) toast(`${plural(created, 'draft')} ready for review.`);
  };

  await runFrom(0, mode);
}

// ---------- list ----------

export async function renderSources(page) {
  const sources = await get('sources');
  page.append(h('header', { class: 'page-head' },
    h('div', {}, h('h1', { text: 'Sources' }), h('p', { class: 'sub', text: 'The notes your study guide is built from. Open one to see which sentences your cards came from.' })),
    h('div', { class: 'head-actions' }, h('a', { class: 'btn btn-primary', href: '#/add', text: 'Add notes' }))));

  if (!sources.length) {
    page.append(h('div', { class: 'card empty' }, h('h2', { text: 'No sources yet' }),
      h('p', { text: 'Add notes you are allowed to use, or try the demo notes first.' }),
      h('div', { class: 'row' }, h('a', { class: 'btn btn-primary', href: '#/add', text: 'Add notes' }), h('a', { class: 'btn', href: '#/add?demo=1', text: 'Try the demo notes' }))));
    return;
  }

  page.append(h('div', { class: 'item-list' }, sources.map((s) => h('div', { class: 'card stack' },
    h('div', { class: 'row-between' },
      h('div', {}, h('h2', {}, h('a', { href: `#/source/${s.id}`, text: s.title })),
        h('p', { class: 'muted small', text: [s.topic, `added ${fmtDate(s.created_at)}`, `${s.chars.toLocaleString()} characters`, s.extractor ? `drafted by ${s.extractor === 'claude' ? 'Claude' : 'the offline extractor'}` : null].filter(Boolean).join(' · ') })),
      h('div', { class: 'row' },
        s.pending ? h('a', { class: 'btn btn-primary btn-sm', href: `#/queue?source_id=${s.id}`, text: `Review ${s.pending}` }) : null,
        h('a', { class: 'btn btn-sm', href: `#/source/${s.id}`, text: 'Open' }))),
    h('div', { class: 'row small' },
      h('span', { class: 'badge badge-ok', text: `${s.approved} approved` }),
      h('span', { class: 'badge badge-warn', text: `${s.pending} waiting` }),
      h('span', { class: 'badge', text: `${s.discarded} discarded` }),
      s.chunks_done < s.chunk_count ? h('span', { class: 'badge badge-bad', text: `drafting stopped at part ${s.chunks_done + 1} of ${s.chunk_count}` }) : null)))));
}

// ---------- one source, with highlights ----------

export async function renderSource(page, { params, query, onLeave }) {
  const s = await get('source', { id: params[0] });
  const claude = Boolean(app.state?.ai?.claude);
  const textEl = h('div', { class: 'source-text' });
  const output = h('div', { class: 'stack' });
  let popover = null;

  const closePopover = () => { popover?.remove(); popover = null; };
  const onDocClick = (e) => { if (popover && !popover.contains(e.target) && !e.target.closest('.hl')) closePopover(); };
  const onKey = (e) => { if (e.key === 'Escape') closePopover(); };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
  onLeave(() => { closePopover(); document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKey); });

  const lineState = { lineStart: true };
  let target = null;
  const wanted = Number(query.get('excerpt') ?? 0);
  for (const seg of s.segments) {
    if (!seg.items.length) {
      renderText(textEl, seg.text, lineState);
      continue;
    }
    const approved = seg.items.some((i) => i.status === 'approved');
    const span = h('span', {
      class: `hl ${approved ? 'hl-approved' : 'hl-pending'}`, tabindex: '0', role: 'button',
      'aria-label': `Used by ${plural(seg.items.length, 'item')}`,
    });
    renderText(span, seg.text, lineState);
    // A click that ends a text selection is for making a card, not for the popover.
    const open = () => { if (window.getSelection()?.isCollapsed !== false) showPopover(span, seg.items); };
    span.addEventListener('click', open);
    span.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    textEl.append(span);
    if (wanted && !target && seg.excerpts.includes(wanted)) target = span;
  }

  function showPopover(anchor, items) {
    closePopover();
    popover = h('div', { class: 'popover', role: 'dialog', 'aria-label': 'Items from this passage' },
      h('b', { text: items.length === 1 ? 'Used by this item' : `Used by ${items.length} items` }),
      h('ul', {}, items.map((i) => h('li', {},
        h('a', { href: i.status === 'pending' ? `#/queue?item=${i.id}` : `#/item/${i.id}`, text: i.title }),
        h('span', { class: 'muted small', text: i.status === 'pending' ? ' — waiting for review' : ' — in your library' })))));
    document.body.append(popover);
    const r = anchor.getBoundingClientRect();
    const p = popover.getBoundingClientRect();
    popover.style.left = `${Math.max(8, Math.min(window.innerWidth - p.width - 8, r.left))}px`;
    popover.style.top = `${r.bottom + 6 + p.height > window.innerHeight ? r.top - p.height - 6 : r.bottom + 6}px`;
  }

  // ---- make a card from any passage the learner selects ----

  const makeBtn = h('button', { class: 'btn btn-primary btn-sm make-card', type: 'button', hidden: true }, '+ Make a card');
  document.body.append(makeBtn);

  const selectionInNotes = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!textEl.contains(range.commonAncestorContainer)) return null;
    const text = cleanSelection(sel.toString());
    return text.length >= 3 ? { text, rect: range.getBoundingClientRect() } : null;
  };
  const placeMakeBtn = () => {
    const found = selectionInNotes();
    makeBtn.hidden = !found;
    if (!found) return;
    const b = makeBtn.getBoundingClientRect();
    // Touch screens show their own menu above a selection, so the button goes below it there.
    const below = window.matchMedia('(pointer: coarse)').matches || found.rect.top - b.height - 10 < 8;
    const top = below ? found.rect.bottom + 10 : found.rect.top - b.height - 10;
    makeBtn.style.top = `${Math.max(8, Math.min(window.innerHeight - b.height - 8, top))}px`;
    makeBtn.style.left = `${Math.max(8, Math.min(window.innerWidth - b.width - 8, found.rect.left + found.rect.width / 2 - b.width / 2))}px`;
  };
  const onSelection = debounce(placeMakeBtn, 120);
  document.addEventListener('selectionchange', onSelection);
  window.addEventListener('scroll', placeMakeBtn, { passive: true });
  makeBtn.addEventListener('mousedown', (e) => e.preventDefault()); // pressing the button keeps the selection
  makeBtn.addEventListener('click', () => openCardModal(selectionInNotes()?.text ?? ''));
  onLeave(() => {
    makeBtn.remove();
    document.removeEventListener('selectionchange', onSelection);
    window.removeEventListener('scroll', placeMakeBtn);
  });

  function openCardModal(passage) {
    makeBtn.hidden = true;
    const excerptInput = autosize(h('textarea', { class: 'read', rows: 2, value: passage, 'aria-label': 'Passage from your notes' }));
    const blank = {
      kind: 'concept', title: '', statement: passage, interpretation: '', card_front: '', card_back: '',
      steps: [], tags: [], origin: 'manual', draft: null,
      // The novelty check compares the card with whatever passage is in the box right now.
      excerpts: [{ get text() { return excerptInput.value; }, context: null }],
    };
    const editor = itemEditor(blank);
    const save = h('button', { class: 'btn btn-primary', type: 'button', text: 'Add to library' });
    const m = modal({
      title: 'Make a card from your notes',
      wide: true,
      body: h('div', { class: 'stack' },
        h('label', { class: 'field' },
          h('span', {}, 'From your notes ', h('span', { class: 'help', text: '— the passage this card is based on. Select it in the notes, or paste it here.' })),
          excerptInput),
        editor.el),
      actions: [h('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => m.close() } }), save],
    });
    (passage ? m.el.querySelector('input[aria-label="Title"]') : excerptInput)?.focus();

    save.addEventListener('click', async () => {
      const fields = editor.getFields();
      if (!excerptInput.value.trim()) return toast('Add the passage from your notes that the card is based on.', { kind: 'error' });
      if (!fields.title) return toast('Give the card a title.', { kind: 'error' });
      if (fields.kind !== 'question' && (!fields.card_front || !fields.card_back)) {
        return toast('Fill in both sides of the flashcard, or change the kind to “Open question”.', { kind: 'error' });
      }
      save.disabled = true;
      try {
        const item = await post('item.create', { source_id: s.id, excerpt: excerptInput.value, fields });
        m.close();
        window.getSelection()?.removeAllRanges();
        toast(`Added “${item.title}” to your library.`, { action: 'Open it', onAction: () => { location.hash = `#/item/${item.id}`; } });
        location.hash = `#/source/${s.id}?excerpt=${item.excerpts[0]?.id ?? ''}`;
      } catch (err) {
        toastError(err);
        save.disabled = false;
      }
    });
  }

  page.append(
    h('a', { class: 'back-link', href: '#/sources', text: '← Sources' }),
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', { text: s.title }),
        h('p', { class: 'sub', text: [s.topic, `added ${fmtDate(s.created_at)}`, `${s.approved} approved · ${s.pending} waiting · ${s.discarded} discarded`].filter(Boolean).join(' · ') })),
      h('div', { class: 'head-actions' },
        s.pending ? h('a', { class: 'btn btn-primary', href: `#/queue?source_id=${s.id}`, text: `Review ${s.pending} drafts` }) : null,
        h('button', { class: 'btn', type: 'button', text: 'Make a card', on: { mousedown: (e) => e.preventDefault(), click: () => openCardModal(selectionInNotes()?.text ?? '') } }),
        h('button', { class: 'btn', type: 'button', text: 'Draft more items', on: { click: () => runExtraction(s, claude ? 'claude' : 'local', output) } }),
        h('button', { class: 'btn btn-danger', type: 'button', text: 'Delete', on: { click: remove } }))),
    output,
    h('div', { class: 'legend' },
      h('span', {}, h('span', { class: 'sw sw-approved' }), 'Used by an approved item'),
      h('span', {}, h('span', { class: 'sw sw-pending' }), 'Used by a draft waiting for review'),
      h('span', { class: 'muted', text: 'Select a highlight to see its items, or select any other passage to make your own card from it.' })),
    h('article', { class: 'card' }, textEl));

  if (target) {
    setTimeout(() => {
      target.scrollIntoView({ block: 'center' });
      target.classList.add('flash');
    }, 0);
  }

  async function remove() {
    const ok = await confirmDialog({
      title: `Delete “${s.title}”?`,
      message: `This permanently deletes the notes and all ${s.approved + s.pending + s.discarded} items drafted from them, including approved cards and their study history.`,
      confirm: 'Delete source', danger: true,
    });
    if (!ok) return;
    try {
      await post('source.delete', { id: s.id });
      toast('Source deleted.');
      await refreshState();
      location.hash = '#/sources';
    } catch (err) {
      toastError(err);
    }
  }
}

/** Selected note text without the "•" bullets the view adds, so it matches the source as written. */
function cleanSelection(text) {
  return text.replace(/\r/g, '').replace(/^[ \t]*•[ \t]*/gm, '').replace(/[ \t]+\n/g, '\n').trim();
}

/** Renders note text with headings shown as headings and bullets as "•", markdown markers removed. */
function renderText(container, text, state) {
  for (const part of text.split(/(\n)/)) {
    if (part === '\n') {
      container.append('\n');
      state.lineStart = true;
      continue;
    }
    if (!part) continue;
    let p = part;
    if (state.lineStart) {
      const m = p.match(/^#{1,6}\s+(.*)$/);
      if (m) {
        container.append(h('span', { class: 'sh', text: m[1].replace(/\*\*|__|`/g, '') }));
        state.lineStart = false;
        continue;
      }
      p = p.replace(/^(\s*)[-*+]\s+/, '$1• ');
    }
    container.append(p.replace(/\*\*|__|`/g, ''));
    state.lineStart = false;
  }
}

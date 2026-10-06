// Study modes: flashcards, quick quiz and focused sessions — all built from approved items only.

import { get, post } from '../api.js';
import { h, fill, toast, toastError, kindBadge, cleanMd, plural, KINDS } from '../ui.js';
import { app, refreshState } from '../state.js';

const BOX_DAYS = [0, 0, 1, 3, 7, 16];

// ---------- shared pieces ----------

async function scopeControls(query) {
  const [tags, sources] = await Promise.all([get('tags'), get('sources')]);
  const sel = (label, options, value) => h('select', { 'aria-label': label },
    options.map(([v, t]) => h('option', { value: v, text: t, selected: v === value })));
  const tag = sel('Topic', [['', 'All topics'], ...tags.map((t) => [t.tag, `${t.tag} (${t.count})`])], query.get('tag') ?? '');
  const source = sel('Source', [['', 'All sources'], ...sources.map((s) => [String(s.id), s.title])], query.get('source_id') ?? '');
  const kind = sel('Kind', [['', 'All kinds'], ...Object.entries(KINDS).filter(([k]) => k !== 'question')], query.get('kind') ?? '');
  return {
    els: [tags.length ? tag : null, sources.length > 1 ? source : null, kind],
    value: () => ({ tag: tag.value, source_id: source.value, kind: kind.value }),
  };
}

function header(title, sub, extra) {
  return h('header', { class: 'page-head' }, h('div', {}, h('h1', { text: title }), h('p', { class: 'sub', text: sub })), extra ?? null);
}

function noCards(message) {
  return h('div', { class: 'card empty' },
    h('h2', { text: 'Nothing to study here yet' }),
    h('p', { text: message }),
    h('div', { class: 'row' },
      h('a', { class: 'btn btn-primary', href: '#/queue', text: 'Review drafts' }),
      h('a', { class: 'btn', href: '#/add', text: 'Add notes' })));
}

function sourceQuote(item) {
  const x = item.excerpts?.[0];
  if (!x || x.match === 'missing') return null;
  return h('div', { class: 'stack' },
    h('span', { class: 'muted small', text: `From your notes${x.source_title ? ` · ${x.source_title}` : ''}` }),
    h('blockquote', { class: 'quote quote-sm', text: cleanMd(x.text) }));
}

function intervalLabel(days) {
  return days <= 0 ? 'again today' : days === 1 ? 'in 1 day' : `in ${days} days`;
}

/**
 * Runs a deck of flashcards: reveal, then grade Again / Good / Easy.
 * "Again" sends a card to the back of the deck once, so it is seen again this session.
 */
function runDeck(host, cards, { mode, onDone, shouldStop }) {
  const deck = [...cards];
  const repeated = new Set();
  const tally = { again: 0, good: 0, easy: 0 };
  const missed = new Map();
  let i = 0;
  let revealed = false;
  let busy = false;

  const draw = () => {
    if (i >= deck.length || shouldStop?.()) return finish();
    const card = deck[i];
    revealed = false;
    const box = card.box;
    const good = Math.min(5, Math.max(1, box) + 1);
    const easy = Math.min(5, Math.max(1, box) + 2);
    const answer = h('div', { class: 'back', hidden: true, text: card.card_back });
    const quote = h('div', { hidden: true }, sourceQuote(card));
    const reveal = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', on: { click: show } }, 'Show answer ', h('kbd', { text: 'Space' }));
    const grades = h('div', { class: 'grade-row', hidden: true },
      gradeButton('Again', '1', intervalLabel(0), 'again'),
      gradeButton('Good', '2', intervalLabel(BOX_DAYS[good]), 'good'),
      gradeButton('Easy', '3', intervalLabel(BOX_DAYS[easy]), 'easy'));

    host.replaceChildren(
      h('div', { class: 'queue-progress' },
        h('span', {}, h('b', { text: `Card ${i + 1}` }), ` of ${deck.length}`),
        h('div', { class: 'progress', 'aria-hidden': 'true' }, h('span', { style: { width: `${Math.round((i / deck.length) * 100)}%` } }))),
      h('article', { class: 'card flashcard', 'aria-live': 'polite' },
        h('div', { class: 'card-meta' }, kindBadge(card.kind), card.tags.map((t) => h('span', { class: 'chip', text: t }))),
        h('div', { class: 'front', text: card.card_front }),
        answer, quote,
        h('a', { class: 'small', href: `#/item/${card.id}`, text: 'Open this item', hidden: true })),
      reveal, grades);

    function show() {
      if (revealed) return;
      revealed = true;
      answer.hidden = false;
      quote.hidden = false;
      host.querySelector('.flashcard a').hidden = false;
      reveal.hidden = true;
      grades.hidden = false;
      grades.querySelector('button')?.focus();
    }
    draw.show = show;
  };

  function gradeButton(label, key, hint, result) {
    return h('button', { class: `btn${result === 'good' ? ' btn-primary' : ''}`, type: 'button', 'aria-keyshortcuts': key, on: { click: () => grade(result) } },
      h('span', {}, `${label} `, h('kbd', { text: key })), h('span', { class: 'hint', text: hint }));
  }

  async function grade(result) {
    if (busy || !revealed) return;
    busy = true;
    const card = deck[i];
    try {
      await post('study.grade', { id: card.id, result, mode });
      tally[result]++;
      if (result === 'again') {
        missed.set(card.id, card);
        if (!repeated.has(card.id)) {
          repeated.add(card.id);
          deck.push({ ...card, box: 1 });
        }
      }
      i++;
      draw();
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
    }
  }

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    document.removeEventListener('keydown', onKey);
    refreshState();
    onDone({ tally, missed: [...missed.values()], seen: i });
  }

  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); draw.show?.(); }
    else if (revealed && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); grade(['again', 'good', 'easy'][Number(e.key) - 1]); }
  };
  document.addEventListener('keydown', onKey);
  draw();
  return {
    cancel: () => document.removeEventListener('keydown', onKey),
    end: finish,
  };
}

function deckSummary({ tally, missed, seen }, restart, extra) {
  const total = tally.again + tally.good + tally.easy;
  return h('div', { class: 'card stack' },
    h('h2', { text: seen ? 'Nice work — that’s the deck' : 'Session ended' }),
    h('div', { class: 'tiles tiles-inset' },
      tile('Answered', String(total)),
      tile('Again', String(tally.again), 'back in Box 1'),
      tile('Good', String(tally.good)),
      tile('Easy', String(tally.easy))),
    missed.length ? h('div', { class: 'stack' },
      h('h3', { text: 'Worth another look' }),
      h('ul', { class: 'list-plain' }, missed.map((c) => h('li', {}, h('a', { href: `#/item/${c.id}`, text: c.title }), kindBadge(c.kind))))) : null,
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-primary', type: 'button', text: 'Study again', on: { click: restart } }),
      h('a', { class: 'btn', href: '#/dashboard', text: 'See your understanding' }),
      extra ?? null));
}

function tile(label, value, note) {
  return h('div', { class: 'tile' }, h('div', { class: 'label', text: label }), h('div', { class: 'value', text: value }), note ? h('div', { class: 'note', text: note }) : null);
}

// ---------- flashcards ----------

export async function renderFlashcards(page, { query, onLeave }) {
  const state = app.state ?? (await refreshState());
  const scope = await scopeControls(query);
  const dueOnly = h('input', { type: 'checkbox', checked: (state?.counts?.due ?? 0) > 0 });
  const size = h('select', { 'aria-label': 'Deck size' }, [10, 20, 50].map((n) => h('option', { value: n, text: `${n} cards`, selected: n === 20 })));
  const host = h('div', { class: 'study-wrap' });
  let run = null;
  onLeave(() => run?.cancel());

  page.append(
    header('Flashcards', 'Due and shaky cards come first. Grade yourself honestly: “Again” brings a card back today, “Good” and “Easy” push it further out.'),
    h('div', { class: 'filters' }, scope.els, size, h('label', { class: 'checkbox' }, dueOnly, h('span', { text: 'Due cards only' })),
      h('button', { class: 'btn btn-primary', type: 'button', text: 'Start', on: { click: start } })),
    host);

  async function start() {
    run?.cancel();
    host.replaceChildren(h('p', { class: 'muted', text: 'Shuffling…' }));
    try {
      const cards = await get('study.deck', { ...scope.value(), due_only: dueOnly.checked ? '1' : '', size: size.value });
      if (!cards.length) {
        host.replaceChildren(dueOnly.checked
          ? h('div', { class: 'card empty' }, h('h2', { text: 'Nothing is due' }),
            h('p', { text: 'Every card in this selection is scheduled for later. Untick “Due cards only” to practise anyway.' }))
          : noCards('Approve some drafts in the review queue to build your deck.'));
        return;
      }
      run = runDeck(host, cards, { mode: 'flashcard', onDone: (r) => host.replaceChildren(deckSummary(r, start)) });
    } catch (err) {
      toastError(err);
    }
  }
  start();
}

// ---------- quick quiz ----------

export async function renderQuiz(page, { query }) {
  const scope = await scopeControls(query);
  const size = h('select', { 'aria-label': 'Number of questions' }, [5, 8, 12].map((n) => h('option', { value: n, text: `${n} questions`, selected: n === 8 })));
  const host = h('div', { class: 'study-wrap' });

  page.append(
    header('Quick quiz', 'Questions come only from items you approved. The wrong options are other items from your library — nothing is made up.'),
    h('div', { class: 'filters' }, scope.els, size, h('button', { class: 'btn btn-primary', type: 'button', text: 'New quiz', on: { click: start } })),
    host);

  async function start() {
    host.replaceChildren(h('p', { class: 'muted', text: 'Writing your quiz…' }));
    let questions;
    try {
      questions = await get('study.quiz', { ...scope.value(), size: size.value });
    } catch (err) {
      return toastError(err);
    }
    if (!questions.length) return host.replaceChildren(noCards('A quiz needs approved items with answers.'));

    let n = 0;
    let score = 0;
    const missed = [];

    const next = () => (n < questions.length ? ask(questions[n]) : done());

    const record = async (q, right) => {
      if (right) score++; else missed.push(q.item);
      try {
        await post('study.grade', { id: q.item.id, result: right ? 'right' : 'wrong', mode: 'quiz' });
      } catch (err) {
        toastError(err);
      }
    };

    function ask(q) {
      const nextBtn = h('button', { class: 'btn btn-primary', type: 'button', hidden: true, text: n + 1 < questions.length ? 'Next question' : 'See results', on: { click: () => { n++; next(); } } });
      const feedback = h('div', { class: 'stack', hidden: true });
      const card = h('article', { class: 'card stack' },
        h('div', { class: 'row-between' }, h('span', { class: 'muted small', text: `Question ${n + 1} of ${questions.length}` }), kindBadge(q.item.kind)));

      if (q.type === 'match') {
        card.append(h('p', { class: 'muted small', text: 'Which item from your library does this describe?' }), h('p', { class: 'prompt', text: q.prompt }));
        const options = h('div', { class: 'options' });
        for (const opt of q.options) {
          options.append(h('button', {
            class: 'btn option', type: 'button', text: opt.label, dataset: { id: opt.id },
            on: {
              click: async () => {
                if (!feedback.hidden) return;
                const right = opt.id === q.answer_id;
                for (const b of options.children) {
                  b.disabled = true;
                  if (Number(b.dataset.id) === q.answer_id) b.classList.add('correct');
                }
                if (!right) options.querySelector(`[data-id="${opt.id}"]`).classList.add('wrong');
                fill(feedback, h('p', { class: right ? 'notice notice-ok' : 'notice notice-warn', text: right ? 'Correct.' : `Not quite — it was “${q.item.title}”.` }), sourceQuote(q.item));
                feedback.hidden = false;
                nextBtn.hidden = false;
                nextBtn.focus();
                await record(q, right);
              },
            },
          }));
        }
        card.append(options);
      } else {
        const reveal = h('button', { class: 'btn btn-primary', type: 'button', text: 'Reveal the answer' });
        const answer = h('div', { class: 'stack', hidden: true });
        const judge = h('div', { class: 'row', hidden: true },
          h('button', { class: 'btn', type: 'button', text: 'I missed it', on: { click: () => mark(false) } }),
          h('button', { class: 'btn btn-primary', type: 'button', text: 'I got it right', on: { click: () => mark(true) } }));
        const mark = async (right) => {
          judge.hidden = true;
          feedback.replaceChildren(h('p', { class: right ? 'notice notice-ok' : 'notice notice-warn', text: right ? 'Marked as right.' : 'Marked to revisit.' }));
          feedback.hidden = false;
          nextBtn.hidden = false;
          nextBtn.focus();
          await record(q, right);
        };
        reveal.addEventListener('click', () => {
          reveal.hidden = true;
          answer.hidden = false;
          judge.hidden = false;
        });
        fill(answer, h('p', { class: 'prompt', text: q.item.card_back }), sourceQuote(q.item));
        card.append(h('p', { class: 'muted small', text: 'Answer from memory, then check.' }), h('p', { class: 'prompt', text: q.prompt }), reveal, answer, judge);
      }
      card.append(feedback, h('div', { class: 'row' }, nextBtn));
      host.replaceChildren(card);
    }

    function done() {
      refreshState();
      host.replaceChildren(h('div', { class: 'card stack' },
        h('span', { class: 'muted', text: 'Your score' }),
        h('div', { class: 'summary-score', text: `${score} / ${questions.length}` }),
        missed.length ? h('div', { class: 'stack' }, h('h3', { text: 'Revisit these' }),
          h('ul', { class: 'list-plain' }, missed.map((it) => h('li', {}, h('a', { href: `#/item/${it.id}`, text: it.title }), kindBadge(it.kind))))) : h('p', { text: 'Every answer right.' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-primary', type: 'button', text: 'Another quiz', on: { click: start } }),
          h('a', { class: 'btn', href: '#/flashcards', text: 'Flashcards' }))));
    }

    next();
  }
  start();
}

// ---------- focused session ----------

export async function renderSession(page, { query, onLeave }) {
  const scope = await scopeControls(query);
  const length = h('select', { 'aria-label': 'Session length' }, [10, 20, 30].map((n) => h('option', { value: n, text: `${n} cards`, selected: n === 20 })));
  const minutes = h('select', { 'aria-label': 'Time limit' }, [['0', 'No time limit'], ['10', '10 minutes'], ['15', '15 minutes'], ['25', '25 minutes']].map(([v, t]) => h('option', { value: v, text: t, selected: v === '15' })));
  const setup = h('div', { class: 'card stack' },
    h('p', { text: 'A session hides everything else, starts with what is due or shaky, and ends with a short summary. Pick a topic to focus on.' }),
    h('div', { class: 'filters' }, scope.els, length, minutes),
    h('div', {}, h('button', { class: 'btn btn-primary btn-lg', type: 'button', text: 'Start session', on: { click: start } })));
  const host = h('div', { class: 'study-wrap' });
  let run = null;
  let timer = null;
  onLeave(() => {
    run?.cancel();
    clearInterval(timer);
    document.body.classList.remove('focus-mode');
  });

  page.append(header('Study session', 'Focused practice on one slice of your guide.'), setup, host);

  async function start() {
    let cards;
    try {
      cards = await get('study.deck', { ...scope.value(), size: length.value });
    } catch (err) {
      return toastError(err);
    }
    if (!cards.length) return host.replaceChildren(noCards('Approve some drafts to study them in a session.'));

    setup.hidden = true;
    document.body.classList.add('focus-mode');
    const limit = Number(minutes.value) * 60;
    const startedAt = Date.now();
    let timeUp = false;
    const clock = h('span', { class: 'timer' });
    const topicLabel = [scope.value().tag, KINDS[scope.value().kind]].filter(Boolean).join(' · ') || 'All topics';
    const bar = h('div', { class: 'row-between' },
      h('div', { class: 'row' }, h('b', { text: 'Focused session' }), h('span', { class: 'muted', text: topicLabel })),
      h('div', { class: 'row' }, clock, h('button', { class: 'btn btn-sm', type: 'button', text: 'End session', on: { click: () => run?.end() } })));
    const deckHost = h('div', { class: 'stack' });
    host.replaceChildren(bar, deckHost);

    const tick = () => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      if (limit) {
        const left = Math.max(0, limit - elapsed);
        clock.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left`;
        if (left === 0 && !timeUp) {
          timeUp = true;
          toast('Time is up — finish this card and the session ends.');
        }
      } else {
        clock.textContent = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
      }
    };
    tick();
    timer = setInterval(tick, 1000);

    const finish = (result) => {
      clearInterval(timer);
      document.body.classList.remove('focus-mode');
      host.replaceChildren(deckSummary(result, () => { setup.hidden = false; host.replaceChildren(); },
        h('a', { class: 'btn btn-ghost', href: '#/library', text: 'Library' })));
    };
    run = runDeck(deckHost, cards, { mode: 'session', shouldStop: () => timeUp, onDone: finish });
  }
}

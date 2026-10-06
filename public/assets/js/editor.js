// The editable form for one study item, used in the review queue and on item pages.

import { h, autosize, noveltyHint, referenceText, tagInput, KINDS } from './ui.js';

const LABELS = {
  kind: 'Kind', title: 'Title', statement: 'What your notes say', card_front: 'Card front',
  card_back: 'Card back', interpretation: 'AI interpretation', steps: 'Steps', tags: 'Tags',
};

export function itemEditor(item) {
  const reference = () => referenceText(item);
  const initial = fieldsOf(item);

  const kind = h('select', { 'aria-label': 'Kind' },
    Object.entries(KINDS).map(([value, label]) => h('option', { value, text: label, selected: value === item.kind })));
  const title = h('input', { type: 'text', value: item.title, 'aria-label': 'Title', maxlength: 200 });
  const statement = autosize(h('textarea', { class: 'read', rows: 2, value: item.statement, 'aria-label': 'What your notes say' }));
  const front = autosize(h('textarea', { rows: 1, value: item.card_front, 'aria-label': 'Card front' }));
  const back = autosize(h('textarea', { rows: 2, value: item.card_back, 'aria-label': 'Card back' }));
  const interpretation = autosize(h('textarea', { rows: 2, value: item.interpretation, 'aria-label': 'AI interpretation' }));
  const tags = tagInput(item.tags ?? []);

  const frontLabel = h('span', { text: 'Front — the question' });
  const backLabel = h('span', { text: 'Back — the answer, supported by the excerpt alone' });

  // Steps (for how-to and process items)
  const stepList = h('ol', { class: 'steps-editor' });
  const addStepRow = (text = '') => {
    const ta = autosize(h('textarea', { rows: 1, value: text, 'aria-label': 'Step' }));
    const row = h('li', {}, ta, h('button', {
      class: 'icon-btn', type: 'button', 'aria-label': 'Remove step', text: '×',
      on: { click: () => row.remove() },
    }));
    stepList.append(row);
    return ta;
  };
  (item.steps ?? []).forEach((s) => addStepRow(s));
  const stepsSection = h('div', { class: 'field' },
    h('span', { text: 'Steps, in order' }),
    stepList,
    h('div', {}, h('button', { class: 'btn btn-sm', type: 'button', text: '+ Add step', on: { click: () => addStepRow().focus() } })));

  const showAiBox = item.origin === 'claude' || item.interpretation !== '';
  const aiBox = h('div', { class: 'ai-box', hidden: !showAiBox },
    h('div', { class: 'ai-label' }, h('span', { 'aria-hidden': 'true', text: '✦' }), 'AI interpretation — not from your notes'),
    interpretation,
    h('p', { class: 'small', text: 'Optional help with understanding. Clear it if it adds anything your notes do not say.' }),
    noveltyHint(interpretation, reference, { label: 'Adds words not in your notes:' }));

  const syncKind = () => {
    const k = kind.value;
    stepsSection.hidden = !(k === 'howto' || k === 'process' || stepList.children.length > 0);
    frontLabel.textContent = k === 'question' ? 'The open question' : 'Front — the question';
    backLabel.textContent = k === 'question'
      ? 'What your notes say about it so far (optional)'
      : 'Back — the answer, supported by the excerpt alone';
  };
  kind.addEventListener('change', syncKind);
  syncKind();

  const el = h('div', { class: 'editor' },
    h('div', { class: 'editor-row' },
      h('label', { class: 'field' }, h('span', { text: 'Kind' }), kind),
      h('label', { class: 'field' }, h('span', { text: 'Title' }), title)),
    h('label', { class: 'field' },
      h('span', {}, 'What your notes say ', h('span', { class: 'help', text: '— restate the excerpt only, nothing added' })),
      statement),
    noveltyHint(statement, reference),
    h('div', { class: 'editor-card' },
      h('div', { class: 'field-label', text: 'Flashcard' }),
      h('label', { class: 'field' }, frontLabel, front),
      h('label', { class: 'field' }, backLabel, back),
      noveltyHint(back, reference, { label: 'Answer uses words not in your notes nearby:' })),
    stepsSection,
    aiBox,
    h('div', { class: 'field' }, h('span', { text: 'Tags' }), tags.el),
    item.draft ? draftComparison(item, () => getFields()) : null);

  function getFields() {
    return {
      kind: kind.value,
      title: title.value.trim(),
      statement: statement.value.trim(),
      interpretation: interpretation.value.trim(),
      card_front: front.value.trim(),
      card_back: back.value.trim(),
      steps: [...stepList.querySelectorAll('textarea')].map((t) => t.value.trim()).filter(Boolean),
      tags: tags.get(),
    };
  }

  return {
    el,
    getFields,
    isDirty: () => JSON.stringify(getFields()) !== JSON.stringify(initial),
    focus: () => statement.focus(),
  };
}

function fieldsOf(item) {
  return {
    kind: item.kind,
    title: item.title,
    statement: item.statement,
    interpretation: item.interpretation,
    card_front: item.card_front,
    card_back: item.card_back,
    steps: item.steps ?? [],
    tags: item.tags ?? [],
  };
}

/** "What did I change?" — the generated draft next to the current text, for fields that differ. */
function draftComparison(item, current) {
  const body = h('div');
  const details = h('details', { class: 'draft-diff' }, h('summary', { text: 'Compare with the original draft' }), body);
  details.addEventListener('toggle', () => {
    if (!details.open) return;
    const now = current();
    const draft = item.draft;
    const changed = Object.keys(LABELS).filter((k) => k !== 'tags' && JSON.stringify(normalise(now[k])) !== JSON.stringify(normalise(draft[k])));
    body.replaceChildren(changed.length === 0
      ? h('p', { class: 'muted', text: 'No changes from the draft yet.' })
      : h('dl', {}, changed.flatMap((k) => [
        h('dt', { text: LABELS[k] }),
        h('dd', { text: formatValue(k, draft[k]) || '(empty)' }),
      ])));
  });
  return details;
}

function normalise(v) {
  return Array.isArray(v) ? v.map((s) => String(s).trim()) : String(v ?? '').trim();
}

function formatValue(key, v) {
  if (key === 'kind') return KINDS[v] ?? v;
  if (Array.isArray(v)) return v.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return v ?? '';
}

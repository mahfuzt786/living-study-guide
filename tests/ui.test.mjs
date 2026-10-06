// Unit tests for the browser-side checks that run while a learner edits a card.
//   node --test "tests/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { novelWords, cleanMd, referenceText } from '../public/assets/js/ui.js';

test('flags an invented cause added to a short note', () => {
  assert.deepEqual(
    novelWords('Rome fell in 476 AD because of barbarian invasions.', 'Rome fell in 476 AD.'),
    ['because', 'barbarian', 'invasions'],
  );
});

test('accepts inflections and question scaffolding around words from the notes', () => {
  const notes = 'Later research by Nelson Cowan suggests the limit is closer to four chunks.';
  assert.deepEqual(novelWords('What does later research by Nelson Cowan suggest about the limit?', notes), []);
  assert.deepEqual(novelWords('What is meant by "chunk"?', notes), []);
});

test('accepts hyphenated words built from words in the notes', () => {
  assert.deepEqual(novelWords('A limited-capacity store', 'a limited capacity system and a store'), []);
});

test('reports each new word once, in order', () => {
  assert.deepEqual(novelWords('Hippocampus, hippocampus and amygdala', 'nothing relevant'), ['hippocampus', 'amygdala']);
});

test('cleanMd keeps the line break before a bullet', () => {
  assert.equal(cleanMd('can be stored.\n- Retrieval: bringing back'), 'can be stored.\n• Retrieval: bringing back');
});

test('cleanMd strips heading markers but keeps the heading text', () => {
  assert.equal(cleanMd('## Key terms\nEncoding'), 'Key terms\nEncoding');
});

test('referenceText combines every excerpt and its context', () => {
  const item = {
    excerpts: [
      { text: 'Cramming is massed practice.', context: { before: 'Spacing.', text: 'Cramming is massed practice.', after: 'Interleaving.' } },
      { text: 'A second excerpt.', context: null },
    ],
  };
  const ref = referenceText(item);
  for (const part of ['Spacing.', 'Cramming is massed practice.', 'Interleaving.', 'A second excerpt.']) {
    assert.ok(ref.includes(part), `missing ${part}`);
  }
});

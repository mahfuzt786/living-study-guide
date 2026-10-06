// End-to-end smoke test. Starts the app with PHP's built-in server on a free port and a
// throwaway database, then uses it the way the browser does. It never calls the Claude API.
//   node --test tests/smoke.test.mjs
// Set SMOKE_BASE_URL to test an app that is already running on a fresh database instead.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let base = process.env.SMOKE_BASE_URL?.replace(/\/$/, '');
let server;
let dataDir;
let serverLog = '';

function freePort() {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

before(async () => {
  if (base) return;
  dataDir = mkdtempSync(join(tmpdir(), 'study-smoke-'));
  const port = await freePort();
  const env = { ...process.env, STUDY_DATA_DIR: dataDir };
  delete env.ANTHROPIC_API_KEY;
  server = spawn(process.env.PHP_BINARY || 'php', ['-S', `127.0.0.1:${port}`, '-t', join(root, 'public')], { cwd: root, env });
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${base}/login.php`);
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`The PHP server did not start:\n${serverLog}`);
});

after(async () => {
  if (server) {
    const exited = new Promise((r) => server.once('exit', r));
    server.kill();
    await exited;
  }
  if (dataDir) rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** A tiny browser: keeps the session cookie and the CSRF token. */
class Browser {
  cookies = new Map();
  csrf = '';

  async request(method, path, { json, form, csrf = true } = {}) {
    const headers = {};
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (json !== undefined) {
      headers['content-type'] = 'application/json';
      if (csrf && this.csrf) headers['x-csrf-token'] = this.csrf;
      body = JSON.stringify(json);
    } else if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    const res = await fetch(base + path, { method, headers, body, redirect: 'manual' });
    for (const cookie of res.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      const name = pair.slice(0, pair.indexOf('=')).trim();
      const value = pair.slice(pair.indexOf('=') + 1).trim();
      if (!value || value === 'deleted') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* HTML page */ }
    return { status: res.status, location: res.headers.get('location') ?? '', body: text, json: data };
  }

  get(action, query = {}) {
    return this.request('GET', `/api.php?${new URLSearchParams({ action, ...query })}`);
  }

  post(action, body = {}) {
    return this.request('POST', `/api.php?action=${encodeURIComponent(action)}`, { json: body });
  }
}

const formCsrf = (html) => html.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
const b = new Browser();
const password = randomBytes(12).toString('hex');
const ctx = {};

test('signed out: the app redirects to sign-in and the API refuses requests', async () => {
  const r = await b.request('GET', '/');
  assert.equal(r.status, 302);
  assert.match(r.location, /login\.php/);
  assert.equal((await b.get('state')).status, 401);
});

test('private files are never served', async () => {
  // Servers differ in how they refuse (Apache: 403; PHP's built-in server: 404, or since 8.4 the
  // app's own sign-in redirect), so check that no private file's contents ever come back.
  const secrets = {
    '/src/Db.php': 'final class Db',
    '/src/bootstrap.php': 'APP_ROOT',
    '/data/study.sqlite': 'SQLite format 3',
    '/vendor/autoload.php': 'ComposerAutoloader',
    '/.env.example': 'ANTHROPIC_API_KEY=',
    '/composer.json': '"anthropic-ai/sdk"',
  };
  for (const [path, marker] of Object.entries(secrets)) {
    const r = await b.request('GET', path);
    assert.ok(!r.body.includes(marker), `${path} was served (HTTP ${r.status})`);
    assert.notEqual(r.status, 200, `${path} answered 200`);
  }
});

test('first run: creates the owner account, rejecting a short password', async () => {
  let r = await b.request('GET', '/login.php');
  assert.match(r.body, /Create your owner account/);
  r = await b.request('POST', '/login.php', { form: { csrf: formCsrf(r.body), username: 'owner', password: 'short', confirm: 'short' } });
  assert.match(r.body, /at least 10 characters/);
  r = await b.request('POST', '/login.php', { form: { csrf: formCsrf(r.body), username: 'owner', password, confirm: password } });
  assert.equal(r.status, 302);
  ctx.shell = (await b.request('GET', '/')).body;
  b.csrf = ctx.shell.match(/name="csrf-token" content="([^"]+)"/)?.[1] ?? '';
  assert.equal(b.csrf.length, 64);
});

test('writes without the CSRF token are refused', async () => {
  assert.equal((await b.request('POST', '/api.php?action=source.demo', { json: {}, csrf: false })).status, 403);
  ctx.state = (await b.get('state')).json;
  assert.equal(ctx.state.counts.library, 0);
});

test('drafting: the offline extractor drafts 18 items, and again adds no duplicates', async () => {
  ctx.source = (await b.post('source.demo')).json;
  assert.ok(ctx.source.id > 0);
  if (!ctx.state.ai.claude) {
    const r = await b.post('source.extract', { id: ctx.source.id, chunk: 0, mode: 'claude' });
    assert.equal(r.status, 502);
    assert.match(r.json.error, /ANTHROPIC_API_KEY/);
  }
  assert.equal((await b.post('source.extract', { id: ctx.source.id, chunk: 0, mode: 'local' })).json.created, 18);
  assert.equal((await b.post('source.extract', { id: ctx.source.id, chunk: 0, mode: 'local' })).json.created, 0);
});

test('review queue: every draft is an exact quote shown in context', async () => {
  const queue = (await b.get('queue')).json;
  assert.equal(queue.length, 18);
  assert.ok(queue[0].excerpts[0].context.text);
  assert.equal(queue.filter((i) => i.excerpts[0].match !== 'exact').length, 0);
  ctx.ids = queue.map((i) => i.id);
});

test('review queue: edit, approve, undo, discard and merge', async () => {
  const { ids } = ctx;
  assert.equal((await b.post('item.update', { id: ids[0], fields: { card_back: 'An edited answer.' } })).json.edited, true);
  assert.equal((await b.post('item.approve', { id: ids[0] })).json.status, 'approved');
  assert.equal((await b.post('item.restore', { id: ids[0] })).json.status, 'pending');
  for (const id of ids.slice(0, 14)) await b.post('item.approve', { id });
  assert.equal((await b.post('item.discard', { id: ids[14] })).json.status, 'discarded');
  assert.equal((await b.post('item.merge', { id: ids[15], into: ids[2] })).json.excerpts.length, 2);
  assert.equal((await b.post('item.approve', { id: ids[15] })).status, 422);
});

test('library: holds only approved items and searches inside excerpts', async () => {
  ctx.library = (await b.get('items')).json;
  assert.equal(ctx.library.length, 14);
  assert.ok(ctx.library.every((i) => i.status === 'approved'));
  assert.ok((await b.get('items', { q: 'memory trace' })).json.length >= 1);
});

test('study: flashcards, quiz options and grading use only the library', async () => {
  const deck = (await b.get('study.deck', { size: 5 })).json;
  assert.equal(deck.length, 5);
  const quiz = (await b.get('study.quiz', { size: 8 })).json;
  const titles = new Set(ctx.library.map((i) => i.title));
  assert.ok(quiz.length > 0);
  for (const q of quiz) for (const o of q.options ?? []) assert.ok(titles.has(o.label), o.label);
  assert.ok((await b.post('study.grade', { id: deck[0].id, result: 'good', mode: 'flashcard' })).json.box >= 2);
  assert.equal((await b.post('study.grade', { id: ctx.ids[16], result: 'good' })).status, 422);
});

test('your own cards: made from a sentence in the notes, nothing else', async () => {
  const sentence = 'Later research by Nelson Cowan suggests the limit is closer to four chunks.';
  const fields = { kind: 'concept', title: "Cowan's four-chunk limit", card_front: 'What does later research by Nelson Cowan suggest?', card_back: 'That the limit is closer to four chunks.' };
  const card = (await b.post('item.create', { source_id: ctx.source.id, excerpt: sentence, fields })).json;
  assert.equal(card.origin, 'manual');
  assert.equal(card.excerpts[0].match, 'exact');
  assert.equal((await b.post('item.create', { source_id: ctx.source.id, excerpt: 'Rome fell in 476 AD.', fields: { ...fields, title: 'Rome' } })).status, 422);
  assert.equal((await b.post('item.create', { source_id: ctx.source.id, excerpt: sentence, fields })).status, 422);
});

test('dashboard and the highlighted source view', async () => {
  const d = (await b.get('dashboard')).json;
  assert.equal(d.counts.approved, 15);
  assert.equal(d.counts.pending, 2);
  assert.equal(d.review.discarded, 1);
  assert.equal(d.review.merged, 1);
  const view = (await b.get('source', { id: ctx.source.id })).json;
  const demo = readFileSync(join(root, 'demo/how-memory-works.md'), 'utf8').replace(/\r\n/g, '\n').trim();
  assert.equal(view.segments.map((s) => s.text).join(''), demo);
});

test('backup, restore, Markdown export and the study goal', async () => {
  const backup = (await b.request('GET', '/api.php?action=backup')).json;
  assert.equal(backup.format, 'living-study-guide-backup');
  assert.ok(!('users' in backup), 'the backup must leave out the login');
  assert.equal((await b.post('restore', { backup })).json.items, 19);
  assert.equal((await b.get('items')).json.length, 15);
  assert.ok((await b.request('GET', '/api.php?action=export.md')).body.startsWith('# My study guide'));
  assert.equal((await b.post('settings.goal', { subject: 'Psychology 101', focus: 'exam review' })).json.goal, 'Psychology 101 — exam review');
});

test('signing out, and the lockout after five failed sign-ins', async () => {
  await b.request('POST', '/logout.php', { form: { csrf: formCsrf(ctx.shell) } });
  assert.equal((await b.get('state')).status, 401);
  let login = await b.request('GET', '/login.php');
  assert.doesNotMatch(login.body, /Create your owner account/);
  for (let i = 1; i <= 5; i++) {
    login = await b.request('POST', '/login.php', { form: { csrf: formCsrf(login.body), username: 'owner', password: `wrong-${i}` } });
  }
  login = await b.request('POST', '/login.php', { form: { csrf: formCsrf(login.body), username: 'owner', password } });
  assert.match(login.body, /Too many failed sign-in attempts/);
});

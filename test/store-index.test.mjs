import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { Policy } from '../src/policy.mjs';
const a = '15551234567@s.whatsapp.net', b = '99999999@lid';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ez-store-index-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir); await store.init(); let id = 0;
  const capture = (chat = a, extra = {}) => store.ingest({ id: String(++id), chat, fromMe: false, source: 'notify', timestamp: Math.floor(Date.now() / 1000), text: 'hello', ...extra });
  return { dir, store, capture };
}

test('pages, chat filters, cursors and updates match the files, before and after the index loads', async t => {
  const { dir, store, capture } = await fixture(t);
  await capture(a); await capture(b); await capture(a);
  assert.deepEqual((await store.messages(0, 2)).messages.map(r => r.seq), [1, 2]);
  assert.equal((await store.messages(0, 2)).hasMore, true);
  await capture(b); await capture(a);
  const page = await store.messages(1, 2, a);
  assert.deepEqual(page.messages.map(r => r.seq), [3, 5]);
  assert.deepEqual({ nextCursor: page.nextCursor, hasMore: page.hasMore }, { nextCursor: 5, hasMore: false });
  assert.deepEqual(await store.messages(5), { messages: [], nextCursor: 5, hasMore: false, coverage: 'captured-only', historyCoverage: 'partial-on-request' });
  assert.equal((await store.messages(0, 4)).hasMore, true);
  assert.equal((await store.messages(0, 5)).hasMore, false);

  const row = (await store.messages(2, 1)).messages[0];
  await store.updateMessage({ ...row, text: 'edited', transcription: { state: 'transcribed' } });
  assert.deepEqual((await store.messages(2, 1)).messages[0].transcription, { state: 'transcribed' });
  assert.equal((await store.messages(2, 1)).messages[0].seq, 3);

  // A restarted process rebuilds the same view from the canonical files.
  const restarted = new Store(dir); await restarted.init();
  assert.deepEqual(await restarted.messages(0, 100), await store.messages(0, 100));
  assert.equal((await restarted.messages(2, 1)).messages[0].text, 'edited');
});

test('rows ingested while the index is loading are not lost, and callers cannot mutate the index', async t => {
  const { store, capture } = await fixture(t);
  await capture(); await capture();
  const loading = store.messages(0, 100);
  await capture(); await capture(b);
  await loading;
  assert.deepEqual((await store.messages(0, 100)).messages.map(r => r.seq), [1, 2, 3, 4]);
  (await store.messages(0, 1)).messages[0].text = 'changed by caller';
  assert.equal((await store.messages(0, 1)).messages[0].text, 'hello');
});

test('after the first read a poll never rescans the inbox files', { timeout: 60000 }, async t => {
  const { dir, store } = await fixture(t);
  const rows = Array.from({ length: 3000 }, (_, i) => ({ id: `bulk-${i}`, chat: a, fromMe: false, participant: null, source: 'notify', timestamp: 1, text: 'x', seq: i + 1, capturedAt: new Date().toISOString() }));
  for (let offset = 0; offset < rows.length; offset += 100)
    await Promise.all(rows.slice(offset, offset + 100).map(r => writeFile(store.messagePath(r), JSON.stringify(r), { mode: 0o600 })));
  await writeFile(store.path('cursor.json'), JSON.stringify({ seq: rows.length }));
  await store.messages(0, 1);
  // Any per-poll scan would fail or crawl on these files; an indexed poll ignores them.
  for (const name of (await readdir(join(dir, 'messages'))).slice(0, 500)) await writeFile(join(dir, 'messages', name), '{');
  const policy = new Policy(store);
  const started = performance.now();
  for (let i = 0; i < 300; i++) await policy.events(rows.length - 1 - (i % 50));
  assert.ok(performance.now() - started < 2000, 'Behind-head polls must cost their page, not the inbox');
  assert.deepEqual((await store.messages(2990, 5)).messages.map(r => r.seq), [2991, 2992, 2993, 2994, 2995]);
});

test('a corrupt message file fails the index closed and a later repair loads it', async t => {
  const { dir, store, capture } = await fixture(t);
  await capture();
  const [name] = await readdir(join(dir, 'messages'));
  const original = JSON.stringify((await store.messages()).messages[0]);
  await writeFile(join(dir, 'messages', name), '{');
  const restarted = new Store(dir); await restarted.init();
  await assert.rejects(restarted.messages(), { code: 'CORRUPT_STATE' });
  await writeFile(join(dir, 'messages', name), original);
  assert.equal((await restarted.messages()).messages[0].seq, 1);
});

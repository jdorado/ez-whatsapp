import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { Policy } from '../src/policy.mjs';
const a = '15551234567@s.whatsapp.net', b = '99999999@lid';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ez-policy-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir); await store.init(); const policy = new Policy(store); let id = 0;
  const capture = (chat = a, extra = {}) => store.ingest({ id: String(++id), chat, fromMe: false, source: 'notify', timestamp: Math.floor(Date.now()/1000), text: 'hello', ...extra });
  return { store, policy, capture };
}
test('manual captures but emits nothing; selected starts now and matches exact chats', async t => {
  const { store, policy, capture } = await fixture(t);
  await capture(); assert.equal((await policy.events()).events.length, 0);
  await policy.change('subscribe', { chat: a });
  await capture(); await capture(b);
  const batch = await policy.events(); assert.deepEqual(batch.events.map(e => e.id), ['2']);
  assert.equal(batch.cursor, 3); assert.equal((await store.messages()).messages.length, 3);
  assert.equal((await new Policy(store).get()).mode, 'selected');
});
test('unsubscribe rechecks queued events; resubscribe excludes old messages and preserves other chats', async t => {
  const { policy, capture } = await fixture(t);
  await policy.change('subscribe', { chat: a }); await policy.change('subscribe', { chat: b });
  await capture(); await capture(b);
  const ids = (await policy.events()).events.map(e => e.id);
  await policy.change('unsubscribe', { chat: a });
  assert.deepEqual((await policy.check(ids)).events.map(e => e.conversationId), [b]);
  await policy.change('subscribe', { chat: a });
  assert.deepEqual((await policy.check(ids)).events.map(e => e.conversationId), [b]);
  await capture(); assert.equal((await policy.events()).events.length, 2);
});
test('all emits new eligible messages; manual revokes pending events; own/status/history cannot wake', async t => {
  const { policy, capture } = await fixture(t);
  await capture(); await policy.change('policy', { mode: 'all' });
  await capture(); await capture(b); await capture(a, { fromMe: true });
  await capture(a, { timestamp: 1, source: 'append' }); await capture(a, { source: 'history' });
  const batch = await policy.events(); assert.equal(batch.events.length, 2);
  await assert.rejects(policy.change('unsubscribe', { chat: a }), { code: 'INVALID_INPUT' });
  await policy.change('policy', { mode: 'manual' });
  assert.deepEqual((await policy.check(batch.events.map(e=>e.id))).events, []);
});
test('corrupt policy and invalid cursors fail closed; batches remain bounded', async t => {
  const { store, policy, capture } = await fixture(t);
  await policy.change('policy', { mode: 'all' });
  for(let i=0;i<12;i++) await capture();
  const batch=await policy.events(); assert.equal(batch.events.length, 10);
  assert.equal((await policy.events(batch.cursor)).events.length, 2);
  await assert.rejects(policy.events(-1)); await assert.rejects(policy.check(['../secret']));
  await writeFile(store.path('policy.json'), '{'); await assert.rejects(policy.events(), { code: 'CORRUPT_STATE' });
});

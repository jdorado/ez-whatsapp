import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import * as lib from '@whiskeysockets/baileys';
import { Store, writeJSON } from '../src/store.mjs';
import { History } from '../src/history.mjs';
import { Policy } from '../src/policy.mjs';
import { createTransport } from '../src/transport.mjs';
import { serve, client } from '../src/service.mjs';

const chat = '15551234567@s.whatsapp.net';
const anchor = { id: 'anchor', chat, fromMe: false, participant: null, timestamp: 1700000000, source: 'notify' };
const message = (id, jid = chat) => ({ key: { id, remoteJid: jid, fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: 'Historical text' } });
async function fixture(t, cleanup = true) {
  const dir = await mkdtemp(join(tmpdir(), 'ezwh-'));
  if (cleanup) t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir); await store.init(); await store.ingest(anchor);
  return { store, history: new History(store) };
}
test('bounded history uses exact captured anchor, milliseconds and private request state', async t => {
  const { store, history } = await fixture(t);
  let calls = 0;
  const fetch = async (count, key, timestamp) => {
    calls++; assert.equal(count, 2); assert.equal(timestamp, 1700000000000);
    assert.deepEqual(key, { remoteJid: chat, id: 'anchor', fromMe: false }); return 'session';
  };
  for (const args of [{ chat, before: 1, limit: 51 }, { chat, before: 0 }, { chat, before: NaN }, { chat: '../private', before: 1 }])
    await assert.rejects(history.request(args, fetch), { code: 'INVALID_INPUT' });
  await assert.rejects(history.request({ chat: '15551234568@s.whatsapp.net', before: 1 }, fetch), { code: 'NOT_FOUND' });
  assert.equal(calls, 0);
  const request = await history.request({ chat, before: 1, limit: 2 }, fetch);
  assert.equal(request.state, 'requested');
  await assert.rejects(history.request({ chat, before: 1, limit: 2 }, fetch), { code: 'HISTORY_BUSY' });
  assert.equal(calls, 1);
  assert.equal((await stat(store.path('history-request.json'))).mode & 0o777, 0o600);
  const policy = new Policy(store); await policy.change('policy', { mode: 'all' });
  const batch = { syncType: 6, peerDataRequestSessionId: 'session', messages: [message('one'), message('one'), message('other', '15551234568@s.whatsapp.net'), message('two'), message('excess')] };
  await history.receive({ ...batch, syncType: 0 }, x => x, 6);
  await history.receive({ ...batch, peerDataRequestSessionId: 'unrequested' }, x => x, 6);
  assert.equal((await store.messages()).messages.length, 1);
  await history.receive(batch, x => x, 6);
  assert.equal((await history.status()).received, 2);
  const rows = (await store.messages()).messages;
  assert.deepEqual(rows.slice(1).map(r => r.id), ['one', 'two']);
  assert.ok(rows.slice(1).every(r => r.source === 'history'));
  assert.deepEqual((await policy.events()).events, []);
  const restarted = new History(store);
  // Simulate a crash after rows committed but before request counters did.
  await writeJSON(store.path('history-request.json'), request);
  assert.equal((await restarted.status()).received, 2);
  await restarted.receive(batch, x => x, 6);
  assert.equal((await restarted.status()).received, 2);
  assert.equal((await store.messages()).messages.length, 3);
});
test('requests preserve uncertainty, expire without retries and reject late responses', async t => {
  const { store, history } = await fixture(t);
  const args = { chat, before: 1 };
  const uncertain = await history.request(args, async () => { throw new Error('lost ack'); });
  assert.equal(uncertain.state, 'uncertain');
  await assert.rejects(history.request(args, async () => 'retry'), { code: 'HISTORY_BUSY' });
  await writeJSON(store.path('history-request.json'), { ...uncertain, expiresAt: 1 });
  const request = await history.request(args, async () => 'session');
  await writeJSON(store.path('history-request.json'), { ...request, expiresAt: 1 });
  assert.equal((await history.status()).state, 'expired');
  await history.receive({ syncType: 6, peerDataRequestSessionId: 'session', messages: [message('late')] }, x => x, 6);
  assert.equal((await store.messages()).messages.length, 1);
});
test('socket commands scope history by account and native events never capture unsolicited history', async t => {
  const { store } = await fixture(t, false);
  const sockets = [];
  const provider = { ...lib, default: config => {
    assert.equal(config.shouldSyncHistoryMessage, undefined);
    const socket = { ev: new EventEmitter(), user: { id: '15551230000:1@s.whatsapp.net' }, end() {},
      fetchMessageHistory: async () => 'session' };
    sockets.push(socket); return socket;
  } };
  const running = await serve(store.dir, s => createTransport(s, provider));
  t.after(async () => { await running.close(); await rm(store.dir, { recursive: true, force: true }); });
  await assert.rejects(client(store.dir, 'history', { chat, before: 1 }), { code: 'UNAVAILABLE' });
  sockets[0].ev.emit('connection.update', { connection: 'open' });
  await new Promise(r => setTimeout(r, 30));
  await client(store.dir, 'account-add', { account: 'work' });
  await assert.rejects(client(store.dir, 'history', { chat, before: 1 }), { code: 'ACCOUNT_REQUIRED' });
  await client(store.dir, 'history', { account: 'default', chat, before: 1 });
  assert.equal((await client(store.dir, 'history-status', { account: 'work' })).state, 'none');
  sockets[0].ev.emit('messaging-history.set', { syncType: 6, peerDataRequestSessionId: 'session', messages: [message('older')] });
  for (let i = 0; i < 100; i++) {
    if ((await client(store.dir, 'history-status', { account: 'default' })).state === 'received') break;
    await new Promise(r => setTimeout(r, 5));
  }
  assert.equal((await client(store.dir, 'history-status', { account: 'default' })).received, 1);
  assert.equal((await client(store.dir, 'inbox', { account: 'work' })).messages.length, 0);
});

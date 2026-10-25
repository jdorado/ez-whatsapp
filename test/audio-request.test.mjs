import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import * as baileys from '@whiskeysockets/baileys';
import { Store, hash } from '../src/store.mjs';
import { Policy } from '../src/policy.mjs';
import { createTransport } from '../src/transport.mjs';
import { serve, client } from '../src/service.mjs';
import { Audio } from '../src/audio.mjs';

const chat = '12345678901234@lid', phone = '15551234567@s.whatsapp.net';
const voice = (id = 'voice') => ({ key: { id, remoteJid: chat, remoteJidAlt: phone, fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000) - 10,
  message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 3, fileLength: 5, url: 'https://mmg.whatsapp.net/audio', mediaKey: Buffer.from('private-media-key') } } });
const row = () => ({ id: 'voice', chat, phoneJid: phone, participant: null, fromMe: false, source: 'notify', timestamp: voice().messageTimestamp, type: 'audioMessage', text: null, mediaAvailable: true });
async function fixture(t, cleanup = true) {
  const dir = await mkdtemp(join(tmpdir(), 'ezwa-request-'));
  if (cleanup) t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir); await store.init();
  let downloads = 0, requests = 0;
  const lib = { ...baileys, downloadContentFromMessage: async () => { downloads++; return Readable.from([Buffer.from('audio')]); } };
  const fetch = async () => { requests++; return Response.json({ responseId: 'speech-receipt', candidates: [{ content: { parts: [{ text: 'Original-language transcript.' }] } }] }); };
  const audio = new Audio(store, lib, fetch); await audio.init(); await audio.configure({ geminiApiKey: 'private-test-key-123456789' });
  return { store, audio, lib, fetch, counts: () => ({ downloads, requests }) };
}
test('quiet capture retains only a private source; explicit concurrent reads transcribe once without attention', async t => {
  const f = await fixture(t), captured = await f.audio.capture(voice(), row());
  assert.deepEqual(captured.transcription, { state: 'skipped', code: 'CHAT_NOT_WATCHED' });
  assert.deepEqual(f.counts(), { downloads: 0, requests: 0 });
  await f.store.ingest(captured);
  const id = hash(JSON.stringify([chat, 'voice', false, null]));
  assert.equal((await stat(f.store.path(`audio-sources/${id}.bin`))).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify((await f.store.messages()).messages).includes('private-media-key'));
  const results = await Promise.all([f.audio.request(captured), f.audio.request(captured)]);
  assert.ok(results.every(r => r.text === 'Original-language transcript.'));
  assert.equal(results[0].transcription.responseId, 'speech-receipt');
  assert.deepEqual(f.counts(), { downloads: 1, requests: 1 });
  await f.audio.request(captured);
  assert.deepEqual(f.counts(), { downloads: 1, requests: 1 });
  const policy = new Policy(f.store);
  assert.equal((await policy.get()).mode, 'manual');
  assert.deepEqual((await policy.events()).events, []);
});
test('retained original supports explicit retry without download; hash changes and missing configuration fail closed', async t => {
  const f = await fixture(t);
  await f.store.ingest(await f.audio.capture(voice(), row()));
  f.audio.fetch = async () => new Response('', { status: 503 });
  const failed = await f.audio.request(row());
  assert.equal(failed.transcription.code, 'TRANSCRIPTION_REJECTED');
  f.audio.fetch = f.fetch;
  const transcript = await f.audio.request(row());
  assert.equal(transcript.transcription.state, 'transcribed');
  assert.equal(f.counts().downloads, 1);
  await f.store.updateMessage({ ...transcript, text: null, transcription: { ...transcript.transcription, state: 'failed' } });
  const id = hash(JSON.stringify([chat, 'voice', false, null]));
  await writeFile(f.store.path(`audio/${id}.bin`), 'wrong');
  await assert.rejects(f.audio.request(row()), { code: 'AUDIO_CHANGED' });
  await f.audio.configure({ geminiApiKey: null });
  await assert.rejects(f.audio.request(row()), { code: 'AUDIO_UNCONFIGURED' });
});
test('account-scoped command recovers only the chosen historical audio, preserving policy and deduplicating provider responses', async t => {
  const f = await fixture(t, false); await f.store.ingest(row());
  await f.store.ingest({ ...row(), id: 'newer', timestamp: row().timestamp + 1, type: 'conversation', text: 'Newer anchor' });
  const sockets = [];
  const lib = { ...f.lib, default: () => {
    const socket = { ev: new EventEmitter(), user: { id: '15551230000:1@s.whatsapp.net' }, end() {},
      fetchMessageHistory: async (count, key) => { assert.equal(count, 50); assert.equal(key.remoteJid, chat); assert.equal(key.id, 'newer'); return 'history-receipt'; } };
    sockets.push(socket); return socket;
  } };
  const running = await serve(f.store.dir, store => createTransport(store, lib, { fetch: f.fetch }));
  t.after(async () => { await running.close(); await rm(f.store.dir, { recursive: true, force: true }); });
  sockets[0].ev.emit('connection.update', { connection: 'open' });
  const until = async condition => { for (let i = 0; i < 200; i++) { if (await condition()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Provider event did not settle'); };
  await until(() => running.service.transport.status().connected);
  await assert.rejects(client(f.store.dir, 'audio-transcribe', { chat: phone, seq: 1.5 }), { code: 'INVALID_INPUT' });
  await assert.rejects(client(f.store.dir, 'audio-transcribe', { chat: '15559999999@s.whatsapp.net', seq: 1 }), { code: 'NOT_FOUND' });
  await assert.rejects(client(f.store.dir, 'audio-transcribe', { chat, seq: 2 }), { code: 'NOT_FOUND' });
  const request = await client(f.store.dir, 'audio-transcribe', { chat: phone, seq: 1 });
  assert.equal(request.recovery.state, 'requested');
  assert.equal((await client(f.store.dir, 'audio-transcribe', { chat, seq: 1 })).recovery.id, request.recovery.id);
  const batch = { syncType: 6, peerDataRequestSessionId: 'history-receipt', messages: [voice('unrequested'), voice()] };
  sockets[0].ev.emit('messaging-history.set', { ...batch, peerDataRequestSessionId: 'wrong' });
  sockets[0].ev.emit('messaging-history.set', batch);
  await until(async () => (await client(f.store.dir, 'inbox')).messages[0].transcription?.state === 'transcribed');
  await until(async () => (await client(f.store.dir, 'history-status')).state === 'received');
  sockets[0].ev.emit('messaging-history.set', batch);
  await running.service.transport.historyStatus();
  const result = await client(f.store.dir, 'audio-transcribe', { chat: phone, seq: 1 });
  assert.equal(result.message.id, 'voice'); assert.equal(result.message.seq, 1);
  assert.equal(result.message.source, 'notify'); assert.equal(result.message.text, 'Original-language transcript.');
  assert.deepEqual(f.counts(), { downloads: 1, requests: 1 });
  assert.equal((await client(f.store.dir, 'inbox')).messages.length, 2);
  const status = await client(f.store.dir, 'history-status');
  assert.equal(status.state, 'received'); assert.equal(status.received, 1);
  assert.equal(status.transcription.responseId, 'speech-receipt');
  assert.equal((await client(f.store.dir, 'policy')).mode, 'manual');
  assert.deepEqual((await running.service.policy.events()).events, []);
  await client(f.store.dir, 'account-add', { account: 'work' });
  await assert.rejects(client(f.store.dir, 'audio-transcribe', { chat, seq: 1 }), { code: 'ACCOUNT_REQUIRED' });
  await assert.rejects(client(f.store.dir, 'audio-transcribe', { account: 'work', chat, seq: 1 }), { code: 'NOT_FOUND' });
  await running.store.ingest({ ...row(), id: 'group', chat: '123456789@g.us' });
  await assert.rejects(client(f.store.dir, 'audio-transcribe', { account: 'default', chat: phone, seq: 3 }), { code: 'NOT_FOUND' });
  await running.store.ingest({ ...row(), id: 'own', fromMe: true });
  await assert.rejects(client(f.store.dir, 'audio-transcribe', { account: 'default', chat, seq: 4 }), { code: 'NOT_FOUND' });
});
test('duplicate history never retries failed speech, including after an explicit retry of that note', async t => {
  const f = await fixture(t); await f.store.ingest(row());
  await f.store.ingest({ ...row(), id: 'anchor', timestamp: row().timestamp + 1, type: 'conversation' });
  let uploads = 0;
  f.audio.fetch = async () => { uploads++; return new Response('', { status: 503 }); };
  const { History } = await import('../src/history.mjs');
  const history = new History(f.store, undefined, async (message, original) => {
    await f.audio.remember(message, original); return f.audio.request(original);
  });
  const original = (await f.store.messages()).messages[0];
  await history.requestAudio(original, async () => 'history-session');
  const batch = { syncType: 6, peerDataRequestSessionId: 'history-session', messages: [voice()] };
  await history.receive(batch, f.lib.normalizeMessageContent, 6);
  await history.receive(batch, f.lib.normalizeMessageContent, 6);
  assert.equal(uploads, 1);
  assert.equal((await history.status()).received, 1);
  assert.equal((await f.store.messages()).messages[0].transcription.code, 'TRANSCRIPTION_REJECTED');
  await f.audio.request(original);
  await history.receive(batch, f.lib.normalizeMessageContent, 6);
  assert.equal(uploads, 2);
});
test('a recovery claim survives interrupted speech and prevents automatic upload after restart', async t => {
  const f = await fixture(t); await f.store.ingest(row());
  await f.store.ingest({ ...row(), id: 'anchor', timestamp: row().timestamp + 1, type: 'conversation' });
  const { History } = await import('../src/history.mjs');
  let calls = 0;
  const interrupted = new History(f.store, undefined, async (_message, original) => {
    calls++;
    await f.store.updateMessage({ ...original, transcription: { state: 'processing' } });
    throw new Error('Simulated interruption after provider submission');
  });
  await interrupted.requestAudio((await f.store.messages()).messages[0], async () => 'history-session');
  const batch = { syncType: 6, peerDataRequestSessionId: 'history-session', messages: [voice()] };
  await assert.rejects(interrupted.receive(batch, f.lib.normalizeMessageContent, 6), /Simulated interruption/);
  const restartedAudio = new Audio(f.store, f.lib, f.fetch); await restartedAudio.init();
  const restartedHistory = new History(f.store, undefined, async () => { calls++; assert.fail('An interrupted upload must not be retried'); });
  await restartedHistory.receive(batch, f.lib.normalizeMessageContent, 6);
  assert.equal(calls, 1);
  assert.equal((await restartedHistory.status()).received, 1);
  assert.equal((await f.store.messages()).messages[0].transcription.code, 'TRANSCRIPTION_INTERRUPTED');
});
test('old note without a retained source or newer anchor returns a specific recovery limitation', async t => {
  const f = await fixture(t); await f.store.ingest(row());
  const { History } = await import('../src/history.mjs');
  await assert.rejects(new History(f.store).requestAudio((await f.store.messages()).messages[0], async () => assert.fail('No provider request expected')), { code: 'AUDIO_SOURCE_MISSING' });
  assert.deepEqual(f.counts(), { downloads: 0, requests: 0 });
});
test('restart with a large inbox stays within the startup health budget and repairs interrupted notes throughout it', { timeout: 60000 }, async t => {
  const f = await fixture(t), rows = Array.from({ length: 8000 }, (_, i) => ({ ...row(), id: `large-${i}`, seq: i + 1,
    ...(i === 0 || i === 7999 ? { transcription: { state: 'processing' } } : {}) }));
  for (let offset = 0; offset < rows.length; offset += 100)
    await Promise.all(rows.slice(offset, offset + 100).map(r => writeFile(f.store.messagePath(r), JSON.stringify(r), { mode: 0o600 })));
  const started = performance.now();
  await new Audio(f.store, f.lib, f.fetch).init();
  assert.ok(performance.now() - started < 30000, 'Startup must leave margin within the 60-second service health window');
  for (const r of [rows[0], rows.at(-1)]) assert.equal((await f.store.readMessage(r)).transcription.code, 'TRANSCRIPTION_INTERRUPTED');
  assert.deepEqual(f.counts(), { downloads: 0, requests: 0 });
});

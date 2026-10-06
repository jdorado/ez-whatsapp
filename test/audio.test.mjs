import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { Audio, maxAudioBytes } from '../src/audio.mjs';
import { Store, hash } from '../src/store.mjs';
import { Policy } from '../src/policy.mjs';
import { createTransport } from '../src/transport.mjs';
import * as baileys from '@whiskeysockets/baileys';

const contact = '15551234567@s.whatsapp.net';
const key = 'fixture-private-key-123456789';
const voice = () => ({ key: { id: 'voice-1', remoteJid: contact, fromMe: false }, messageTimestamp: Date.now() / 1000,
  message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 4, fileLength: 5, url: 'https://mmg.whatsapp.net/audio', mediaKey: Buffer.from('fixture') } } });
const row = () => ({ id: 'voice-1', chat: contact, participant: null, fromMe: false, source: 'notify', timestamp: Date.now() / 1000, type: 'audioMessage', text: null, mediaAvailable: true });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ezwa-audio-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir); await store.init();
  const policy = new Policy(store); await policy.watch(contact, Date.now() + 3600000);
  let downloads = 0, requests = 0;
  const lib = { ...baileys, downloadContentFromMessage: async () => { downloads++; return Readable.from([Buffer.from('audio')]); } };
  const fetch = async (url, options) => {
    requests++;
    assert.equal(new URL(url).hostname, 'generativelanguage.googleapis.com');
    assert.equal(options.headers['x-goog-api-key'], key);
    assert.equal(JSON.parse(options.body).contents[0].parts[1].inlineData.data, Buffer.from('audio').toString('base64'));
    return new Response(JSON.stringify({ responseId: 'receipt-1', candidates: [{ content: { parts: [{ text: 'El proveedor llegó tarde.' }] } }] }));
  };
  const audio = new Audio(store, lib, fetch); await audio.init();
  await audio.configure({ geminiApiKey: key });
  return { store, policy, audio, lib, fetch, counts: () => ({ downloads, requests }) };
}
test('watched voice captures a sourced transcript; credentials and originals stay private', async t => {
  const f = await fixture(t); const result = await f.audio.capture(voice(), row());
  assert.equal(result.text, 'El proveedor llegó tarde.');
  assert.equal(result.transcription.state, 'transcribed');
  assert.equal(result.transcription.responseId, 'receipt-1');
  const file = f.store.path(`audio/${hash(JSON.stringify([contact, 'voice-1', false, null]))}.bin`);
  assert.equal((await readFile(file)).toString(), 'audio'); assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(f.store.path('audio-config.json'))).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(f.audio.status()).includes(key)); assert.ok(!JSON.stringify(result).includes(key));
  await f.audio.configure({ geminiApiKey: null });
  assert.equal(f.audio.status().configured, false);
  assert.equal((await f.audio.capture(voice(), row())).transcription.state, 'unconfigured');
});
test('unwatched, outgoing, historical and revoked audio never reaches transcription', async t => {
  const f = await fixture(t);
  for (const candidate of [{ ...row(), chat: '15559999999@s.whatsapp.net' }, { ...row(), fromMe: true }, { ...row(), source: 'history' }])
    assert.equal((await f.audio.capture(voice(), candidate)).text, null);
  assert.deepEqual(f.counts(), { downloads: 0, requests: 0 });
  f.lib.downloadContentFromMessage = async () => { await f.policy.unwatch(contact); return Readable.from([Buffer.from('audio')]); };
  assert.equal((await f.audio.capture(voice(), row())).text, null);
  assert.equal(f.counts().requests, 0);
});
test('size and source validation rejects unsafe media before egress; streamed size is enforced', async t => {
  const f = await fixture(t);
  const oversized = voice(); oversized.message.audioMessage.fileLength = maxAudioBytes + 1;
  assert.equal((await f.audio.capture(oversized, row())).transcription.code, 'AUDIO_TOO_LARGE');
  for (const url of ['http://mmg.whatsapp.net/a', 'https://127.0.0.1/a', 'https://whatsapp.net.attacker.test/a', 'https://key@mmg.whatsapp.net/a']) {
    const message = voice(); message.message.audioMessage.url = url;
    assert.equal((await f.audio.capture(message, row())).transcription.code, 'AUDIO_SOURCE_INVALID');
  }
  assert.deepEqual(f.counts(), { downloads: 0, requests: 0 });
  f.lib.downloadContentFromMessage = async () => Readable.from([Buffer.alloc(maxAudioBytes), Buffer.from('x')]);
  assert.equal((await f.audio.capture(voice(), row())).transcription.code, 'AUDIO_TOO_LARGE');
  assert.equal(f.counts().requests, 0);
});
test('transcription errors preserve capture and never expose provider errors or retry', async t => {
  const f = await fixture(t); let calls = 0;
  f.audio.fetch = async () => { calls++; throw new Error(key); };
  const result = await f.audio.capture(voice(), row());
  assert.equal(result.text, null); assert.equal(result.transcription.code, 'TRANSCRIPTION_FAILED');
  assert.ok(!JSON.stringify(result).includes(key)); assert.equal(calls, 1);
});
test('real provider event path deduplicates speech and dispatches transcript through the existing watch', async t => {
  const f = await fixture(t); let socket;
  const lib = { ...f.lib, default: () => (socket = { ev: new EventEmitter(), user: { id: '15551230000:1@s.whatsapp.net' }, end() {} }) };
  const transport = await createTransport(f.store, lib, { fetch: f.fetch });
  t.after(() => transport.close()); await transport.start();
  socket.ev.emit('connection.update', { connection: 'open' });
  const until = async condition => { for (let i = 0; i < 200; i++) { if (await condition()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Provider event did not settle'); };
  await until(() => transport.status().connected);
  socket.ev.emit('messages.upsert', { type: 'notify', messages: [voice(), voice()] });
  await until(async () => (await f.store.messages()).messages.length === 1);
  await transport.close();
  assert.deepEqual(f.counts(), { downloads: 1, requests: 1 });
  const events = await f.policy.events(); assert.equal(events.events.length, 1);
  const content = JSON.parse(events.events[0].text);
  assert.equal(content.type, 'audioMessage'); assert.equal(content.text, 'El proveedor llegó tarde.');
  assert.equal(content.transcription.state, 'transcribed');
});

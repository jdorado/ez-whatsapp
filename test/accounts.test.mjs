import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { serve, client } from '../src/service.mjs';

const exec = promisify(execFile);
const bin = new URL('../bin/ez-whatsapp.mjs', import.meta.url).pathname;
const jids = { default: '15550000000@s.whatsapp.net', sales: '15550000001@s.whatsapp.net', bookings: '15550000002@s.whatsapp.net' };
async function fixture(t) {
  // Short path also exercises Unix sockets on macOS.
  const dir = await mkdtemp(join(tmpdir(), 'wa-'));
  const transports = new Map();
  const create = async store => {
    const name = store.dir === dir ? 'default' : basename(store.dir);
    const status = { connected: true, state: 'connected', account: { jid: jids[name] } };
    const transport = { store, status: () => ({ ...status }), sends: 0, closes: 0,
      async start() {}, async close() { this.closes++; },
      async verify(jid) { return { exists: true, jid }; },
      async send(jid, text, id) { this.sends++; return { id }; },
      async repair() { return { repaired: name }; }
    };
    transport.setStatus = update => Object.assign(status, update);
    transports.set(name, transport);
    return transport;
  };
  let running = await serve(dir, create);
  t.after(async () => { await running.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, transports, call: (command, args) => client(dir, command, args),
    async restart() { await running.close(); running = await serve(dir, create); }
  };
}
const send = { to: '+15551234567', text: 'fixture', key: 'same-key' };

test('named accounts isolate receipts, inbox, policy and task identity across restart', async t => {
  const f = await fixture(t);
  const legacy = await f.call('send', send);
  await f.call('account-add', { account: 'sales', purpose: 'Sales enquiries' });
  await f.call('account-add', { account: 'bookings', purpose: 'Reservations' });
  for (const command of ['send', 'inbox', 'verify', 'qr', 'repair', 'policy', 'operation'])
    await assert.rejects(f.call(command, send), { code: 'ACCOUNT_REQUIRED' });
  assert.equal((await f.call('doctor')).account.jid, jids.default);
  await assert.rejects(f.call('send', { ...send, account: 'missing' }), { code: 'ACCOUNT_NOT_FOUND' });
  const sales = await f.call('send', { ...send, account: 'sales' });
  const bookings = await f.call('send', { ...send, account: 'bookings' });
  assert.notEqual(sales.providerMessageId, bookings.providerMessageId);
  assert.equal(sales.account.jid, jids.sales);
  assert.equal(bookings.account.jid, jids.bookings);
  assert.equal((await f.call('send', { ...send, account: 'sales' })).replayed, true);
  assert.equal(f.transports.get('sales').sends, 1);
  await f.transports.get('sales').store.ingest({ id: 'inbound', chat: send.to, text: 'sales only' });
  assert.equal((await f.call('inbox', { account: 'bookings' })).messages.length, 0);
  assert.equal((await f.call('inbox', { account: 'sales' })).messages[0].text, 'sales only');
  await f.call('policy', { account: 'sales', mode: 'all' });
  assert.equal((await f.call('policy', { account: 'bookings' })).mode, 'manual');
  const listed = (await f.call('accounts')).accounts;
  const salesSocket = listed.find(a => a.name === 'sales').socket;
  assert.equal((await client(f.dir, 'events-head', {}, salesSocket)).accountId, jids.sales);
  assert.equal((await f.call('events-head')).accountId, jids.default);
  await assert.rejects(client(f.dir, 'send', { ...send, account: 'bookings' }, salesSocket), { code: 'ACCOUNT_MISMATCH' });
  await assert.rejects(client(f.dir, 'task-send', { accountId: jids.bookings, conversationId: '15551234567@s.whatsapp.net', key: 'task', text: 'wrong' }, salesSocket), { code: 'ACCOUNT_MISMATCH' });
  const task = await client(f.dir, 'task-send', { accountId: jids.sales, conversationId: '15551234567@s.whatsapp.net', key: 'task', text: 'right' }, salesSocket);
  assert.equal(task.accountId, jids.sales);
  await f.restart();
  assert.equal((await f.call('accounts')).accounts.find(a => a.name === 'sales').purpose, 'Sales enquiries');
  assert.equal((await f.call('operation', { account: 'default', key: send.key })).providerMessageId, legacy.providerMessageId);
  assert.equal((await f.call('operation', { account: 'sales', key: send.key })).providerMessageId, sales.providerMessageId);
  assert.equal((await f.call('operation', { account: 'bookings', key: send.key })).providerMessageId, bookings.providerMessageId);
  assert.equal((await f.call('policy', { account: 'sales' })).mode, 'all');
  assert.equal((await stat(join(f.dir, 'accounts.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(join(f.dir, 'accounts', 'sales'))).mode & 0o777, 0o700);
});

test('invalid account names and duplicate concurrent additions cannot escape or replace profiles', async t => {
  const f = await fixture(t);
  for (const account of ['../outside', '/tmp/account', 'default', '.', '', 'a/b', 'Sales', 'x'.repeat(33)])
    await assert.rejects(f.call('account-add', { account }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.call('account-add', { account: 'sales', purpose: 'x'.repeat(241) }), { code: 'INVALID_INPUT' });
  const results = await Promise.allSettled([f.call('account-add', { account: 'sales' }), f.call('account-add', { account: 'sales' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'ACCOUNT_EXISTS');
  assert.equal((await f.call('accounts')).accounts.length, 2);
});

test('separate CLI selects account and returns its QR without profile access', async t => {
  const f = await fixture(t);
  const socket = join(f.dir, 'service.sock');
  const run = async args => JSON.parse((await exec(process.execPath, [bin, ...args, '--socket', socket])).stdout).data;
  await run(['account-add', '--account', 'sales', '--purpose', 'Sales']);
  assert.equal((await run(['setup', '--account', 'sales'])).account.jid, jids.sales);
  const qrPath = f.transports.get('sales').store.qrPath;
  assert.equal(qrPath, join(`${socket}.accounts`, 'sales.png'));
  await writeFile(qrPath, Buffer.from('synthetic-png'));
  f.transports.get('sales').setStatus({ connected: false, qrPath, qrCreatedAt: '2026-09-13T00:00:00Z' });
  const qr = await run(['qr', '--account', 'sales']);
  assert.equal(Buffer.from(qr.base64, 'base64').toString(), 'synthetic-png');
  f.transports.get('sales').setStatus({ qrRemainingMs: 0 });
  await assert.rejects(f.call('qr', { account: 'sales' }), { code: 'QR_UNAVAILABLE' });
  await assert.rejects(run(['qr', '--account', 'default']));
  assert.deepEqual(await run(['repair', '--account', 'sales']), { repaired: 'sales' });
});

test('corrupt registries and symlink account parents fail closed without touching outside state', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'wa-'));
  const outside = await mkdtemp(join(tmpdir(), 'wa-out-'));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  const create = async () => ({ status: () => ({}), start: async () => {}, close: async () => {} });
  await writeFile(join(dir, 'accounts.json'), JSON.stringify([{ name: '../escape', purpose: '' }]));
  await assert.rejects(serve(dir, create), { code: 'CORRUPT_STATE' });
  await writeFile(join(dir, 'accounts.json'), JSON.stringify([{ name: 'sales', purpose: '' }]));
  await symlink(outside, join(dir, 'accounts'));
  const running = await serve(dir, create);
  try {
    const accounts = (await client(dir, 'accounts')).accounts;
    assert.equal(accounts.find(a => a.name === 'sales').errorCode, 'UNSAFE_PATH');
    await assert.rejects(client(dir, 'doctor', { account: 'sales' }), { code: 'ACCOUNT_NOT_FOUND' });
    await client(dir, 'doctor'); // A failed named profile must not disable default.
  } finally { await running.close(); }
  await assert.rejects(readFile(join(outside, 'sales', 'writer.lock')), { code: 'ENOENT' });
});

test('overlong named sockets are rejected before registration and root sockets have isolated namespaces', async t => {
  const dir = await mkdtemp('/tmp/wa-');
  const a = join(dir, 'a'), b = join(dir, 'b');
  const create = async () => ({ status: () => ({ connected: true }), start: async () => {}, close: async () => {} });
  const longSocket = join(dir, 's'.repeat(65 - dir.length) + '.sock');
  const first = await serve(a, create, longSocket);
  const otherSocket = join(dir, 'other.sock');
  const second = await serve(b, create, otherSocket);
  let restarted;
  t.after(async () => { await first.close(); await second.close(); await restarted?.close(); await rm(dir, { recursive: true, force: true }); });
  await assert.rejects(client(a, 'account-add', { account: 'x'.repeat(32) }, longSocket), { code: 'INVALID_INPUT' });
  assert.equal((await client(a, 'accounts', {}, longSocket)).accounts.length, 1);
  await assert.rejects(readFile(join(a, 'accounts.json')), { code: 'ENOENT' });
  await first.close();
  restarted = await serve(a, create, longSocket);
  assert.equal((await client(a, 'doctor', {}, longSocket)).connected, true);
  const namedA = await client(a, 'account-add', { account: 'sales' }, longSocket);
  const namedB = await client(b, 'account-add', { account: 'sales' }, otherSocket);
  assert.notEqual(namedA.socket, namedB.socket);
  assert.equal((await client(a, 'doctor', {}, namedA.socket)).profile, join(a, 'accounts', 'sales'));
  assert.equal((await client(b, 'doctor', {}, namedB.socket)).profile, join(b, 'accounts', 'sales'));
});

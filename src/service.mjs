import { createServer } from 'node:http';
import { chmod, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store, lock, fail, hash, privateDir } from './store.mjs';
import { recipient } from './messages.mjs';
import { Policy } from './policy.mjs';

export class Service {
  constructor(store, transport) { this.store = store; this.transport = transport; this.policy = new Policy(store); }
  async call(command, args = {}) {
    if (command === 'repair') return this.transport.repair();
    if (command === 'doctor') return { ...this.transport.status(), profile: this.store.dir, capabilities: ['send-text', 'read-captured-messages'], eventSource: true, wakePolicy: await this.policy.get(), hostDispatchRequired: true };
    if (command === 'policy') return args.mode === undefined ? this.policy.get() : this.policy.change(command, args);
    if (['subscribe', 'unsubscribe'].includes(command)) return this.policy.change(command, args);
    if (command === 'events-head') return { cursor: await this.policy.head(), taskProtocol: 'message-v1', persistentWatch: true, accountId: this.transport.status().account?.jid ?? null };
    if (command === 'task-unwatch') {
      this.checkTaskAccount(args.accountId);
      const chat = recipient(args.conversationId);
      if (chat !== args.conversationId) throw fail('INVALID_INPUT', 'Task conversation must be one canonical chat');
      return this.policy.unwatch(chat);
    }
    if (command === 'task-watch') {
      this.checkTaskAccount(args.accountId);
      const chat = recipient(args.conversationId);
      if (chat !== args.conversationId) throw fail('INVALID_INPUT', 'Task conversation must be one canonical chat');
      return this.policy.watch(chat, args.expiresAt);
    }
    if (command === 'task-send') {
      this.checkTaskAccount(args.accountId);
      const to = recipient(args.conversationId);
      if (to !== args.conversationId) throw fail('INVALID_INPUT', 'Task conversation must be one canonical chat');
      const op = await this.call('send', { to, text: args.text, key: args.key, expectedAccount: args.accountId });
      if (op.account?.jid !== args.accountId) throw fail('ACCOUNT_MISMATCH', 'Operation belongs to another account');
      return { accountId: args.accountId, conversationId: op.to, key: op.key, state: ['accepted', 'delivered', 'read'].includes(op.state) ? 'accepted' : 'uncertain', receiptId: op.providerMessageId };
    }
    if (command === 'events') return this.policy.events(args.after);
    if (command === 'events-check') return this.policy.check(args.ids);
    if (command === 'inbox') {
      const after = args.after ?? 0, limit = args.limit ?? 20;
      if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw fail('INVALID_INPUT', 'after must be >= 0 and limit 1..100');
      return this.store.messages(after, limit, args.chat ? recipient(args.chat) : undefined);
    }
    if (command === 'operation') {
      if (!args.key) throw fail('INVALID_INPUT', 'Supply --idempotency-key');
      const op = await this.store.operation(args.key);
      if (!op) throw fail('NOT_FOUND', 'Operation not found in this profile');
      return op;
    }
    if (command === 'verify') return this.transport.verify(recipient(args.to));
    if (command !== 'send') throw fail('INVALID_INPUT', 'Unknown command');
    const to = recipient(args.to);
    if (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 4096) throw fail('INVALID_INPUT', 'Text must contain 1..4096 characters');
    if (typeof args.key !== 'string' || !/^[\w:.-]{1,160}$/.test(args.key)) throw fail('INVALID_INPUT', 'Supply a stable idempotency key (1..160 letters, digits, :, ., _, -)');
    if (args.preview) return { preview: true, to, text: args.text, key: args.key, account: this.transport.status().account };
    return this.store.serial(async () => {
      if (args.expectedAccount) this.checkTaskAccount(args.expectedAccount);
      const digest = hash(JSON.stringify([to, args.text]));
      const prior = await this.store.operation(args.key);
      if (prior) {
        if (prior.digest !== digest) throw fail('KEY_CONFLICT', 'Key belongs to a different payload');
        if (['pending', 'uncertain'].includes(prior.state)) throw fail('UNCERTAIN', 'Submission may have happened; inspect operation and WhatsApp before any new send');
        return { ...prior, replayed: true };
      }
      if (!this.transport.status().connected) throw fail('UNAVAILABLE', 'WhatsApp is not connected; inspect doctor');
      const verified = await this.transport.verify(to);
      if (args.expectedAccount) this.checkTaskAccount(args.expectedAccount);
      if (!verified.exists) throw fail('NOT_FOUND', 'Recipient could not be verified');
      const op = { key: args.key, digest, to, account: this.transport.status().account, state: 'pending', providerMessageId: randomBytes(16).toString('hex').toUpperCase(), createdAt: new Date().toISOString() };
      await this.store.saveOperation(op);
      try {
        if (args.expectedAccount) this.checkTaskAccount(args.expectedAccount);
        const result = await this.transport.send(to, args.text, op.providerMessageId, args.expectedAccount);
        if (result?.id !== op.providerMessageId) throw fail('UNCERTAIN', 'Missing expected provider message ID');
        op.state = 'accepted'; // socket acceptance is not recipient delivery
        op.acceptedAt = new Date().toISOString();
        await this.store.saveOperation(op);
        return op;
      } catch {
        op.state = 'uncertain';
        await this.store.saveOperation(op);
        throw fail('UNCERTAIN', 'Send outcome uncertain; query operation with the same key. Do not resend.');
      }
    });
  }
  checkTaskAccount(accountId) {
    const status = this.transport.status();
    if (typeof accountId !== 'string' || !accountId || !status.connected || status.account?.jid !== accountId)
      throw fail('ACCOUNT_MISMATCH', 'Task account is disconnected or changed');
  }
  async receipt(id, state) {
    const { readdir } = await import('node:fs/promises');
    const { readJSON } = await import('./store.mjs');
    await this.store.serial(async () => {
      for (const name of await readdir(this.store.path('operations'))) {
        if (!name.endsWith('.json')) continue;
        const op = await readJSON(this.store.path(`operations/${name}`));
        if (op.providerMessageId !== id) continue;
        const ranks = { pending: 0, uncertain: 0, accepted: 1, delivered: 2, read: 3 };
        if (ranks[state] > ranks[op.state]) {
          op.state = state; op.receiptAt = new Date().toISOString(); await this.store.saveOperation(op);
        }
      }
    });
  }
}
export async function serve(dir, createTransport, socketPath = join(dir, 'service.sock')) {
  const store = new Store(dir); await store.init();
  const release = await lock(store.dir);
  await privateDir(dirname(socketPath));
  if (Buffer.byteLength(socketPath) > 100) { await release(); throw fail('INVALID_INPUT', 'Choose a shorter absolute profile path (Unix socket path limit)'); }
  let transport, server;
  try {
    // Only the exclusive writer may remove a stale socket.
    await unlink(socketPath).catch(e => { if (e.code !== 'ENOENT') throw e; });
    transport = await createTransport(store);
    const service = new Service(store, transport);
    transport.onReceipt = (id, state) => service.receipt(id, state);
    server = createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      try {
        if (req.method !== 'POST' || req.url !== '/') throw fail('INVALID_INPUT', 'POST / required');
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 32768) throw fail('INVALID_INPUT', 'Request too large'); }
        let input; try { input = JSON.parse(body); } catch { throw fail('INVALID_INPUT', 'Invalid JSON'); }
        const data = await service.call(input.command, input.args);
        res.end(JSON.stringify({ ok: true, data }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: { code: e.code ?? 'INTERNAL', message: e.code ? e.message : 'Operation failed; inspect service status' } })); }
    });
    server.requestTimeout = 15000;
    await new Promise((ok, no) => { server.once('error', no); server.listen(socketPath, ok); });
    await chmod(socketPath, 0o600);
    await transport.start();
    let closed = false;
    return { service, store, close: async () => {
      if (closed) return; closed = true;
      server.close(); server.closeAllConnections();
      await transport.close(); await store.queue; await release();
    } };
  } catch (e) { server?.close(); await transport?.close(); await release(); throw e; }
}
export { client } from './client.mjs';

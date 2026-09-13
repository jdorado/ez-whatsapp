import { join } from 'node:path';
import { fail, privateDir, readJSON, writeJSON } from './store.mjs';

const validName = name => typeof name === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(name);
const validPurpose = purpose => typeof purpose === 'string' && purpose.length <= 240;
const sourceCommands = new Set(['events-head', 'events', 'events-check', 'task-watch', 'task-unwatch', 'task-send']);

// One Docker lifecycle; each named account reuses the existing isolated service.
export class Accounts {
  constructor(store, service, socketPath, open) {
    this.store = store; this.service = service; this.socketPath = socketPath; this.open = open;
    this.entries = []; this.running = new Map(); this.errors = new Map(); this.queue = Promise.resolve(); this.closed = false;
  }
  async init() {
    const entries = await readJSON(this.store.path('accounts.json'), []);
    if (!Array.isArray(entries) || entries.some(e => !e || !validName(e.name) || e.name === 'default' || !validPurpose(e.purpose)) || new Set(entries.map(e => e.name)).size !== entries.length)
      throw fail('CORRUPT_STATE', 'Invalid account registry; preserve it and investigate');
    this.entries = entries;
    for (const entry of entries) {
      try { await this.start(entry.name); } catch (e) { this.errors.set(entry.name, e.code ?? 'INTERNAL'); }
    }
  }
  paths(name) {
    // Derive the namespace from the entire root socket, not just its directory:
    // independent installations may put different root sockets side by side.
    const sockets = `${this.socketPath}.accounts`;
    const socket = join(sockets, `${name}.sock`);
    if (Buffer.byteLength(socket) > 100) throw fail('INVALID_INPUT', 'Account socket path is too long; use a shorter account name or root socket path');
    return { profiles: this.store.path('accounts'), sockets, socket, qr: join(sockets, `${name}.png`) };
  }
  async start(name) {
    const paths = this.paths(name);
    await privateDir(paths.profiles); await privateDir(paths.sockets);
    const running = await this.open(join(paths.profiles, name), paths.socket, paths.qr);
    this.running.set(name, running);
    return running;
  }
  async call(command, args = {}) {
    if (this.closed) throw fail('UNAVAILABLE', 'Service is stopping');
    if (command === 'account-add') {
      const next = this.queue.then(async () => {
        if (this.closed) throw fail('UNAVAILABLE', 'Service is stopping');
        const name = args.account, purpose = args.purpose ?? '';
        if (!validName(name) || name === 'default' || !validPurpose(purpose))
          throw fail('INVALID_INPUT', 'Use a new account name (1..32 lowercase letters, digits, _ or -, starting with a letter) and purpose up to 240 characters; default is reserved');
        if (this.entries.some(e => e.name === name)) throw fail('ACCOUNT_EXISTS', 'Account already exists; inspect doctor with --account');
        this.paths(name); // Reject deterministic path errors before registering.
        // Persist registration before opening a provider connection; restart resumes it.
        const entries = [...this.entries, { name, purpose }];
        await writeJSON(this.store.path('accounts.json'), entries);
        this.entries = entries;
        try { await this.start(name); } catch (e) { this.errors.set(name, e.code ?? 'INTERNAL'); throw e; }
        return this.describe(name, purpose);
      });
      this.queue = next.catch(() => {});
      return next;
    }
    await this.queue;
    if (command === 'accounts') return { accounts: [await this.describe('default', ''), ...await Promise.all(this.entries.map(e => this.describe(e.name, e.purpose)))] };
    const name = args.account ?? 'default';
    if (!validName(name)) throw fail('INVALID_INPUT', 'Invalid account name');
    // Existing source registrations stay bound to default. Named sources use their
    // own sockets, so cursors and core-approved account IDs never change meaning.
    if (args.account === undefined && this.entries.length && !['doctor', 'setup'].includes(command) && !sourceCommands.has(command))
      throw fail('ACCOUNT_REQUIRED', 'Multiple accounts are configured; supply --account (including default)');
    const service = name === 'default' ? this.service : this.running.get(name)?.service;
    if (!service) throw fail('ACCOUNT_NOT_FOUND', 'Account is not running; inspect accounts or restart the registered plugin');
    const { account, ...scoped } = args;
    return service.call(command, scoped);
  }
  async describe(name, purpose) {
    const service = name === 'default' ? this.service : this.running.get(name)?.service;
    return { name, purpose, socket: name === 'default' ? this.socketPath : join(`${this.socketPath}.accounts`, `${name}.sock`), ...(service ? service.transport.status() : { connected: false, state: 'unavailable', errorCode: this.errors.get(name) ?? 'UNAVAILABLE' }) };
  }
  async close() {
    this.closed = true;
    await this.queue;
    const results = await Promise.allSettled([...this.running.values()].map(r => r.close()));
    const error = results.find(r => r.status === 'rejected');
    if (error) throw error.reason;
  }
}

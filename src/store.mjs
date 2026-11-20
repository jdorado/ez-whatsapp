import { mkdir, readFile, open, rename, unlink, readdir, lstat, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
export function fail(code, message) { return Object.assign(new Error(message), { code }); }
export async function privateDir(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('UNSAFE_PATH', 'State directory must not be a symlink');
  await chmod(path, 0o700);
}
export async function readJSON(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw fail('CORRUPT_STATE', 'Cannot read state; preserve it and investigate'); }
}
export async function atomic(path, data) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, 'wx', 0o600);
  try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
  try { await rename(temp, path); } finally { await unlink(temp).catch(() => {}); }
}
export const writeJSON = (path, value) => atomic(path, JSON.stringify(value));
export async function lock(dir) {
  const path = join(dir, 'writer.lock');
  let fd;
  try { fd = await open(path, 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') throw fail('LOCKED', 'Profile is locked. Stop its service first; after a crash verify the recorded PID before removing writer.lock.'); throw e; }
  await fd.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  return async () => { await fd.close(); await unlink(path); };
}
export class Store {
  constructor(dir) { this.dir = resolve(dir); this.queue = Promise.resolve(); this.index = null; }
  async init() {
    for (const p of [this.dir, this.path('messages'), this.path('operations')]) await privateDir(p);
  }
  path(name) { return join(this.dir, name); }
  serial(fn) { const next = this.queue.then(fn); this.queue = next.catch(() => {}); return next; }
  async operation(key) { return readJSON(this.path(`operations/${hash(key)}.json`), null); }
  async saveOperation(op) { await writeJSON(this.path(`operations/${hash(op.key)}.json`), op); }
  async hasMessage(message) {
    return Boolean(await this.readMessage(message));
  }
  messagePath(message) { return this.path(`messages/${hash(JSON.stringify([message.chat, message.id, message.fromMe, message.participant]))}.json`); }
  async readMessage(message) { return readJSON(this.messagePath(message), null); }
  async updateMessage(message) {
    return this.serial(async () => {
      const old = await this.readMessage(message);
      if (!old) throw fail('NOT_FOUND', 'Captured message is missing');
      await this.save(this.messagePath(message), { ...message, seq: old.seq, capturedAt: old.capturedAt });
    });
  }
  async ingest(message) {
    return this.serial(async () => {
      const id = hash(JSON.stringify([message.chat, message.id, message.fromMe, message.participant]));
      const path = this.path(`messages/${id}.json`);
      if (await readJSON(path, null)) return false;
      const meta = await readJSON(this.path('cursor.json'), { seq: 0 });
      // Reserve before persistence: crash gaps are harmless; sequence reuse is not.
      await writeJSON(this.path('cursor.json'), { seq: meta.seq + 1 });
      await this.save(path, { ...message, seq: meta.seq + 1, capturedAt: new Date().toISOString() });
      return true;
    });
  }
  // The message files stay canonical. Reads come from a sequence-ordered index
  // loaded once per process, so a poll costs its page, not the whole inbox.
  async save(path, row) {
    const json = JSON.stringify(row);
    await atomic(path, json);
    const pending = this.index;
    const entries = pending && await pending.catch(() => null);
    if (entries) upsert(entries, { seq: row.seq, chat: row.chat, json });
  }
  load() {
    this.index ??= (async () => {
      const dir = this.path('messages'), names = (await readdir(dir)).filter(name => name.endsWith('.json')), entries = [];
      for (let i = 0; i < names.length; i += 64)
        await Promise.all(names.slice(i, i + 64).map(async name => {
          const json = await readFile(join(dir, name), 'utf8');
          let row; try { row = JSON.parse(json); } catch { throw fail('CORRUPT_STATE', 'Cannot read state; preserve it and investigate'); }
          entries.push({ seq: row.seq, chat: row.chat, json });
        }));
      return entries.sort((a, b) => a.seq - b.seq);
    })().catch(error => { this.index = null; throw error; });
    return this.index;
  }
  async messages(after = 0, limit = 20, chat) {
    const entries = await this.load();
    const page = [];
    let hasMore = false;
    for (let i = firstAfter(entries, after); i < entries.length; i++) {
      if (chat && entries[i].chat !== chat) continue;
      if (page.length === limit) { hasMore = true; break; }
      page.push(JSON.parse(entries[i].json));
    }
    return { messages: page, nextCursor: page.at(-1)?.seq ?? after, hasMore, coverage: 'captured-only', historyCoverage: 'partial-on-request' };
  }
}
function firstAfter(entries, seq) {
  let low = 0, high = entries.length;
  while (low < high) { const mid = (low + high) >> 1; if (entries[mid].seq > seq) high = mid; else low = mid + 1; }
  return low;
}
function upsert(entries, entry) {
  const at = firstAfter(entries, entry.seq - 1);
  if (entries[at]?.seq === entry.seq) entries[at] = entry; else entries.splice(at, 0, entry);
}

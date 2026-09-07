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
  constructor(dir) { this.dir = resolve(dir); this.queue = Promise.resolve(); }
  async init() {
    for (const p of [this.dir, this.path('messages'), this.path('operations')]) await privateDir(p);
  }
  path(name) { return join(this.dir, name); }
  serial(fn) { const next = this.queue.then(fn); this.queue = next.catch(() => {}); return next; }
  async operation(key) { return readJSON(this.path(`operations/${hash(key)}.json`), null); }
  async saveOperation(op) { await writeJSON(this.path(`operations/${hash(op.key)}.json`), op); }
  async ingest(message) {
    return this.serial(async () => {
      const id = hash(JSON.stringify([message.chat, message.id, message.fromMe, message.participant]));
      const path = this.path(`messages/${id}.json`);
      if (await readJSON(path, null)) return false;
      const meta = await readJSON(this.path('cursor.json'), { seq: 0 });
      // Reserve before persistence: crash gaps are harmless; sequence reuse is not.
      await writeJSON(this.path('cursor.json'), { seq: meta.seq + 1 });
      await writeJSON(path, { ...message, seq: meta.seq + 1, capturedAt: new Date().toISOString() });
      return true;
    });
  }
  async messages(after = 0, limit = 20, chat) {
    const rows = [];
    for (const name of await readdir(this.path('messages'))) {
      if (!name.endsWith('.json')) continue;
      const row = await readJSON(this.path(`messages/${name}`));
      if (row.seq > after && (!chat || row.chat === chat)) rows.push(row);
    }
    rows.sort((a, b) => a.seq - b.seq);
    return { messages: rows.slice(0, limit), nextCursor: rows.slice(0, limit).at(-1)?.seq ?? after, hasMore: rows.length > limit, coverage: 'captured-only' };
  }
}

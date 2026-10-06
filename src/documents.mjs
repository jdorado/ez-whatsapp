import { readFile, lstat } from 'node:fs/promises';
import { Policy } from './policy.mjs';
import { atomic, fail, hash, privateDir, readJSON, writeJSON } from './store.mjs';
import { downloadMedia } from './media.mjs';
export const maxDocumentBytes = 10 * 1024 * 1024;
const identity = row => hash(JSON.stringify([row.chat, row.id, row.fromMe, row.participant]));
export class Documents {
  constructor(store, lib) { this.store = store; this.lib = lib; this.policy = new Policy(store); }
  async init() {
    const rows = (await this.store.messages(0, Number.MAX_SAFE_INTEGER)).messages;
    for (const row of rows) if (row.document?.state === 'processing') await this.store.updateMessage({...row, document:{state:'failed',code:'DOCUMENT_CAPTURE_INTERRUPTED'}});
  }
  async target(row) {
    const policy = await this.policy.get(), watches = await readJSON(this.store.path('task-watches.json'), {});
    return this.policy.target({ ...row, seq: row.seq ?? await this.policy.head() + 1 }, policy, watches);
  }
  async activeTarget(row) {
    return this.target({...row,source:'notify',seq:await this.policy.head()+1,timestamp:Date.now()/1000});
  }
  async capture(message, row, stillCurrent = () => true, recovery = false) {
    const allowed = () => recovery ? this.activeTarget(row) : this.target(row);
    if (row.fromMe || row.type !== 'documentMessage' || !stillCurrent() || !await allowed()) return row;
    const media = this.lib.normalizeMessageContent(message.message)?.documentMessage;
    const name = media?.fileName;
    if (typeof name !== 'string' || !/\.(pdf|txt|md|markdown)$/i.test(name) || name.length > 255)
      return { ...row, document: { state: 'failed', code: 'DOCUMENT_UNSUPPORTED' } };
    const length = Number(media.fileLength);
    if (!Number.isSafeInteger(length) || length < 1 || length > maxDocumentBytes)
      return { ...row, document: { state: 'failed', code: 'DOCUMENT_TOO_LARGE' } };
    try {
      const bytes = await downloadMedia(this.lib, media, 'document', maxDocumentBytes);
      if (bytes.length !== length) throw fail('DOCUMENT_CHANGED', 'Document byte count changed');
      if (!stillCurrent() || !await allowed()) return row;
      await privateDir(this.store.path('documents'));
      const document = { state: 'available', name, bytes: bytes.length, sha256: hash(bytes) };
      await atomic(this.store.path(`documents/${identity(row)}.bin`), bytes);
      return { ...row, document };
    } catch (error) {
      return { ...row, document: { state: 'failed', code: ['MEDIA_SOURCE_INVALID','MEDIA_TOO_LARGE','DOCUMENT_CHANGED'].includes(error.code) ? error.code : 'DOCUMENT_DOWNLOAD_FAILED' } };
    }
  }
  async read(row) {
    const original = row.replayOf ? (await this.store.messages(row.replayOf.seq - 1, 1, row.chat)).messages[0] : row;
    if (!original || original.seq !== (row.replayOf?.seq ?? row.seq) || original.document?.state !== 'available') throw fail('NOT_FOUND', 'Captured document bytes unavailable');
    const parent = await lstat(this.store.path('documents'));
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw fail('DOCUMENT_CHANGED', 'Unsafe captured document directory');
    const file = this.store.path(`documents/${identity(original)}.bin`), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maxDocumentBytes) throw fail('DOCUMENT_CHANGED', 'Captured document changed');
    const bytes = await readFile(file);
    if (bytes.length !== original.document.bytes || hash(bytes) !== original.document.sha256) throw fail('DOCUMENT_CHANGED', 'Captured document changed');
    return { name: original.document.name, data: bytes.toString('base64'), sha256: hash(bytes) };
  }
  async replay(chat, seq) {
    if (!Number.isSafeInteger(seq) || seq < 1) throw fail('INVALID_INPUT', 'Supply one captured document seq');
    const row = (await this.store.messages(seq - 1, 1, chat)).messages[0];
    if (!row || row.seq !== seq || row.fromMe || row.type !== 'documentMessage' || row.replayOf || !await this.activeTarget(row)) throw fail('NOT_FOUND', 'Document is not in an active watched conversation');
    await this.read(row);
    // Explicit owner replay uses the existing captured-event transport; original
    // provider identity, timestamp and capture record stay unchanged.
    const replay = { ...row, id: `replay_${identity(row)}_${row.document.sha256.slice(0,16)}`, source: 'replay', timestamp: Date.now() / 1000, replayOf: { seq: row.seq, messageId: row.id, timestamp: row.timestamp } };
    delete replay.seq; delete replay.capturedAt;
    await this.store.ingest(replay);
    return { originalSeq: seq, replay: await this.store.readMessage(replay) };
  }
}

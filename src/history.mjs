import { randomUUID } from 'node:crypto';
import { readJSON, writeJSON, fail } from './store.mjs';
import { recipient, normalize } from './messages.mjs';

// One bounded, explicit request per account. No polling, retries or wakeups.
export class History {
  constructor(store, capture, captureAudio) { this.capture = capture; this.captureAudio = captureAudio; this.store = store; this.queue = Promise.resolve(); }
  serial(fn) { const next = this.queue.then(fn); this.queue = next.catch(() => {}); return next; }
  async status() {
    const value = await readJSON(this.store.path('history-request.json'), null);
    if (!value) return { state: 'none', coverage: 'partial' };
    // Rows are authoritative if a crash interrupted the later request update.
    if (value.audioSeq) {
      const row = (await this.store.messages(value.audioSeq - 1, 1, value.chat)).messages[0];
      value.received = row?.seq === value.audioSeq && row.audioRecoveryRequestId === value.id ? 1 : 0;
      value.transcription = row?.seq === value.audioSeq ? row.transcription ?? null : null;
    } else value.received = (await this.store.messages(0, Number.MAX_SAFE_INTEGER)).messages.filter(row => row.historyRequestId === value.id).length;
    if (value.received > 0) value.state = 'received';
    return { ...value, state: value.state === 'requested' && Date.now() >= value.expiresAt ? 'expired' : value.state };
  }
  async requestAudio(row, fetch) {
    const prior = await this.status();
    if (prior.audioSeq === row.seq && prior.chat === row.chat && ['requested', 'uncertain'].includes(prior.state) && Date.now() < prior.expiresAt) return prior;
    const rows = (await this.store.messages(0, Number.MAX_SAFE_INTEGER, row.chat)).messages;
    const anchor = rows.filter(candidate => candidate.timestamp > row.timestamp || (candidate.timestamp === row.timestamp && candidate.seq > row.seq))
      .sort((a, b) => a.timestamp - b.timestamp || a.seq - b.seq)[0];
    if (!anchor) throw fail('AUDIO_SOURCE_MISSING', 'No retained audio source or newer captured message in this chat; the phone may need to forward the note');
    return this.request({ chat: row.chat, before: anchor.seq, limit: 50 }, fetch, row.seq);
  }
  request(args, fetch, audioSeq) {
    return this.serial(async () => {
      const chat = recipient(args.chat), before = args.before, limit = args.limit ?? 20;
      if (!Number.isSafeInteger(before) || before < 1 || !Number.isInteger(limit) || limit < 1 || limit > 50)
        throw fail('INVALID_INPUT', 'Supply --before with a captured message seq and --limit 1..50');
      const anchor = (await this.store.messages(before - 1, 1, chat)).messages[0];
      if (anchor?.seq !== before || !Number.isSafeInteger(anchor.timestamp * 1000) || anchor.timestamp <= 0)
        throw fail('NOT_FOUND', 'History requires a captured message with a timestamp in this exact chat');
      const prior = await this.status();
      if (['requested', 'received', 'uncertain'].includes(prior.state) && Date.now() < prior.expiresAt)
        throw fail('HISTORY_BUSY', 'Previous history request is still within its response window; inspect history-status');
      const value = { id: randomUUID(), chat, before, limit, state: 'uncertain', coverage: 'partial', received: 0,
        requestedAt: new Date().toISOString(), expiresAt: Date.now() + 120000, ...(audioSeq ? { audioSeq } : {}) };
      await writeJSON(this.store.path('history-request.json'), value);
      try {
        value.sessionId = await fetch(limit, { remoteJid: chat, id: anchor.id, fromMe: anchor.fromMe, ...(anchor.participant ? { participant: anchor.participant } : {}) }, anchor.timestamp * 1000);
        if (typeof value.sessionId !== 'string' || !value.sessionId) throw new Error('Missing session');
        value.state = 'requested';
      } catch {
        // Request may have reached the phone; never resend automatically.
        value.state = 'uncertain';
      }
      await writeJSON(this.store.path('history-request.json'), value);
      return value;
    });
  }
  receive(batch, unwrap, onDemandType) {
    return this.serial(async () => {
      const value = await this.status();
      if (batch.syncType !== onDemandType || !value.sessionId || batch.peerDataRequestSessionId !== value.sessionId ||
          !['requested', 'received'].includes(value.state) || Date.now() >= value.expiresAt || (value.audioSeq && value.received > 0)) return;
      let recovered = 0;
      for (const message of batch.messages ?? []) {
        if (value.received + recovered >= value.limit) break;
        const row = normalize(message, unwrap, 'history');
        if (row?.chat !== value.chat) continue;
        const old = await this.store.readMessage(row);
        if (value.audioSeq) {
          if (old?.seq === value.audioSeq && old.type === 'audioMessage' && !old.fromMe && this.captureAudio) {
            // Claim before any upload: an interrupted provider request is never
            // retried merely because WhatsApp repeats its history response.
            const claimed = { ...old, audioRecoveryRequestId: value.id };
            await this.store.updateMessage(claimed);
            const result = await this.captureAudio(message, claimed);
            await this.store.updateMessage({ ...result, audioRecoveryRequestId: value.id });
            value.received = 1;
            break;
          }
          continue;
        }
        if (old && ['documentMessage','imageMessage','videoMessage'].includes(old.type) && old.document?.state !== 'available' && this.capture) { await this.store.updateMessage(await this.capture(message, old)); recovered++; }
        if (!old && await this.store.ingest({ ...row, historyRequestId: value.id })) value.received++;
      }
      value.state = 'received'; // Provider response, never a complete-export claim.
      value.respondedAt = new Date().toISOString();
      await writeJSON(this.store.path('history-request.json'), value);
    });
  }
}

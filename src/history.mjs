import { randomUUID } from 'node:crypto';
import { readJSON, writeJSON, fail } from './store.mjs';
import { recipient, normalize } from './messages.mjs';

// One bounded, explicit request per account. No polling, retries or wakeups.
export class History {
  constructor(store) { this.store = store; this.queue = Promise.resolve(); }
  serial(fn) { const next = this.queue.then(fn); this.queue = next.catch(() => {}); return next; }
  async status() {
    const value = await readJSON(this.store.path('history-request.json'), null);
    if (!value) return { state: 'none', coverage: 'partial' };
    return { ...value, state: value.state === 'requested' && Date.now() >= value.expiresAt ? 'expired' : value.state };
  }
  request(args, fetch) {
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
        requestedAt: new Date().toISOString(), expiresAt: Date.now() + 120000 };
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
          !['requested', 'received'].includes(value.state) || Date.now() >= value.expiresAt) return;
      for (const message of batch.messages ?? []) {
        if (value.received >= value.limit) break;
        const row = normalize(message, unwrap, 'history');
        if (row?.chat === value.chat && await this.store.ingest(row)) value.received++;
      }
      value.state = 'received'; // Provider response, never a complete-export claim.
      value.respondedAt = new Date().toISOString();
      await writeJSON(this.store.path('history-request.json'), value);
    });
  }
}

import * as baileys from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { unlink } from 'node:fs/promises';
import { authState } from './auth.mjs';
import { normalize } from './messages.mjs';
import { History } from './history.mjs';
import { atomic, fail, readJSON, writeJSON, privateDir, hash } from './store.mjs';

export async function createTransport(store, lib = baileys) {
  const history = new History(store);
  let auth = await authState(store.dir, lib);
  await privateDir(store.path('outgoing'));
  const logger = pino({ level: 'silent' });
  let socket, timer, stopped = false, attempts = 0, pairingRestarts = 0;
  let status = { connected: false, state: 'starting', account: null, qrPath: null };
  let events = Promise.resolve();
  const qrPath = store.qrPath || process.env.EZ_WHATSAPP_QR_PATH || store.path('pairing.png');
  const removeQR = async () => { await unlink(qrPath).catch(e => { if (e.code !== 'ENOENT') throw e; }); status.qrPath = null; };
  const fatal = () => { status = { ...status, connected: false, state: 'storage-error' }; stopped = true; clearTimeout(timer); socket?.end(new Error('Storage failure')); };
  const enqueue = fn => { events = events.then(fn).catch(fatal); };
  const api = {
    onReceipt: async () => {},
    status: () => ({ ...status, ...(status.qrPath ? { qrAgeMs: Date.now() - Date.parse(status.qrCreatedAt), qrRemainingMs: Math.max(0, Date.parse(status.qrCreatedAt) + status.qrRefreshAfterMs - Date.now()) } : {}) }),
    async start() { await removeQR(); connect(); },
    async setup() {
      await events;
      if (!stopped && status.state === 'needs-link' && !auth.state.creds.me) {
        attempts = 0; pairingRestarts = 0;
        connect();
      }
      return api.status();
    },
    async close() { stopped = true; clearTimeout(timer); socket?.end(undefined); await events; await history.queue; await auth.flush(); await removeQR(); },
    historyStatus: () => history.status(),
    async historyRequest(args) {
      if (stopped || !status.connected) throw fail('UNAVAILABLE', 'WhatsApp must be connected to request history');
      const current = socket;
      return history.request(args, (count, key, timestamp) => {
        if (stopped || !status.connected || socket !== current) throw fail('UNAVAILABLE', 'Connection changed');
        return current.fetchMessageHistory(count, key, timestamp);
      });
    },
    async repair() {
      await events;
      if (stopped || status.connected || status.state !== 'needs-attention' || status.disconnectCode !== lib.DisconnectReason.loggedOut)
        throw fail('REPAIR_NOT_ALLOWED', 'Repair requires a logged-out (401) session; inspect doctor');
      // Claim the transition before awaiting I/O so concurrent requests cannot reset twice.
      status = { connected: false, state: 'repairing', account: null, qrPath: null };
      const previous = socket;
      socket = null;
      clearTimeout(timer);
      try {
        await auth.retire();
        previous?.end(undefined);
        await removeQR();
        auth = await authState(store.dir, lib, true);
        await auth.save();
        attempts = 0; pairingRestarts = 0;
        connect();
        return api.status();
      } catch (error) { fatal(); throw error; }
    },
    async verify(jid) {
      if (!status.connected) throw fail('UNAVAILABLE', 'WhatsApp is not connected');
      if (jid.endsWith('@g.us')) {
        const group = await socket.groupMetadata(jid);
        return { exists: Boolean(group?.id), jid, kind: 'group' };
      }
      if (jid.endsWith('@lid')) {
        // Exact LID addressing is supported only for an observed local conversation.
        const rows = await store.messages(0, 1, jid);
        return { exists: rows.messages.length > 0, jid, kind: 'observed-lid' };
      }
      const result = await socket.onWhatsApp(jid);
      return { exists: result?.[0]?.exists === true, jid: result?.[0]?.jid ?? jid, kind: 'phone' };
    },
    async send(jid, text, messageId, expectedAccount) {
      // Provider protocol resend requests need the original payload, not another user send.
      await writeJSON(store.path(`outgoing/${hash(messageId)}.json`), { conversation: text });
      if (expectedAccount && (!status.connected || status.account?.jid !== expectedAccount)) throw fail('ACCOUNT_MISMATCH', 'Task account changed before dispatch');
      const result = await socket.sendMessage(jid, { text }, { messageId });
      return { id: result?.key?.id };
    }
  };
  function connect() {
    if (stopped) return;
    status = { ...status, connected: false, state: 'connecting' };
    socket = lib.default({
      auth: auth.state, logger, markOnlineOnConnect: false, emitOwnEvents: false,
      getMessage: async key => key.id ? await readJSON(store.path(`outgoing/${hash(key.id)}.json`), undefined) : undefined
    });
    const current = socket;
    let qrCount = 0;
    const currentAuth = auth;
    current.ev.on('creds.update', () => enqueue(() => current === socket && !stopped ? currentAuth.save() : undefined));
    current.ev.on('connection.update', update => {
      const receivedAt = new Date().toISOString();
      enqueue(async () => {
      if (current !== socket || stopped) return;
      if (update.qr) {
        const qrCreatedAt = receivedAt;
        // Baileys rc14 rotates the first QR after 60s, later references after 20s.
        // Report that window, but leave the actual timer with the provider.
        const qrRefreshAfterMs = ++qrCount === 1 ? 60000 : 20000;
        await atomic(qrPath, await QRCode.toBuffer(update.qr, { type: 'png', width: 640, margin: 4 }));
        status = { ...status, state: 'needs-scan', qrPath, qrCreatedAt, qrRefreshAfterMs };
      }
      if (update.connection === 'open') {
        attempts = 0; await removeQR();
        const jid = lib.jidNormalizedUser(current.user.id);
        const identity = await readJSON(store.path('identity.json'), null);
        if (identity && identity.jid !== jid) {
          status = { connected: false, state: 'account-mismatch', account: { jid }, qrPath: null };
          stopped = true; current.end(new Error('Account mismatch')); return;
        }
        if (!identity) await writeJSON(store.path('identity.json'), { jid });
        status = { connected: true, state: 'connected', account: { jid: lib.jidNormalizedUser(current.user.id), name: current.user.name ?? null }, qrPath: null };
      }
      if (update.connection === 'close') {
        await removeQR();
        const code = update.lastDisconnect?.error?.output?.statusCode;
        const terminal = [lib.DisconnectReason.loggedOut, lib.DisconnectReason.badSession, lib.DisconnectReason.connectionReplaced, lib.DisconnectReason.forbidden].includes(code);
        // Unlinked QR sessions stop on expiry/failure, as in the legacy bridge.
        // Only a successful pairing's bounded 515 restart may continue before me exists.
        const paired = Boolean(auth.state.creds.me);
        const pairingRestart = code === lib.DisconnectReason.restartRequired && ++pairingRestarts <= 3;
        const reconnect = !terminal && (paired || pairingRestart);
        status = { ...status, connected: false, state: terminal ? 'needs-attention' : reconnect ? 'reconnecting' : 'needs-link', disconnectCode: code ?? null };
        if (reconnect) {
          // Transport lifecycle only; never retries a user operation or chooses a fallback tool.
          const delay = code === lib.DisconnectReason.restartRequired ? 0 : Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5));
          timer = setTimeout(connect, delay);
        }
      }
      });
    });
    current.ev.on('messaging-history.set', batch => enqueue(async () => {
      if (current !== socket || stopped || !status.connected) return;
      await history.receive(batch, lib.normalizeMessageContent, lib.proto.HistorySync.HistorySyncType.ON_DEMAND);
    }));
    current.ev.on('messages.upsert', batch => enqueue(async () => {
      if (current !== socket || stopped) return;
      for (const message of batch.messages) {
        const row = normalize(message, lib.normalizeMessageContent, batch.type);
        if (row) await store.ingest(row);
        if (message.key?.fromMe && message.key.id) await api.onReceipt(message.key.id, 'accepted');
      }
    }));
    current.ev.on('messages.update', updates => enqueue(async () => {
      if (current !== socket || stopped) return;
      for (const { key, update } of updates) {
        if (!key.fromMe || !key.id) continue;
        const s = update.status;
        if (s >= 4) await api.onReceipt(key.id, 'read');
        else if (s === 3) await api.onReceipt(key.id, 'delivered');
        else if (s === 2) await api.onReceipt(key.id, 'accepted');
      }
    }));
    current.ev.on('message-receipt.update', updates => enqueue(async () => {
      if (current !== socket || stopped) return;
      for (const { key, receipt } of updates) {
        // Group receipts are per participant; do not claim whole-group delivery.
        if (!key.fromMe || key.remoteJid?.endsWith('@g.us')) continue;
        if (receipt.readTimestamp || receipt.playedTimestamp) await api.onReceipt(key.id, 'read');
        else if (receipt.receiptTimestamp) await api.onReceipt(key.id, 'delivered');
      }
    }));
  }
  return api;
}

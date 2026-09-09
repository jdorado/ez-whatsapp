import * as baileys from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { unlink } from 'node:fs/promises';
import { authState } from './auth.mjs';
import { normalize } from './messages.mjs';
import { atomic, fail, readJSON, writeJSON, privateDir, hash } from './store.mjs';

export async function createTransport(store, lib = baileys) {
  const auth = await authState(store.dir, lib);
  await privateDir(store.path('outgoing'));
  const logger = pino({ level: 'silent' });
  let socket, timer, stopped = false, attempts = 0;
  let status = { connected: false, state: 'starting', account: null, qrPath: null };
  let events = Promise.resolve();
  const qrPath = process.env.EZ_WHATSAPP_QR_PATH || store.path('pairing.png');
  const removeQR = async () => { await unlink(qrPath).catch(e => { if (e.code !== 'ENOENT') throw e; }); status.qrPath = null; };
  const fatal = () => { status = { ...status, connected: false, state: 'storage-error' }; stopped = true; clearTimeout(timer); socket?.end(new Error('Storage failure')); };
  const enqueue = fn => { events = events.then(fn).catch(fatal); };
  const api = {
    onReceipt: async () => {},
    status: () => ({ ...status, ...(status.qrPath ? { qrAgeMs: Date.now() - Date.parse(status.qrCreatedAt), qrRefreshAfterMs: 60000 } : {}) }),
    async start() { await removeQR(); connect(); },
    async close() { stopped = true; clearTimeout(timer); socket?.end(undefined); await events; await auth.flush(); await removeQR(); },
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
      auth: auth.state, logger, qrTimeout: 60000, markOnlineOnConnect: false, syncFullHistory: false,
      shouldSyncHistoryMessage: () => false, emitOwnEvents: false,
      getMessage: async key => key.id ? await readJSON(store.path(`outgoing/${hash(key.id)}.json`), undefined) : undefined
    });
    const current = socket;
    current.ev.on('creds.update', () => enqueue(() => auth.save()));
    current.ev.on('connection.update', update => enqueue(async () => {
      if (current !== socket || stopped) return;
      if (update.qr) {
        await atomic(qrPath, await QRCode.toBuffer(update.qr, { type: 'png', width: 640, margin: 4 }));
        status = { ...status, state: 'needs-scan', qrPath, qrCreatedAt: new Date().toISOString() };
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
        status = { ...status, connected: false, state: terminal ? 'needs-attention' : 'reconnecting', disconnectCode: code ?? null };
        if (!terminal) {
          // Transport lifecycle only; never retries a user operation or chooses a fallback tool.
          const delay = code === lib.DisconnectReason.restartRequired ? 0 : Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5));
          timer = setTimeout(connect, delay);
        }
      }
    }));
    current.ev.on('messages.upsert', batch => enqueue(async () => {
      for (const message of batch.messages) {
        const row = normalize(message, lib.normalizeMessageContent, batch.type);
        if (row) await store.ingest(row);
        if (message.key?.fromMe && message.key.id) await api.onReceipt(message.key.id, 'accepted');
      }
    }));
    current.ev.on('messages.update', updates => enqueue(async () => {
      for (const { key, update } of updates) {
        if (!key.fromMe || !key.id) continue;
        const s = update.status;
        if (s >= 4) await api.onReceipt(key.id, 'read');
        else if (s === 3) await api.onReceipt(key.id, 'delivered');
        else if (s === 2) await api.onReceipt(key.id, 'accepted');
      }
    }));
    current.ev.on('message-receipt.update', updates => enqueue(async () => {
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

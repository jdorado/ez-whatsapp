import { readJSON, writeJSON, fail } from './store.mjs';
import { recipient } from './messages.mjs';

const modes = new Set(['manual', 'selected', 'all']);
const floorOK = f => f && Number.isSafeInteger(f.seq) && f.seq >= 0 && Number.isFinite(f.at);
export class Policy {
  constructor(store) { this.store = store; }
  async get() {
    const value = await readJSON(this.store.path('policy.json'), { version: 1, mode: 'manual', chats: {} });
    if (value.version !== 1 || !modes.has(value.mode) || !value.chats || Array.isArray(value.chats) ||
        Object.entries(value.chats).some(([chat, floor]) => { try { return recipient(chat) !== chat || !floorOK(floor); } catch { return true; } }) ||
        (value.mode === 'all' && !floorOK(value.since))) throw fail('CORRUPT_STATE', 'Invalid subscription policy; automatic events are disabled');
    return value;
  }
  async head() {
    const { seq } = await readJSON(this.store.path('cursor.json'), { seq: 0 });
    if (!Number.isSafeInteger(seq) || seq < 0) throw fail('CORRUPT_STATE', 'Invalid capture cursor');
    return seq;
  }
  async change(command, args) {
    return this.store.serial(async () => {
      const old = await this.get();
      const floor = { seq: await this.head(), at: Date.now() };
      let value;
      if (command === 'policy') {
        if (!modes.has(args.mode)) throw fail('INVALID_INPUT', 'mode must be manual, selected or all');
        value = args.mode === old.mode ? old : { version: 1, mode: args.mode, chats: {}, ...(args.mode === 'all' ? { since: floor } : {}) };
      } else {
        const chat = recipient(args.chat);
        if (old.mode === 'all') throw fail('INVALID_INPUT', 'Switch to selected mode before editing selected chats');
        value = { ...old, chats: { ...old.chats } };
        if (command === 'subscribe') {
          value.mode = 'selected'; value.chats[chat] ??= floor;
        } else delete value.chats[chat];
      }
      await writeJSON(this.store.path('policy.json'), value);
      return value;
    });
  }
  async watch(chat, expiresAt) {
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 72 * 3600000) throw fail('INVALID_INPUT', 'Invalid task expiry');
    return this.store.serial(async () => {
      const watches = await readJSON(this.store.path('task-watches.json'), {});
      for (const [id, floor] of Object.entries(watches)) if (floor.expiresAt <= Date.now()) delete watches[id];
      if (!watches[chat] || watches[chat].expiresAt !== expiresAt) watches[chat] = { seq: await this.head(), at: Date.now(), expiresAt };
      await writeJSON(this.store.path('task-watches.json'), watches);
      return { watching: chat, expiresAt };
    });
  }
  target(row, policy, watches = {}) {
    // Only provider-supplied alternate identity on an individual LID may match
    // a phone watch. Never infer identity from message text or group members.
    const chats = /^\d+@lid$/.test(row.chat) && /^\d{7,15}@s\.whatsapp\.net$/.test(row.phoneJid)
      ? [row.phoneJid, row.chat] : [row.chat];
    return chats.find(chat => {
      const watch = watches[chat];
      const floor = watch?.expiresAt > Date.now() ? watch : policy.mode === 'all' ? policy.since : policy.mode === 'selected' ? policy.chats[chat] : null;
      return floor && !row.fromMe && ['notify', 'append'].includes(row.source) &&
        row.seq > floor.seq && Number.isFinite(row.timestamp) && row.timestamp * 1000 >= floor.at - 1000;
    });
  }
  eligible(row, policy, watches = {}) { return Boolean(this.target(row, policy, watches)); }
  event(row, conversationId = row.chat) {
    return { id: String(row.seq), conversationId, receivedAt: Date.parse(row.capturedAt),
      text: JSON.stringify({ messageId: row.id, participant: row.participant, type: row.type, text: row.text?.slice(0, 10000) ?? null, mediaAvailable: row.mediaAvailable ?? false }) };
  }
  async events(after = 0) {
    if (!Number.isSafeInteger(after) || after < 0) throw fail('INVALID_INPUT', 'Invalid event cursor');
    return this.store.serial(async () => {
      const policy = await this.get();
      const watches = await readJSON(this.store.path('task-watches.json'), {});
      const page = await this.store.messages(after, 100);
      const events = [];
      let cursor = after;
      for (const row of page.messages) {
        cursor = row.seq;
        const target = this.target(row, policy, watches);
        if (target) events.push(this.event(row, target));
        if (events.length === 10) break;
      }
      return { cursor, events };
    });
  }
  async check(ids) {
    if (!Array.isArray(ids) || ids.length > 10 || ids.some(id => typeof id !== 'string' || !/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id)))) throw fail('INVALID_INPUT', 'Supply up to 10 event IDs');
    return this.store.serial(async () => {
      const policy = await this.get();
      const watches = await readJSON(this.store.path('task-watches.json'), {});
      const events = [];
      for (const id of ids) {
        const page = await this.store.messages(Number(id) - 1, 1);
        const row = page.messages[0];
        const target = row?.seq === Number(id) && this.target(row, policy, watches);
        if (target) events.push(this.event(row, target));
      }
      return { events };
    });
  }
}

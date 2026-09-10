import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomic } from './store.mjs';
// One small local account: commit complete auth updates atomically and await each write.
export async function authState(dir, { BufferJSON, initAuthCreds, proto }, fresh = false) {
  const path = join(dir, 'auth.json');
  let saved;
  try { if (!fresh) saved = JSON.parse(await readFile(path, 'utf8'), BufferJSON.reviver); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const data = saved ?? { creds: initAuthCreds(), keys: {} };
  let pending = Promise.resolve(), retired = false;
  const persist = () => {
    if (retired) return pending;
    const snapshot = JSON.stringify(data, BufferJSON.replacer);
    const next = pending.then(() => atomic(path, snapshot));
    pending = next; // A persistence failure poisons future writes; never silently continue.
    return next;
  };
  return {
    state: {
      creds: data.creds,
      keys: {
        get: async (type, ids) => Object.fromEntries(ids.map(id => {
          let value = data.keys[type]?.[id];
          if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
          return [id, value];
        })),
        set: async update => {
          for (const [type, entries] of Object.entries(update)) {
            data.keys[type] ??= {};
            for (const [id, value] of Object.entries(entries)) {
              if (value === null) delete data.keys[type][id]; else data.keys[type][id] = value;
            }
          }
          await persist();
        }
      }
    },
    save: persist,
    flush: () => pending,
    retire: () => { retired = true; return pending; }
  };
}

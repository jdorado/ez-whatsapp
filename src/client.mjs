import { request } from 'node:http';
import { join } from 'node:path';
import { fail } from './store.mjs';
export function client(dir, command, args, socketPath = join(dir, 'service.sock')) {
  return new Promise((ok, no) => {
    const req = request({ socketPath, path: '/', method: 'POST', timeout: 45000 }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { const value = JSON.parse(data); if (!value.ok) no(fail(value.error.code, value.error.message)); else ok(value.data); } catch (e) { no(e); } });
    });
    req.on('timeout', () => req.destroy(fail(command === 'send' ? 'UNCERTAIN' : 'TIMEOUT', 'Request timed out; inspect operation before retrying a send')));
    req.on('error', e => no(['ENOENT', 'ECONNREFUSED'].includes(e.code) ? fail('NOT_RUNNING', 'Start ez-whatsapp serve --profile with this same directory') : command === 'send' ? fail('UNCERTAIN', 'Connection ended without a result; inspect operation before any retry') : e));
    req.end(JSON.stringify({ command, args }));
  });
}

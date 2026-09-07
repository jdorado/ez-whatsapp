import { parseArgs } from 'node:util';
import { resolve, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { client } from './client.mjs';
import { fail } from './store.mjs';
export const help = `ez-whatsapp — standalone WhatsApp account plugin

  setup      Inspect onboarding in the running Docker service; return QR or identity
  serve      Foreground socket service (captures messages; no agent execution)
  doctor     Live connection identity, QR image path, capabilities
  inbox      Captured messages: --after CURSOR --limit 1..100 [--chat JID]
  policy     Read wake policy, or set --mode manual|selected|all
  subscribe  Watch new incoming messages in --chat JID
  unsubscribe Stop watching --chat JID (capture continues)
  verify     Check recipient: --to +COUNTRYNUMBER|JID
  send       --to NUMBER|JID --text-file FILE --idempotency-key KEY [--preview]
  operation  --idempotency-key KEY (inspect acceptance/delivery/uncertainty)

Use --profile /absolute/private/directory, or --socket /absolute/service.sock
for client commands from another container. serve/setup require --profile.
--json is accepted; output is always JSON. --help and --version require no profile.
setup returns a private QR PNG: share it with the owner, who scans in WhatsApp
Settings > Linked Devices. Poll doctor for connected=true; scanning alone is not proof.
Start the registered plugin with ez plugins start whatsapp before setup.
Account must already exist. Onboarding never sends a WhatsApp message.
`;
export async function main(argv = process.argv.slice(2)) {
  process.umask(0o077);
  try {
    const { values: v, positionals } = parseArgs({ args: argv, allowPositionals: true, options: Object.fromEntries([
      ...['profile','socket','to','text-file','idempotency-key','after','limit','chat','mode'].map(k => [k, { type: 'string' }]),
      ...['help','version','json','preview'].map(k => [k, { type: 'boolean' }])
    ]) });
    if (v.help || (!positionals.length && !v.version)) { process.stdout.write(help); return; }
    if (v.version) { process.stdout.write(JSON.parse(await readFile(new URL('../ez-plugin.json', import.meta.url), 'utf8')).version + '\n'); return; }
    if (positionals.length !== 1) throw fail('INVALID_INPUT', 'Supply one command');
    const command = positionals[0];
    if ((!v.profile || !isAbsolute(v.profile)) && (!v.socket || !isAbsolute(v.socket) || ['serve','setup'].includes(command))) throw fail('INVALID_INPUT', 'Supply --profile with an absolute private directory');
    const profile = resolve(v.profile || '/state/whatsapp');
    if (command === 'serve') {
      if (!existsSync('/.dockerenv') && process.env.EZ_DEVELOPMENT !== '1')
        throw fail('DOCKER_REQUIRED', 'Start the registered Docker service with ez plugins start whatsapp; source development requires EZ_DEVELOPMENT=1');
      const { serve } = await import('./service.mjs');
      const { createTransport } = await import('./transport.mjs');
      const running = await serve(profile, createTransport, v.socket);
      process.stdout.write(JSON.stringify({ ok: true, service: 'running', profile }) + '\n');
      let closing = false;
      const stop = async () => { if (closing) return; closing = true; try { await running.close(); process.exit(0); } catch { process.exit(1); } };
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
      return;
    }
    let result;
    if (command === 'setup') {
      result = await client(profile, 'doctor', undefined, v.socket);
      result = { ...result, next: 'Scan the current QR if needed, then verify connected identity with doctor' };
    } else {
      if (!['doctor','inbox','send','verify','operation','policy','subscribe','unsubscribe'].includes(command)) throw fail('INVALID_INPUT', 'Unknown command; use --help');
      const args = { mode: v.mode, to: v.to, key: v['idempotency-key'], preview: v.preview, after: v.after === undefined ? 0 : Number(v.after), limit: v.limit === undefined ? 20 : Number(v.limit), chat: v.chat };
      if (command === 'send') {
        if (!v['text-file']) throw fail('INVALID_INPUT', 'Supply --text-file');
        args.text = await readFile(v['text-file'], 'utf8');
      }
      result = await client(profile, command, args, v.socket);
    }
    process.stdout.write(JSON.stringify({ ok: true, data: result }) + '\n');
  } catch (e) {
    process.stderr.write(JSON.stringify({ ok: false, error: { code: e.code ?? 'INTERNAL', message: e.code ? e.message : 'Command failed' } }) + '\n');
    process.exitCode = e.code === 'UNCERTAIN' ? 4 : 1;
  }
}

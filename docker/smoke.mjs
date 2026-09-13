import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const image = process.env.EZ_WHATSAPP_IMAGE || 'ez-whatsapp:local';
const id = `ezwa-qa-${process.pid}-${Date.now()}`;
const volumes = ['profile','ipc','client'].map(x => `${id}-${x}`);
const docker = args => spawnSync('docker', args, {encoding:'utf8', timeout:60000});
const ok = args => {const r=docker(args);assert.equal(r.status,0,r.stderr || r.stdout);return r.stdout.trim();};
const mounts = ['-v',`${volumes[0]}:/state/whatsapp`,'-v',`${volumes[1]}:/plugins/whatsapp`,'-v',`${volumes[2]}:/client`];
const fixture = ['--mount',`type=bind,src=${fileURLToPath(new URL('./fixture.mjs',import.meta.url))},dst=/app/src/transport.mjs,readonly`];
const call = args => JSON.parse(ok(['run','--rm','--user','1000:1000','-v',`${volumes[1]}:/plugins/whatsapp:ro`,'-v',`${volumes[2]}:/client:ro`,'--entrypoint','node','node:22.22.0-bookworm-slim','/client/bin/ez-whatsapp',...args,'--socket','/plugins/whatsapp/service.sock'])).data;
async function ready() {
  for(let n=0;n<40;n++) {
    const r=docker(['exec',id,'node','/app/bin/ez-whatsapp.mjs','doctor','--socket','/plugins/whatsapp/service.sock']);
    if(r.status===0 && JSON.parse(r.stdout).data.connected) return;
    await new Promise(r=>setTimeout(r,250));
  }
  throw new Error(ok(['logs',id]));
}
try {
  ok(['run','-d','--name',id,...mounts,...fixture,image]);
  await ready();
  assert.equal(call(['doctor']).connected,true);
  const first=call(['inbox']);assert.equal(first.messages.length,1);
  ok(['exec',id,'sh','-c','printf "%s" "literal text" > /tmp/text.txt']);
  const send=JSON.parse(ok(['exec',id,'node','/app/bin/ez-whatsapp.mjs','send','--socket','/plugins/whatsapp/service.sock','--to','+15551230000','--text-file','/tmp/text.txt','--idempotency-key','docker:qa'])).data;
  assert.equal(send.state,'accepted');
  const added=call(['account-add','--account','sales','--purpose','Sales enquiries']);
  assert.equal(added.account.jid,'15551230001@s.whatsapp.net');
  assert.equal(call(['doctor','--account','sales']).connected,true);
  const namedSend=JSON.parse(ok(['exec',id,'node','/app/bin/ez-whatsapp.mjs','send','--socket','/plugins/whatsapp/service.sock','--account','sales','--to','+15551230000','--text-file','/tmp/text.txt','--idempotency-key','docker:qa'])).data;
  assert.notEqual(namedSend.providerMessageId,send.providerMessageId);
  const duplicate=docker(['run','--rm',...mounts,...fixture,image]);
  assert.equal(duplicate.status,73,duplicate.stderr);
  ok(['kill',id]);ok(['start',id]);await ready();
  assert.equal(call(['inbox','--account','default']).nextCursor,first.nextCursor);
  assert.equal(call(['operation','--account','default','--idempotency-key','docker:qa']).providerMessageId,send.providerMessageId);
  assert.equal(call(['operation','--account','sales','--idempotency-key','docker:qa']).providerMessageId,namedSend.providerMessageId);
  assert.equal(call(['accounts']).accounts.find(a=>a.name==='sales').purpose,'Sales enquiries');
  assert.equal(call(['doctor','--account','sales']).connected,true);
  const isolated=ok(['run','--rm','--user','1000:1000','-v',`${volumes[1]}:/plugins/whatsapp:ro`,'-v',`${volumes[2]}:/client:ro`,'--entrypoint','node','node:22.22.0-bookworm-slim','-e',`const fs=require('fs');if(fs.existsSync('/state/whatsapp')||fs.existsSync('/var/run/docker.sock'))process.exit(1);console.log('isolated')`]);
  assert.equal(isolated,'isolated');
  console.log('Docker smoke passed: separate client/socket, synthetic send receipt, duplicate writer rejected, SIGKILL restart, durable per-account cursors and operations, named account restart, private profile absent from client. No provider calls.');
} finally {
  docker(['rm','-f',id]);for(const volume of volumes)docker(['volume','rm',volume]);
}

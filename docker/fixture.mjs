// Synthetic transport for Docker QA only. Never used by the normal image command.
export async function createTransport(store) {
  const jid = store.dir.endsWith('/sales') ? '15551230001@s.whatsapp.net' : '15551230000@s.whatsapp.net';
  return {
    status: () => ({connected:true, account:{jid}, state:'connected'}),
    async start() { await store.ingest({id:'docker-fixture-1',chat:'15551230000@s.whatsapp.net',text:'fixture',fromMe:false}); },
    async close() {},
    async verify(jid) { return {exists:true,jid}; },
    async send(jid,text,id) { return {id}; }
  };
}

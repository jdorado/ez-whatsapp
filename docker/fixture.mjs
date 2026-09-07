// Synthetic transport for Docker QA only. Never used by the normal image command.
export async function createTransport(store) {
  return {
    status: () => ({connected:true, account:{jid:'15551230000@s.whatsapp.net'}, state:'connected'}),
    async start() { await store.ingest({id:'docker-fixture-1',chat:'15551230000@s.whatsapp.net',text:'fixture',fromMe:false}); },
    async close() {},
    async verify(jid) { return {exists:true,jid}; },
    async send(jid,text,id) { return {id}; }
  };
}

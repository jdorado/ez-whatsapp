import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { Store, hash } from '../src/store.mjs';
import { Documents, maxDocumentBytes } from '../src/documents.mjs';
import { Policy } from '../src/policy.mjs';
import { Service } from '../src/service.mjs';
import { History } from '../src/history.mjs';
const chat='15551234567@s.whatsapp.net', account='15557654321@s.whatsapp.net';
async function fixture(t) {
 const dir=await mkdtemp('/tmp/ez-doc-test-'); t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new Store(dir); await store.init(); const policy=new Policy(store); await policy.watch(chat,Date.now()+3600000);
 let data=Buffer.from('The shop opens at 7am.'); let downloads=0;
 const lib={normalizeMessageContent:x=>x,downloadContentFromMessage:async()=>{downloads++;return Readable.from([data]);}};
 const docs=new Documents(store,lib);
 const message={message:{documentMessage:{fileName:'shop.txt',mimetype:'text/plain',fileLength:data.length,url:'https://mmg.whatsapp.net/d'}}};
 const row={id:'original',chat,participant:null,phoneJid:null,fromMe:false,source:'notify',type:'documentMessage',text:'Read this',timestamp:Date.now()/1000,mediaAvailable:true};
 return {store,policy,docs,message,row,lib,setData:v=>data=v,downloads:()=>downloads};
}
test('watched document retains private bytes, bounded source provenance and scoped replay',async t=>{
 const f=await fixture(t); await f.store.ingest(f.row);
 const captured=await f.docs.capture(f.message,await f.store.readMessage(f.row)); await f.store.updateMessage(captured);
 assert.equal(captured.document.state,'available'); assert.equal(f.downloads(),1);
 const file=f.store.path(`documents/${hash(JSON.stringify([chat,'original',false,null]))}.bin`);
 assert.equal((await stat(file)).mode&0o777,0o600); assert.equal((await readFile(file)).toString(),'The shop opens at 7am.');
 const op=await f.docs.replay(chat,1); const again=await f.docs.replay(chat,1); assert.equal(op.replay.seq,again.replay.seq);
 assert.equal((await f.store.messages()).messages.length,2); assert.equal((await f.store.readMessage(f.row)).seq,1);
 const events=await f.policy.events(1); assert.equal(events.events.length,1); assert.equal(JSON.parse(events.events[0].text).replayOf.messageId,'original');
 const service=new Service(f.store,{status:()=>({connected:true,account:{jid:account}}),documentRead:r=>f.docs.read(r)});
 const value=await service.call('task-document',{accountId:account,conversationId:chat,incomingId:String(op.replay.seq)});
 assert.equal(Buffer.from(value.data,'base64').toString(),'The shop opens at 7am.');
 await assert.rejects(service.call('task-document',{accountId:account,conversationId:'15550009999@s.whatsapp.net',incomingId:String(op.replay.seq)}));
 await f.policy.unwatch(chat); await assert.rejects(service.call('task-document',{accountId:account,conversationId:chat,incomingId:String(op.replay.seq)}));
});
test('unwatched, outgoing, oversized, unsafe and changed documents fail before disclosure',async t=>{
 const f=await fixture(t);
 for(const row of [{...f.row,fromMe:true},{...f.row,chat:'15550000000@s.whatsapp.net'}])assert.equal((await f.docs.capture(f.message,row)).document,undefined);
 assert.equal(f.downloads(),0);
 for(const [field,value,code] of [['fileLength',maxDocumentBytes+1,'DOCUMENT_TOO_LARGE'],['url','https://localhost/d','MEDIA_SOURCE_INVALID'],['fileName','shop.exe','DOCUMENT_UNSUPPORTED']]) {
  const message={message:{documentMessage:{...f.message.message.documentMessage,[field]:value}}};
  assert.equal((await f.docs.capture(message,f.row)).document.code,code);
 }
 assert.equal(f.downloads(),0);
 f.setData(Buffer.from('changed')); assert.equal((await f.docs.capture(f.message,f.row)).document.code,'DOCUMENT_CHANGED');
});
test('explicit provider history recovers original document bytes without rewriting capture or waking history',async t=>{
 const f=await fixture(t); await f.store.ingest(f.row);
 const history=new History(f.store,(message,row)=>f.docs.capture(message,row));
 await history.request({chat,before:1,limit:2},async()=> 'session');
 await history.receive({syncType:6,peerDataRequestSessionId:'session',messages:[{...f.message,key:{id:'original',remoteJid:chat,fromMe:false},messageTimestamp:f.row.timestamp}]},x=>x,6);
 const original=await f.store.readMessage(f.row); assert.equal(original.seq,1); assert.equal(original.document.state,'available');
 assert.equal((await f.store.messages()).messages.length,1);
 await f.docs.replay(chat,1); assert.equal((await f.policy.events(1)).events.length,1);
});

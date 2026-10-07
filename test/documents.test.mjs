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

test('explicit history recovery and replay use current attention without broadening ordinary old-message capture',async t=>{
 const f=await fixture(t); const old={...f.row,timestamp:1};await f.store.ingest(old);
 assert.equal((await f.docs.capture(f.message,old)).document,undefined);
 const recovered=await f.docs.capture(f.message,await f.store.readMessage(old),()=>true,true);await f.store.updateMessage(recovered);
 assert.equal(recovered.document.state,'available');
 const replay=await f.docs.replay(chat,1);assert.equal((await f.policy.events(1)).events[0].id,String(replay.replay.seq));
 await f.policy.unwatch(chat); await assert.rejects(f.docs.replay(chat,1));
});

test('watched images use the same private bytes, source read and idempotent replay path',async t=>{
 const f=await fixture(t),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64');f.setData(png)
 const row={...f.row,type:'imageMessage'},message={message:{imageMessage:{mimetype:'image/png',fileLength:png.length,url:'https://mmg.whatsapp.net/image'}}}
 await f.store.ingest(row); const captured=await f.docs.capture(message,await f.store.readMessage(row));await f.store.updateMessage(captured)
 assert.equal(captured.document.state,'available');assert.equal(captured.document.name,'image.png')
 const replay=await f.docs.replay(chat,1);const bytes=await f.docs.read(replay.replay);assert.equal(bytes.data,png.toString('base64'))
 assert.equal((await f.policy.events(1)).events.length,1);assert.equal((await f.docs.replay(chat,1)).replay.seq,replay.replay.seq)
 await f.policy.unwatch(chat);await assert.rejects(f.docs.replay(chat,1))
 const invalid={message:{imageMessage:{...message.message.imageMessage,mimetype:'image/svg+xml'}}}
 // Direct normal capture of a new watched image rejects unsupported MIME before download.
 await f.policy.watch(chat,Date.now()+3600000)
 assert.equal((await f.docs.capture(invalid,{...row,timestamp:Date.now()/1000})).document.code,'IMAGE_UNSUPPORTED')
})

test('video retains visuals, shares existing speech transcription and preserves caption',async t=>{
 const f=await fixture(t),bytes=Buffer.from('captured-video');f.setData(bytes)
 let calls=0;const docs=new Documents(f.store,f.lib,async(buffer,mime)=>{calls++;assert.equal(mime,'video/mp4');assert.equal(buffer.toString(),'captured-video');return {text:'The machine starts at 7am.',transcription:{state:'transcribed',responseId:'fixture-video-receipt'}}})
 const row={...f.row,type:'videoMessage',text:'How does this work?'},message={message:{videoMessage:{mimetype:'video/mp4',seconds:2,fileLength:bytes.length,url:'https://mmg.whatsapp.net/v'}}}
 await f.store.ingest(row);const captured=await docs.capture(message,await f.store.readMessage(row));await f.store.updateMessage(captured)
 assert.equal(captured.document.state,'available');assert.equal(captured.text,'The machine starts at 7am.');assert.equal(captured.caption,'How does this work?');assert.equal(calls,1)
 const replay=await docs.replay(chat,1);assert.equal((await docs.read(replay.replay)).data,bytes.toString('base64'));assert.equal(calls,1)
 const event=JSON.parse((await f.policy.events(1)).events[0].text);assert.equal(event.caption,'How does this work?');assert.equal(event.transcription.state,'transcribed')
})

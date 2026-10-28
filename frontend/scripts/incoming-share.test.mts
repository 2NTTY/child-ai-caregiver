import assert from 'node:assert/strict';
import test from 'node:test';
import { createIncomingShareInbox } from '../src/incoming-share.ts';
import type { IncomingSharePlatform, IncomingSharePayload } from '../src/incoming-share.ts';

test('shares enter the existing draft only on demand, retaining text and rejected attachments', async () => {
  let raw: IncomingSharePayload[] = [{shareType:'url',value:'https://example.invalid/source'}];
  let preparations = 0, text = 'Existing draft', attachments = 0, released = 0;
  const platform: IncomingSharePlatform = { read:()=>raw, clear:()=>{raw=[];}, subscribe:()=>()=>{},
    prepare:async()=>{ preparations++; return {id:'file',kind:'file',fileName:'test.docx',mimeType:'application/octet-stream',bytes:2,dispose:()=>{released++;}}; } };
  const inbox = createIncomingShareInbox(platform);
  inbox.observeIdentity('user-1'); inbox.receive();
  assert.equal(preparations,0); assert.equal(raw.length,0); assert.equal(text,'Existing draft');
  const target = {current:()=>true,appendText:(value:string)=>{text+='\n\n'+value;return true;},appendAttachment:()=>{attachments++;return false;}};
  assert.equal(await inbox.take(inbox.getSnapshot().items[0]!.id,target),true);
  assert.equal(text,'Existing draft\n\nhttps://example.invalid/source'); assert.equal(inbox.getSnapshot().items.length,0);
  raw=[{shareType:'file',value:'content://documents/1'}]; inbox.receive();
  assert.equal(await inbox.take(inbox.getSnapshot().items[0]!.id,target),false);
  assert.equal(inbox.getSnapshot().items.length,1); assert.equal(released,1); assert.equal(attachments,1);
  inbox.receive(); assert.equal(inbox.getSnapshot().items.length,1);
});

test('identity and child changes cannot accept late file reads or revive discarded items', async () => {
  let resolve!: (value:any)=>void, current=true, added=0, released=0;
  let raw:IncomingSharePayload[]=[{shareType:'file',value:'content://documents/2'}];
  const inbox=createIncomingShareInbox({read:()=>raw,clear:()=>{raw=[];},subscribe:()=>()=>{},prepare:()=>new Promise(r=>{resolve=r;})});
  inbox.receive(); inbox.observeIdentity('user-1');
  const item=inbox.getSnapshot().items[0]!;
  const take=inbox.take(item.id,{current:()=>current,appendText:()=>false,appendAttachment:()=>{added++;return true;}});
  current=false;
  resolve({id:'file',kind:'file',fileName:'a',mimeType:'text/plain',bytes:1,dispose:()=>{released++;}});
  assert.equal(await take,false); assert.equal(added,0); assert.equal(released,1); assert.equal(inbox.getSnapshot().items.length,1);
  inbox.observeIdentity(null); assert.equal(inbox.getSnapshot().items.length,0);
  inbox.observeIdentity('user-2'); assert.equal(await inbox.take(item.id,{current:()=>true,appendText:()=>true,appendAttachment:()=>true}),false);
});

test('failed native cleanup cannot disclose an earlier account share after sign-in', () => {
  let fail=false,raw:IncomingSharePayload[]=[];
  const inbox=createIncomingShareInbox({read:()=>raw,clear:()=>{if(fail)throw new Error('native unavailable');raw=[];},subscribe:()=>()=>{},prepare:async()=>{throw new Error('unused');}});
  inbox.observeIdentity('first');raw=[{shareType:'text',value:'Previous account input'}];fail=true;
  inbox.observeIdentity(null);inbox.observeIdentity('second');fail=false;
  inbox.receive();assert.equal(inbox.getSnapshot().items.length,0);
});

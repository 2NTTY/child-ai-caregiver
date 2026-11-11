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

test('durable shares acknowledge within capacity and release only adopted or explicitly discarded items', async () => {
  const text:IncomingSharePayload={shareType:'text',value:'Retained on device',localShareId:'receipt-text'};
  const zip:IncomingSharePayload={shareType:'file',value:'file:///owned/backup.zip',localShareId:'receipt-zip'};
  let raw=[text,zip],clears=0,failRelease=false,adoptions=0;
  const reads:unknown[]=[],acknowledged:unknown[]=[],released:string[]=[];
  const platform:IncomingSharePlatform={read:(remaining,identity)=>{reads.push([remaining,identity]);return raw;},
    acknowledge:(items,identity)=>{acknowledged.push([items.map(item=>item.localShareId),identity]);},
    clear(){clears++;raw=[];},subscribe:()=>()=>{},prepare:async()=>{throw Error('No attachment preparation');},
    discard(payload){if(failRelease)throw Error('disk unavailable');released.push(payload.localShareId!);raw=raw.filter(item=>item.localShareId!==payload.localShareId);},
    preparePackage:async()=>({filename:'backup.zip',bytes:3,sha256:'a'.repeat(64),body:'zip',release(){}})};
  const binding=JSON.stringify(['https://example.test','owner']);
  const inbox=createIncomingShareInbox(platform);inbox.observeIdentity('session-owner-1',binding);inbox.receive();inbox.receive();
  assert.equal(inbox.getSnapshot().items.length,2);assert.equal(clears,0);assert.deepEqual(reads,[[20,binding],[18,binding]]);
  assert.deepEqual(acknowledged[0],[['receipt-text','receipt-zip'],binding]);assert.deepEqual(released,[]);
  const item=inbox.getSnapshot().items[0]!,packageItem=inbox.getSnapshot().items[1]!;
  const target={current:()=>true,appendText:()=>false,appendAttachment:()=>false};
  assert.equal(await inbox.take(item.id,target),false);assert.equal(inbox.getSnapshot().items.length,2);assert.deepEqual(released,[]);
  failRelease=true;
  assert.equal(inbox.discard(item.id),false);assert.equal(inbox.getSnapshot().items.length,2);assert.ok(inbox.getSnapshot().error);
  assert.equal(await inbox.take(item.id,{...target,appendText:()=>{adoptions++;return true;}}),true);
  assert.equal(adoptions,1);assert.equal(inbox.getSnapshot().items.length,1);assert.ok(inbox.getSnapshot().error);
  inbox.receive();assert.equal(inbox.getSnapshot().items.length,1,'Cleanup failure cannot restage an adopted receipt');
  assert.equal(await inbox.take(item.id,{...target,appendText:()=>{adoptions++;return true;}}),false);assert.equal(adoptions,1);
  failRelease=false;inbox.receive();assert.deepEqual(released,['receipt-text']);
  assert.equal(await inbox.takePackage(packageItem.id,{current:()=>true,async choose(){return false;}}),false);
  assert.equal(inbox.getSnapshot().items.length,1);assert.deepEqual(released,['receipt-text']);
  failRelease=true;
  assert.equal(await inbox.takePackage(packageItem.id,{current:()=>true,async choose(pick,signal){assert.ok(await pick(signal));adoptions++;return true;}}),true);
  inbox.receive();assert.equal(inbox.getSnapshot().items.length,0);assert.equal(adoptions,2);
  failRelease=false;inbox.receive();assert.deepEqual(released,['receipt-text','receipt-zip']);
  raw=[{...text,localShareId:'discard-me'}];inbox.receive();assert.equal(inbox.discard(inbox.getSnapshot().items[0]!.id),true);
  assert.deepEqual(released,['receipt-text','receipt-zip','discard-me']);
  raw=[text];inbox.observeIdentity('other');assert.equal(clears,1);assert.equal(inbox.getSnapshot().items.length,0);
  inbox.observeIdentity(null);assert.equal(clears,2);
  raw=[zip];const reopened=createIncomingShareInbox(platform);reopened.observeIdentity('session-owner-2',binding);reopened.receive();
  assert.equal(reopened.getSnapshot().items.length,1,'A fresh inbox accepts the same account durable pending receipt');
});

test('recovered identity cleanup processes newly available input in the same lifecycle',()=>{
  let fail=true,clears=0;
  const fresh:IncomingSharePayload={shareType:'text',value:'New account input',localShareId:'fresh'};
  let raw:IncomingSharePayload[]=[];
  const inbox=createIncomingShareInbox({read:()=>raw,acknowledge(){},subscribe:()=>()=>{},prepare:async()=>{throw Error('unused');},
    clear(){clears++;if(fail)throw Error('disk unavailable');raw=[fresh];}});
  inbox.observeIdentity('old','old-binding');inbox.observeIdentity('new','new-binding');
  assert.equal(clears,1);fail=false;inbox.receive();
  assert.equal(clears,2);assert.equal(inbox.getSnapshot().items[0]?.payload.localShareId,'fresh');
});

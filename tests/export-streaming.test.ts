import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamingExportSession } from '../server/cross-domain-snapshot.ts';
const start = () => createStreamingExportSession({scopeVersion:'s',stage:'growth',afterId:null,done:false,expectedStages:['growth']});
const page = (items: {id:string;payloadHash:string}[], more=true) => ({scopeVersion:'s',stage:'growth' as const,items:items.map(x=>({...x,stage:'growth' as const})),nextAfterId:more?'next':null,nextStage:null,hasMore:more});
test('streaming dedup retains cross-page conflicts and commits pages atomically',()=>{
 const session=start();
 assert.deepEqual(session.advance(page([{id:'a',payloadHash:'1'},{id:'a',payloadHash:'1'}])).acceptedIndices,[0]);
 assert.deepEqual(session.advance(page([{id:'a',payloadHash:'1'},{id:'b',payloadHash:'2'}])).acceptedIndices,[1]);
 const rejected=session.advance(page([{id:'c',payloadHash:'3'},{id:'a',payloadHash:'wrong'}]));
 assert.equal(rejected.status,'invalidated');
 assert.deepEqual(rejected.acceptedIndices,[]);
 assert.deepEqual(session.advance(page([{id:'c',payloadHash:'3'}],false)).acceptedIndices,[0]);
 assert.equal(session.advance(page([],false)).status,'invalidated');
});
test('streaming scope/stage rejection cannot poison later valid page',()=>{
 const session=start();
 assert.equal(session.advance({...page([{id:'a',payloadHash:'1'}]),scopeVersion:'other'}).status,'invalidated');
 assert.equal(session.advance({...page([{id:'a',payloadHash:'1'}]),nextStage:'tasks',hasMore:false,nextAfterId:null}).status,'invalidated');
 assert.deepEqual(session.advance(page([{id:'a',payloadHash:'1'}],false)).acceptedIndices,[0]);
});
test('1000 pages retain only page-sized cursor state, not repeated history arrays',()=>{
 const session=start();
 let total=0;
 for(let p=0;p<1000;p++) {
  const result=session.advance(page(Array.from({length:20},(_,i)=>({id:String(p*20+i),payloadHash:'h'})),p<999));
  assert.notEqual(result.status,'invalidated');
  assert.equal(result.state.items.length,0);
  total+=result.acceptedIndices.length;
 }
 assert.equal(total,20000);
});

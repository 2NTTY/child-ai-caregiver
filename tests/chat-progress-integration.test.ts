import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {reconcileAgentProgress as reconcile,toAgentProgressSource,agentProgressSchema} from '../src/shared/agent-feedback.ts';
import {ChatController} from '../src/client/chat-controller.ts';
const runId=randomUUID(),messageId=randomUUID();
const source=(id='s',stage:'found'|'read'='found',excerpt='excerpt')=>toAgentProgressSource({chunkId:id,title:'Title',publisher:'Publisher',sourceExcerpt:excerpt,url:'https://example.test'},stage)!;
const event=(sequence:number,phase:any,sources?:any[])=>agentProgressSchema.parse({runId,messageId,sequence,phase,...(sources?{sources}:{})});
test('found then ordinary progress then read then stale found then review retains read source',()=>{
 let s=reconcile(null,event(1,'searching',[source()]));
 s=reconcile(s,event(2,'tool_finished')); assert.equal(s.sources.length,1);
 s=reconcile(s,event(3,'reading',[source('s','read','read excerpt')]));
 s=reconcile(s,event(1,'searching',[source()])); assert.equal(s.phase,'reading');assert.equal(s.sources[0].excerpt,'read excerpt');
 s=reconcile(s,event(4,'reviewing'));assert.equal(s.sources[0].stage,'read');
});
test('same phase and same sequence source-only changes are not discarded',()=>{
 let s=reconcile(null,event(1,'reading',[source('s','read')]));
 s=reconcile(s,event(1,'reading',[source('t','read')]));assert.equal(s.sources.length,2);
 assert.equal(reconcile(s,event(1,'reading',[source('t','read')])),s);
});
test('wrong-run source cannot leak; stale read metadata cannot overwrite newer read',()=>{
 const s=reconcile(null,event(5,'reading',[source('s','read','new')]));
 assert.equal(reconcile(s,{...event(6,'reading',[source('x')]),runId:randomUUID()}),s);
 assert.equal(reconcile(s,event(3,'reading',[source('s','read','old')])),s);
 const added=reconcile(s,event(3,'reading',[source('t','read')]));assert.equal(added.sources.length,2);assert.equal(added.sequence,5);
});
test('source cap and multi-round phase advancement survive reconciliation',()=>{
 let s=reconcile(null,event(1,'searching',Array.from({length:6},(_,i)=>source(String(i)))));
 s=reconcile(s,event(2,'tool_finished'));s=reconcile(s,event(3,'model'));assert.equal(s.phase,'model');
 s=reconcile(s,event(4,'reading',[source('later','read')]));assert.equal(s.sources.length,6);assert.equal(s.sources[0].chunkId,'later');
});
test('actual controller keeps source cards through later sequenced events until completion',async()=>{
 const user={id:messageId,childId:'c',authorUserId:'u',role:'user',text:'question',inReplyTo:null};let finish:any;
 const finished=new Promise<any>(r=>finish=r);let seen:any[]=[];
 const api:any={getSession:async()=>({id:'u'}),getOriginalReply:async()=>null,getStatus:async()=>true,getUsage:async()=>({}),requestReply:async(_c:any,_m:any,_sig:any,_u:any,onProgress:any)=>{onProgress(event(1,'searching',[source()]));onProgress(event(2,'model'));onProgress(event(3,'reading',[source('s','read')]));onProgress(event(4,'reviewing'));return finished;}};
 const c=new ChatController(api);(c as any).state={...c.getSnapshot(),userId:'u',selectedChildId:'c',online:true,messages:[user],loadedAt:'now'};
 c.subscribe(()=>{if(c.getSnapshot().feedback)seen.push(c.getSnapshot().feedback)});
 const pending=c.requestReply(messageId);await new Promise(r=>setTimeout(r,0));
 assert.equal(seen.at(-1).phase,'reviewing');assert.equal(seen.at(-1).sources[0].stage,'read');assert.equal(seen.at(-1).sequence,4);
 finish({...user,id:randomUUID(),role:'model',inReplyTo:messageId,authorUserId:null});await pending;assert.equal(c.getSnapshot().feedback,null);c.dispose();
});

test('late read upgrades a found source without regressing phase, sequence or newer metadata',()=>{
 let s=reconcile(null,event(1,'searching',[source('s','found','newer retained metadata')]));
 s=reconcile(s,event(4,'model'));
 const late={...source('s','read','older excerpt'),url:'https://older.example.test',title:'Older title'};
 const upgraded=reconcile(s,event(3,'reading',[late]));
 assert.equal(upgraded.phase,'model');assert.equal(upgraded.sequence,4);
 assert.equal(upgraded.sources[0].stage,'read');
 assert.equal(upgraded.sources[0].excerpt,'newer retained metadata');
 assert.equal(upgraded.sources[0].url,s.sources[0].url);assert.equal(upgraded.sources[0].title,s.sources[0].title);
 assert.equal(reconcile(upgraded,event(2,'searching',[source()])),upgraded);
});
test('late read cannot upgrade a colliding chunk from another source or resurrect a suppressed URL',()=>{
 const original={...source('s'),url:null};
 let s=reconcile(null,event(1,'searching',[original]));s=reconcile(s,event(4,'model'));
 const collision={...source('s','read'),sourceId:'different-source'};
 assert.equal(reconcile(s,event(3,'reading',[collision])),s);
 const upgraded=reconcile(s,event(3,'reading',[source('s','read')]));
 assert.equal(upgraded.sources[0].stage,'read');assert.equal(upgraded.sources[0].url,null);
 assert.equal(reconcile(s,{...event(3,'reading',[source('s','read')]),runId:randomUUID()}),s);
});

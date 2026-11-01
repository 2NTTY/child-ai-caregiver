import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {projectNormalTasksReadClock as project} from '../../scripts/project-normal-tasks-clock.mjs';
import bindings from '../../sources/normal-tasks-read-bindings.json' with {type:'json'};
const root=path.resolve(import.meta.dirname,'../..'),repo=path.resolve(import.meta.dirname,'../..');
const fixture=fs.readFileSync(path.join(repo,'fixtures/normal-tasks.json')),clock=JSON.parse(fixture).scheduleContext;
const args=v=>({variant:v,source:structuredClone(bindings.variants[v].source),receiptSha256:bindings.variants[v].receiptSha256,hookBytes:fs.readFileSync(path.join(root,bindings.variants[v].root,'frontend/src/production/task-knowledge-tasks.ts')),fixtureBytes:Buffer.from(fixture),scheduleContext:{...clock}});
const sealed=JSON.parse(fs.readFileSync(path.join(repo,'fixtures/expected-clock-projection.json')));

test('all valid hidden source and schedule fields retain complete canonical provenance without aliasing',()=>{
 for(const v of ['original','harbour'])for(const nullPrototype of [false,true])for(const target of ['source','scheduleContext']){
  for(const hidden of [...Object.keys(args(v)[target]).map(k=>[k]),Object.keys(args(v)[target])]){
   const a=args(v);if(nullPrototype)Object.setPrototypeOf(a[target],null);for(const k of hidden)Object.defineProperty(a[target],k,{enumerable:false});
   const p=project(a);assert.deepEqual(p,sealed.find(x=>x.variant===v));for(const key of Reflect.ownKeys(a[target])){assert.equal(Object.hasOwn(p[target],key),true);assert.equal(Object.getOwnPropertyDescriptor(p[target],key).enumerable,true);}assert.notEqual(p[target],a[target]);
  }
 }
});
test('fixture toString override cannot substitute a forged clock under authentic fixture bytes',()=>{
 for(const v of ['original','harbour']){const a=args(v),forged=JSON.parse(fixture);forged.scheduleContext.asOf='2027-12-30T16:00:00+08:00';let calls=0;
  Object.defineProperty(a.fixtureBytes,'toString',{value(){calls++;return JSON.stringify(forged);}});a.scheduleContext=forged.scheduleContext;
  assert.throws(()=>project(a),/CLOCK_CONTEXT_STALE/);assert.equal(calls,0);
  a.scheduleContext={...clock};assert.deepEqual(project(a),sealed.find(x=>x.variant===v));assert.equal(calls,0);
 }
});
test('hook indexOf override cannot shift an authenticated edit outside its real source expression',()=>{
 for(const v of ['original','harbour']){const a=args(v);let calls=0;Object.defineProperty(a.hookBytes,'indexOf',{value(match,start){calls++;const at=Buffer.prototype.indexOf.call(this,match,start);return at>=0&&Buffer.from(match).toString()==='const clock = useRef(new Date().toISOString());'?at+1:at;}});
  assert.deepEqual(project(a),sealed.find(x=>x.variant===v));assert.equal(calls,0);
 }
});
test('caller Buffer methods, metadata, iterator and constructor getters are never used for byte snapshot or projection',()=>{
 const keys=['toString','indexOf','includes','subarray','slice','copy','valueOf','toJSON','length','byteLength','byteOffset','buffer','constructor',Symbol.iterator,Symbol.toPrimitive];
 for(const v of ['original','harbour'])for(const field of ['hookBytes','fixtureBytes']){const a=args(v);let calls=0;
  for(const k of keys)Object.defineProperty(a[field],k,{get(){calls++;throw Error('CALLER_BUFFER_MEMBER_READ');},configurable:true});
  assert.deepEqual(project(a),sealed.find(x=>x.variant===v));assert.equal(calls,0);
 }
});
test('wrong backing bytes still reject even if caller methods claim the sealed content; input kinds are not broadened',()=>{
 for(const field of ['hookBytes','fixtureBytes']){const a=args('original');a[field][5]^=1;Object.defineProperty(a[field],'toString',{value(){return (field==='fixtureBytes'?fixture:args('original').hookBytes).toString();}});assert.throws(()=>project(a),field==='fixtureBytes'?/CLOCK_FIXTURE_BYTES_STALE/:/CLOCK_HOOK_BYTES_STALE/);
  for(const value of [new Uint8Array(args('original')[field]),args('original')[field].toString(),{type:'Buffer',data:[1,2]}]){const b=args('original');b[field]=value;assert.throws(()=>project(b));}
 }
});
test('ordinary fs output remains byte-identical to prior sealed projection, all readiness flags remain false',()=>{
 assert.deepEqual(['original','harbour'].map(v=>project(args(v))),sealed);
 for(const v of ['original','harbour']){const a=args(v),p=project(a);a.hookBytes.fill(0);a.fixtureBytes.fill(0);assert.deepEqual(p,sealed.find(x=>x.variant===v));for(const k of ['runtimeReady','frameReady','selectable','dataMapped'])assert.equal(p[k],false);}
});

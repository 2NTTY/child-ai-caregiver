import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import bindings from '../../sources/normal-tasks-read-bindings.json' with {type:'json'};
let api;
try { api=await import('../../scripts/project-normal-tasks-clock.mjs'); }
catch(error) { if(error.code!=='ERR_MODULE_NOT_FOUND')throw error; }
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const root=path.resolve(import.meta.dirname,'../..'),repo=path.resolve(import.meta.dirname,'../..');
const hookPath='frontend/src/production/task-knowledge-tasks.ts';
const helperPath='frontend/src/production/workbench-normal-tasks-read-clock.mjs';
const fixtureBytes=fs.readFileSync(path.join(repo,'fixtures/normal-tasks.json'));
const fixture=JSON.parse(fixtureBytes);
const args=variant=>({variant,source:structuredClone(bindings.variants[variant].source),receiptSha256:bindings.variants[variant].receiptSha256,
 hookBytes:fs.readFileSync(path.join(root,bindings.variants[variant].root,hookPath)),fixtureBytes:Buffer.from(fixtureBytes),scheduleContext:structuredClone(fixture.scheduleContext)});
function project(input){assert.equal(typeof api?.projectNormalTasksReadClock,'function');return api.projectNormalTasksReadClock(input);}
function undo(projection){let bytes=Buffer.from(projection.files[0].source);for(const e of [...projection.overlay.edits].reverse()){
 const after=Buffer.from(e.after);assert.deepEqual(bytes.subarray(e.derivedByteStart,e.derivedByteStart+after.length),after);
 bytes=Buffer.concat([bytes.subarray(0,e.derivedByteStart),Buffer.from(e.before),bytes.subarray(e.derivedByteStart+after.length)]);
}return bytes;}

test('two exact variants produce only the native hook overlay and one owned literal clock module',()=>{
 for(const variant of ['original','harbour']){const a=args(variant),p=project(a);assert.equal(p.status,'source-projected-not-runtime-wired');assert.equal(p.variant,variant);assert.deepEqual(p.source,a.source);assert.equal(p.receiptSha256,a.receiptSha256);assert.equal(p.fixtureSha256,sha(fixtureBytes));assert.deepEqual(p.scheduleContext,fixture.scheduleContext);assert.equal(p.actualBrowserTimeZone,'unverified');assert.deepEqual(p.files.map(f=>f.path),[hookPath,helperPath]);assert.deepEqual(p.files.map(f=>f.role),['owned-derived-native-tasks-read-clock','owned-runtime-clock']);for(const f of p.files){assert.equal(f.sha256,sha(f.source));assert.equal(f.bytes,Buffer.byteLength(f.source));assert.equal(f.mode,420);}for(const flag of ['runtimeReady','frameReady','selectable','dataMapped'])assert.equal(p[flag],false);}
});
test('every derived hook reverses byte-for-byte and every outside-edit segment remains unchanged',()=>{
 for(const variant of ['original','harbour']){const a=args(variant),original=Buffer.from(a.hookBytes),p=project(a),derived=Buffer.from(p.files[0].source);assert.equal(p.overlay.beforeSha256,sha(original));assert.equal(p.overlay.afterSha256,sha(derived));assert.equal(p.overlay.edits.length,3);assert.deepEqual(undo(p),original);assert.deepEqual(a.hookBytes,original);let beforeEnd=0,afterEnd=0;for(const e of p.overlay.edits){assert.deepEqual(original.subarray(e.originalByteStart,e.originalByteStart+Buffer.byteLength(e.before)),Buffer.from(e.before));assert.deepEqual(original.subarray(beforeEnd,e.originalByteStart),derived.subarray(afterEnd,e.derivedByteStart));beforeEnd=e.originalByteStart+Buffer.byteLength(e.before);afterEnd=e.derivedByteStart+Buffer.byteLength(e.after);}assert.deepEqual(original.subarray(beforeEnd),derived.subarray(afterEnd));assert.deepEqual(project(a),p);}
});
test('only initial and accepted-read clock sites change, retaining guards, timezone and call ordering',()=>{
 for(const variant of ['original','harbour']){const a=args(variant),p=project(a),s=p.files[0].source;assert.equal(s.split('normalTasksReadInstant()').length-1,2);assert.equal(s.split('import { normalTasksReadInstant } from "./workbench-normal-tasks-read-clock.mjs";').length-1,1);assert.equal(s.includes('new Date().toISOString()'),false);assert.ok(s.includes('const clock = useRef(normalTasksReadInstant());'));assert.ok(s.includes('setReadState("ready");\n    clock.current = normalTasksReadInstant();\n    setPage('));assert.equal(p.overlay.edits[1].originalLine,variant==='original'?29:32);assert.equal(p.overlay.edits[2].originalLine,variant==='original'?60:67);assert.equal(s.match(/timeZone: "Asia\/Hong_Kong"/g).length,1);assert.equal(p.overlay.edits[1].before,'new Date().toISOString()');assert.equal(p.overlay.edits[2].before,'new Date().toISOString()');}
});
test('owned module returns the exact immutable case instant without Date, imports, timezone mutation or timers',()=>{
 const a=project(args('original')),b=project(args('harbour')),s=a.files[1].source;
 assert.equal(s,'/** Synthetic normal Tasks read time only; not wall time or browser timezone. */\nexport function normalTasksReadInstant() { return "2026-10-04T16:00:00+08:00"; }\n');assert.equal(s,b.files[1].source);assert.doesNotMatch(s,/\b(import|Date|Intl|process|setTimeout|globalThis|fetch)\b/);assert.deepEqual(a.scheduleContext,fixture.scheduleContext);
});
test('stale source, receipt, hook bytes and unknown variant refuse without producing projections',()=>{
 for(const variant of ['original','harbour']){let a=args(variant);a.source.sourceTree='0'.repeat(40);assert.throws(()=>project(a),/CLOCK_SOURCE_STALE/);a=args(variant);a.receiptSha256='0'.repeat(64);assert.throws(()=>project(a),/CLOCK_RECEIPT_STALE/);a=args(variant);a.hookBytes=Buffer.concat([a.hookBytes,Buffer.from('\n')]);assert.throws(()=>project(a),/CLOCK_HOOK_BYTES_STALE/);}
 const a=args('original');a.variant='care';assert.throws(()=>project(a),/CLOCK_VARIANT_UNAVAILABLE/);
});
test('missing, extra or misplaced clock expressions refuse even when there are still two generic matches',()=>{
 for(const variant of ['original','harbour']){let a=args(variant);a.hookBytes=Buffer.from(a.hookBytes.toString().replace('new Date().toISOString()','"clock"'));assert.throws(()=>project(a),/CLOCK_OCCURRENCE_COUNT/);a=args(variant);a.hookBytes=Buffer.concat([a.hookBytes,Buffer.from('\n// new Date().toISOString()\n')]);assert.throws(()=>project(a),/CLOCK_OCCURRENCE_COUNT/);a=args(variant);a.hookBytes=Buffer.from(a.hookBytes.toString().replace('clock.current = new Date().toISOString()','other.current = new Date().toISOString()'));assert.throws(()=>project(a),/CLOCK_SITE_COUNT/);}
});
test('altered fixture or requested instant/timezone refuses, never converting browser timezone',()=>{
 let a=args('original');a.fixtureBytes=Buffer.concat([a.fixtureBytes,Buffer.from('\n')]);assert.throws(()=>project(a),/CLOCK_FIXTURE_BYTES_STALE/);
 for(const scheduleContext of [{asOf:'2026-10-04T08:00:00.000Z',timeZone:'Asia/Hong_Kong'},{asOf:fixture.scheduleContext.asOf,timeZone:'UTC'}]){a=args('original');a.scheduleContext=scheduleContext;assert.throws(()=>project(a),/CLOCK_CONTEXT_STALE/);}
});
test('closed source/clock records reject getters without evaluating them and results do not alias later calls',()=>{
 let calls=0,a=args('original');Object.defineProperty(a.source,'sourceTree',{get(){calls++;return '0'.repeat(40);},enumerable:true});assert.throws(()=>project(a));assert.equal(calls,0);a=args('original');Object.defineProperty(a.scheduleContext,'asOf',{get(){calls++;return fixture.scheduleContext.asOf;},enumerable:true});assert.throws(()=>project(a));assert.equal(calls,0);
 a=args('original');const p=project(a);p.source.sourceTree='0'.repeat(40);p.scheduleContext.asOf='changed';p.files[0].source='changed';assert.equal(project(a).source.sourceTree,a.source.sourceTree);assert.equal(project(a).scheduleContext.asOf,fixture.scheduleContext.asOf);assert.notEqual(project(a).files[0].source,'changed');
});

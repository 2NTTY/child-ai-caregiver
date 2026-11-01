/** Pure build-time source projector. No filesystem/app/config execution or source write. */
import {createHash} from 'node:crypto';
import bindings from '../sources/normal-tasks-read-bindings.json' with {type:'json'};
import {need,record,sourcePin} from '../src/registry.mjs';

const HOOK='frontend/src/production/task-knowledge-tasks.ts';
const HELPER='frontend/src/production/workbench-normal-tasks-read-clock.mjs';
const NOW='new Date().toISOString()';
const CALL='normalTasksReadInstant()';
const IMPORT='import { normalTasksReadInstant } from "./workbench-normal-tasks-read-clock.mjs";\n';
const sites=[['initial-read-clock','const clock = useRef(',');'],['accepted-read-clock','clock.current = ',';']];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// Intrinsics read/copy typed-array backing bytes, not caller-owned metadata or methods.
// This boundary assumes ordinary ambient built-ins; it is not a global monkeypatch sandbox.
const byteLength=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'length').get;
const copyTypedBytes=Uint8Array.prototype.set;
function privateBytes(value,code){
 need(Buffer.isBuffer(value),code);
 const bytes=Buffer.alloc(Reflect.apply(byteLength,value,[]));
 Reflect.apply(copyTypedBytes,bytes,[value]);
 return bytes;
}
const ownData=(value,keys)=>Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(value,key).value]));
function offsets(bytes,text){
 const match=Buffer.from(text),found=[];
 for(let start=0;(start=bytes.indexOf(match,start))!==-1;start+=match.length)found.push(start);
 return found;
}

export function projectNormalTasksReadClock(input){
 record(input,['variant','source','receiptSha256','hookBytes','fixtureBytes','scheduleContext']);
 const {variant,source,receiptSha256,hookBytes:hookInput,fixtureBytes:fixtureInput,scheduleContext}=input;
 need(['original','harbour'].includes(variant),'CLOCK_VARIANT_UNAVAILABLE');
 const binding=bindings.variants[variant],pin=binding.files.find(file=>file.path===HOOK);
 sourcePin(source);
 const canonicalSource=ownData(source,Object.keys(binding.source));
 need(Object.keys(binding.source).every(key=>canonicalSource[key]===binding.source[key]),'CLOCK_SOURCE_STALE');
 need(receiptSha256===binding.receiptSha256,'CLOCK_RECEIPT_STALE');
 const fixtureBytes=privateBytes(fixtureInput,'CLOCK_FIXTURE_BYTES_STALE');
 need(sha(fixtureBytes)===bindings.fixtureDocumentSha256,'CLOCK_FIXTURE_BYTES_STALE');
 const fixture=JSON.parse(fixtureBytes.toString('utf8'));
 record(scheduleContext,['asOf','timeZone']);
 const canonicalClock=ownData(scheduleContext,['asOf','timeZone']);
 need(canonicalClock.asOf===fixture.scheduleContext.asOf&&canonicalClock.timeZone===fixture.scheduleContext.timeZone,'CLOCK_CONTEXT_STALE');
 const hookBytes=privateBytes(hookInput,'CLOCK_HOOK_BYTES_STALE');
 need(offsets(hookBytes,NOW).length===2,'CLOCK_OCCURRENCE_COUNT');
 const changes=sites.map(([kind,prefix,suffix])=>{
  const matches=offsets(hookBytes,prefix+NOW+suffix);need(matches.length===1,'CLOCK_SITE_COUNT');
  return {kind,originalByteStart:matches[0]+Buffer.byteLength(prefix),before:NOW,after:CALL};
 });
 need(hookBytes.length===pin.bytes&&sha(hookBytes)===pin.sha256,'CLOCK_HOOK_BYTES_STALE');
 need(!hookBytes.includes(Buffer.from('normalTasksReadInstant')),'CLOCK_IMPORT_COLLISION');
 need(offsets(hookBytes,'timeZone: "Asia/Hong_Kong"').length===1,'CLOCK_NATIVE_TIMEZONE_STALE');
 const edits=[{kind:'owned-clock-import',originalByteStart:0,before:'',after:IMPORT},...changes];
 let shift=0,previous=0;
 for(const edit of edits){
  need(edit.originalByteStart>=previous,'CLOCK_EDIT_ORDER');
  edit.derivedByteStart=edit.originalByteStart+shift;
  edit.originalLine=1+offsets(hookBytes.subarray(0,edit.originalByteStart),'\n').length;
  previous=edit.originalByteStart+Buffer.byteLength(edit.before);
  shift+=Buffer.byteLength(edit.after)-Buffer.byteLength(edit.before);
 }
 let derived=Buffer.from(hookBytes);
 for(const edit of [...edits].reverse())derived=Buffer.concat([derived.subarray(0,edit.originalByteStart),Buffer.from(edit.after),derived.subarray(edit.originalByteStart+Buffer.byteLength(edit.before))]);
 const helper='/** Synthetic normal Tasks read time only; not wall time or browser timezone. */\n'
  +`export function normalTasksReadInstant() { return ${JSON.stringify(fixture.scheduleContext.asOf)}; }\n`;
 const files=[[HOOK,derived.toString('utf8'),'owned-derived-native-tasks-read-clock'],[HELPER,helper,'owned-runtime-clock']]
  .map(([path,source,role])=>({path,source,role,sha256:sha(source),bytes:Buffer.byteLength(source),mode:420}));
 return {status:'source-projected-not-runtime-wired',variant,source:canonicalSource,receiptSha256,
  fixtureSha256:sha(fixtureBytes),scheduleContext:canonicalClock,actualBrowserTimeZone:'unverified',
  overlay:{path:HOOK,beforeSha256:pin.sha256,afterSha256:files[0].sha256,edits},files,
  runtimeReady:false,frameReady:false,selectable:false,dataMapped:false};
}

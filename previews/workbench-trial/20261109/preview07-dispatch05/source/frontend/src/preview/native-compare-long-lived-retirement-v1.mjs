/** Long-lived retirement evidence v1. Physical cleanup never grants artifact/product audit acceptance. */
const ROOT=['schemaVersion','variant','ownerProfile','case','phase','failures','roots','owners','ownerDisposes','unmountCalls','probeEffects','pending','held','bindingDisposed','defaultNetwork','bindingDiagnostics','bindingObservation','probe','acceptance','shutdownError','cleanup','settlement','role','requests','counterSaturated','timers','events','eventEvicted','eventObservation','guardCount','runtimeReady','frameReady','selectable','mutationReady'];
const NETWORK=['fetch','xhr','websocket','eventsource','beacon','serviceWorker'];
const COUNTS=['scheduled','fired','clearCalls','active','pending','held','ownerDisposes','probeEffects','unmountReturned'];
const ZERO=['pending','held','probeEffects'];
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const record=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
/** Copy only finite, own data. Accessors, exotic prototypes, sparse arrays and cycles are not evidence. */
function data(input){
 const seen=new Set();let nodes=0;
 function copy(v,depth){
  if(depth>40||++nodes>8192)throw Error('EVIDENCE_DATA_LIMIT');
  if(v===null||['string','boolean'].includes(typeof v))return v;
  if(typeof v==='number'&&Number.isFinite(v))return v;
  if(typeof v!=='object'||seen.has(v))throw Error('EVIDENCE_DATA');
  const array=Array.isArray(v),ds=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(ds);
  if(Object.getPrototypeOf(v)!==(array?Array.prototype:Object.prototype)&&!(Object.getPrototypeOf(v)===null&&!array))throw Error('EVIDENCE_PROTOTYPE');
  const out=array?[]:{};seen.add(v);
  if(array&&(!integer(ds.length?.value)||keys.length!==ds.length.value+1))throw Error('EVIDENCE_ARRAY');
  for(const k of keys){if(array&&k==='length')continue;if(typeof k!=='string'||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable||array&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=ds.length.value))throw Error('EVIDENCE_DESCRIPTOR');Object.defineProperty(out,k,{value:copy(ds[k].value,depth+1),enumerable:true});}
  seen.delete(v);return out;
 }
 const out=copy(input,0);if(JSON.stringify(out).length>65536)throw Error('EVIDENCE_BYTES');return out;
}
function counts(v){return record(v,COUNTS)&&COUNTS.filter(k=>k!=='unmountReturned').every(k=>integer(v[k]))&&v.active<=512&&v.pending<=256&&v.held<=256&&v.ownerDisposes<=1&&v.probeEffects<=1&&typeof v.unmountReturned==='boolean';}
function log(rows,total,evicted,bytes,limit,check,ordered=true){return Array.isArray(rows)&&rows.length<=128&&integer(total)&&integer(evicted)&&total===rows.length+evicted&&integer(bytes)&&bytes<=limit&&JSON.stringify(rows).length===bytes&&rows.every((r,i)=>check(r)&&(!ordered||r.sequence===evicted+i+1));}
function timerShape(t){return record(t,['active','counts','retained','evicted','bytes','samples'])&&integer(t.active)&&t.active<=512&&record(t.counts,['scheduled','fired','clearCalls','clearedActive'])&&Object.values(t.counts).every(integer)&&t.counts.clearedActive<=t.counts.clearCalls&&t.counts.clearedActive<=t.counts.scheduled&&t.active<=t.counts.scheduled&&t.retained===t.samples?.length&&log(t.samples,t.counts.scheduled,t.evicted,t.bytes,8192,r=>record(r,['sequence','kind','delay'])&&['timeout','interval'].includes(r.kind)&&(r.delay===null||typeof r.delay==='number'&&Number.isFinite(r.delay)));}
// Request IDs reflect initiation order; completion-order rows may legitimately be [2,1].
function bindingShape(s){
 const b=s.bindingObservation;
 return record(b,['total','evicted','bytes','saturated','requests','counterSaturated'])&&b.saturated===false&&b.counterSaturated===false&&integer(b.requests)&&b.requests===s.requests.total&&b.total<=b.requests&&b.requests-b.total<=s.pending&&log(s.bindingDiagnostics,b.total,b.evicted,b.bytes,16384,r=>{
  if(!integer(r.sequence)||r.sequence<1||r.sequence>b.requests)return false;
  if(['success','unavailable'].includes(r.outcome))return record(r,['sequence','outcome','route','status'])&&typeof r.route==='string'&&/^GET |^POST /.test(r.route)&&r.route.length<=1024&&r.status===(r.outcome==='success'?200:503);
  return record(r,['sequence','outcome','route'])&&['aborted','rejected'].includes(r.outcome)&&r.route===null;
 },false)&&new Set(s.bindingDiagnostics.map(r=>r.sequence)).size===s.bindingDiagnostics.length;
}
function shape(s){
 if(!record(s,ROOT)||s.schemaVersion!==1||s.variant!=='harbour'||s.ownerProfile!=='harbour-native-photo-owner-v1'||s.case!=='normal'||s.role!=='long-lived-synthetic-preview')return false;
 if(!['roots','owners','ownerDisposes','unmountCalls','probeEffects','pending','held','guardCount','eventEvicted'].every(k=>integer(s[k]))||s.pending>256||s.held>256||['roots','owners','ownerDisposes','unmountCalls','probeEffects'].some(k=>s[k]>1)||![13,14].includes(s.guardCount)||s.counterSaturated!==false||typeof s.bindingDisposed!=='boolean')return false;
 if(!Array.isArray(s.failures)||s.failures.length!==0||!record(s.defaultNetwork,NETWORK)||!NETWORK.every(k=>s.defaultNetwork[k]===0)||!['runtimeReady','frameReady','selectable','mutationReady'].every(k=>s[k]===false))return false;
 if(!record(s.requests,['total'])||!integer(s.requests.total)||!timerShape(s.timers)||!bindingShape(s))return false;
 const e=s.eventObservation;if(!record(e,['total','retained','evicted','bytes','saturated'])||e.saturated!==false||e.retained!==s.events?.length||s.eventEvicted!==e.evicted||!log(s.events,e.total,e.evicted,e.bytes,8192,r=>record(r,['sequence','kind','phase'])&&typeof r.kind==='string'&&r.kind.length<=128&&typeof r.phase==='string'&&r.phase.length<=128))return false;
 return (s.probe===null||typeof s.probe==='object')&&JSON.stringify(s.probe).length<=16384&&record(s.cleanup,['attempts','error','before','forcedTimers','forcedHolds','remainingPending'])&&['attempts','forcedTimers','forcedHolds','remainingPending'].every(k=>integer(s.cleanup[k]))&&record(s.settlement,['turns','quietTurns','elapsedMs','stopReason','before','after']);
}
function ready(s){return shape(s)&&['native-root-returned','native-probe-committed'].includes(s.phase)&&s.roots===1&&s.owners===1&&s.unmountCalls===0&&s.ownerDisposes===0&&s.bindingDisposed===false&&s.acceptance==='not-evaluated'&&s.shutdownError===null&&s.cleanup.attempts===0&&s.cleanup.error===null&&s.cleanup.before===null&&['forcedTimers','forcedHolds','remainingPending'].every(k=>s.cleanup[k]===0)&&s.settlement.turns===0&&s.settlement.quietTurns===0&&s.settlement.elapsedMs===0&&s.settlement.stopReason==='not-started'&&s.settlement.before===null&&s.settlement.after===null;}
function beforeReady(value){try{return ready(data(value));}catch{return false;}}
function monotonic(a,b){return ['scheduled','fired','clearCalls','clearedActive'].every(k=>b.timers.counts[k]>=a.timers.counts[k])&&b.timers.evicted>=a.timers.evicted&&b.requests.total>=a.requests.total&&['total','evicted','requests'].every(k=>b.bindingObservation[k]>=a.bindingObservation[k])&&['total','evicted'].every(k=>b.eventObservation[k]>=a.eventObservation[k])&&a.guardCount===b.guardCount;}
/** Pure predicate: only issued view/collector supplies lifecycle authority and genuine Promise outcome. */
export function longLivedEvidenceIsCompleteV1(before,after,error){
 try{
  const a=data(before),b=data(after);if(error!==undefined||!ready(a)||!shape(b)||!monotonic(a,b)||b.phase!=='closed-observation'||b.acceptance!=='native-settlement-observed'||b.shutdownError!==null)return false;
  if(b.roots!==1||b.owners!==1||b.unmountCalls!==1||b.ownerDisposes!==1||!ZERO.every(k=>b[k]===0)||b.bindingDisposed!==true||b.timers.active!==0||b.bindingObservation.total!==b.requests.total)return false;
  const c=b.cleanup;if(c.attempts!==1||c.error!==null||!['forcedTimers','forcedHolds','remainingPending'].every(k=>c[k]===0)||!record(c.before,['pending','held','timers','probeEffects','ownerDisposes','unmountReturned'])||!ZERO.every(k=>c.before[k]===0)||c.before.timers!==0||c.before.ownerDisposes!==1||c.before.unmountReturned!==true)return false;
  const s=b.settlement;if(s.stopReason!=='quiescent'||s.quietTurns!==2||!integer(s.turns)||s.turns<2||s.turns>64||typeof s.elapsedMs!=='number'||!Number.isFinite(s.elapsedMs)||s.elapsedMs<0||s.elapsedMs>=1000||!counts(s.before)||!counts(s.after))return false;
  if(!ZERO.every(k=>s.after[k]===0)||s.after.active!==0||s.after.ownerDisposes!==1||s.after.unmountReturned!==true||s.before.ownerDisposes!==1||s.before.unmountReturned!==true)return false;
  if(!['scheduled','fired','clearCalls'].every(k=>s.after[k]===b.timers.counts[k]&&s.after[k]>=s.before[k]&&s.before[k]>=a.timers.counts[k])||s.after.scheduled-s.before.scheduled<s.turns||s.after.fired-s.before.fired<s.turns)return false;
  return true;
 }catch{return false;}
}
const refusal=()=>({outcome:'refused',reason:'CLEANUP_INCOMPLETE',cleanup:null,acceptance:null});
const success=()=>({outcome:'retired',reason:null,cleanup:{unmountReturned:true,ownerDisposes:1,probeEffects:0,pending:0,held:0,activeTimers:0,bindingDisposed:true},acceptance:{status:'unverified',failures:[]}});
let lastReceipt=null;
function errorRecord(error){const type=error===null?'null':typeof error;if(error===null||['undefined','boolean','number','string'].includes(type))return {type,value:type==='undefined'?null:error};const d=Object.getOwnPropertyDescriptor(error,'message');return {type,message:d&&Object.hasOwn(d,'value')&&typeof d.value==='string'?d.value:null,aggregate:error instanceof AggregateError};}
/** A detached diagnostic record only: never retain owner/root/view/Promise/window or dispatch. */
export function retainLongLivedRetirementV1(command,result,delivery){
 const context={sessionId:command.sessionId,side:command.side,frameEpoch:command.frameEpoch,documentId:command.documentId,requestId:command.requestId};
 lastReceipt=JSON.parse(JSON.stringify({collectorVersion:'long-lived-retirement-v1',context,physicalStatus:result.physicalStatus,auditStatus:result.auditStatus,terminal:result.terminal,delivery,before:result.raw.before,previousAfter:result.raw.previousAfter??null,after:result.raw.after,terminalRefresh:result.raw.terminalRefresh===true,rejected:result.raw.rejected,error:errorRecord(result.raw.error),collectionFailed:result.raw.collectionFailed===true,collectionError:errorRecord(result.raw.collectionError)}));
}
export function readLastLongLivedRetirementV1(){return lastReceipt===null?null:JSON.parse(JSON.stringify(lastReceipt));}
/** Synchronous final read, no new native action or await before the controller's wire completion. */
export function refreshLongLivedRetirementV1(view,previous,current){
 const raw=previous.raw;let after=null,collectionError=raw.collectionError,collectionFailed=raw.collectionFailed===true,complete=false;
 try{after=view.snapshot();complete=previous.terminal.outcome==='retired'&&raw.collectionFailed===false&&raw.attempt?.status==='accepted'&&raw.attempt.preflightOkay===true&&raw.rejected===false&&view.current()&&current()&&longLivedEvidenceIsCompleteV1(raw.before,after,raw.error);}catch(error){collectionFailed=true;collectionError=error;}
 return {terminal:complete?success():refusal(),physicalStatus:complete?'tracked-native-retired-at-observation':'unconfirmed',auditStatus:'not-completed',raw:{...raw,previousAfter:raw.after,after,terminalRefresh:true,collectionFailed,collectionError}};
}
export async function collectLongLivedRetirementV1(view,preflight,current){
 let before=null,after=null,error,attempt=null,rejected=false,collectionFailed=false,collectionError;
 try{
  attempt=await view.begin(enter=>preflight(()=>{before=view.snapshot();if(!view.current()||!beforeReady(before))return null;return enter();}));
  if(attempt.status==='accepted'){
   try{await attempt.shutdown;}catch(value){rejected=true;error=value;}
   after=view.snapshot();
   if(attempt.preflightOkay&&rejected===false&&view.current()&&current()&&longLivedEvidenceIsCompleteV1(before,after,error))return {terminal:success(),physicalStatus:'tracked-native-retired-at-observation',auditStatus:'not-completed',raw:{before,after,error,rejected,attempt,collectionFailed}};
  }
 }catch(value){collectionFailed=true;collectionError=value;}
 return {terminal:refusal(),physicalStatus:'unconfirmed',auditStatus:'not-completed',raw:{before,after,error,rejected,attempt,collectionFailed,collectionError}};
}

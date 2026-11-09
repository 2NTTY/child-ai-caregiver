/** Source-specific collector. Physical cleanup is not audit acceptance. No timer or native action here. */
const ROOT=['schemaVersion','variant','case','phase','failures','roots','owners','ownerDisposes','unmountCalls','probeEffects','pending','held','bindingDisposed','defaultNetwork','bindingDiagnostics','probe','acceptance','shutdownError','cleanup','settlement','timers','eventOverflow','events','runtimeReady','frameReady','selectable','mutationReady'];
const NETWORK=['fetch','xhr','websocket','eventsource','beacon','serviceWorker'];
const COUNTS=['scheduled','fired','clearCalls','active','pending','held','ownerDisposes','probeEffects','unmountReturned'];
const ZERO=['pending','held','probeEffects'];
const FAILURES=['TIMER_ATTRIBUTION_PENDING','UNMOUNT_SETTLEMENT_FAILED'];
const integer=n=>Number.isSafeInteger(n)&&n>=0;
function record(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;const ds=Object.getOwnPropertyDescriptors(value),actual=Reflect.ownKeys(ds);return actual.length===keys.length&&actual.every(k=>typeof k==='string'&&keys.includes(k)&&Object.hasOwn(ds[k],'value'));}
function snapshotShape(s){return record(s,ROOT)&&s.schemaVersion===1&&['original','harbour'].includes(s.variant)&&s.case==='normal'&&['roots','owners','ownerDisposes','unmountCalls','probeEffects','pending','held','eventOverflow'].every(k=>integer(s[k]))&&Array.isArray(s.failures)&&Array.isArray(s.events)&&s.events.length<=512&&Array.isArray(s.bindingDiagnostics)&&s.bindingDiagnostics.length<=256&&record(s.defaultNetwork,NETWORK)&&NETWORK.every(k=>s.defaultNetwork[k]===0)&&['runtimeReady','frameReady','selectable','mutationReady'].every(k=>s[k]===false);}
function beforeReady(s){return snapshotShape(s)&&['native-root-returned','native-probe-committed'].includes(s.phase)&&s.roots===1&&s.owners===1&&s.unmountCalls===0&&s.ownerDisposes===0&&s.bindingDisposed===false&&s.failures.length===0&&s.acceptance==='not-evaluated'&&s.shutdownError===null&&record(s.cleanup,['attempts','error','before'])&&s.cleanup.attempts===0&&s.cleanup.error===null&&s.cleanup.before===null&&s.eventOverflow===0;}
function counts(value){return record(value,COUNTS)&&COUNTS.filter(k=>k!=='unmountReturned').every(k=>integer(value[k]))&&typeof value.unmountReturned==='boolean';}
function timerEvidence(t,settlement){
 const keys=['active','observed','attribution','counts','script','origins','provenanceBytes','provenanceReservedBytes','sourceUnavailable','sourceTruncated','originOverflow','originByteOverflow','sourceScriptMismatch','counterOverflow'];
 if(!record(t,keys)||t.active!==0||!integer(t.observed)||t.observed<2||t.observed>512||t.attribution!=='UNRESOLVED_BUILD_CALLSITE'||!record(t.counts,['scheduled','fired','clearCalls','clearedActive'])||!Object.values(t.counts).every(integer)||t.counts.scheduled!==t.observed||t.counts.clearedActive>t.counts.clearCalls)return false;
 if(!['scheduled','fired','clearCalls'].every(k=>settlement.after[k]===t.counts[k])||!['originOverflow','originByteOverflow','sourceScriptMismatch'].every(k=>t[k]===0)||t.counterOverflow!==false)return false;
 if(!['sourceUnavailable','sourceTruncated'].every(k=>integer(t[k])&&t[k]<=t.observed)||!integer(t.provenanceBytes)||!integer(t.provenanceReservedBytes)||t.provenanceBytes>t.provenanceReservedBytes||t.provenanceReservedBytes>32768)return false;
 if(t.script!==null&&(typeof t.script!=='string'||!/^_expo\/static\/js\/web\/index-[a-f0-9]{32}\.js$/.test(t.script)))return false;
 if(!Array.isArray(t.origins)||t.origins.length<1||t.origins.length>512)return false;
 const sums={scheduled:0,fired:0,cleared:0,active:0};
 for(let i=0;i<t.origins.length;i++){const o=t.origins[i];if(!record(o,['id','kind','delay','frames','scheduled','fired','cleared','active'])||o.id!==i+1||!['timeout','interval'].includes(o.kind)||(o.delay!==null&&(typeof o.delay!=='number'||!Number.isFinite(o.delay)))||!['scheduled','fired','cleared','active'].every(k=>integer(o[k]))||o.active!==0)return false;
  if(!Array.isArray(o.frames)||o.frames.length>4||!o.frames.every(pair=>Array.isArray(pair)&&pair.length===2&&pair.every(n=>Number.isSafeInteger(n)&&n>0&&n<=999999999)))return false;
  if(o.kind==='timeout'?o.scheduled!==o.fired+o.cleared:o.scheduled!==o.cleared)return false;
  for(const key of Object.keys(sums))sums[key]+=o[key];
 }
 return sums.scheduled===t.counts.scheduled&&sums.fired===t.counts.fired&&sums.cleared===t.counts.clearedActive&&sums.active===0&&JSON.stringify({script:t.script,origins:t.origins}).length===t.provenanceBytes;
}
/** Pure predicate only; this function grants no lifecycle or wire authority. Collector reads issued view directly. */
export function retirementEvidenceIsComplete(before,after,error){
 try{
  if(!beforeReady(before)||!snapshotShape(after)||before.variant!==after.variant||after.phase!=='failed-observation'||after.acceptance!=='failed')return false;
  if(!error||Object.getPrototypeOf(error)!==Error.prototype)return false;const message=Object.getOwnPropertyDescriptor(error,'message');if(!message||!Object.hasOwn(message,'value')||message.value!=='NORMAL_SOURCE_TIMER_ATTRIBUTION_PENDING')return false;
  if(!record(after.shutdownError,['stage','code'])||after.shutdownError.stage!=='settle'||after.shutdownError.code!=='TIMER_ATTRIBUTION_PENDING'||after.failures.length!==2||new Set(after.failures).size!==2||!FAILURES.every(k=>after.failures.includes(k)))return false;
  if(after.roots!==1||after.owners!==1||after.unmountCalls!==1||after.ownerDisposes!==1||!ZERO.every(k=>after[k]===0)||after.bindingDisposed!==true||after.eventOverflow!==0)return false;
  const c=after.cleanup;if(!record(c,['attempts','error','before'])||c.attempts!==1||c.error!==null||!record(c.before,['pending','held','timers','probeEffects','ownerDisposes','unmountReturned'])||!ZERO.every(k=>c.before[k]===0)||c.before.timers!==0||c.before.ownerDisposes!==1||c.before.unmountReturned!==true)return false;
  const s=after.settlement;if(!record(s,['turns','quietTurns','elapsedMs','stopReason','before','after'])||s.stopReason!=='quiescent'||s.quietTurns!==2||!integer(s.turns)||s.turns<2||s.turns>64||typeof s.elapsedMs!=='number'||!Number.isFinite(s.elapsedMs)||s.elapsedMs<0||s.elapsedMs>=1000||!counts(s.before)||!counts(s.after))return false;
  if(!ZERO.every(k=>s.after[k]===0)||s.after.active!==0||s.after.ownerDisposes!==1||s.after.unmountReturned!==true||!timerEvidence(after.timers,s))return false;
  return after.events.every((e,i)=>record(e,['sequence','kind','phase'])&&e.sequence===i+1&&typeof e.kind==='string'&&typeof e.phase==='string');
 }catch{return false;}
}
const refusal=()=>({outcome:'refused',reason:'CLEANUP_INCOMPLETE',cleanup:null,acceptance:null});
let lastReceipt=null;
function errorRecord(error){
 const type=error===null?'null':typeof error;
 if(error===null||['undefined','boolean','number','string'].includes(type))return {type,value:type==='undefined'?null:error};
 const descriptor=Object.getOwnPropertyDescriptor(error,'message');
 return {type,message:descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='string'?descriptor.value:null,aggregate:error instanceof AggregateError};
}
/** Retain only detached diagnostic data, never a root/owner/view/Promise/Window/dispatch closure. */
export function retainNormalSourceRetirementReceipt(command,result,delivery){
 const context={sessionId:command.sessionId,side:command.side,frameEpoch:command.frameEpoch,documentId:command.documentId,requestId:command.requestId};
 lastReceipt=JSON.parse(JSON.stringify({context,physicalStatus:result.physicalStatus,auditStatus:result.auditStatus,terminal:result.terminal,delivery,
  before:result.raw.before,previousAfter:result.raw.previousAfter??null,after:result.raw.after,terminalRefresh:result.raw.terminalRefresh===true,rejected:result.raw.rejected,error:errorRecord(result.raw.error),collectionFailed:result.raw.collectionFailed===true,collectionError:errorRecord(result.raw.collectionError)}));
}
export function readLastNormalSourceRetirementReceipt(){return lastReceipt===null?null:JSON.parse(JSON.stringify(lastReceipt));}
/** Synchronous terminal observation: no Promise/await/native action between this and wire completion. */
export function refreshNormalSourceRetirementReceipt(view,previous,current){
 const raw=previous.raw;let after=null,collectionError=raw.collectionError,collectionFailed=raw.collectionFailed===true,complete=false;
 try{
  after=view.snapshot();
  complete=previous.terminal.outcome==='retired'&&raw.collectionFailed===false&&raw.attempt?.status==='accepted'&&raw.attempt.preflightOkay===true&&raw.rejected===true&&view.current()&&current()&&retirementEvidenceIsComplete(raw.before,after,raw.error);
 }catch(error){collectionFailed=true;collectionError=error;}
 return {terminal:complete?{outcome:'retired',reason:null,cleanup:{unmountReturned:true,ownerDisposes:1,probeEffects:0,pending:0,held:0,activeTimers:0,bindingDisposed:true},acceptance:{status:'failed',failures:[...after.failures]}}:refusal(),
  physicalStatus:complete?'tracked-native-retired-at-observation':'unconfirmed',auditStatus:complete?'timer-attribution-open':'not-completed',
  raw:{...raw,previousAfter:raw.after,after,terminalRefresh:true,collectionFailed,collectionError}};
}
/** view and callbacks are native-issued closures, never parent data. Full raw evidence stays local. */
export async function collectNormalSourceRetirement(view,preflight,current){
 let before=null,after=null,error,attempt=null,rejected=false,collectionFailed=false,collectionError;
 try{
  attempt=await view.begin(enter=>preflight(()=>{
   before=view.snapshot();
   if(!view.current()||!beforeReady(before))return null;
   return enter();
  }));
  if(attempt.status==='accepted'){
   try{await attempt.shutdown;}catch(value){rejected=true;error=value;}
   // Fresh internal read AFTER original finally disposal. This executes the later snapshot
   // equality check; the skipped pre-disposal finish equality is never claimed to have run.
   after=view.snapshot();
   if(attempt.preflightOkay&&rejected&&view.current()&&current()&&retirementEvidenceIsComplete(before,after,error))return {
    terminal:{outcome:'retired',reason:null,cleanup:{unmountReturned:true,ownerDisposes:1,probeEffects:0,pending:0,held:0,activeTimers:0,bindingDisposed:true},acceptance:{status:'failed',failures:[...after.failures]}},
    physicalStatus:'tracked-native-retired-at-observation',auditStatus:'timer-attribution-open',raw:{before,after,error,rejected,attempt,collectionFailed},
   };
  }
 }catch(value){collectionFailed=true;collectionError=value;}
 return {terminal:refusal(),physicalStatus:'unconfirmed',auditStatus:'not-completed',raw:{before,after,error,rejected,attempt,collectionFailed,collectionError}};
}

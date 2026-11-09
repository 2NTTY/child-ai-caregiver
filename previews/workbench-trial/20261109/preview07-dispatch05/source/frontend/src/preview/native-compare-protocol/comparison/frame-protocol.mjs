/** Browser-safe pure protocol state. No ambient effects, Node imports or native operations.
 * Only the generated, reviewed static admission-table module should call bindFrameProtocol.
 * Its table is a trusted compiled source input, NOT data supplied by a frame, draft or URL.
 * Terminal receipts assume the future native bridge revoked all command closures first;
 * this source-only state machine cannot attest that native work or cleanup actually occurred.
 */
import registry from '../vendor/frozen-registry.mjs';
import {planSemanticNavigation} from '../vendor/semantic-navigation.mjs';
import {sourcePin,modulePin} from '../vendor/registry.mjs';
const PROTOCOL='local-native-compare-v1', MAX_REV=1000000000;
const ORIGINS={original:'http://127.0.0.1:8871',harbour:'http://127.0.0.1:8872'};
const FIXTURE={documentSha256:'d108aca1f8248e76e28ce4ab5c3497005cff5f1e6f15f2d23081b8d32bd2d5e4',childId:'preview-child-01',asOf:'2026-10-04T16:00:00+08:00',timeZone:'Asia/Hong_Kong'};
const REFUSALS=['DIRTY','SAVING','UNKNOWN','GUARD_UNAVAILABLE','STALE_CONTEXT','ROUTE_UNAVAILABLE','FIXTURE_MISMATCH','SOURCE_MISMATCH','BUSY','CLEANUP_INCOMPLETE'];
const GUARDS=['clean','dirty','saving','unknown','unavailable'];
const FAILURE_CODES=['BINDING_DISPOSE_THROW','CONTROL_COMMAND_FAILED','DEFAULT_NETWORK_ATTEMPT','DIAGNOSTIC_LIMIT','EVENT_LIMIT','FOREIGN_DESCRIPTOR','GUARD_CHANGED','HOLD_SIGNAL','INSTALL_FAILED','LATE_LIFECYCLE_WORK','LATE_PENDING_WORK','LATE_PROBE','LATE_SNAPSHOT','LATE_TIMER_WORK','MULTIPLE_PROBES','MULTIPLE_ROOTS','NATIVE_REGISTRATION_THROW','OBSERVATION_FAILED','OWNER_DISPOSE_DUPLICATE','OWNER_DISPOSE_THROW','OWNER_IDENTITY','PENDING_LIMIT','PROBE_CLEANUP_DUPLICATE','PROMISE_SHAPE','REQUEST_LIMIT','ROOT_UNMOUNT_THROW','TIMER_ATTRIBUTION_PENDING','TIMER_CALLBACK','TIMER_COUNTER_LIMIT','TIMER_ID_COLLISION','TIMER_LIMIT','TIMER_ORIGIN_BYTES','TIMER_ORIGIN_LIMIT','TIMER_SOURCE_SCRIPT','UNMOUNT_SETTLEMENT_FAILED'];
const ENVELOPE=['protocol','sessionId','side','frameEpoch','documentId','admissionSha256','kind','requestId','payload'];
const RECORD=['schemaVersion','variantId','origin','schemaSource','schemaReceiptSha256','nativeDonorSource','derivativeReceiptSha256','artifactManifestSha256','bridgeModule','guardModule','routeAdapterSha256','fixtureDocumentSha256','bootstrapDocumentSha256','identifierMapSha256','asOf','timeZone'];
const need=(ok,code='INVALID_SHAPE')=>{if(!ok)throw Error(code);};
const integer=(x,max=MAX_REV)=>Number.isSafeInteger(x)&&x>=0&&x<=max;
const hex=(x,n)=>typeof x==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(x);
const canon=x=>Array.isArray(x)?'['+x.map(canon).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canon(x[k])).join(',')+'}':JSON.stringify(x);
const equal=(a,b)=>canon(a)===canon(b);
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
function own(x,keys){
 need(x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x)));
 const ds=Object.getOwnPropertyDescriptors(x),ks=Reflect.ownKeys(ds);
 need(ks.length===keys.length&&ks.every(k=>typeof k==='string'&&keys.includes(k)));
 const out={};for(const k of keys){need(ds[k]&&Object.hasOwn(ds[k],'value'));Object.defineProperty(out,k,{value:ds[k].value,enumerable:true});}return out;
}
// postMessage structured clone excludes proxies. Descriptor checks never invoke data accessors;
// direct in-realm Proxy metadata traps are outside that transport guarantee (no browser Proxy detector).
function jsonData(input,limit=4096){
 let count=0;const seen=new Set();
 function copy(x,depth){
  need(depth<=8&&++count<=512);
  if(x===null||typeof x==='boolean')return x;
  if(typeof x==='number'){need(Number.isFinite(x));return x;}
  if(typeof x==='string'){need(x.length<=limit);return x;}
  need(typeof x==='object'&&!seen.has(x));seen.add(x);
  const array=Array.isArray(x);need(Object.getPrototypeOf(x)===(array?Array.prototype:Object.prototype)||!array&&Object.getPrototypeOf(x)===null);
  const ds=Object.getOwnPropertyDescriptors(x),ks=Reflect.ownKeys(ds);let out;
  if(array){need(integer(x.length,128)&&ks.length===x.length+1);out=[];for(let i=0;i<x.length;i++){const d=ds[String(i)];need(d&&Object.hasOwn(d,'value'));out.push(copy(d.value,depth+1));}}
  else{need(ks.length<=32);out={};for(const k of ks){need(typeof k==='string'&&k.length<=128&&Object.hasOwn(ds[k],'value'));Object.defineProperty(out,k,{value:copy(ds[k].value,depth+1),enumerable:true,writable:true,configurable:true});}}
  seen.delete(x);return out;
 }
 const data=copy(input,0);need(new TextEncoder().encode(JSON.stringify(data)).byteLength<=limit);return data;
}
function viewport(v){const x=own(v,['width','height']);need([320,390,1024,1440].includes(x.width)&&integer(x.height,1600)&&x.height>=240);return x;}
function fixture(v){const x=own(v,['documentSha256','childId','asOf','timeZone']);need(equal(x,FIXTURE),'FIXTURE_MISMATCH');return x;}
function context(v){const x=own(v,['sessionId','side','frameEpoch','documentId','admissionSha256']);need(hex(x.sessionId,32)&&['left','right'].includes(x.side)&&hex(x.frameEpoch,32)&&hex(x.documentId,32)&&hex(x.admissionSha256,64));return x;}
function envelope(value){const e=own(jsonData(value),ENVELOPE);need(e.protocol===PROTOCOL&&hex(e.sessionId,32)&&['left','right'].includes(e.side)&&hex(e.frameEpoch,32)&&(e.documentId===null||hex(e.documentId,32))&&hex(e.admissionSha256,64)&&integer(e.requestId,128)&&typeof e.kind==='string');return e;}
function routePlan(row,request){const p=planSemanticNavigation(registry,request);need(p.status==='source-plan'&&p.semanticPage==='tasks','ROUTE_UNAVAILABLE');const t=p.targets[row.record.variantId].translation;need(t.status==='mapped','ROUTE_UNAVAILABLE');return t;}
function checkedRoute(row,value){if(value===null)return null;const r=own(value,['semanticPage','pageState']);routePlan(row,{...r,scenario:'normal',fixtureIdentity:FIXTURE});return r;}
function routeEqual(row,a,b){return a===null||b===null?a===b:equal(routePlan(row,{...a,scenario:'normal',fixtureIdentity:FIXTURE}),routePlan(row,{...b,scenario:'normal',fixtureIdentity:FIXTURE}));}
function observation(row,input){const p=own(input,['routeRevision','route','guard']);need(integer(p.routeRevision)&&GUARDS.includes(p.guard));checkedRoute(row,p.route);return p;}
function commandPayload(row,e){
 need(['navigate','retire'].includes(e.kind)&&e.requestId>0&&e.documentId!==null);
 const p=own(e.payload,e.kind==='navigate'?['expectedRouteRevision','request','historyMode']:['expectedRouteRevision']);need(integer(p.expectedRouteRevision));
 if(e.kind==='navigate'){need(['push','replace'].includes(p.historyMode));routePlan(row,p.request);}return p;
}
function terminalPayload(row,e,command){
 need(e.kind===(command.kind==='navigate'?'navigation-result':'retirement-result'));
 if(e.kind==='navigation-result'){
  const p=own(e.payload,['outcome','reason','routeRevision','route']);need(['committed','unchanged','refused','cancelled'].includes(p.outcome)&&integer(p.routeRevision));checkedRoute(row,p.route);
  if(['committed','unchanged'].includes(p.outcome)){need(p.reason===null&&p.route!==null&&routeEqual(row,p.route,{semanticPage:command.payload.request.semanticPage,pageState:command.payload.request.pageState}));need(p.outcome==='committed'?p.routeRevision>command.payload.expectedRouteRevision:p.routeRevision===command.payload.expectedRouteRevision);}
  else need(REFUSALS.includes(p.reason));return p;
 }
 const p=own(e.payload,['outcome','reason','cleanup','acceptance']);need(['retired','refused','cancelled'].includes(p.outcome));need(p.outcome==='retired'?p.reason===null:REFUSALS.includes(p.reason));
 if(p.cleanup!==null){const c=own(p.cleanup,['unmountReturned','ownerDisposes','probeEffects','pending','held','activeTimers','bindingDisposed']);need(typeof c.unmountReturned==='boolean'&&typeof c.bindingDisposed==='boolean');for(const k of ['ownerDisposes','probeEffects','pending','held','activeTimers'])need(Number.isSafeInteger(c[k])&&c[k]>=0);}
 if(p.acceptance!==null){const a=own(p.acceptance,['status','failures']);need(['unverified','failed','passed'].includes(a.status)&&Array.isArray(a.failures)&&a.failures.length<=16&&new Set(a.failures).size===a.failures.length&&a.failures.every(x=>FAILURE_CODES.includes(x)));need(a.status==='failed'||a.failures.length===0);}
 if(p.outcome==='retired'){const c=p.cleanup;need(c&&c.unmountReturned&&c.bindingDisposed&&c.ownerDisposes===1&&c.probeEffects===0&&c.pending===0&&c.held===0&&c.activeTimers===0&&p.acceptance!==null);}
 return p;
}
const refused=reason=>freeze({status:'refused',reason});
const ignored=()=>freeze({status:'ignored'});
const guardReason=guard=>({dirty:'DIRTY',saving:'SAVING',unknown:'UNKNOWN',unavailable:'GUARD_UNAVAILABLE'})[guard];

// Trusted compiled recipe identity, not a browser hash/recipe execution attestation.
function checkedPreIdentity(value){
 const p=own(jsonData(value,8192),['sha256','record','config']),r=own(p.record,['identityVersion','variantId','schemaSource','schemaReceiptSha256','nativeDonorSource','recipeSha256','inputManifestSha256','templateManifestSha256','configSha256']);
 need(hex(p.sha256,64)&&r.identityVersion==='local-native-derivation-v1'&&Object.hasOwn(ORIGINS,r.variantId));sourcePin(r.schemaSource);sourcePin(r.nativeDonorSource);
 need(equal(r.schemaSource,registry.sources[r.variantId].source)&&r.schemaReceiptSha256===registry.sources[r.variantId].receiptSha256);
 for(const k of ['schemaReceiptSha256','recipeSha256','inputManifestSha256','templateManifestSha256','configSha256'])need(hex(r[k],64));
 const c=own(p.config,['protocol','parentOrigin','childOrigin','bridgeModule','guardModule','routeAdapterSha256','fixtureDocumentSha256','bootstrapDocumentSha256','identifierMapSha256','asOf','timeZone']);
 need(c.protocol===PROTOCOL&&c.parentOrigin==='http://127.0.0.1:8870'&&c.childOrigin===ORIGINS[r.variantId]);
 for(const key of ['bridgeModule','guardModule']){own(c[key],['path','version']);modulePin({...c[key],sha256:'0'.repeat(64),ownerContract:'tasks-single-owner-v1'});}
 need(c.bridgeModule.version===PROTOCOL&&c.routeAdapterSha256==='a439b742b7701badd4b0eb53c418b5756030c59c43f05966a300f4f40a872840'&&c.fixtureDocumentSha256===FIXTURE.documentSha256&&c.bootstrapDocumentSha256==='2e9175cd7b4f4556742cf785799255872155433e37c47f90c784280549105dee'&&c.identifierMapSha256==='047a65c3932251c237d89e91047a9da81453be081fdd6946607f096d93e25a6c'&&c.asOf===FIXTURE.asOf&&c.timeZone===FIXTURE.timeZone);
 return freeze(p);
}

/** Call only from the static wrapper emitted by the source-side projection. */
export function bindFrameProtocol(input){
 const table=jsonData(input,16384);need(Array.isArray(table)&&table.length>=1&&table.length<=2);
 const rows=new Map(),variants=new Set();
 for(const entry of table){
  const row=own(entry,['admissionSha256','record','fixtureIdentity','preArtifactIdentity']),r=own(row.record,RECORD);need(hex(row.admissionSha256,64)&&r.schemaVersion===1&&Object.hasOwn(ORIGINS,r.variantId)&&r.origin===ORIGINS[r.variantId]);
  sourcePin(r.schemaSource);sourcePin(r.nativeDonorSource);need(equal(r.schemaSource,registry.sources[r.variantId].source)&&r.schemaReceiptSha256===registry.sources[r.variantId].receiptSha256);
  for(const k of RECORD.filter(k=>k.endsWith('Sha256')))need(hex(r[k],64));
  for(const m of [r.bridgeModule,r.guardModule]){own(m,['path','sha256','version']);modulePin({...m,ownerContract:'tasks-single-owner-v1'});}
  need(r.bridgeModule.version===PROTOCOL&&r.fixtureDocumentSha256===FIXTURE.documentSha256&&r.asOf===FIXTURE.asOf&&r.timeZone===FIXTURE.timeZone&&r.routeAdapterSha256==='a439b742b7701badd4b0eb53c418b5756030c59c43f05966a300f4f40a872840'&&r.bootstrapDocumentSha256==='2e9175cd7b4f4556742cf785799255872155433e37c47f90c784280549105dee'&&r.identifierMapSha256==='047a65c3932251c237d89e91047a9da81453be081fdd6946607f096d93e25a6c');
  const pre=checkedPreIdentity(row.preArtifactIdentity),pr=pre.record,pc=pre.config;
  need(pr.variantId===r.variantId&&equal(pr.schemaSource,r.schemaSource)&&pr.schemaReceiptSha256===r.schemaReceiptSha256&&equal(pr.nativeDonorSource,r.nativeDonorSource)&&pc.childOrigin===r.origin&&['bridgeModule','guardModule'].every(k=>pc[k].path===r[k].path&&pc[k].version===r[k].version)&&['routeAdapterSha256','fixtureDocumentSha256','bootstrapDocumentSha256','identifierMapSha256','asOf','timeZone'].every(k=>pc[k]===r[k]));
  fixture(row.fixtureIdentity);need(!rows.has(row.admissionSha256)&&!variants.has(r.variantId));rows.set(row.admissionSha256,freeze(row));variants.add(r.variantId);
 }
 const select=digest=>{need(typeof digest==='string'&&rows.has(digest),'COMPILED_ADMISSION_REQUIRED');return rows.get(digest);};
 function createFrameSession(options){
  const o=own(options,['side','admissionSha256','viewport','identity','send','deadline']),row=select(o.admissionSha256),requested=viewport(o.viewport),ids=own(o.identity,['sessionId','nextEpoch','getWindow']);
  need(['left','right'].includes(o.side)&&hex(ids.sessionId,32)&&[ids.nextEpoch,ids.getWindow,o.send,o.deadline].every(x=>typeof x==='function'));
  let phase='unloaded',epoch=null,doc=null,expectedDocument=null,window=null,revision=0,route=null,guard='unavailable',measured=null,pending=null,last=null,counter=0,cancel=null,reason=null,send=o.send,deadline=o.deadline,identity=ids;
  const epochs=new Set(),documents=new Set();
  const stopDeadline=()=>{const f=cancel;cancel=null;if(f){try{f();}catch{phase='invalid';reason='DEADLINE_CLEANUP_FAILED';}}};
  const invalidate=()=>{stopDeadline();phase='invalid';pending=null;reason='PROTOCOL_INVALID';return freeze({status:'invalid'});};
  const base=(kind,requestId,payload)=>({protocol:PROTOCOL,sessionId:ids.sessionId,side:o.side,frameEpoch:epoch,documentId:doc,admissionSha256:row.admissionSha256,kind,requestId,payload});
  const snapshot=()=>freeze({phase,reason,routeRevision:revision,route,guard,viewport:measured,viewportMatches:measured!==null&&equal(measured,requested),pending:pending?.command??null,lastTerminal:last?.response??null,removalAllowed:phase==='retired',runtimeReady:false,productReady:false});
  function onLoad(expectedDocumentId){
   if(phase==='disposed')return ignored();stopDeadline();pending=null;last=null;doc=null;route=null;guard='unavailable';measured=null;revision=0;
   try{need(hex(expectedDocumentId,32));expectedDocument=expectedDocumentId;need(epochs.size<128);epoch=identity.nextEpoch();need(hex(epoch,32)&&!epochs.has(epoch));epochs.add(epoch);window=identity.getWindow();need(window!==null&&['object','function'].includes(typeof window));phase='binding';reason=null;send(freeze(base('bind',0,{expectedDocumentId:expectedDocument,preArtifactSha256:row.preArtifactIdentity.sha256,fixtureIdentity:row.fixtureIdentity,viewport:requested})),row.record.origin,window);return freeze({status:'sent'});}catch{return invalidate();}
  }
  function accept(event){
   if(['disposed','invalid','unloaded'].includes(phase))return ignored();
   try{
    // Browser adapter must supply this normalized event, not a raw MessageEvent with inherited getters.
    const ds=Object.getOwnPropertyDescriptors(event);need(ds.origin&&Object.hasOwn(ds.origin,'value')&&ds.source&&Object.hasOwn(ds.source,'value'));
    if(ds.origin.value!==row.record.origin)return ignored();
    if(identity.getWindow()!==window)return invalidate();if(ds.source.value!==window)return ignored();
    const v=own(event,['origin','source','ports','data']);need(Array.isArray(v.ports)&&v.ports.length===0);const e=envelope(v.data);
    if(e.sessionId!==ids.sessionId||e.side!==o.side||e.frameEpoch!==epoch)return ignored();if(e.admissionSha256!==row.admissionSha256)return invalidate();
    if(e.kind==='bound'){
     if(phase!=='binding')return ignored();need(e.requestId===0&&hex(e.documentId,32)&&e.documentId===expectedDocument&&!documents.has(e.documentId));
     const p=own(e.payload,['preArtifactSha256','fixtureIdentity','viewport','routeRevision','route','guard']);need(p.preArtifactSha256===row.preArtifactIdentity.sha256);fixture(p.fixtureIdentity);measured=viewport(p.viewport);const obs=observation(row,{routeRevision:p.routeRevision,route:p.route,guard:p.guard});
     doc=e.documentId;documents.add(doc);revision=obs.routeRevision;route=freeze(obs.route);guard=obs.guard;phase='bound';return freeze({status:'bound'});
    }
    if(e.documentId!==doc)return ignored();
    if(phase==='retired'||phase==='blocked'){
     if(last&&e.requestId===last.response.requestId&&equal(e,last.response))return freeze({status:'duplicate'});
     return invalidate();
    }
    if(e.kind==='route-observed'){
     need(e.requestId===0);const obs=observation(row,e.payload);if(obs.routeRevision<revision)return ignored();need(obs.routeRevision!==revision||routeEqual(row,obs.route,route));
     if(pending&&(obs.routeRevision>revision||obs.guard!=='clean')){pending.superseded=true;phase='unconfirmed';stopDeadline();}
     revision=obs.routeRevision;route=freeze(obs.route);guard=obs.guard;return freeze({status:'observed'});
    }
    need(['navigation-result','retirement-result'].includes(e.kind));
    if(last&&e.requestId===last.response.requestId){return equal(e,last.response)?freeze({status:'duplicate'}):invalidate();}
    if(!pending||e.requestId!==pending.command.requestId){if(e.requestId<=counter)return ignored();return invalidate();}
    const p=terminalPayload(row,e,pending.command);
    if(e.kind==='retirement-result'&&pending.superseded&&p.outcome==='retired')return ignored();
    if(e.kind==='navigation-result'){
     if(p.routeRevision<revision||pending.superseded&&['committed','unchanged'].includes(p.outcome))return ignored();
     need(p.routeRevision!==revision||routeEqual(row,p.route,route));revision=p.routeRevision;route=freeze(p.route);
    }
    const command=pending.command;stopDeadline();if(phase==='invalid')return invalidate();pending=null;last=freeze({command,response:e});
    if(e.kind==='retirement-result'){phase=p.outcome==='retired'?'retired':p.reason==='CLEANUP_INCOMPLETE'?'blocked':'bound';}
    else phase='bound';
    if(p.reason&&['DIRTY','SAVING','UNKNOWN','GUARD_UNAVAILABLE'].includes(p.reason))guard={DIRTY:'dirty',SAVING:'saving',UNKNOWN:'unknown',GUARD_UNAVAILABLE:'unavailable'}[p.reason];
    return freeze({status:'terminal'});
   }catch{return invalidate();}
  }
  function issue(kind,payload){
   if(pending)return refused('BUSY');if(phase!=='bound')return refused('NOT_BOUND');if(guard!=='clean')return refused(guardReason(guard));if(counter>=128)return refused('REQUEST_LIMIT');
   try{if(identity.getWindow()!==window)return invalidate();}catch{return invalidate();}
   try{const e=base(kind,counter+1,payload);commandPayload(row,envelope(e));counter++;pending={command:freeze(e),superseded:false};phase='pending';
    const captured=pending;const c=deadline(10000,()=>{if(pending===captured&&phase==='pending'){phase='unconfirmed';cancel=null;}});need(typeof c==='function');cancel=c;
    if(pending!==captured||phase!=='pending'){stopDeadline();return refused('DEADLINE_FAILED');}
    send(pending.command,row.record.origin,window);return freeze({status:'sent',requestId:counter});
   }catch{if(pending){stopDeadline();phase='unconfirmed';return refused('UNCONFIRMED_EFFECT');}return refused('INVALID_REQUEST');}
  }
  function navigate(request,historyMode){try{const r=jsonData(request);routePlan(row,r);need(['push','replace'].includes(historyMode));return issue('navigate',{expectedRouteRevision:revision,request:r,historyMode});}catch{return refused('ROUTE_UNAVAILABLE');}}
  const retire=()=>issue('retire',{expectedRouteRevision:revision});
  function dispose(){if(phase==='disposed')return freeze({status:'disposed'});stopDeadline();pending=null;last=null;window=null;identity=null;send=null;deadline=null;phase='disposed';return freeze({status:'disposed'});}
  return Object.freeze({onLoad,accept,navigate,retire,dispose,snapshot});
 }
 function createCommandGate(options){const o=own(options,['admissionSha256','context','routeRevision']);return makeCommandGate(select(o.admissionSha256),o);}
 return Object.freeze({createFrameSession,createCommandGate});
}

 /** Child-side sequencing ONLY. No guard/router/unmount/report implementation.
  * The future bridge must authenticate origin/window before accept(), and revoke ALL
  * action/publication closures before complete(). Calling complete is not that proof.
  */
 function makeCommandGate(row,o){
  const ctx=context(o.context);need(ctx.admissionSha256===row.admissionSha256&&integer(o.routeRevision));
  let phase='open',revision=o.routeRevision,pending=null,last=null,highest=0;
  const invalid=()=>{phase='invalid';pending=null;return freeze({status:'invalid'});};
  const sameContext=e=>Object.keys(ctx).every(k=>e[k]===ctx[k]);
  const snapshot=()=>freeze({phase,routeRevision:revision,pending:pending?.command??null,lastTerminal:last?.response??null});
  function accept(value){
   if(phase!=='open')return ignored();
   try{const e=envelope(value);if(!sameContext(e))return ignored();commandPayload(row,e);
    if(last&&e.requestId===last.command.requestId)return equal(e,last.command)?freeze({status:'replay',response:last.response}):invalid();
    if(pending){if(e.requestId===pending.command.requestId&&!equal(e,pending.command))return invalid();return refused('BUSY');}
    if(e.requestId<=highest)return ignored();if(e.payload.expectedRouteRevision!==revision)return refused('STALE_CONTEXT');highest=e.requestId;pending={command:freeze(e),superseded:false};return freeze({status:'execute',command:pending.command});
   }catch{return invalid();}
  }
  function complete(value,result){
   if(phase!=='open'||!pending)return ignored();
   try{const c=envelope(value),e=envelope(result);need(equal(c,pending.command)&&sameContext(e)&&e.requestId===c.requestId);const p=terminalPayload(row,e,c);
    if(e.kind==='retirement-result'&&pending.superseded&&p.outcome==='retired')return ignored();
    if(e.kind==='navigation-result'){if(p.routeRevision<revision||pending.superseded&&['committed','unchanged'].includes(p.outcome))return ignored();revision=p.routeRevision;}
    last=freeze({command:pending.command,response:e});pending=null;if(e.kind==='retirement-result')phase=p.outcome==='retired'?'retired':p.reason==='CLEANUP_INCOMPLETE'?'blocked':'open';return freeze({status:'terminal',response:e});
   }catch{return invalid();}
  }
  function observe(value){if(phase!=='open')return ignored();try{const obs=observation(row,jsonData(value));if(obs.routeRevision<revision)return ignored();if(pending&&(obs.routeRevision>revision||obs.guard!=='clean'))pending.superseded=true;revision=obs.routeRevision;return freeze({status:'observed'});}catch{return invalid();}}
  const dispose=()=>{phase='disposed';pending=null;last=null;return freeze({status:'disposed'});};
  return Object.freeze({accept,complete,observe,dispose,snapshot});
 }

/** Child uses only its immutable pre-artifact input identity. Full admission digest
 * comes from authenticated parent bind and is correlation, NEVER child byte proof.
 * No ambient listener/send/timer/native callback exists in this pure wrapper.
 */
export function bindChildProtocol(compiledIdentity){
 const pre=checkedPreIdentity(compiledIdentity);
 function createChildSession(options){
  const o=own(options,['parentWindow','documentId','send']),documentId=o.documentId;
  need(hex(documentId,32)&&o.parentWindow!==null&&['object','function'].includes(typeof o.parentWindow)&&typeof o.send==='function');
  let parentWindow=o.parentWindow,send=o.send,phase='unbound',ctx=null,gate=null,challenge=null;
  const row={record:{variantId:pre.record.variantId},admissionSha256:null};
  const invalidate=()=>{gate?.dispose();gate=null;phase='invalid';return freeze({status:'invalid'});};
  const transmit=e=>send(freeze(e),pre.config.parentOrigin,parentWindow);
  const message=(kind,requestId,payload)=>({protocol:PROTOCOL,...ctx,kind,requestId,payload});
  const snapshot=()=>freeze({phase,context:ctx,preArtifactSha256:pre.sha256,pending:gate?.snapshot().pending??null,artifactBytesVerified:false,sourceBytesVerified:false,runtimeReady:false});
  function accept(event){
   if(['disposed','invalid','retired','blocked'].includes(phase))return ignored();
   try{
    const ds=Object.getOwnPropertyDescriptors(event);need(ds.origin&&Object.hasOwn(ds.origin,'value')&&ds.source&&Object.hasOwn(ds.source,'value'));
    if(ds.origin.value!==pre.config.parentOrigin||ds.source.value!==parentWindow)return ignored();
    const v=own(event,['origin','source','ports','data']);need(Array.isArray(v.ports)&&v.ports.length===0);const e=envelope(v.data);
    if(e.kind==='bind'){
     if(phase!=='unbound')return ignored();need(e.requestId===0&&e.documentId===null);
     const p=own(e.payload,['expectedDocumentId','preArtifactSha256','fixtureIdentity','viewport']);need(hex(p.expectedDocumentId,32)&&p.preArtifactSha256===pre.sha256);fixture(p.fixtureIdentity);viewport(p.viewport);if(p.expectedDocumentId!==documentId)return ignored();
     ctx=freeze({sessionId:e.sessionId,side:e.side,frameEpoch:e.frameEpoch,documentId,admissionSha256:e.admissionSha256});row.admissionSha256=e.admissionSha256;challenge=freeze(e);phase='binding';return freeze({status:'binding'});
    }
    if(phase!=='bound'||!Object.keys(ctx).every(k=>e[k]===ctx[k]))return ignored();
    const result=gate.accept(e);if(result.status==='invalid')return invalidate();if(result.status==='replay')transmit(result.response);return result;
   }catch{return invalidate();}
  }
  function confirmBound(value){
   if(phase!=='binding')return ignored();
   try{const p=own(jsonData(value),['fixtureIdentity','viewport','routeRevision','route','guard']);fixture(p.fixtureIdentity);viewport(p.viewport);observation(row,{routeRevision:p.routeRevision,route:p.route,guard:p.guard});
    gate=makeCommandGate(row,{admissionSha256:ctx.admissionSha256,context:ctx,routeRevision:p.routeRevision});phase='bound';
    transmit(message('bound',0,{preArtifactSha256:pre.sha256,...p}));challenge=null;return freeze({status:'sent'});
   }catch{return invalidate();}
  }
  function complete(command,payload){
   if(phase!=='bound')return ignored();
   try{const c=envelope(command),result=gate.complete(c,{...c,kind:c.kind==='navigate'?'navigation-result':'retirement-result',payload:jsonData(payload)});
    if(result.status==='invalid')return invalidate();if(result.status==='terminal'){transmit(result.response);const next=gate.snapshot().phase;if(['retired','blocked'].includes(next))phase=next;}return result;
   }catch{return invalidate();}
  }
  function observe(value){
   if(phase!=='bound')return ignored();
   try{const p=observation(row,jsonData(value)),result=gate.observe(p);if(result.status==='invalid')return invalidate();if(result.status==='observed')transmit(message('route-observed',0,p));return result;}catch{return invalidate();}
  }
  function dispose(){gate?.dispose();gate=null;ctx=null;challenge=null;parentWindow=null;send=null;phase='disposed';return freeze({status:'disposed'});}
  return Object.freeze({accept,confirmBound,complete,observe,dispose,snapshot});
 }
 return Object.freeze({createChildSession});
}

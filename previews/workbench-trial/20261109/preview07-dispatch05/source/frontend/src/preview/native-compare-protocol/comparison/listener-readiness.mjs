/** Pure LOCAL readiness ordering only. No DOM, listener, timer, transport or product owner.
 * The later adapter supplies normalized own-field events from structured-clone postMessage.
 * Direct in-realm Proxy metadata traps are outside that transport guarantee. */
const ORIGINS=Object.freeze({original:'http://127.0.0.1:8871',harbour:'http://127.0.0.1:8872'});
const hex=(v,n)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v);
const need=ok=>{if(!ok)throw Error('INVALID_READINESS_INPUT');};
const frozen=x=>Object.freeze(x);
const ignored=()=>frozen({status:'ignored'});
const refused=reason=>frozen({status:'refused',reason});
function own(x,keys){need(x&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x)));const ds=Object.getOwnPropertyDescriptors(x),actual=Reflect.ownKeys(ds);need(actual.length===keys.length&&actual.every(k=>typeof k==='string'&&keys.includes(k)));const result={};for(const k of keys){need(ds[k]&&Object.hasOwn(ds[k],'value'));result[k]=ds[k].value;}return result;}
function variant(value){need(typeof value==='string'&&Object.hasOwn(ORIGINS,value));return value;}
function windowValue(value){need(value!==null&&['object','function'].includes(typeof value));return value;}
function notice(value){const n=own(value,['protocol','variantId','preArtifactSha256','documentId']);need(n.protocol==='local-native-listener-v1');variant(n.variantId);need(hex(n.preArtifactSha256,64)&&hex(n.documentId,32)&&new TextEncoder().encode(JSON.stringify(n)).length<=512);return frozen(n);}

/** Construct ONCE per actual document. Effect replay reuses this gate and documentId. */
export function createDocumentListenerGate(options){
 const o=own(options,['variantId','preArtifactSha256','documentId','send']);variant(o.variantId);need(hex(o.preArtifactSha256,64)&&hex(o.documentId,32)&&typeof o.send==='function');
 const message=notice({protocol:'local-native-listener-v1',variantId:o.variantId,preArtifactSha256:o.preArtifactSha256,documentId:o.documentId});
 let installed=null,complete=false,consumed=false,failed=false,closed=false,send=o.send;
 function emit(token){if(closed||installed!==token||!complete||consumed)return ignored();consumed=true;try{send(message);return frozen({status:'sent'});}catch{failed=true;return frozen({status:'failed'});}}
 function install(alreadyComplete){need(typeof alreadyComplete==='boolean'&&!closed&&installed===null);const token=frozen({});installed=token;complete=complete||alreadyComplete;emit(token);
  return frozen({loaded(){if(closed||installed!==token)return ignored();complete=true;return emit(token);},dispose(){if(installed===token)installed=null;return frozen({status:'disposed'});}});
 }
 return frozen({install,dispose(){closed=true;installed=null;send=null;return frozen({status:'disposed'});},snapshot(){return frozen({phase:closed?'disposed':failed?'failed':consumed?'notice-sent':installed?'installed':'waiting',documentId:o.documentId,noticeConsumed:consumed,installed:installed!==null,runtimeReady:false});}});
}

/** One-side gate only; parent pair/composition/UI are deliberately absent. */
export function createListenerReadiness(options){
 const o=own(options,['variantId','preArtifactSha256','side','admissionSha256','viewport','identity','createFrameSession','send','deadline']);variant(o.variantId);need(hex(o.preArtifactSha256,64)&&hex(o.admissionSha256,64)&&['left','right'].includes(o.side)&&[o.createFrameSession,o.send,o.deadline].every(f=>typeof f==='function'));
 const ids=own(o.identity,['sessionId','nextEpoch','getWindow']),vp=own(o.viewport,['width','height']);need(hex(ids.sessionId,32)&&typeof ids.nextEpoch==='function'&&typeof ids.getWindow==='function'&&[320,390,1024,1440].includes(vp.width)&&Number.isSafeInteger(vp.height)&&vp.height>=240&&vp.height<=1600);
 let phase='waiting-load',reason=null,active=null,candidate=null,previous=null,generations=0,commands=0,loaded=false,closed=false,hardFault=false,blockedUntil=0;
 const documents=new Set(),epochs=new Set();
 function unavailable(why,hard=false){reason=why;phase='unavailable';hardFault=hardFault||hard;return frozen({status:'unavailable',reason:why});}
 function revoke(why){
  const old=active;active=null;if(!old)return;
  old.live=false; // External authority is gone BEFORE snapshot/dispose/cancel can reenter.
  try{const s=old.session?.snapshot();if(s)previous=frozen({status:s.pending?'unconfirmed-document-ended':'document-ended',reason:why,protocol:JSON.parse(JSON.stringify(s))});}
  catch{hardFault=true;reason='OLD_SNAPSHOT_FAILED';}
  try{old.session?.dispose();}catch{hardFault=true;reason='OLD_DISPOSE_FAILED';}
  if(old.cleanupFault){hardFault=true;reason='DEADLINE_CLEANUP_FAILED';}
 }
 function block(why){const carry=phase==='waiting-load'?1:0;blockedUntil=Math.max(blockedUntil,generations+carry);candidate=null;loaded=false;revoke(why);return unavailable(why);}
 function check(g){if(closed||active!==g||!g.live||hardFault)throw Error('GENERATION_REVOKED');const current=windowValue(ids.getWindow());if(current!==g.window)throw Error('WINDOW_CHANGED');return current;}
 function after(g){if(active!==g||!g.live||closed)return;const s=g.session.snapshot();if(['invalid','disposed'].includes(s.phase)){revoke('PROTOCOL_INVALID');unavailable('PROTOCOL_INVALID');}else phase=s.phase;}
 function activate(){
  if(closed||hardFault||!loaded||!candidate||active||phase==='unavailable')return ignored();
  const selected=candidate;candidate=null;
  if(documents.has(selected.notice.documentId)||documents.size>=128)return block('DOCUMENT_LIMIT_OR_REUSE');
  let win;try{win=windowValue(ids.getWindow());if(win!==selected.window)return block('WINDOW_CHANGED');}catch{return block('WINDOW_UNAVAILABLE');}
  documents.add(selected.notice.documentId);loaded=false;
  const g={live:true,window:win,documentId:selected.notice.documentId,session:null,cleanupFault:false};active=g;phase='binding';reason=null;
  const identity={sessionId:ids.sessionId,getWindow:()=>check(g),nextEpoch:()=>{check(g);const epoch=ids.nextEpoch();if(!hex(epoch,32)||epochs.has(epoch)||epochs.size>=128)throw Error('EPOCH_LIMIT_OR_REUSE');epochs.add(epoch);return epoch;}};
  const send=(message,origin,destination)=>{check(g);if(destination!==g.window||origin!==ORIGINS[o.variantId])throw Error('SEND_IDENTITY');if(['navigate','retire'].includes(message.kind)){if(commands>=128)throw Error('COMMAND_LIMIT');commands++;}return o.send(message,origin,destination);};
  const deadline=(ms,callback)=>{check(g);need(ms===10000&&typeof callback==='function');let cancelled=false;const cancel=o.deadline(ms,()=>{if(active===g&&g.live&&!closed){callback();after(g);}});need(typeof cancel==='function');return()=>{if(cancelled)return;cancelled=true;try{return cancel();}catch(error){g.cleanupFault=true;throw error;}};};
  try{g.session=o.createFrameSession({side:o.side,admissionSha256:o.admissionSha256,viewport:vp,identity,send,deadline});need(g.session&&typeof g.session.onLoad==='function'&&typeof g.session.dispose==='function');if(active!==g||!g.live)return ignored();const result=g.session.onLoad(g.documentId);after(g);return result;}
  catch{if(active===g)revoke('SESSION_FAILED');return unavailable('SESSION_FAILED');}
 }
 function rawLoad(){
  if(closed)return ignored();phase='waiting-load';revoke('RAW_LOAD');
  if(hardFault)return unavailable(reason??'CLEANUP_FAILED',true);
  if(generations>=128)return unavailable('GENERATION_LIMIT',true);
  generations++;
  if(blockedUntil>=generations){candidate=null;loaded=false;return unavailable(reason??'AMBIGUOUS_NOTICE');}
  loaded=true;phase='waiting-notice';reason=null;return candidate?activate():frozen({status:'waiting-notice'});
 }
 function acceptNotice(event){
  if(closed||hardFault)return ignored();
  try{
   const ds=Object.getOwnPropertyDescriptors(event);need(ds.origin&&Object.hasOwn(ds.origin,'value')&&ds.source&&Object.hasOwn(ds.source,'value'));
   if(ds.origin.value!==ORIGINS[o.variantId])return ignored();const win=windowValue(ids.getWindow());if(ds.source.value!==win)return ignored();
   const e=own(event,['origin','source','ports','data']);need(Array.isArray(e.ports)&&e.ports.length===0);const n=notice(e.data);need(n.variantId===o.variantId&&n.preArtifactSha256===o.preArtifactSha256);
   if(active&&active.documentId===n.documentId)return frozen({status:'duplicate'});
   if(phase==='unavailable')return frozen({status:'unavailable',reason});
   if(documents.has(n.documentId))return block('STALE_NOTICE');
   if(candidate){if(candidate.notice.documentId===n.documentId&&candidate.window===win)return frozen({status:'duplicate'});return block('AMBIGUOUS_NOTICE');}
   if(active){phase='waiting-load';revoke('NEW_DOCUMENT_NOTICE');loaded=false;}
   candidate={notice:n,window:win};return loaded?activate():frozen({status:'latched'});
  }catch{return block('INVALID_NOTICE');}
 }
 function acceptProtocol(event){const g=active;if(closed||!g||!g.live)return ignored();const result=g.session.accept(event);after(g);return result;}
 function command(name,args){if(closed)return refused('DISPOSED');if(commands>=128)return refused('REQUEST_LIMIT');const g=active;if(!g||!g.live||phase==='unavailable'||hardFault)return refused('NOT_BOUND');const result=g.session[name](...args);after(g);return result;}
 return frozen({rawLoad,acceptNotice,acceptProtocol,navigate:(request,historyMode)=>command('navigate',[request,historyMode]),retire:()=>command('retire',[]),dispose(){if(closed)return frozen({status:'disposed'});closed=true;phase='disposed';candidate=null;loaded=false;revoke('PARENT_DISPOSE');phase='disposed';return frozen({status:'disposed'});},snapshot(){return frozen({phase,reason,generations,consumedDocuments:documents.size,commands,protocol:active?.session?.snapshot()??null,previous,runtimeReady:false});}});
}

/** One immutable LOCAL document's ordinary observer installation. No owner/native action
 * implementation, retry, timer, storage/global registry or caller readiness flag.
 * Ordinary observer lifetime is distinct from the actual3C cleanup-only terminal. */
import {createDocumentListenerGate} from './native-compare-protocol/comparison/listener-readiness.mjs';
let documentRecord=null;
const result=status=>Object.freeze({status});
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function prepareNativeCompareDocument({realm,document,identity,bridge}){
 const config=identity.config;
 try{if(!realm||realm.document!==document||realm.location.origin!==config.childOrigin||realm.parent===realm)return null;}catch{return null;}
 const parent=realm.parent;
 if(!documentRecord){
  // Record the attempt BEFORE entropy access; failure is sticky, never a fallback/retry.
  const record={realm,document,parent,controller:bridge,closed:false,failed:false,active:null,transition:1,bindConsumed:false,id:null,gate:null};documentRecord=record;
  try{const uuid=realm.crypto.randomUUID();if(typeof uuid!=='string'||!uuidPattern.test(uuid))throw Error('DOCUMENT_ID');record.id=uuid.replaceAll('-','');
   record.gate=createDocumentListenerGate({variantId:identity.record.variantId,preArtifactSha256:identity.sha256,documentId:record.id,send(message){
    const token=record.active;if(!token||!token.live||!token.started||!token.messageInstalled||record.closed||realm.document!==document||realm.parent!==parent)throw Error('NOTICE_INSTALLATION_REVOKED');
    parent.postMessage(message,config.parentOrigin);
   }});
  }catch{record.failed=true;record.closed=true;}finally{record.transition=0;}
 }
 const record=documentRecord;
 if(record.failed||record.closed||record.transition||record.active||record.realm!==realm||record.document!==document||record.parent!==parent||record.controller!==bridge)return null;
 const token={live:true,started:false,disposed:false,accepting:0,messageInstalled:false,resizeInstalled:false,loadInstalled:false,gateHandle:null};record.active=token;
 const current=()=>token.live&&record.active===token&&!record.closed&&realm.document===document&&realm.parent===parent;
 function invalidate(){
  token.live=false;if(record.active===token)record.active=null;
  if(record.bindConsumed||token.accepting){record.closed=true;record.gate.dispose();}
  else token.gateHandle?.dispose();
 }
 function removeLoad(){if(!token.loadInstalled)return;token.loadInstalled=false;realm.removeEventListener('load',loaded);}
 function removeObservers(){
  let failed=false,error;
  for(const[kind,key,fn]of[['message','messageInstalled',message],['resize','resizeInstalled',resize],['load','loadInstalled',loaded]]){
   if(token[key]){token[key]=false;try{realm.removeEventListener(kind,fn);}catch(thrown){if(!failed)error=thrown;failed=true;}}
  }
  if(failed){record.failed=true;record.closed=true;record.gate.dispose();throw error;}
 }
 function stopObservers(){record.transition++;try{invalidate();removeObservers();}finally{record.transition--;}return result('stopped');}
 function dispose(){if(token.disposed)return result('disposed');token.disposed=true;record.transition++;
  try{invalidate();bridge.detach();}finally{try{removeObservers();}finally{record.transition--;}}
  return result('disposed');
 }
 function message(event){
  if(!current()||event.origin!==config.parentOrigin||event.source!==parent)return;
  token.accepting++;
  try{const accepted=bridge.accept({origin:event.origin,source:event.source,ports:[...event.ports],data:event.data});if(accepted.status==='binding')record.bindConsumed=true;}
  finally{token.accepting--;}
 }
 function resize(){if(current())bridge.changed();}
 function loaded(){if(!current()||document.readyState!=='complete')return;removeLoad();if(current())token.gateHandle?.loaded();}
 function start(){
  if(token.started||!current()||record.transition)return result('unavailable');token.started=true;record.transition++;
  try{
   bridge.attach({parentWindow:parent,documentId:record.id,
    // This is the existing native sender, NOT an observer-token or message-kind exemption.
    // Actual3C owns revocation and its private accepted own-unmount continuation.
    send(data,origin,destination){if(destination===parent){if(data.kind==='bound')record.bindConsumed=true;parent.postMessage(data,origin);}},
    viewport:()=>({width:realm.innerWidth,height:realm.innerHeight})});
   if(!current())return result('unavailable');
   token.messageInstalled=true;realm.addEventListener('message',message);
   if(!current())return result('unavailable');
   token.resizeInstalled=true;realm.addEventListener('resize',resize);
   if(!current())return result('unavailable');
   const handle=record.gate.install(document.readyState==='complete');
   // Notice send may synchronously revoke this installation before install returns.
   if(!current()){handle.dispose();return result('unavailable');}
   token.gateHandle=handle;
   if(record.gate.snapshot().phase==='failed')throw Error('NOTICE_SEND_FAILED');
   if(document.readyState!=='complete'){
    token.loadInstalled=true;realm.addEventListener('load',loaded);
    // Same latch: close a load/registration ordering gap without timers or reannouncement.
    if(current()&&document.readyState==='complete')loaded();
   }
   return result(current()?'installed':'unavailable');
  }catch{record.failed=true;record.closed=true;record.gate.dispose();dispose();return result('unavailable');}
  finally{record.transition--;}
 }
 return Object.freeze({start,stopObservers,dispose});
}

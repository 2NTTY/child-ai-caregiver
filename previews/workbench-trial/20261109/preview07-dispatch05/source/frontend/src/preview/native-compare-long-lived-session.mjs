/** Generated input identity + own native coordination. No Node, added timers or second owner. */
import {bindChildProtocol} from './native-compare-protocol/comparison/frame-protocol.mjs';
import registry from './native-compare-protocol/vendor/frozen-registry.mjs';
import {planSemanticNavigation} from './native-compare-protocol/vendor/semantic-navigation.mjs';
import {nativeTaskIdentifier,canonicalTaskIdentifier} from './workbench-normal-read/src/normal-tasks-read-binding.mjs';
import {collectLongLivedRetirementV1,refreshLongLivedRetirementV1,retainLongLivedRetirementV1} from './native-compare-long-lived-retirement-v1.mjs';
// Input identity only. Parent-authorized full artifact digest is correlation, not child byte attestation.
const immutable = value => { if (value && typeof value === "object") { Object.values(value).forEach(immutable); Object.freeze(value); } return value; };
// Historical-only derivation identity; not an attestation of this source assembly.
// Current source bytes are sealed separately by the public execution input manifest.
export const NATIVE_COMPARE_IDENTITY = immutable({"sha256":"5086b1c83d9cac88c6f389c5d83e0f87b9c467bebc887d8cd779315f3fe27ebe","record":{"identityVersion":"local-native-derivation-v1","variantId":"harbour","schemaSource":{"kind":"git-commit","appCommit":"4050c0a16d0a9735923434abc9749ecd416d7926","sourceTree":"fcc2393ea5f6bf6963fbf9b281f24bd02de76ea2"},"schemaReceiptSha256":"907ec9573cfb6213a30a019363fcb56b82441be5ee01706700d169e44997fc9a","nativeDonorSource":{"kind":"composite","appCommit":null,"sourceTree":"5054032cdfbb0920751a93764f8b9794a4f2dcac","recipeSha256":"deaf6dabdf92fc35dab8f9138c5679bcc5aa980fea870a407a8a3c021e6db8ac"},"recipeSha256":"3830b4cb4c4ccde30a5c980a0c11770452c890124751b1accb5561370053bdbd","inputManifestSha256":"44c7db2699d7c0462f12363c9dc3cc1378b588e574b5753d190c69fe1fab40a7","templateManifestSha256":"d059f9b249b98568b3aced5c1152f90cfe0ae2d018a040a658e4b3dea8573b94","configSha256":"a87ecb31fe7c7db420ea8afba2c63659fb3d7ae8c1c7e002fb60cbffd615332a"},"config":{"protocol":"local-native-compare-v1","parentOrigin":"http://127.0.0.1:8870","childOrigin":"http://127.0.0.1:8872","bridgeModule":{"path":"frontend/src/preview/native-compare-long-lived-session.mjs","version":"local-native-compare-v1"},"guardModule":{"path":"frontend/src/preview/PreviewNavigationGuard.tsx","version":"native-strict-guard-fix01-v1"},"routeAdapterSha256":"a439b742b7701badd4b0eb53c418b5756030c59c43f05966a300f4f40a872840","fixtureDocumentSha256":"d108aca1f8248e76e28ce4ab5c3497005cff5f1e6f15f2d23081b8d32bd2d5e4","bootstrapDocumentSha256":"2e9175cd7b4f4556742cf785799255872155433e37c47f90c784280549105dee","identifierMapSha256":"047a65c3932251c237d89e91047a9da81453be081fdd6946607f096d93e25a6c","asOf":"2026-10-04T16:00:00+08:00","timeZone":"Asia/Hong_Kong"}});
const VARIANT=NATIVE_COMPARE_IDENTITY.record.variantId;
const FIXTURE=Object.freeze({documentSha256:'d108aca1f8248e76e28ce4ab5c3497005cff5f1e6f15f2d23081b8d32bd2d5e4',childId:'preview-child-01',asOf:'2026-10-04T16:00:00+08:00',timeZone:'Asia/Hong_Kong'});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const contextEqual=(a,b)=>!!a&&!!b&&a.owner===b.owner&&a.scopeKey===b.scopeKey&&a.identityKey===b.identityKey&&a.childId===b.childId&&a.ready===true&&b.ready===true;
const refusal=state=>({dirty:'DIRTY',saving:'SAVING',unknown:'UNKNOWN',unavailable:'GUARD_UNAVAILABLE'})[state]??'STALE_CONTEXT';
function routePlan(request){
  const plan=planSemanticNavigation(registry,request);
  if(plan.status!=='source-plan'||plan.semanticPage!=='tasks')return null;
  const translation=plan.targets[VARIANT].translation;if(translation.status!=='mapped')return null;
  const params={...translation.params};if(Object.hasOwn(params,'taskId'))params.taskId=nativeTaskIdentifier(params.taskId);
  return {pathname:translation.pathname,params};
}
function observedRoute(raw){
  try{
    if(!raw||raw.pathname!=='/tasks'||!raw.params||Array.isArray(raw.params))return null;
    const fields=Object.keys(raw.params).sort(),allowed=VARIANT==='original'?['taskId']:['tab','filter','page','day','month','taskId'];
    if(fields.some(k=>!allowed.includes(k)))return null;
    const state={};
    for(const key of fields){const d=Object.getOwnPropertyDescriptor(raw.params,key);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='string')return null;
      if(key==='taskId')state[key]=canonicalTaskIdentifier(d.value);
      else if(key==='page'){if(!/^(0|[1-9][0-9]*)$/.test(d.value))return null;state[key]=Number(d.value);}
      else state[key]=d.value;
    }
    const route={semanticPage:'tasks',pageState:state};if(!routePlan({...route,scenario:'normal',fixtureIdentity:FIXTURE}))return null;return route;
  }catch{return null;}
}
function normalizedTarget(request){const target=routePlan(request);if(!target)return null;const route=observedRoute(target);return route?{...target,route,selectedId:target.params.taskId??null}:null;}

/** Effects are only injected by the own React provider. Protocol eligibility never grants native authority. */
export function createNativeCompareController({getContext,getGuard,openRetirement,stopOrdinaryObservers}){
  let child=null,readViewport=null,viewportAtBind=null,boundContext=null,registered=null,pending=null,revision=0,last={route:null,guard:'unavailable'},lastSent=null,closed=false;
  let retirement=null;
  const {createChildSession}=bindChildProtocol(NATIVE_COMPARE_IDENTITY);
  function native(){
    const context=getContext(),guard=getGuard(),guardState=guard?.read()??{revision:0,state:'unavailable'};
    const raw=registered?.read()??null,route=observedRoute(raw);
    const fixtureOkay=!!raw&&raw.childId===nativeTaskIdentifier(FIXTURE.childId)&&raw.asOf===FIXTURE.asOf&&raw.timeZone===FIXTURE.timeZone;
    const owned=!!context&&context.ready&&!!context.scopeKey&&!!context.identityKey&&context.childId===nativeTaskIdentifier(FIXTURE.childId)
      &&!!raw&&context.owner===raw.owner&&context.scopeKey===raw.scopeKey&&context.identityKey===raw.identityKey;
    const selectedId=route?.pageState.taskId?nativeTaskIdentifier(route.pageState.taskId):null;
    const stable=owned&&fixtureOkay&&raw.readable&&route!==null&&raw.selectedId===selectedId;
    return {context,guard,guardState,raw,route,stable,fixtureOkay};
  }
  function viewportCurrent(){return readViewport!==null&&same(readViewport(),viewportAtBind);}
  function update(n){const route=n.stable?n.route:null,guard=n.guardState.state==='clean'&&!n.stable?'unknown':n.guardState.state;
    if(!same(route,last.route)){if(revision===1000000000){detach();return false;}revision++;}last={route,guard};return true;}
  function observation(){return {routeRevision:revision,route:last.route,guard:last.guard};}
  function publish(){if(!child||child.snapshot().phase!=='bound')return;const value=observation();if(same(value,lastSent))return;lastSent=value;child.observe(value);}
  function terminal(outcome,reason,n){
    const operation=pending;if(!operation)return;
    // Revoke all future dispatch/publication authority before releasing the one terminal response.
    pending=null;operation.lease?.revoke();operation.closed=true;
    if(n&&!update(n))return;
    child?.complete(operation.command,{outcome,reason,routeRevision:revision,route:last.route});lastSent=observation();
  }
  function changed(){
    if(retirement){
      const op=retirement;
      if(op.stage==='accepted'){if(!op.inOwnUnmount)op.valid=false;return;}
      const n=native();
      if(!contextEqual(op.context,n.context)||registered!==op.port||!viewportCurrent()||!same(n.route,op.route)){op.valid=false;op.reason='STALE_CONTEXT';}
      else if(!op.lease?.current()){op.valid=false;op.reason=refusal(n.guardState.state);}
      if(update(n))publish();return;
    }
    if(closed||!child)return;
    const n=native();
    if(child.snapshot().phase==='binding'){
      if(!n.stable)return;
      boundContext=n.context;viewportAtBind=readViewport();revision=0;last={route:n.route,guard:n.guardState.state};lastSent=observation();
      child.confirmBound({fixtureIdentity:FIXTURE,viewport:viewportAtBind,...observation()});return;
    }
    if(child.snapshot().phase!=='bound')return;
    if(pending){
      if(!contextEqual(boundContext,n.context)||registered!==pending.port||!viewportCurrent())terminal('cancelled','STALE_CONTEXT',n);
      else if(!pending.lease?.current())terminal('cancelled',refusal(n.guardState.state),n);
      else if(n.stable&&same(n.route,pending.target.route))terminal('committed',null,n);
      else if(n.route&&!same(n.route,pending.startRoute)&&!same(n.route,pending.target.route))terminal('cancelled','STALE_CONTEXT',n);
      // Own-command route/owner intermediate publications are NOT unsolicited observations.
      if(pending)return;
    }
    if(update(n))publish();
  }
  function refuseCommand(command,reason,n){
    if(update(n))child.complete(command,{outcome:'refused',reason,routeRevision:revision,route:last.route});lastSent=observation();
  }
  function refuseRetirement(command,reason){child?.complete(command,{outcome:'refused',reason,cleanup:null,acceptance:null});}
  function beginRetirement(command){
    const n=native();
    if(n.guardState.state!=='clean'){refuseRetirement(command,refusal(n.guardState.state));return;}
    if(!contextEqual(boundContext,n.context)||!viewportCurrent()){refuseRetirement(command,'STALE_CONTEXT');return;}
    if(!n.stable||typeof openRetirement!=='function'||typeof stopOrdinaryObservers!=='function'){refuseRetirement(command,'CLEANUP_INCOMPLETE');return;}
    const acquired=n.guard.acquire(n.guardState.revision);if(acquired.status!=='granted'){refuseRetirement(command,acquired.reason??'GUARD_UNAVAILABLE');return;}
    let view;try{view=openRetirement(n.context.owner);}catch{acquired.lease.revoke();refuseRetirement(command,'CLEANUP_INCOMPLETE');return;}
    const op={command,child,view,lease:acquired.lease,context:n.context,port:registered,route:n.route,stage:'queued',valid:true,reason:null,ticket:null,inOwnUnmount:false,ownDetached:false};retirement=op;
    const authority=()=>retirement===op&&op.valid&&op.ticket!==null&&op.ownDetached&&op.view?.current()===true&&child===op.child;
    const operation=collectLongLivedRetirementV1(view,enter=>{
      const current=native();
      if(retirement!==op||!op.valid||child!==op.child||!op.lease?.current()||!contextEqual(op.context,current.context)||registered!==op.port||!current.stable||!same(current.route,op.route)||!viewportCurrent())return null;
      const once=op.lease.runOnce(()=>{
        if(!op.valid||!op.lease.current())return null;
        stopOrdinaryObservers();
        // A stop callback is not authority. Recheck exact native lease/context before it is revoked.
        const check=native();if(!op.valid||!op.lease.current()||!contextEqual(op.context,check.context)||!check.stable||!same(check.route,op.route)||!viewportCurrent())return null;
        op.ticket=Object.freeze({});op.stage='accepted';op.lease.revoke();op.lease=null;
        pending=null;registered=null;boundContext=null;op.context=null;op.port=null;op.route=null;
        closed=true;op.inOwnUnmount=true;
        try{return enter();}finally{op.inOwnUnmount=false;}
      });return once.status==='executed'?once.value:null;
    },authority);
    // Only this native-issued continuation survives the expected synchronous own unmount.
    // It cannot navigate, acquire another lease or restart shutdown; all references release once.
    void operation.then(result=>{
      let delivery='not-sent';
      // The async collector result is historical. Refresh the SAME issued control
      // synchronously in this terminal job; do not yield or dispatch another action.
      const terminalResult=op.stage==='accepted'&&retirement===op&&child===op.child?refreshLongLivedRetirementV1(op.view,result,authority):result;
      try{
        if(retirement===op&&child===op.child){
          const terminal=op.stage==='queued'&&op.reason?{outcome:'cancelled',reason:op.reason,cleanup:null,acceptance:null}:terminalResult.terminal;
          if(terminal.outcome!=='retired'||authority())delivery=op.child.complete(command,terminal).status;
        }
      }finally{retainLongLivedRetirementV1(command,terminalResult,delivery);}
    },error=>{
      // Collector faults never become success. Unknown raw error is retained locally, not serialized onto the wire.
      const result={terminal:{outcome:'refused',reason:'CLEANUP_INCOMPLETE',cleanup:null,acceptance:null},physicalStatus:'unconfirmed',auditStatus:'not-completed',raw:{before:null,after:null,error:undefined,rejected:false,collectionFailed:true,collectionError:error}};
      let delivery='not-sent';try{if(retirement===op&&child===op.child)delivery=op.child.complete(command,result.terminal).status;}finally{retainLongLivedRetirementV1(command,result,delivery);}
    }).finally(()=>{
      op.lease?.revoke();op.lease=null;op.ticket=null;op.view=null;op.context=null;op.port=null;op.route=null;
      if(op.stage==='accepted'){op.child?.dispose();if(child===op.child)child=null;readViewport=null;viewportAtBind=null;boundContext=null;lastSent=null;}
      op.child=null;op.command=null;if(retirement===op)retirement=null;
    }).catch(()=>{});
  }
  function accept(event){
    if(closed||!child)return {status:'ignored'};
    const result=child.accept(event);
    if(result.status==='binding'){changed();return result;}
    if(result.status==='invalid'){pending?.lease?.revoke();pending=null;return result;}
    if(result.status!=='execute')return result;
    const command=result.command;
    if(command.kind==='retire'){
      beginRetirement(command);return result;
    }
    const n=native();
    if(n.guardState.state!=='clean'){refuseCommand(command,refusal(n.guardState.state),n);return result;}
    if(!contextEqual(boundContext,n.context)||!viewportCurrent()){refuseCommand(command,'STALE_CONTEXT',n);return result;}
    const target=normalizedTarget(command.payload.request);
    if(!target||!n.stable){refuseCommand(command,'ROUTE_UNAVAILABLE',n);return result;}
    const acquired=n.guard.acquire(n.guardState.revision);
    if(acquired.status!=='granted'){refuseCommand(command,acquired.reason??'GUARD_UNAVAILABLE',n);return result;}
    const lease=acquired.lease;
    pending={command,lease,port:registered,target,startRoute:n.route,closed:false};
    if(same(n.route,target.route)){terminal('unchanged',null,n);return result;}
    try{
      const sent=registered.requestExternalNavigation(target.params,command.payload.historyMode,lease);
      if(pending&&(sent?.status!=='executed'||sent.value?.status!=='requested'))terminal('cancelled','STALE_CONTEXT',native());
    }catch{if(pending)terminal('cancelled','STALE_CONTEXT',native());}
    changed();return result;
  }
  function attach({parentWindow,documentId,send,viewport}){
    if(retirement){retirement.valid=false;retirement.child?.dispose();retirement=null;}
    if(child)detach();closed=false;readViewport=viewport;revision=0;last={route:null,guard:'unavailable'};lastSent=null;boundContext=null;viewportAtBind=null;
    child=createChildSession({parentWindow,documentId,send});
  }
  function detach(){
    if(retirement?.stage==='accepted'&&retirement.inOwnUnmount){retirement.ownDetached=true;pending?.lease?.revoke();pending=null;registered=null;readViewport=null;viewportAtBind=null;boundContext=null;lastSent=null;closed=true;return;}
    if(retirement){retirement.valid=false;retirement.reason='STALE_CONTEXT';retirement.lease?.revoke();}
    pending?.lease?.revoke();pending=null;child?.dispose();child=null;readViewport=null;viewportAtBind=null;boundContext=null;lastSent=null;closed=true;
  }
  const port=Object.freeze({
    register(value){if(registered&&registered!==value)throw Error('NATIVE_COMPARE_ROUTE_PORT_DUPLICATE');registered=value;changed();let removed=false;return()=>{if(removed)return;removed=true;if(registered===value){registered=null;changed();}};},
    changed(value){if(value===registered)changed();},
  });
  return Object.freeze({port,attach,accept,changed,detach});
}

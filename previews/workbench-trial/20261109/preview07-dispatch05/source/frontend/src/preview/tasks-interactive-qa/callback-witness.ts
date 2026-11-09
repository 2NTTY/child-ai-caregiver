import type { TasksChoiceSceneObserver } from '../tasks-choice-host/scene-barrier';
import { getAcceptanceTrace, type WitnessFields } from './trace';
export type RequestLabel = Readonly<{caseId:number;requestId:number;kind:'A'|'B'|'C'|'hide'}>;
export type CallbackRegistration = Readonly<{
  control:object;token:object;frame:object;request:RequestLabel|null;scene:TasksChoiceSceneObserver|null;
  apply:()=>void;exit:()=>void;isCurrent:()=>boolean;candidate?:WitnessFields;
}>;
type Lease = { identity:object;live:boolean;props:CallbackRegistration|null;acknowledged:boolean };
type Slot = {callback:()=>void;fields:WitnessFields};
const leases=new Map<object,Lease>();
const slots:{apply:Slot|null;exit:Slot|null}={apply:null,exit:null};
const balance={attached:0,detached:0,active:0,retained:0,consumed:0,released:0};
function fields(props:CallbackRegistration,lease?:Lease):WitnessFields {
  const trace=getAcceptanceTrace();
  return {...props.candidate,control:trace.identity(props.control),token:trace.identity(props.token),frame:trace.identity(props.frame),
    lease:trace.identity(lease?.identity),coordinator:trace.identity(props.scene),
    caseId:props.request?.caseId??null,requestId:props.request?.requestId??null,kind:props.request?.kind??null,
    apply:trace.identity(props.apply),exit:trace.identity(props.exit)};
}
export function candidateWitnessFields(candidate:object,applied:object|null,revision:number):WitnessFields {
  const trace=getAcceptanceTrace();return {candidate:trace.identity(candidate),applied:trace.identity(applied),draftRevision:revision};
}
export function recordControlRender(control:object,token:object,frame:object,request:RequestLabel|null) {
  if(!request)return;
  const trace=getAcceptanceTrace();trace.witness('control-render',{control:trace.identity(control),token:trace.identity(token),frame:trace.identity(frame),...request});
}
function endLease(lease:Lease) {
  if(!lease.live)return;
  const props=lease.props;
  if(props) {
    getAcceptanceTrace().witness('callback-cleanup',fields(props,lease));
    if(leases.get(props.control)===lease)leases.delete(props.control);
  }
  lease.live=false;lease.props=null;lease.acknowledged=false;balance.detached++;balance.active--;
}
/** Invoked exclusively by the child's real layout effect; every replay gets a fresh lease. */
export function registerCommittedCallbacks(props:CallbackRegistration):()=>void {
  if(!props.request)return ()=>{};
  const old=leases.get(props.control);if(old)endLease(old);
  if(leases.size>=4){getAcceptanceTrace().invalidate();return ()=>{};}
  const lease:Lease={identity:{},live:true,props,acknowledged:false};leases.set(props.control,lease);
  balance.attached++;balance.active++;getAcceptanceTrace().witness('callback-commit',fields(props,lease));
  return ()=>endLease(lease);
}
export function beginPublication(control:object,frame:object,receiptBefore:object|null) {
  const lease=leases.get(control),props=lease?.props;
  if(!lease?.live||!props||props.frame!==frame)return null;
  return {lease,fields:fields(props,lease),before:getAcceptanceTrace().identity(receiptBefore)};
}
export function endPublication(join:ReturnType<typeof beginPublication>,outcome:{admitted:boolean;outcome:string;receiptAfter:object|null}) {
  if(!join)return;
  const {lease}=join,props=lease.props;
  const current=lease.live&&!!props&&leases.get(props.control)===lease;
  if(current)lease.acknowledged=outcome.admitted;
  getAcceptanceTrace().witness('control-publication',{...join.fields,leaseCurrent:current,frameAdmitted:outcome.admitted,
    outcome:outcome.outcome,receiptBefore:join.before,receiptAfter:getAcceptanceTrace().identity(outcome.receiptAfter)});
}
export function retainCurrentCallbacks(scene:TasksChoiceSceneObserver|null) {
  const trace=getAcceptanceTrace();
  if(!trace.caseStatus().valid)return {status:'invalid-evidence'};
  if(slots.apply||slots.exit)return {status:'slots-occupied'};
  const eligible:Lease[]=[];
  try {
    const snapshot=scene?.read();
    for(const lease of leases.values()) {
      const p=lease.props;
      if(lease.live&&lease.acknowledged&&p&&p.scene===scene&&snapshot?.phase==='select'&&!snapshot.retired
        &&snapshot.authority?.frame===p.frame&&p.isCurrent())eligible.push(lease);
    }
  } catch { trace.invalidate();return {status:'observation-error'}; }
  if(eligible.length!==1)return {status:'not-current'};
  const lease=eligible[0],p=lease.props!,identity=fields(p,lease);
  slots.apply={callback:p.apply,fields:identity};slots.exit={callback:p.exit,fields:identity};balance.retained+=2;
  trace.witness('callbacks-retained',identity);return {status:'retained'};
}
/** Synthetic invocation of the genuine function; void is not a refusal result. */
export function invokeRetained(kind:'apply'|'exit') {
  const slot=slots[kind];if(!slot)return {status:'empty'};
  slots[kind]=null;balance.retained--;balance.consumed++;
  const trace=getAcceptanceTrace();trace.witness('retained-invoke-before',{...slot.fields,callbackKind:kind});
  try { slot.callback();trace.witness('retained-invoke-after',{...slot.fields,callbackKind:kind,outcome:'returned-void'});return {status:'returned-void'}; }
  catch(error) {
    trace.witness('retained-invoke-after',{...slot.fields,callbackKind:kind,outcome:'threw',error:error instanceof Error?error.name:'non-Error'});
    return {status:'threw'};
  }
}
export function resetRetainedCallbacks() {
  for(const kind of ['apply','exit'] as const)if(slots[kind]){slots[kind]=null;balance.retained--;balance.released++;}
  getAcceptanceTrace().witness('retained-reset',{...balance});
}
export function releaseCallbackWitness() { resetRetainedCallbacks();for(const lease of [...leases.values()])endLease(lease); }
export function callbackBalance() { return {...balance}; }
export type DeferredGate = {readonly label:RequestLabel;readonly promise:Promise<void>;status:'pending'|'cancelled'|'resolved'|'disposed'};
export function createDeferredPool() {
  const records=new Map<DeferredGate,()=>void>();let disposed=false,created=0,settled=0;
  function release(gate:DeferredGate,status:DeferredGate['status']) {
    const resolve=records.get(gate);if(!resolve)return;
    records.delete(gate);gate.status=status;settled++;
    getAcceptanceTrace().witness('deferred-settled',{...gate.label,status});resolve();
  }
  return {
    create(label:RequestLabel):DeferredGate|null {
      if(disposed||records.size>=4){getAcceptanceTrace().witness('deferred-refused',{...label});return null;}
      let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});
      const gate:DeferredGate={label,promise,status:'pending'};records.set(gate,resolve);created++;
      getAcceptanceTrace().witness('deferred-created',{...label});return gate;
    },
    cancel(gate:DeferredGate) { if(records.has(gate)&&gate.status==='pending'){gate.status='cancelled';getAcceptanceTrace().witness('deferred-cancelled',{...gate.label});} },
    resolve(gate:DeferredGate) { release(gate,gate.status==='cancelled'?'cancelled':'resolved'); },
    clear() { for(const gate of [...records.keys()])release(gate,'disposed'); },
    dispose() { disposed=true;for(const gate of [...records.keys()])release(gate,'disposed'); },
    balance() { return {created,settled,active:records.size,pending:[...records.keys()].filter(g=>g.status==='pending').length}; },
  };
}
export function createPrerequisiteWatch<T>(initial:{queue:(fn:()=>void)=>void;read:()=>T|null;request:(facts:T)=>void;disconnect:()=>void;limit:number}) {
  let ports:typeof initial|null=initial,active=true,queued=false,generation=0,checks=0,invalidated=0;
  function stop() {
    if(!active)return;active=false;generation++;if(queued)invalidated++;queued=false;
    const old=ports;ports=null;old?.disconnect();
  }
  return {
    schedule() {
      if(!active||queued||!ports)return;
      if(checks>=ports.limit){getAcceptanceTrace().witness('prerequisite-limit',{checks,outcome:'INCONCLUSIVE'});stop();return;}
      queued=true;const captured=generation;
      ports.queue(()=>{
        if(!active||captured!==generation||!ports)return;
        queued=false;checks++;
        let verified:T|null;
        try {
          const facts=ports.read();if(!facts)return;
          // Re-read immediately before requesting: changed focus/DOM/case/latch facts reject.
          verified=ports.read();if(!verified)return;
        } catch {
          const trace=getAcceptanceTrace();trace.invalidate();
          trace.witness('prerequisite-observation-error',{checks,outcome:'INCONCLUSIVE'});stop();return;
        }
        // Do not catch the request/product path as though it were an observation failure.
        const request=ports.request;stop();request(verified);
      });
    },stop,
    balance() {return {active:active?1:0,queued:queued?1:0,checks,invalidated};},
  };
}

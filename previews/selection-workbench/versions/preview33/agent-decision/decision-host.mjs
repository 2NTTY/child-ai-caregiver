import {freeze,createScenario} from './fixtures.mjs';
// A local synthetic presentation host, never a product owner or service writer.
const clone=value=>structuredClone(value);
const bindingEqual=(a,b)=>!!a&&!!b&&['identityKey','userId','childId','scopeKey','private'].every(k=>a[k]===b[k]);
export const sameAttempt=(a,b)=>!!a&&!!b&&bindingEqual(a.binding,b.binding)&&a.runId===b.runId&&a.proposalId===b.proposalId&&JSON.stringify(a.input)===JSON.stringify(b.input);
const targetMatches=s=>!!s.binding?.private&&!!s.proposal&&!!s.target&&s.proposal.id===s.target.id&&s.proposal.runId===s.target.runId&&s.proposal.childId===s.binding.childId&&s.proposal.kind===s.target.kind&&s.proposal.scope===s.target.scope&&s.proposal.version>=s.target.version;
const validContent=(p,now)=>p.contentState!=='invalidated'&&Number.isFinite(Date.parse(p.expiresAt))&&Date.parse(p.expiresAt)>now;
export function decisionGates(s,now=Date.now()){
 const p=s.proposal,n=s.pendingDecision;
 const common=!s.disposed&&targetMatches(s)&&s.readState==='ready'&&s.online&&!s.busy&&!s.writesBlocked&&!s.dataError;
 const accept=!!p&&p.status==='pending'&&validContent(p,now),dismiss=!!p&&['pending','expired'].includes(p.status);
 const bound=!!n&&n.attempt.runId===s.target?.runId&&n.attempt.proposalId===p?.id&&n.attempt.input.expectedVersion===p?.version&&bindingEqual(n.attempt.binding,s.binding);
 return {accept:common&&!n&&accept&&(p.scope==='private'||s.sharedConfirmed),dismiss:common&&!n&&dismiss,
 check:common&&accept&&(!n||n.reviewed&&bound&&n.attempt.input.decision==='accept'),
 retry:common&&bound&&n.reviewed&&!n.reconfirm&&(n.attempt.input.decision==='accept'?accept&&(p.scope==='private'||s.sharedConfirmed):dismiss),
 read:!s.disposed&&!!s.binding?.private&&!!s.target&&s.online&&!s.busy&&s.readState!=='denied'};
}
const validResult=r=>r===null||!!r&&typeof r.id==='string'&&r.id.length>0&&Number.isInteger(r.version)&&r.version>0&&['task','memory_fact','private_source','concern','family_document'].includes(r.kind);
function validateProposal(p){return !!p&&typeof p.id==='string'&&typeof p.runId==='string'&&typeof p.childId==='string'&&Number.isInteger(p.version)&&p.version>0&&['pending','accepted','dismissed','expired'].includes(p.status)&&['family','private'].includes(p.scope)&&Array.isArray(p.details)&&p.details.every(r=>typeof r.label==='string'&&typeof r.value==='string')&&typeof p.content==='string'&&validResult(p.result);}
export function createDecisionHost(fixture=createScenario(),{now=()=>Date.now()}={}){
 const listeners=new Set(),recovery=new Map();let serial=0,clientBuffer=null;
 let state=freeze({binding:fixture.binding,target:fixture.target,proposal:fixture.proposal,runStatus:fixture.runStatus,readState:fixture.readState??'ready',online:fixture.online!==false,busy:fixture.busy??null,writesBlocked:!!fixture.writesBlocked,sharedConfirmed:false,pendingDecision:null,priorEvidence:null,evidenceStale:false,dataError:fixture.dataError??null,notice:'合成預覽：所有決定只在本頁記憶體演示。',layout:'guided',navigation:'target',localCounters:{reads:0,submits:0},revision:0,epoch:0,presentationEpoch:0,request:null,disposed:false});
 function evidence(p,binding=state.binding){return freeze({binding,runId:p.runId,proposalId:p.id,proposalVersion:p.version,status:p.status,result:p.result,observedAt:new Date(now()).toISOString(),synthetic:true});}
 if(state.proposal&&['accepted','dismissed'].includes(state.proposal.status))state=freeze({...state,priorEvidence:evidence(state.proposal)});
 function publish(patch){const published=freeze({...state,...patch,revision:state.revision+1});state=published;for(const f of [...listeners])if(listeners.has(f))f();return published;}
 const controlToken=()=>freeze({revision:state.revision,epoch:state.epoch,presentationEpoch:state.presentationEpoch});
 const current=t=>!!t&&!state.disposed&&t.revision===state.revision&&t.epoch===state.epoch&&t.presentationEpoch===state.presentationEpoch;
 const ticketCurrent=t=>!!t&&!state.disposed&&state.request===t&&t.epoch===state.epoch&&bindingEqual(t.binding,state.binding);
 function queue(attempt,previous){
  if(clientBuffer&&(!sameAttempt(clientBuffer,attempt)||!state.pendingDecision?.reviewed))return null;
  clientBuffer=attempt;
  const t=freeze({kind:'write',serial:++serial,epoch:state.epoch,binding:state.binding,attempt,previous:!!previous});
  publish({request:t,busy:'write',pendingDecision:{attempt,reviewed:false,reconfirm:false,rejected:false},sharedConfirmed:false,notice:'合成決定已排入；尚未注入任何結果。',localCounters:{...state.localCounters,submits:state.localCounters.submits+1}});
  return ticketCurrent(t)?t:null;
 }
 function decide(id,decision,t){
  if(!current(t)||!['accept','dismiss'].includes(decision)||id!==state.proposal?.id||!decisionGates(state,now())[decision])return null;
  const attempt=freeze({binding:state.binding,runId:state.target.runId,proposalId:id,input:{expectedVersion:state.proposal.version,decision,confirmShared:decision==='accept'&&state.proposal.scope==='family'&&state.sharedConfirmed}});
  return queue(attempt,false);
 }
 function retryOriginal(t){if(!current(t)||!decisionGates(state,now()).retry)return null;return queue(state.pendingDecision.attempt,true);}
 function readOriginal(t){
  if(!current(t)||!decisionGates(state,now()).read)return null;
  const r=freeze({kind:'read',serial:++serial,epoch:state.epoch,binding:state.binding,runId:state.target.runId});
  publish({request:r,busy:'read',readState:'loading',sharedConfirmed:false,evidenceStale:!!state.priorEvidence,pendingDecision:state.pendingDecision?{...state.pendingDecision,reviewed:false}:null,notice:'正在演示讀取原 run；不會重送決定。',localCounters:{...state.localCounters,reads:state.localCounters.reads+1}});
  return ticketCurrent(r)?r:null;
 }
 function deny(error={status:403}){
  const identityLost=error.status===401||['session_changed','unauthorized'].includes(error.code);
  if(identityLost)recovery.clear();else for(const [key,saved]of recovery)if(saved.binding.childId===state.binding?.childId)recovery.delete(key);
  clientBuffer=null;
  publish({epoch:state.epoch+1,request:null,busy:null,readState:'denied',proposal:null,sharedConfirmed:false,pendingDecision:null,priorEvidence:null,evidenceStale:false,notice:'登入、存取權或資料已改變；私人正文與收據已隱藏。'});
 }
 function failure(){publish({request:null,busy:null,readState:'failed',sharedConfirmed:false,evidenceStale:!!state.priorEvidence,notice:'暫時無法確認原決定結果；舊快照不是最新狀態。'});}
 function injectRead(t,out){
  if(!ticketCurrent(t)||t.kind!=='read')return false;
  if(out?.kind==='denied'){deny(out);return true;}
  if(out?.kind!=='ready'||out.runId!==t.runId||out.childId!==t.binding.childId||!Array.isArray(out.proposals)||new Set(out.proposals.map(p=>p.id)).size!==out.proposals.length||out.proposals.some(p=>!validateProposal(p)||p.runId!==t.runId||p.childId!==t.binding.childId)){failure();return true;}
  let p=out.proposals.find(p=>p.id===state.target.id)??null;
  if(p&&(p.kind!==state.target.kind||p.scope!==state.target.scope||p.version<state.target.version)){failure();return true;}
  p=p?freeze(clone(p)):null;let pending=state.pendingDecision,notice='已讀取合成原 run；請核對本次快照。';
  if(pending){
   if(!p)notice='原提案未出現在這次快照；暫時無法確認原決定結果。';
   else if(['accepted','dismissed'].includes(p.status)){pending=null;clientBuffer=null;notice=p.status==='accepted'?'合成原提案已接受；只證明這次原快照。':'合成原提案已略過。';}
   else if(pending.reconfirm||p.version!==pending.attempt.input.expectedVersion||pending.attempt.input.decision==='accept'&&p.status==='expired'){pending=null;clientBuffer=null;notice=p.status==='expired'?'提案已過期，請重新核對。':'內容已更新，請重新核對。';}
   else {pending={...pending,reviewed:true};notice='暫時無法確認原決定結果；已讀取同版本，可核對後重試原決定。';}
  }
  if(p&&state.proposal&&p.version!==state.proposal.version)notice='版本已改變，請重新核對。'+notice;
  const prior=state.priorEvidence??(p&&['accepted','dismissed'].includes(p.status)?evidence(p):null);
  publish({proposal:p,runStatus:out.runStatus??state.runStatus,request:null,busy:null,readState:'ready',sharedConfirmed:false,pendingDecision:pending,priorEvidence:prior,evidenceStale:!!prior&&(!p||prior.proposalVersion!==p.version||prior.status!==p.status||JSON.stringify(prior.result)!==JSON.stringify(p.result)),notice});return true;
 }
 function injectDecision(t,out){
  if(!ticketCurrent(t)||t.kind!=='write')return false;
  if(out?.kind==='denied'||out?.kind==='error'&&([401,403,404].includes(out.status)||['session_changed','unauthorized','not_found'].includes(out.code))){deny(out);return true;}
  const p=out?.proposal,wanted=t.attempt.input.decision==='accept'?'accepted':'dismissed';
  if(out?.kind==='saved'&&validateProposal(p)&&p.id===t.attempt.proposalId&&p.runId===t.attempt.runId&&p.childId===t.attempt.binding.childId&&p.version===t.attempt.input.expectedVersion+1&&p.status===wanted&&p.kind===state.target.kind&&p.scope===state.target.scope){
   const saved=freeze(clone(p));clientBuffer=null;publish({proposal:saved,pendingDecision:null,request:null,busy:null,readState:'ready',sharedConfirmed:false,priorEvidence:evidence(saved),evidenceStale:false,notice:wanted==='accepted'?'合成結果：原提案已接受；不代表照護完成或資源目前版本。':'合成結果：原提案已略過，沒有以此決定執行候選改動。'});return true;
  }
  if(out?.kind==='error'&&out.status===405&&!t.previous){clientBuffer=null;publish({pendingDecision:null,request:null,busy:null,sharedConfirmed:false,notice:'合成結果：方法被拒絕，未接受／略過成功。'});return true;}
  const reconfirm=out?.kind==='error'&&out.status===409;
  const rejected=reconfirm||out?.kind==='error'&&out.status===400&&['invalid_input','sharing_confirmation_required'].includes(out.code);
  publish({request:null,busy:null,sharedConfirmed:false,pendingDecision:{attempt:t.attempt,reviewed:false,reconfirm,rejected:!!rejected},notice:rejected?'原決定被明確拒絕；先讀原結果並重新核對。':'暫時無法確認原決定結果；保留原 tuple，不等於失敗或成功。'});return true;
 }
 function syncContext({binding,online=state.online,allowedScopeKeys,scenario}={}){
  if(state.disposed)return false;
  const allowed=allowedScopeKeys===undefined?null:new Set(allowedScopeKeys),old=state.binding;
  const identityChanged=old?.identityKey!==binding?.identityKey||old?.userId!==binding?.userId;
  if(identityChanged)recovery.clear();
  if(allowed){for(const key of recovery.keys())if(!allowed.has(key))recovery.delete(key);if(binding&&!allowed.has(binding.scopeKey))binding=null;}
  if(bindingEqual(old,binding)){
   if(online!==state.online)publish({online,request:online?state.request:null,busy:online?state.busy:null,pendingDecision:!online&&state.pendingDecision?{...state.pendingDecision,reviewed:false}:state.pendingDecision});
   return true;
  }
  if(!identityChanged&&old?.identityKey&&state.pendingDecision&&(!allowed||allowed.has(old.scopeKey)))recovery.set(old.scopeKey,{binding:old,target:state.target,proposal:state.proposal,pendingDecision:{...state.pendingDecision,reviewed:false},priorEvidence:state.priorEvidence,clientBuffer,runStatus:state.runStatus});
  const saved=!identityChanged&&binding?recovery.get(binding.scopeKey):null;
  const recovered=saved&&bindingEqual(saved.binding,binding)?saved:null;if(binding)recovery.delete(binding.scopeKey);
  clientBuffer=recovered?.clientBuffer??null;
  const published=publish({binding:binding?freeze(clone(binding)):null,epoch:state.epoch+1,request:null,busy:null,online,readState:recovered?'idle':scenario?'ready':'idle',target:recovered?.target??scenario?.target??null,proposal:recovered?.proposal??scenario?.proposal??null,pendingDecision:recovered?.pendingDecision??null,priorEvidence:recovered?.priorEvidence??null,evidenceStale:!!recovered?.priorEvidence,sharedConfirmed:false,runStatus:recovered?.runStatus??scenario?.runStatus??'unknown',dataError:scenario?.dataError??null,notice:recovered?'已返回原私人範圍；必須先讀原結果。':'合成範圍已切換；沒有移用別人的提案。'});
  if(recovered&&online&&state===published&&bindingEqual(state.binding,binding)&&state.pendingDecision?.attempt===recovered.pendingDecision.attempt&&!state.busy)readOriginal(controlToken());
  return true;
 }
 function setLayout(layout){if(state.disposed||!['guided','board'].includes(layout)||layout===state.layout)return false;publish({layout});return true;}
 function navigateSection(n){if(state.disposed||!['target','changes','scope','decide'].includes(n))return false;publish({navigation:n});return true;}
 function setSharedConfirmation(checked,t){if(!current(t)||!decisionGates(state,now()).check||state.proposal.scope!=='family')return false;publish({sharedConfirmed:checked===true});return true;}
 function setConditions(patch,t){if(!current(t))return false;const p={};for(const k of ['online','writesBlocked'])if(typeof patch[k]==='boolean')p[k]=patch[k];if(p.online===false){p.request=null;p.busy=null;if(state.pendingDecision)p.pendingDecision={...state.pendingDecision,reviewed:false};}publish(p);return true;}
 function loadScenario(next,t){if(!current(t)||state.pendingDecision||state.busy)return false;clientBuffer=null;recovery.clear();publish({binding:next.binding,target:next.target,proposal:next.proposal,runStatus:next.runStatus,readState:next.readState,online:next.online,writesBlocked:next.writesBlocked,sharedConfirmed:false,pendingDecision:null,priorEvidence:next.proposal&&['accepted','dismissed'].includes(next.proposal.status)?evidence(next.proposal,next.binding):null,evidenceStale:false,dataError:next.dataError,epoch:state.epoch+1,request:null,notice:'已載入另一個合成樣例；沒有正式資料。'});return true;}
 function retirePresentation(){if(state.disposed)return;publish({presentationEpoch:state.presentationEpoch+1});}
 function dispose(){if(state.disposed)return;recovery.clear();clientBuffer=null;publish({disposed:true,epoch:state.epoch+1,request:null,busy:null,proposal:null,target:null,pendingDecision:null,priorEvidence:null,sharedConfirmed:false});listeners.clear();}
 return freeze({getSnapshot:()=>state,controlToken,subscribe(f){listeners.add(f);return()=>listeners.delete(f);},decide,retryOriginal,readOriginal,injectRead,injectDecision,syncContext,deny,setLayout,navigateSection,setSharedConfirmation,setConditions,loadScenario,retirePresentation,dispose,gates:()=>decisionGates(state,now())});
}

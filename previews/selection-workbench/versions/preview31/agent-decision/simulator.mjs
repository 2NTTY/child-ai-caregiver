import {readSyntheticResource} from './fixtures.mjs';
// Manual fixture delivery only. Each button chooses a response, never a default success.
export function deliverSynthetic(host,ticket,name){
 if(!ticket)return false;
 const s=host.getSnapshot();
 if(ticket.kind==='write'){
  if(name==='unknown')return host.injectDecision(ticket,{kind:'unknown'});
  if(name==='405'||name==='409'||name==='400')return host.injectDecision(ticket,{kind:'error',status:Number(name),code:name==='409'?'version_conflict':name==='400'?'invalid_input':undefined});
  if(name==='saved'||name==='no-result'){
   if(!s.proposal)return false;const accepted=ticket.attempt.input.decision==='accept';
   let result=null;
   if(accepted&&name==='saved'){
    const resource=readSyntheticResource(s.proposal);
    // Refuse this fixture delivery only. Original request/unknown and receipt stay untouched.
    if(!resource)return false;
    result={kind:resource.kind,id:resource.id,version:resource.savedVersion,label:`合成${resource.mode==='update'?'原':'新'}資源 ${resource.id}`};
   }
   return host.injectDecision(ticket,{kind:'saved',proposal:{...s.proposal,version:ticket.attempt.input.expectedVersion+1,status:accepted?'accepted':'dismissed',result}});
  }
 }else if(ticket.kind==='read'){
  if(name==='failed')return host.injectRead(ticket,{kind:'failed'});
  if(name==='denied')return host.injectRead(ticket,{kind:'denied',status:403});
  const p=s.proposal;let proposals=p?[p]:[];
  if(name==='missing')proposals=[];
  if(name==='new'&&p)proposals=[{...p,version:p.version+1,status:'pending',result:null}];
  if(['same','missing','new'].includes(name))return host.injectRead(ticket,{kind:'ready',runId:ticket.runId,childId:ticket.binding.childId,runStatus:s.runStatus,proposals});
 }
 return false;
}

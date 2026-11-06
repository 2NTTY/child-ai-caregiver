// Original memory-only demonstration. No production controller or transport is used.
export const PHASES=Object.freeze({started:'已開始處理',model:'正在整理下一步',reading:'正在讀取相關資料',searching:'正在查詢來源',working:'正在處理事項',tool_finished:'工具已返回結果，正在核對',reviewing:'正在獨立核對回覆',help:'請先查看官方提示；對話可繼續'});
const RUN='33333333-3333-4333-8333-333333333333';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value)}return value};
const validEvent=e=>!!e&&typeof e==='object'&&!Array.isArray(e)&&Object.keys(e).every(k=>['runId','messageId','phase','card'].includes(k))&&UUID.test(e.runId)&&UUID.test(e.messageId)&&Object.hasOwn(PHASES,e.phase)&&((e.phase==='help'&&['emergency-hk-v1','medical-consult-hk-v1'].includes(e.card))||(e.phase!=='help'&&!Object.hasOwn(e,'card')));
export function createFixture(){
  let epoch=0,serial=0,requestSerial=0;const listeners=new Set();
  const makeBinding=space=>freeze({apiBase:'synthetic://ap01',userId:'11111111-1111-4111-8111-111111111111',childId:space==='A'?'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',messageId:space==='A'?'22222222-2222-4222-8222-222222222222':'66666666-6666-4666-8666-666666666666',space,epoch:++epoch,view:epoch});
  const initial=space=>({binding:makeBinding(space),runId:null,phase:null,status:'running',stream:'live',online:true,suspended:false,disposed:false,observations:[],discarded:0,cancel:'idle',checkState:'idle',pendingStop:null,pendingCheck:null,stopCalls:[],readCalls:[],runsStarted:0});
  let state=freeze(initial('A'));
  const publish=patch=>{state=freeze({...state,...patch});for(const listener of [...listeners])listener();};
  const active=()=>!state.disposed&&!state.suspended;
  const current=b=>active()&&b===state.binding;
  const path=()=>`/api/children/${state.binding.childId}`;
  const fixture={
    binding:()=>state.binding,snapshot:()=>state,
    subscribe(listener){if(state.disposed)return()=>{};listeners.add(listener);return()=>listeners.delete(listener)},
    emit(binding,event){
      if(!current(binding)||!state.online||state.stream!=='live'||state.status!=='running'||!validEvent(event)||event.messageId!==binding.messageId||(state.runId&&event.runId!==state.runId))return false;
      const observation=freeze({id:++serial,event:{...event}}),all=[...state.observations,observation];
      publish({runId:event.runId,phase:event.phase,observations:all.slice(-48),discarded:state.discarded+Math.max(0,all.length-48)});return true;
    },
    stop(binding){
      if(!current(binding)||!state.online||state.status!=='running'||state.pendingStop||state.pendingCheck||state.cancel!=='idle')return null;
      const ticket=freeze({serial:++requestSerial,binding,runId:state.runId,messageId:binding.messageId,method:'POST',path:`${path()}/messages/${binding.messageId}/reply/cancel`,body:{}});
      publish({pendingStop:ticket,cancel:'pending',stopCalls:[...state.stopCalls,ticket]});return ticket;
    },
    settleStop(ticket,outcome){
      if(!ticket||!current(ticket.binding)||!state.online||state.pendingStop!==ticket||![true,false,'unknown'].includes(outcome))return false;
      publish({pendingStop:null,cancel:outcome===true?'accepted':outcome===false?'not_running':'unconfirmed'});return true;
    },
    disconnect(binding){if(!current(binding)||state.stream!=='live')return false;publish({stream:'interrupted',status:'unknown'});return true},
    check(binding){
      if(!current(binding)||!state.online||state.stream==='live'||state.pendingCheck||state.pendingStop)return null;
      const ticket=freeze({serial:++requestSerial,binding,runId:state.runId,messageId:binding.messageId,method:'GET',path:state.runId?`${path()}/agent/runs/${state.runId}`:`${path()}/messages/${binding.messageId}/reply`});
      publish({pendingCheck:ticket,checkState:'pending',readCalls:[...state.readCalls,ticket]});return ticket;
    },
    settleCheck(ticket,result){
      if(!ticket||!current(ticket.binding)||!state.online||state.pendingCheck!==ticket)return false;
      if(result==='failed'){publish({pendingCheck:null,checkState:'failed'});return true}
      if(result===null&&!ticket.runId){publish({pendingCheck:null,checkState:'missing',status:'unknown'});return true}
      const allowed=ticket.runId?['runId','status']:['runId','messageId','status'];
      if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).some(k=>!allowed.includes(k))||!UUID.test(result.runId)||!['running','completed','stopped','unknown'].includes(result.status)||(ticket.runId?result.runId!==ticket.runId:result.messageId!==ticket.messageId)){
        publish({pendingCheck:null,checkState:'failed'});return false;
      }
      publish({pendingCheck:null,checkState:'read',runId:result.runId,status:result.status,stream:result.status==='running'?'interrupted':'settled',cancel:result.status==='running'?'idle':state.cancel});return true;
    },
    setOnline(online){
      if(!active()||typeof online!=='boolean'||online===state.online)return false;
      publish({online,...(!online?{stream:state.stream==='live'?'interrupted':state.stream,status:state.stream==='live'?'unknown':state.status,pendingStop:null,pendingCheck:null,cancel:state.pendingStop?'unconfirmed':state.cancel,checkState:state.pendingCheck?'failed':state.checkState}:{})});return true;
    },
    context(space){if(!active()||!['A','B'].includes(space))return false;serial=0;state=freeze(initial(space));for(const listener of [...listeners])listener();return true},
    scenario(name){
      if(!active()||!['live','no-run','interrupted'].includes(name))return false;
      const space=state.binding.space;fixture.context(space);
      if(name!=='no-run'){fixture.emit(state.binding,{runId:RUN,messageId:state.binding.messageId,phase:'started'});fixture.emit(state.binding,{runId:RUN,messageId:state.binding.messageId,phase:'reading'})}
      if(name!=='live')fixture.disconnect(state.binding);return true;
    },
    suspend(){if(!active())return false;publish({suspended:true});return true},
    resume(){if(state.disposed||!state.suspended)return false;publish({suspended:false});return true},
    dispose(){if(state.disposed)return;publish({disposed:true,suspended:false,pendingStop:null,pendingCheck:null,observations:[],phase:null,runId:null});listeners.clear()},
  };
  fixture.emit(state.binding,{runId:RUN,messageId:state.binding.messageId,phase:'started'});
  fixture.emit(state.binding,{runId:RUN,messageId:state.binding.messageId,phase:'reading'});
  return Object.freeze(fixture);
}

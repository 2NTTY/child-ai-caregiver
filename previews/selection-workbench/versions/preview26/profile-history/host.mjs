import {canRead} from './model.mjs';import {scenario,older,revision} from './fixtures.mjs';
// A bounded synthetic read owner, not the product controller or a writer.
export function createHost(initial=scenario()){
 let state={...initial,epoch:1,paused:false},alive=true,serial=0,cursor=state.hasMoreHistory?4:null;
 const listeners=new Set();const emit=()=>{for(const fn of [...listeners])if(alive&&listeners.has(fn))fn(state)};
 const retire=()=>{state={...state,epoch:state.epoch+1,pending:null,reading:false};};
 return {
  get:()=>state,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},
  begin(mode){if(!alive||!canRead(state,mode)||state.pending)return null;const ticket=Object.freeze({serial:++serial,epoch:state.epoch,scope:state.scopeKey,mode,before:mode==='more'?cursor:state.current?.version??null});state={...state,reading:true,pending:ticket,notice:null};emit();return ticket},
  settle(ticket,result){if(!alive||state.paused||!ticket||ticket!==state.pending||ticket.epoch!==state.epoch||ticket.scope!==state.scopeKey)return false;
   if(result==='error')state={...state,reading:false,pending:null,notice:ticket.mode==='current'?'未能核對目前檔案，舊讀窗保留。':'未能讀取檔案歷史，請手動重試。',needsRefresh:ticket.mode==='current'||state.needsRefresh};
   else if(ticket.mode==='current')state={...state,reading:false,pending:null,current:state.current??revision(6),needsRefresh:false,notice:null};
   else {const rows=ticket.mode==='first'?scenario().history:older();cursor=ticket.mode==='first'?4:null;state={...state,reading:false,pending:null,notice:null,history:ticket.mode==='first'?rows:[...state.history,...rows],historyOpen:true,hasMoreHistory:cursor!==null};}
   emit();return true},
  replace(next){if(!alive)return;const epoch=state.epoch+1;cursor=next.hasMoreHistory?4:null;state={...next,epoch,paused:false,pending:null};emit()},
  invalidateCanonical(){if(!alive||state.paused||!state.current||state.access==='lost')return;retire();cursor=null;state={...state,current:{...state.current},history:[],historyOpen:false,hasMoreHistory:false,notice:null};emit()},
  pause(){if(!alive||state.paused)return;retire();state={...state,paused:true};emit()},
  resume(){if(!alive||!state.paused)return;state={...state,paused:false};emit()},
  dispose(){if(!alive)return;retire();alive=false;listeners.clear()}
 };
}

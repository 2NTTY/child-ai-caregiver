// Synthetic read-only presentation host. This is not ProductAgentOwner.
const states = new Set(['running', 'completed', 'stopped', 'unknown']);
const idOK = id => typeof id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(id);
const textOK = value => typeof value === 'string' && value.length <= 150000;
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); } return value; };
const scopeKey = s => JSON.stringify([s.identity, s.generation, s.childId, s.scopeKey]);
function scopeValue(s) {
  if (!s || !textOK(s.identity) || !s.identity || !Number.isSafeInteger(s.generation) || !idOK(s.childId) || !textOK(s.scopeKey) || !s.scopeKey || !textOK(s.label)) throw new TypeError('Invalid synthetic scope');
  return {identity:s.identity,generation:s.generation,childId:s.childId,scopeKey:s.scopeKey,label:s.label};
}
function savedValue(value) { return value?.state === 'confirmed' && textOK(value.summary) && value.summary.trim() ? {state:'confirmed',summary:value.summary} : null; }
function listValue(value) {
  if (!value || !Array.isArray(value.entries) || value.entries.length > 20 || !Number.isFinite(Date.parse(value.loadedAt)) || Object.keys(value).some(k=>!['entries','loadedAt'].includes(k))) throw new TypeError('Invalid loaded window');
  const ids = new Set();
  const entries = value.entries.map(r=> {if (!r || !idOK(r.runId) || ids.has(r.runId) || !textOK(r.createdAt) || Object.keys(r).some(k=>!['runId','createdAt'].includes(k))) throw new TypeError('Invalid list row'); ids.add(r.runId); return {runId:r.runId,createdAt:r.createdAt};});
  return {state:'ready',entries,loadedAt:value.loadedAt};
}
function detailValue(value,id) {
  if (!value || value.runId !== id || !states.has(value.status) || !textOK(value.title) || !textOK(value.text) || ![null,'no_action'].includes(value.outcome) || typeof value.pendingDecision !== 'boolean' || (value.context !== null && (!textOK(value.context?.label) || !textOK(value.context?.text))) || (value.savedEvidence !== null && !savedValue(value.savedEvidence))) throw new TypeError('Invalid result');
  return {runId:id,status:value.status,title:value.title,text:value.text,context:value.context?{label:value.context.label,text:value.context.text}:null,outcome:value.outcome,pendingDecision:value.pendingDecision,savedEvidence:savedValue(value.savedEvidence)};
}
const emptyList=()=>({state:'idle',entries:[],loadedAt:null});
export function createHost({scope,ports}) {
  if (typeof ports?.list !== 'function' || typeof ports?.detail !== 'function') throw new TypeError('Read ports required');
  let state={scope:scopeValue(scope),epoch:0,layout:'fold',selected:null,expanded:[],list:emptyList(),details:{},online:true,locked:false,disposed:false};
  let snapshot=freeze(structuredClone(state)), listRequest=null;
  const details=new Map(),listeners=new Set();
  const emit=()=>{snapshot=freeze(structuredClone(state));listeners.forEach(fn=>fn());};
  const active=()=>!state.disposed;
  const readable=()=>active()&&state.online&&!state.locked&&state.list.state!=='denied';
  const inWindow=id=>state.list.entries.some(r=>r.runId===id);
  const cancel=()=>{listRequest?.abort();listRequest=null;details.forEach(c=>c.abort());details.clear();};
  function deny(){cancel();state.epoch++;state.list={state:'denied',entries:[],loadedAt:null};state.details={};state.selected=null;state.expanded=[];emit();}
  function current(epoch,controller,kind,id){return !state.disposed && state.epoch===epoch && !controller.signal.aborted && (kind==='list'?listRequest===controller:details.get(id)===controller);}
  const api={
    getSnapshot:()=>snapshot,
    subscribe(fn){if(!active())return()=>{};listeners.add(fn);return()=>listeners.delete(fn)},
    async refresh(){
      if(!readable())return false;
      listRequest?.abort();const controller=new AbortController(),epoch=state.epoch;listRequest=controller;
      state.list={...state.list,state:'loading'};emit();
      try{
        const value=await ports.list({scope:freeze({...state.scope}),signal:controller.signal});
        if(!current(epoch,controller,'list'))return false;
        const next=listValue(value);state.list=next;
        const retained=new Set(next.entries.map(r=>r.runId));
        for(const id of Object.keys(state.details))if(!retained.has(id)){delete state.details[id];details.get(id)?.abort();details.delete(id);}
        if(!retained.has(state.selected))state.selected=null;
        state.expanded=state.expanded.filter(id=>retained.has(id));emit();return true;
      }catch(error){if(!current(epoch,controller,'list'))return false;if(error?.code==='denied'){deny();return false;}state.list={...state.list,state:'failed'};emit();return false;}
      finally{if(listRequest===controller)listRequest=null;}
    },
    async readResult(id){
      if(!readable()||!inWindow(id))return false;
      details.get(id)?.abort();const controller=new AbortController(),epoch=state.epoch;details.set(id,controller);
      const old=state.details[id];state.details[id]={state:'loading',data:old?.data??null,savedEvidence:old?.savedEvidence??null};emit();
      try{
        const value=await ports.detail({scope:freeze({...state.scope}),runId:id,signal:controller.signal});
        if(!current(epoch,controller,'detail',id)||!inWindow(id))return false;
        const data=detailValue(value,id);state.details[id]={state:'ready',data,savedEvidence:data.savedEvidence};emit();return true;
      }catch(error){if(!current(epoch,controller,'detail',id))return false;if(error?.code==='denied'){deny();return false;}state.details[id]={...state.details[id],state:'failed',savedEvidence:error?.code==='saved_read_failed'?savedValue(error.savedEvidence)??state.details[id].savedEvidence:state.details[id].savedEvidence};emit();return false;}
      finally{if(details.get(id)===controller)details.delete(id);}
    },
    select(id){if(!readable()||state.list.state==='loading'||!inWindow(id))return false;state.selected=id;emit();void api.readResult(id);return true},
    back(){if(!active())return;state.selected=null;emit()},
    toggleContext(id){if(!active()||state.selected!==id||!state.details[id]?.data?.context)return;state.expanded=state.expanded.includes(id)?state.expanded.filter(x=>x!==id):[...state.expanded,id];emit()},
    setLayout(layout){if(!active()||!['fold','folio'].includes(layout)||layout===state.layout)return;state.layout=layout;emit()},
    setScope(next){if(!active())return;next=scopeValue(next);if(scopeKey(next)===scopeKey(state.scope))return;cancel();state={...state,scope:next,epoch:state.epoch+1,selected:null,expanded:[],list:emptyList(),details:{},online:true,locked:false};emit()},
    setAvailability({online=state.online,locked=state.locked}){if(!active())return;if(typeof online!=='boolean'||typeof locked!=='boolean')throw new TypeError('Boolean availability required');if(!online){cancel();state.epoch++;if(state.list.state==='loading')state.list={...state.list,state:state.list.loadedAt?'stale':'idle'};for(const id of Object.keys(state.details)){if(state.details[id].state==='loading')state.details[id]={...state.details[id],state:state.details[id].data?'stale':'failed'};}}state.online=online;state.locked=locked;emit()},
    dispose(){if(!active())return;cancel();state.epoch++;state.disposed=true;state.list=emptyList();state.details={};state.selected=null;state.expanded=[];listeners.clear();snapshot=freeze(structuredClone(state));}
  };
  return Object.freeze(api);
}

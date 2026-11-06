import {filterItems,filterKey,selectionTuple,validRange} from './model.mjs';
import {fixture,syntheticLoader,SCENARIOS} from './fixtures.mjs';
const clone=x=>structuredClone(x);
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x)}return x};
const initialFilters=()=>({query:'',from:'',to:''});
const initialDraft=()=>({from:'',to:'',error:''});
const privateAllowed=g=>g.accountReady&&g.providerActive&&g.privateAccess&&g.current;
const failure=kind=>Object.assign(Error(`Synthetic ${kind}`),{kind});
function validWindow(p){return p&&p.schemaVersion===1&&typeof p.userId==='string'&&typeof p.scopeVersion==='string'&&/^[a-f0-9]{64}$/.test(p.scopeVersion)&&Number.isFinite(Date.parse(p.asOf))&&Array.isArray(p.items)&&typeof p.complete==='boolean'&&p.complete===(p.nextCursor===null)&&(p.nextCursor===null||typeof p.nextCursor==='string'&&p.nextCursor.length>0)&&p.coverage?.historical==='unknown'&&p.items.every(m=>typeof m.messageId==='string'&&Number.isFinite(Date.parse(m.sentAt))&&['account','child'].includes(m.scope?.kind)&&Array.isArray(m.contents)&&m.contents.length>0&&m.contents.length<=3&&new Set(m.contents.map(c=>c.channel)).size===m.contents.length&&m.contents.every(c=>['web_push','native_push','telegram'].includes(c.channel)&&typeof c.contentVersion==='string'&&c.contentVersion.length>0&&(c.title===null||typeof c.title==='string')&&typeof c.body==='string'&&Number.isFinite(Date.parse(c.sentAt))))}
export function createHost({initial=fixture(),loader=syntheticLoader}={}){
 let alive=true,revision=0,sequence=0,active=null;
 let state={context:{identity:initial?.userId??'synthetic-a',scope:'personal-account',epoch:1},lifetime:1,layout:'signal',window:initial?clone(initial):null,readState:initial?'ready':'idle',busy:false,filters:initialFilters(),draft:initialDraft(),selection:null,lastRead:null,scenario:'normal',gates:{online:true,accountReady:true,providerActive:true,privateAccess:true,current:true}};
 const registrations=new Set();
 const live=n=>alive&&(n===undefined||n===state.lifetime);
 const invalidateSelection=()=>{if(state.selection&&!selected())state.selection=null};
 const visible=()=>privateAllowed(state.gates)?filterItems(state.window?.items??[],state.filters):[];
 const selected=()=>{if(!state.selection||!state.window||!privateAllowed(state.gates))return null;const m=visible().find(m=>m.messageId===state.selection.id);return m&&selectionTuple(state,m)===state.selection.tuple?m:null};
 const availability=()=>({allowed:alive&&privateAllowed(state.gates)&&state.gates.online&&!state.busy,reason:!privateAllowed(state.gates)?'access':!state.gates.online?'offline':state.busy?'busy':!alive?'disposed':''});
 const getSnapshot=()=>freeze(clone({...state,revision,visible:visible(),detail:selected(),readAvailability:availability()}));
 const publish=()=>{invalidateSelection();const current=++revision,snapshot=getSnapshot();for(const r of [...registrations]){if(!alive||current!==revision)break;if(registrations.has(r))r.fn(snapshot)}};
 const retireRead=()=>{active=null;state.busy=false;state.lastRead=null};
 const clearPrivate=(kind,hard=true)=>{retireRead();if(hard)state.lifetime++;state.window=null;state.selection=null;state.filters=initialFilters();state.draft=initialDraft();state.readState=kind};
 const canRead=(kind,n)=>live(n)&&availability().allowed&&(kind==='retry'||kind==='more'&&state.window?.nextCursor!==null&&!!state.window);
 const currentTicket=t=>live(t.lifetime)&&active===t&&privateAllowed(state.gates)&&state.gates.online;
 async function execute(t,request){
  // Defer only the synthetic loader; recheck live admission at its actual boundary.
  if(!currentTicket(t))return;
  try{
   const result=await loader(request);
   if(!currentTicket(t))return;
   if(!validWindow(result))throw failure('error');
   if(result.userId!==state.context.identity)throw failure('authority');
   if(request.window&&result.scopeVersion!==request.window.scopeVersion)throw failure('authority');
   if(t.kind==='more'&&result.asOf!==request.window.asOf)throw failure('authority');
   if(t.kind==='more'&&result.nextCursor===request.window.nextCursor)throw failure('error');
   if(t.kind==='more'){
    const items=clone(state.window.items),indices=new Map(items.map((m,i)=>[m.messageId,i]));
    for(const item of result.items){if(indices.has(item.messageId))items[indices.get(item.messageId)]=clone(item);else{indices.set(item.messageId,items.length);items.push(clone(item))}}
    state.window={...clone(result),items,pageDepth:(state.window.pageDepth??1)+1};
   }else state.window={...clone(result),pageDepth:result.pageDepth??1};
   active=null;state.busy=false;state.readState='ready';state.lastRead={id:t.id,lifetime:t.lifetime,kind:t.kind,outcome:'ready'};publish();
  }catch(error){
   if(!currentTicket(t))return;
   const kind=['unavailable','authority','access'].includes(error?.kind)?error.kind:'error';
   if(kind!=='error')clearPrivate(kind,true);else{active=null;state.busy=false;state.readState=state.window?'stale':'error'}
   state.lastRead={id:t.id,lifetime:t.lifetime,kind:t.kind,outcome:kind};publish();
  }
 }
 const host={
  getSnapshot,
  subscribe(fn){if(!alive)return()=>{};const r={fn};registrations.add(r);return()=>registrations.delete(r)},
  select(id,n,tuple){if(!live(n))return false;const item=visible().find(m=>m.messageId===id);if(!item)return false;const current=selectionTuple(state,item);if(tuple!==undefined&&tuple!==current)return false;state.selection={id,tuple:current};publish();return true},
  closeDetail(n){if(!live(n))return false;state.selection=null;publish();return true},
  setLayout(layout){if(!alive||!['signal','letters'].includes(layout))return false;state.layout=layout;publish();return true},
  setFilters(patch,n){if(!live(n))return false;const next={...state.filters,...patch};if(!validRange(next.from,next.to))return false;if(filterKey(next)===filterKey(state.filters))return true;state.filters=next;state.selection=null;publish();return true},
  editDateDraft(patch,n){if(!live(n))return false;state.draft={...state.draft,...patch,error:''};publish();return true},
  applyDateDraft(n){if(!live(n))return false;const{from,to}=state.draft;if(!validRange(from,to)){state.draft.error='請使用有效日期，開始日不可晚於結束日。';publish();return false}return host.setFilters({from,to},n)},
  clearFilters(n){if(!live(n))return false;state.filters=initialFilters();state.draft=initialDraft();state.selection=null;publish();return true},
  setContext(patch){if(!alive)return false;const next={...state.context,...patch};if(JSON.stringify(next)===JSON.stringify(state.context))return false;state.context=next;clearPrivate('idle');publish();return true},
  setGates(patch){if(!alive)return false;const wasPrivate=privateAllowed(state.gates),wasOnline=state.gates.online;state.gates={...state.gates,...patch};if(!privateAllowed(state.gates)){if(wasPrivate)clearPrivate('access')}else if(!wasPrivate){clearPrivate('idle')}else if(wasOnline&&!state.gates.online){retireRead();if(state.window)state.readState='stale'}publish();return true},
  requestRead(kind,n){if(!canRead(kind,n))return null;const ticket=freeze({id:++sequence,lifetime:state.lifetime,kind});const request=freeze(clone({kind,context:state.context,window:state.window,ticket}));active=ticket;state.busy=true;state.lastRead=null;if(!state.window)state.readState='loading';publish();if(!currentTicket(ticket))return null;Promise.resolve().then(()=>execute(ticket,request));return ticket},
  applySyntheticScenario(name){if(!alive||!SCENARIOS.some(s=>s[0]===name))return false;clearPrivate('idle');state.scenario=name;if(privateAllowed(state.gates)){if(['error','unavailable','authority'].includes(name))state.readState=name;else{state.window=fixture(name,state.context.identity);state.readState=name==='stale'?'stale':'ready'}}publish();return true},
  dispose(){if(!alive)return;alive=false;retireRead();registrations.clear();revision++}
 };return host;
}

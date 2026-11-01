/** Tasks-only presentation/route transactions. Never owns task data or operation state.
 * commitOwner MUST be called after React commit, not during speculative render. */
import {record,need} from './registry.mjs';
const keys=['tab','filter','page','day','month','taskId'];
/** @returns {import('./TasksComposition.types').TasksPresentationRoute} */
const initial=()=>({tab:'pending',filter:'near',page:0,day:null,month:null,taskId:null});
const locked=model=>['saving','unknown','conflict'].includes(model.operation.state);
function patchShape(patch){
 need(patch&&typeof patch==='object'&&!Array.isArray(patch),'TASKS_ROUTE_PATCH');
 const own=Reflect.ownKeys(patch);need(own.every(k=>keys.includes(k)),'TASKS_ROUTE_FIELD');
 for(const key of own){const d=Object.getOwnPropertyDescriptor(patch,key);need(Object.hasOwn(d,'value'),'TASKS_ROUTE_ACCESSOR');const value=d.value;
  if(key==='tab')need(['pending','completed'].includes(value),'TASKS_TAB');
  else if(key==='filter')need(['near','earlier','later','all','review','unconfirmed'].includes(value),'TASKS_FILTER');
  else if(key==='page')need(Number.isSafeInteger(value)&&value>=0&&value<=100000,'TASKS_PAGE');
  else if(key==='day')need(value===null||typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value),'TASKS_DAY');
  else if(key==='month')need(value===null||typeof value==='string'&&/^\d{4}-\d{2}$/.test(value),'TASKS_MONTH');
  else need(value===null||typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value),'TASKS_ID');
 }
}
export function serializeTasksRoute(route){record(route,keys);patchShape(route);return Object.fromEntries(keys.filter(k=>route[k]!==null).map(k=>[k,String(route[k])]));}
export function createTasksPresentation({schedule=queueMicrotask,publish=()=>{}}={}){
 let owner=null,epoch=0,revision=0,queued=null,pending=null,closed=false;
 /** @type {import('./TasksComposition.types').TasksPresentationSnapshot} */
 let state=Object.freeze({route:Object.freeze(initial()),query:'',revision});const listeners=new Set();
 const notify=()=>{for(const f of listeners)f();};
 const current=token=>!closed&&owner&&owner.mode==='operation'&&token===epoch&&owner.model.access!=='lost';
 const admissible=token=>current(token)&&!owner.model.reading&&!locked(owner.model);
 function emit(route,query,mode){patchShape(route);const changed=JSON.stringify(route)!==JSON.stringify(state.route)||query!==state.query;if(!changed)return;state=Object.freeze({route:Object.freeze({...route}),query,revision:++revision});epoch++;publish({pathname:'/tasks',params:serializeTasksRoute(route),mode,revision});notify();}
 function finish(intent){if(!admissible(intent.token))return;pending=null;emit(intent.route,intent.query,intent.mode);}
 function selectOrFinish(intent){if(intent.route.taskId&&owner.model.selected?.id!==intent.route.taskId){pending={...intent,phase:'select'};owner.actions.selectTask(intent.route.taskId,'open');}else finish(intent);}
 function accepted(intent){if(!admissible(intent.token))return;
  const model=owner.model;
  if(model.draft||model.selected&&model.selected.id!==intent.route.taskId){
   if(owner.actions.closePanel()===false)return;
   pending={...intent,phase:'close',original:model};return;
  }
  selectOrFinish(intent);
 }
 function flush(){const batch=queued;queued=null;if(!batch||!admissible(batch.token))return;
  const route={...state.route,...batch.patch};if(route.taskId&&!owner.model.items.some(t=>t.id===route.taskId))return;
  const intent={token:batch.token,route,query:batch.query??state.query,mode:batch.mode};
  owner.requestLeave(()=>accepted(intent));
 }
 function queue(token,patch,mode='replace',query){patchShape(patch);need(['push','replace'].includes(mode),'TASKS_ROUTE_MODE');if(query!==undefined)need(typeof query==='string'&&query.length<=4096,'TASKS_QUERY');if(!admissible(token)||pending)return false;
  if(!queued){queued={token,patch:{},mode,query:undefined,originSelected:owner.model.selected??null,originDraft:owner.model.draft??null,closeAcknowledged:false};schedule(flush);}if(queued.token!==token)return false;
  Object.assign(queued.patch,patch);if(mode==='push')queued.mode='push';if(query!==undefined)queued.query=query;return true;
 }
 return {
  /** @returns {import('./TasksComposition.types').TasksPresentationSnapshot} */
  getSnapshot:()=>state,
  authority:()=>epoch,isCurrent:token=>current(token),
  releaseOwner(){owner=null;epoch++;queued=null;pending=null;},
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  commitOwner(next){
   need(next&&typeof next.scopeKey==='string'&&typeof next.identityKey==='string'&&['operation','pick'].includes(next.mode),'TASKS_OWNER_IDENTITY');
   need(next.model&&Array.isArray(next.model.items)&&typeof next.actions?.closePanel==='function'&&typeof next.actions.selectTask==='function'&&typeof next.requestLeave==='function','TASKS_REAL_OWNER_PORT');
   const reattached=!owner&&epoch>0;
   const changed=owner&&(next.scopeKey!==owner.scopeKey||next.identityKey!==owner.identityKey),modeChanged=owner&&next.mode!==owner.mode;
   const previous=owner;
   owner=next;
   if(changed||modeChanged||reattached){epoch++;queued=null;pending=null;state=Object.freeze({route:changed?Object.freeze(initial()):state.route,query:changed?'':state.query,revision:++revision});notify();if(changed)return;}
   // An unrelated newer editor must not be consumed by a queued visual intent.
   if(queued&&next.model.draft&&next.model.draft!==queued.originDraft){
    epoch++;queued=null;pending=null;state=Object.freeze({...state,revision:++revision});notify();
   }
   if(pending){const intent=pending;if(!admissible(intent.token)){pending=null;return;}
    if(intent.phase==='close'){
     if(!next.model.draft&&!next.model.selected){selectOrFinish(intent);return;}
     if(next.model.draft&&next.model.draft!==intent.original.draft||next.model.selected&&next.model.selected!==intent.original.selected){pending=null;return;}
    }else if(next.model.selected?.id===intent.route.taskId)finish(intent);
    return;
   }
   // O/J/F may close their selected detail before setting query/page in one event.
   // Only acknowledge an ACTUAL committed close matching that batch's explicit
   // taskId:null intent. Defer its route publication into the existing batch;
   // don't advance the epoch and discard the accompanying user patch.
   const matchingClose=queued&&admissible(queued.token)&&Object.hasOwn(queued.patch,'taskId')&&queued.patch.taskId===null&&
    queued.originSelected!==null&&queued.originDraft===null&&next.model.selected===null&&next.model.draft===null&&
    state.route.taskId===queued.originSelected.id&&
    (queued.closeAcknowledged||previous?.model.selected===queued.originSelected);
   if(matchingClose){queued.closeAcknowledged=true;return;}
   // Published successful writes may select a new task: follow the one owner,
   // never issue a URL-authoritative close back into it.
   if(next.mode==='operation'&&!next.model.draft&&!locked(next.model)&&state.route.taskId!==(next.model.selected?.id??null))emit({...state.route,taskId:next.model.selected?.id??null},state.query,'replace');
  },
  /** @returns {import('./TasksComposition.types').TasksPresentationPorts} */
  bind(){const token=epoch;const value=(key,next)=>typeof next==='function'?next(queued&&Object.hasOwn(queued.patch,key)?queued.patch[key]:state.route[key]):next;
   const changeRoute=(patch,mode='replace')=>queue(token,patch,mode);
   return {
    changeRoute,changeView:(patch,mode='replace')=>changeRoute({taskId:null,...patch},mode),
    setQuery:query=>queue(token,{},'replace',query),
    setTab:(tab,filter='near')=>changeRoute({tab,filter,page:0,day:null,taskId:null}),
    setFilter:filter=>changeRoute({filter:value('filter',filter),taskId:null}),
    setPage:(page,clearSelection=true)=>changeRoute({page:value('page',page),...(clearSelection?{taskId:null}:{})}),
    setSelectedDay:day=>changeRoute({day:value('day',day),taskId:null}),
    setCalendarMonth:month=>changeRoute({month:value('month',month)}),
    taskHref:id=>{patchShape({taskId:id});return {pathname:'/tasks',params:serializeTasksRoute({...state.route,taskId:id})};},
    openHref(href){record(href,['pathname','params']);need(href.pathname==='/tasks','TASKS_ONLY_HREF');need(href.params&&typeof href.params==='object','TASKS_PARAMS');const patch={};for(const [key,value]of Object.entries(href.params)){need(keys.includes(key),'TASKS_QUERY_NOT_URL');patch[key]=key==='page'?Number(value):value;}return changeRoute(patch,'push');},
   };
  },
  dispose(){closed=true;epoch++;queued=null;pending=null;listeners.clear();},
 };
}

import {deriveWindow,validateInput,normalizeInitialFilters,selectionKey,sameSelection,normalizeQuery,localAdmission,readAdmission,occupied} from './model.mjs';
const copy=x=>structuredClone(x);
function copyInput(input){
 // Authorize before traversing nested foreign records, including during immutable cloning.
 const m=input?.model,r=m?.review;
 if(!Array.isArray(r?.items))return copy(input);
 const items=r.items.map(x=>x&&typeof x.childId==='string'&&(x.childId!==m.child?.id||r.state!=='ready'||m.access==='lost')?{childId:x.childId}:x);
 return copy({...input,model:{...m,review:{...r,items}}});
}
function freeze(x){if(x&&typeof x==='object'&&!Object.isFrozen(x)){for(const value of Object.values(x))freeze(value);Object.freeze(x);}return x;}
const refusal=reason=>({accepted:false,reason});
export function createHost({input,readPort,layout='a',initialFilters={}}){
 const initial=freeze(normalizeInitialFilters(initialFilters));
 const reset=mode=>({layout:mode,queryDraft:'',appliedQuery:'',status:initial.status,sourceKey:'all',olderOnly:initial.olderOnly,page:0,selected:null,metadataOpen:false});
 let lastExternalInput=input,controller=null,sequence=0,registrations=new Set();
 let context={...input.context,epoch:1};
 let state=freeze({revision:0,intent:0,readGeneration:0,context,input:copyInput({...input,context}),local:reset(layout==='b'?'b':'a'),retired:false,pending:null,readError:null});
 function reconcile(next){const w=deriveWindow(next);return {...next,local:{...next.local,page:w.page,selected:w.selected?next.local.selected:null,metadataOpen:!!w.selected&&next.local.metadataOpen}};}
 function signature(s){const w=deriveWindow(s);return JSON.stringify([s.context,w,s.local,s.input?.model?.online,s.input?.model?.operation,s.input?.model?.draft,s.input?.model?.deletion]);}
 function install(next,forceIntent=false){
  next=reconcile(next);
  const intent=state.intent+(forceIntent==='preserve'?0:forceIntent||signature(next)!==signature(state)?1:0);
  state=freeze({...next,revision:state.revision+1,intent});return state;
 }
 function notify(published){
  for(const registration of [...registrations]){
   if(state!==published)break;
   if(registrations.has(registration))registration.listener(published);
  }
 }
 function commit(next,forceIntent=false){const s=install(next,forceIntent);notify(s);return {accepted:true,revision:s.revision};}
 function check(i){return !state.retired&&i&&i.epoch===state.context.epoch&&i.intent===state.intent&&typeof i.controlId==='string'&&i.controlId.length>0&&sameSelection(i.selection,state.local.selected);}
 function admit(i,mode='local'){
  if(!check(i))return refusal('此操作的閱讀身份已失效');
  if(mode==='layout')return null;
  if(mode==='metadata')return deriveWindow(state).selected?null:refusal('沒有目前可讀的選取');
  if(mode==='edit'){
   const w=deriveWindow(state);
   if(!occupied(state)&&validateInput(state.input).ok&&state.input.model.access!=='lost'&&(localAdmission(state).allowed||w.state==='loading'&&state.input.model.review.state==='ready'&&state.input.model.list.hasSnapshot&&(!state.pending||state.input.model.list.page===1)))return null;
   return refusal('目前不能編輯本地搜尋');
  }
  const a=mode==='read'?readAdmission(state):localAdmission(state);return a.allowed?null:refusal(a.reason);
 }
 const update=(patch,force=false)=>commit({...state,local:{...state.local,...patch}},force);
 const retireSelection={page:0,selected:null,metadataOpen:false};
 function current(t){return !state.retired&&state.pending===t&&state.context.epoch===t.epoch&&state.readGeneration===t.readGeneration;}
 function settle(t,reply,transportError=false){
  if(!current(t))return;
  controller=null;
  if(transportError){commit({...state,pending:null,readError:'未能重讀合成來源，原操作狀態不變。'});return;}
  const live=state.input.model,model=reply?.model;
  const policy=Object.fromEntries(['online','operation','draft','deletion'].map(k=>[k,live[k]]));
  const candidate=model?{context:state.context,model:{...model,...policy}}:null;
  const valid=candidate&&validateInput(candidate).ok&&model.scopeKey===state.context.scopeKey&&model.child.id===state.context.childId&&model.list.activeQuery===t.ownerQuery&&model.list.activeKind===t.ownerKind&&model.list.page===1&&model.list.hasPrevious===false;
  if(valid){commit({...state,input:copyInput(candidate),pending:null,readError:null});return;}
  // Contract failure discards source content, never the independent live policy.
  const unavailable={...live,...policy,review:{...live.review,state:'unavailable',items:[],hasMore:false,label:'來源不適用'},list:{...live.list,state:'error',records:[],hasSnapshot:false,activeQuery:t.ownerQuery,activeKind:t.ownerKind,page:1,hasPrevious:false,hasMore:false,scanned:0,message:'來源身份或窗口不符'}};
  commit({...state,input:copy({context:state.context,model:unavailable}),pending:null,readError:'來源身份、版本或第一頁窗口不符。'});
 }
 const actions={
  editQuery(value,i){const no=admit(i,'edit');if(no)return no;if(typeof value!=='string'||value.length>200)return refusal('搜尋最多 200 字元');if(value===state.local.queryDraft)return {accepted:true,revision:state.revision};
   // Draft edits deliberately preserve the current presentation intent.
   const next=reconcile({...state,local:{...state.local,queryDraft:value}}),s=freeze({...next,revision:state.revision+1});state=s;notify(s);return {accepted:true,revision:s.revision};},
  applyQuery(i){const no=admit(i);if(no)return no;const changed=normalizeQuery(state.local.queryDraft)!==normalizeQuery(state.local.appliedQuery);return update({appliedQuery:state.local.queryDraft,...(changed?retireSelection:{})},changed?true:'preserve');},
  setStatus(value,i){const no=admit(i);if(no)return no;if(!['all','written','important_pending','pending','confirmed','skipped','not_required'].includes(value))return refusal('不支援此篩選');return value===state.local.status?{accepted:true,revision:state.revision}:update({status:value,...retireSelection},true);},
  setSource(key,i){const no=admit(i);if(no)return no;if(typeof key!=='string'||!key)return refusal('來源項目不適用');return key===state.local.sourceKey?{accepted:true,revision:state.revision}:update({sourceKey:key,...retireSelection},true);},
  clearFilters(i){const no=admit(i);if(no)return no;return update({queryDraft:'',appliedQuery:'',status:'all',sourceKey:'all',...retireSelection},true);},
  setPage(page,i){const no=admit(i);if(no)return no;const w=deriveWindow(state);if(!Number.isInteger(page)||page<0||page>=w.pageCount)return refusal('只可選擇目前已載頁面');return page===state.local.page?{accepted:true,revision:state.revision}:update({page,selected:null,metadataOpen:false},true);},
  select(key,i){const no=admit(i);if(no)return no;if(!deriveWindow(state).pageItems.some(x=>sameSelection(selectionKey(x),key)))return refusal('這筆記錄不在當前可讀頁面');return sameSelection(key,state.local.selected)?{accepted:true,revision:state.revision}:update({selected:copy(key),metadataOpen:false},true);},
  close(i){const no=admit(i);if(no)return no;return update({selected:null,metadataOpen:false},true);},
  step(delta,i){const no=admit(i);if(no)return no;if(delta!==-1&&delta!==1)return refusal('方向不適用');const w=deriveWindow(state),index=w.pageItems.findIndex(x=>sameSelection(selectionKey(x),state.local.selected)),target=w.pageItems[index+delta];if(index<0||!target)return refusal('已到本頁邊界，不會自動翻頁');return update({selected:selectionKey(target),metadataOpen:false},true);},
  setLayout(mode,i){const no=admit(i,'layout');if(no)return no;if(mode!=='a'&&mode!=='b')return refusal('版面不適用');return mode===state.local.layout?{accepted:true,revision:state.revision}:update({layout:mode},true);},
  toggleMetadata(i){const no=admit(i,'metadata');if(no)return no;return update({metadataOpen:!state.local.metadataOpen},true);},
  reread(i){const no=admit(i,'read');if(no)return no;if(typeof readPort!=='function')return refusal('未提供合成重讀接口');
   const l=state.input.model.list,t=freeze({id:++sequence,epoch:state.context.epoch,readGeneration:state.readGeneration+1,ownerQuery:l.activeQuery,ownerKind:l.activeKind,ownerPage:1}),c=new AbortController();controller=c;
   const result=commit({...state,pending:t,readGeneration:t.readGeneration,readError:null},true);
   if(current(t)){
    try{Promise.resolve(readPort(t,c.signal)).then(reply=>settle(t,reply),()=>settle(t,null,true));}
    catch{settle(t,null,true);}
   }
   return {...result,ticket:t};
  }
 };
 const control={
  replaceInput(next){
   if(state.retired||next===lastExternalInput)return;
   const oldController=controller;controller=null;lastExternalInput=next;
   const hard=['scopeKey','childId','authorityKey'].some(k=>next?.context?.[k]!==state.context[k]);
   context={...next?.context,epoch:state.context.epoch+(hard?1:0)};
   const s=install({...state,context,input:copyInput({...next,context}),local:hard?reset(state.local.layout):state.local,pending:null,readError:null,readGeneration:state.readGeneration+1},hard);
   oldController?.abort(); // State is authoritative before this reentrant boundary.
   if(state===s)notify(s);
  },
  setPolicy(patch){if(state.retired||!state.input)return;const p=Object.fromEntries(['online','operation','draft','deletion'].filter(k=>Object.hasOwn(patch,k)).map(k=>[k,copy(patch[k])]));if(Object.hasOwn(p,'online')&&typeof p.online!=='boolean')return;commit({...state,input:{...state.input,model:{...state.input.model,...p}}});}
 };
 return {getSnapshot:()=>state,actions,control,subscribe(listener){const registration={listener};if(!state.retired)registrations.add(registration);return()=>registrations.delete(registration);},dispose(){
  if(state.retired)return;const old=controller;controller=null;lastExternalInput=null;readPort=null;
  const s=install({...state,context:{...state.context,epoch:state.context.epoch+1},input:null,local:reset(state.local.layout),pending:null,readError:null,readGeneration:state.readGeneration+1,retired:true},true);
  old?.abort();if(state===s)notify(s);registrations.clear();
 }};
}

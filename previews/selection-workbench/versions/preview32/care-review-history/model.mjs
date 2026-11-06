import {authorizedCareCaptureReview,careReviewChronological,careReviewWindow,careReviewSourceKey,careReviewMatchesQuery,careReviewPrioritize,careReviewPage,careReviewPageSlots,careReviewIsImportantPending} from './source-helpers.mjs';
/**
 * Synthetic read-only boundary. Original strings/numbers are never repaired.
 * @typedef {{scopeKey:string,childId:string,authorityKey:string,epoch:number}} Context
 * @typedef {{id:string,version:number,sourceVersion:string,recordId:string,recordVersion:number}} SelectionKey
 * @typedef {{context:Context,model:object}} Input
 * @typedef {{layout:'a'|'b',queryDraft:string,appliedQuery:string,status:string,sourceKey:string,olderOnly:boolean,page:number,selected:SelectionKey|null,metadataOpen:boolean}} LocalState
 * @typedef {{id:number,epoch:number,readGeneration:number,ownerQuery:string,ownerKind:string,ownerPage:1}} Ticket
 * @typedef {{revision:number,intent:number,readGeneration:number,context:Context,input:Input|null,local:LocalState,retired:boolean,pending:Ticket|null,readError:string|null}} Snapshot
 * @typedef {{accepted:false,reason:string}|{accepted:true,revision:number,ticket?:Ticket}} Admission
 * @typedef {{epoch:number,intent:number,controlId:string,selection:SelectionKey|null}} Intent
 * @typedef {(request:Ticket,signal:AbortSignal)=>Promise<{model:object}>} ReadPort
 * @typedef {{editQuery:(value:string,i:Intent)=>Admission,applyQuery:(i:Intent)=>Admission,setStatus:(value:string,i:Intent)=>Admission,setSource:(key:string,i:Intent)=>Admission,clearFilters:(i:Intent)=>Admission,setPage:(page:number,i:Intent)=>Admission,select:(key:SelectionKey,i:Intent)=>Admission,close:(i:Intent)=>Admission,step:(delta:number,i:Intent)=>Admission,setLayout:(mode:'a'|'b',i:Intent)=>Admission,toggleMetadata:(i:Intent)=>Admission,reread:(i:Intent)=>Admission}} Actions
 * @typedef {{replaceInput:(input:Input)=>void,setPolicy:(patch:{online?:boolean,operation?:object,draft?:object|null,deletion?:object|null})=>void}} Control
 * @typedef {{getSnapshot:()=>Snapshot,subscribe:(listener:(s:Snapshot)=>void)=>()=>void,actions:Actions,control:Control,dispose:()=>void}} Host
 * @typedef {{state:string,reason:string|null,loadedCount:number,olderWindowCount:number,matchingCount:number,page:number,pageCount:number,pageItems:object[],selected:object|null,sourceOptions:object[],slots:Array<number|string>,hasMore:boolean}} Window
 */
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const str=x=>typeof x==='string';
const positive=x=>Number.isInteger(x)&&x>0;
const kinds=['note','feeding','sleep','diaper','temperature','measurement','appointment'];
const values=v=>obj(v)&&kinds.includes(v.kind)&&['text','source','quantityRaw','quantityUnit','eventTimeRaw','reason'].every(k=>str(v[k]))&&['exact','approximate'].includes(v.quantityPrecision);
function saved(item,childId){
 const r=item.savedRecord,c=r?.current;
 return obj(r)&&obj(c)&&r.childId===childId&&item.id===`record:${r.id}`&&str(r.id)&&r.id.length>0&&item.sourceId===r.id&&item.resolution?.recordId===r.id&&positive(item.version)&&item.version===c.version&&item.version===item.resolution?.recordVersion&&item.sourceVersion===String(c.version)
 &&item.writeState==='saved'&&item.reviewRequirement==='optional'&&['confirmed','not_required'].includes(item.reviewState)&&item.targetDomain==='care_event'&&item.target?.kind==='create'&&item.target.scope==='family'&&item.sourceScope==='family'&&item.sourceState==='ready'
 &&['title','createdAtLabel','originalText','sourceLabel','sourceId','sourceVersion'].every(k=>str(item[k]))&&str(item.resolution.label)&&Array.isArray(item.uncertainties)&&item.uncertainties.every(str)&&values(item.proposedValues)&&values(c.values)&&['exact','approximate','unknown'].includes(c.eventTimePrecision)&&['timeZoneLabel','confirmedByLabel','confirmedAtLabel'].every(k=>str(c[k]))&&str(r.title)&&str(r.createdAtLabel)&&Array.isArray(r.history);
}
export function validateInput(input){
 const fail=reason=>({ok:false,reason}),c=input?.context,m=input?.model,r=m?.review,l=m?.list;
 if(!obj(c)||!['scopeKey','childId','authorityKey'].every(k=>str(c[k])&&c[k])||!obj(m)||!obj(m.child)||!obj(r)||!obj(l)||!obj(m.operation))return fail('來源結構不適用');
 if(c.scopeKey!==m.scopeKey||r.scopeKey!==c.scopeKey||m.child.id!==c.childId)return fail('來源作用域不符');
 if(!['editable','read_only','lost'].includes(m.access)||typeof m.online!=='boolean'||!['ready','loading','error','unavailable'].includes(r.state)||!Array.isArray(r.items)||r.items.some(x=>!obj(x)||!str(x.childId)))return fail('來源狀態不適用');
 if(!['create','update','skip','confirmImportant'].every(k=>r.capabilities?.[k]===false))return fail('此候選不支援寫入能力');
 if(!['ready','loading','loading_more','error','stale'].includes(l.state)||!str(l.activeQuery)||!['all',...kinds].includes(l.activeKind)||!Array.isArray(l.records)||typeof r.hasMore!=='boolean')return fail('來源窗口不適用');
 const kept=authorizedCareCaptureReview(m).items;
 if(kept.some(x=>!saved(x,c.childId))||new Set(kept.map(x=>x.id)).size!==kept.length)return fail('已保存記錄身份或版本不符');
 return {ok:true,reason:null};
}
export function normalizeInitialFilters(value={}){
 const candidate=Array.isArray(value?.status)?value.status[0]:value?.status;
 return {status:['pending','written','confirmed','skipped'].includes(candidate)?candidate:'all',olderOnly:value?.olderOnly===true};
}
export function selectionKey(x){return {id:x.id,version:x.version,sourceVersion:x.sourceVersion,recordId:x.savedRecord.id,recordVersion:x.savedRecord.current.version};}
export function sameSelection(a,b){return a===b||!!a&&!!b&&['id','version','sourceVersion','recordId','recordVersion'].every(k=>a[k]===b[k]);}
export const normalizeQuery=q=>q.trim().toLocaleLowerCase('zh-HK');
function sourceState(s){
 if(s.retired||!s.input)return {state:'unavailable',reason:'閱讀窗口已結束',items:[],hasMore:false};
 const v=validateInput(s.input),m=s.input.model;
 if(!v.ok)return {state:'unavailable',reason:v.reason,items:[],hasMore:false};
 if(m.access==='lost')return {state:'unavailable',reason:'目前沒有此孩子的閱讀權限',items:[],hasMore:false};
 const r=authorizedCareCaptureReview(m),base={state:r.state,reason:null,items:[],hasMore:r.hasMore};
 if(r.state!=='ready')return {...base,reason:r.state==='loading'?'正在讀取來源':'來源暫不可用'};
 const l=m.list,busy=['loading','loading_more'].includes(l.state);
 if(l.state==='error')return {...base,state:'error',reason:'來源讀取失敗'};
 if(busy&&!l.hasSnapshot)return {...base,state:'loading',reason:'正在讀取來源'};
 if((l.state==='stale'||!m.online)&&!l.hasSnapshot)return {...base,state:'unavailable',reason:'沒有可閱讀的來源快照'};
 let state=busy?'loading':l.state==='stale'||!m.online?'stale':'ready',reason=state==='loading'?'正在更新，保留同窗口內容':state==='stale'?'未能更新，以下是已載快照':null;
 if(s.pending||s.readError){
  const t=s.pending,trust=l.hasSnapshot===true&&l.page===1&&(!t||l.activeQuery===t.ownerQuery&&l.activeKind===t.ownerKind);
  if(!trust)return {...base,state:s.pending?'loading':'error',reason:s.pending?'正在重讀來源第一頁':'未能讀取來源第一頁'};
  state=s.pending?'loading':'stale';reason=s.pending?'正在重讀合成窗口':s.readError;
 }
 return {...base,state,reason,items:r.items};
}
export function deriveWindow(s,compact=false){
 const base=sourceState(s),all=careReviewChronological(base.items),older=careReviewWindow(all).older;
 const items=s.local.olderOnly?older:all;
 const sourceOptions=items.map(x=>({key:careReviewSourceKey(x),label:`${x.title} · ${x.sourceId} · v${x.sourceVersion}`})).filter((x,i,a)=>a.findIndex(y=>y.key===x.key)===i);
 const filtered=careReviewPrioritize(items.filter(x=>(s.local.status==='all'||s.local.status==='written'&&x.writeState==='saved'||s.local.status==='important_pending'&&careReviewIsImportantPending(x)||x.reviewState===s.local.status)&&(s.local.sourceKey==='all'||careReviewSourceKey(x)===s.local.sourceKey)&&careReviewMatchesQuery(x,s.local.appliedQuery)));
 const p=careReviewPage(filtered,s.local.page),pageCount=Math.ceil(filtered.length/10);
 return {state:base.state,reason:base.reason,loadedCount:all.length,olderWindowCount:older.length,matchingCount:filtered.length,page:p.page,pageCount,pageItems:p.items,selected:p.items.find(x=>sameSelection(selectionKey(x),s.local.selected))??null,sourceOptions,slots:careReviewPageSlots(p.page,pageCount,compact),hasMore:base.hasMore};
}
export function occupied(s){const m=s.input?.model;return !!m&&(['saving','unknown','conflict'].includes(m.operation?.state)||!!m.draft||!!m.deletion);}
export function localAdmission(s){const w=deriveWindow(s);return s.retired||occupied(s)||!['ready','stale'].includes(w.state)?{allowed:false,reason:occupied(s)?'原操作或編輯尚未結束':'目前不能改變閱讀內容'}:{allowed:true,reason:null};}
export function readAdmission(s){
 const m=s.input?.model,v=validateInput(s.input);
 if(s.retired||!v.ok||m?.access==='lost'||!m.online||occupied(s)||s.pending||['loading','loading_more'].includes(m.list.state)||m.review.state==='loading')return {allowed:false,reason:'目前不能重讀'};
 return {allowed:true,reason:null};
}

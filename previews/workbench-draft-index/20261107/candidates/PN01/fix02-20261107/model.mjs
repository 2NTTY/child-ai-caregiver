export function createState({scopeKey='synthetic-owner-a',scenario='normal'}={}){
 return {scopeKey,scenario,epoch:0,online:true,busy:null,writesBlocked:false,policyState:'ready',externalPending:null,notesState:'idle',notes:[],queryDraft:'',query:'',nextAfterId:null,loadedRange:null,selectedId:null,deleteSelection:null,pending:null,request:null,notice:'請讀取合成私人備註。',syntheticSequence:0,fixtureVersions:{},writeAttempt:null};
}
export function mayRead(s,more=false){return !!s.scopeKey&&s.online&&!s.busy&&s.policyState!=='denied'&&s.externalPending!=='policy'&&(!more||(s.notesState==='ready'&&!!s.nextAfterId&&!s.pending));}
const merge=(old,items)=>{const ids=new Set(items.map(n=>n.id));return [...old.filter(n=>!ids.has(n.id)),...items];};
function fail(s){const r=s.request;return {...s,busy:null,request:null,notesState:'failed',notes:r.preserve?s.notes:[],nextAfterId:r.preserve?s.nextAfterId:null,loadedRange:r.preserve?s.loadedRange:null,notice:r.preserve?'未能重新核對；保留舊合成內容，刪除已停用。':'合成讀取失敗，不能刪除。'};}
function reduce(s,e){
 switch(e.type){
 case 'QUERY_DRAFT':return s.busy||s.pending||s.externalPending?s:{...s,queryDraft:String(e.value).slice(0,200)};
 case 'READ_START':{
  if(!mayRead(s,!!e.more))return s;
  const query=s.pending?'':e.more||e.keepQuery?s.query:s.queryDraft.trim();
  const preserve=!!s.loadedRange&&!s.pending&&query===s.query&&((s.notesState==='ready'&&(e.more||e.keepQuery))||s.notesState==='failed');
  const id=s.syntheticSequence+1;
  return {...s,syntheticSequence:id,busy:'read',notesState:preserve?s.notesState:'loading',notes:preserve||e.more?s.notes:[],nextAfterId:preserve?s.nextAfterId:null,pending:s.pending?{...s.pending,reviewed:false}:null,request:{id,epoch:s.epoch,scopeKey:s.scopeKey,query,after:e.more?s.nextAfterId:null,more:!!e.more,preserve:!!preserve,range:preserve&&!e.more?s.loadedRange:null,items:[]},notice:'正在讀取預定合成回應。'};
 }
 case 'READ_FAIL':return s.request?.id===e.requestId?fail(s):s;
 case 'READ_RESULT':{
  const r=s.request,p=e.page;if(!r||r.id!==e.requestId||r.epoch!==s.epoch||r.scopeKey!==s.scopeKey)return s;
  if(!s.online||p.unsupported||!Array.isArray(p.items)||p.items.length>20||(p.nextAfterId!==null&&r.after!==null&&p.nextAfterId<=r.after)||new Set(p.items.map(n=>n.id)).size!==p.items.length)return fail(s);
  const items=merge(r.items,p.items);
  if(p.nextAfterId&&r.range&&(r.range.afterId===null||p.nextAfterId<r.range.afterId))return {...s,syntheticSequence:s.syntheticSequence+1,request:{...r,id:s.syntheticSequence+1,after:p.nextAfterId,items}};
  return {...s,busy:null,request:null,notesState:'ready',notes:merge(r.more?s.notes:[],items),query:r.query,nextAfterId:p.nextAfterId,loadedRange:{afterId:p.nextAfterId},pending:s.pending?(s.pending.reconfirm?null:{...s.pending,reviewed:true,reviewId:r.id}):null,notice:s.pending?'已讀取合成回應；清單缺項不代表原刪除成功。':'已載入合成回應；不是正式資料。'};
 }
 case 'SELECT':return s.notes.some(n=>n.id===e.id)?{...s,selectedId:e.id}:s;
 case 'BACK':return {...s,selectedId:null};
 case 'DELETE_OPEN':{if(!mayDelete(s,e.id))return s;const n=s.notes.find(n=>n.id===e.id);return {...s,syntheticSequence:s.syntheticSequence+1,deleteSelection:{scopeKey:s.scopeKey,epoch:s.epoch,token:s.syntheticSequence+1,id:n.id,version:n.version}};}
 case 'DELETE_CANCEL':return {...s,deleteSelection:null};
 case 'DELETE_CONFIRM':{
  const d=s.deleteSelection,n=s.notes.find(n=>n.id===d?.id);
  if(!d||!e.selection||['scopeKey','epoch','token','id','version'].some(k=>e.selection[k]!==d[k]))return s;
  if(d.scopeKey!==s.scopeKey||!n||n.version!==d.version||!mayDelete(s,n.id)||!e.operationId)return {...s,deleteSelection:null};
  const pending={kind:'delete',note:{...n},input:{scopeKey:s.scopeKey,noteId:n.id,expectedVersion:n.version,operationId:e.operationId,confirmDelete:true},reviewed:false,reconfirm:false};
  return {...s,syntheticSequence:s.syntheticSequence+1,writeAttempt:s.syntheticSequence+1,deleteSelection:null,pending,busy:'write',writeEpoch:s.epoch,notice:'合成操作等待你選擇結果；沒有傳送任何請求。'};
 }
 case 'DELETE_RESULT':{
  const p=s.pending;if(s.busy!=='write'||!p||e.attemptId!==s.writeAttempt||s.writeEpoch!==s.epoch||p.input.scopeKey!==s.scopeKey||e.operationId!==p.input.operationId)return s;
  if(e.outcome==='confirmed')return {...s,busy:null,pending:null,notes:s.notes.filter(n=>n.id!==p.note.id),notice:'合成刪除已確認；真實備註沒有更改。'};
  if(!['unknown','false','not_found','conflict'].includes(e.outcome))return s;
  return {...s,busy:null,fixtureVersions:e.outcome==='conflict'?{...s.fixtureVersions,[p.note.id]:p.note.version+1}:s.fixtureVersions,notes:['false','not_found'].includes(e.outcome)?s.notes.filter(n=>n.id!==p.note.id):s.notes,pending:{...p,reviewed:false,reconfirm:e.outcome==='conflict'},notice:e.outcome==='conflict'?'合成版本衝突：原操作被拒，先讀取再按新版本明確確認。':'合成刪除結果未確認；缺項不代表成功，請先核對原操作。'};
 }
 case 'RETRY_ORIGINAL':return mayRetry(s)&&e.operationId===s.pending.input.operationId&&e.scopeKey===s.scopeKey&&e.epoch===s.epoch&&e.reviewId===s.pending.reviewId?{...s,syntheticSequence:s.syntheticSequence+1,writeAttempt:s.syntheticSequence+1,busy:'write',writeEpoch:s.epoch,notice:'明確重試相同合成原操作；等待選擇合成結果。'}:s;
 case 'SCOPE_CHANGE':return {...createState({scopeKey:e.scopeKey}),epoch:s.epoch+1,syntheticSequence:s.syntheticSequence,online:s.online,writesBlocked:s.writesBlocked,externalPending:s.externalPending};
 case 'SET_EXTERNAL_LOCK':if(e.policyState==='denied')return {...createState({scopeKey:s.scopeKey}),epoch:s.epoch+1,syntheticSequence:s.syntheticSequence,online:s.online,policyState:'denied',notesState:'denied',writesBlocked:!!e.writesBlocked,externalPending:e.externalPending??null,notice:'合成存取已拒絕；私人讀取、原操作與選擇已清除。'};return {...s,writesBlocked:!!e.writesBlocked,externalPending:e.externalPending??null,policyState:e.policyState??s.policyState};
 case 'SET_ONLINE':{const next={...s,online:!!e.online};return !e.online&&s.request?fail(next):!e.online&&s.busy==='write'?{...next,busy:null,pending:next.pending?{...next.pending,reviewed:false}:null,notice:'合成操作中斷，原結果未知；重新連線不會自動重試。'}:next;}
 case 'RESET_SCENARIO':return {...createState({scopeKey:s.scopeKey}),epoch:s.epoch+1,syntheticSequence:s.syntheticSequence};
 default:return s;
 }
}

export function mayDelete(s,id){return !!s.scopeKey&&s.online&&s.policyState!=='denied'&&s.notesState==='ready'&&!s.busy&&!s.pending&&!s.externalPending&&!s.writesBlocked&&s.notes.some(n=>n.id===id);}
export function mayRetry(s){return !!s.pending?.reviewed&&!s.pending.reconfirm&&s.pending.input.scopeKey===s.scopeKey&&s.online&&!s.busy&&!s.writesBlocked&&!s.externalPending&&s.policyState!=='denied';}
export function transition(s,e){const n=reduce(s,e);if(n===s)return s;const d=n.deleteSelection;return {...n,selectedId:n.notes.some(x=>x.id===n.selectedId)?n.selectedId:null,deleteSelection:d&&d.scopeKey===n.scopeKey&&n.notes.some(x=>x.id===d.id&&x.version===d.version)?d:null};}

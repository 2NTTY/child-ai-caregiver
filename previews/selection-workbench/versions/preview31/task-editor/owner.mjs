const MODES=['create','reschedule','complete','cancel','resolve'];
const FIELDS={create:['title','details','kind','assigneeUserId','dueAt','timeZone'],reschedule:['assigneeUserId','dueAt','timeZone','note'],complete:['note'],cancel:['note'],resolve:['outcome','note']};
export const labels={create:'新增事項',reschedule:'改期／轉派',complete:'回報已完成',cancel:'取消事項',resolve:'核對完成或取消'};
export const stateLabels={scheduled:'待處理',completed:'已完成',cancelled:'已取消',needs_review:'待覆核 · 已停催'};
const copy=x=>structuredClone(x);
function frozen(x){if(x&&typeof x==='object'){Object.freeze(x);for(const v of Object.values(x))frozen(v);}return x;}
function empty(){return {title:'',details:'',kind:'ordinary',assigneeUserId:'',dueAt:'',timeZone:'Asia/Hong_Kong',note:'',outcome:''};}
export function allowed(task,mode){return mode==='create'||(mode==='resolve'?task?.occurrence.state==='needs_review':['reschedule','complete','cancel'].includes(mode)&&task?.occurrence.state==='scheduled');}
export function fieldsFor(mode){return [...(FIELDS[mode]??[])];}
function validInstant(value){
 if(typeof value!=='string')return false;
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(!m)return false;
 const [y,mo,d,h,mi,s]=m.slice(1,7).map(x=>Number(x??0));
 const calendar=new Date(Date.UTC(y,mo-1,d));
 if(calendar.getUTCFullYear()!==y||calendar.getUTCMonth()!==mo-1||calendar.getUTCDate()!==d||h>23||mi>59||s>59)return false;
 const offset=m[7];if(offset!=='Z'&&(Number(offset.slice(1,3))>23||Number(offset.slice(4))>59))return false;
 const at=Date.parse(value);return Number.isFinite(at)&&at>=Date.UTC(2000,0,1)&&at<Date.UTC(2101,0,1);
}
export function validValues(mode,v,assignees){
 const errors={};if(!MODES.includes(mode))return {valid:false,errors:{mode:'不支援這項操作。'}};
 for(const name of Object.keys(empty()))if(typeof v?.[name]!=='string')errors[name]='請提供文字內容。';
 if(Object.keys(errors).length)return {valid:false,errors};
 if(!['ordinary','appointment'].includes(v.kind))errors.kind='請選擇普通任務或預約。';
 if(!['','completed','cancelled'].includes(v.outcome))errors.outcome='請明確選擇終態。';
 if(mode==='create'){
  if(!v.title.trim()||v.title.length>160)errors.title='請填寫標題，最多 160 字。';
  if(v.details.length>2000)errors.details='詳細內容最多 2,000 字。';
 }
 if(mode==='create'||mode==='reschedule'){
  if(!assignees.includes(v.assigneeUserId))errors.assigneeUserId='請選擇目前合資格的成員。';
  if(!validInstant(v.dueAt))errors.dueAt='請填寫 2000 至 2100 年、含明確時差的有效 ISO 日期時間。';
  try{if(v.timeZone.length>100||!v.timeZone)throw Error();new Intl.DateTimeFormat('en',{timeZone:v.timeZone}).format();}catch{errors.timeZone='請選擇有效時區。';}
 }
 if(v.note.length>1000)errors.note='原因／備註最多 1,000 字。';
 if(['reschedule','cancel','resolve'].includes(mode)&&!v.note.trim())errors.note='請填寫原因。';
 if(mode==='resolve'&&!['completed','cancelled'].includes(v.outcome))errors.outcome='請明確選擇已完成或已取消。';
 return {valid:Object.keys(errors).length===0,errors};
}
export function displayTime(instant,timeZone){try{return new Intl.DateTimeFormat('zh-HK',{timeZone,dateStyle:'medium',timeStyle:'short',hour12:false}).format(new Date(instant));}catch{return '時間待核對';}}
export function makeFixture(scope='demo-a',scenario='normal'){
 return {id:`${scope}-task`,childId:scope,version:1,title:'合成戶外準備',details:'帶水、帽及替換衣物。這是合成示例。',kind:'ordinary',assigneeUserId:'demo-owner',createdBy:'demo-owner',createdAt:'2026-11-01T02:00:00Z',updatedAt:'2026-11-01T02:00:00Z',occurrence:{id:`${scope}-occurrence`,dueAt:'2026-11-07T10:00:00+08:00',timeZone:'Asia/Hong_Kong',state:scenario==='review'?'needs_review':scenario==='terminal'?'completed':'scheduled',terminalBasisVersion:scenario==='terminal'?1:null}};
}
export function createEditorOwner({scope='demo-a',scenario='normal',access='editable'}={}){
 let epoch=1,serial=0,revision=0,token={},pending=null,queuedLatest=null,leaveIntent=null,receiptConfirmed=false;
 const listeners=new Set(),compositionLeases=new Map();
 let state={scope,epoch,scenario,access,online:true,reading:false,panelOpen:access!=='lost',task:access==='lost'?null:makeFixture(scope,scenario),draft:null,latest:null,operation:{state:'none',message:''},command:null,submissions:[],receiptLookups:0,reminder:scenario==='worker-unknown'?'unknown':scenario==='review'||scenario==='terminal'?'stopped':'none'};
 const locked=()=>state.reading||['saving','unknown','conflict'].includes(state.operation.state);
 const pendingWrite=()=>['saving','unknown'].includes(state.operation.state);
 const result=status=>({status,revision,epoch});
 function emit(){state.epoch=epoch;revision++;const accepted=result('accepted');for(const fn of [...listeners])fn();return accepted;}
 const readable=()=>state.access!=='lost';
 const canEdit=key=>readable()&&state.access==='editable'&&!locked()&&state.draft?.key===key;
 const validate=()=>validValues(state.draft.mode,state.draft.values,['demo-owner','demo-carer']);
 function syncComposing(){if(state.draft)state.draft.composingFields=[...new Set(compositionLeases.values())];}
 function clearPanel(){compositionLeases.clear();pending=null;queuedLatest=null;leaveIntent=null;receiptConfirmed=false;state.draft=null;state.latest=null;state.command=null;state.panelOpen=false;state.operation={state:'none',message:''};}
 function replace(nextScope=state.scope,nextScenario='normal'){
  token={};epoch++;clearPanel();state.scope=nextScope;state.scenario=nextScenario;state.task=state.access==='lost'?null:makeFixture(nextScope,nextScenario);state.panelOpen=state.access!=='lost';state.reading=false;state.reminder=nextScenario==='worker-unknown'?'unknown':nextScenario==='review'||nextScenario==='terminal'?'stopped':'none';state.submissions=[];state.receiptLookups=0;return emit();
 }
 function apply(command){
  const at='2026-11-05T12:00:00Z';let task;
  if(command.kind==='create'){
   const v=command.input.values,id=`${state.scope}-new-${++serial}`;
   task={...makeFixture(state.scope),...v,id,version:1,createdAt:at,updatedAt:at,occurrence:{id:`${id}-occurrence`,dueAt:v.dueAt,timeZone:v.timeZone,state:'scheduled',terminalBasisVersion:null}};
   delete task.dueAt;delete task.timeZone;
  }else{
   task=copy(state.draft.basis);const input=command.input;task.version++;task.updatedAt=at;
   if(input.action==='reschedule'){task.assigneeUserId=input.assigneeUserId;task.occurrence.dueAt=input.dueAt;task.occurrence.timeZone=input.timeZone;}
   else{task.occurrence.state=input.action==='resolve'?input.outcome:input.action==='complete'?'completed':'cancelled';task.occurrence.terminalBasisVersion=input.expectedVersion;}
  }
  compositionLeases.clear();state.task=task;state.draft=null;state.latest=null;state.command=null;pending=null;queuedLatest=null;leaveIntent=null;state.panelOpen=true;
  state.reminder=['completed','cancelled','needs_review'].includes(task.occurrence.state)?'stopped':'none';
  state.operation={state:'saved',message:'合成 owner 已確認這次操作。沒有傳送通知或真實資料。',reference:command.reference};
 }
 function deliver(outcome,supplied=state.command){
  if(state.operation.state!=='saving'||!pending||!supplied||supplied.reference!==pending.reference||supplied.epoch!==epoch||!readable())return result('rejected');
  if(!['success','unknown','conflict','terminal-conflict','unavailable'].includes(outcome))return result('rejected');
  if(outcome==='success')apply(pending);
  else if(outcome==='unknown'||outcome==='unavailable')state.operation={state:'unknown',message:outcome==='unknown'?'合成回覆中斷；保存結果尚未確認。先查核原操作。':'合成收據已確認提交，但內容暫不可顯示。不可再送一次。',reference:pending.reference,recovery:outcome==='unknown'?'check':'reload',committed:outcome==='unavailable',checked:false};
  else if(pending.kind==='change'){
   queuedLatest=copy(state.task);queuedLatest.version++;queuedLatest.occurrence.dueAt='2026-11-08T10:00:00+08:00';
   if(outcome==='terminal-conflict')queuedLatest.occurrence.state='completed';
   pending=null;state.command=null;state.latest=null;state.operation={state:'conflict',recovery:'reload',message:'版本已改變，原操作沒有保存。請重讀再明確選擇基準。'};
  }else return result('rejected');
  return emit();
 }
 function bind(){
  const bound=token,current=()=>bound===token&&readable();
  const reject=()=>result('rejected');
  return Object.freeze({
   current,
   start(mode){
    if(!current()||state.access!=='editable'||!state.online||locked()||state.draft||!MODES.includes(mode)||!allowed(state.task,mode))return reject();
    const values=mode==='create'?empty():{...empty(),title:state.task.title,details:state.task.details,kind:state.task.kind,assigneeUserId:state.task.assigneeUserId,dueAt:state.task.occurrence.dueAt,timeZone:state.task.occurrence.timeZone};
    compositionLeases.clear();state.draft={key:`draft-${epoch}-${++serial}`,mode,composingFields:[],basis:mode==='create'?null:copy(state.task),values,reviewed:null,confirmed:false,errors:{}};state.latest=null;state.panelOpen=true;state.operation={state:'none',message:''};return emit();
   },
   open(){if(!current()||locked()||state.draft)return reject();state.panelOpen=true;return emit();},
   beginComposition(key,name,lease=name){
    if(!current()||!canEdit(key)||!fieldsFor(state.draft.mode).includes(name))return reject();
    compositionLeases.set(lease,name);syncComposing();state.draft.reviewed=null;state.draft.confirmed=false;state.operation={state:'none',message:''};return emit();
   },
   cancelComposition(key,name,lease=name){
    if(!current()||!canEdit(key)||compositionLeases.get(lease)!==name)return reject();
    compositionLeases.delete(lease);syncComposing();return emit();
   },
   edit(key,name,value,lease=name){
    if(!current()||!canEdit(key)||!FIELDS[state.draft.mode].includes(name)||typeof value!=='string')return reject();
    if(compositionLeases.get(lease)===name)compositionLeases.delete(lease);syncComposing();state.draft.values[name]=value;state.draft.reviewed=null;state.draft.confirmed=false;state.draft.errors={};state.operation={state:'none',message:''};return emit();
   },
   review(key){
    if(!current()||!canEdit(key)||compositionLeases.size)return reject();const check=validate();state.draft.errors=check.errors;
    if(!check.valid){emit();return result('invalid');}
    state.draft.reviewed=copy(state.draft.values);state.draft.confirmed=false;state.operation={state:'needs_confirmation',message:'已核對草稿，尚未保存。'};return emit();
   },
   editAgain(key){if(!current()||!canEdit(key))return reject();state.draft.reviewed=null;state.draft.confirmed=false;state.operation={state:'none',message:''};return emit();},
   confirm(key,value){if(!current()||!canEdit(key)||compositionLeases.size||state.operation.state!=='needs_confirmation'||!state.draft.reviewed)return reject();state.draft.confirmed=value===true;return emit();},
   submit(key){
    if(!current()||!canEdit(key)||compositionLeases.size||!state.online||state.operation.state!=='needs_confirmation'||!state.draft.confirmed||!state.draft.reviewed||!validate().valid||!allowed(state.draft.basis,state.draft.mode))return reject();
    const d=state.draft,v=d.reviewed;let input;
    if(d.mode==='create')input={values:Object.fromEntries(FIELDS.create.map(k=>[k,v[k]])),confirm:true};
    else{input={action:d.mode,expectedVersion:d.basis.version,confirm:true,note:v.note};if(d.mode==='reschedule')Object.assign(input,{dueAt:v.dueAt,timeZone:v.timeZone,assigneeUserId:v.assigneeUserId});if(d.mode==='resolve')input.outcome=v.outcome;}
    receiptConfirmed=false;pending={reference:`synthetic-${epoch}-${++serial}`,epoch,scope:state.scope,kind:d.mode==='create'?'create':'change',target:d.basis?.id??null,input};state.command=copy(pending);state.submissions.push(copy(pending));state.operation={state:'saving',message:'合成操作等候回覆。可在示例控制中放行；沒有網絡請求。',reference:pending.reference};return emit();
   },
   check(){
    if(!current()||!state.online||state.reading||state.operation.state!=='unknown'||state.operation.committed||!pending)return reject();
    state.receiptLookups++;if(receiptConfirmed){apply(pending);return emit();}
    state.operation={...state.operation,checked:true,recovery:'retry',message:'已查核同一合成參考，結果仍未確認。可明確重試同一原操作。'};return emit();
   },
   retry(){
    if(!current()||state.access!=='editable'||!state.online||state.reading||state.operation.state!=='unknown'||!state.operation.checked||state.operation.committed||!pending)return reject();
    state.receiptLookups++;if(receiptConfirmed){apply(pending);return emit();}
    state.submissions.push(copy(pending));state.operation={state:'saving',reference:pending.reference,message:'已再次查核，再沿同一合成參考重試；原內容沒有改變。'};return emit();
   },
   reload(){
    if(!current()||!state.online||state.reading)return reject();
    if(state.operation.state==='conflict'&&queuedLatest){state.latest=copy(queuedLatest);state.task=copy(queuedLatest);state.operation.message='已取得最新版本；草稿仍以原版本作基準。';return emit();}
    if(state.operation.state==='unknown'&&state.operation.committed&&pending){apply(pending);return emit();}return reject();
   },
   rebase(){
    if(!current()||state.access!=='editable'||!state.online||state.reading||state.operation.state!=='conflict'||!state.draft||!state.latest||state.draft.mode==='create'||!allowed(state.latest,state.draft.mode))return reject();
    compositionLeases.clear();state.draft={...state.draft,composingFields:[],key:`draft-${epoch}-${++serial}`,basis:copy(state.latest),reviewed:null,confirmed:false,errors:{}};state.latest=null;queuedLatest=null;leaveIntent=null;state.operation={state:'none',message:'已明確換基準。請重新預覽及確認。'};return emit();
   },
   leave(destination='close'){
    if(!current()||!['close','back','scope'].includes(destination))return reject();if(pendingWrite()||state.reading)return result('blocked');
    if(state.draft){leaveIntent={id:`leave-${epoch}-${++serial}`,key:state.draft.key,destination,token};return {status:'confirm',id:leaveIntent.id,epoch};}
    if(destination==='scope')return replace(state.scope==='demo-a'?'demo-b':'demo-a');clearPanel();state.panelOpen=destination==='back';return emit();
   },
   resolveLeave(id,confirm){
    if(!current()||!leaveIntent||leaveIntent.id!==id||leaveIntent.token!==token||leaveIntent.key!==state.draft?.key)return reject();
    if(!confirm){leaveIntent=null;return result('cancelled');}
    if(pendingWrite()||state.reading)return result('blocked');const destination=leaveIntent.destination;
    if(destination==='scope')return replace(state.scope==='demo-a'?'demo-b':'demo-a');clearPanel();state.panelOpen=destination==='back';return emit();
   }
  });
 }
 return Object.freeze({
  bind,replace,deliver,
  confirmReceipt(reference){if(!pending||pending.reference!==reference||pending.epoch!==epoch||state.operation.state!=='unknown'||!readable())return result('rejected');receiptConfirmed=true;return result('accepted');},
  read:()=>frozen(copy({...state,revision})),
  subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
  setOnline(value){state.online=value===true;return emit();},
  setAccess(value){if(!['editable','read_only','lost'].includes(value))return result('rejected');if(value===state.access)return result('accepted');state.access=value;return replace(state.scope,state.scenario);}
 });
}

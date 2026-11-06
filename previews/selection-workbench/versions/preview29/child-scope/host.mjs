// Original synthetic-only owner. No production imports, storage, network or grant API.
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const clone=value=>structuredClone(value);
export const scenarios=freeze([
 ['ready','可切換'],['dirty','未儲存草稿'],['busy','處理中'],['unknown','結果未確認'],
 ['deferred','延後觀察'],['unverified','孩子清單未知'],['empty','已核對零位'],
 ['shared','目前共享已核對'],['sharedUnverified','共享核對失敗'],['long','長名稱']
]);
function fixture(name='ready'){
 const children=[{id:'p-sprout',name:'小芽',emblem:'✦',note:'個人孩子'},{id:'p-orbit',name:'小星軌',emblem:'◈',note:'個人孩子'},{id:'p-moon',name:'月舟',emblem:'◒',note:'個人孩子'}];
 const s={scenario:name,identity:'synthetic-caregiver',children,loadedAt:'synthetic-read-1',listError:null,loading:false,selectedPersonalId:'p-sprout',sharedTarget:false,shared:null,busy:false,outcome:'none',guard:{dirty:false,pending:null},draft:'',status:{kind:'idle',message:'選擇一位個人孩子，或查看目前的共享範圍。',target:null,intent:null}};
 if(['dirty','busy','unknown'].includes(name))s.draft='合成草稿：明天帶藍色水杯。';
 if(name==='dirty')s.guard.dirty=true;
 if(name==='busy')s.busy=true;
 if(name==='unknown'){s.outcome='unknown';s.guard.pending='unknown';}
 if(name==='unverified'){s.children=[];s.loadedAt=null;s.selectedPersonalId=null;}
 if(name==='empty'){s.children=[];s.selectedPersonalId=null;}
 if(name==='shared'||name==='sharedUnverified'){s.sharedTarget=true;if(name==='shared')s.shared={spaceId:'synthetic-harbour',childId:'synthetic-starfish',childName:'小海星',spaceName:'晨光合成空間',role:'viewer',modules:['照顧記錄','待辦'],basis:'synthetic-basis-1'};}
 if(name==='long')s.children[1].name='小星軌・這是一個用來測試換行的很長合成名稱';
 return s;
}
function derive(s){
 const listState=s.loading?'loading':s.listError?'error':s.loadedAt===null?'unknown':s.children.length?'ready':'empty';
 const identityReady=!!s.identity,rosterReady=identityReady&&listState==='ready';
 const selectedChoiceId=!identityReady?null:s.sharedTarget?(s.shared?`shared:${s.shared.spaceId}:${s.shared.childId}`:null):rosterReady&&s.children.some(c=>c.id===s.selectedPersonalId)?s.selectedPersonalId:null;
 const scope=!identityReady?null:s.sharedTarget?(s.shared?`synthetic-shared:${s.shared.spaceId}:${s.shared.childId}:${s.shared.basis}`:null):selectedChoiceId?`synthetic-personal:${selectedChoiceId}`:null;
 const shared=identityReady&&s.sharedTarget?s.shared:null;
 const personal=selectedChoiceId&&!s.sharedTarget?s.children.find(c=>c.id===selectedChoiceId):null;
 let kind,label,detail;
 if(!identityReady){kind='identity-unknown';label='目前身份尚未核對';detail='尚未建立目前選擇，保留資料暫不展示。';}
 else if(s.sharedTarget){kind=shared?'shared':'shared-unknown';label=shared?shared.childName:'共享範圍尚未核對';detail=shared?`${shared.spaceName} · 僅目前已核對的共享資料`:'保留原共享目標，沒有回退到個人資料';}
 else if(personal){kind='personal';label=personal.name;detail='個人孩子 · 已核對的目前選擇';}
 else {kind='personal-'+listState;label=listState==='empty'?'尚未選擇孩子':'個人範圍尚未核對';detail={unknown:'已保留的孩子資料尚待核對，未建立目前選擇。',loading:'正在核對個人孩子清單，未建立新的目前選擇。',error:'未能核對個人孩子清單，不能宣稱目前選擇已核對。',empty:'目前沒有已選擇的個人孩子。',ready:'尚未選擇一位個人孩子。'}[listState];}
 const currentContext={kind,label,detail,verified:!!selectedChoiceId,identityReady,rosterReady,shared};
 return {...s,listState,selectedChoiceId,scope,currentContext};
}
export function createHost({scenario='ready',autoSettle=true}={}){
 let revision=0,epoch=1,intent=0,disposed=false,job=null;
 let state=freeze(derive({...fixture(scenario),revision,epoch}));
 const listeners=new Set();
 const isCurrent=b=>!!b&&!disposed&&b.epoch===epoch&&b.revision===revision&&b.identity===state.identity&&b.scope===state.scope;
 function publish(patch={}){
  if(disposed)return;
  state=freeze(derive({...state,...clone(patch),revision:++revision,epoch}));
  const currentRevision=revision, snapshot=state;
  for(const registration of [...listeners]){
   if(disposed||revision!==currentRevision)break;
   if(listeners.has(registration))registration.fn(snapshot);
  }
 }
 const binding=()=>freeze({epoch,revision,identity:state.identity,scope:state.scope});
 function refusal(){
  if(!state.identity)return '目前身份未核對，尚未切換。';
  if(state.busy||state.guard.pending==='saving')return '目前正在處理，請稍候；草稿與目前選擇保持不變。';
  if(state.outcome==='unknown'||state.outcome==='checked'||state.guard.pending)return '仍有結果未確認，請先查看原操作；不會捨棄或重送。';
  if(state.listState!=='ready')return state.listState==='empty'?'已核對，目前沒有個人孩子可切換。':'個人孩子清單尚未可用，尚未切換。';
  return null;
 }
 function reject(message,target,id){job=null;publish({status:{kind:'rejected',message,target,intent:id}});}
 function dispatch(target,id,discard=false){
  job={target,id,discard,epoch,identity:state.identity,scope:state.scope};
  publish({status:{kind:'dispatched',message:'切換意圖已提出，等待目前選擇的觀察；尚未確認切換。',target,intent:id}});
  if(autoSettle&&state.scenario!=='deferred')settle(id);
 }
 function requestPersonal(target,b){
  if(!isCurrent(b))return;
  const id=++intent;job=null;
  const child=state.children.find(c=>c.id===target);
  if(!child||target.startsWith('shared:')){reject('這不是目前個人清單中的孩子；共享範圍不能由此切換。',target,id);return;}
  const reason=refusal();if(reason){reject(reason,target,id);return;}
  if(!state.sharedTarget&&target===state.selectedPersonalId){publish({status:{kind:'unchanged',message:'目前已是這位孩子，沒有再次切換。',target,intent:id}});return;}
  if(state.guard.dirty){job={target,id,epoch,identity:state.identity,scope:state.scope};publish({status:{kind:'confirmation',message:'有未儲存的合成草稿。繼續編輯，或明確捨棄後切換。',target,intent:id}});return;}
  dispatch(target,id);
 }
 function confirm(id,b){
  if(!isCurrent(b)||!job||job.id!==id||state.status.kind!=='confirmation')return;
  const reason=refusal();if(reason){reject(reason,job.target,id);return;}
  dispatch(job.target,id,true);
 }
 function cancel(id,b){
  if(!isCurrent(b)||!job||job.id!==id||state.status.kind!=='confirmation')return;
  const target=job.target;job=null;publish({status:{kind:'cancelled',message:'已留在目前孩子，合成草稿仍然保留。',target,intent:id}});
 }
 function settle(id,{accept=true}={}){
  if(disposed||!job||job.id!==id||id!==intent||state.status.kind!=='dispatched')return;
  const current=job;
  if(current.epoch!==epoch||current.identity!==state.identity||current.scope!==state.scope)return;
  const reason=refusal();
  if(!accept||reason||!state.children.some(c=>c.id===current.target)){reject(reason??'這次選擇未被接納；目前孩子與草稿保持不變。',current.target,id);return;}
  job=null;epoch++;
  const child=state.children.find(c=>c.id===current.target);
  publish({selectedPersonalId:current.target,sharedTarget:false,shared:null,
   ...(current.discard?{draft:'',guard:{...state.guard,dirty:false}}:{}),
   status:{kind:'confirmed',message:`已切換到${child.name}。這是合成 owner 快照的觀察結果。`,target:current.target,intent:id}});
 }
 function replaceContext(overrides={}){
  if(disposed)return;
  epoch++;intent++;job=null;publish({...fixture('ready'),...clone(overrides)});
 }
 return {
  getSnapshot:()=>state,binding,isCurrent,requestPersonal,confirm,cancel,settle,
  subscribe(fn){const registration={fn};if(!disposed)listeners.add(registration);return()=>listeners.delete(registration);},
  setGuard(patch){if(disposed)return;const {busy,outcome,...guard}=patch;publish({...('busy'in patch?{busy}:{}),...('outcome'in patch?{outcome}:{}),guard:{...state.guard,...guard}});},
  setScenario(name){if(!scenarios.some(([id])=>id===name))return;replaceContext(fixture(name));},
  replaceContext,
  dispose(){if(disposed)return;disposed=true;intent++;job=null;listeners.clear();}
 };
}

import {readError} from './model.mjs';
// Entirely invented material. No receipt, real family record, photo or model result.
const text='合成閱讀示例｜雨後的閱讀角\n\n這是一段為介面驗收創作的保存文字，不描述任何真實家庭。示例記下「約 120 毫升」，但時間與單位仍要由人核對。\n\n來源保存的是這段文字，不是原 PDF、照片或附件。網頁網址只作標籤；文字不會送給模型。\n\n管理沿革記錄的是用途設定，並不保存舊正文。閱讀修訂後，請回到這裡對照現在保存的內容。';
const digest='3280e6795a24cd64727c32fec6e7d1a8f77173d752b1241f6fa6dad0e7db7ad6';
const scenes=[['normal','一般來源'],['partial','20 筆＋較早未載'],['empty','成功空沿革'],['history-error','沿革讀取失敗'],['delayed','延後 1.2 秒'],['offline','離線但可讀舊資料'],['unknown','原操作結果未知'],['revoked','私人讀取已撤回'],['disabled','目前停用'],['no-text','沒有保存正文'],['confirmed','只有確認連結'],['retire-loading','讀取開始時退休整頁'],['retire-completion','讀取完成時退休整頁'],['retire-abort','外部替換 abort 時退休整頁']];
const clone=x=>JSON.parse(JSON.stringify(x));
const management=()=>({intention:'以合成閱讀材料說明用途，不作孩子事實',purpose:'answer_reference',nature:'external_material',timeScope:'long_reference',validityText:'',enabled:true,modelExcerpt:'約 120 毫升'});
function source(binding,scenario){
 const v={id:'synthetic-source-1',childId:binding.childId,ownerUserId:binding.userId,version:7,createdAt:'2026-11-06T00:00:00Z',canManage:false,kind:'paste',sourceNotes:'所有資料均為原創合成示例。',sourceId:null,sourceLabel:'雨後的閱讀角 · 合成保存稿',sourceUrl:'https://example.invalid/synthetic-reading-corner',sourceDateText:'示例原文沒有提供日期',text,sha256:digest,retrievedAt:'2026-11-06T00:00:00Z',fetchState:'ready',extraction:{state:'available',runId:null,excerpt:'約 120 毫升',draft:{text:'約 120 毫升',rawValue:'120',unit:'毫升',approximate:true,timeRaw:'未提供',uncertainties:['時間未提供，不能推定發生日期。','這是合成候選，尚未人工確認。']},stopReason:null,processedAt:null,model:null},recordId:null,confirmationKind:null,management:management()};
 if(scenario==='disabled'){v.management.enabled=false;v.management.modelExcerpt=null;}
 if(scenario==='no-text'){v.text='';v.sha256=null;v.fetchState='not_requested';v.management.modelExcerpt=null;v.extraction={state:'not_requested',runId:null,excerpt:null,draft:null,stopReason:null,processedAt:null,model:null};}
 if(scenario==='unknown')v.fetchState='unknown';
 if(scenario==='confirmed'){v.recordId='synthetic-record-link';v.confirmationKind='reference';}
 return v;
}
function makeInput(scenario,epoch){
 const binding={serverKey:'synthetic-local-only',userId:'synthetic-reader',childId:'synthetic-child',scopeKey:'synthetic-private',authorityKey:`synthetic-scene-${epoch}`};
 const loaded=['offline','unknown','disabled','no-text','confirmed'].includes(scenario);
 return {binding,authority:{online:scenario!=='offline',role:'viewer',privateRead:scenario!=='revoked',ownerReady:true},allowedTargetId:'synthetic-source-1',blockers:{pending:false,direct:scenario==='unknown',conflict:false},operationProjection:scenario==='unknown'?{state:'unknown',origin:'owner_direct',reference:'synthetic-original-fetch-reference',kind:'fetch',basis:{sourceId:'synthetic-source-1',version:7}}:{state:'none'},source:loaded?{value:source(binding,scenario),freshness:scenario==='offline'?'stale':'fresh'}:null};
}
function page(scenario){
 const versions=scenario==='partial'?Array.from({length:20},(_,i)=>30-i):scenario==='empty'?[]:[10,9,7];
 return {revisions:versions.map((version,index)=>({version,changedAt:`2026-11-${String(6-Math.min(index,5)).padStart(2,'0')}T08:00:00Z`,reason:index===0?'合成修訂：用途改為回答參考；不是正文重寫。':index===1?'合成修訂：當時尚未設定用途。':'合成修訂：保留當時的私人閱讀用途與授權狀態。',management:index===1?null:{...management(),enabled:index%3!==2,modelExcerpt:index%3===2?null:'歷史授權片段僅記存在，不回填現在正文'}})),hasMore:scenario==='partial'};
}
export function createFixture({scenario='normal',scheduler={set:(fn,ms)=>setTimeout(fn,ms),clear:id=>clearTimeout(id)}}={}){
 if(!scenes.some(([id])=>id===scenario))throw new TypeError('Unknown synthetic scenario');
 let current=scenario,epoch=1,input=makeInput(current,epoch),connection=null,unsub=()=>{};const pending=new Set();
 // Finite local fixture precondition, not a replacement for the formal PhotoCandidate parser.
 const seed=source(input.binding,'normal');if(seed.text.length>64000||!seed.text.includes(seed.management.modelExcerpt)||seed.extraction.draft.rawValue!=='120'||seed.extraction.draft.unit!=='毫升'||!seed.extraction.draft.approximate||seed.extraction.draft.uncertainties.length!==2)throw new TypeError('Invalid synthetic seed');
 function request(kind,r){
  const target=kind==='detail'?r.targetId:r.sourceId;
  if(!r.signal||r.signal.aborted)return Promise.reject(readError('cancelled'));
  if(!['serverKey','userId','childId','scopeKey','authorityKey'].every(k=>r.binding?.[k]===input.binding[k])||target!==input.allowedTargetId||!input.authority.privateRead)return Promise.reject(readError('denied'));
  const capturedScene=current,capturedBinding=clone(input.binding);const delay=capturedScene==='delayed'?1200:kind==='history'?450:180;
  return new Promise((resolve,reject)=>{
   let done=false,id;const task={cancel:()=>settle(null,'cancelled')};
   const settle=(value,tag)=>{if(done)return;done=true;scheduler.clear(id);pending.delete(task);r.signal.removeEventListener('abort',onAbort);tag?reject(readError(tag)):resolve(value);};
   const onAbort=()=>{settle(null,'cancelled');if(capturedScene==='retire-abort')connection?.teardown();};
   r.signal.addEventListener('abort',onAbort,{once:true});pending.add(task);
   id=scheduler.set(()=>capturedScene==='history-error'&&kind==='history'?settle(null,'transport'):settle(kind==='detail'?source(capturedBinding,capturedScene):page(capturedScene),null),delay);
  });
 }
 const ports=Object.freeze({readSource:r=>request('detail',r),readHistory:r=>request('history',r)});
 return Object.freeze({
  initialInput:clone(input),ports,scenarios:Object.freeze(scenes.map(([id,label])=>Object.freeze({id,label}))),
  attach(wiring){if(connection)throw new TypeError('Fixture already attached');connection=wiring;unsub=wiring.host.subscribe(s=>{if(current==='retire-loading'&&s.busy||current==='retire-completion'&&!s.busy&&s.detailRead.requestId!==null&&s.detailRead.load==='ready')wiring.teardown();});return ()=>{unsub();connection=null;for(const task of [...pending])task.cancel();};},
  selectScenario(name){if(!connection||!scenes.some(([id])=>id===name))return false;const oldScene=current,oldInput=input;current=name;input=makeInput(name,++epoch);if(connection.control.replaceInput(input))return true;current=oldScene;input=oldInput;return false;}
 });
}

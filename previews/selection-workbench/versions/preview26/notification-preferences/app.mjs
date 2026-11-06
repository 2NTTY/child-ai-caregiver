import {FIELDS,ZONES,clockSegments} from './host.mjs';
import {deliverFixture,fixtureChoices} from './fixtures.mjs';
const LABELS={quietStart:'安靜時段開始',quietEnd:'安靜時段結束',timeZone:'通知時區',allowAppointmentDuringQuiet:'預約提醒例外'};
const format=(key,value)=>key==='allowAppointmentDuringQuiet'?(value?'開啟':'關閉'):value;
const phaseNames={ready:'已讀取合成版本',reading:'合成讀取中',saving:'合成保存處理中',unknown:'原結果待查核','confirmed-read-pending':'原保存已確認，待讀回',stale:'需要重新讀取',unavailable:'目前不能讀取或保存'};
export function mountApp(root,host){
 const d=root.ownerDocument;let mounted=true,life=null,lastRevision=-1,body,refs={};
 function element(tag,props={},text){const n=d.createElement(tag);for(const[k,v]of Object.entries(props)){if(k==='class')n.className=v;else if(k==='hidden')n.hidden=v;else n.setAttribute(k,v);}if(text!==undefined)n.textContent=text;return n;}
 function append(parent,tag,props,text){const n=element(tag,props,text);parent.append(n);return n;}
 function button(parent,id,text,onClick){const b=append(parent,'button',{type:'button',...(id?{id}:{})},text);b.addEventListener('click',event=>{if(mounted)onClick(event);});return b;}
 root.replaceChildren();
 const top=append(root,'div',{class:'workbench-header'});
 append(top,'p',{class:'brand'},'育伴港 / 選配工作台');
 const choices=append(top,'div',{class:'direction-choices','aria-label':'選擇呈現方向'});
 for(const[v,label]of [['A','A 夜間航圖'],['B','B 偏好校對台']]){
  const b=button(choices,null,label,()=>{if(!mounted)return;host.setLayout(v);const s=host.snapshot();if(v==='A'&&body?.contains(d.activeElement)&&d.activeElement.closest('[hidden]'))refs.inputs[s.step===0?'quietStart':s.step===1?'timeZone':'allowAppointmentDuringQuiet']?.focus();});b.dataset.layout=v;
 }
 append(root,'p',{class:'safety-banner'},'全合成互動候選。只改本頁記憶體，不會修改真實偏好、發送通知或要求裝置權限。');
 const mount=append(root,'div',{class:'body-mount'});
 const lab=append(root,'details',{class:'lab'});append(lab,'summary',{},'合成情境工具');
 append(lab,'p',{},'以下不是產品設定。按鈕只交付本頁的合成回覆，用來比較等待、失敗與原操作核對。');
 const labrow=append(lab,'div',{class:'lab-row'});
 append(labrow,'label',{for:'fixture-response'},'下個合成回覆');
 const outcome=append(labrow,'select',{id:'fixture-response'});
 for(const [value,text]of [['success','正常讀取／確認保存'],['unknown','保存結果未知'],['failure','讀取失敗／保存已確認但讀回失敗'],['confirmed','查得原收據已確認並讀回'],['new-version','讀回另一個版本（草稿仍保留）'],['conflict','保存版本衝突'],['denied','本人存取被拒絕']])append(outcome,'option',{value},text);
 const deliver=button(labrow,'deliver-fixture','交付合成回覆',()=>{if(mounted)deliverFixture(host,outcome.value);});
 const labActions=append(lab,'div',{class:'lab-row'});
 button(labActions,'lab-offline','切換合成離線／連線',()=>{const s=host.snapshot();host.setContext({...s.context,online:!s.context.online});});
 button(labActions,'lab-identity','切換合成本人',()=>{const s=host.snapshot();host.setContext({...s.context,userId:s.context.userId==='synthetic-a'?'synthetic-b':'synthetic-a'});});
 button(labActions,'lab-session','更新合成 session',()=>{const s=host.snapshot();host.setContext({...s.context,sessionGeneration:s.context.sessionGeneration+1});});
 button(labActions,'lab-child','換孩子（本人偏好不變）',()=>{host.setChild(host.snapshot().child==='child-a'?'child-b':'child-a');});
 button(labActions,'lab-shared','切換共享／本人範圍',()=>{const s=host.snapshot();host.setContext({...s.context,shared:!s.context.shared});});
 button(labActions,'lab-write','切換新提交准入',()=>host.setWriteAdmission(!host.snapshot().canWrite));
 const labStatus=append(lab,'p',{class:'lab-state'});
 const gates=append(root,'details',{class:'source-gates'});append(gates,'summary',{},'來源限制與尚未驗證');
 append(gates,'p',{},'DP-F01：目前正式來源對「有效 confirmed 收據＋畸形偏好結果」仍可能遺失 confirmed 標記。lookup404 也不能一概當作未提交。這兩種正式接線限制未修復；此候選只展示有效結果的合成流程。');
 append(gates,'p',{},'瀏覽器像素、真 Tab／IME、輔助科技、手勢、原生時鐘／選單及正式 owner 接線尚未驗證。重新載入不恢復草稿或原操作。沒有渠道綁定、通知同意或權限變更。');
 function build(s){
  life=s.lifetime;mount.replaceChildren();refs={inputs:{},fields:{},saved:{},errors:{},errorLinks:{}};
  const localLife=life;const current=()=>mounted&&host.snapshot().lifetime===localLife;
  body=append(mount,'section',{class:'preference-workspace','aria-label':'本人通知偏好'});
  const heading=append(body,'header',{class:'hero'});append(heading,'p',{class:'module-id'},'本人通知偏好 · NP01');refs.title=append(heading,'h1',{},'讓安靜時段有清楚界線');
  refs.intro=append(heading,'p',{class:'intro'},'先選本地時間，再核對草稿。此設定不會建立通知渠道或授權發送。');
  refs.scope=append(body,'p',{id:'scope-status',class:'scope-status',tabindex:'-1'});
  const savedbar=append(body,'div',{class:'saved-bar'});refs.version=append(savedbar,'strong',{id:'saved-version'});refs.savedSummary=append(savedbar,'span');refs.changes=append(savedbar,'span',{class:'changes'});
  refs.status=append(body,'p',{id:'status',role:'status','aria-live':'polite','aria-atomic':'true',class:'status'});
  refs.personal=append(body,'div',{id:'personal'});
  refs.clock=append(refs.personal,'section',{class:'clock-map','aria-labelledby':'clock-heading'});append(refs.clock,'h2',{id:'clock-heading'},'草稿的安靜區間');
  refs.clockText=append(refs.clock,'p',{class:'clock-copy'});
  const band=append(refs.clock,'div',{class:'clock-band',role:'img'});refs.band=band;
  refs.segments=[append(band,'span',{class:'quiet-segment','aria-hidden':'true'}),append(band,'span',{class:'quiet-segment','aria-hidden':'true'})];
  const ticks=append(refs.clock,'div',{class:'clock-ticks','aria-hidden':'true'});for(const t of ['00','06','12','18','24'])append(ticks,'span',{},t);
  append(refs.clock,'p',{class:'hint'},'深色表示鐘面上的安靜區間，不是實際經過時數。夏令時間及真正提醒條件另由原服務核對。');
  refs.steps=append(refs.personal,'nav',{id:'steps',class:'steps','aria-label':'逐段設定'});
  for(const [i,t]of ['設定時間','選擇時區','預約例外'].entries()){
   const b=button(refs.steps,null,`${String(i+1).padStart(2,'0')}  ${t}`,()=>{if(!current())return;host.setStep(i);if(current())refs.inputs[i===0?'quietStart':i===1?'timeZone':'allowAppointmentDuringQuiet']?.focus();});b.dataset.step=String(i);
  }
  const form=append(refs.personal,'form',{novalidate:'',class:'editor'});
  form.addEventListener('submit',e=>{e.preventDefault();if(current())host.stageReview();});
  refs.errorSummary=append(form,'div',{id:'error-summary',class:'error-summary',role:'region','aria-label':'欄位錯誤',tabindex:'-1'});
  append(refs.errorSummary,'p',{},'請先修正以下欄位，再核對草稿。');
  for(const k of FIELDS){const b=button(refs.errorSummary,null,'',()=>{if(!current())return;host.setStep(k==='quietStart'||k==='quietEnd'?0:k==='timeZone'?1:2);if(current())refs.inputs[k].focus();});b.dataset.error=k;refs.errorLinks[k]=b;}
  const columns=append(form,'div',{class:'column-labels','aria-hidden':'true'});append(columns,'span',{},'設定項目');append(columns,'span',{},'已保存');append(columns,'span',{},'本次草稿');
  for(const field of FIELDS){
   const row=append(form,'div',{id:`field-${field}`,class:`field-row field-${field}`});refs.fields[field]=row;
   const label=append(row,'label',{for:field},LABELS[field]);
   if(field==='quietStart'||field==='quietEnd')append(label,'span',{class:'field-hint'},'24 小時制 HH:mm');
   refs.saved[field]=append(row,'p',{'data-saved':field,class:'saved-value'});
   const edit=append(row,'div',{class:'edit-cell'});let input;
   if(field==='timeZone')input=append(edit,'select',{id:field,'aria-describedby':`${field}-hint ${field}-error`});
   else input=append(edit,'input',{id:field,type:field==='allowAppointmentDuringQuiet'?'checkbox':'text',...(field==='allowAppointmentDuringQuiet'?{}:{placeholder:'HH:mm',maxlength:'5',inputmode:'text',autocomplete:'off'}),'aria-describedby':`${field}-hint ${field}-error`});
   const event=field==='timeZone'||field==='allowAppointmentDuringQuiet'?'change':'input';
   input.addEventListener(event,()=>{if(current())host.edit(field,field==='allowAppointmentDuringQuiet'?input.checked:input.value);});refs.inputs[field]=input;
   append(edit,'p',{id:`${field}-hint`,class:'hint'},field==='timeZone'?'以本人所選 IANA 時區解讀，不跟隨裝置自動更換。':field==='allowAppointmentDuringQuiet'?'這是尚未保存的草稿。只容許已授權的預約提醒例外，不等於必定發送。':field==='quietEnd'?'結束時刻不屬於安靜區間；開始和結束不能相同。':'開始時刻屬於安靜區間，可跨午夜。');
   refs.errors[field]=append(edit,'p',{id:`${field}-error`,class:'field-error'});
  }
  const actions=append(form,'div',{class:'form-actions'});
  refs.reviewButton=button(actions,'review-button','核對草稿',()=>{if(!current())return;host.stageReview();const now=host.snapshot();if(current()&&now.review)refs.reviewTitle.focus();});
  refs.refresh=button(actions,'refresh-button','重新讀取合成偏好',()=>{if(current())host.refresh();});
  refs.reviewPanel=append(refs.personal,'section',{id:'review-panel',class:'review-panel','aria-labelledby':'review-title'});
  refs.reviewTitle=append(refs.reviewPanel,'h2',{id:'review-title',tabindex:'-1'},'待確認，尚未保存');
  refs.reviewCopy=append(refs.reviewPanel,'p');
  const reviewActions=append(refs.reviewPanel,'div',{class:'form-actions'});
  refs.save=button(reviewActions,'save-button','確認保存合成偏好',()=>{if(current())host.save();});
  button(reviewActions,'back-button','返回修改',()=>{if(!current())return;host.closeReview();if(current())refs.reviewButton.focus();});
  refs.recovery=append(refs.personal,'section',{id:'recovery',class:'recovery','aria-labelledby':'recovery-heading'});
  refs.recoveryTitle=append(refs.recovery,'h2',{id:'recovery-heading'},'先核對原操作');refs.originalText=append(refs.recovery,'p');
  refs.originalInput=append(refs.recovery,'p',{class:'original-input'});
  refs.readOriginal=button(refs.recovery,'read-original','查合成原收據及目前偏好',()=>{if(current())host.refresh();});
  refs.retryArea=append(refs.recovery,'div',{id:'retry-area',class:'retry-area'});
  refs.consent=append(refs.retryArea,'input',{type:'checkbox',id:'consent-original'});append(refs.retryArea,'label',{for:'consent-original'},'已核對目前資料，同意以原內容及版本重試（合成）');
  refs.consent.addEventListener('change',()=>{if(current())host.consentOriginal(refs.consent.checked);});
  refs.retry=button(refs.retryArea,'retry-button','明確重試合成原操作',()=>{if(current())host.retryOriginal();});
  append(refs.personal,'p',{class:'boundary-note'},'安靜時段只是一項偏好。授權、對象資格、未知投遞及任務條件仍由原服務判定；此頁不作派送承諾。');
 }
 function render(s){
  if(!mounted||s.revision<lastRevision)return;lastRevision=s.revision;
  const focusedBefore=d.activeElement;
  const localFocus=body?.contains(focusedBefore)&&!focusedBefore.closest('[hidden]')?focusedBefore:null;
  const repairScopeFocus=life!==s.lifetime&&!!localFocus;
  if(life!==s.lifetime)build(s);
  root.dataset.layout=s.layout;root.dataset.lifetime=String(s.lifetime);
  for(const b of choices.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.layout===s.layout));
  const personal=!!s.context.userId&&s.context.admitted===true&&!s.context.shared;
  refs.title.textContent=s.layout==='A'?'讓安靜時段有清楚界線':'把每一項變更看清楚';
  refs.intro.textContent=s.layout==='A'?'按時間、時區、例外逐段設定，再核對原版本。':'左邊是已保存投影，右邊是本次草稿。直接比較，再核對原版本。';
  refs.scope.textContent=personal?`${s.context.userId==='synthetic-a'?'本人甲':'本人乙'}（全合成） / session ${s.context.sessionGeneration} / ${phaseNames[s.phase]}`:'目前不是可用的本人範圍；個人偏好不在這裡顯示。';
  refs.personal.hidden=!personal;
  refs.version.textContent=s.preferences?`已保存投影 v${s.preferences.version}`:'未讀取已保存偏好';
  refs.savedSummary.textContent=s.preferences?`${s.preferences.timeZone} / ${s.preferences.quietStart}–${s.preferences.quietEnd} / 預約例外${s.preferences.allowAppointmentDuringQuiet?'開啟':'關閉'}`:'預設欄位只是草稿，並非已保存資料。';
  refs.changes.textContent=s.preferences?`${FIELDS.filter(k=>s.draft[k]!==s.preferences[k]).length} 項與已保存投影不同`:'';
  refs.status.textContent=s.notice;
  refs.steps.hidden=s.layout!=='A';refs.clock.hidden=s.layout!=='A';
  for(const b of refs.steps.querySelectorAll('button'))b.setAttribute('aria-current',Number(b.dataset.step)===s.step?'step':'false');
  for(const k of FIELDS){
   refs.fields[k].hidden=s.layout==='A'&&(k==='quietStart'||k==='quietEnd'?s.step!==0:k==='timeZone'?s.step!==1:s.step!==2);
   refs.saved[k].textContent=s.preferences?format(k,s.preferences[k]):'尚未讀取';
   const input=refs.inputs[k];
   if(k==='timeZone'){
    const zones=ZONES.some(z=>z[0]===s.draft.timeZone)?ZONES:[...ZONES,[s.draft.timeZone,`${s.draft.timeZone}（原設定）`]];
    const signature=JSON.stringify(zones);if(input.dataset.options!==signature){input.replaceChildren(...zones.map(([value,label])=>element('option',{value},`${label} · ${value}`)));input.dataset.options=signature;}
   }
   if(k==='allowAppointmentDuringQuiet')input.checked=s.draft[k];else if(input.value!==s.draft[k])input.value=s.draft[k];
   input.disabled=s.locked;input.setAttribute('aria-invalid',String(!!s.errors[k]));refs.errors[k].textContent=s.errors[k]||'';refs.errors[k].hidden=!s.errors[k];
  }
  refs.errorSummary.hidden=!Object.keys(s.errors).length;
  for(const k of FIELDS){const b=refs.errorLinks[k];b.hidden=!s.errors[k];b.textContent=s.errors[k]?`${LABELS[k]}：${s.errors[k]}`:'';}
  const segments=clockSegments(s.draft.quietStart,s.draft.quietEnd);
  const clockDescription=segments?`${s.draft.quietStart}–${s.draft.quietEnd}${s.draft.quietStart>s.draft.quietEnd?'，跨午夜':''}，${s.draft.timeZone}（草稿）`:'時間尚未有效；請先填妥兩個不同的 HH:mm。';
  refs.clockText.textContent=clockDescription;refs.band.setAttribute('aria-label',clockDescription);
  refs.segments.forEach((el,i)=>{const seg=segments?.[i];el.hidden=!seg;if(seg){el.style.left=`${seg.from/1440*100}%`;el.style.width=`${(seg.to-seg.from)/1440*100}%`;}});
  refs.reviewButton.disabled=s.locked;refs.refresh.disabled=!s.available||!!s.request;refs.refresh.hidden=!!s.original;
  refs.reviewPanel.hidden=!s.review;
  if(s.review){const v=s.review.values;refs.reviewCopy.textContent=`依目前版本 ${s.review.expectedVersion} 核對：${v.timeZone}；安靜時段 ${v.quietStart}–${v.quietEnd}；預約例外${v.allowAppointmentDuringQuiet?'開啟':'關閉'}。此刻尚未保存。`;}
  refs.save.disabled=s.locked||!s.review;
  refs.recovery.hidden=!s.original;
  if(s.original){const o=s.original;refs.originalText.textContent=o.confirmed?'原合成操作已確認；目前資料尚待讀回，不能再次提交。':'原合成操作結果待查核；其他提交暫停。';refs.originalInput.textContent=`${o.id} / 原版本 ${o.input.expectedVersion} / ${o.input.timeZone} / ${o.input.quietStart}–${o.input.quietEnd} / 預約例外${o.input.allowAppointmentDuringQuiet?'開啟':'關閉'}`;refs.retryArea.hidden=o.confirmed;refs.consent.checked=o.consent;refs.consent.disabled=!s.available||!!s.request||!o.reviewed;refs.retry.disabled=!s.available||!!s.request||!o.reviewed||!o.consent;}
  refs.readOriginal.disabled=!s.available||!!s.request;
  deliver.disabled=!s.request;for(const option of outcome.options)option.disabled=!s.request||!fixtureChoices(s).includes(option.value);if(s.request&&!fixtureChoices(s).includes(outcome.value))outcome.value='success';labStatus.textContent=`待交付：${s.request?s.request.kind:'無'}；合成提交 ${s.dispatches} 次；新提交准入${s.canWrite?'允許':'暫停'}。`;
  // Repair only focus whose local visible panel retired, after every projection write.
  // Temporary disabling during a read does not retire an otherwise visible editor.
  const retiredFocus=repairScopeFocus||!!localFocus&&(!localFocus.isConnected||!!localFocus.closest('[hidden]'));
  const focusUnclaimed=d.activeElement===localFocus||d.activeElement===d.body;
  const target=refs.scope;
  if(retiredFocus&&focusUnclaimed&&mounted&&host.snapshot().revision===s.revision&&life===s.lifetime&&target.isConnected&&!target.closest('[hidden]')&&!target.disabled)target.focus();
 }
 const off=host.subscribe(render);render(host.snapshot());
 return {dispose(){if(!mounted)return;mounted=false;off();root.replaceChildren();}};
}

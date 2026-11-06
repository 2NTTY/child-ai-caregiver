import { allowed, fieldsFor, labels, stateLabels, displayTime } from './owner.mjs';
const FIELD_LABELS={title:'事項標題',details:'詳細內容（可選）',kind:'事項種類',assigneeUserId:'負責人',timeZone:'時區',dueAt:'安排時間（ISO，含時差）',note:'原因（必填）',outcome:'明確終態'};
const fieldLabel=(name,mode)=>name==='note'&&mode==='complete'?'完成備註（可選）':FIELD_LABELS[name];
const PEOPLE={'demo-owner':'合成家長','demo-carer':'合成照顧者'};
export function mountEditor(root,{owner,layout='care'}){
 const doc=root.ownerDocument,win=doc.defaultView;
 let alive=true,currentLayout=layout==='handbook'?'handbook':'care',epoch=null,port=null,draftUI=null,dialog=null,lastTaskKey=null,recoveryKey=null,viewIntent=0;
 const composing=new Set(),compositionSessions=new Map();
 function el(tag,attrs={},text){const n=doc.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(k==='class')n.className=v;else if(k==='hidden')n.hidden=!!v;else n.setAttribute(k,String(v));}if(text!==undefined)n.textContent=text;return n;}
 function button(action,text,fn,className='secondary'){const n=el('button',{'type':'button','data-action':action,class:className},text);n.addEventListener('click',()=>{if(alive){viewIntent++;fn(n);}});return n;}
 function append(parent,...children){parent.append(...children);return parent;}
 function text(node,value){if(node.textContent!==String(value))node.textContent=String(value);}
 function safeFocus(node){if(alive&&node?.isConnected&&!node.closest('[hidden],[inert]')&&!node.disabled)node.focus({preventScroll:true});}
 function focusAfter(result,origin,target){const active=doc.activeElement;if(result?.status==='accepted'&&result.epoch===owner.read().epoch&&(active===origin||!origin.isConnected&&[doc.body,detailTitle,title].includes(active)))safeFocus(target);}
 function rebaseAndReveal(origin,binding,key){
  const before=owner.read();if(!binding.current()||before.draft?.key!==key)return;
  const owned=doc.activeElement===origin,intent=viewIntent,revision=before.revision+1;
  let phase='publication',target=null,newerFocus=false;
  const watchFocus=e=>{if(e.target!==(phase==='publication'?detailTitle:target))newerFocus=true;};
  if(owned)doc.addEventListener('focusin',watchFocus,true);
  try{
   const r=binding.rebase(),after=owner.read(),next=draftUI,newKey=after.draft?.key;
   target=next?.controls.values().next().value;
   const current=()=>{const now=owner.read();return alive&&owned&&!newerFocus&&viewIntent===intent&&binding.current()&&r.status==='accepted'&&r.epoch===before.epoch&&now.epoch===r.epoch&&r.revision===revision&&now.revision===revision&&newKey!==key&&now.draft?.key===newKey&&next?.key===newKey&&now.draft?.basis?.version===before.latest?.version;};
   const usable=()=>target?.isConnected&&workspace.contains(next.form)&&next.form.contains(target)&&!target.closest('[hidden],[inert]')&&!target.disabled;
   if(!current()||!usable()||!(doc.activeElement===origin||!origin.isConnected&&doc.activeElement===detailTitle))return;
   phase='focus';safeFocus(target);
   if(current()&&usable()&&doc.activeElement===target)(target.closest('.field')??target).scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'instant'});
  }finally{if(owned)doc.removeEventListener('focusin',watchFocus,true);}
 }
 function announce(message){text(localStatus,message);}
 const shell=el('div',{class:'te01','data-layout':currentLayout});root.append(shell);
 const content=el('div',{'data-content':''});shell.append(content);
 const title=el('h1',{tabindex:'-1'},'這次安排，先核對再保存');
 const header=append(el('header',{class:'page-header'}),el('p',{class:'eyebrow'},'選配工作台 / TE01 任務詳情與編輯'),title,el('p',{class:'intro'},'同一份合成草稿，試試兩種核對方式。所有操作只留在本頁。'));
 const switches=el('nav',{'aria-label':'編輯呈現方式',class:'layout-switch'});
 const care=button('layout-care','Care · 兩階段',n=>switchLayout('care',n));
 const handbook=button('layout-handbook','Handbook · 同頁核對',n=>switchLayout('handbook',n));
 append(switches,care,handbook);append(header,switches);content.append(header);
 const provenance=el('p',{class:'provenance'},'根據 Care／Handbook 重新呈現，並非原封抽取。日期為明確時差輸入，未搬入原版日期彈窗。');content.append(provenance);
 const session=el('div',{class:'session'}),scopeLabel=el('span'),onlineLabel=el('span'),roleLabel=el('span');
 append(session,scopeLabel,onlineLabel,roleLabel,button('scope','切換孩子示例',n=>leave('scope',n)));content.append(session);
 const localStatus=el('p',{role:'status','aria-live':'polite',class:'local-status'});content.append(localStatus);
 const operation=el('section',{'aria-label':'操作結果',class:'operation'}),opTitle=el('h2'),opText=el('p',{role:'status','aria-live':'polite'}),reference=el('p',{class:'meta'}),recoveryRow=el('div',{class:'actions'});
 append(operation,opTitle,opText,reference,recoveryRow);content.append(operation);
 const recovery={};
 function syncRecovery(s){
  const identity=`${s.epoch}:${s.draft?.key??''}:${s.operation.reference??''}`;
  if(identity===recoveryKey)return;recoveryKey=identity;recoveryRow.replaceChildren();
  const binding=port;
  for(const [action,label]of [['check','查核原操作'],['retry','重試同一原操作'],['reload','重新載入']]){
   recovery[action]=button(action,label,()=>{const now=owner.read();if(!binding.current()||`${now.epoch}:${now.draft?.key??''}:${now.operation.reference??''}`!==identity)return;const result=binding[action]();if(result.status!=='accepted')announce('目前未接納這項恢復操作。');});recoveryRow.append(recovery[action]);
  }
 }
 const detail=el('section',{'data-detail':'',class:'detail-card'}),detailLabel=el('p',{class:'eyebrow'},'目前安排'),detailTitle=el('h2',{tabindex:'-1'}),facts=el('div',{class:'facts'}),description=el('p',{class:'description'}),reminder=el('p',{class:'reminder'}),terminal=el('p',{class:'warning'},'這項事項已結束，不能重開。若另有安排，請明確新增另一項。'),detailActions=el('div',{class:'actions'});
 append(detail,detailLabel,detailTitle,facts,description,reminder,terminal,detailActions);content.append(detail);
 const closed=append(el('section',{class:'closed',hidden:true}),el('h2',{},'已關閉詳情'),button('open','重新開啟詳情',origin=>{const r=port?.open();focusAfter(r,origin,detailTitle);}));content.append(closed);
 const unavailable=append(el('section',{class:'unavailable',hidden:true}),el('h2',{},'目前不能查看這個孩子的安排'),el('p',{},'原草稿與操作已退休。回復示例權限會開始新的合成範圍。'));content.append(unavailable);
 const workspace=el('section',{class:'workspace','aria-label':'編輯與核對'});content.append(workspace);
 const lab=el('details',{class:'lab',open:''});lab.append(el('summary',{},'合成示例控制 · 不會連接服務'));
 const labBody=el('div',{class:'lab-body'}),reply=el('select',{name:'reply-kind',id:'te01-reply-kind'});
 for(const [value,label]of [['success','確認保存'],['unknown','回覆中斷，結果未知'],['conflict','版本衝突'],['terminal-conflict','最新版本已結束'],['unavailable','已提交，內容暫不可顯示']])reply.append(el('option',{value},label));
 const deliver=button('deliver','放行合成回覆',()=>{const s=owner.read();const r=owner.deliver(reply.value,s.command);if(r.status!=='accepted')announce('這個回覆不適用目前操作。');});
 const confirmReceipt=button('confirm-receipt','模擬原收據稍後確認',()=>{const s=owner.read();const r=owner.confirmReceipt(s.command?.reference);if(r.status==='accepted')announce('已模擬原收據確認。再查核或重試時會先讀同一收據，不會另送一次。');});
 const online=button('online','切為離線',()=>owner.setOnline(!owner.read().online));
 const scenario=el('select',{name:'scenario',id:'te01-scenario'});
 for(const [value,label]of [['normal','一般待辦'],['review','終態待覆核'],['terminal','已完成事項'],['worker-unknown','提醒處理未知']])scenario.append(el('option',{value},label));
 const loadScenario=button('load-scenario','載入所選合成示例',()=>{const s=owner.read();if(s.draft||['saving','unknown'].includes(s.operation.state))return;owner.replace(s.scope,scenario.value);});
 const revoke=button('revoke','模擬撤權',()=>owner.setAccess('lost'),'quiet');
 const restore=button('restore','回復示例權限',()=>owner.setAccess('editable'),'quiet');
 const count=el('p',{class:'meta','data-submissions':''});
 append(labBody,el('p',{},'保存會先停在「處理中」。選擇一種合成回覆，再按放行，便可比較成功、未知或版本衝突的操作。'),append(el('label',{for:'te01-reply-kind'},'這次合成回覆'),reply),deliver,confirmReceipt,append(el('label',{for:'te01-scenario'},'任務示例'),scenario),loadScenario,append(el('div',{class:'actions'}),online,revoke,restore),count);lab.append(labBody);content.append(lab);
 const boundaries=el('details',{class:'boundaries'});append(boundaries,el('summary',{},'這個候選包含甚麼'),el('p',{},'新增才可填標題、詳細內容及種類；既有事項只可改期／轉派、完成、取消或明確覆核。提醒渠道、提醒時間和自訂分類不是可編輯欄位。'),el('p',{},'兩種布局共用同一資料與操作 owner。切換布局不送出、不清草稿。草稿不會跨重新載入保存；本頁沒有 API、真模型、家庭資料或訊息。'),el('p',{},'目前只比較 editor；不重做清單、日曆或逐版歷史。原生日期彈窗、瀏覽器 Back／Forward、真手機、讀屏與完整產品接線仍待另驗。'));content.append(boundaries);
 function switchLayout(next,origin){currentLayout=next;render();if(origin.isConnected)safeFocus(origin);}
 function leave(destination,origin){
  const binding=port;if(!binding?.current())return;const r=binding.leave(destination);
  if(r.status==='confirm')showDialog(r,binding,origin);
  else if(r.status==='blocked')announce('原操作尚未確認，或正在讀取，暫不能離開。');
  else if(r.status==='accepted')focusAfter(r,origin,owner.read().panelOpen?detailTitle:closed.querySelector('button'));
 }
 function removeDialog(restoreFocus=false){
  if(!dialog)return;const old=dialog,owned=old.node.contains(doc.activeElement);dialog=null;old.node.remove();content.removeAttribute('inert');content.removeAttribute('aria-hidden');
  if(restoreFocus&&owned)safeFocus(old.origin);
 }
 function showDialog(intent,binding,origin){
  removeDialog(false);const node=el('div',{class:'dialog-backdrop'}),surface=el('section',{role:'dialog','aria-modal':'true','aria-labelledby':'te01-discard-title',class:'dialog'});
  const h=el('h2',{id:'te01-discard-title'},'放棄這份未保存草稿？'),message=el('p',{},'取消會保留目前內容。確認時會再核對原操作是否仍可離開。');
  const close=(confirm)=>{
   if(!alive||!dialog||dialog.id!==intent.id)return;
   const wasOwned=node.contains(doc.activeElement),r=binding.resolveLeave(intent.id,confirm);
   if(r.status==='blocked'){text(message,'操作正在處理或結果未確認，不能放棄。請保留草稿並先處理原操作。');return;}
   if(r.status==='cancelled'){removeDialog(true);return;}
   if(r.status==='accepted'){const stillOwned=wasOwned&&node.contains(doc.activeElement);removeDialog(false);if(stillOwned&&r.epoch===owner.read().epoch)safeFocus(owner.read().panelOpen?detailTitle:closed.querySelector('button'));}
   else removeDialog(false);
  };
  const keep=button('keep-draft','保留草稿',()=>close(false)),discard=button('discard','確認放棄草稿',()=>close(true),'danger');
  append(surface,h,message,append(el('div',{class:'actions'}),keep,discard));node.append(surface);shell.append(node);
  dialog={node,id:intent.id,epoch:intent.epoch,origin,binding};content.setAttribute('inert','');content.setAttribute('aria-hidden','true');safeFocus(keep);
  node.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close(false);}else if(e.key==='Tab'){if(e.shiftKey&&doc.activeElement===keep){e.preventDefault();safeFocus(discard);}else if(!e.shiftKey&&doc.activeElement===discard){e.preventDefault();safeFocus(keep);}}});
 }
 function snapshot(parent,task,label){
  parent.replaceChildren();if(!task)return;
  append(parent,el('h3',{},`${label} · 版本 ${task.version}`),el('p',{},task.title),el('p',{},`${stateLabels[task.occurrence.state]} · ${PEOPLE[task.assigneeUserId]??'原負責人待核對'}`),el('p',{},`${displayTime(task.occurrence.dueAt,task.occurrence.timeZone)} · ${task.occurrence.timeZone}`));
 }
 function makeDraft(s){
  const d=s.draft,key=d.key,binding=port,form=el('form',{class:'editor-form',novalidate:'','aria-labelledby':'te01-form-title'}),toolbar=el('div',{class:'form-toolbar'}),stage=el('p',{class:'eyebrow'}),heading=el('h2',{id:'te01-form-title',tabindex:'-1'},labels[d.mode]),basisLine=el('p',{class:'meta'});
  const leaveThis=(destination,n)=>{if(binding.current()&&owner.read().draft?.key===key)leave(destination,n);};
  append(toolbar,stage,button('back','返回詳情',n=>leaveThis('back',n),'quiet'),button('close','關閉編輯',n=>leaveThis('close',n),'quiet'));
  append(form,toolbar,heading,basisLine);const columns=el('div',{class:'editor-columns'}),fields=el('div',{'data-editor-fields':'',class:'editor-fields'}),basis=el('section',{class:'basis'}),errorSummary=el('p',{role:'alert',class:'error-summary'});
  append(fields,basis,errorSummary);const controls=new Map(),messages=new Map();
  const groups=[['01','要安排甚麼',['title','details','kind']],['02','由誰、何時處理',['assigneeUserId','timeZone','dueAt']],['03',d.mode==='complete'?'完成備註':'核對這次更改',['outcome','note']]];
  for(const [step,name,names] of groups){
   const visible=names.filter(n=>fieldsFor(d.mode).includes(n));if(!visible.length)continue;
   const section=el('section',{class:'field-section'});section.append(append(el('h3'),el('span',{class:'step'},step),doc.createTextNode(name)));
   for(const name of visible){
    const id=`te01-${key}-${name}`,label=fieldLabel(name,d.mode),wrapper=el('div',{class:'field'}),labelNode=el('label',{for:id},label);let input;
    const options=name==='kind'?[['ordinary','普通任務'],['appointment','預約']]:name==='assigneeUserId'?[['','請選擇合資格成員'],['demo-owner','合成家長'],['demo-carer','合成照顧者']]:name==='outcome'?[['','請明確選擇終態'],['completed','覆核為已完成'],['cancelled','覆核為已取消']]:null;
    if(options){input=el('select',{id,name,'data-field':''});for(const [value,label]of options)input.append(el('option',{value},label));}
    else input=el(['note','details'].includes(name)?'textarea':'input',{id,name,'data-field':'',...(name==='dueAt'?{placeholder:'2026-11-06T09:30:00+08:00',spellcheck:'false'}:name==='timeZone'?{list:'te01-zones',spellcheck:'false'}:{})});
    if(input.tagName==='TEXTAREA')input.rows=3;
    if(name==='title')input.maxLength=160;if(name==='details')input.maxLength=2000;if(name==='note')input.maxLength=1000;
    input.value=d.values[name];const message=el('p',{id:`${id}-message`,class:'field-message'});input.setAttribute('aria-describedby',message.id);
    const live=()=>alive&&binding.current()&&owner.read().draft?.key===key;
    const lease={};
    const startComposition=()=>{if(!live()||input.disabled)return;composing.add(input);compositionSessions.set(input,{binding,key,name,lease});const r=binding.beginComposition(key,name,lease);if(r.status!=='accepted'){composing.delete(input);compositionSessions.delete(input);}};
    const inputEvent=e=>{if(!live())return;if(e.isComposing){if(!composing.has(input))startComposition();return;}if(composing.has(input))return;binding.edit(key,name,input.value);};
    input.addEventListener(options?'change':'input',inputEvent);
    input.addEventListener('compositionstart',startComposition);
    input.addEventListener('compositionend',()=>{composing.delete(input);compositionSessions.delete(input);if(live())binding.edit(key,name,input.value,lease);});
    append(wrapper,labelNode,input,message);section.append(wrapper);controls.set(name,input);messages.set(name,message);
   }fields.append(section);
  }
  const zones=el('datalist',{id:'te01-zones'});for(const zone of ['Asia/Hong_Kong','Asia/Taipei','Asia/Tokyo','Europe/London','America/New_York','Australia/Sydney','UTC'])zones.append(el('option',{value:zone}));fields.append(zones);
  fields.append(el('p',{class:'hint'},'日期欄保留明確時差；時區另存，不會偷偷改成裝置時區。離線可整理已存在的草稿，不能提交。'));
  function revealReviewTarget(result,origin,target,revision){
   const current=()=>{const now=owner.read();return alive&&binding.current()&&now.epoch===result.epoch&&now.draft?.key===key&&now.revision===revision&&result.revision===revision;};
   if(!current()||doc.activeElement!==origin)return;
   safeFocus(target);
   if(current()&&doc.activeElement===target&&target?.isConnected&&!target.closest('[hidden],[inert]')&&!target.disabled)(target.closest('.field')??target).scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'instant'});
  }
  const preview=button('review','預覽家庭共享內容',origin=>{
   if(!binding.current()||owner.read().draft?.key!==key)return;
   if([...composing].some(n=>form.contains(n))){announce('請先完成正在輸入的文字，再預覽。');return;}
   const revision=owner.read().revision+1,r=binding.review(key),after=owner.read();
   if(r.status==='invalid'&&doc.activeElement===origin){const first=[...controls].find(([name])=>after.draft?.errors[name]);if(first)revealReviewTarget(r,origin,first[1],revision);}
   else if(r.status==='accepted'&&after.draft?.key===key&&after.operation.state==='needs_confirmation'&&doc.activeElement===origin)revealReviewTarget(r,origin,reviewHeading,revision);
  },'primary');fields.append(preview);
  const review=el('section',{'data-review':'',class:'review-panel',hidden:true,'aria-labelledby':'te01-review-title'}),reviewHeading=el('h3',{id:'te01-review-title',tabindex:'-1'},'核對這次家庭共享安排'),reviewSummary=el('div',{class:'review-summary'}),confirmation=el('input',{type:'checkbox',name:'confirmation',id:`te01-${key}-confirm`}),confirmLabel=append(el('label',{for:confirmation.id,class:'confirmation'}),confirmation,doc.createTextNode('我已核對內容、負責人、時間及版本，確認這次家庭共享安排'));
  confirmation.addEventListener('change',()=>{if(alive&&binding.current())binding.confirm(key,confirmation.checked);});
  const submit=button('submit',d.mode==='create'?'確認建立共享事項':'確認保存更改',()=>{if(binding.current())binding.submit(key);},'primary');
  const editAgain=button('edit-again','繼續修改草稿',origin=>{const r=binding.editAgain(key);focusAfter(r,origin,controls.values().next().value);});
  append(review,reviewHeading,el('p',{class:'badge'},'預覽內容 · 尚未保存'),reviewSummary,el('p',{},'只確認這次家庭共享安排。建立事項不代表機構確認預約，也不代表已通知照顧者。'),confirmLabel,append(el('div',{class:'actions'}),submit,editAgain));
  const comparison=el('section',{'data-comparison':'',class:'comparison',hidden:true}),original=el('div'),latest=el('div'),rebaseMessage=el('p'),rebase=button('rebase','保留草稿並使用最新版本',origin=>rebaseAndReveal(origin,binding,key));
  append(comparison,el('h3',{},'版本衝突 · 原操作沒有保存'),append(el('div',{class:'compare-columns'}),original,latest),rebaseMessage,rebase);
  append(columns,fields,review);append(form,columns,comparison);form.addEventListener('submit',e=>e.preventDefault());workspace.append(form);
  return {key,form,stage,heading,basisLine,fields,basis,errorSummary,controls,messages,preview,review,reviewHeading,reviewSummary,confirmation,submit,editAgain,comparison,original,latest,rebaseMessage,rebase};
 }
 function renderDraft(s){
  const d=s.draft;if(!d){if(draftUI){draftUI.form.remove();draftUI=null;composing.clear();compositionSessions.clear();}return;}
  if(!draftUI||draftUI.key!==d.key){if(draftUI)draftUI.form.remove();composing.clear();compositionSessions.clear();draftUI=makeDraft(s);}
  const u=draftUI,locked=s.reading||s.access!=='editable'||['saving','unknown','conflict'].includes(s.operation.state),reviewed=!!d.reviewed;
  text(u.stage,currentLayout==='care'?(reviewed&&s.operation.state!=='conflict'?'02 / 核對家庭共享安排':'01 / 整理這次安排'):'家庭照護手冊 / 安排與核對');
  text(u.basisLine,d.basis?`以版本 ${d.basis.version} 作基準；草稿尚未保存。`:'新增一項明確的家庭共享安排。');
  u.basis.hidden=!d.basis;if(d.basis)snapshot(u.basis,d.basis,'原基準');
  text(u.errorSummary,Object.keys(d.errors).length?`有 ${Object.keys(d.errors).length} 個欄位需要核對。`:'');
  for(const [name,input]of u.controls){if(!composing.has(input)&&input.value!==d.values[name])input.value=d.values[name];input.disabled=locked;input.setAttribute('aria-invalid',String(!!d.errors[name]));const help=name==='dueAt'?'例：2026-11-06T09:30:00+08:00；不可省略時差。':name==='timeZone'?'時區會保留在任務安排中，例如 Asia/Hong_Kong。':'';text(u.messages.get(name),d.errors[name]??help);u.messages.get(name).classList.toggle('error',!!d.errors[name]);}
  u.fields.hidden=currentLayout==='care'&&reviewed&&s.operation.state!=='conflict';u.preview.disabled=locked||d.composingFields.length>0;u.review.hidden=!reviewed;
  if(reviewed){u.reviewSummary.replaceChildren();const v=d.reviewed;for(const name of fieldsFor(d.mode)){const value=name==='assigneeUserId'?PEOPLE[v[name]]??'原負責人待核對':name==='kind'?(v.kind==='ordinary'?'普通任務':'預約'):name==='outcome'?(v.outcome==='completed'?'已完成':'已取消'):v[name]||'沒有備註';u.reviewSummary.append(append(el('p'),el('strong',{},`${fieldLabel(name,d.mode)}：`),doc.createTextNode(value)));}if(['create','reschedule'].includes(d.mode))u.reviewSummary.append(el('p',{class:'local-time'},`當地顯示：${displayTime(v.dueAt,v.timeZone)} · ${v.timeZone}`));}
  u.confirmation.checked=d.confirmed;u.confirmation.disabled=locked||d.composingFields.length>0;u.submit.disabled=d.composingFields.length>0||!d.confirmed||!s.online||locked||s.operation.state!=='needs_confirmation';u.editAgain.disabled=locked;
  u.comparison.hidden=!(s.operation.state==='conflict'&&s.latest&&d.basis);
  if(!u.comparison.hidden){snapshot(u.original,d.basis,'原基準');snapshot(u.latest,s.latest,'最新安排');const canRebase=allowed(s.latest,d.mode);u.rebase.disabled=!s.online||s.reading||!canRebase;text(u.rebaseMessage,canRebase?'只有明確選擇才換基準。草稿保留，之後仍須重新預覽及勾選確認。':'最新狀態已不接受這項操作。請放棄草稿，再按最新狀態選擇；不能重開已結束事項。');}
 }
 function render(){
  if(!alive)return;const s=owner.read(),previousActive=doc.activeElement,wasOwned=root.contains(previousActive),scopeChanged=epoch!==null&&epoch!==s.epoch;
  if(epoch!==s.epoch){epoch=s.epoch;port=owner.bind();lastTaskKey=null;if(draftUI){draftUI.form.remove();draftUI=null;composing.clear();compositionSessions.clear();}removeDialog(false);}
  shell.dataset.layout=currentLayout;care.setAttribute('aria-pressed',String(currentLayout==='care'));handbook.setAttribute('aria-pressed',String(currentLayout==='handbook'));
  text(scopeLabel,s.scope==='demo-a'?'合成孩子 A':'合成孩子 B');text(onlineLabel,s.online?'在線示例':'離線示例');text(roleLabel,s.access==='editable'?'可編輯':s.access==='read_only'?'只讀':'權限已撤回');
  const op=s.operation;operation.hidden=op.state==='none';text(opTitle,({needs_confirmation:'待本人確認',saving:'處理中',unknown:op.committed?'已提交，待更新結果':'保存結果未確認',conflict:'版本需要核對',saved:'合成操作已確認'})[op.state]??'操作狀態');text(opText,op.message);text(reference,op.reference?`合成參考：${op.reference}（不是 Server opId）`:'');
  syncRecovery(s);recovery.check.hidden=!(op.state==='unknown'&&!op.committed);recovery.retry.hidden=!(op.state==='unknown'&&op.checked&&!op.committed);recovery.reload.hidden=!(op.state==='conflict'||op.state==='unknown'&&op.committed);for(const n of Object.values(recovery))n.disabled=!s.online||s.reading||s.access==='lost';
  detail.hidden=!s.panelOpen||s.access==='lost';closed.hidden=s.panelOpen||s.access==='lost';unavailable.hidden=s.access!=='lost';workspace.hidden=!s.draft;
  if(s.task){
   text(detailTitle,s.task.title);text(description,s.task.details);facts.replaceChildren();for(const [label,value]of [['狀態',stateLabels[s.task.occurrence.state]],['負責人',PEOPLE[s.task.assigneeUserId]??'原負責人待核對'],['安排時間',displayTime(s.task.occurrence.dueAt,s.task.occurrence.timeZone)],['原時區',s.task.occurrence.timeZone],['版本',String(s.task.version)],['種類',s.task.kind==='ordinary'?'普通任務':'預約']])facts.append(append(el('div'),el('span',{class:'meta'},label),el('strong',{},value)));
   text(reminder,s.reminder==='unknown'?'提醒處理結果未知，不能當作已通知或已完成。這與本次保存狀態分開。':s.reminder==='stopped'?'提醒已停止。終態仍以此項事項的版本為準。':'這個版本尚無可核對的本人站內提醒；不代表已通知或從未安排。');
   terminal.hidden=!['completed','cancelled'].includes(s.task.occurrence.state);
   const taskKey=`${s.epoch}:${s.task.id}:${s.task.version}:${s.access}`;
   if(lastTaskKey!==taskKey){lastTaskKey=taskKey;detailActions.replaceChildren();const binding=port,version=s.task.version,id=s.task.id;
    for(const mode of ['reschedule','complete','cancel','resolve','create'])if(allowed(s.task,mode)&&s.access==='editable')detailActions.append(button(`start-${mode}`,labels[mode],origin=>{const now=owner.read();if(!binding.current()||now.task?.id!==id||now.task.version!==version)return;const r=binding.start(mode);focusAfter(r,origin,workspace.querySelector('[data-field]'));},mode==='complete'?'primary':'secondary'));
   }
   detailActions.hidden=!!s.draft;for(const n of detailActions.querySelectorAll('button'))n.disabled=!s.online||s.reading||['saving','unknown','conflict'].includes(op.state);
  }else{detailTitle.textContent='';description.textContent='';facts.replaceChildren();detailActions.replaceChildren();reminder.textContent='';}
  renderDraft(s);
  deliver.disabled=op.state!=='saving';confirmReceipt.disabled=op.state!=='unknown'||op.committed;reply.disabled=op.state!=='saving';for(const option of reply.options)option.disabled=!!s.command&&s.command.kind==='create'&&['conflict','terminal-conflict'].includes(option.value);if(reply.selectedOptions[0]?.disabled)reply.value='success';
  loadScenario.disabled=!!s.draft||['saving','unknown'].includes(op.state)||s.access==='lost';scenario.disabled=loadScenario.disabled;revoke.disabled=s.access==='lost';restore.hidden=s.access!=='lost';text(online,s.online?'切為離線':'回復在線');text(count,`本次合成送出：${s.submissions.length} 次；收據查核 ${s.receiptLookups} 次。同一原操作的明確重試會先再查核，再沿用原參考。`);
  if(dialog&&dialog.epoch!==s.epoch)removeDialog(false);
  if(wasOwned&&!previousActive.isConnected&&(doc.activeElement===doc.body||doc.activeElement===null))safeFocus(scopeChanged?title:s.panelOpen?detailTitle:closed.querySelector('button'));
 }
 const unsubscribe=owner.subscribe(render);
 function beforeUnload(e){const s=owner.read();if(s.draft||['saving','unknown'].includes(s.operation.state)){e.preventDefault();e.returnValue='';}}
 win.addEventListener('beforeunload',beforeUnload);render();
 return {destroy(){if(!alive)return;alive=false;unsubscribe();for(const {binding,key,name,lease}of compositionSessions.values())binding.cancelComposition(key,name,lease);win.removeEventListener('beforeunload',beforeUnload);removeDialog(false);composing.clear();compositionSessions.clear();shell.remove();}};
}

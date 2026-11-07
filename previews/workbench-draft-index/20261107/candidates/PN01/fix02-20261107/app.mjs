import {createState,transition,mayRead,mayDelete,mayRetry} from './model.mjs';
import {fixturePage} from './fixtures.mjs';
export function mount(root,document){
 let state=createState(),operationSequence=0,disposed=false,refs={},dialog=null,lastOrigin=null;
 const el=(tag,text='',attrs={})=>{const n=document.createElement(tag);n.textContent=text;for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(attrs.id)refs[attrs.id]=n;return n;};
 const status=el('p','',{id:'status',role:'status','aria-live':'polite','aria-atomic':'true'}),content=el('div');
 root.replaceChildren(status,content);
 const btn=(id,label,fn,disabled=false)=>{const n=el('button',label,{id,type:'button'});n.disabled=disabled;n.addEventListener('click',fn);return n;};
 const send=(type,extra={})=>dispatch({type,...extra});
 const meta=n=>`${n.provenance==='imported_source'?'匯入交代':'本人交代'} · 版本 ${n.version} · ${new Date(n.updatedAt).toLocaleString('zh-HK',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}（香港時間）`;
 let composing=false;
 const frame=el('div','',{class:'shell'}),panel=el('div');
 frame.append(el('p','PN01 · 私人備註合成核對冊',{class:'eyebrow'}),el('h1','把每一則交代，看清楚。'),el('p','合成示例：只使用本頁記憶體資料，不連接正式 owner/backend，不會讀取或更改真實備註。',{class:'permanent'}));
 const toolbar=el('section','',{class:'toolbar','aria-label':'搜尋與讀取'}),form=el('form','',{id:'search-form'}),label=el('label','搜尋私人備註',{for:'query'});
 function createQueryInput(){
  const node=el('input','',{id:'query',maxlength:'200',type:'search',placeholder:'輸入「示例」或「空頁」'}),epoch=state.epoch,scopeKey=state.scopeKey;
  // A retired node must never finish or restart composition in a newer epoch.
  const current=()=>{
   if(disposed||node!==input||epoch!==state.epoch||scopeKey!==state.scopeKey||!node.isConnected){node.value='';return false;}
   return true;
  };
  node.addEventListener('compositionstart',()=>{if(current()&&!node.disabled)composing=true;});
  node.addEventListener('compositionend',()=>{if(current()){composing=false;if(node.disabled)node.value=state.queryDraft;else send('QUERY_DRAFT',{value:node.value});}});
  node.addEventListener('input',e=>{if(current()){if(node.disabled)node.value=state.queryDraft;else if(!composing&&!e.isComposing)send('QUERY_DRAFT',{value:node.value});}});
  return node;
 }
 let input=createQueryInput();
 form.addEventListener('submit',e=>{e.preventDefault();if(!composing)send('READ_START');});
 const readButton=btn('read','讀取合成備註',()=>send('READ_START')),refreshButton=btn('refresh','重新核對已載入範圍',()=>send('READ_START',{keepQuery:true}));
 form.append(label,input,readButton,refreshButton);
 toolbar.append(form,el('p','預定合成回應：留空＝全部；「示例」＝兩則；「空頁」＝先空頁再續讀。其他搜尋不模擬後端結果。',{class:'muted'}));frame.append(toolbar,panel);content.append(frame);
 const fixedRefs={...refs};
 function render(focusId=null,selection=null){
  refs={...fixedRefs};if(dialog?.open)dialog.close();dialog=null;
  if(!composing&&input.value!==state.queryDraft)input.value=state.queryDraft;
  input.disabled=!!state.busy||!!state.pending||!!state.externalPending||state.policyState==='denied';
  readButton.disabled=!mayRead(state);refreshButton.disabled=!mayRead(state)||!state.loadedRange;
  const shell=el('div');
  if(state.writesBlocked||state.externalPending||state.policyState==='denied')shell.append(el('p',`外部合成鎖：${state.externalPending==='policy'?'policy 待核對':state.policyState==='denied'?'policy denied':'writesBlocked'}。備註操作不能解除。`,{class:'warning'}));
  if(!state.online)shell.append(el('p','合成離線；不會自動重試。',{class:'warning'}));
  if(state.notesState==='failed')shell.append(el('p',state.notice,{role:'alert',class:'warning'}));
  const layout=el('div','',{class:`layout ${state.selectedId?'has-detail':''}`}),index=el('section','',{class:'index','aria-label':'私人備註索引'});
  index.append(el('h2','私人備註索引'),el('p',`已載入 ${state.notes.length} 則 · 每次回應最多 20 則`,{class:'muted'}));
  const list=el('ul');for(const n of state.notes){const li=el('li'),b=btn('note-'+n.id,n.title,()=>send('SELECT',{id:n.id}));b.setAttribute('aria-pressed',String(state.selectedId===n.id));li.append(b,el('p',meta(n),{class:'muted'}));list.append(li);}index.append(list);
  if(!state.notes.length)index.append(el('p',state.notesState==='ready'?`已載入頁面暫無匹配。${state.nextAfterId?'仍有掃描範圍，可繼續讀取。':''}`:'尚未載入可核對的合成內容。'));
  if(state.nextAfterId)index.append(btn('more','讀取下一頁',()=>send('READ_START',{more:true}),!mayRead(state,true)));
  layout.append(index);
  const detail=el('section','',{id:'detail',class:'detail','aria-label':'備註核對詳情'}),note=state.notes.find(n=>n.id===state.selectedId);
  if(note){detail.append(btn('back','返回索引',()=>send('BACK')),el('h2',note.title,{id:'detail-title',tabindex:'-1'}),el('p',meta(note),{class:'meta'}),el('p','只供本人查看，不代表已確認健康事實。',{class:'muted'}),el('p',note.text,{id:'note-body',class:'body-copy'}));if(note.sourceMessageId)detail.append(el('p',`來源聊天：${note.sourceMessageId}`,{class:'source'}));else detail.append(el('p','匯入來源標籤不是本地授權或健康事實。',{class:'muted'}));detail.append(btn('delete','模擬刪除此備註',()=>send('DELETE_OPEN',{id:note.id}),!mayDelete(state,note.id)));}
  else detail.append(el('h2','選一則備註開始核對'),el('p','右側會顯示完整正文、來源和版本。選取不代表確認、保存或刪除。',{class:'muted'}));
  layout.append(detail);shell.append(layout);
  if(state.pending){const p=state.pending,pendingEpoch=state.epoch,box=el('section','',{class:'pending','aria-label':'原操作核對'});box.append(el('h2','原合成操作待核對'),el('p',p.note.title),el('p',p.note.text,{id:'pending-body',class:'body-copy'}),el('p',`原版本 ${p.input.expectedVersion} · 原操作 ${p.input.operationId}`,{class:'source'}),el('p','synthetic 序號只供本地演示，不是 API operationId 規格或後端冪等驗證。',{class:'muted'}),btn('review','先讀取原操作資料',()=>send('READ_START'),!mayRead(state)),btn('retry','明確重試相同原操作',()=>send('RETRY_ORIGINAL',{operationId:p.input.operationId,reviewId:p.reviewId,scopeKey:p.input.scopeKey,epoch:pendingEpoch}),!mayRetry(state)));shell.append(box);}
  const controls=el('section','',{class:'controls','aria-label':'合成測試控制'});controls.append(el('h2','合成測試控制'),el('p','以下只決定本頁預定回應。沒有背景請求；按結果按鈕才結束讀取或操作。',{class:'muted'}));
  if(state.request){const request=state.request,pending=state.pending;controls.append(btn('read-success','完成這一頁合成讀取',()=>{let page=fixturePage(request.query,request.after);page={...page,items:page.items.map(n=>state.fixtureVersions[n.id]?{...n,version:state.fixtureVersions[n.id]}:n)};send('READ_RESULT',{requestId:request.id,page});}),btn('read-fail','模擬讀取失敗',()=>send('READ_FAIL',{requestId:request.id})));}
  if(state.busy==='write'&&state.pending){const operationId=state.pending.input.operationId,attemptId=state.writeAttempt;for(const [outcome,label] of [['confirmed','確認完成'],['unknown','傳輸未知'],['false','回應 false'],['not_found','找不到原項目'],['conflict','版本衝突']])controls.append(btn('outcome-'+outcome,`模擬：${label}`,()=>send('DELETE_RESULT',{operationId,attemptId,outcome})));}
  controls.append(btn('offline',state.online?'模擬離線':'模擬重新連線',()=>send('SET_ONLINE',{online:!state.online})),btn('scope','切換合成 scope（清除本頁私有內容）',()=>send('SCOPE_CHANGE',{scopeKey:state.scopeKey==='synthetic-owner-a'?'synthetic-owner-b':'synthetic-owner-a'})),btn('write-lock','切換外部 writesBlocked',()=>send('SET_EXTERNAL_LOCK',{writesBlocked:!state.writesBlocked,externalPending:state.externalPending})),btn('policy-lock','切換外部 policy pending',()=>send('SET_EXTERNAL_LOCK',{writesBlocked:state.writesBlocked,externalPending:state.externalPending?null:'policy'})),btn('reset','重設整個合成演示（不是復原刪除）',()=>send('RESET_SCENARIO')));
  shell.append(controls);panel.replaceChildren(shell);
  if(status.textContent!==state.notice)status.textContent=state.notice;
  if(state.deleteSelection){const d=state.deleteSelection,n=state.notes.find(n=>n.id===d.id);dialog=el('dialog','',{id:'delete-dialog','aria-labelledby':'delete-title','aria-describedby':'delete-description'});dialog.append(el('h2','模擬刪除此私人備註？',{id:'delete-title'}),el('p',`「${n.title}」版本 ${n.version}。只移除本頁合成示例，真實備註不變。`,{id:'delete-description'}));const cancel=btn('cancel','保留',()=>send('DELETE_CANCEL')),confirm=btn('confirm','確認合成刪除',()=>send('DELETE_CONFIRM',{operationId:`synthetic-${++operationSequence}`,selection:d}),!mayDelete(state,n.id));dialog.append(cancel,confirm);dialog.addEventListener('cancel',e=>{e.preventDefault();send('DELETE_CANCEL');});dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();send('DELETE_CANCEL');}else if(e.key==='Tab'){if(e.shiftKey&&document.activeElement===cancel){e.preventDefault();(confirm.disabled?cancel:confirm).focus();}else if(!e.shiftKey&&(document.activeElement===confirm||confirm.disabled)){e.preventDefault();cancel.focus();}}});shell.append(dialog);dialog.showModal();cancel.focus();}
  else if(focusId){
   const eligible=n=>n?.isConnected&&!n.disabled;
   const target=[refs[focusId],refs['read-success'],refs['review'],refs['read'],refs['query'],refs['scope']].find(eligible);
   if(target){target.focus();if(selection&&target===input&&input.setSelectionRange&&!composing)input.setSelectionRange(...selection);}
  }
 }
 function dispatch(event){if(disposed)return;const active=document.activeElement,id=active?.getAttribute?.('id'),selection=id==='query'?[active.selectionStart,active.selectionEnd]:null,previous=state;state=transition(state,event);if(state===previous)return;
  if(state.epoch!==previous.epoch){
   input.value='';input.disabled=true;composing=false;
   input=createQueryInput();fixedRefs.query=input;form.replaceChildren(label,input,readButton,refreshButton);
  }
  if(event.type==='QUERY_DRAFT'){if(!composing&&input.value!==state.queryDraft)input.value=state.queryDraft;return;}
  let focus=id;if(event.type==='SELECT')focus='detail-title';if(event.type==='BACK')focus='note-'+previous.selectedId;if(event.type==='DELETE_OPEN')lastOrigin='delete';if(event.type==='DELETE_CANCEL'||previous.deleteSelection&&!state.deleteSelection)focus=lastOrigin;if(event.type==='SCOPE_CHANGE'||event.type==='RESET_SCENARIO')focus='read';if(event.type==='DELETE_RESULT')focus=state.pending?'review':'read';render(focus,state.epoch===previous.epoch?selection:null);
 }
 render();return {dispatch,getState:()=>state,destroy(){disposed=true;if(dialog?.open)dialog.close();root.replaceChildren();}};
}
if(typeof document!=='undefined'){const root=document.getElementById('app');if(root)mount(root,document);}

import {scenarios} from './host.mjs';
// Presentation state is staging/search only. Selection is always read from host.
export function mount(root,host,{layout='A'}={}){
 const d=root.ownerDocument;
 let surface=layout,staged=null,query='',layer=null,serial=0,destroyed=false,lastEpoch=host.getSnapshot().epoch,composition=null;
 const inputHandlers=new WeakMap();
 function bindSearch(node,handlers){
  if(!inputHandlers.has(node))for(const name of ['input','compositionstart','compositionend'])node.addEventListener(name,event=>inputHandlers.get(node)?.[name](event));
  inputHandlers.set(node,handlers);
 }
 const el=(tag,text,attrs={})=>{const n=d.createElement(tag);if(text!==null&&text!==undefined)n.textContent=text;for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
 function render(s=host.getSnapshot(),focusKey=null){
  if(destroyed||s!==host.getSnapshot())return;
  const previousActive=d.activeElement,ownedFocus=root.contains(previousActive),previousKey=ownedFocus?previousActive?.getAttribute('data-focus'):null;
  const cursor=previousActive?.tagName==='INPUT'?[previousActive.selectionStart,previousActive.selectionEnd,previousActive.selectionDirection]:null;
  const hard=s.epoch!==lastEpoch;
  if(hard){lastEpoch=s.epoch;staged=null;query='';layer=null;}
  if(s.status.kind==='confirmation'){if(layer!=='confirm'&&ownedFocus)focusKey='cancel-confirm';layer='confirm';}
  else if(layer==='confirm')layer=null;
  if(hard||layer!=='commands')composition=null;
  const oldSearch=root.querySelector('#cp-search');
  const oldDialog=oldSearch?.closest('[role="dialog"]');
  const retainSearch=!hard&&layer==='commands'&&oldSearch?.isConnected&&oldDialog?.dataset.layer==='commands';
  // The live field is the source of in-progress text, including composition updates
  // not yet delivered as input. Keep its connected ancestors and selection untouched.
  if(retainSearch)query=oldSearch.value;
  const thisRender=++serial,b=host.binding();
  const current=()=>!destroyed&&thisRender===serial&&host.isCurrent(b);
  const button=(text,attrs,fn)=>{const n=el('button',text,{type:'button',...attrs});n.addEventListener('click',()=>{if(current())fn();});return n;};
  const frame=el('div',null,{class:`cp-app layout-${surface}`,'data-surface':surface});
  const backdrop=el('div',null,{'data-background':''});frame.append(backdrop);
  const top=el('header',null,{class:'topline'});top.append(el('span','育伴港 / 選配工作台',{class:'brand'}),el('span','CP01 · 全部為合成示例',{class:'synthetic'}));backdrop.append(top);
  const variants=el('nav',null,{'aria-label':'比較呈現方式',class:'variants'});
  for(const [key,name] of [['A','A 同行名冊'],['B','B 身份指令台']])variants.append(button(name,{'data-layout':key,'data-focus':`layout-${key}`,'aria-pressed':surface===key},()=>{surface=key;layer=null;staged=null;query='';render(host.getSnapshot(),`layout-${key}`);}));backdrop.append(variants);
  const intro=el('div',null,{class:'intro'});intro.append(el('p',surface==='A'?'每一次切換，都知道正與誰同行。':'先確認現在，再選擇下一位。',{class:'eyebrow'}),el('h1',surface==='A'?'同行名冊':'身份指令台'));backdrop.append(intro);
  const context=s.currentContext,currentName=context.label;
  const active=el('section',null,{class:'current-context','data-current':'','aria-labelledby':'cp-current-heading'});
  active.append(el('span',s.sharedTarget?'◌':'✦',{class:'context-emblem','aria-hidden':'true'}));
  const currentCopy=el('div');currentCopy.append(el('p','目前範圍',{class:'eyebrow'}),el('h2',currentName,{id:'cp-current-heading',tabindex:'-1','data-focus':'current'}),el('p',context.detail));active.append(currentCopy);
  if(surface==='B')active.append(button('切換個人孩子',{'data-action':'open','data-focus':'open','aria-expanded':layer==='commands','aria-haspopup':'dialog'},()=>{layer='commands';query='';render(host.getSnapshot(),'search');}));backdrop.append(active);
  const workspace=el('div',null,{class:'workspace'});backdrop.append(workspace);
  function stateText(){return !context.identityReady?'目前身份尚未核對，個人孩子清單暫不展示。':{unknown:'尚未核對個人孩子清單，不能當成沒有孩子。',empty:'已核對，目前沒有個人孩子。',loading:'正在核對個人孩子清單，請稍候。',error:'未能讀取個人孩子清單，尚未切換。'}[s.listState];}
  const choices=el('section',null,{class:'roster','data-choices':'','aria-labelledby':'cp-personal-title'});choices.append(el('h2','個人孩子',{id:'cp-personal-title'}),el('p','此處只列個人孩子，不含其他共享目標。',{class:'muted'}));
  if(!context.rosterReady)choices.append(el('p',stateText(),{class:'empty-note'}));
  if(surface==='A'){
   const cards=el('div',null,{class:'cards'});
   for(const c of context.rosterReady?s.children:[]){const card=button('',{'data-stage':c.id,'data-focus':`stage-${c.id}`,class:`child-card${staged===c.id?' staged':''}`,'aria-pressed':staged===c.id},()=>{staged=c.id;render(host.getSnapshot(),`stage-${c.id}`);});card.append(el('span',c.emblem,{class:'emblem','aria-hidden':'true'}),el('strong',c.name),el('span',s.selectedChoiceId===c.id?'目前孩子':'查看切換目的地',{class:'card-caption'}));cards.append(card);}choices.append(cards);workspace.append(choices);
   const proposal=el('aside',null,{class:'proposal','data-proposal':'','aria-labelledby':'cp-proposal-title'});proposal.append(el('p','切換前看一眼',{class:'eyebrow'}),el('h2',staged?'這次想與誰同行？':'先選一張個人孩子卡',{id:'cp-proposal-title'}));const target=s.children.find(c=>c.id===staged);
   if(target){proposal.append(el('p',`從 ${currentName}`,{class:'from'}),el('strong',`到 ${target.name}`,{class:'target'}),button(`切換到${target.name}`,{'data-action':'commit-stage','data-focus':'commit-stage',class:'primary'},()=>host.requestPersonal(target.id,b)));}else proposal.append(el('p','查看卡片不會切換孩子。下一步仍由你明確提出。'));workspace.append(proposal);
  }else workspace.append(choices);
  const shared=el('section',null,{class:'shared-shelf','data-shared':'','aria-labelledby':'cp-shared-title'});shared.append(el('h2','目前共享範圍',{id:'cp-shared-title'}));
  if(context.shared){const view=context.shared;shared.append(el('strong',`${view.childName} · ${view.spaceName}`),el('p',`已核對的目前選擇 · ${view.role==='viewer'?'閱讀者':'成員'}`),el('p',`示例可見模組：${view.modules.join('、')}`),el('p','這是目前範圍的說明，不是共享孩子清單，也不是切換或授權按鈕。',{class:'muted'}));}
  else shared.append(el('p',!context.identityReady?'目前身份尚未核對，未展示共享資料。':s.sharedTarget?'目前共享核對未完成，沒有可展示的共享孩子資料。':'目前沒有展示共享範圍。'));backdrop.append(shared);
  const status=el('p',s.status.message,{role:'status','aria-live':'polite','aria-atomic':'true',class:`status status-${s.status.kind}`});backdrop.append(status);
  const details=el('details',null,{class:'evidence'});details.append(el('summary','合成情境與驗證邊界'));
  details.append(el('p','只改這個頁面的記憶體示例。沒有真實家庭、API、儲存、模型或權限變更。畫面仍待獨立覆核及真瀏覽器／原生驗收。'));
  const demo=el('div',null,{class:'demo-controls','aria-label':'切換合成情境'});for(const [id,label]of scenarios)demo.append(button(label,{'data-scenario':id,'aria-pressed':s.scenario===id},()=>host.setScenario(id)));details.append(demo);
  if(s.status.kind==='dispatched')details.append(button('讓合成 owner 發布結果',{'data-action':'settle','data-focus':'settle'},()=>host.settle(s.status.intent)),button('模擬不接納',{'data-action':'reject'},()=>host.settle(s.status.intent,{accept:false})));
  if(s.draft)details.append(el('p',s.draft,{'data-draft':''}));
  details.append(el('p','切換仍須保留既有離頁守衛與唯一資料 owner。這個候選不修復啟動／家庭／帳戶問題，不代表正式接線完成。'),el('p','來源：固定 2abe7aed 的 ChildPicker、ProductionProvider、ProductionOwner、RecordsController 與 home projection。清單未核對不等於零位，派送意圖不等於成功。'));
  backdrop.append(details);
  if(layer){
   backdrop.setAttribute('inert','');backdrop.setAttribute('aria-hidden','true');
   const overlay=el('div',null,{class:'overlay'}),dialog=el('section',null,{role:'dialog','data-layer':layer,'aria-modal':'true','aria-labelledby':'cp-dialog-title',class:`drawer ${layer==='confirm'?'confirmation':''}`});overlay.append(dialog);frame.append(overlay);
   if(layer==='confirm'){
    dialog.append(el('p','切換暫停',{class:'eyebrow'}),el('h2','尚有未儲存的修改',{id:'cp-dialog-title'}),el('p','確認切換會捨棄這份合成草稿；取消則保留。若操作變成處理中或結果未知，確認仍會被拒絕。'),el('p',s.draft,{class:'draft-preview'}));
    dialog.append(button('繼續編輯',{'data-action':'cancel-confirm','data-focus':'cancel-confirm'},()=>host.cancel(s.status.intent,b)),button('捨棄並切換',{'data-action':'confirm','data-focus':'confirm',class:'danger'},()=>host.confirm(s.status.intent,b)));
   }else{
    dialog.append(el('p','個人孩子指令',{class:'eyebrow'}),el('h2','切換到哪一位？',{id:'cp-dialog-title'}),button('關閉',{'data-action':'close','data-focus':'close'},()=>{layer=null;render(host.getSnapshot(),'open');}),el('label','搜尋個人孩子',{for:'cp-search'}));
    const search=el('input',null,{id:'cp-search',type:'search','data-focus':'search',placeholder:'輸入名字，不必記住指令'});search.value=query;
    bindSearch(search,{
     compositionstart:event=>{if(!current()||!event.currentTarget.isConnected)return;composition={node:event.currentTarget,epoch:s.epoch};},
     input:event=>{
     const input=event.currentTarget;if(!current()||!input.isConnected)return;
     if(event.isComposing)composition={node:input,epoch:s.epoch};
     query=input.value;render(host.getSnapshot(),'search');
    },
     compositionend:event=>{
     const input=event.currentTarget;if(!current()||!input.isConnected)return;
     composition=null;query=input.value;render(host.getSnapshot(),'search');
    }});dialog.append(search);
    const results=el('div',null,{'data-results':'',class:'commands'});const matching=s.children.filter(c=>c.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    if(!context.rosterReady)results.append(el('p',stateText()));else if(!matching.length)results.append(el('p','沒有符合的個人孩子。'));
    else for(const c of matching){const n=button('',{'data-select':c.id,'data-focus':`select-${c.id}`,class:'command'},()=>{layer=null;host.requestPersonal(c.id,b);});n.append(el('span',c.emblem,{'aria-hidden':'true',class:'small-emblem'}),el('strong',c.name),el('span',s.selectedChoiceId===c.id?'目前':'提出切換'));results.append(n);}dialog.append(results,el('p','共享範圍只能查看目前已核對的那一位，不能從這裡新增共享選擇。',{class:'muted'}));
   }
   dialog.onkeydown=event=>{
    const liveDialog=event.currentTarget;
    if(!current()||!liveDialog||liveDialog!==root.querySelector('[role="dialog"]'))return;
    if(event.key==='Escape'&&(event.isComposing||event.keyCode===229||composition?.epoch===s.epoch&&composition.node.isConnected))return;
    if(event.key==='Escape'){event.preventDefault();if(layer==='confirm')host.cancel(s.status.intent,b);else{layer=null;render(host.getSnapshot(),'open');}return;}
    if(event.key==='Tab'){const controls=[...liveDialog.querySelectorAll('button:not([disabled]),input')];const first=controls[0],last=controls.at(-1);if(event.shiftKey&&d.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&d.activeElement===last){event.preventDefault();first?.focus();}}
   };
  }
  const wasDetailsOpen=root.querySelector('details')?.open;details.open=!!wasDetailsOpen;
  if(retainSearch){
   const liveFrame=root.firstElementChild,nextDialog=frame.querySelector('[role="dialog"]'),nextSearch=nextDialog.querySelector('#cp-search');
   liveFrame.replaceChild(backdrop,liveFrame.querySelector('[data-background]'));
   // Never detach/reparent the live input or its dialog/overlay/frame ancestors.
   // Replace surrounding chrome and controls, and refresh handlers to this snapshot.
   for(const node of [...oldDialog.childNodes])if(node!==oldSearch)node.remove();
   let after=false;
   for(const node of [...nextDialog.childNodes]){
    if(node===nextSearch){after=true;continue;}
    if(after)oldDialog.append(node);else oldDialog.insertBefore(node,oldSearch);
   }
   bindSearch(oldSearch,inputHandlers.get(nextSearch));
   oldDialog.onkeydown=nextDialog.onkeydown;
  }else root.replaceChildren(frame);
  // All DOM writes are finished before focus, which may synchronously publish a new context.
  let target=null;
  if(hard&&ownedFocus)target=root.querySelector('[data-focus="current"]');
  else if(focusKey)target=[...root.querySelectorAll('[data-focus]')].find(n=>n.dataset.focus===focusKey);
  else if(ownedFocus){target=previousKey?[...root.querySelectorAll('[data-focus]')].find(n=>n.dataset.focus===previousKey):null;if(!target)target=root.querySelector('[data-focus="current"]');}
  if(target&&!(retainSearch&&target===oldSearch)){if(cursor&&target.tagName==='INPUT')try{target.setSelectionRange(...cursor);}catch{}target.focus();}
 }
 const unsubscribe=host.subscribe(s=>render(s));render();
 return {destroy(){if(destroyed)return;destroyed=true;composition=null;serial++;unsubscribe();root.replaceChildren();}};
}

import {deriveWindow,selectionKey,sameSelection,localAdmission,readAdmission,occupied,validateInput} from './model.mjs';
const statusNames={all:'全部',written:'已保存',confirmed:'已明確確認',not_required:'不需逐項確認',pending:'待處理',important_pending:'重要待確認',skipped:'已略過'};
const kindNames={note:'日常觀察',feeding:'飲食',sleep:'睡眠',diaper:'如廁／尿片',temperature:'體溫',measurement:'身高／體重',appointment:'預約'};
export function mount(root,host){
 const doc=root.ownerDocument,win=doc.defaultView;
 let disposed=false,epoch=-1,serial=0,ui=null,reader=null,rows=new Map(),pages=new Map(),focusSerial=0,composing=false;
 const controls=new WeakMap(),events=new WeakMap();
 const el=(tag,text='',className='')=>{const n=doc.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
 const set=(n,text)=>{if(n.textContent!==String(text))n.textContent=String(text);};
 const disable=(n,yes)=>n.setAttribute('aria-disabled',String(yes));
 function control(n,action,payload=null){n.dataset.controlId=`crh-${epoch}-${++serial}`;controls.set(n,{action,payload,epoch,id:n.dataset.controlId});return n;}
 function button(text,action,payload=null){const n=control(el('button',text),action,payload);n.type='button';n.dataset.action=action;return n;}
 function visible(n){
  if(!n?.isConnected||!root.contains(n)||n.disabled)return false;
  for(let a=n;a&&a.nodeType===1;a=a.parentElement){if(a.hidden||a.hasAttribute('inert')||a.getAttribute('aria-hidden')==='true')return false;const style=win.getComputedStyle(a);if(style.display==='none'||style.visibility==='hidden')return false;}
  return true;
 }
 function focus(n){if(visible(n)&&n.getAttribute('aria-disabled')!=='true')n.focus({preventScroll:false});}
 function capture(e){
  if(disposed)return;const n=e.target.closest?.('[data-control-id]');if(!n||!root.contains(n))return;
  const c=controls.get(n),s=host.getSnapshot();if(!c)return;
  events.set(e,{node:n,control:c,focusSerial,intent:{epoch:s.context.epoch,intent:s.intent,controlId:c.id,selection:s.local.selected}});
 }
 function valid(e){
  const captured=events.get(e),s=host.getSnapshot();
  return captured&&!disposed&&captured.control===controls.get(captured.node)&&captured.control.epoch===s.context.epoch&&captured.intent.intent===s.intent&&visible(captured.node)?captured:null;
 }
 function dispatch(e){
  const c=valid(e);if(!c)return;const s=host.getSnapshot(),n=c.node,action=c.control.action;
  if(e.type==='keydown'){
   if(e.key==='Escape'){
    if(!reader?.node.contains(e.target))return;
   }else if(e.key==='Enter'&&n===ui.query){if(e.isComposing||composing||e.keyCode===229)return;}
   else if(n.tagName!=='BUTTON'||!['Enter',' '].includes(e.key)||e.isComposing)return;
   e.preventDefault();
  }else if(e.type==='click'&&n.tagName!=='BUTTON')return;
  if(e.type==='input'&&n!==ui.query||e.type==='change'&&!['status','source'].includes(action))return;
  const key=s.local.selected,oldOpener=key?rows.get(JSON.stringify(key))?.opener:null;
  let result,focusTarget=null;
  if(e.type==='keydown'&&e.key==='Escape'){result=host.actions.close(c.intent);focusTarget='close';}
  else if(action==='query')result=e.type==='input'?host.actions.editQuery(n.value,c.intent):host.actions.applyQuery(c.intent);
  else if(action==='apply')result=host.actions.applyQuery(c.intent);
  else if(action==='status')result=host.actions.setStatus(n.value,c.intent);
  else if(action==='source')result=host.actions.setSource(n.value,c.intent);
  else if(action==='clear')result=host.actions.clearFilters(c.intent);
  else if(action==='layout')result=host.actions.setLayout(c.control.payload,c.intent);
  else if(action==='page')result=host.actions.setPage(c.control.payload,c.intent);
  else if(action==='previous-page')result=host.actions.setPage(s.local.page-1,c.intent);
  else if(action==='next-page')result=host.actions.setPage(s.local.page+1,c.intent);
  else if(action==='open'){
   const closing=s.local.layout==='a'&&sameSelection(c.control.payload,key);
   result=closing?host.actions.close(c.intent):host.actions.select(c.control.payload,c.intent);focusTarget=closing?'close':'reader';
  }else if(action==='close'){result=host.actions.close(c.intent);focusTarget='close';}
  else if(action==='previous-item'||action==='next-item'){result=host.actions.step(action==='previous-item'?-1:1,c.intent);focusTarget='reader';}
  else if(action==='metadata')result=host.actions.toggleMetadata(c.intent);
  else if(action==='reread')result=host.actions.reread(c.intent);
  else if(action==='jump'){focus(reader?.heading);return;}
  if(!result)return;
  const now=host.getSnapshot();
  if(!result.accepted){if(now.context.epoch===c.intent.epoch){set(ui.feedback,result.reason);if(n===ui.query)n.value=now.local.queryDraft;if(n===ui.status)n.value=now.local.status;if(n===ui.source)n.value=now.local.sourceKey;}return;}
  // All rendering was completed by synchronous subscription. No paint after focus.
  if(now.revision!==result.revision||now.context.epoch!==c.intent.epoch||focusSerial!==c.focusSerial)return;
  if(focusTarget==='reader')focus(reader?.heading);
  else if(focusTarget==='close')focus(visible(oldOpener)&&oldOpener.getAttribute('aria-disabled')!=='true'?oldOpener:ui.resultsHeading);
 }
 function shell(s){
  epoch=s.context.epoch;rows.clear();pages.clear();reader=null;root.replaceChildren();
  const intro=el('header','','intro'),eyebrow=el('p','CARE / REVIEW  ·  合成介面比較','eyebrow'),title=el('h1','保存結果，與確認依據。'),description=el('p','只閱讀目前已載的保存記錄。開啟、換頁或讀過，都不表示你作出確認。','lede');
  const layout=el('div','','layout-switch');layout.setAttribute('role','group');layout.setAttribute('aria-label','比較閱讀方式');
  const a=button('A 狀態對照簿','layout','a'),b=button('B 逐項閱讀艙','layout','b');a.dataset.layoutChoice='a';b.dataset.layoutChoice='b';layout.append(a,b);intro.append(eyebrow,title,description,layout);
  const scope=el('p','','scope-line'),statusLine=el('p','','status-line');statusLine.setAttribute('role','status');
  const operation=el('aside','','operation');operation.setAttribute('aria-label','原操作狀態');
  const owner=el('p','','owner-line'),reread=button('重讀合成窗口','reread');
  const scopePanel=el('section','','scope-panel');scopePanel.setAttribute('aria-label','來源窗口');scopePanel.append(scope,statusLine,owner,reread,operation);
  const filters=el('details','','filters');filters.open=true;filters.append(el('summary','本地搜尋與篩選'));
  const form=el('div','','filter-fields'),queryLabel=el('label','搜尋已載原文');queryLabel.htmlFor='crh-query';
  const query=control(el('input'),'query');query.type='search';query.id='crh-query';query.maxLength=200;query.placeholder='只搜尋已載窗口';
  const apply=button('套用搜尋','apply');apply.id='crh-apply';const draft=el('p','','draft-note');draft.setAttribute('role','status');
  const statusLabel=el('label','處理狀態');statusLabel.htmlFor='crh-status';const status=control(el('select'),'status');status.id='crh-status';
  for(const k of ['all','written','confirmed','not_required']){const o=el('option',statusNames[k]);o.value=k;status.append(o);}
  const sourceLabel=el('label','來源項目');sourceLabel.htmlFor='crh-source';const source=control(el('select'),'source');source.id='crh-source';
  const queryGroup=el('div','','query-group');queryGroup.append(queryLabel,query,apply,draft);
  const statusGroup=el('div','','field');statusGroup.append(statusLabel,status);const sourceGroup=el('div','','field');sourceGroup.append(sourceLabel,source);
  const clear=button('清除本地篩選','clear');form.append(queryGroup,statusGroup,sourceGroup,clear);filters.append(form);
  const applied=el('p','','applied'),feedback=el('p','','feedback');feedback.setAttribute('role','status');
  const resultsHeading=el('h2','本頁對照','results-heading');resultsHeading.id='crh-results-heading';resultsHeading.tabIndex=-1;
  const count=el('p','','counts'),jump=button('跳到閱讀內容','jump');
  const resultTop=el('div','','result-top');resultTop.append(resultsHeading,count,jump);
  const workspace=el('div','','workspace'),list=el('ol','','record-list');list.setAttribute('aria-label','本頁保存記錄');
  const readerBay=el('div','','reader-bay');readerBay.dataset.readerBay='';const emptyReader=el('p','從本頁選一筆閱讀。編號只是本頁位置，不是完成率。','empty-reader');readerBay.append(emptyReader);
  const empty=el('p','','empty-results');workspace.append(list,readerBay,empty);
  const pagination=el('nav','','pagination');pagination.setAttribute('aria-label','已載記錄本地分頁');const previous=button('上一頁','previous-page'),next=button('下一頁','next-page'),pageSlots=el('div','','page-slots');pagination.append(previous,pageSlots,next);
  const range=el('p','','range'),more=el('p','','more-note'),footer=el('footer','合成示例 · 不會保存、更正、確認或讀取真實資料。版本歷史與正式照顧流程未接線。','footer');
  root.append(intro,scopePanel,filters,applied,feedback,resultTop,workspace,pagination,range,more,footer);
  ui={title,a,b,scope,statusLine,owner,reread,operation,query,status,source,apply,clear,draft,applied,feedback,resultsHeading,count,jump,list,readerBay,emptyReader,empty,pagination,previous,next,pageSlots,range,more};
 }
 function row(item,index){
  const key=selectionKey(item),li=el('li'),article=el('article','','record-row');article.dataset.record=item.id;
  const number=el('span','','ordinal'),title=el('h3'),original=el('p','','row-original'),save=el('p','保存結果：已保存','saved-label'),basis=el('p','','basis-label'),version=el('p','','version-label'),opener=button('','open',key);opener.dataset.open=item.id;
  const summary=el('div','','row-summary');summary.append(number,title,original,save,basis,version,opener);article.append(summary);li.append(article);
  return {key,li,article,number,title,original,save,basis,version,opener};
 }
 function makeReader(item){
  const node=control(el('section','','reader'),'reader');node.dataset.reader='';node.setAttribute('role','region');node.setAttribute('aria-labelledby','crh-reader-heading');node.id='crh-reader';
  const heading=el('h2','','reader-heading');heading.id='crh-reader-heading';heading.tabIndex=-1;
  const position=el('p','','reader-position'),resolution=el('p','','resolution'),basisWarning=el('p','','basis-warning');
  const originalHeading=el('h3','記錄原文與來源'),original=el('p','','original-text'),source=el('p','','source-text');
  const originalColumn=el('section','','original-column');originalColumn.append(originalHeading,original,source);
  const valuesHeading=el('h3','已保存的結構資料'),values=el('dl','','values');const valuesColumn=el('section','','values-column');valuesColumn.append(valuesHeading,values);
  const columns=el('div','','reader-columns');columns.append(originalColumn,valuesColumn);
  const proposed=el('div','','proposed-values'),uncertainties=el('div','','uncertainties'),metadata=button('來源與版本資料','metadata');metadata.setAttribute('aria-controls','crh-metadata');
  const meta=el('div','','metadata');meta.id='crh-metadata';
  const previous=button('前一筆','previous-item'),next=button('後一筆','next-item'),close=button('收起核對內容','close'),actions=el('div','','reader-actions');actions.append(previous,next,close);
  node.append(position,heading,el('p','保存結果：已保存','reader-saved'),resolution,basisWarning,columns,proposed,uncertainties,metadata,meta,actions);
  return {key:selectionKey(item),node,heading,position,resolution,basisWarning,original,source,values,proposed,uncertainties,metadata,meta,previous,next,close};
 }
 function pairs(node,values){const fragment=doc.createDocumentFragment();for(const [name,value] of values){fragment.append(el('dt',name),el('dd',value));}node.replaceChildren(fragment);}
 function displayValues(node,v,c){pairs(node,[['類型',kindNames[v.kind]??v.kind],['文字',v.text],['來源',v.source],['數量原文',v.quantityRaw||'未提供'],['單位原文',v.quantityUnit||'未提供'],['數量精度',v.quantityPrecision],['時間原文',v.eventTimeRaw||'未提供'],['時間精度',c.eventTimePrecision],['時區',c.timeZoneLabel],['理由原文',v.reason||'未提供'],['確認／來源歸屬',c.confirmedByLabel],['保存確認顯示時間',c.confirmedAtLabel]]);}
 function render(s){
  if(disposed||host.getSnapshot()!==s)return;
  if(s.retired){root.replaceChildren();rows.clear();pages.clear();reader=null;return;}
  if(epoch!==s.context.epoch)shell(s);
  const w=deriveWindow(s,(root.clientWidth||win.innerWidth)<480),m=s.input?.model,l=s.local,allowed=localAdmission(s).allowed;
  root.dataset.layout=l.layout;root.dataset.scope=s.context.scopeKey;root.dataset.state=w.state;
  set(ui.title,l.layout==='a'?'保存結果，與確認依據。':'逐項閱讀，保留原來的意思。');
  ui.a.setAttribute('aria-pressed',String(l.layout==='a'));ui.b.setAttribute('aria-pressed',String(l.layout==='b'));
  set(ui.scope,`已載核對投影窗口 · ${m?.access==='lost'||w.state==='unavailable'?'來源不可用':m?.child?.name??'合成孩子'}`);
  set(ui.statusLine,w.reason??'目前可閱讀已載內容');set(ui.owner,w.state==='unavailable'?'無可用來源窗口':`來源搜尋：${m.list.activeQuery||'（空）'} · 類型：${m.list.activeKind} · 來源頁：${m.list.page??'未提供'}。本地搜尋不改變此條件。`);
  disable(ui.reread,!readAdmission(s).allowed);ui.operation.hidden=!occupied(s);
  set(ui.operation,occupied(s)?`原操作：${m.operation?.state??'unavailable'}。${validateInput(s.input).ok&&m.access!=='lost'?m.operation?.message||'':''} 請回原照顧流程處理；這裏不會推定成功、失敗或代為關閉。`:'');
  if(ui.query.value!==l.queryDraft)ui.query.value=l.queryDraft;
  ui.query.readOnly=occupied(s)||['error','unavailable'].includes(w.state)||w.state==='loading'&&(!m.list.hasSnapshot||m.review.state!=='ready'||s.pending&&m.list.page!==1);
  disable(ui.query,ui.query.readOnly);disable(ui.apply,!allowed);disable(ui.clear,!allowed);disable(ui.status,!allowed);disable(ui.source,!allowed);
  if(![...ui.status.options].some(o=>o.value===l.status)){const o=el('option',statusNames[l.status]);o.value=l.status;ui.status.append(o);}ui.status.value=l.status;
  const options=[{key:'all',label:'全部來源項目'},...w.sourceOptions];if(!options.some(o=>o.key===l.sourceKey))options.push({key:l.sourceKey,label:'來源不在目前窗口'});
  const optionSig=JSON.stringify(options);if(ui.source.dataset.options!==optionSig){ui.source.replaceChildren(...options.map(x=>{const o=el('option',x.label);o.value=x.key;return o;}));ui.source.dataset.options=optionSig;}ui.source.value=l.sourceKey;
  set(ui.draft,l.queryDraft!==l.appliedQuery?'搜尋文字尚未套用':'搜尋文字已套用');
  set(ui.applied,`已套用：${l.appliedQuery||'（沒有搜尋字）'} · ${statusNames[l.status]} · ${l.sourceKey==='all'?'全部來源項目':options.find(o=>o.key===l.sourceKey).label}${l.olderOnly?' · 已載窗口中第101項起':''}`);
  set(ui.resultsHeading,l.layout==='a'?'本頁狀態對照':'本頁閱讀索引');set(ui.count,`符合 ${w.matchingCount} 項／此投影已載 ${w.loadedCount} 項${l.olderOnly?` · 較早窗口 ${w.olderWindowCount} 項`:''}`);
  ui.jump.hidden=!w.selected;ui.readerBay.hidden=l.layout==='a';ui.emptyReader.hidden=!!w.selected;
  const wanted=new Set(w.pageItems.map(x=>JSON.stringify(selectionKey(x))));for(const [key,r]of rows)if(!wanted.has(key)){r.li.remove();rows.delete(key);}
  let before=ui.list.firstChild;
  w.pageItems.forEach((item,index)=>{
   const key=JSON.stringify(selectionKey(item));let r=rows.get(key);if(!r){r=row(item,index);rows.set(key,r);}
   if(r.li!==before)ui.list.insertBefore(r.li,before);else before=before.nextSibling;
   set(r.number,String(index+1).padStart(2,'0'));set(r.title,item.title);set(r.original,item.originalText);set(r.basis,`確認依據：${item.resolution.label}${item.reviewState==='not_required'?'（不表示已逐項確認）':''}`);set(r.version,`目前版本 ${item.version}`);
   set(r.opener,l.layout==='a'&&sameSelection(l.selected,r.key)?'收起核對內容':`完整閱讀：${item.title}`);
   r.opener.setAttribute('aria-expanded',String(sameSelection(l.selected,r.key)));r.opener.setAttribute('aria-controls','crh-reader');disable(r.opener,!allowed);r.article.dataset.selected=String(sameSelection(l.selected,r.key));
  });
  ui.empty.hidden=w.pageItems.length>0;set(ui.empty,w.state==='ready'||w.state==='stale'?'目前已載窗口沒有符合項目。這不代表沒有其他記錄。':w.reason??'來源暫不可用');
  if(!w.selected){reader?.node.remove();reader=null;}
  else{
   if(!reader||!sameSelection(reader.key,selectionKey(w.selected))){reader?.node.remove();reader=makeReader(w.selected);}
   const r=reader,item=w.selected,current=item.savedRecord.current,index=w.pageItems.indexOf(item);
   const parent=l.layout==='a'?rows.get(JSON.stringify(r.key)).article:ui.readerBay;if(r.node.parentElement!==parent)parent.append(r.node);
   set(r.heading,item.title);set(r.position,`本頁第 ${index+1} / ${w.pageItems.length} 筆 · 閱讀位置，不是完成率`);set(r.resolution,`確認依據：${item.resolution.label}`);
   set(r.basisWarning,item.reviewState==='not_required'?'已保存不表示已逐項確認。':'此記錄的保存依據為明確確認；閱讀不會增加新的確認。');
   set(r.original,item.originalText);set(r.source,`${item.sourceLabel} · 未提供對話資料`);displayValues(r.values,current.values,current);
   const different=JSON.stringify(item.proposedValues)!==JSON.stringify(current.values);r.proposed.hidden=!different;if(different){r.proposed.replaceChildren(el('h3','投影中的結構資料'));const dl=el('dl');displayValues(dl,item.proposedValues,current);r.proposed.append(dl);}else r.proposed.replaceChildren();
   r.uncertainties.replaceChildren(...item.uncertainties.map(x=>el('p',x)));r.metadata.setAttribute('aria-expanded',String(l.metadataOpen));r.meta.hidden=!l.metadataOpen;
   set(r.meta,`記錄：${item.savedRecord.id}\n來源：${item.sourceId}\n來源版本：${item.sourceVersion}\n目前版本：${current.version}\n保存依據版本：${item.resolution.recordVersion}\n加入日期：${item.createdAtLabel}\n未提供對話資料。這不是版本歷史。`);
   r.previous.hidden=r.next.hidden=l.layout==='a';disable(r.previous,!allowed||index===0);disable(r.next,!allowed||index===w.pageItems.length-1);disable(r.close,!allowed);
  }
  ui.pagination.hidden=w.pageCount<2;disable(ui.previous,!allowed||w.page===0);disable(ui.next,!allowed||w.page>=w.pageCount-1);
  const slotKeys=new Set(w.slots);for(const [key,n]of pages)if(!slotKeys.has(key)){n.remove();pages.delete(key);}
  let anchor=ui.pageSlots.firstChild;for(const slot of w.slots){let n=pages.get(slot);if(!n){n=typeof slot==='number'?button(String(slot+1),'page',slot):el('span','…','ellipsis');if(typeof slot==='number'){n.dataset.page=String(slot);n.setAttribute('aria-label',`第 ${slot+1} 頁，已載入`);}else n.setAttribute('aria-label','其他已載入頁面');pages.set(slot,n);}if(n!==anchor)ui.pageSlots.insertBefore(n,anchor);else anchor=anchor.nextSibling;if(typeof slot==='number'){disable(n,!allowed);if(slot===w.page)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');}}
  set(ui.range,w.matchingCount?`本地第 ${w.page+1} / ${w.pageCount} 頁 · 第 ${w.page*10+1}–${Math.min((w.page+1)*10,w.matchingCount)} 項`:'本地沒有可選頁面');
  set(ui.more,w.hasMore?'這個來源窗口仍有記錄未載入；本候選頁碼只涵蓋已載範圍。':'目前沒有更多來源頁提示；這不代表整個家庭歷史完整。');
 }
 const focusChanged=()=>{focusSerial++;};
 doc.addEventListener('focusin',focusChanged,true);
 for(const type of ['click','keydown','input','change']){root.addEventListener(type,capture,true);root.addEventListener(type,dispatch);}
 const compositionStart=()=>{composing=true;},compositionEnd=()=>{composing=false;};root.addEventListener('compositionstart',compositionStart);root.addEventListener('compositionend',compositionEnd);
 const unsubscribe=host.subscribe(render);const resize=()=>render(host.getSnapshot());win.addEventListener('resize',resize);render(host.getSnapshot());
 return {dispose(){if(disposed)return;disposed=true;unsubscribe();doc.removeEventListener('focusin',focusChanged,true);win.removeEventListener('resize',resize);for(const type of ['click','keydown','input','change']){root.removeEventListener(type,capture,true);root.removeEventListener(type,dispatch);}root.removeEventListener('compositionstart',compositionStart);root.removeEventListener('compositionend',compositionEnd);rows.clear();pages.clear();reader=null;ui=null;root.replaceChildren();}};
}

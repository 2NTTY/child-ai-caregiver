(function(g){
'use strict';
const LABELS={near:'近期 7 天',earlier:'較早未處理',later:'之後',review:'待覆核',unconfirmed:'時間待核對',all:'全部日期'};
const STATE={scheduled:'待處理',needs_review:'待覆核 · 已停催',completed:'已完成',cancelled:'已取消'};
function mountTC01(root){
 const doc=root.ownerDocument,win=doc.defaultView,host=g.TC01.createHost();
 let disposed=false,shellToken=null,renderedLayout=null,rowsKey=null,composing=false,queuedSearch=null,compositionTail=null,intentSerial=0,focusSerial=0,programmatic=false,frame=null,historySerial=0,historyEntries=new Map();
 const session='tc01-'+Math.random().toString(36).slice(2);let ui={};
 const current=t=>!disposed&&host.snapshot().token===t;
 function text(tag,value,cls){let e=doc.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e}
 function remember(replace=false){if(disposed)return;let s=host.snapshot(),id=++historySerial;historyEntries.set(id,{token:s.token,layout:s.layout,filter:s.filter,query:s.query,selectedDay:s.selectedDay,page:s.page,tab:s.tab});win.history[replace?'replaceState':'pushState']({tc01:session,id},'','#'+s.layout)}
 function apply(change,token,replace=false){if(!current(token))return false;let ok=host.intent(change,token);if(ok&&current(token))remember(replace);return ok}
 function send(change,token,replace=false){intentSerial++;return apply(change,token,replace)}
 function bind(el,fn,t){el.addEventListener('click',()=>{if(current(t))fn()})}
 function shell(s){
  shellToken=s.token;rowsKey=null;renderedLayout=null;composing=false;queuedSearch=null;compositionTail=null;intentSerial++;const t=s.token;
  root.innerHTML=`<main class="collection"><header class="masthead"><div><p class="eyebrow">育伴港 · 選配工作台 / TC01</p><h1 data-title>任務航道</h1><p class="lede" data-lede></p></div><div class="edition"><span>COLLECTION / 01</span><strong>合成預覽</strong><small>僅記憶體 · 不連接服務</small></div></header>
  <nav class="choice" aria-label="選配方向"><button type="button" data-layout="board"><span>A</span> 任務航道<small>先選範圍，再看安排</small></button><button type="button" data-layout="index"><span>B</span> 任務索引<small>先搜尋日期，再逐項閱讀</small></button></nav>
  <div class="context"><strong data-scope-label></strong><span>資料基準 2026-11-05 · 香港時間</span><span data-boundary></span></div>
  <div class="categories" role="group" aria-label="清單分類"><button type="button" data-tab="pending">待處理</button><button type="button" data-tab="completed">最近完成</button><span>不含完整歷史</span></div>
  <section class="tools" data-tools aria-label="篩選已載入事項"><div class="scope-block" data-block="scope"><p class="label">選擇範圍 <small>數目來自已載入窗口</small></p><div class="filters" data-filters role="group" aria-label="日期與覆核範圍"></div></div><div class="search-block" data-block="search"><label for="tc-search">搜尋已載入事項</label><input id="tc-search" data-search type="search" maxlength="400" autocomplete="off" placeholder="標題、內容或負責人"><div class="date-line"><label for="tc-date">指定日期<input id="tc-date" data-date type="date"></label><button type="button" data-clear-day>取消日期</button><button type="button" data-reset>清除篩選</button></div></div></section>
  <div class="result-header"><div><h2 tabindex="-1" data-results-title>已載入安排</h2><p data-result-context></p></div><span class="window-mark">LOADED WINDOW</span></div><p class="status" role="status" aria-live="polite" data-status></p><section data-results aria-label="事項清單"></section>
  <nav class="pagination" aria-label="已載入事項分頁"><button type="button" data-prev>上一頁</button><span data-page></span><button type="button" data-next>下一頁</button></nav><section class="more"><p data-more-note></p><button type="button" data-more>載入下一批合成事項</button></section>
  <details class="about"><summary>候選說明與合成情境</summary><div class="about-body"><p>兩個方向共用一個合成資料容器。清單每頁 10 項；每次模擬載入最多 50 項。搜尋、範圍與數目只涵蓋已載入窗口，沒有完成率、所有歷史或外部送達承諾。</p><p>寫入與跨模組入口未接線：完成、取消、改期、覆核、編輯及版本歷史均不可用。展開項目只閱讀目前已載入摘要。</p><button type="button" data-writer disabled>編輯與完成 · 未接線</button><div class="demo-controls"><button type="button" data-demo="refresh">模擬背景更新</button><button type="button" data-demo="reload">重讀首批（重設窗口）</button><button type="button" data-demo="failed">模擬讀取失敗</button><button type="button" data-demo="invalidate">模擬範圍失效</button><button type="button" data-demo="scope">切換合成範圍</button><button type="button" data-demo="restore">重建合成範圍</button></div><p>畫面比較為合成候選；正式 owner 接線、原生裝置及真瀏覽器驗收尚未執行。</p><p>來源：<a href="https://github.com/2NTTY/child-ai-caregiver/blob/2abe7aed60b192b253414f6464e3fd070cc377e7/frontend/src/components/tasks/TasksView.tsx" target="_blank" rel="noopener noreferrer">固定 TasksView 原始碼</a> · <a href="references.html" target="_blank" rel="noopener noreferrer">研究與設計邊界</a></p></div></details><footer>合成示例 · TC01 · 不會儲存、送出或改寫任務</footer></main>`;
  const q=sel=>root.querySelector(sel);ui={main:q('main'),title:q('[data-title]'),lede:q('[data-lede]'),scope:q('[data-scope-label]'),boundary:q('[data-boundary]'),tools:q('[data-tools]'),scopeBlock:q('[data-block="scope"]'),searchBlock:q('[data-block="search"]'),filters:q('[data-filters]'),search:q('[data-search]'),date:q('[data-date]'),reset:q('[data-reset]'),clear:q('[data-clear-day]'),status:q('[data-status]'),results:q('[data-results]'),resultContext:q('[data-result-context]'),resultsTitle:q('[data-results-title]'),prev:q('[data-prev]'),next:q('[data-next]'),page:q('[data-page]'),more:q('[data-more]'),moreNote:q('[data-more-note]')};
  for(const [filter,label] of Object.entries(LABELS)){let b=text('button',label);b.type='button';b.dataset.filter=filter;bind(b,()=>send({filter},t),t);ui.filters.append(b)}
  for(let b of root.querySelectorAll('[data-layout]'))bind(b,()=>send({layout:b.dataset.layout},t),t);
  for(let b of root.querySelectorAll('[data-tab]'))bind(b,()=>send({tab:b.dataset.tab},t),t);
  const field=ui.search;
  field.addEventListener('compositionstart',()=>{if(current(t)){intentSerial++;composing=true;compositionTail=null}});
  field.addEventListener('input',e=>{if(current(t)&&!composing&&!e.isComposing){
   const value=field.value,tail=compositionTail;compositionTail=null;
   // One identical trailing input belongs to the just-ended composition, not a newer intent.
   if(tail&&tail.token===t&&tail.value===value&&tail.intent===intentSerial)return;
   send({query:value},t,true);
  }});
  field.addEventListener('compositionend',()=>{if(!current(t)||!composing)return;composing=false;const value=field.value,intent=intentSerial+1;
   if(!send({query:value},t,true)&&current(t)&&host.snapshot().reading)queuedSearch={token:t,value,intent:intentSerial};
   if(current(t)&&intentSerial===intent)compositionTail={token:t,value,intent};
  });
  ui.date.addEventListener('change',()=>{if(current(t))send({selectedDay:ui.date.value||null},t)});
  bind(ui.reset,()=>send({reset:true},t),t);bind(ui.clear,()=>send({selectedDay:null},t),t);
  bind(ui.prev,()=>send({page:host.snapshot().projection.page-1},t),t);bind(ui.next,()=>send({page:host.snapshot().projection.page+1},t),t);
  bind(ui.more,()=>read('more','success',t),t);
  for(let b of root.querySelectorAll('[data-demo]'))bind(b,()=>{intentSerial++;const kind=b.dataset.demo;if(kind==='invalidate')host.invalidate();else if(kind==='scope')host.setScope(host.snapshot().scope==='demo-a'?'demo-b':'demo-a');else if(kind==='restore')host.setScope(host.snapshot().scope);else read(kind==='reload'?'reload':'refresh',kind==='failed'?'failed':'success',t)},t);
 }
 function read(kind,outcome,t){intentSerial++;const ticket=host.beginRead(kind,t);if(ticket)win.queueMicrotask(()=>{if(!disposed)host.finishRead(ticket,outcome)})}
 function rows(s){
  let key=JSON.stringify([s.token,s.layout,s.tab,s.projection.items]);if(key===rowsKey)return;rowsKey=key;ui.results.replaceChildren();
  if(s.readState==='invalidated'||s.disposed)return;
  let groups=new Map();
  for(let task of s.projection.items){let date=g.TC01.day(task.occurrence.dueAt,s.context.timeZone);let group=s.layout==='board'?(task.occurrence.state==='needs_review'?'待覆核 · 已停催':date?'待處理安排':'時間待核對'):(date??'時間待核對');if(s.tab==='completed')group='最近完成 · 已載入最多 10 項';if(!groups.has(group))groups.set(group,[]);groups.get(group).push(task)}
  for(let [label,tasks] of groups){let section=text('section','','lane'),heading=text('h3',label),list=text('div','','rows');section.append(heading,list);ui.results.append(section);
   for(let task of tasks){let row=text('article','',s.layout==='board'?'mission-card':'index-row');row.dataset.row=task.id;let date=g.TC01.day(task.occurrence.dueAt,s.context.timeZone);let time=date?new Intl.DateTimeFormat('zh-HK',{timeZone:s.context.timeZone,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(task.occurrence.dueAt)):'時間待核對';let stamp=text('time',date?date.slice(5).replace('-',' / '):'待核對','stamp');if(date){stamp.dateTime=task.occurrence.dueAt;stamp.setAttribute('aria-label',`安排時間 ${date} ${time} 香港時間`)}stamp.append(text('small',s.tab==='completed'?'安排時間':time));let body=text('div','','row-main'),badge=text('span',STATE[task.occurrence.state],'badge');let title=text('h4',task.title),meta=text('p',`${s.people.find(x=>x.userId===task.assigneeUserId)?.name??'負責人待核對'} · ${task.kind==='appointment'?'預約':'日常安排'}`,'row-meta');let expand=text('button','展開已載入摘要','expand');expand.type='button';expand.dataset.expand=task.id;expand.setAttribute('aria-expanded','false');let detail=text('div','','summary-copy');detail.hidden=true;let desc=text('p',task.details);let state=text('p',s.tab==='completed'?`合成完成時間：${task.completedAt??'未提供'}`:`原安排時區：${task.occurrence.timeZone} · 版本 ${task.version}`);let close=text('button','收起摘要');close.type='button';close.dataset.closeSummary=task.id;let detailId='summary-'+s.epoch+'-'+task.id;detail.id=detailId;expand.setAttribute('aria-controls',detailId);detail.append(desc,state,close);let scheduledInline=stamp.cloneNode(false);scheduledInline.className='scheduled-inline';scheduledInline.textContent=date?stamp.getAttribute('aria-label'):'安排時間待核對';body.append(badge,title,meta,scheduledInline,expand,detail);row.append(stamp,body);list.append(row);
    bind(expand,()=>{intentSerial++;detail.hidden=!detail.hidden;expand.setAttribute('aria-expanded',String(!detail.hidden));expand.textContent=detail.hidden?'展開已載入摘要':'收起已載入摘要'},s.token);
    bind(close,()=>{intentSerial++;detail.hidden=true;expand.setAttribute('aria-expanded','false');expand.textContent='展開已載入摘要';const intent=intentSerial,focus=focusSerial,token=s.token;frame=win.requestAnimationFrame(()=>{frame=null;if(!current(token)||intent!==intentSerial||focus!==focusSerial||!expand.isConnected)return;programmatic=true;try{expand.focus({preventScroll:true})}finally{programmatic=false}})},s.token);
   }
  }
 }
 function render(s){
  if(disposed)return;
  if(shellToken!==s.token){shell(s);historyEntries.clear();remember(true)}
  if(queuedSearch&&!s.reading){const queued=queuedSearch;queuedSearch=null;if(queued.token===s.token&&queued.intent===intentSerial&&['ready','stale'].includes(s.readState)){apply({query:queued.value},queued.token,true);return}}
  const invalid=s.readState==='invalidated',unavailable=invalid||s.readState==='error'||s.readState==='loading',locked=unavailable||s.reading;
  ui.main.className='collection '+s.layout;
  ui.title.textContent=s.layout==='board'?'任務航道':'任務索引';ui.lede.textContent=s.layout==='board'?'看清目前範圍，逐項安排日常。':'把搜尋放在前面，讓閱讀安靜一點。';
  ui.scope.textContent=s.scope==='demo-a'?'合成範圍 甲':'合成範圍 乙';ui.boundary.textContent=invalid?'目前範圍不可用 · 內容已清除':`僅已載入 ${s.items.length} 項${s.hasMore?' · 尚有未載入':' · 合成窗口已到末端'}`;
  for(let b of root.querySelectorAll('[data-layout]')){b.setAttribute('aria-pressed',String(b.dataset.layout===s.layout));b.disabled=locked}
  for(let b of root.querySelectorAll('[data-tab]')){b.setAttribute('aria-pressed',String(b.dataset.tab===s.tab));b.disabled=locked}
  ui.tools.hidden=s.tab==='completed';
  if(renderedLayout!==s.layout){ui.tools.replaceChildren(...(s.layout==='board'?[ui.scopeBlock,ui.searchBlock]:[ui.searchBlock,ui.scopeBlock]));renderedLayout=s.layout}
  if(!composing&&!queuedSearch&&ui.search.value!==s.query)ui.search.value=s.query;
  ui.date.value=s.selectedDay??'';ui.search.disabled=locked;ui.date.disabled=locked;ui.reset.disabled=locked;ui.clear.disabled=locked||!s.selectedDay;
  for(let b of ui.filters.children){let f=b.dataset.filter;b.textContent=`${LABELS[f]} ${s.projection.counts[f]??'—'}`;b.setAttribute('aria-pressed',String(!s.selectedDay&&s.filter===f));b.disabled=locked}
  ui.resultContext.textContent=invalid?'範圍失效，無可用結果。':s.tab==='completed'?'只顯示已載入的最近 10 項，不含已取消或逐版本記錄。':`${s.selectedDay??LABELS[s.filter]}${s.query.trim()?' · 搜尋：'+s.query:''} · 符合 ${s.projection.total} 項${s.projection.total?'，顯示 '+s.projection.from+'–'+s.projection.to:''}`;
  ui.status.textContent=invalid?'範圍已失效，已清除內容。可在合成情境重建。':s.reading?'正在模擬讀取；已載入內容保留。':s.readState==='stale'?'未能更新，保留上次讀取的事項。':s.readState==='error'?'未能讀取事項，沒有把錯誤當成空清單。':s.projection.items.length?'':s.hasMore?'已載入窗口沒有符合項目；尚有事項未載入。':'沒有符合篩選的合成事項。';
  ui.status.hidden=!ui.status.textContent;rows(s);
  for(let b of ui.results.querySelectorAll('button'))b.disabled=locked;
  ui.page.textContent=`第 ${s.projection.page+1} / ${s.projection.pageCount} 頁 · 每頁最多 10 項`;
  ui.prev.disabled=locked||s.projection.page===0;ui.next.disabled=locked||s.projection.page>=s.projection.pageCount-1;
  ui.more.disabled=locked||!s.hasMore;ui.moreNote.textContent=invalid?'範圍已失效，無法判斷未載入事項。':s.hasMore?'搜尋、範圍與數目不包含尚未載入的事項。':'已到這批合成資料的末端，不代表正式資料的完整歷史。';
 }
 function focusin(){if(!programmatic)focusSerial++}
 function pop(e){if(disposed)return;intentSerial++;let ref=e.state,entry=ref?.tc01===session?historyEntries.get(ref.id):null;if(!entry||!current(entry.token)){remember(true);return}const {token,...change}=entry;if(!host.intent(change,token))remember(true)}
 function dispose(){if(disposed)return;disposed=true;intentSerial++;if(frame!==null)win.cancelAnimationFrame(frame);unsub();host.dispose();historyEntries.clear();win.removeEventListener('popstate',pop);win.removeEventListener('pagehide',dispose);doc.removeEventListener('focusin',focusin);root.replaceChildren(text('p','此合成清單已離頁並清除。返回時會建立新範圍。','disposed'))}
 const unsub=host.subscribe(render);doc.addEventListener('focusin',focusin);win.addEventListener('popstate',pop);win.addEventListener('pagehide',dispose);render(host.snapshot());remember(true);
 return {host,dispose};
}
g.mountTC01=mountTC01;
if(g.document?.querySelector('[data-auto="true"]')){
 const root=g.document.getElementById('app');let app=mountTC01(root);
 g.addEventListener('pageshow',()=>{if(app.host.snapshot().disposed){app=mountTC01(root);let note=g.document.createElement('p');note.className='return-note';note.textContent='返回此頁：先前合成狀態已清除，現在是新的已載入窗口。';root.prepend(note)}});
}
})(globalThis);

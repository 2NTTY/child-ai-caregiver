// Presentation only: IDs, reading intent and geometric anchors. No message store.
export function mountReading(root,host){
 const d=root.ownerDocument,w=d.defaultView;
 let snap=null,binding=null,disposed=false,serial=0,focusSerial=0,pendingAnchor=null,viewport,els={},articleNodes=new Map(),indexNodes=new Map(),dateNodes=new Map(),followFocusSerial=0;
 let state={ia:'timeline',query:'',firstId:null,selectedId:null,following:true,atLatest:false,anchor:null};
 const onFocus=()=>{focusSerial++;};d.addEventListener('focusin',onFocus);
 const current=()=>!disposed&&host.isCurrent(binding);
 const rows=()=>host.getSnapshot().rows;
 const utc=row=>{const [day,time]=new Date(row.createdAt).toISOString().split('T');return {day,time:time.slice(0,5)};};
 const rowById=id=>rows().find(r=>r.id===id);
 const start=()=>Math.max(0,rows().findIndex(r=>r.id===state.firstId));
 const matchesQuery=r=>r.text.toLocaleLowerCase().includes(state.query.toLocaleLowerCase());
 const scale=()=>{const rect=viewport.getBoundingClientRect();return viewport.offsetHeight>0&&rect.height>0?rect.height/viewport.offsetHeight:1;};
 function capture(){
  const rect=viewport.getBoundingClientRect();const articles=[...viewport.querySelectorAll('article[data-message]')];
  const el=articles.find(a=>{const r=a.getBoundingClientRect();return r.bottom>rect.top&&r.top<rect.bottom;});
  const row=el?rowById(el.dataset.message):rowById(state.selectedId);
  if(!row)return null;
  const anchor={messageId:row.id,bodyRevision:row.bodyRevision,offset:el?(el.getBoundingClientRect().top-rect.top)/scale():0,lifetimeId:binding.lifetimeId};
  state.anchor=anchor;state.selectedId=row.id;return anchor;
 }
 function claim(){return {serial:++serial,focusSerial,binding,anchor:capture()};}
 function validClaim(c){return !!c&&current()&&host.isCurrent(c.binding)&&serial===c.serial&&focusSerial===c.focusSerial;}
 function restore(c){
  if(!validClaim(c)||!c.anchor||viewport.getBoundingClientRect().height<=0)return false;
  const a=c.anchor,r=rowById(a.messageId);if(!r||r.bodyRevision!==a.bodyRevision||a.lifetimeId!==binding.lifetimeId)return false;
  const el=[...viewport.querySelectorAll('article')].find(n=>n.dataset.message===a.messageId&&n.dataset.revision===a.bodyRevision);
  if(!el)return false;
  const delta=(el.getBoundingClientRect().top-viewport.getBoundingClientRect().top)/scale()-a.offset;
  viewport.scrollTop+=delta;state.anchor={...a};return true;
 }
 function geometry(){state.atLatest=viewport.scrollHeight-viewport.clientHeight-viewport.scrollTop<=24;els['reading-intent'].textContent=(state.following?'跟隨最新':'停留閱讀')+' · '+(state.atLatest?'畫面在底部':'畫面不在底部');}
 function stopFollowing(){if(!current())return;serial++;state.following=false;const anchor=capture();pendingAnchor=host.getSnapshot().pending?{serial,focusSerial,binding,anchor}:null;geometry();}
 function connect(button,fn){const b=binding;button.addEventListener('click',()=>{if(!disposed&&host.isCurrent(b)&&root.contains(button)&&!button.hidden&&button.getAttribute('aria-disabled')!=='true')fn();});}
 function shell(s){
  binding=s.binding;serial++;pendingAnchor=null;articleNodes=new Map();indexNodes=new Map();dateNodes=new Map();followFocusSerial=focusSerial;
  state={ia:state.ia,query:'',firstId:s.rows[Math.max(0,s.rows.length-6)]?.id??null,selectedId:s.rows[Math.max(0,s.rows.length-6)]?.id??null,following:true,atLatest:false,anchor:null};
  root.innerHTML=`<div class="reader-app"><header class="masthead"><div class="brand-mark" aria-hidden="true">港</div><div><p class="eyebrow">育伴港 / CH01 · 合成唯讀探索</p><h1 id="view-title">潮汐電台</h1><p id="view-description">沿著對話慢慢讀，讓每一段原話都有停靠的位置。</p></div><div class="orbital-art" aria-hidden="true"><i></i><b>01</b><span>READING ROOM</span></div></header>
   <nav class="mode-switch" aria-label="閱讀布局"><button id="mode-timeline" type="button"><span>A</span> 潮汐電台 <small>連續對話</small></button><button id="mode-atlas" type="button"><span>B</span> 星圖檔案 <small>索引與全文</small></button></nav>
   <div class="scope-strip"><span id="scope-label"></span><strong>全部為人工合成示例</strong><span>沒有傳送、模型或附件功能</span></div>
   <div class="reading-workspace"><aside id="index-pane" aria-labelledby="index-heading"><div class="index-heading"><span class="eyebrow">LOADED ARCHIVE</span><h2 id="index-heading">已載入索引</h2></div><label for="search">搜尋已載入原文</label><div class="search-wrap"><span aria-hidden="true">⌕</span><input id="search" type="search" autocomplete="off" placeholder="試試「燈塔」"></div><p id="search-coverage">只搜尋已載入內容，並非所有歷史。</p><p id="search-result"></p><nav id="date-index" aria-label="已載入日期"></nav><div id="message-index" aria-label="已載入訊息索引"></div></aside>
   <section class="reading-column" aria-labelledby="reading-heading"><div class="reading-header"><div><p class="eyebrow" id="reading-kicker">THE CONVERSATION</p><h2 id="reading-heading">對話時間線</h2></div><span class="channel-badge">CH / 01</span></div><p id="counts" class="counts"></p><div class="read-actions"><button id="reveal" type="button">展開較早已載內容</button><button id="older" type="button">讀取較早合成頁</button><button id="reload" type="button">重新讀取合成頁</button></div><p id="read-status" role="status" aria-live="polite"></p><p id="original-notice" class="notice"></p>
   <div class="reader-navigation"><button id="back-index" type="button">返回索引</button><button id="previous" type="button">上一則</button><button id="next" type="button">下一則</button></div>
   <div id="reader-scroll" tabindex="0" role="region" aria-label="對話全文閱讀區"><div id="messages"></div><p id="empty-message"></p></div>
   <div class="reading-dock"><div><span class="eyebrow">READING POSITION</span><p id="reading-intent"></p></div><button id="hold" type="button">停留閱讀</button><button id="latest" type="button">回到最新</button></div><p class="reading-note">引用標記保留原文，詳情未接入。日期與時間均為 UTC。</p></section></div><footer class="module-footer"><span>LOCAL READING, SAME TRUTH.</span><p>只展示已載入合成快照。重新讀取不代表保存確認，也不會重新執行模型。</p></footer></div>`;
  for(const el of root.querySelectorAll('[id]'))els[el.id]=el;
  viewport=els['reader-scroll'];
  connect(els['mode-timeline'],()=>changeIA('timeline'));connect(els['mode-atlas'],()=>changeIA('atlas'));
  connect(els.reveal,()=>{state.following=false;const c=claim();state.firstId=rows()[Math.max(0,start()-6)]?.id??null;render(host.getSnapshot());restore(c);});
  connect(els.older,()=>{state.following=false;pendingAnchor=claim();const result=host.requestOlder(binding,els.older.dataset.cursor);if(!result.accepted)pendingAnchor=null;});
  connect(els.reload,()=>{const c=claim();pendingAnchor=c;const result=host.requestReload(binding);if(!result.accepted)pendingAnchor=null;});
  connect(els.hold,stopFollowing);
  connect(els.latest,()=>{serial++;pendingAnchor=null;state.following=true;followFocusSerial=focusSerial;state.query='';els.search.value='';state.firstId=rows()[Math.max(0,rows().length-6)]?.id??null;state.selectedId=rows().at(-1)?.id??null;state.anchor=null;render(host.getSnapshot());viewport.scrollTop=viewport.scrollHeight;geometry();capture();});
  connect(els.previous,()=>move(-1));connect(els.next,()=>move(1));
  connect(els['back-index'],()=>{serial++;pendingAnchor=null;state.following=false;root.dataset.mobilePane='index';const button=[...els['message-index'].querySelectorAll('button')].find(b=>b.dataset.message===state.selectedId);(button||els.search).focus();});
  const shellBinding=binding,shellViewport=viewport;
  const liveShell=()=>current()&&host.isCurrent(shellBinding)&&viewport===shellViewport&&root.contains(shellViewport);
  els.search.addEventListener('input',()=>{if(!liveShell())return;serial++;pendingAnchor=null;state.query=els.search.value;state.following=false;render(host.getSnapshot());});
  for(const type of ['wheel','touchstart','pointerdown'])viewport.addEventListener(type,()=>{if(liveShell())stopFollowing();},{passive:true});
  viewport.addEventListener('keydown',event=>{if(!liveShell())return;if(event.target.closest('input,textarea,button,a,select,[contenteditable="true"]'))return;if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))stopFollowing();});
  viewport.addEventListener('scroll',()=>{if(!liveShell())return;geometry();if(!state.following){const anchor=capture();if(host.getSnapshot().pending&&pendingAnchor)pendingAnchor={serial,focusSerial,binding,anchor};}});
 }
 function changeIA(ia){
  if(state.ia===ia)return;
  const c=claim(),focusedArticle=!!d.activeElement?.closest('#reader-scroll article');state.ia=ia;root.dataset.mobilePane='reader';render(host.getSnapshot());restore(c);
  if(focusedArticle&&validClaim(c)){const a=[...viewport.querySelectorAll('article')].find(n=>n.dataset.message===state.selectedId);a?.focus({preventScroll:true});}
 }
 function jump(id){
  const r=rowById(id);if(!r)return;
  serial++;pendingAnchor=null;state.following=false;state.selectedId=id;state.firstId=id;state.anchor={messageId:id,bodyRevision:r.bodyRevision,offset:0,lifetimeId:binding.lifetimeId};root.dataset.mobilePane='reader';
  const c={serial,focusSerial,binding},live=host.getSnapshot(),reader=viewport;
  const activeJump=()=>validClaim(c)&&host.getSnapshot()===live&&viewport===reader&&reader.isConnected&&root.contains(reader);
  render(live);if(!activeJump())return;
  const el=[...viewport.querySelectorAll('article')].find(n=>n.dataset.message===id);if(!el)return;
  const activeTarget=()=>activeJump()&&reader.contains(el)&&visibleFocusTarget(el);
  if(!activeTarget())return;
  viewport.scrollTop+=(el.getBoundingClientRect().top-viewport.getBoundingClientRect().top)/scale();
  if(!activeTarget())return;
  geometry();
  const visibility=()=>{
   const rect=reader.getBoundingClientRect(),a=el.getBoundingClientRect(),height=d.documentElement.clientHeight;
   if(rect.height<=0||a.height<=0||height<=0)return null;
   const low=Math.max(0,rect.top),high=Math.min(height,rect.bottom),long=a.height>Math.min(rect.height,height);
   return {rect,height,long,visible:a.top>=low&&a.top<high&&(long||a.bottom<=high)};
  };
  // Explicit jumps reveal the reading start, and all of a fitting article, through both scroll layers.
  let target=visibility();
  if(target&&!target.visible&&activeTarget()&&(target.rect.top<0||target.rect.bottom>target.height))reader.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  if(!activeTarget())return;
  target=visibility();
  if(target&&!target.visible&&activeTarget())el.scrollIntoView({block:target.long?'start':'nearest',inline:'nearest',behavior:'instant'});
  if(activeTarget())el.focus({preventScroll:true}); // Last action: focus may synchronously replace context.
 }
 function move(delta){const index=rows().findIndex(r=>r.id===state.selectedId),r=rows()[index+delta];if(r)jump(r.id);}
 function citationLabel(row){return row.role==='model'?(row.citations===undefined?'來源尚未載入':row.citations.length===0?'已知無引用':'合成引用快照 · 僅保留原文標記'):'原始合成訊息';}
 const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
 function article(row){
  const key=row.id+'|'+row.bodyRevision;let node=articleNodes.get(key);
  if(!node){node=d.createElement('article');node.tabIndex=-1;node.dataset.message=row.id;node.dataset.revision=row.bodyRevision;
   const header=d.createElement('header'),role=d.createElement('span'),time=d.createElement('time');role.className='speaker';header.append(role,time);node.append(header);
   for(const cls of ['body','message-meta','citation-state']){const p=d.createElement('p');p.className=cls;node.append(p);}articleNodes.set(key,node);
  }
  node.className='message '+row.role;const role=node.querySelector('.speaker'),time=node.querySelector('time');
  text(role,row.role==='user'?'合成家長':'合成助手');time.dateTime=row.createdAt;text(time,utc(row).day+' · '+utc(row).time+' UTC');
  text(node.querySelector('.body'),row.text);text(node.querySelector('.message-meta'),'訊息 '+row.id+(row.inReplyTo?' · 回覆 '+row.inReplyTo:'')+' · 正文 '+row.bodyRevision);text(node.querySelector('.citation-state'),citationLabel(row));
  node.setAttribute('aria-label',role.textContent+' '+time.textContent);return node;
 }
 function reconcile(container,desired){
  const keep=new Set(desired);for(const node of [...container.children])if(!keep.has(node))node.remove();
  desired.forEach((node,i)=>{if(container.children[i]!==node)container.insertBefore(node,container.children[i]??null);});
 }
 function visibleFocusTarget(node){
  if(!node?.isConnected||!root.contains(node)||node.disabled||node.getAttribute('aria-disabled')==='true')return false;
  for(let el=node;el;el=el.parentElement){const style=w.getComputedStyle(el);if(el.hidden||el.hasAttribute('inert')||el.getAttribute('aria-hidden')==='true'||style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse')return false;}
  return true;
 }
 function captureReplacementFocus(s,prior,hard){
  if(!prior||prior===s)return null;
  const origin=d.activeElement;if(!visibleFocusTarget(origin))return null;
  // A new shell retires every old target. Claim only its named fallback, never an old message or selection.
  if(hard)return {origin,kind:origin===viewport||viewport.contains(origin)?'reader':'search',binding:s.binding,serial:serial+1,focusSerial,ia:state.ia,snapshot:s};
  if(!s.authorizedVisible)return null;
  const kind=origin.matches('article[data-message]')&&viewport.contains(origin)?'article':origin.parentElement===els['message-index']?'index':origin.parentElement===els['date-index']?'date':null;
  return kind?{origin,kind,id:origin.dataset.message,day:origin.dataset.day,binding,serial,focusSerial,ia:state.ia,snapshot:s}:null;
 }
 function recoverReplacementFocus(plan){
  if(!plan||plan.origin.isConnected||!current()||!host.isCurrent(plan.binding)||host.getSnapshot()!==plan.snapshot||snap!==plan.snapshot||serial!==plan.serial||focusSerial!==plan.focusSerial||state.ia!==plan.ia)return;
  if(d.activeElement!==d.body&&d.activeElement!==d.documentElement&&d.activeElement!==plan.origin)return;
  const container=plan.kind==='article'?els.messages:plan.kind==='index'?els['message-index']:plan.kind==='date'?els['date-index']:null;
  let target=container?[...container.children].find(n=>n.dataset.message===plan.id&&(plan.kind!=='date'||n.dataset.day===plan.day)):null;
  if(!visibleFocusTarget(target))target=plan.kind==='article'||plan.kind==='reader'?viewport:els.search;
  if(visibleFocusTarget(target))target.focus({preventScroll:true});
 }
 function render(s){
  if(disposed||host.getSnapshot()!==s)return;
  const prior=snap,hard=!binding||binding.lifetimeId!==s.binding.lifetimeId;
  const replacementFocus=captureReplacementFocus(s,prior,hard);
  if(hard)shell(s);
  snap=s;
  const liveKeys=new Set(s.rows.map(r=>r.id+'|'+r.bodyRevision));
  for(const cache of [articleNodes,indexNodes])for(const key of cache.keys())if(!liveKeys.has(key))cache.delete(key);
  for(const key of dateNodes.keys())if(![...liveKeys].some(k=>key.endsWith('|'+k)))dateNodes.delete(key);
  if(!s.rows.some(r=>r.id===state.selectedId)){state.selectedId=s.rows[0]?.id??null;state.anchor=null;}
  if(state.anchor&&!s.rows.some(r=>r.id===state.anchor.messageId&&r.bodyRevision===state.anchor.bodyRevision)){state.anchor=null;pendingAnchor=null;}
  if(prior?.pending&&!s.pending&&s.outcome==='success'&&prior.rows[0]?.id!==s.rows[0]?.id&&prior.pending.kind==='older')state.firstId=s.rows[0]?.id??null;
  if(state.following&&followFocusSerial===focusSerial&&(hard||prior?.rows!==s.rows)){state.selectedId=s.rows.at(-1)?.id??null;state.firstId=s.rows[Math.max(0,s.rows.length-6)]?.id??null;}
  root.dataset.ia=state.ia;root.dataset.lifetime=s.binding.lifetimeId;
  els['mode-timeline'].setAttribute('aria-pressed',String(state.ia==='timeline'));els['mode-atlas'].setAttribute('aria-pressed',String(state.ia==='atlas'));
  els['view-title'].textContent=state.ia==='timeline'?'潮汐電台':'星圖檔案';els['view-description'].textContent=state.ia==='timeline'?'沿著對話慢慢讀，讓每一段原話都有停靠的位置。':'先找日期與原話，再打開一頁完整的對話。';
  els['reading-heading'].textContent=state.ia==='timeline'?'對話時間線':'一則一頁，完整閱讀';els['reading-kicker'].textContent=state.ia==='timeline'?'THE CONVERSATION':'SELECTED TRANSMISSION';
  els['scope-label'].textContent='合成範圍 '+s.binding.childId;
  const filtered=s.rows.filter(matchesQuery),indexDesired=[];
  for(const r of filtered){
   const key=r.id+'|'+r.bodyRevision;let button=indexNodes.get(key);
   if(!button){button=d.createElement('button');button.type='button';button.dataset.message=r.id;const date=d.createElement('small'),text=d.createElement('span');date.textContent=utc(r).day+' / '+utc(r).time;text.textContent=r.text.slice(0,38)+(r.text.length>38?'…':'');button.append(date,text);const b=binding,rev=r.bodyRevision;button.addEventListener('click',()=>{const live=rowById(r.id);if(current()&&host.isCurrent(b)&&root.contains(button)&&live?.bodyRevision===rev&&matchesQuery(live))jump(r.id);});indexNodes.set(key,button);}
   text(button.querySelector('small'),utc(r).day+' / '+utc(r).time);
   button.setAttribute('aria-current',String(r.id===state.selectedId));indexDesired.push(button);
  }
  reconcile(els['message-index'],indexDesired);els['search-result'].textContent=state.query?`已載入結果 ${filtered.length} 則`:'依原日期排列 · 摘錄僅為原文開頭';
  // Date links are local indices, not inferred topics or a global search.
  const days=[...new Set(filtered.map(r=>utc(r).day))],dateDesired=[];
  for(const day of days){const row=filtered.find(r=>utc(r).day===day),key=day+'|'+row.id+'|'+row.bodyRevision;let button=dateNodes.get(key);if(!button){button=d.createElement('button');button.type='button';button.textContent=day.slice(-5);button.dataset.day=day;button.dataset.message=row.id;button.setAttribute('aria-label','定位 '+day+' 已載入原話');connect(button,()=>jump(row.id));dateNodes.set(key,button);}dateDesired.push(button);}
  reconcile(els['date-index'],dateDesired);
  let rendered=state.ia==='timeline'?s.rows.slice(start()):s.rows.filter(r=>r.id===state.selectedId);
  reconcile(els.messages,rendered.map(article));
  els.counts.textContent=`已載入 ${s.loadedCount} · 畫面 ${rendered.length} · 總數未知 · 最新頁上限 ${s.pageLimit}（非保存上限）`;
  const pending=s.pending?(s.pending.kind==='older'?'較早合成頁讀取中':'重新讀取合成頁中')+'，請在示例控制台接納或失敗。':null;
  els['read-status'].textContent=!s.authorizedVisible?'此合成範圍已遮蔽，舊讀取與位置已退休。':pending||s.error?(!s.authorizedVisible?'':pending||'合成讀取'+(s.outcome==='invalid'?'資料無效，已拒絕':'失敗')+'：'+s.error+'。保留上個有效快照。'):s.outcome==='no-progress'?'合成頁沒有進展；不會自動重試。':!s.online?'離線示例：保留同範圍已載內容，不能開始新讀取。':s.outcome==='success'?'已接納合成讀取結果；不是正式服務回覆。':!s.loadedAt?'尚未完成合成讀取，不能判定歷史是否為空。':s.cursor?'仍有較早合成頁，尚非完整歷史。':'合成游標已到末端；總歷史數仍未知。';
  els['original-notice'].textContent=s.unknownNotice||'';els['original-notice'].hidden=!s.unknownNotice||!s.authorizedVisible;
  els['empty-message'].textContent=rendered.length?'':!s.authorizedVisible?'內容已遮蔽。':s.confirmedEmpty?'此合成快照已確認為空。':s.cursor?'目前零則，仍有較早游標，不能判定沒有對話。':!s.loadedAt?'尚未完成合成讀取。':'目前沒有可呈現內容。';
  const localHidden=state.ia==='timeline'&&start()>0;
  els.reveal.setAttribute('aria-disabled',String(!localHidden));els.older.setAttribute('aria-disabled',String(!!s.readAvailability.older||localHidden));els.older.dataset.cursor=s.cursor??'';els.reload.setAttribute('aria-disabled',String(!!s.readAvailability.reload));
  for(const id of ['hold','latest'])els[id].setAttribute('aria-disabled',String(!s.authorizedVisible||!s.rows.length));
  const i=s.rows.findIndex(r=>r.id===state.selectedId);els.previous.setAttribute('aria-disabled',String(i<=0));els.next.setAttribute('aria-disabled',String(i<0||i===s.rows.length-1));
  els['back-index'].hidden=state.ia!=='atlas';els.previous.hidden=state.ia!=='atlas';els.next.hidden=state.ia!=='atlas';
  if(state.following&&followFocusSerial===focusSerial&&(hard||prior?.rows!==s.rows)){viewport.scrollTop=viewport.scrollHeight;}
  geometry();
  if(prior?.pending&&!s.pending){const c=pendingAnchor;pendingAnchor=null;if(s.outcome==='success'&&!state.following)restore(c);}
  recoverReplacementFocus(replacementFocus); // Last effect: native focus can synchronously reenter.
 }
 function resize(){if(!current())return;const c={serial,focusSerial,binding,anchor:state.anchor};restore(c);geometry();}
 w.addEventListener('resize',resize);
 const unsubscribe=host.subscribe(render);render(host.getSnapshot());
 return Object.freeze({getReadingState:()=>({...state,anchor:state.anchor?{...state.anchor}:null}),dispose(){disposed=true;unsubscribe();d.removeEventListener('focusin',onFocus);w.removeEventListener('resize',resize);root.replaceChildren();}});
}

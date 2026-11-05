const labels={completed:'執行已結束',running:'仍在執行',stopped:'執行已停止',unknown:'執行結果未知',unread:'尚未讀取詳情'};
const titleOf=data=>data?.title?.trim()?data.title:'未提供標題';
function notice(s){
 if(s.list.state==='denied')return '已失去讀取權限，舊清單與詳情已隱藏。';
 if(!s.online)return '目前離線。所示內容只是上次讀取的快照。';
 if(s.locked)return '目前只可閱讀已有內容，暫時不能重新讀取。';
 if(s.list.state==='loading')return s.list.loadedAt?'正在更新清單，暫時保留上次讀取內容…':'正在讀取背景清單…';
 if(s.list.state==='failed')return s.list.loadedAt?'未能更新背景清單，顯示上次讀取內容。':'未能讀取背景清單。你可以重新讀取。';
 if(s.list.state==='stale')return '顯示上次讀取內容，尚未重新核對。';
 if(s.list.state==='idle')return '尚未讀取背景清單。';
 return `目前已載入 ${s.list.entries.length} 筆背景結果；只代表這個最多 20 筆的窗口。`;
}
function timeLabel(value){const d=new Date(value);return Number.isFinite(d.getTime())?`${d.getUTCFullYear()}年${d.getUTCMonth()+1}月${d.getUTCDate()}日 ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')} UTC`:'時間未能核對'}
export function mountInbox(root,host){
 const doc=root.ownerDocument;
 let active=true,serial=0,pendingFocus=null,lastEpoch=host.getSnapshot().epoch;
 const scrolls=new Map();
 const el=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n};
 const keyed=(n,key)=>{n.dataset.focusKey=key;return n};
 const heading=(tag,text,key)=>{const n=el(tag,'',text);if(key){keyed(n,key);n.tabIndex=-1;}return n};
 const shell=el('div','inbox-shell');
 const masthead=el('header','masthead');
 const brand=el('p','candidate-label','育伴港 / 私人背景閱讀候選');
 const h1=heading('h1','背景結果，留待你讀');
 const intro=el('p','intro','把已讀到的結果放在這裏，連同原來的上下文慢慢看。');
 const scopeLine=el('p','scope-line');
 masthead.append(brand,h1,intro,scopeLine);
 const controls=el('nav','layout-controls');controls.setAttribute('aria-label','閱讀布局');
 const status=el('p','read-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
 const actions=el('div','window-actions');
 const main=el('main','reading-main');main.id='inbox-reading';main.setAttribute('aria-label','已載入的私人背景結果');
 const skip=el('a','skip-link','跳至背景結果');skip.href='#inbox-reading';main.tabIndex=-1;
 const footer=el('footer','boundary','原創合成示例，只供比較閱讀方式。不是全部歷史；沒有真服務、模型或家庭資料。');
 shell.append(skip,masthead,controls,status,actions,main,footer);root.replaceChildren(shell);
 function locate(key){return [...root.querySelectorAll('[data-focus-key]')].find(n=>n.dataset.focusKey===key)}
 function withFocus(key,action){
  const request={key,turn:serial,epoch:host.getSnapshot().epoch};pendingFocus=request;
  try{return action()}finally{if(pendingFocus===request)pendingFocus=null;}
 }
 function render(){
  if(!active)return;
  const s=host.getSnapshot(),turn=++serial,epoch=s.epoch;
  const request=pendingFocus;pendingFocus=null;
  const requestedFocus=request?.turn===turn-1&&request.epoch===epoch?request.key:null;
  const previousFocus=doc.activeElement;
  const focused=root.contains(doc.activeElement)?doc.activeElement.dataset.focusKey:null;
  const wasInside=root.contains(doc.activeElement);
  if(lastEpoch!==epoch){scrolls.clear();lastEpoch=epoch;}
  else for(const node of main.querySelectorAll('[data-scroll-key]'))scrolls.set(node.dataset.scrollKey,node.scrollTop);
  shell.dataset.layout=s.layout;root.dataset.candidate='agent-inbox-ai01';
  scopeLine.textContent=`${s.scope.label}的私人閱讀窗口 · 合成示例`;
  const statusText=notice(s);if(status.textContent!==statusText)status.textContent=statusText;
  const button=(label,key,callback,{disabled=false,current=false}={})=>{
   const b=keyed(el('button','',label),key);b.type='button';b.disabled=disabled;
   if(current)b.setAttribute('aria-current','true');
   b.addEventListener('click',()=>{if(!active||turn!==serial||host.getSnapshot().epoch!==epoch||b.disabled)return;callback()});return b;
  };
  const choose=layout=>withFocus(`layout:${layout}`,()=>host.setLayout(layout));
  controls.replaceChildren(button('折頁回函','layout:fold',()=>choose('fold'),{current:s.layout==='fold'}),button('狀態分刊','layout:folio',()=>choose('folio'),{current:s.layout==='folio'}));
  const refresh=button(s.list.state==='loading'?'讀取中…':'重新讀取清單','refresh',()=>void host.refresh(),{disabled:!s.online||s.locked||s.list.state==='loading'||s.list.state==='denied'});
  const limit=el('p','window-limit',s.list.loadedAt?`上次清單讀取：${timeLabel(s.list.loadedAt)}。沒有下一頁；待決策清單是另一個入口。`:'清單最多 20 筆。此處不載入待決策清單或即時進度。');
  actions.replaceChildren(limit,refresh);main.replaceChildren();
  const listTitle=heading('h2',s.layout==='fold'?'這次載入的回函':'按已讀狀態分刊','list-heading');
  const enabled=s.online&&!s.locked&&s.list.state!=='loading'&&s.list.state!=='denied';
  const open=(r)=>{const data=s.details[r.runId]?.data;const b=button(data?titleOf(data):'讀取這筆背景結果',`open:${r.runId}`,()=>withFocus(`detail-heading:${r.runId}`,()=>host.select(r.runId)),{disabled:!enabled,current:s.selected===r.runId});b.className='open-run';return b};
  const badge=(data)=>el('span',`state-label state-${data?.status??'unread'}`,labels[data?.status??'unread']);
  function readWarnings(id,slot){const record=s.details[id];
   if(record?.state==='loading')slot.append(el('p','result-notice',record.data?'正在重新讀取此筆，以下是上次內容…':'正在讀取此筆結果…'));
   if(record?.state==='failed')slot.append(el('p','result-notice warning',record.savedEvidence?'原操作已保存，但目前讀取失敗。不要以重新執行補救。':record.data?'未能更新此筆結果，以下是上次讀取內容。':'未能讀取此筆結果，不能據此判斷執行結果。'));
   if(record?.state==='stale')slot.append(el('p','result-notice warning','此筆只保留上次讀取的內容。'));
   if(record?.savedEvidence)slot.append(el('p','save-evidence',`原保存證據：${record.savedEvidence.summary}。這不代表目前資料或通知已送達。`));
  }
  function body(data,slot){
   if(data?.outcome==='no_action')slot.append(el('p','no-action','這次背景核對沒有新增行動。沒有另造聊天回覆。'));
   else if(data)slot.append(el('div','result-text',data.text.trim()?data.text:'這筆結果沒有可顯示的結果文字。'));
  }
  function detail(r,{inline=false}={}){
   const id=r.runId,record=s.details[id],data=record?.data;
   const pane=el('section',inline?'inline-detail':'detail-pane');pane.setAttribute('aria-label','選中的結果詳情');pane.dataset.scrollKey=`detail:${id}`;
   const top=el('div','detail-top');top.append(button('返回結果索引',`back:${id}`,()=>withFocus(`open:${id}`,()=>host.back())));
   const title=heading(inline?'h4':'h2',data?titleOf(data):'背景結果詳情',`detail-heading:${id}`);title.className='detail-title';pane.append(top,title);
   pane.append(el('p','detail-meta',`${timeLabel(r.createdAt)} · ${id}`));if(data)pane.append(badge(data));
   readWarnings(id,pane);if(!inline)body(data,pane);
   if(data?.status==='unknown')pane.append(el('p','warning','執行結果未知。返回或切換布局不會確認成功，也不會重新執行。'));
   if(data?.status==='completed')pane.append(el('p','result-footnote','「執行已結束」只描述這次 run，不代表照護事項已完成。'));
   if(data?.pendingDecision)pane.append(el('aside','readonly-decision','這筆結果另有待決策內容。這裏只供閱讀，請回到原有決策入口核對；本候選沒有接上該入口。'));
   if(record?.state==='failed')pane.append(button('重新讀取此筆',`retry:${id}`,()=>void host.readResult(id),{disabled:!enabled}));
   if(data?.context){const expanded=s.expanded.includes(id);const toggle=button(expanded?'收起原來上下文':'找回原來上下文',`context:${id}`,()=>withFocus(`context:${id}`,()=>host.toggleContext(id)));toggle.className='context-toggle';toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-controls',`context-${id}`);pane.append(toggle);
    if(expanded){const context=keyed(el('section','context-block'),`context-text:${id}`);context.id=`context-${id}`;context.setAttribute('aria-label','原來上下文');context.append(heading(inline?'h5':'h3',data.context.label.trim()?data.context.label:'原來上下文'),el('div','result-text',data.context.text.trim()?data.context.text:'未提供可顯示的上下文文字。'));pane.append(context);}
   }else if(data)pane.append(el('p','result-footnote','此筆沒有可供閱讀的上下文。'));
   return pane;
  }
  if(!s.list.entries.length){main.append(listTitle);let text='清單尚未載入。';if(!s.online&&s.list.loadedAt)text='上次讀取的窗口沒有項目；離線時不能判斷目前是否有新結果。';else if(s.list.state==='ready'&&s.online)text='目前沒有背景結果。這只代表本次已讀窗口，不代表全部歷史為空。';else if(s.list.state==='denied')text='舊內容已隱藏，請回到原產品入口核對身份。';else if(s.list.state==='failed')text='清單讀取失敗，目前沒有可展示的快照。';else if(s.list.state==='loading')text='正在等待這次清單讀取…';main.append(el('div','empty-state',text));}
  else if(s.layout==='fold'){
   const layout=el('div','fold-layout'),index=el('section','run-index');index.setAttribute('aria-label','背景結果索引');index.dataset.scrollKey='index';index.append(listTitle);
   const ol=el('ol','index-list');for(const r of s.list.entries){const li=el('li','index-entry');li.append(el('time','entry-time',timeLabel(r.createdAt)),open(r),badge(s.details[r.runId]?.data));ol.append(li);}index.append(ol);layout.append(index);
   const selected=s.list.entries.find(r=>r.runId===s.selected);
   if(selected)layout.append(detail(selected));else{const empty=el('section','select-prompt');empty.append(heading('h2','先選一封回函'),el('p','','在左側選取一筆。結果、原保存證據和上下文會分開展示。'));layout.append(empty);}main.append(layout);
  }else{
   main.append(listTitle);const sections=el('div','folio-sections'),toc=el('nav','folio-toc');toc.setAttribute('aria-label','本窗口狀態章節');
   for(const kind of ['unknown','running','stopped','completed','unread']){
    const rows=s.list.entries.filter(r=>(s.details[r.runId]?.data?.status??'unread')===kind);if(!rows.length)continue;
    const chapter=el('section',`folio-section chapter-${kind}`);chapter.setAttribute('aria-labelledby',`chapter-${kind}`);
    const ch=heading('h3',labels[kind],`chapter:${kind}`);ch.id=`chapter-${kind}`;
    const chTitle=el('div','chapter-title');chTitle.append(ch,el('p','','本窗口 '+rows.length+' 筆'));chapter.append(chTitle);
    toc.append(button(labels[kind],`jump:${kind}`,()=>locate(`chapter:${kind}`)?.focus()));
    const posts=el('div','chapter-posts');for(const r of rows){const article=el('article','folio-article'),data=s.details[r.runId]?.data;article.setAttribute('aria-label',data?titleOf(data):'未讀背景結果');article.append(el('time','entry-time',timeLabel(r.createdAt)),open(r));readWarnings(r.runId,article);body(data,article);if(s.selected===r.runId)article.append(detail(r,{inline:true}));posts.append(article);}chapter.append(posts);sections.append(chapter);
   }
   main.append(toc,sections);
  }
  for(const node of main.querySelectorAll('[data-scroll-key]'))if(scrolls.has(node.dataset.scrollKey))node.scrollTop=scrolls.get(node.dataset.scrollKey);
  const wanted=requestedFocus??focused;
  const currentFocus=()=>active&&turn===serial&&host.getSnapshot().epoch===epoch&&(doc.activeElement===previousFocus||doc.activeElement===doc.body);
  const usable=n=>n?.isConnected&&root.contains(n)&&!n.disabled&&!n.closest('[hidden],[inert]');
  if(!currentFocus())return;
  if(wanted){
   const candidate=locate(wanted),target=usable(candidate)?candidate:(wasInside||requestedFocus?locate('list-heading'):null);
   if(usable(target))target.focus({preventScroll:!requestedFocus||!requestedFocus.startsWith('detail-heading:')});
  }
  if(currentFocus()&&wasInside&&doc.activeElement===doc.body)locate('list-heading')?.focus({preventScroll:true});
 }
 const unsubscribe=host.subscribe(render);render();
 return Object.freeze({destroy(){if(!active)return;active=false;serial++;unsubscribe();host.dispose();scrolls.clear();root.replaceChildren()}});
}

import {CATEGORIES,GROUPS,SCENARIOS} from './content.mjs';
import {filterCategories,projectSummary,scopeNote} from './model.mjs';
import {createHost} from './host.mjs';
let mountSerial=0;
export function mount(root,host){
 const doc=root.ownerDocument,win=doc.defaultView,prefix=`sn01-${++mountSerial}`;
 let alive=true,current=null,compact=false;
 const el=(tag,attrs={},text)=>{const n=doc.createElement(tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n};
 const button=(attrs,text,fn)=>{const b=el('button',{type:'button',...attrs},text);b.addEventListener('click',fn);return b};
 const hide=(node,value)=>{node.hidden=value;node.toggleAttribute('inert',value);node.setAttribute('aria-hidden',String(value))};
 const outer=el('div',{class:'shell'}),skip=button({'data-skip':'',class:'skip'},'跳到目前分類',()=>current?.headings.get(host.getSnapshot().section)?.focus());
 const mast=el('header',{class:'masthead'}),brand=el('p',{class:'eyebrow'},'育伴港 / 原創選配候選 SN01');
 mast.append(brand,el('h1',{},'把設定，放回好找的位置。'),el('p',{class:'intro'},'八個分類，兩種閱讀路徑。這是全合成導覽與唯讀摘要，其他設定功能尚未接入。'));
 const toolbar=el('div',{class:'layout-switch',role:'group','aria-label':'比較兩種布局'});
 const layoutButtons=new Map();for(const [key,label] of [['index','A 折頁索引'],['atlas','B 設定圖冊']]){const b=button({'data-layout-choice':key},label,()=>{if(alive)host.setLayout(key)});layoutButtons.set(key,b);toolbar.append(b)}
 const contextHeading=el('h2',{'data-context-heading':'',class:'context-heading',tabindex:'-1'});
 const status=el('p',{class:'live-status',role:'status','aria-live':'polite','aria-atomic':'true'});
 const slot=el('div',{class:'context-mount'});
 outer.append(skip,mast,toolbar,contextHeading,status,slot);root.replaceChildren(outer);
 function build(s){
  const lifetime=s.lifetime;
  const guard=fn=>()=>{if(alive)host.intent(lifetime,fn)};
  const frame=el('div',{class:'context-frame'});
  const intro=el('section',{class:'atlas-intro','aria-label':'圖冊概覽'});
  const introText=el('div',{class:'atlas-opening'});introText.append(el('p',{class:'eyebrow'},'SETTINGS / FIELD GUIDE'),el('h2',{},'先看地圖，再選方向。'),el('p',{},'分類目錄協助找到位置；右側說明告訴你這一區的資料邊界。'));
  const atlasSummarySlot=el('div',{class:'atlas-summary-slot'});intro.append(introText,atlasSummarySlot);
  const workspace=el('div',{class:'workspace'});
  const indexNav=el('nav',{class:'index-nav','aria-label':'設定分類索引'});
  indexNav.append(el('p',{class:'eyebrow'},'01—08 / 分類索引'));
  const tablist=el('div',{role:'tablist','aria-label':'設定分類','aria-orientation':compact?'horizontal':'vertical'});
  const tabs=new Map(),headings=new Map(),panels=new Map(),categoryButtons=new Map(),groupNodes=new Map();
  CATEGORIES.forEach((c,i)=>{
   const b=button({role:'tab',id:`${prefix}-${lifetime}-tab-${c.key}`,'data-tab':c.key,'aria-controls':`${prefix}-${lifetime}-panel-${c.key}`},'',guard(()=>host.select(c.key)));
   b.append(el('span',{class:'nav-number','aria-hidden':'true'},String(i+1).padStart(2,'0')),el('span',{},c.label));
   b.addEventListener('keydown',event=>{
    if(!alive||host.getSnapshot().lifetime!==lifetime)return;
    const n=event.key==='Home'?0:event.key==='End'?7:event.key===(compact?'ArrowRight':'ArrowDown')?(i+1)%8:event.key===(compact?'ArrowLeft':'ArrowUp')?(i+7)%8:null;
    if(n===null)return;event.preventDefault();host.select(CATEGORIES[n].key);const next=tabs.get(CATEGORIES[n].key);next.focus({preventScroll:true});if(compact)next.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'instant'});
   });
   tabs.set(c.key,b);tablist.append(b);
  });
  indexNav.append(tablist,el('p',{class:'nav-foot'},'孩子與家庭的共享權限，仍以目前身份核定。'));
  const directory=el('section',{class:'atlas-directory','aria-label':'分類圖冊'});
  directory.append(el('h2',{},'找到想看的分類'));
  const searchId=`${prefix}-${lifetime}-search`,search=el('input',{id:searchId,type:'search','data-search':'',placeholder:'搜尋八個分類',autocomplete:'off',maxlength:'120'});
  directory.append(el('label',{for:searchId},'搜尋分類名稱或說明'),search,el('p',{class:'micro'},'只搜尋此頁八個分類，不搜尋帳戶或照護資料。'));
  search.addEventListener('input',guard(()=>host.setQuery(search.value)));
  const results=el('p',{'data-search-result':'',class:'search-result',role:'status'});directory.append(results);
  GROUPS.forEach((group,i)=>{
   const groupNode=el('section',{'data-group':group,class:'directory-group'});groupNode.append(el('h3',{},`${String(i+1).padStart(2,'0')} / ${group}`));
   CATEGORIES.filter(c=>c.group===group).forEach(c=>{
    const b=button({'data-category':c.key,'aria-controls':`${prefix}-${lifetime}-panel-${c.key}`},'',guard(()=>{host.select(c.key);headings.get(c.key).focus()}));
    b.append(el('span',{class:'category-name'},c.label),el('span',{class:'category-description'},c.kicker),el('span',{class:'category-arrow','aria-hidden':'true'},'↗'));
    categoryButtons.set(c.key,b);groupNode.append(b);
   });groupNodes.set(group,groupNode);directory.append(groupNode);
  });
  const content=el('main',{class:'panel-stack','aria-label':'目前分類說明'});
  let accountSummarySlot;
  for(const [i,c] of CATEGORIES.entries()){
   const panel=el('section',{id:`${prefix}-${lifetime}-panel-${c.key}`,'data-panel':c.key,class:'section-panel'});
   panel.append(el('p',{class:'panel-index','aria-hidden':'true'},String(i+1).padStart(2,'0')));
   const scope=el('p',{'data-scope':'',class:'scope-badge'},scopeNote(c.key));
   const h=el('h2',{'data-heading':c.key,id:`${prefix}-${lifetime}-heading-${c.key}`,tabindex:'-1'},c.label);headings.set(c.key,h);
   panel.append(scope,h,el('p',{class:'panel-kicker'},c.kicker),el('p',{class:'panel-description'},c.description));
   if(c.key==='account'){accountSummarySlot=el('div',{class:'account-summary-slot'});panel.append(accountSummarySlot)}
   const boundary=el('div',{class:'boundary'});boundary.append(el('span',{class:'boundary-mark','aria-hidden':'true'},'◇'),el('p',{},c.boundary));panel.append(boundary);
   panel.append(el('p',{class:'scope-foot'},'分類切換只改此頁顯示，不代表儲存、取消工作或變更權限。'));
   panels.set(c.key,panel);content.append(panel);
  }
  workspace.append(indexNav,directory,content);
  const summary=el('section',{'data-summary':'',class:'method-summary','aria-label':'已連結方式合成摘要'});
  const summaryLabel=el('p',{class:'eyebrow'},'本人登入方式 / 唯讀合成摘要'),summaryTitle=el('h3'),methodList=el('ul',{class:'method-list'}),summaryNote=el('p',{class:'summary-note'}),readingNote=el('p',{class:'reading-note'});
  summary.append(summaryLabel,summaryTitle,methodList,summaryNote,readingNote);accountSummarySlot.append(summary);
  const pendingNote=el('p',{class:'pending-note'});
  const lab=el('details',{class:'scenario-lab'});lab.append(el('summary',{},'合成情境工具'),el('p',{},'不是帳戶操作。以下只切換本機記憶體中的示例，不登入、不連結、不傳送資料。'));
  const labControls=el('div',{class:'lab-controls'}),scenarioId=`${prefix}-${lifetime}-scenario`,scenario=el('select',{id:scenarioId,'data-scenario':''});
  SCENARIOS.forEach(([value,label])=>scenario.append(el('option',{value},label)));scenario.addEventListener('change',guard(()=>host.setScenario(scenario.value)));
  const scenarioWrap=el('div',{class:'field'});scenarioWrap.append(el('label',{for:scenarioId},'摘要示例'),scenario);
  const read=button({'data-read':''},'重讀合成摘要',guard(()=>{void host.read()}));
  const pending=button({'data-pending':''},'',guard(()=>host.setPending(!host.getSnapshot().pending)));
  const context=button({'data-context-switch':''},'切換合成身份 A / B',guard(()=>host.setContext({identity:s.context.identity==='synthetic-a'?'synthetic-b':'synthetic-a'})));
  labControls.append(scenarioWrap,read,pending,context);lab.append(labControls);
  frame.append(intro,workspace,pendingNote,lab);
  const api={frame,workspace,indexNav,directory,headings,panels,tablist,lifetime,
   update(next){
    const isAtlas=next.layout==='atlas';hide(indexNav,isAtlas);hide(directory,!isAtlas);hide(intro,!isAtlas);
    const summaryTarget=isAtlas?atlasSummarySlot:accountSummarySlot;if(summary.parentElement!==summaryTarget)summaryTarget.append(summary);
    const selected=CATEGORIES.find(c=>c.key===next.section),matches=new Set(filterCategories(next.query).map(c=>c.key));
    if(search.value!==next.query)search.value=next.query;
    results.textContent=`${matches.size} 個分類符合；目前仍閱讀「${selected.label}」。`;
    CATEGORIES.forEach(c=>{
     const active=c.key===next.section,p=panels.get(c.key),tab=tabs.get(c.key),b=categoryButtons.get(c.key);
     tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;
     hide(p,!active);p.setAttribute('role',isAtlas?'region':'tabpanel');p.tabIndex=active?0:-1;p.setAttribute('aria-labelledby',isAtlas?headings.get(c.key).id:tab.id);
     b.hidden=!matches.has(c.key);if(active)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');
    });
    for(const [group,node] of groupNodes)node.hidden=!CATEGORIES.some(c=>c.group===group&&matches.has(c.key));
    const view=projectSummary(next.summary);summary.dataset.state=view.kind;summaryTitle.textContent=view.title;summaryNote.textContent=view.note;
    methodList.replaceChildren(...view.labels.map(label=>el('li',{},label)));methodList.hidden=!view.labels.length;
    readingNote.textContent=next.reading?'正在重讀合成摘要，暫保留目前內容。':'全合成示例 · 沒有連線至身份服務';
    summary.setAttribute('aria-busy',String(next.reading));read.setAttribute('aria-disabled',String(next.reading));scenario.value=next.scenario;
    pending.textContent=next.pending?'結束合成 pending 狀態':'模擬助手 pending 開始';pending.setAttribute('aria-pressed',String(next.pending));
    pendingNote.textContent=next.pending?'合成助手 pending：開始時已選到助手；仍可閱讀其他分類。此處沒有授權操作。':'八個分類保留在同一頁；沒有任何正式設定被變更。';
   }
  };api.update(s);return api;
 }
 function render(s){
  if(!alive)return;const active=doc.activeElement;let focusTarget=null;
  if(!current||current.lifetime!==s.lifetime){const restore=current?.frame.contains(active);current=build(s);slot.replaceChildren(current.frame);if(restore)focusTarget=contextHeading}
  else{current.update(s);if(current.frame.contains(active)&&active.closest('[hidden],[inert]'))focusTarget=current.headings.get(s.section)}
  root.dataset.layout=s.layout;root.classList.toggle('is-compact',compact);
  contextHeading.textContent=`合成身份 ${s.context.identity==='synthetic-a'?'A':'B'} · 只讀導覽與範圍說明`;
  for(const [key,b] of layoutButtons)b.setAttribute('aria-pressed',String(key===s.layout));
  status.textContent=s.reading?'正在讀取本地合成摘要。':`${CATEGORIES.find(c=>c.key===s.section).label} · ${s.layout==='index'?'折頁索引':'設定圖冊'} · ${projectSummary(s.summary).title}`;
  // Native focus dispatches synchronous callbacks. Finish all projection first;
  // a nested render triggered by focus must remain the last writer.
  focusTarget?.focus();
 }
 const unsubscribe=host.subscribe(render);render(host.getSnapshot());
 function measure(width){compact=width<720;root.classList.toggle('is-compact',compact);current.tablist.setAttribute('aria-orientation',compact?'horizontal':'vertical')}
 const observer=typeof win.ResizeObserver==='function'?new win.ResizeObserver(entries=>{if(alive&&entries[0])measure(entries[0].contentRect.width)}):null;
 const resize=()=>measure(slot.getBoundingClientRect().width||win.innerWidth||720);
 observer?.observe(slot);win.addEventListener('resize',resize);resize();
 return{dispose(){alive=false;unsubscribe();observer?.disconnect();win.removeEventListener('resize',resize);root.replaceChildren()}};
}
if(typeof document!=='undefined'&&document.querySelector('#app')){
 const params=new URLSearchParams(location.search),sections=params.getAll('section');
 const host=createHost({section:sections.length?sections:undefined,pending:params.get('pending')==='true'});
 const view=mount(document.querySelector('#app'),host);
 window.addEventListener('pagehide',()=>{view.dispose();host.dispose()},{once:true});
}

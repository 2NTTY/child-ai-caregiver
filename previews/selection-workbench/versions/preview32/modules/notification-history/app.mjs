import {CHANNELS,channelLabel,channelGroups,dayGroups,timeLabel,selectionTuple} from './model.mjs';
import {SCENARIOS} from './fixtures.mjs';
const copy={ready:'目前顯示已保存的合成內容。',idle:'尚未載入本次讀窗。',loading:'正在讀取合成消息…',stale:'目前顯示較早的消息；可以繼續閱讀。',error:'暫時讀不到消息，請重新讀取。',unavailable:'消息內容暫未提供；這不表示沒有歷史消息。',authority:'讀窗已失效，舊內容已清除。請重新讀取。',access:'目前不能存取本人消息，私人內容已清除。'};
export function mount(root,host){
 const doc=root.ownerDocument;
 let alive=true,current=null,ui=null,rowSignature='',bodySignature='',focusIntent=null,lastTrigger=null,composition=false,rowCache=new Map(),navigationCache=new Map();
 const make=(tag,text,attrs={})=>{const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e};
 const button=(text,attrs,fn)=>{const e=make('button',text,{type:'button',...attrs});e.addEventListener('click',()=>{if(alive&&e.isConnected)fn(e)});return e};
 const text=(node,value)=>{if(node.textContent!==String(value))node.textContent=String(value)};
 const show=(node,yes)=>{node.hidden=!yes;if(yes)node.removeAttribute('inert');else node.setAttribute('inert','')};
 const visible=node=>node&&node.isConnected&&!node.closest('[hidden]')&&!node.disabled;
 root.className='nh-app';
 const skip=button('跳至消息內容',{'class':'skip-link','data-skip':''},()=>ui?.heading.focus());
 const top=make('header',undefined,{'class':'masthead'});
 const brand=make('div',undefined,{'class':'brand'});brand.append(make('span','育伴港',{'class':'brand-name'}),make('span','READING ROOM / NH01',{'class':'eyebrow'}));
 const layoutControls=make('div',undefined,{'class':'layout-switch','aria-label':'選擇閱讀布局'});
 const layoutButtons={};for(const[key,label]of [['signal','01 訊號艙'],['letters','02 信件冊']]){layoutButtons[key]=button(label,{'data-layout':key},()=>host.setLayout(key));layoutControls.append(layoutButtons[key])}
 top.append(brand,layoutControls);
 const hero=make('section',undefined,{'class':'hero'}),heroText=make('div'),kicker=make('p','本人消息 · 保存內容',{'class':'eyebrow'}),title=make('h1'),intro=make('p',undefined,{'class':'hero-intro'}),art=make('div',undefined,{'class':'hero-art','aria-hidden':'true'});
 art.append(make('span','✦',{'class':'orbit-spark'}),make('span','NH',{'class':'orbit-monogram'}),make('span','LOCAL ARCHIVE',{'class':'orbit-label'}));heroText.append(kicker,title,intro);hero.append(heroText,art);
 const boundary=make('p','獨立合成候選 · 只閱讀本頁已載入的示例內容 · 未接正式帳戶',{'class':'synthetic-banner'});
 const contextRoot=make('div',undefined,{'class':'context-root'});
 const lab=make('details',undefined,{'class':'lab'}),summary=make('summary','合成狀態試驗台'),labBody=make('div',undefined,{'class':'lab-body'});
 lab.append(summary,labBody);labBody.append(make('p','只切換本機合成狀態，不是帳戶操作。沒有網絡、模型、推送或寫入。'));
 const scenarioLabel=make('label','示例情境 '),scenario=make('select',undefined,{'data-scenario':''});for(const[value,label]of SCENARIOS)scenario.append(make('option',label,{value}));scenario.addEventListener('change',()=>{if(alive)host.applySyntheticScenario(scenario.value)});scenarioLabel.append(scenario);
 const online=button('切換離線',{'data-toggle-online':''},()=>host.setGates({online:!host.getSnapshot().gates.online}));
 const account=button('切換合成身份',{'data-toggle-context':''},()=>host.setContext({identity:host.getSnapshot().context.identity==='synthetic-a'?'synthetic-b':'synthetic-a'}));
 labBody.append(scenarioLabel,online,account);
 const footer=make('footer','NH01 / 兩種閱讀方式，一個合成讀窗。正式宿主、瀏覽器、讀屏與原生操作須另行驗收。',{'class':'site-footer'});
 root.replaceChildren(skip,top,hero,boundary,contextRoot,lab,footer);
 function buildContext(n){
  composition=false;rowSignature='';bodySignature='';lastTrigger=null;rowCache=new Map();navigationCache=new Map();
  const ctx=make('p',undefined,{'class':'context-label','data-context':''});
  const filters=make('section',undefined,{'class':'filters','aria-label':'篩選已載入消息'});
  const searchLabel=make('label','搜尋已載入內容',{'class':'search-field'}),search=make('input',undefined,{type:'search',placeholder:'搜尋各渠道正文或標題…','data-search':'','aria-describedby':'nh-search-hint'});
  searchLabel.append(search);filters.append(searchLabel,make('p','只搜尋已載入的所有渠道，不會發出搜尋請求。',{id:'nh-search-hint','class':'field-help'}));
  const intent=fn=>{if(alive&&ui?.lifetime===n)fn()};
  search.addEventListener('compositionstart',()=>intent(()=>{composition=true}));
  search.addEventListener('compositionend',()=>intent(()=>{composition=false;host.setFilters({query:search.value},n)}));
  search.addEventListener('input',event=>intent(()=>{if(!composition&&!event.isComposing)host.setFilters({query:search.value},n)}));
  const date=make('details',undefined,{'class':'date-filter'});date.append(make('summary','日期範圍（香港時間）'));
  const dateFields=make('div',undefined,{'class':'date-fields'});const dateInputs={};for(const[key,label]of [['from','開始日期'],['to','結束日期']]){const l=make('label',label);const e=make('input',undefined,{type:'date',[`data-date-${key}`]:'','aria-describedby':'nh-date-error'});e.addEventListener('input',()=>intent(()=>host.editDateDraft({[key]:e.value},n)));l.append(e);dateFields.append(l);dateInputs[key]=e}
  const apply=button('套用日期',{'data-apply-date':''},()=>intent(()=>host.applyDateDraft(n))),clear=button('清除所有篩選',{'data-clear-filters':''},()=>intent(()=>host.clearFilters(n)));
  const error=make('p','',{'data-date-error':'',id:'nh-date-error',role:'alert','class':'field-error'});dateFields.append(apply);date.append(dateFields,error);filters.append(date,clear);
  const status=make('div',undefined,{'class':'read-strip'}),readStatus=make('p','',{'data-read-status':''}),count=make('p','',{'data-count':'','class':'count'});status.append(readStatus,count);
  const workspace=make('main',undefined,{'class':'reading-workspace'}),heading=make('h2','已載入消息',{'data-results-heading':'',tabindex:'-1','class':'results-heading'}),empty=make('p','',{'data-empty':'','class':'empty-state'});
  const signal=make('div',undefined,{'data-signal':'','class':'signal-index'}),letters=make('div',undefined,{'data-letters':'','class':'letter-book'}),dock=make('div',undefined,{'data-reader-dock':'','class':'reader-dock'});
  const reader=make('section',undefined,{'data-reader':'',role:'region','aria-labelledby':'nh-reader-heading','class':'reader'});reader.hidden=true;
  const readerTop=make('div',undefined,{'class':'reader-top'}),readerHeading=make('h2','消息內容',{'data-reader-heading':'',id:'nh-reader-heading',tabindex:'-1'});
  const close=button('關閉閱讀',{'data-close':'','class':'close-reader'},()=>intent(()=>{focusIntent={kind:'close',lifetime:n};host.closeDetail(n)}));
  reader.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();intent(()=>{focusIntent={kind:'close',lifetime:n};host.closeDetail(n)})}});
  const hint=make('div',undefined,{'data-reader-hint':'','class':'reader-hint'});hint.append(make('span','✦',{'aria-hidden':'true','class':'hint-star'}),make('h3','選擇一道訊號'),make('p','從左側的渠道索引打開消息。這裡會一起呈現該則消息所有已保存的渠道正文。'));dock.append(hint);
  readerTop.append(readerHeading,close);const attribution=make('p','',{'data-reader-meta':'','class':'meta'}),bodies=make('div',undefined,{'data-channel-bodies':''});reader.append(readerTop,attribution,bodies);dock.append(reader);
  workspace.append(heading,empty,signal,letters,dock);
  const controls=make('div',undefined,{'class':'read-actions'});
  const readAction=kind=>()=>intent(()=>{const s=host.getSnapshot();if(s.busy||!s.readAvailability.allowed||kind==='more'&&!s.window?.nextCursor)return;const accepted=host.requestRead(kind,n);if(!accepted)return;/* No focus restoration is scheduled from a void result. Buttons remain focusable. */});
  const more=button('載入更多消息',{'data-more':'','class':'primary'},readAction('more')),retry=button('重新讀取消息',{'data-retry':''},readAction('retry'));controls.append(more,retry);
  const coverage=make('p','',{'data-coverage':'','class':'coverage'}),live=make('p','',{'data-live':'',role:'status','aria-live':'polite','aria-atomic':'true','class':'sr-only'});
  contextRoot.replaceChildren(ctx,filters,status,workspace,controls,coverage,live);
  ui={lifetime:n,hint,ctx,search,dateInputs,error,readStatus,count,heading,empty,workspace,signal,letters,dock,reader,readerHeading,attribution,bodies,close,more,retry,coverage,live,rows:[],navigation:[],letterSlots:new Map()};
 }
 function rowButton(s,item,channel,layout){
  const c=channel?item.contents.find(c=>c.channel===channel):item.contents[0],tuple=selectionTuple(s,item);
  const cacheKey=JSON.stringify([layout,channel,tuple]);
  const b=rowCache.get(cacheKey)??button('',{'data-row':item.messageId,'data-tuple':tuple,'class':'message-button','aria-controls':'nh-reader-heading'},()=>{if(ui.lifetime!==s.lifetime)return;lastTrigger={id:item.messageId,element:b};focusIntent={kind:'open',tuple};if(!host.select(item.messageId,s.lifetime,tuple))focusIntent=null});
  rowCache.set(cacheKey,b);b.replaceChildren();
  b.append(make('span',c.title??'保存的消息',{'class':'row-title'}),make('span',c.body,{'class':'row-preview'}),make('span',`預覽：${channelLabel(c.channel)}${item.contents.length>1?` · 共 ${item.contents.length} 個渠道`:''}`,{'class':'meta'}),make('time',timeLabel(item.sentAt),{datetime:item.sentAt,'class':'meta'}));
  b.setAttribute('aria-label',`閱讀消息：${c.title??'保存的消息'}；預覽來自${channelLabel(c.channel)}`);
  ui.rows.push({node:b,id:item.messageId,layout,tuple,cacheKey});return b;
 }
 function navigationNode(key,create){const node=navigationCache.get(key)??create();navigationCache.set(key,node);ui.navigation.push({key,node});return node}
 function rebuildRows(s){
  // Rescue the one live reader before replacing an inline letter's parent.
  if(ui.reader.parentElement!==ui.dock)ui.dock.append(ui.reader);
  ui.rows=[];ui.navigation=[];ui.letterSlots=new Map();ui.signal.replaceChildren();ui.letters.replaceChildren();
  const channels=channelGroups(s.visible),channelNav=make('nav',undefined,{'aria-label':'渠道索引','class':'channel-directory'}),channelList=make('div',undefined,{'class':'channel-lists'});
  for(const g of channels){const section=make('section',undefined,{'data-channel-group':g.key,'class':'channel-group'}),h=navigationNode(`signal:heading:${g.key}`,()=>make('h3','',{tabindex:'-1','class':'group-title'})),ol=make('ol',undefined,{role:'list'});text(h,`${g.label} · ${g.items.length} 個渠道項目`);const key=`signal:jump:${g.key}`,jump=navigationNode(key,()=>button('',{'class':'channel-jump','data-channel-jump':g.key},()=>{if(ui.lifetime===s.lifetime&&current.layout==='signal'&&navigationCache.get(key)===jump&&visible(h))h.focus()}));jump.replaceChildren();jump.append(make('span',CHANNELS.find(c=>c[0]===g.key)[2],{'class':'index-number'}),make('span',g.label),make('span',String(g.items.length),{'class':'channel-count'}));channelNav.append(jump);for(const item of g.items){const li=make('li');li.append(rowButton(s,item,g.key,'signal'));ol.append(li)}section.append(h,ol);channelList.append(section)}
  ui.signal.append(channelNav,make('p','按渠道找內容；多渠道消息會在對應分區重複列出。',{'class':'architecture-note'}),channelList);
  const days=dayGroups(s.visible),toc=make('nav',undefined,{'aria-label':'信件日期目錄','class':'day-directory'}),chapters=make('div',undefined,{'class':'chapters'});
  for(const[gIndex,g]of days.entries()){const chapter=make('section',undefined,{'data-day-group':g.key,'class':'day-chapter'}),h=navigationNode(`letters:heading:${g.key}`,()=>make('h3','',{'data-day-heading':'',tabindex:'-1','class':'chapter-heading'})),key=`letters:jump:${g.key}`,jump=navigationNode(key,()=>button(g.key,{'data-day-jump':g.key},()=>{if(ui.lifetime===s.lifetime&&current.layout==='letters'&&navigationCache.get(key)===jump&&visible(h))h.focus()}));text(h,`${g.key} · ${g.items.length} 則`);toc.append(jump);const chapterTop=make('div',undefined,{'class':'chapter-top'});chapterTop.append(make('span',String(gIndex+1).padStart(2,'0'),{'class':'chapter-number','aria-hidden':'true'}),h);const ol=make('ol',undefined,{role:'list'});for(const item of g.items){const li=make('li',undefined,{'class':'letter-entry'}),slot=make('div',undefined,{'data-letter-slot':item.messageId});li.append(rowButton(s,item,null,'letters'),slot);ol.append(li);ui.letterSlots.set(item.messageId,slot)}chapter.append(chapterTop,ol);chapters.append(chapter)}
  ui.letters.append(toc,make('p','按消息日期分章，每則只列一次。打開信件，就地閱讀全部渠道。',{'class':'architecture-note'}),chapters);
  rowCache=new Map(ui.rows.map(r=>[r.cacheKey,r.node]));navigationCache=new Map(ui.navigation.map(n=>[n.key,n.node]));
 }
 function render(s){
  if(!alive)return;
  const old=current,oldUI=ui,focused=doc.activeElement,wasInReader=!!oldUI?.reader.contains(focused),wasInContext=contextRoot.contains(focused);
  const wasRow=!!oldUI?.rows.some(r=>r.node===focused),wasNavigation=!!oldUI?.navigation.some(n=>n.node===focused);
  const action=focusIntent;focusIntent=null;current=s;let focusTarget=null;
  const hard=!ui||ui.lifetime!==s.lifetime;
  if(hard){buildContext(s.lifetime);if(wasInContext)focusTarget=ui.heading}
  root.dataset.layout=s.layout;
  for(const[key,b]of Object.entries(layoutButtons))b.setAttribute('aria-pressed',String(s.layout===key));
  text(title,s.layout==='signal'?'記錄裡的每一道訊號':'給日子，留一頁');
  text(intro,s.layout==='signal'?'從渠道索引出發，找回一段已保存的話。':'把零散的消息，讀成一天一天的小章節。');
  text(ui.ctx,`本人消息 · ${s.context.identity} · 合成帳戶`);
  if(!composition&&ui.search.value!==s.filters.query)ui.search.value=s.filters.query;
  for(const k of ['from','to'])if(ui.dateInputs[k].value!==s.draft[k])ui.dateInputs[k].value=s.draft[k];
  text(ui.error,s.draft.error);
  text(ui.readStatus,s.busy?(s.window?'正在讀取合成消息；目前內容仍可閱讀。':'正在讀取合成消息…'):(copy[s.readState]??copy.idle));
  text(ui.count,`已載入 ${s.window?.items.length??0} 則 · 篩選符合 ${s.visible.length} 則`);
  const rows=JSON.stringify([s.lifetime,s.window?.items,s.filters]);if(rows!==rowSignature){rowSignature=rows;rebuildRows(s)}
  show(ui.signal,s.layout==='signal');show(ui.letters,s.layout==='letters');show(ui.hint,!s.detail);show(ui.dock,s.layout==='signal');
  show(ui.empty,s.visible.length===0);text(ui.empty,s.busy&&!s.window?'正在讀取，尚不能判定是否有內容。':!s.window?(copy[s.readState]??copy.idle):s.window.nextCursor?'已載入部分沒有符合的內容，仍有記錄未載入。':'已載入消息沒有符合的內容；較早保存範圍仍未確認。');
  for(const row of ui.rows){row.node.setAttribute('aria-expanded',String(!!s.selection&&s.selection.tuple===row.tuple));row.node.classList.toggle('selected',!!s.selection&&s.selection.tuple===row.tuple)}
  const destination=s.layout==='letters'&&s.detail?ui.letterSlots.get(s.detail.messageId):ui.dock;
  if(ui.reader.parentElement!==destination)destination.append(ui.reader);
  if(s.detail){
   show(ui.reader,true);text(ui.readerHeading,'消息內容');text(ui.attribution,`${timeLabel(s.detail.sentAt)} · ${s.detail.scope.kind==='child'?s.detail.scope.childName:'本人帳戶'} · ${s.detail.contents.length} 個保存渠道`);
   const next=JSON.stringify(s.detail);if(next!==bodySignature){bodySignature=next;ui.bodies.replaceChildren();for(const c of s.detail.contents){const section=make('section',undefined,{'data-content-channel':c.channel,'class':'channel-body'});section.append(make('h3',channelLabel(c.channel)));if(c.title)section.append(make('h4',c.title));section.append(make('p',c.body,{'class':'saved-body'}),make('time',`渠道時間：${timeLabel(c.sentAt)}`,{datetime:c.sentAt,'class':'meta'}));ui.bodies.append(section)}}
   if(action?.kind==='open'&&action.tuple===s.selection.tuple)focusTarget=ui.readerHeading;
   else if(wasInReader&&!hard&&focused.isConnected)focusTarget=focused;
  }else{
   show(ui.reader,false);bodySignature='';ui.bodies.replaceChildren();text(ui.attribution,'');
   if(wasInReader)focusTarget=ui.heading;
   if(action?.kind==='close'&&action.lifetime===s.lifetime){const exact=lastTrigger?.element;focusTarget=visible(exact)?exact:ui.rows.find(r=>r.layout===s.layout&&r.id===lastTrigger?.id)?.node??ui.heading}
  }
  if((wasRow||wasNavigation)&&!focusTarget)focusTarget=visible(focused)?focused:ui.heading;
  if(old&&old.layout!==s.layout&&!hard&&!focusTarget&&wasInContext&&!visible(focused))focusTarget=ui.heading;
  ui.more.setAttribute('aria-disabled',String(!s.readAvailability.allowed||!s.window?.nextCursor));
  ui.retry.setAttribute('aria-disabled',String(!s.readAvailability.allowed));
  text(ui.more,s.busy?'正在讀取…':'載入更多消息');
  text(ui.coverage,`${s.window?.complete?'這次 live 讀窗已到當下末端。':'這次 live 讀窗仍可能有更多內容。'} 較早保存範圍仍未確認。只展示已保存內容，不包括帳戶驗證電郵；不代表本人收到或閱讀。`);
  text(ui.live,s.detail?'正在閱讀消息內容。':s.busy?'正在讀取消息。':`目前篩選符合 ${s.visible.length} 則已載入消息。`);
  text(online,s.gates.online?'切換離線':'恢復合成連線');scenario.value=s.scenario;
  // All projection is complete before native focus, which may synchronously
  // publish another context/filter/layout. Nothing writes DOM after this line.
  if(visible(focusTarget)&&doc.activeElement!==focusTarget)focusTarget.focus();
 }
 const stop=host.subscribe(render);render(host.getSnapshot());
 return{dispose(){if(!alive)return;alive=false;stop();focusIntent=null;root.replaceChildren()}};
}

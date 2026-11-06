import {SCENARIOS} from './fixtures.mjs';
import {timeInfo,concernKey,entriesFor,filterConcerns,filterEntries,evidenceLabel,eventLabel,attentionLabels} from './model.mjs';

export function mountGrowth(root,host){
 const doc=root.ownerDocument;
 let dead=false,renderTicket=0,knownGeneration=-1,knownLayout=null,openSources=new Set();
 const activeControls=new Map(),composingInputs=new WeakSet(),committedValues=new WeakMap();
 const el=(tag,attrs={},...children)=>{const n=doc.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(v==null||v===false&&!k.startsWith('aria-'))continue;if(k.startsWith('aria-'))n.setAttribute(k,String(v));else if(k==='class')n.className=v;else if(k==='value')n.value=v;else n.setAttribute(k,v===true?'':String(v))}for(const c of children.flat(Infinity))if(c!=null)n.append(c.nodeType?c:doc.createTextNode(String(c)));return n};
 const keyNode=key=>[...root.querySelectorAll('[data-focus-key]')].find(n=>n.dataset.focusKey===key);
 const focus=(key,preventScroll=false)=>keyNode(key)?.focus({preventScroll});
 const raw=value=>value===null?'null':value===''?'（空字串）':value===undefined?'（未提供）':String(value);
 const tag=(text,tone='')=>el('span',{class:`badge ${tone}`},text);
 // Only these known render islands are retained. Never move an active input or
 // an ancestor into a detached replacement tree: that closes native pickers.
 function keepConnectedChildren(parent,wanted,retained){
  let cursor=parent.firstChild;
  for(const node of wanted){
   if(retained.has(node)){
    while(cursor&&cursor!==node){const next=cursor.nextSibling;cursor.remove();cursor=next}
    cursor=node.nextSibling;
   }else parent.insertBefore(node,cursor);
  }
  while(cursor){const next=cursor.nextSibling;cursor.remove();cursor=next}
 }
 function patchControls(current,next){
  const known=new Map([...current.children].map(n=>[n.dataset.stableControl,n]));
  const retained=new Set();
  const wanted=[...next.childNodes].map(node=>{
   const key=node.dataset?.stableControl,old=key&&known.get(key);
   if(!old)return node;
   const control=old.matches('button')?old:old.querySelector('input,select');
   const proposed=node.matches('button')?node:node.querySelector('input,select');
   if(!control||control.tagName!==proposed?.tagName||control.type!==proposed.type)return node;
   retained.add(old);
   if(control.tagName==='BUTTON')control.disabled=proposed.disabled;
   else if(!composingInputs.has(control)){
    // Do not assign even an equal value: native date segment state is not
    // exposed by .value, and a setter can disturb an unfinished native edit.
    if(control.value!==proposed.value)control.value=proposed.value;
    committedValues.set(control,proposed.value);
   }
   return old;
  });
  keepConnectedChildren(current,wanted,retained);
  return current;
 }

 function render(s){
  if(dead)return;
  const ticket=++renderTicket,generation=s.generation;
  const sameContext=generation===knownGeneration&&s.layout===knownLayout;
  const active=root.contains(doc.activeElement)?doc.activeElement:null,focusKey=active?.dataset.focusKey;
  const selection=active?.tagName==='INPUT'&&active.type==='search'?[active.selectionStart,active.selectionEnd]:null;
  if(generation!==knownGeneration){openSources.clear();knownGeneration=generation}
  const guard=fn=>(event)=>{if(!dead&&renderTicket===ticket&&host.getSnapshot().generation===generation)return fn(event)};
  const stableGuard=(node,fn)=>event=>{
   if(!dead&&host.getSnapshot().generation===generation&&activeControls.get(node.dataset.action)===node&&root.contains(node))return fn(event);
  };
  const button=(text,action,fn,attrs={})=>{const n=el('button',{type:'button','data-action':action,'data-focus-key':action,...attrs},text);n.addEventListener('click',attrs['data-stable-control']?stableGuard(n,fn):guard(fn));return n};
  const select=(label,action,options,value,fn)=>{const n=el('select',{'data-action':action,'data-focus-key':action,'aria-label':label},options.map(([val,name])=>el('option',{value:val},name)));n.value=value;n.addEventListener('change',stableGuard(n,()=>fn(n.value)));return el('label',{class:'control','data-stable-control':action},el('span',{},label),n)};
  const field=(label,action,value,type,fn)=>{
   const n=el('input',{type,value,'data-action':action,'data-focus-key':action,'aria-label':label});
   committedValues.set(n,value);
   const commit=()=>{if(committedValues.get(n)!==n.value){committedValues.set(n,n.value);fn(n.value)}};
   n.addEventListener('input',stableGuard(n,event=>{
    if(type==='search'&&(event.isComposing||composingInputs.has(n))){composingInputs.add(n);return}
    commit();
   }));
   if(type==='search'){
    n.addEventListener('compositionstart',stableGuard(n,()=>composingInputs.add(n)));
    n.addEventListener('compositionend',stableGuard(n,()=>{composingInputs.delete(n);commit()}));
   }
   return el('label',{class:'control','data-stable-control':action,...(type==='search'?{'data-search':true}:{})},el('span',{},label),n);
  };
  function disclosure(label,key,children){const summary=el('summary',{'data-focus-key':`source:${key}`},label);const n=el('details',{'data-source':key,open:openSources.has(key)},summary,el('div',{class:'source-body'},children));n.addEventListener('toggle',guard(()=>{if(n.open)openSources.add(key);else openSources.delete(key)}));return n}
  const meta=rows=>el('dl',{class:'metadata'},rows.map(([k,v])=>[el('dt',{},k),el('dd',{},raw(v))]));
  function unavailable(label){return button(label,'unavailable',()=>{},{disabled:true,'data-unavailable':true})}
  function sourcePanel(row){
   const r=row.record;
   const data=row.kind==='attention'?[
    ['來源名稱',r.source?.title],['來源章節',r.source?.section],['來源網址原值（未接外連）',r.source?.url],['sourceId',r.source?.sourceId],['versionId',r.source?.versionId],['chunkId',r.source?.chunkId],['contentHash',r.source?.contentHash],['來源核對時間原值',r.source?.checkedAt],['原始時間 · updatedAt',row.at],['建議 ID／版本',`${r.id} / ${r.version}`]
   ]:[['原始來源描述',r.sourceLabel],['原始時間 · event.at',row.at],['事件 ID',r.id],...(r.attentionId?[['關聯建議 ID',r.attentionId],['關聯建議版本',r.attentionVersion]]:[]),...(r.recordId?[['照顧記錄 ID',r.recordId]]:[]),...(r.taskId?[['任務 ID',r.taskId]]:[])];
   return disclosure('核對原始來源與欄位',row.key,[meta(data),row.kind==='attention'?el('p',{class:'reading'},r.source?.excerpt??'來源節錄未提供'):null,el('p',{class:'muted'},'只顯示本讀窗提供的原值；未讀取連結目標或隱藏資料。'),(r.recordId?unavailable('照顧記錄未接線'):null),(r.taskId?unavailable('任務查看未接線'):null)]);
  }
  function attentionCard(r,key){
   const row={kind:'attention',record:r,at:r.updatedAt,key};
   return el('article',{class:'attention-card'},tag(attentionLabels[r.state]??'狀態未提供','suggestion'),el('h3',{},r.title),el('p',{class:'reading'},r.whyNow),el('p',{class:'reading'},r.advice),el('p',{class:'limits'},r.limits),r.note?el('p',{class:'reading'},r.note):null,el('p',{class:'muted'},evidenceLabel(r.evidence?.profileVersion)),el('p',{class:'muted'},r.sourceAvailable?'這是建議讀窗，不代表已採取動作。':'原來源已失效，只保留處理狀態，不作目前建議。'),el('p',{class:'muted'},r.taskId?`已連結任務；讀取時狀態：${r.taskState??'未提供'}。目前狀態仍以任務為準。`:'沒有可見任務連結；不代表已完成行動。'),sourcePanel(row));
  }
  function eventCard(row,inTrack=false){
   const r=row.record,t=timeInfo(row.at);
   const card=el('article',{class:inTrack?'event-card track-event':'event-card','data-row-key':row.key},
    el('div',{class:'event-meta'},tag(eventLabel(row),row.kind==='attention'?'suggestion':r.kind==='confirmed_action'?'action':''),el('span',{},row.timeKind)),
    el('p',{class:'time'},t.label),el('h3',{},r.title),
    el('p',{class:'reading'},row.kind==='event'?r.text:r.note||'此讀窗沒有附加處理說明。'),
    el('p',{class:'source-label'},row.kind==='event'?`來源：${r.sourceLabel||'未提供'}`:`來源：${r.source?.title??'未提供'}`));
   if(row.kind==='attention')card.append(el('p',{class:'muted'},evidenceLabel(r.evidence?.profileVersion)),el('p',{class:'muted'},r.sourceAvailable?'建議狀態不等於行動完成。':'來源已失效，這只是歷史狀態。'),el('p',{class:'muted'},r.taskId?`任務讀取時狀態：${r.taskState??'未提供'}；不代表事件當時或目前狀態。`:'沒有可見任務連結；不代表已完成行動。'),disclosure('閱讀建議原文',`advice:${row.key}`,[el('p',{class:'reading'},r.whyNow),el('p',{class:'reading'},r.advice),el('p',{class:'limits'},r.limits)]));
   card.append(sourcePanel(row));
   if(inTrack)card.append(button(`讀原關注 · ${row.concern.title}`,'open-event',()=>{host.openFromTrack(row.key);focus('case-heading')},{'data-focus-key':`event:${row.key}`,class:'read-case'}));
   return card;
  }
  const masthead=el('header',{class:'masthead'},el('div',{class:'brand'},el('span',{class:'brand-mark','aria-hidden':'true'},'芽'),el('div',{},el('p',{class:'eyebrow'},'育伴港 · 選配工作台'),el('h1',{},'成長觀察室'))),el('div',{class:'edition'},el('span',{},'GR01 / READING STUDY'),el('strong',{},s.layout==='folio'?'01 個案簿':'02 觀察軌道')));
  const safety=el('aside',{class:'safety','aria-label':'合成預覽邊界'},el('strong',{},'獨立草稿 · 全部為合成示例 · 未接正式資料'),el('span',{},'只讀，不保存、不發送、不調用模型。這不是發展評估或健康建議。'));
  const switcher=el('nav',{class:'layout-switch','aria-label':'比較兩種閱讀架構'},button('01 關注個案簿','layout-folio',()=>host.setLayout('folio'),{'aria-pressed':s.layout==='folio',class:'layout-button'}),button('02 平行觀察軌道','layout-track',()=>host.setLayout('track'),{'aria-pressed':s.layout==='track',class:'layout-button'}));
  const lab=el('section',{class:'lab-controls','aria-label':'合成情境控制'},select('合成身份','identity',[['a','空間 A · 小芽'],['b','空間 B · 小舟']],s.identity,value=>host.setIdentity(value)),select('讀取情境（合成）','scenario',SCENARIOS,s.scenario,value=>host.setScenario(value)),button('重新載入合成示例','reload',()=>host.load(),{disabled:!s.online||s.load==='loading','data-stable-control':'reload'}));
  const p=s.page;
  const notice=s.load==='denied'?'存取已失效，舊內容及選擇已清除。':s.load==='loading'?'正在讀取合成示例…':s.load==='error'?(p?'讀取失敗，保留舊讀窗。以下不是已更新內容。':'未能讀取合成讀窗，不能推定沒有資料。'):!s.online?'目前離線，只能閱讀上次讀窗，內容可能未更新。':p?'合成讀窗已載入。':'尚未讀取合成示例。';
  const status=el('p',{role:'status','aria-live':'polite',class:`read-status ${s.load==='error'||s.load==='denied'?'warn':''}`},notice);
  const main=el('main',{id:'reading',class:`workspace ${s.layout}`,'data-focus-key':'main',tabindex:'-1'});
  if(p){
   main.append(el('div',{class:'window-note'},el('strong',{},p.identityLabel),el('p',{},p.fixtureNotice),el('p',{class:'muted'},`合成讀窗時間：${timeInfo(p.loadedAt).label}。搜尋與數目只涵蓋這次已載入內容。`),p.historyHasMore?el('p',{class:'muted'},'GrowthAttention 只提供已載入讀窗，可能仍有較舊項目；總量未知，這裏未接續頁或任意版本查詢。'):null));
   if(p.operation)main.append(disclosure('原操作結果未知 · 只讀說明','operation',[el('p',{class:'warn'},'不自動重送。Concern 正式恢復沿原 opId＋body 再 POST，不是 GET 查詢；本候選沒有重試能力。Growth item/topic 另有原 body／版本協定，不混用此 opId。'),meta([['owner',p.operation.owner],['opId',p.operation.opId]]),el('pre',{'data-original-body':true},p.operation.body)]));
   if(p.concerns.state!=='ready'){
    main.append(el('section',{class:'empty-panel'},el('h2',{},'關注未分享／暫不可用'),el('p',{},'沒有可用的 Concern 讀窗，不能顯示為「沒有關注」。GrowthAttention 是不同的資料切面。')),el('section',{class:'suggestion-shelf'},el('h2',{},'已載入建議讀窗'),p.items.filter(a=>a.childId===p.childId).map(a=>attentionCard(a,`unavailable:${a.id}:${a.version}`))));
   }else if(s.layout==='folio'){
    const f=s.caseFilter,rows=filterConcerns(p,p.childId,f),selected=rows.find(c=>concernKey(c)===s.selected);
    const toolbar=el('div',{class:'filters'},field('搜尋已載入關注全文／原始來源','case-search',f.q,'search',q=>host.setCaseFilter({q})),select('個案書架','case-status',[['following','持續關注'],['closed','已結束'],['all','全部已載入']],f.status,status=>host.setCaseFilter({status,from:'',to:''})));
    if(f.status==='closed')toolbar.append(field('結束日期由（香港）','case-from',f.from,'date',from=>host.setCaseFilter({from})),field('結束日期至（香港）','case-to',f.to,'date',to=>host.setCaseFilter({to})));
    if(f.q||f.from||f.to)toolbar.append(button('清除此視角篩選','case-reset',()=>{host.setCaseFilter({q:'',from:'',to:''});focus('case-search',true)},{'data-stable-control':'case-reset'}));
    main.append(toolbar,el('p',{class:'result-count'},`目前讀窗符合 ${rows.length} 條關注。日期篩選使用關注結束日期，不是觀察發生日期。`));
    const index=el('nav',{class:'case-index','aria-label':'關注個案索引'},el('p',{class:'eyebrow'},'CASE FILES / 個案索引'),rows.map(c=>button('', 'select-case',()=>{host.selectCase(concernKey(c));focus('case-heading')},{'data-focus-key':`case:${concernKey(c)}`,'aria-current':s.selected===concernKey(c)?'true':null,class:'case-link'})));
    [...index.querySelectorAll('button')].forEach((b,i)=>{const c=rows[i];b.append(el('span',{class:'case-code'},c.id.toUpperCase()),el('strong',{},c.title),el('span',{},`${c.status==='closed'?'已結束':'持續關注'} · v${c.version}`))});
    const reading=el('div',{class:'folio-reading'});
    if(selected){
     const c=selected,ck=concernKey(c),events=entriesFor(c,p);
     const top=el('div',{class:'case-title'},el('span',{class:'large-code','aria-hidden':'true'},c.id.split('-').at(-1).toUpperCase()),el('div',{},el('p',{class:'eyebrow'},`${c.id} · CURRENT v${c.version}`),el('h2',{tabindex:'-1','data-focus-key':'case-heading'},c.title),tag(c.status==='closed'?'已結束關注':'持續關注')));
     const reader=el('section',{class:'case-reader','aria-label':`完整關注：${c.title}`},top,el('p',{class:'reading reason'},c.reason),el('p',{class:'muted'},`Concern ID：${c.id}。${c.status==='closed'?`結束日期：${timeInfo(c.archivedAt).label}；結束不等於刪除。`:'持續關注不代表健康風險。'}`));
     if(c.followUp)reader.append(el('aside',{class:'followup'},el('strong',{},'站內跟進'),el('p',{},`${timeInfo(c.followUp.at).label} · ${c.followUp.state==='unknown'?'結果待核對':c.followUp.state}`),el('p',{class:'muted'},'這是站內 Agent 流程狀態，不是外部通知送達，也不是家長任務完成。')));
     if(s.returnRow)reader.append(button('返回原觀察位置','back-track',()=>{const key=host.backToTrack();focus(key?`event:${key}`:'main')}));
     reader.append(el('section',{class:'case-events'},el('h2',{},'原文與狀態記錄'),events.length?events.map(row=>eventCard(row)):el('p',{class:'empty-panel'},'這條關注沒有已載入事件；未記錄不等於沒有發生。')));
     const proposals=p.items.filter(a=>a.childId===c.childId&&c.attentionIds.includes(a.id)&&a.state==='proposed');
     if(proposals.length)reader.append(el('section',{class:'suggestion-shelf'},el('h2',{},'待確認建議'),el('p',{},'建議不在已發生的觀察中，也不代表已採取動作。'),proposals.map(a=>attentionCard(a,`${ck}:proposal:${a.id}:${a.version}`))));
     reader.append(button('收起個案閱讀','close-case',()=>{host.closeCase();focus(`case:${ck}`)},{class:'quiet'}));reading.append(reader);
    }else reading.append(el('section',{class:'empty-panel'},el('h2',{},rows.length?'從個案索引開始閱讀':p.concerns.items.length?'目前讀窗沒有符合篩選的關注':'本次讀窗沒有關注'),el('p',{},'只代表這次讀窗。搜尋不會讀取窗外資料，也不產生全歷史總量。')));
    main.append(el('div',{class:'folio-grid'},index,reading));
   }else{
    const f=s.trackFilter,rows=filterEntries(p,p.childId,f),allCases=filterConcerns(p,p.childId,{status:f.status}),unknownExcluded=filterEntries(p,p.childId,{...f,from:'',to:'',time:'unknown'}).length;
    main.append(el('header',{class:'track-heading'},el('p',{class:'eyebrow'},'OBSERVATION LANES / 時間先行'),el('h2',{},'按事件時間，找回每一段原文'),el('p',{},'橫向欄位只區分個案；沒有因果箭頭。列距不表示實際時間差。建議使用狀態更新時間，與觀察事件時間分開標示。')));
    main.append(el('div',{class:'filters'},field('搜尋已載入事件全文／來源','track-search',f.q,'search',q=>host.setTrackFilter({q})),select('事件類別','track-kind',[['all','全部類別'],['observation','原始觀察'],['confirmed_action','已確認操作'],['attention','建議狀態']],f.kind,kind=>host.setTrackFilter({kind})),select('關注狀態','track-status',[['all','全部已載入'],['following','持續關注'],['closed','已結束']],f.status,status=>host.setTrackFilter({status})),select('時間可用性','track-time',[['all','所有時間狀態'],['unknown','只看未知時間']],f.time,time=>host.setTrackFilter({time})),field('事件日期由（香港）','track-from',f.from,'date',from=>host.setTrackFilter({from})),field('事件日期至（香港）','track-to',f.to,'date',to=>host.setTrackFilter({to})),button('清除此視角篩選','track-reset',()=>host.setTrackFilter({q:'',status:'all',kind:'all',time:'all',from:'',to:''}),{'data-stable-control':'track-reset'})));
    main.append(el('p',{class:'result-count'},`目前讀窗符合 ${rows.length} 條顯示列；不是全歷史事件總量。${(f.from||f.to)&&unknownExcluded?` 日期篩選排除 ${unknownExcluded} 條未知時間列。`:''}`));
    const groups=new Map();for(const row of rows){const day=timeInfo(row.at).day??'unknown';if(!groups.has(day))groups.set(day,[]);groups.get(day).push(row)}
    if(!rows.length)main.append(el('section',{class:'empty-panel'},el('h3',{},p.concerns.items.length?'目前讀窗沒有符合的事件':'本次讀窗沒有關注事件'),el('p',{},'不推定其他日期沒有觀察。可清除篩選或切換合成情境。')));
    for(const[day,entries]of groups){const ul=el('ul',{class:'track-lanes',style:`--lane-count:${Math.max(1,allCases.length)}`},entries.map(row=>el('li',{style:`--lane:${allCases.findIndex(c=>concernKey(c)===row.concernKey)+1}`},el('div',{class:'lane-label'},el('span',{},row.concern.id.toUpperCase()),el('strong',{},row.concern.title),tag(row.concern.status==='closed'?'已結束':'持續關注')),eventCard(row,true))));main.append(el('section',{class:`track-date ${day==='unknown'?'unknown-dates':''}`,'data-day':day},el('h3',{class:'day-heading'},day==='unknown'?'時間未定位 · 不放進本週':day),ul))}
    const proposals=p.items.filter(a=>a.childId===p.childId&&a.state==='proposed');
    if(proposals.length)main.append(el('section',{class:'suggestion-shelf'},el('h2',{},'待確認建議 · 軌道以外'),el('p',{},'這個獨立建議讀窗不受事件篩選影響，也不代表已採取動作。'),proposals.map(a=>attentionCard(a,`track-proposal:${a.id}:${a.version}`))));
   }
  }else main.append(el('section',{class:'empty-panel'},el('h2',{},s.load==='denied'?'沒有可讀內容':s.load==='error'?'讀取未完成':'等待合成讀窗'),el('p',{},'使用上方情境控制切換示例。沒有連接正式登入、權限、資料或重試操作。')));
  const footer=el('footer',{class:'boundary-footer'},el('strong',{},'保留原 owner，這裏只比較閱讀方式。'),el('p',{},'Concern、GrowthAttention 與 FamilyDocuments 不合併。報告版本、照顧記錄、任務、原操作恢復、近況設定、結束／恢復、建議決策、聊天及模型都未接線。'),el('p',{},'GR-F01 已在 PR #506 修復；這個合成介面仍不是正式接線驗收。'),el('p',{class:'muted'},'參考：RhineLabUI 的檔案閱讀節奏、Radix Data List 的來源欄位、UX Stack Exchange 的語意篩選討論、Impeccable bolder 的層次對比。僅參考設計原則，沒有移植程式、字體、角色或遊戲素材。完整來源與授權記錄隨候選封包提供。'));
  root.className=`gr01 layout-${s.layout}`;
  let liveLab=lab,liveMain=main;
  if(sameContext){
   const oldLab=root.querySelector('.lab-controls'),oldMain=root.querySelector('main');
   if(oldLab)liveLab=patchControls(oldLab,lab);
   if(oldMain){
    const oldFilters=oldMain.querySelector('.filters'),newFilters=main.querySelector('.filters');
    const filters=oldFilters&&newFilters?patchControls(oldFilters,newFilters):null;
    keepConnectedChildren(oldMain,[...main.childNodes].map(n=>n===newFilters&&filters?filters:n),new Set(filters?[filters]:[]));
    liveMain=oldMain;
   }
   keepConnectedChildren(root,[masthead,safety,switcher,liveLab,status,liveMain,footer],new Set([liveLab,liveMain].filter(n=>n.parentNode===root)));
  }else root.replaceChildren(masthead,safety,switcher,lab,status,main,footer);
  knownLayout=s.layout;
  activeControls.clear();
  for(const island of root.querySelectorAll('[data-stable-control]')){
   const control=island.matches('button')?island:island.querySelector('input,select');
   if(control)activeControls.set(control.dataset.action,control);
  }
  if(focusKey){const next=keyNode(focusKey);if(next&&next!==doc.activeElement){next.focus({preventScroll:true});if(selection&&next.type==='search'&&!composingInputs.has(next))try{next.setSelectionRange(...selection)}catch{}}}
 }
 const unsubscribe=host.subscribe(render);render(host.getSnapshot());
 return{destroy(){if(dead)return;dead=true;++renderTicket;unsubscribe();openSources.clear();activeControls.clear();root.replaceChildren()}};
}

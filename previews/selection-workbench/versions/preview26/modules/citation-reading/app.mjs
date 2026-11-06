import {scenarios} from './fixture.mjs';
import {createHost} from './host.mjs';
// This renderer consumes only the synthetic CI01 host, never ProductAgentOwner.
export function mount(root,host){
 const doc=root.ownerDocument;let disposed=false,frame=null,frameKey='',pendingFocus=null,late=null;
 function el(tag,text,attrs={}){const n=doc.createElement(tag);if(text!==null)n.textContent=text;for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n}
 function btn(text,fn,attrs={}){const b=el('button',text,{type:'button',...attrs});b.addEventListener('click',()=>{if(!disposed&&root.contains(b))fn(b)});return b}
 const header=el('header',null,{class:'page-header'}),eyebrow=el('p','CI01 / CITATION READING',{class:'eyebrow'}),title=el('h1','每一個引用，都找得到來處。');header.append(eyebrow,title,el('p','一段原文，一張來源卡。兩種閱讀次序，共用同一份合成資料。',{class:'intro'}));
 const badge=el('p','獨立選配候選 · 純合成 · 未接正式產品',{class:'boundary'});header.append(badge);
 const modes=el('nav',null,{'aria-label':'閱讀方案',class:'modes'}),a=btn('A  正文旁註',()=>host.mode('A'),{'data-mode':'A'}),b=btn('B  來源卷宗',()=>host.mode('B'),{'data-mode':'B'});modes.append(a,b);
 const controls=el('section',null,{class:'lab','aria-label':'合成情境控制'}),summary=el('p','試讀控制台',{class:'small-title'}),scopeLabel=el('label','合成範圍 '),scope=el('select',null,{'aria-label':'合成範圍'});for(const [v,t]of [['family-a','甲範圍'],['family-b','乙範圍']])scope.append(el('option',t,{value:v}));scope.addEventListener('change',()=>{if(!disposed&&root.contains(scope))host.scope(scope.value)});scopeLabel.append(scope);
 const caseLabel=el('label','來源狀態 '),cases=el('select',null,{'aria-label':'來源狀態'});for(const [v,t]of scenarios)cases.append(el('option',t,{value:v}));cases.addEventListener('change',()=>{if(!disposed&&root.contains(cases))host.scenario(cases.value)});caseLabel.append(cases);
 const lateStatus=el('span','尚未排入回呼',{class:'muted','data-late-status':''});controls.append(summary,scopeLabel,caseLabel,btn('排入合成延遲回呼',()=>{late=host.defer();lateStatus.textContent='已排入，切換範圍後可測試舊回呼。'}),btn('送達已排入回呼',()=>{if(!late){lateStatus.textContent='沒有待送達的合成回呼。';return}const accepted=late();late=null;lateStatus.textContent=accepted?'已接納合成回呼，沒有網絡操作。':'舊回呼已拒絕，沒有改動目前資料。'}),lateStatus);
 const messages=el('nav',null,{class:'message-nav','aria-label':'合成訊息'});for(const [id,text]of [['m1','訊息 01 · 共讀'],['m2','訊息 02 · 分類']])messages.append(btn(text,()=>host.message(id),{'data-message':id}));
 const warnings=el('section',null,{class:'warnings','data-warnings':'','aria-label':'資料與結果限制'}),identity=el('p','',{class:'identity'}),notice=el('p','',{role:'status','aria-live':'polite',class:'notice'}),main=el('div',null,{class:'work-mount'}),footer=el('footer','這是來源閱讀原型，不會查詢、儲存、傳送或驗證真實資料。正式 renderer、owner 與本候選分開保存。',{class:'footnote'});
 root.append(header,modes,controls,messages,warnings,identity,notice,main,footer);
 function ownsFrame(expected){return !disposed&&frame===expected&&root.isConnected&&expected.detail.isConnected&&root.contains(expected.detail)&&host.valid(expected.binding)}
 function ownsFocus(previous){return doc.activeElement===previous||doc.activeElement===doc.body&&!previous?.isConnected}
 function openSource(binding,sourceId,markerId){pendingFocus={kind:'detail',binding,focusOwner:doc.activeElement};if(!host.open(binding,sourceId,markerId))pendingFocus=null}
 function closeDetail(expected,generation=expected?.contentGeneration,returnMarkerId){
  if(!ownsFrame(expected)||generation!==expected.contentGeneration)return false;
  const s=host.getSnapshot(),binding=expected.binding,markerId=returnMarkerId??s.selected?.markerId;
  if(!s.selected||!s.markers.some(m=>m.id===markerId&&m.sourceId===s.selected.sourceId))return false;
  pendingFocus={kind:'origin',binding,markerId,focusOwner:doc.activeElement};
  if(!host.close(binding)){pendingFocus=null;return false}return true;
 }
 function buildFrame(s){
  const binding=host.binding(),key=s.life+':'+s.mode,work=el('div',null,{class:'workspace mode-'+s.mode,'data-workspace':''});
  const reading=el('article',null,{class:'reading','data-region':'reading'}),heading=el('h2',s.mode==='A'?'01 / 從原文出發':'03 / 返回原文',{tabindex:'-1','data-reading-heading':''}),reveal=btn(s.mode==='B'?'展開原文與引用位置':'原文與引用位置',()=>{body.hidden=false;reveal.setAttribute('aria-expanded','true')},{'data-action':'reveal-body','aria-expanded':s.mode==='A'?'true':'false'}),body=el('div',null,{class:'message-body'});body.hidden=s.mode==='B';reading.append(heading,el('p',`目前訊息 ${s.messageId} · 運行 ${s.runId}`,{class:'muted'}),reveal,body);
  const paragraph=el('p',null,{class:'original-text'}),markerNodes=new Map();let offset=0;
  for(const m of s.markers){paragraph.append(doc.createTextNode(s.message.text.slice(offset,m.index)));if(m.sourceId){const source=s.sources.find(x=>x.id===m.sourceId);const marker=btn(m.text,()=>openSource(binding,m.sourceId,m.id),{class:'marker','data-marker':m.id,'aria-label':`查看來源${m.text}：${source.title}，原文第 ${Number(m.id.split(':')[1])+1} 個標記`});markerNodes.set(m.id,marker);paragraph.append(marker)}else paragraph.append(el('span',m.text+'（來源不可用）',{class:'unavailable'}));offset=m.index+m.length}
  paragraph.append(doc.createTextNode(s.message.text.slice(offset)));body.append(paragraph,el('p','每個標記保留自己的返回位置；相同來源可以在原文出現多次。',{class:'muted'}));
  const catalog=el('section',null,{class:'catalog','data-region':'catalog'}),catalogHeading=el('h2',s.mode==='A'?'02 / 來源索引':'01 / 選一份來源卷宗'),searchLabel=el('label','搜尋目前來源標題',{class:'search-label'}),input=el('input',null,{type:'search',placeholder:'例如：共讀','aria-label':'搜尋目前來源標題',maxlength:'200',autocomplete:'off'}),count=el('p','',{class:'muted','data-result-count':''});input.value=s.query;input.addEventListener('input',()=>{if(!disposed&&root.contains(input))host.query(input.value,binding)});searchLabel.append(input);catalog.append(catalogHeading,searchLabel,count);
  const list=el('div',null,{class:'source-list'}),rows=new Map(),groups=new Map();
  if(s.mode==='B'){for(const [id,label]of [['available','有摘錄可讀'],['stale','核對時間過舊／未知']]){const group=el('section',null,{'data-source-group':id,class:'source-group'});group.append(el('h3',label));list.append(group);groups.set(id,group)}}
  for(const source of s.sources){const first=s.markers.find(m=>m.sourceId===source.id);const row=btn('',()=>{if(first)openSource(binding,source.id,first.id)},{'data-source':source.id,class:'source-card'});row.append(el('span',`【${source.number}】 ${source.state==='stale'?'待核對':'有摘錄'}`,{class:'source-kicker'}),el('strong',source.title),el('span',source.publisher,{class:'muted'}));if(!first){row.disabled=true;row.append(el('span','目前訊息沒有對應標記'))}rows.set(source.id,row);(groups.get(source.state)??list).append(row)}
  const empty=el('p','目前沒有符合的來源。引用不會從舊選取中恢復。',{class:'empty','data-empty':''});catalog.append(list,empty);
  const detail=el('aside',null,{class:'detail','data-detail':'','data-region':'detail','aria-label':'來源詳讀'});
  if(s.mode==='A')work.append(reading,catalog,detail);else work.append(catalog,detail,reading);
  main.replaceChildren(work);frame={key,binding,work,reading,heading,body,reveal,input,count,rows,empty,detail,markerNodes,selectedKey:undefined,contentGeneration:0};frameKey=key;
  const ownedFrame=frame;
  detail.addEventListener('keydown',e=>{
   if(e.key!=='Escape'||e.defaultPrevented||e.isComposing||!ownsFrame(ownedFrame)||!host.getSnapshot().selected)return;
   e.preventDefault();closeDetail(ownedFrame);
  });
 }
 function render(s){
  if(disposed||s!==host.getSnapshot())return;
  if(s.disposed){disposed=true;off();root.replaceChildren();return}
  const oldActive=doc.activeElement,hard=!!frame&&frame.binding.life!==s.life,changing=frameKey!==s.life+':'+s.mode;
  a.setAttribute('aria-pressed',String(s.mode==='A'));b.setAttribute('aria-pressed',String(s.mode==='B'));scope.value=s.scope;cases.value=s.scenario;
  for(const n of messages.children)n.setAttribute('aria-current',n.dataset.message===s.messageId?'true':'false');
  warnings.replaceChildren(...s.warnings.map(w=>el('p',w)));identity.textContent=`${s.scope} / ${s.messageId} / ${s.runId} · ${s.mode==='A'?'正文 → 來源 → 原標記':'來源分類 → 摘錄 → 引用原句'}`;notice.textContent=s.notice;
  if(changing)buildFrame(s);
  const f=frame;if(f.input.value!==s.query)f.input.value=s.query;
  let matches=0;for(const source of s.sources){const visible=source.title.toLocaleLowerCase().includes(s.query.toLocaleLowerCase());f.rows.get(source.id).hidden=!visible;if(visible)matches++}f.count.textContent=`目前 ${s.sources.length} 份來源，顯示 ${matches} 份。只搜尋這則訊息的已載來源。`;f.empty.hidden=matches>0;
  const selectedKey=s.selected?`${s.selected.sourceId}:${s.selected.markerId}`:null;
  for(const [id,node]of f.rows)node.setAttribute('aria-expanded',String(s.selected?.sourceId===id));
  if(f.selectedKey!==selectedKey){
   f.selectedKey=selectedKey;const contentGeneration=++f.contentGeneration;const source=s.sources.find(x=>x.id===s.selected?.sourceId);
   if(!source)f.detail.replaceChildren(el('p','SOURCE FILE',{class:'eyebrow'}),el('h2','選一個引用，讀清楚它的來處。'),el('p',s.mode==='A'?'按正文中的引用標記，旁註會在這裏展開。':'先按左方來源卡，再核對摘錄及原文位置。'),el('p','來源不是結論。請自行核實內容、日期與適用情境。',{class:'muted'}));
   else {
    const detailHeading=el('h2',source.title,{tabindex:'-1','data-detail-heading':''}),meta=el('dl',null,{class:'metadata'});
    for(const [label,value]of [['來源性質','全合成示例，不是真實資料'],['出版者',source.publisher],['章節',source.section],['來源版本',source.version],['核對時間',source.checkedAt],['適用範圍','只供 UI 操作測試；不供醫療或照顧決策']])meta.append(el('dt',label),el('dd',value));
    const quote=el('blockquote',source.excerpt,{class:'excerpt'}),url=host.url(f.binding,source.id),safe=el('p',url?`格式檢查：HTTPS、無帳密／控制字元。${url} 是保留的合成網域，不可外開。`:'URL 不符合目前來源的安全規則，不可外開。',{class:'url-check'}),actions=el('div',null,{class:'detail-actions'}),external=btn('開啟原文 · 未接通',()=>{}, {'data-action':'external'}),copy=btn('複製引用 · 未接通',()=>{}, {'data-action':'copy'});external.disabled=true;copy.disabled=true;actions.append(btn('返回原引用標記',()=>closeDetail(f,contentGeneration),{'data-action':'return'}),external,copy);
    const occurrences=el('div',null,{class:'occurrences'});occurrences.append(el('h3','這份來源在哪裏被引用？'));for(const marker of s.markers.filter(m=>m.sourceId===source.id)){const context=s.message.text.slice(Math.max(0,marker.index-26),marker.index+marker.length);occurrences.append(btn(`原文位置 ${Number(marker.id.split(':')[1])+1} · ${context}`,()=>closeDetail(f,contentGeneration,marker.id),{'data-occurrence':marker.id}))}
    f.detail.replaceChildren(el('p',`SOURCE ${String(source.number).padStart(2,'0')} / ${source.state==='stale'?'核對時間過舊或未知':'可閱讀合成摘錄'}`,{class:'eyebrow'}),detailHeading,quote,meta,occurrences,safe,actions,el('p','沒有進行真實性驗證、醫療判斷、剪貼簿寫入或外部開啟。',{class:'muted'}));
   }
  }
  // Focus is the final effect: a focus listener may synchronously replace the scope.
  const ticket=pendingFocus;pendingFocus=null;
  if(ticket&&host.valid(ticket.binding)&&s===host.getSnapshot()&&ownsFocus(ticket.focusOwner)){
   const target=ticket.kind==='detail'?f.detail.querySelector('[data-detail-heading]'):f.markerNodes.get(ticket.markerId);
   if(ticket.kind==='origin'){f.body.hidden=false;f.reveal.setAttribute('aria-expanded','true')}
   target?.focus();
  }else if(changing&&oldActive&&oldActive!==doc.body&&!root.contains(oldActive)&&ownsFocus(oldActive)){f.heading.focus()}
 }
 const off=host.subscribe(render);render(host.getSnapshot());
 return {dispose(){if(disposed)return;disposed=true;off();pendingFocus=null;late=null;root.replaceChildren()}};
}
if(typeof document!=='undefined'&&document.querySelector('[data-ci01-autostart]'))mount(document.querySelector('[data-ci01-autostart]'),createHost());

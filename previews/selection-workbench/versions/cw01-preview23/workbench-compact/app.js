(function(){
 'use strict';
 const C=window.CompactCore,R=window.CW_ROUTES,cat=window.OPTION_CATALOG,sources=window.OPTION_SOURCES;
 const root=document.getElementById('workbench'),$=id=>document.getElementById(id);
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 if(!C.validCatalog(cat,R)||!Array.isArray(sources)||sources.length!==104){$('selected-module').textContent='來源版本不符，入口已停用。請使用原工作台。';for(const e of root.querySelectorAll('button,input,select'))e.disabled=true;return;}
 const groups=R.groups,optionEntries=Object.entries(R.options),candidateById=new Map(cat.modules.flatMap(m=>m.candidates.map(c=>[c.id,c])));
 let state=C.fresh(R),epoch=0,alive=true,suspended=false;
 for(const group of groups){const o=el('option',group);o.value=group;$('group').append(o)}
 $('scope-label').textContent='固定來源 preview23 · '+cat.masterSha.slice(0,12)+' · 不是最新 master。CW01 是工作台介面候選，不新增產品模組。';
 function external(url,title){try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)return el('span',title+'（未提供可外開網址）');const a=el('a',title+' ↗ 新頁');a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a}catch{return el('span',title)}}
 function link(key){const o=R.options[key],a=el('a',o.label+' ↗','open-link');a.setAttribute('href',C.href(R,key));a.dataset.option=key;return a;}
 function action(label,key,value){const b=el('button',label);b.type='button';b.dataset[key]=value;b.dataset.epoch=String(epoch);return b;}
 function sourceRecord(s){const a=el('article',undefined,'source-record');a.append(el('p',s.channel,'eyebrow'),external(s.url,s.title),el('p',s.reason),el('p',s.status,'micro'));if(s.readDepth)a.append(el('p','實讀：'+s.readDepth,'micro'));return a;}
 function current(){return cat.modules.find(m=>m.id===state.selected)}
 function normalize(){
  const items=C.filter(cat,state);state.page=Math.max(0,Math.min(state.page,Math.max(0,Math.ceil(items.length/12)-1)));
  if(state.selected&&!items.some(m=>m.id===state.selected)){state.selected='';state.details=false;}
  return items;
 }
 function save(replace){const url=C.encode(state,R);const h={scope:R.scope,url,q:state.q,sourceQ:state.sourceQ,details:state.details,sources:state.sources,sourcePage:state.sourcePage};window.history[replace?'replaceState':'pushState'](h,'',url);}
 function render(){
  ++epoch;const items=normalize();$('search').value=state.q;$('group').value=state.group;$('ready').value=state.ready;
  $('result-count').textContent=items.length+' / '+cat.modules.length+' 個盤點項';$('empty').hidden=items.length!==0;
  const chunks=[],visible=items.slice(state.page*12,state.page*12+12);
  for(const g of groups){const list=visible.filter(m=>m.group===g);if(!list.length)continue;const section=el('section');section.append(el('h3',g+' · '+items.filter(m=>m.group===g).length));for(const m of list){const b=action('', 'module',m.id);b.append(el('span',m.title),el('small',m.candidates.length?m.candidates.length+' 個候選':'尚無候選'));b.setAttribute('aria-current',String(m.id===state.selected));section.append(b)}chunks.push(section)}
  $('module-list').replaceChildren(...chunks);$('prev').disabled=state.page===0;$('next').disabled=(state.page+1)*12>=items.length;$('page-count').textContent=(state.page+1)+' / '+Math.max(1,Math.ceil(items.length/12));
  const selected=current(),content=[];
  if(!selected)content.push(el('p','選一個模組，這裡只呈現它的候選。沒有候選也可查來源。','placeholder'));
  else{
   const h=el('h3',selected.title);h.id='detail-title';h.tabIndex=-1;content.push(el('p',selected.group,'eyebrow'),h);
   if(!selected.candidates.length)content.push(el('p','尚無候選。已列入盤點，不代表已有可運行畫面。','placeholder'));
   for(const c of selected.candidates){const article=el('article',undefined,'candidate');article.append(el('p',c.id,'eyebrow'),el('h4',c.title),el('p','獨立合成預覽；未接正式配置。完整原狀態與限制可在下方查閱。','micro'));const options=optionEntries.filter(([,o])=>o.candidateId===c.id);for(const [key] of options){const row=el('div',undefined,'option');row.append(link(key),action(state.compare.includes(key)?'已加入暫存':'＋ 暫存比較','add',key));article.append(row)}if(options.length===1)article.append(el('p','方向在原頁內切換；不提供未核實的 A/B 直入網址。','micro'));content.push(article)}
   const b=action('來源、原狀態與限制','details','toggle');b.id='module-details';b.setAttribute('aria-expanded',String(state.details));b.setAttribute('aria-controls','provenance');content.push(b);
  }
  $('selected-module').replaceChildren(...content);renderProvenance(selected);renderCompare();renderSources();renderVersion();
 }
 function renderProvenance(m){
  const p=$('provenance');p.hidden=!state.details||!m;p.replaceChildren();if(p.hidden)return;
  p.append(el('h4','固定版本原文，不是本入口驗收結果'),el('p','語意覆核：'+m.semanticReview),el('h4','資料邊界'),el('p',m.dataBoundary),el('h4','操作邊界'),el('p',m.operationBoundary),el('h4','原驗證範圍'),el('p',m.verification));
  if(m.integrationStatus)p.append(el('p',m.integrationStatus));
  for(const c of m.candidates){p.append(el('h4',c.title+' · 完整原狀態'),el('p',c.status));for(const url of c.sourceUrls||[]){const s=sources.find(x=>x.url===url);p.append(s?sourceRecord(s):external(url,'原候選參考'))}}
  for(const [key,label] of [['sourceFiles','呈現／操作接點'],['controllerFiles','controller'],['contextFiles','context'],['helperFiles','helper'],['referenceFiles','相鄰參考'],['unreviewedOwnerFiles','角色待覆核']])if(m[key]?.length){p.append(el('h4',label));for(const path of m[key])p.append(el('p',path,'code-path'));}
 }
 function renderCompare(){
  $('compare-count').textContent=state.compare.length+' / 4';$('compare-clear').disabled=state.compare.length===0;
  const cards=state.compare.map(key=>{const o=R.options[key],a=el('article',undefined,'compare-card');a.append(el('h3',candidateById.get(o.candidateId).title),link(key),action('移除 '+o.label,'remove',key));return a});
  if(!cards.length)cards.push(el('p','還沒有暫存比較。先選模組，再加入想回看的方向。','micro'));
  $('compare-list').replaceChildren(...cards);
 }
 function renderSources(){
  $('sources-toggle').setAttribute('aria-expanded',String(state.sources));$('source-panel').hidden=!state.sources;$('source-list').replaceChildren();if(!state.sources)return;
  $('source-search').value=state.sourceQ;const q=state.sourceQ.trim().toLocaleLowerCase(),items=sources.filter(s=>[s.title,s.channel,s.modules,s.reason].join(' ').toLocaleLowerCase().includes(q));
  state.sourcePage=Math.max(0,Math.min(state.sourcePage,Math.max(0,Math.ceil(items.length/8)-1)));$('source-count').textContent=items.length+' / '+sources.length+' 個原研究網址';$('source-list').replaceChildren(...items.slice(state.sourcePage*8,state.sourcePage*8+8).map(sourceRecord));$('source-prev').disabled=state.sourcePage===0;$('source-next').disabled=(state.sourcePage+1)*8>=items.length;$('source-page-count').textContent=(state.sourcePage+1)+' / '+Math.max(1,Math.ceil(items.length/8));
 }
 function renderVersion(){const p=$('version-panel');p.hidden=!state.version;$('version-toggle').setAttribute('aria-expanded',String(state.version));p.replaceChildren();if(p.hidden)return;p.append(el('h3','CW01：來源／DOM檢查與原生驗收分開'),el('p','本入口 native、AT、真機、IME、BFCache：NOT_RUN。按需 DOM 不是 timeout／code9 修復證據。'),el('p','以下封定身份用於核對，不代表最新 master 或正式產品通過。'));for(const [label,value] of [['preview23 seal',R.baseSealSha256],['preview23 manifest',R.baseManifestSha256],['catalog bytes',R.catalogSha256],['來源獨立覆核 seal',R.reviewSealSha256],['既有 browser diagnostic seal',R.diagnosticSealSha256],['較後 preview23 native QA seal',R.latestGalleryQaSealSha256]])p.append(el('p',label+'：'+value,'code-path'));p.append(el('p','較後 preview23 native：INCOMPLETE_NATIVE_GALLERY_CODE9_UNKNOWN；已見 root 與 CD01 搜尋，之後 DOMSnapshot 逾時與 owned URL code9，原因未知。原建置狀態不回寫，本入口仍 NOT_RUN。'));for(const s of R.methods){p.append(el('h4',s.channel),external(s.url,s.title),el('p',s.adoption),el('p','實讀：'+s.read_depth),el('p','適用界線：'+s.limits),el('p','授權核對：'+s.licensing.fact));}}
 function commit(next,{replace=false,focus=null,notice=''}={}){if(!alive||suspended)return;state=next;normalize();save(replace);render();const ticket=epoch;$('notice').textContent=notice;if(focus&&ticket===epoch&&alive&&!suspended){const n=typeof focus==='function'?focus():$(focus);n?.focus();}}
 function restore(){if(!alive)return;state=C.decode(window.location.search,cat,R);const h=window.history.state;
  if(new URLSearchParams(window.location.search).get('v')===R.scope&&h?.scope===R.scope&&h.url===C.encode(state,R)){state.q=typeof h.q==='string'?h.q.slice(0,160):'';state.sourceQ=typeof h.sourceQ==='string'?h.sourceQ.slice(0,160):'';state.details=h.details===true;state.sources=h.sources===true;state.sourcePage=Number.isInteger(h.sourcePage)?Math.max(0,Math.min(12,h.sourcePage)):0;}
  normalize();render();save(true);
 }
 function onInput(e){if(!alive||suspended)return;if(e.target.id==='search')commit({...state,q:e.target.value.slice(0,160),page:0},{replace:true});if(e.target.id==='source-search')commit({...state,sourceQ:e.target.value.slice(0,160),sourcePage:0},{replace:true});}
 function onChange(e){if(!alive||suspended)return;if(e.target.id==='group')commit({...state,group:e.target.value,page:0});if(e.target.id==='ready')commit({...state,ready:e.target.value,page:0});}
 function onClick(e){if(!alive||suspended)return;const b=e.target.closest('button');if(!b||!root.contains(b)||b.disabled||(b.dataset.epoch&&b.dataset.epoch!==String(epoch)))return;
  if(b.dataset.module)return commit({...state,selected:b.dataset.module,details:false},{focus:'detail-title'});
  if(b.dataset.add){const next=C.compare(state,b.dataset.add,true,R);return commit(next,{focus:'compare-title',notice:state.compare.length>=4&&!state.compare.includes(b.dataset.add)?'暫存最多四項，先移除一項再加入。':'僅加入本頁暫存，沒有套用配置。'});}
  if(b.dataset.remove){const key=b.dataset.remove,index=state.compare.indexOf(key),next=C.compare(state,key,false,R);return commit(next,{focus:()=>document.querySelectorAll('[data-remove]')[Math.min(index,next.compare.length-1)]||$('compare-title')});}
  if(b.id==='module-details')return commit({...state,details:!state.details},{replace:true,focus:'module-details'});
  if(b.id==='clear')return commit({...state,q:'',group:'all',ready:'all',page:0},{focus:'search'});
  if(b.id==='next'||b.id==='prev')return commit({...state,page:state.page+(b.id==='next'?1:-1)},{focus:'browse-title'});
  if(b.id==='compare-clear')return commit({...state,compare:[]},{focus:'compare-title'});
  if(b.id==='sources-toggle')return commit({...state,sources:!state.sources},{replace:true,focus:state.sources?'sources-toggle':'source-search'});
  if(b.id==='source-next'||b.id==='source-prev')return commit({...state,sourcePage:state.sourcePage+(b.id==='source-next'?1:-1)},{replace:true,focus:'source-search'});
  if(b.id==='version-toggle')return commit({...state,version:!state.version},{replace:true,focus:'version-toggle'});
 }
 function onPageShow(){if(!alive)return;suspended=false;restore();}
 function onPageHide(event){++epoch;suspended=true;if(event.persisted)return;alive=false;root.removeEventListener('click',onClick);root.removeEventListener('input',onInput);root.removeEventListener('change',onChange);window.removeEventListener('popstate',restore);window.removeEventListener('pageshow',onPageShow);window.removeEventListener('pagehide',onPageHide);}
 root.addEventListener('click',onClick);root.addEventListener('input',onInput);root.addEventListener('change',onChange);window.addEventListener('popstate',restore);window.addEventListener('pageshow',onPageShow);window.addEventListener('pagehide',onPageHide);$('browse-title').tabIndex=-1;restore();
})();

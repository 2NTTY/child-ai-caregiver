import { scenarios } from './fixtures.mjs';
const textFields={allergies:'過敏資料',specialNeeds:'特別需要',language:'語言',region:'地區',birthDate:'出生日期',dueDate:'預產期',gestationalWeeksRaw:'出生孕週原文',source:'檔案來源',confirmedAt:'最後確認',validUntil:'有效至'};
const fields=keys=>`<dl class="facts">${keys.map(k=>`<div><dt>${textFields[k]}</dt><dd data-field="${k}"></dd></div>`).join('')}</dl>`;
const measurements=mode=>`<div class="measurement-grid">${['height','weight'].map((k,i)=>`<section class="measurement"><span class="eyebrow">${i?'體重':'身高'}</span><p class="measurement-value" data-measure="${k}"></p><p class="meta" data-measure-note="${k}"></p><button data-open="${mode}-${k}">查看${i?'體重':'身高'}原記錄</button></section>`).join('')}</div><p class="fine">正式來源目前未接通量度。只有「選配授權量度」等合成情境提供這個可選契約。</p>`;
const mountedRoots=new WeakMap();
export function mount(root,owner){
 mountedRoots.get(root)?.dispose();
 const doc=root.ownerDocument;let alive=true,mode='a',section='care',lastEpoch=null,snapshot=owner.snapshot(),returnTarget=null;
 let focusVersion=0,viewIntent=0,ownedFocusTarget=null;
 const onFocus=event=>{if(event.target!==ownedFocusTarget)focusVersion++;};
 doc.addEventListener('focusin',onFocus,true);
 const claimFocus=()=>({focusVersion,viewIntent});
 const ownsFocus=claim=>claim.focusVersion===focusVersion&&claim.viewIntent===viewIntent;
 function ownedFocus(node){const previous=ownedFocusTarget;ownedFocusTarget=node;try{node.focus({preventScroll:true});}finally{ownedFocusTarget=previous;}}
 root.innerHTML=`<div class="workbench"><header class="workbench-bar"><div><p class="eyebrow">育伴港 · 選配工作台 / CO01</p><p class="workbench-title">孩子概況閱讀</p></div><div class="mode-switch" aria-label="閱讀方案"><button data-mode="a" aria-pressed="true">A 相處小誌</button><button data-mode="b" aria-pressed="false">B 來源訊號站</button></div></header><details class="lab"><summary>合成情境與驗收控制</summary><div class="lab-controls"><label>對象<select data-child><option value="a">合成孩子 A</option><option value="b">合成孩子 B</option></select></label><label>資料情境<select data-scenario></select></label><button data-cold>完成合成冷啟讀取</button></div><p>全部資料皆為虛構。今天固定為 2026-11-05；重讀只是本頁的合成讀取，不呼叫 API。</p></details><div class="scope-notice" data-status tabindex="-1" role="status" aria-live="polite"></div><main data-content><div class="action-bar"><span data-context class="meta"></span><div class="actions"><button data-profile>查看原孩子檔案</button><button data-refresh>重新讀取檔案</button></div></div><div data-reader><article data-view="a" class="journal"><header class="journal-cover"><div class="cover-art" aria-hidden="true"><span></span><i></i><b>相處<br>小誌</b></div><div><p class="eyebrow">CHILD NOTES / 家人留下的小線索</p><h1 data-name></h1><p class="age" data-age></p><p class="cover-intro">先了解喜歡的事，<br>再看照顧時需要留意的細節。</p></div></header><div class="journal-columns"><div class="journal-main"><section class="story"><p class="chapter">01 · 日常相處</p><h2>從喜歡的事開始</h2><p class="preference" data-field="preferences"></p></section><section class="care-note"><p class="chapter">02 · 照顧時留意</p><h2>保留家人確認的原意</h2>${fields(['allergies','specialNeeds'])}</section><details class="background"><summary>展開其他檔案資料</summary>${fields(['language','region','birthDate','dueDate','gestationalWeeksRaw'])}</details><section class="measurements"><p class="chapter">03 · 量度來源</p><h2>只看已獲授權的記錄</h2>${measurements('a')}</section></div><aside class="source-aside"><span class="source-mark" aria-hidden="true">＊</span><h2>這一頁從哪裡來</h2><p data-source-status class="source-status"></p>${fields(['source','confirmedAt','validUntil'])}<button data-history="a">查看檔案更正歷史</button><p class="fine">未知不代表沒有；過期內容只作最後確認資料閱讀。</p></aside></div></article><article data-view="b" class="signal" hidden><header class="signal-header"><div><p class="eyebrow">READ / SOURCE / CONTEXT</p><h1 data-name></h1><p data-age class="age"></p></div><div class="signal-stamp" aria-hidden="true">CO<br><strong>01</strong></div></header><section class="signal-source"><span class="signal-number" aria-hidden="true">↳</span><div><p class="eyebrow">先核對來源狀態</p><h2 data-source-status></h2><p data-source-line></p></div><button data-history="b">開啟更正歷史接點</button></section><div class="signal-grid"><nav class="section-nav" aria-label="概況閱讀區域"><button data-section="care" aria-pressed="true"><span>01</span>相處與照顧</button><button data-section="background" aria-pressed="false"><span>02</span>背景資料</button><button data-section="measurements" aria-pressed="false"><span>03</span>量度投影</button><p>選擇閱讀區域。<br>來源狀態保持可見。</p></nav><div class="signal-reader"><section data-panel="care"><h2 tabindex="-1" data-panel-title>01 / 相處與照顧</h2><h3>生活偏好</h3><p class="preference" data-field="preferences"></p>${fields(['allergies','specialNeeds'])}</section><section data-panel="background" hidden><h2 tabindex="-1" data-panel-title>02 / 背景資料</h2>${fields(['language','region','birthDate','dueDate','gestationalWeeksRaw','source','confirmedAt','validUntil'])}</section><section data-panel="measurements" hidden><h2 tabindex="-1" data-panel-title>03 / 量度投影</h2>${measurements('b')}</section></div></div></article></div><section data-outlet class="outlet" hidden><p class="eyebrow">本頁導航回執 · 不連正式資料</p><h2 tabindex="-1" data-outlet-title></h2><p data-outlet-path class="route"></p><p data-outlet-copy></p><button data-back>返回孩子概況</button></section></main><footer class="boundary">兩種資訊架構，共用一個合成唯讀資料來源。沒有健康評分、診斷、文件生成或寫入。正式接線與原生驗收尚未完成。</footer></div>`;
 const q=s=>root.querySelector(s),all=s=>[...root.querySelectorAll(s)],status=q('[data-status]');
 for(const [value,label]of scenarios){const o=doc.createElement('option');o.value=value;o.textContent=label;q('[data-scenario]').append(o);}
 const visible=node=>!!node&&node.isConnected&&!node.closest('[hidden]')&&!node.disabled&&!([...node.closest?.('details')?.children??[]].length&&node.closest('details')&&!node.closest('details').open&&node.tagName!=='SUMMARY');
 const usable=node=>alive&&root.isConnected&&root.contains(node)&&visible(node);
 function bind(selector,fn,event='click'){for(const node of all(selector))node.addEventListener(event,e=>{if(usable(node)){viewIntent++;fn(e,node);}});}
 function focusReveal(node,token,pub,claim=claimFocus()){
  if(!alive||!owner.current(token)||owner.snapshot().publication!==pub||!ownsFocus(claim)||!visible(node))return;
  ownedFocus(node);
  if(alive&&owner.current(token)&&owner.snapshot().publication===pub&&ownsFocus(claim)&&doc.activeElement===node&&visible(node))node.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'instant'});
 }
 function repair(previous){if(alive&&root.isConnected&&previous&&root.contains(previous)&&doc.activeElement===previous&&!visible(previous))ownedFocus(status);}
 function applyLayout(){
  for(const v of all('[data-view]'))v.hidden=v.dataset.view!==mode;
  for(const b of all('[data-mode]'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode));
  for(const p of all('[data-panel]'))p.hidden=p.dataset.panel!==section;
  for(const b of all('[data-section]'))b.setAttribute('aria-pressed',String(b.dataset.section===section));
  root.dataset.mode=mode;
 }
 function render(s){
  if(!alive)return;const active=doc.activeElement;snapshot=s;
  if(lastEpoch!==s.epoch){section='care';for(const d of all('[data-view] details'))d.open=false;lastEpoch=s.epoch;returnTarget=null;}
  const data=s.reading.data,unreadable=['access_lost','source_invalidated','source_unavailable'].includes(s.reading.state);
  const fallback=unreadable?'來源暫不可讀':s.reading.state==='loading'?'正在讀取':'未知';
  const values={...data,preferences:data?.preferences??(unreadable?'生活偏好來源暫不可讀。':s.reading.state==='loading'?'正在讀取生活偏好…':'尚未記下生活偏好。'),allergies:data?.allergies??(unreadable?fallback:'過敏資料尚未確認。'),specialNeeds:data?.specialNeeds??fallback,birthDate:data?.age?.kind==='birth_date'?data.age.date:null,source:data?(data.source||'未提供'):fallback,confirmedAt:data?s.revision?.confirmedAtLabel??'未知':fallback,validUntil:data?(data.validUntil??'未提供有效期'):fallback};
  for(const n of all('[data-field]'))n.textContent=values[n.dataset.field]??fallback;
  for(const n of all('[data-name]'))n.textContent=s.name;
  for(const n of all('[data-age]'))n.textContent=unreadable?'年齡資料暫不可讀':s.reading.state==='loading'?'正在讀取年齡資料':s.age;
  for(const n of all('[data-source-status]'))n.textContent=s.reading.statusLabel;
  q('[data-source-line]').textContent=data?`${values.source} · ${values.confirmedAt}`:'未載入可讀來源內容';
  const notes=[s.reading.statusLabel,s.reading.message,s.pending?(s.operation==='saving'?'原檔案正在保存；這裡不發起或重送操作。':'原檔案操作結果未知；請返回原檔案查核同一操作。'):null,s.lastKnown?'最後確認資料，尚待核對是否仍然適用。':null];
  status.textContent=notes.filter(Boolean).join(' ');status.dataset.state=s.reading.state;
  q('[data-context]').textContent=`合成日期 ${s.today} · ${s.loading?'讀取中':s.online?'唯讀連線情境':'離線情境'}${s.revision?` · 檔案版本 ${s.revision.version}`:''}`;
  q('[data-profile]').disabled=!s.canProfile;q('[data-refresh]').disabled=!s.canRefresh;
  for(const n of all('[data-history]'))n.disabled=!s.canHistory;
  q('[data-scenario]').value=s.scenario;q('[data-child]').value=s.childChoice;q('[data-cold]').hidden=s.scenario!=='cold';
  for(const key of ['height','weight']){
   const fact=s.measurements?.[key],state=s.measurements?.state??'unavailable',available=state==='ready'&&fact&&fact.state!=='source_invalidated';
   const label=key==='height'?'身高':'體重';
   for(const n of all(`[data-measure="${key}"]`))n.textContent=available?fact.valueLabel:fact?.state==='source_invalidated'?`${label}來源已失效`:state==='ready'?`暫無${label}量度`:state==='loading'?`正在讀取${label}`:state==='error'?`${label}未能讀取`:`${label}暫不可用`;
   for(const n of all(`[data-measure-note="${key}"]`))n.textContent=available?`${fact.state==='expired'?'量度資料已過期 · ':''}${fact.measuredAtLabel??'日期未知'} · ${fact.sourceLabel??'來源未提供'}`:'不以舊資料補上空缺。';
   for(const n of all(`[data-open$="-${key}"]`))n.disabled=!available;
  }
  q('[data-reader]').hidden=!!s.nav;q('[data-outlet]').hidden=!s.nav;
  if(s.nav){const kind=s.nav.kind; q('[data-outlet-title]').textContent=kind==='profile'?'原孩子檔案接點':kind==='history'?'檔案更正歷史接點':'量度原記錄接點';q('[data-outlet-path]').textContent=kind==='profile'?'/profile':kind==='history'?'/history?category=profile':`/care?record=${encodeURIComponent(s.nav.recordId)}`;q('[data-outlet-copy]').textContent=kind==='profile'?`${s.name}：這是本頁的合成導航結果。未執行查核、保存、重試或新增孩子。`:kind==='history'?'此接點交回原檔案 owner；這裡沒有生成歷史版本或復原功能。':'已核目前 scope 的授權量度投影；這裡沒有虛構原始記錄正文或打開外部服務。';}
  else{q('[data-outlet-copy]').textContent='';q('[data-outlet-path]').textContent='';q('[data-outlet-title]').textContent='';}
  applyLayout();repair(active);
 }
 bind('[data-mode]',(_,node)=>{mode=node.dataset.mode;const a=doc.activeElement;applyLayout();repair(a);});
 bind('[data-section]',(_,node)=>{section=node.dataset.section;applyLayout();focusReveal(q(`[data-panel="${section}"] [data-panel-title]`),owner.token(),snapshot.publication);});
 bind('[data-child]',(_,node)=>owner.switchChild(node.value),'change');
 bind('[data-scenario]',(_,node)=>owner.setScenario(node.value),'change');
 bind('[data-refresh]',()=>owner.refresh());bind('[data-cold]',()=>owner.completeCold());
 const navigate=(node,target)=>{const token=owner.token(),pub=owner.snapshot().publication+1,claim=claimFocus();returnTarget=node;if(owner.navigate(target,token))focusReveal(q('[data-outlet-title]'),token,pub,claim);};
 bind('[data-profile]',(_,node)=>navigate(node,{kind:'profile'}));
 bind('[data-history]',(_,node)=>navigate(node,{kind:'history'}));
 bind('[data-open]',(_,node)=>{const key=node.dataset.open.split('-').pop(),f=snapshot.measurements?.[key];if(f)navigate(node,{kind:'measurement',recordId:f.recordId});});
 bind('[data-back]',()=>{const token=owner.token(),target=returnTarget,pub=owner.snapshot().publication+1,claim=claimFocus();if(owner.back(token))focusReveal(usable(target)?target:status,token,pub,claim);});
 const unsubscribe=owner.subscribe(render);
 const api={dispose(){if(!alive)return;alive=false;unsubscribe();doc.removeEventListener('focusin',onFocus,true);if(mountedRoots.get(root)===api){mountedRoots.delete(root);root.replaceChildren();}}};
 mountedRoots.set(root,api);render(owner.snapshot());return api;
}

import {fixturePage} from './fixtures.mjs';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mount(root,host,{schedule=(ticket,done)=>setTimeout(()=>done(fixturePage(ticket)),420)}={}) {
  const doc=root.ownerDocument;
  root.innerHTML=`<div class="candidate" data-candidate="dv01" data-layout="orbit">
    <header class="page-header"><div class="brand"><span class="brand-mark" aria-hidden="true">✦</span><span>育伴港 <span class="brand-divider">/</span> 選配工作台</span></div><span class="synthetic-tag" id="synthetic-label">DV01 · 全合成示例</span></header>
    <div class="intro"><div><p class="eyebrow">DOCUMENT VERSION INDEX / 01</p><h1>每個版本，<br>都有自己的座標。</h1><p class="intro-copy">辨認文件、逐頁查找，再固定你選中的那個版本。<br>這裡只展示索引 metadata，不開啟正文。</p></div><div class="orbit-art" aria-hidden="true"><div class="orbit-ring ring-one"></div><div class="orbit-ring ring-two"></div><span class="orbit-core">DV<span>01</span></span><span class="star star-one">✦</span><span class="star star-two">✧</span><span class="art-caption">EVERY REVISION<br>HAS A COORDINATE</span></div></div>
    <nav class="layout-picker" aria-label="候選布局"><button id="layout-orbit" aria-pressed="true"><span class="layout-number">A</span><span>修訂星軌<small>文件 → 時間軸 → 固定選取</small></span></button><button id="layout-desk" aria-pressed="false"><span class="layout-number">B</span><span>索引對照台<small>固定選取 → 文件辨識 → 欄位掃讀</small></span></button></nav>
    <div class="workspace-heading"><div><p class="eyebrow" id="mode-kicker">ORBIT / NAVIGATE</p><h2 id="mode-title">修訂星軌</h2></div><p id="host-status" class="host-status"></p></div>
    <div id="work-area" class="work-area" data-layout="orbit">
      <section id="document-lane" class="document-lane" aria-labelledby="document-title"><div class="section-heading"><span class="section-index">01</span><h3 id="document-title">文件辨識</h3></div><p class="small-note">同名不代表同一份。請核對 ID 與文件版本。</p><div id="document-actions" class="document-actions"></div><div class="lane-foot"><span>合成資料範圍</span><strong>3 份虛構文件</strong><small>不是完整正式文件清單</small></div></section>
      <section id="index-pane" class="index-pane" aria-labelledby="index-title"><div class="index-top"><div><p class="eyebrow">REVISION METADATA</p><h3 id="index-title">成長整理</h3><p id="document-coordinate" class="coordinate"></p></div><label class="filter-label" for="version-filter">版本狀態<select id="version-filter"><option value="all">全部狀態</option><option value="readable">未失效</option><option value="invalidated">已失效</option></select></label></div><div id="read-feedback" class="read-feedback" role="status" aria-live="polite"></div><div class="column-head" aria-hidden="true"><span>快照版本</span><span>產生時間（UTC）</span><span>可讀狀態</span><span>選取意圖</span></div><ol id="revision-list" class="revision-list" aria-label="已載入的版本 metadata"></ol><p id="empty-state" class="empty-state"></p><div class="pagination"><div><strong id="window-count"></strong><small id="cursor-note"></small></div><div class="read-actions"><button id="reload-index" class="quiet-button">重新讀取索引</button><button id="read-primary" class="primary-button">讀取版本索引</button></div></div></section>
      <section id="pin-pane" class="pin-pane" aria-labelledby="pin-title"><div class="section-heading"><span class="section-index">✧</span><h3 id="pin-title">固定的選取</h3></div><p class="pin-preamble">新資料到達，不替你改選。</p><div id="pin-empty" class="pin-empty"><span aria-hidden="true">＋</span><strong>先選一個版本</strong><p>從索引明確選取，這裡才會保留它的確切座標。</p></div><div id="pin-selected" hidden><p class="pin-version" id="pin-version"></p><dl id="pin-coordinates"></dl></div><p id="pin-feedback" class="small-note"></p><p class="proposal-note"><strong>合成 host 提案</strong>接納只代表本頁意圖成立；正式 owner 尚未提供完整 binding／receipt。</p></section>
    </div>
    <div class="boundary-note"><strong>只看版本索引</strong><span>不含正文、PDF、下載、刪除或真實家庭資料。兩種布局共用同一份狀態，切版不重讀。</span></div>
    <details id="fault-lab" class="fault-lab"><summary>合成故障實驗室 <span>測試分頁、拒絕與晚回覆隔離</span></summary><p>以下只改本頁記憶體中的合成情境，不操作真帳戶或服務。先看上方候選，再按需要測試。</p><div class="lab-grid"><button id="fail-next">下一次讀取失敗</button><button id="empty-next">下一次回空頁</button><button id="hold-response" aria-pressed="false">暫扣下一筆回覆</button><button id="release-response">送回最早回覆</button><button id="change-epoch">換身份 epoch</button><button id="change-child">換合成孩子</button><button id="change-authority">換 authority</button><button id="change-generation">更新讀取世代</button><button id="change-document-version">變更文件版本</button><button id="toggle-offline">切換離線狀態</button><button id="invalidate-selected">失效所選 metadata</button><button id="remove-selected">移除所選 metadata</button><button id="revoke-access">模擬撤回權限</button><button id="restore-access">恢復合成情境</button></div><p id="lab-feedback" role="status" aria-live="polite">沒有暫扣的回覆。</p><details class="binding-details"><summary>查看目前捕獲 tuple</summary><pre id="binding-output"></pre></details></details>
    <footer>DV01 / 原創合成候選 · 來源 f0149b7 · 固定清冊仍為 e8918dd<br>模型／DOM 證據與正式產品驗收分開；本頁不宣稱已接正式 owner。</footer>
  </div>`;
  const $=id=>doc.getElementById(id),candidate=root.firstElementChild,rows=new Map(),docButtons=new Map();
  let layout='orbit',hold=false,nextFault=null,epoch=1,disposed=false;const held=[];
  // DOM identity lifetime only; read/query generations remain owned by the host.
  let controlContext=null,controlLifetime=0;
  const setDisabled=(el,value)=>el.setAttribute('aria-disabled',String(!!value));
  const tell=message=>{$('lab-feedback').textContent=message;};
  function request(mode){
    const r=host.loadVersions(host.capture(),mode);if(!r.accepted)return r;
    const fault=nextFault;nextFault=null;
    const done=outcome=>{if(disposed)return;const ok=host.settle(r.ticket,outcome);if(!ok)tell('這筆晚回覆已隔離，沒有改動目前索引。');};
    if(hold){held.push({ticket:r.ticket,done,outcome:fault==='fail'?{error:'合成連線失敗，請重試原讀取'}:fixturePage(r.ticket,{empty:fault==='empty'})});hold=false;$('hold-response').setAttribute('aria-pressed','false');tell(`已暫扣 ${r.ticket.id}；可切換文件／身份後再送回。`);}
    else if(fault){schedule(r.ticket,()=>done(fault==='fail'?{error:'合成連線失敗，請重試原讀取'}:fixturePage(r.ticket,{empty:true})));}
    else schedule(r.ticket,done);
    return r;
  }
  function setLayout(next){
    if(next===layout)return;layout=next;candidate.dataset.layout=next;$('work-area').dataset.layout=next;
    const focus=doc.activeElement,order=next==='orbit'?['document-lane','index-pane','pin-pane']:['pin-pane','document-lane','index-pane'];
    for(const id of order)$('work-area').append($(id));
    if(focus&&root.contains(focus)&&doc.activeElement!==focus)focus.focus({preventScroll:true});
    $('layout-orbit').setAttribute('aria-pressed',String(next==='orbit'));$('layout-desk').setAttribute('aria-pressed',String(next==='desk'));
    $('mode-title').textContent=next==='orbit'?'修訂星軌':'索引對照台';$('mode-kicker').textContent=next==='orbit'?'ORBIT / NAVIGATE':'DESK / INSPECT';
  }
  for(const d of host.snapshot.documents){
    const b=doc.createElement('button');b.id=`doc-${d.id}`;b.type='button';b.className='document-button';b.addEventListener('click',()=>{host.setDocument(d.id);if(host.snapshot.index.status==='neverRead')request('first');});$('document-actions').append(b);docButtons.set(d.id,b);
  }
  function render(){
    const s=host.snapshot,i=s.index,binding=host.capture(),busy=i.status==='loading';
    const context=JSON.stringify([binding.scope,binding.epoch,binding.childId,binding.authorityVersion,binding.documentId,binding.documentVersion]);
    if(context!==controlContext){controlContext=context;controlLifetime++;}
    $('host-status').textContent=s.available?'● 合成讀取可用':`○ ${s.unavailableReason}`;
    for(const d of s.documents){const b=docButtons.get(d.id);b.innerHTML=`<span class="document-glyph" aria-hidden="true">${d.id==='doc-aurora'?'A':d.id==='doc-aurora-copy'?'B':'C'}</span><span class="document-label"><strong>${escape(d.title)}</strong><small>${escape(d.context)}</small><span class="doc-id">${escape(d.id)} · d${d.documentVersion}</span></span>`;b.setAttribute('aria-pressed',String(d.id===s.document.id));}
    $('index-title').textContent=s.document.title;$('document-coordinate').textContent=`${s.document.id} · 文件版本 ${s.document.documentVersion}`;$('version-filter').value=s.filter;
    let feedback=i.status==='neverRead'?'尚未讀取這份文件的版本索引。':busy?(i.hasSucceeded?'正在讀取，已載窗口仍保留。':'正在取得第一頁版本 metadata。'):i.status==='failed'?(i.hasSucceeded?`讀取失敗；保留 ${i.items.length} 筆已確認 metadata。重試仍使用原文件與原游標。`:'首次讀取失敗；尚未取得可確認的版本索引。'):i.status==='lost'?'讀取權限已撤回；metadata 已清除。':`這個窗口已讀取成功。版本號不是「最新」的判定依據。`;
    if(!s.available&&i.status!=='lost')feedback=`${s.unavailableReason}；已載 metadata 保留，但暫不可讀取或選取。`;
    $('read-feedback').textContent=feedback;$('read-feedback').dataset.state=i.status;$('revision-list').setAttribute('aria-busy',String(busy));
    const wanted=new Set();
    for(const r of i.items){
      const key=JSON.stringify([controlLifetime,s.document.id,s.document.documentVersion,r.snapshotId,r.version]);wanted.add(key);let rec=rows.get(key);
      if(!rec){const li=doc.createElement('li');li.className='revision-row';li.innerHTML='<div class="revision-identity"><span class="revision-number"></span><span class="snapshot-id"></span></div><div class="revision-date"></div><span class="revision-state"></span><button data-version-action class="version-action">選取版本</button>';const button=li.querySelector('button');rec={li,button,binding,row:r};button.addEventListener('click',()=>{const result=host.selectVersion(rec.binding,rec.row.snapshotId,rec.row.version);if(!result.accepted)$('pin-feedback').textContent='此選取未獲接納，沒有改變固定版本。';});rows.set(key,rec);$('revision-list').append(li);}
      rec.binding=binding;rec.row=r;rec.li.classList.remove('unavailable-row');
      const utc=new Date(r.generatedAt).toISOString();
      rec.li.querySelector('.revision-number').textContent=`v${r.version}`;rec.li.querySelector('.snapshot-id').textContent=r.snapshotId;rec.li.querySelector('.revision-date').innerHTML=`<span>${utc.slice(0,10)}</span><small>${utc.slice(11,16)} UTC</small>`;rec.li.querySelector('.revision-state').textContent=r.invalidated?'已失效':'未失效';rec.li.dataset.invalidated=String(r.invalidated);
      const selected=s.selection?.documentId===s.document.id&&s.selection?.documentVersion===s.document.documentVersion&&s.selection?.snapshotId===r.snapshotId&&s.selection?.snapshotVersion===r.version;
      rec.button.textContent='選取版本';rec.button.setAttribute('aria-label',`選取版本 v${r.version}，${s.document.id}，快照 ${r.snapshotId}`);rec.button.setAttribute('aria-pressed',String(!!selected));setDisabled(rec.button,r.invalidated||!s.available);rec.li.dataset.selected=String(!!selected);
    }
    for(const [key,rec] of rows){if(wanted.has(key))continue;if(rec.li.contains(doc.activeElement)){rec.li.classList.add('unavailable-row');rec.li.querySelector('.revision-number').textContent='—';rec.li.querySelector('.snapshot-id').textContent='此項目目前不可用';rec.li.querySelector('.revision-date').textContent='資料已清除';rec.li.querySelector('.revision-state').textContent='不可用';rec.button.textContent='無法選取';rec.button.setAttribute('aria-label','無法選取：此項目目前不可用');rec.button.setAttribute('aria-pressed','false');setDisabled(rec.button,true);}else{rec.li.remove();rows.delete(key);}}
    // Reorder around the focused node instead of detaching it or moving focus.
    let anchor=null;for(const key of [...wanted].reverse()){const rec=rows.get(key);if(!rec.li.contains(doc.activeElement)&&rec.li.nextSibling!==anchor)$('revision-list').insertBefore(rec.li,anchor);anchor=rec.li;}
    $('empty-state').hidden=i.items.length>0;$('empty-state').textContent=i.status==='lost'?'索引已清除。':busy?'讀取中，請稍候。':i.status==='failed'?'未能取得這個窗口，請重試原讀取。':i.hasSucceeded?(i.nextCursor!==null?'這一頁沒有項目，但仍有後續游標。可以繼續讀取。':'這個查詢已完成，目前沒有符合的版本。'):'索引尚未讀取。';
    $('window-count').textContent=`已載 ${i.items.length} 筆`;$('cursor-note').textContent=i.hasSucceeded?(i.nextCursor!==null?'僅為已載窗口 · 還有後續':'這次查詢已到尾端'):'尚未確認查詢範圍';
    $('read-primary').textContent=busy?'讀取中…':i.error?'重試這次讀取':!i.hasSucceeded?'讀取版本索引':i.nextCursor!==null?'載入更多版本':'已到索引尾端';
    setDisabled($('read-primary'),busy||!s.available||(!i.error&&i.hasSucceeded&&i.nextCursor===null));setDisabled($('reload-index'),busy||!s.available||!i.hasSucceeded);
    $('pin-empty').hidden=!!s.selection;$('pin-selected').hidden=!s.selection;
    if(s.selection){const p=s.selection;$('pin-version').textContent=`v${p.snapshotVersion}`;$('pin-coordinates').innerHTML=`<div><dt>文件</dt><dd>${escape(p.documentId)}</dd></div><div><dt>文件版本</dt><dd>${p.documentVersion}</dd></div><div><dt>快照</dt><dd>${escape(p.snapshotId)}</dd></div><div><dt>接納票號（合成）</dt><dd>${escape(p.ticketId)}</dd></div>`;$('pin-feedback').textContent=p.available?'已接納選取意圖，不代表正文已讀取或已保存。':`固定版本目前不可用：${p.reason}。不會自動改選。`;}
    else{$('pin-coordinates').replaceChildren();$('pin-version').textContent='';$('pin-feedback').textContent='沒有默認選中的版本。';}
    $('binding-output').textContent=JSON.stringify(binding,null,2);
  }
  $('layout-orbit').onclick=()=>setLayout('orbit');$('layout-desk').onclick=()=>setLayout('desk');
  $('read-primary').onclick=()=>{const i=host.snapshot.index;request(i.error?'retry':i.hasSucceeded?'more':'first');};
  $('reload-index').onclick=()=>{if($('reload-index').getAttribute('aria-disabled')!=='true')request('reload');};
  $('version-filter').onchange=event=>{host.setFilter(event.target.value);request('first');};
  $('fail-next').onclick=()=>{nextFault='fail';tell('下一次合成讀取將失敗。按上方讀取／重讀按鈕開始。');};
  $('empty-next').onclick=()=>{nextFault='empty';tell('下一次合成讀取將回傳空頁；第一頁仍提供後續游標。');};
  $('hold-response').onclick=()=>{hold=!hold;$('hold-response').setAttribute('aria-pressed',String(hold));tell(hold?'下一筆讀取會暫扣，等你手動送回。':'取消暫扣下一筆讀取。');};
  $('release-response').onclick=()=>{const pending=held.shift();if(!pending){tell('沒有暫扣的回覆。');return;}const valid=host.settle(pending.ticket,pending.outcome);tell(valid?'已送回同一個合成讀取窗口。':'這筆晚回覆已隔離，沒有改動目前索引。');};
  $('change-epoch').onclick=()=>{host.setContext({epoch:`epoch-${++epoch}`});tell('同一合成使用者的新 epoch；舊回覆無法進入。');};
  $('change-child').onclick=()=>{host.setContext({childId:host.snapshot.context.childId==='synthetic-child-a'?'synthetic-child-b':'synthetic-child-a'});tell('已切換合成孩子；索引已清除。');};
  $('change-authority').onclick=()=>{host.setContext({authorityVersion:`authority-${++epoch}`});tell('合成 authority 已換代；舊回覆無法進入。');};
  $('change-generation').onclick=()=>{host.renewGeneration();tell('讀取世代已更新；已確認窗口仍保留，舊回覆失效。');};
  $('change-document-version').onclick=()=>{const d=host.snapshot.document;host.setDocumentVersion(d.id,d.documentVersion+1);tell('文件版本已改變；原固定 tuple 不會被替換。');};
  $('toggle-offline').onclick=()=>{host.setAvailability(host.snapshot.available?'合成離線':null);tell('已切換合成讀取可用狀態。');};
  for(const [id,kind] of [['invalidate-selected','invalidate'],['remove-selected','remove']])$(id).onclick=()=>{const previous=host.snapshot,p=previous.selection;if(!p){tell('請先在上方選取一個版本。');return;}const r=host.loadVersions(host.capture(),'reload');if(!r.accepted){tell('目前不可重讀，請先完成或恢復讀取。');return;}const items=kind==='remove'?previous.index.items.filter(item=>item.snapshotId!==p.snapshotId||item.version!==p.snapshotVersion):previous.index.items.map(item=>item.snapshotId===p.snapshotId&&item.version===p.snapshotVersion?{...item,invalidated:true}:item);host.settle(r.ticket,{page:{documentId:r.ticket.binding.documentId,documentVersion:r.ticket.binding.documentVersion,items,nextCursor:previous.index.nextCursor}});tell(kind==='invalidate'?'已將所選合成 metadata 標成失效。':'所選 metadata 已移出這個合成回覆，固定 tuple 保留不可用。');};
  $('revoke-access').onclick=()=>{host.revoke();tell('合成權限已撤回；metadata 清除，不代表真帳戶權限變更。');};
  $('restore-access').onclick=()=>{host.restore();tell('已恢復全新合成讀取情境，請重新讀取索引。');};
  const unsubscribe=host.subscribe(render);render();request('first');
  return {setLayout,request,destroy(){disposed=true;unsubscribe();}};
}

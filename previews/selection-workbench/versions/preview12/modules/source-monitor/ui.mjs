import {filterRows,displayTime,labels,resultLabel} from './model.mjs';
import {fixturePage} from './fixtures.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const badge=v=>`<span class="badge result-${v??'unknown'}">${esc(resultLabel(v))}</span>`;
const button=(id,text,disabled=false,extra='')=>`<button id="${id}" type="button" ${disabled?'disabled':''} ${extra}>${text}</button>`;
export function mount(root,host,{schedule}={}) {
  const doc=root.ownerDocument;let destroyed=false,focusSeq=0,restoring=false,detailOrigin=null,detailSelection=null,held=[];const timers=new Set();
  root.innerHTML=`<a class="skip" href="#content">跳到閱讀內容</a><header class="masthead"><div class="brand"><span aria-hidden="true" class="brand-mark">港</span><div><strong>育伴港 · 來源觀測室</strong><span class="micro">KNOWLEDGE MONITOR / KM01</span></div></div><span class="synthetic">全合成示例 · 只讀候選</span></header>
    <nav class="layout-controls" aria-label="選擇資訊布局">${button('layout-bridge','01 來源巡檢')}${button('layout-dossier','02 檢查卷宗')}</nav>
    <section class="hero"><div><p class="eyebrow" id="eyebrow"></p><h1 id="hero-title"></h1><p id="hero-copy"></p></div><div class="hero-note"><span class="micro">READING BOUNDARY</span><p>監測 ≠ 審核 ≠ 發布</p><span>這裡只讀來源與檢查結果，不能判定知識是否已發布。</span></div></section>
    <div id="access-panel"></div><div id="toolbar"></div><p id="live" role="status" aria-live="polite" aria-atomic="true"></p><div id="notice"></div><div id="content" tabindex="-1"></div>
    <footer><p>KM01 · 原創合成呈現。所有組織、網址與紀錄均為虛構，沒有連接網站、帳戶或模型。時間顯示為香港時間（UTC+8）。</p><details id="lab"><summary>合成實驗室 <span>僅供驗收，預設收起</span></summary><div class="lab-grid"><label>下一次合成回覆<select id="next-result"><option value="normal">正常頁</option><option value="error">讀取錯誤</option><option value="empty">空頁</option></select></label><label class="check-label"><input type="checkbox" id="delay">暫存回覆，手動完成</label>${button('settle','完成暫存回覆')}<label class="check-label"><input type="checkbox" id="offline">合成離線</label><label class="check-label"><input type="checkbox" id="mask">宿主互動遮罩</label><label class="check-label"><input type="checkbox" id="busy">一般／索引／帳戶忙碌</label>${button('identity','切換合成身份')}${button('revoke','撤銷合成權限')}${button('generation','重設同身份 generation')}</div><p id="lab-state"></p><p>遮罩拒絕新讀取但不取消在途讀取；一般 busy 不鎖住此模組。權限重查僅是合成測試，並非真實登入。</p></details></footer>
    <dialog id="detail" aria-labelledby="detail-title"><div class="dialog-top"><span class="micro">SYNTHETIC / DETAIL</span>${button('detail-close','關閉詳情')}</div><div id="detail-body"></div>${button('detail-last','返回列表')}</dialog>`;
  const $=id=>doc.getElementById(id);const dialog=$('detail');
  function focus(id){const target=$(id);if(target&&!target.disabled){restoring=true;target.focus({preventScroll:true});restoring=false;return true;}return false;}
  function closeDetail(returnFocus=true){if(dialog.open){if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');}detailSelection=null;$('detail-body').innerHTML='';if(returnFocus&&!focus(detailOrigin))focus('query');}
  function rowWatch(w){const selected=host.view.selection;return `<li><button type="button" class="watch-row" id="watch-${esc(w.id)}" data-kind="watch" data-id="${esc(w.id)}" aria-pressed="${selected?.kind==='watch'&&selected.id===w.id}"><span class="row-main"><span class="micro">${esc(labels.kind[w.kind])} / ${esc(w.id)}</span><strong>${esc(w.publisher)}</strong><span class="muted">${esc(labels.registration[w.registration])}</span></span><span class="row-result">${badge(w.lastStatus)}<span class="muted">最近嘗試 ${esc(displayTime(w.lastAttemptAt))}</span></span><span class="row-arrow" aria-hidden="true">↗</span></button></li>`;}
  function rowCheck(c){const selected=host.view.selection;return `<li><button type="button" class="check-row" id="check-${esc(c.jobId)}" data-kind="check" data-id="${esc(c.jobId)}" aria-pressed="${selected?.kind==='check'&&selected.id===c.jobId}"><span class="event-time">${esc(displayTime(c.checkedAt))}<span class="micro">${esc(labels.state[c.state])}</span></span><span class="event-body"><strong>${esc(c.watchId)}</strong>${badge(c.status)}<span class="muted">項目 ${c.itemCount} · 變更 ${c.changedCount} · 嘗試 ${c.attempts}</span></span><span class="row-arrow" aria-hidden="true">↗</span></button></li>`;}
  function render(){
    if(destroyed)return;const active=doc.activeElement,activeId=active?.id,range=activeId==='query'?[active.selectionStart,active.selectionEnd]:null;
    const s=host.view,k=s.knowledge,p=k.page,blocked=!s.interactive||s.access!=='allowed';root.dataset.layout=s.layout;
    let recoverDetailFocus=false;
    if(dialog.open){
      const selected=s.selection, live=detailSelection && selected?.kind===detailSelection.kind && selected.id===detailSelection.id && detailSelection.binding===host.binding;
      const exists=live && p && (selected.kind==='watch'?p.watches:p.checks).some(row=>(selected.kind==='watch'?row.id:row.jobId)===selected.id);
      if(blocked||!k.open||!exists){recoverDetailFocus=dialog.contains(active);closeDetail(false);}
      else renderDetail(selected.kind,selected.id,p);
    }else if(!p||blocked){closeDetail(false);}
    $('layout-bridge').setAttribute('aria-pressed',String(s.layout==='bridge'));$('layout-dossier').setAttribute('aria-pressed',String(s.layout==='dossier'));
    $('eyebrow').textContent=s.layout==='bridge'?'01 / SOURCE WATCH BRIDGE':'02 / CHECK RECORD DOSSIER';
    $('hero-title').innerHTML=s.layout==='bridge'?'看見來源，<br>看清變動。':'一份紀錄，<br>保留每次未明。';
    $('hero-copy').textContent=s.layout==='bridge'?'從當前來源目錄開始，對照已記錄的檢查。':'沿著已取得的檢查紀錄閱讀，再回看目前來源定義。';
    $('access-panel').innerHTML=blocked?`<section class="mask-panel"><h2>${!s.interactive?'宿主互動已遮罩':'合成管理權限未允許'}</h2><p>${!s.interactive?'內容已隱藏；在途合成讀取仍可完成。請在頁尾實驗室解除遮罩。':'舊內容已清除。權限重查不要求已獲權限，且不會自動重讀來源。'}</p>${button('recheck','重新檢查合成權限',!s.online||!s.interactive)}</section>`:'';
    $('toolbar').innerHTML=blocked?'':`<div class="read-controls">${button('toggle-open',k.open?'收起閱讀區':'開啟閱讀區',!s.online&&!k.open,`aria-expanded="${k.open}" aria-controls="content"`)}${k.open?button('reload',k.status==='error'&&!p?'重試讀取來源及首批檢查':'重讀來源及首批檢查',!host.availability().available):''}<span class="read-state">${!s.online?'合成離線 · ':''}${{unread:'尚未讀取',loading:p?'讀取中 · 保留先前內容':'正在讀取',ready:'合成快照已取得',error:p?'讀取失敗 · 內容為先前快照':'讀取失敗'}[k.status]}</span></div>${k.open?`<div class="filters"><label for="query">搜尋已載入內容<input id="query" type="search" value="${esc(s.query)}" placeholder="來源 ID、發布者或檢查 ID" aria-describedby="search-scope"></label><label for="result-filter">結果<select id="result-filter"><option value="all">所有結果</option>${Object.entries(labels.result).map(([value,text])=>`<option value="${value}" ${s.filter===value?'selected':''}>${text}</option>`).join('')}</select></label>${button('clear-filter','清除篩選')}</div><p id="search-scope" class="muted small">只查已載入來源的 ID／發布者／網址／類型／註冊值，以及檢查的 ID／來源 ID／狀態／結果／失敗代碼。按原始欄位值比對；不搜尋日期、計數或未載入紀錄。</p>`:''}`;
    $('live').textContent=blocked?'內容已遮蔽。':s.announcement;
    $('notice').innerHTML=!blocked&&k.open&&k.notice?`<p class="error-notice" role="alert">${esc(k.notice)} ${p?'先前內容及游標保留；可重讀首批或重試載入更多。':'尚未取得內容，不能視為沒有紀錄。'}</p>`:'';
    if(blocked){$('content').innerHTML='';closeDetail(false);$('detail-body').innerHTML='';}
    else if(!k.open){$('content').innerHTML='<p class="closed-note">閱讀區已收起。再次開啟已取得的內容不會重新讀取。</p>';closeDetail(false);}
    else if(!p){$('content').innerHTML=`<section class="empty-panel"><h2>${k.status==='loading'?'正在打開合成閱讀窗口':'尚未取得來源快照'}</h2><p>未取得不等於沒有來源，也不代表檢查正常。</p></section>`;}
    else{
      const visible=filterRows(p,s.query,s.filter);const filtered=!!s.query.trim()||s.filter!=='all';const empty=(kind)=>filtered?'沒有符合目前篩選的已載入項目。':kind==='watches'?'未查到可列出的來源定義，暫時未能確認監測狀態。':'未查到檢查紀錄；不代表已完成檢查。';
      const watchSection=`<section class="sources" ${s.layout==='bridge'?'data-primary="watches"':''} aria-labelledby="sources-title"><div class="section-title"><div><p class="eyebrow">CURRENT CATALOG</p><h2 id="sources-title">來源目錄</h2></div><span class="section-count">${visible.watches.length} / ${p.watches.length}<small>本次目錄</small></span></div><p class="section-note">每次翻頁會以新回覆替換來源目錄，不累積舊定義。</p><ul class="watch-list">${visible.watches.length?visible.watches.map(rowWatch).join(''):`<li class="empty-note">${empty('watches')}</li>`}</ul></section>`;
      const checkSection=`<section class="checks" ${s.layout==='dossier'?'data-primary="checks"':''} aria-labelledby="checks-title"><div class="section-title"><div><p class="eyebrow">LOADED CHECK WINDOW</p><h2 id="checks-title">檢查紀錄</h2></div><span class="section-count">${visible.checks.length} / ${p.checks.length}<small>目前已取得</small></span></div><p class="section-note">檢查按 jobId 合併。數量僅限已取得窗口，不是歷史總量。</p><ol class="event-list">${visible.checks.length?visible.checks.map(rowCheck).join(''):`<li class="empty-note">${empty('checks')}</li>`}</ol><div class="pagination">${p.nextCursor?button('more',k.status==='error'?'重試載入更多檢查':'載入更多檢查',!host.availability(true).available):'<p>本次窗口沒有後續游標。這不是完整歷史的證明。</p>'}</div></section>`;
      const sel=s.selection;const visibleSel=sel&&(sel.kind==='watch'?visible.watches:visible.checks).some(r=>(sel.kind==='watch'?r.id:r.jobId)===sel.id);
      $('content').innerHTML=`<div id="selection-note" class="selection-note">${sel?`已選取 ${esc(sel.id)}。${visibleSel?'切換布局會保留選取。':'此項目被目前篩選隱藏；清除篩選可再次找到。'}`:'點選來源或檢查紀錄，閱讀完整欄位。未明結果不會被當作正常。'}</div><div class="reading-grid">${s.layout==='bridge'?watchSection+checkSection:checkSection+watchSection}</div>`;
    }
    $('lab-state').textContent=`合成身份 ${s.identity} · generation ${s.generation} · 已接納讀取 ${host.readCount} 次 · 暫存 ${held.length} 次`;
    $('offline').checked=!s.online;$('mask').checked=!s.interactive;$('busy').checked=s.generalBusy;
    if(recoverDetailFocus){if(!focus(detailOrigin))if(!focus(blocked?(!s.interactive?'mask':'recheck'):'query'))focus('toggle-open');}
    else if(activeId&&activeId!=='detail-close'&&activeId!=='detail-last'&&doc.activeElement!==active){if(focus(activeId)&&range)$('query').setSelectionRange(...range);}
  }
  function renderDetail(kind,id,p){const r=(kind==='watch'?p.watches:p.checks).find(v=>(kind==='watch'?v.id:v.jobId)===id);let fields;
    if(kind==='watch')fields=[['來源 ID',r.id],['發布者',r.publisher],['網址（僅文字）',r.url],['類型',labels.kind[r.kind]],['註冊',labels.registration[r.registration]],['最近嘗試',displayTime(r.lastAttemptAt)],['最近成功檢查',displayTime(r.lastSuccessfulCheckAt)],['最近結果',resultLabel(r.lastStatus)]];
    else fields=[['檢查 ID',r.jobId],['來源 ID',r.watchId],['目前來源定義',p.watches.some(w=>w.id===r.watchId)?'在本次來源目錄中':'不在本次來源目錄；不能推斷已刪除'],['檢查時間',displayTime(r.checkedAt)],['執行狀態',labels.state[r.state]],['結果',resultLabel(r.status)],['嘗試次數',r.attempts],['項目數',r.itemCount],['變更數',r.changedCount],['失敗代碼',r.failureCode??'未提供'],['HTTP 狀態',r.httpStatus??'未提供']];
    $('detail-body').innerHTML=`<p class="eyebrow">${kind==='watch'?'SOURCE DEFINITION':'RECORDED CHECK'}</p><h2 id="detail-title">${esc(kind==='watch'?r.publisher:resultLabel(r.status))}</h2><p class="muted">全合成資料 · 香港時間（UTC+8）</p><dl>${fields.map(([name,value])=>`<div><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><p class="detail-note">零項目、未明結果或沒有成功時間，都不是健康或發布成功的證明。</p>`;
  }
  function openDetail(kind,id,origin){if(!host.select(kind,id))return;detailOrigin=origin;detailSelection={kind,id,binding:host.binding};renderDetail(kind,id,host.view.knowledge.page);
    if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');focus('detail-close');
  }
  function request(fn,origin){const result=fn();if(!result.accepted||!result.ticket)return;const seq=focusSeq;const ticket=result.ticket;
    const finish=outcome=>{if(destroyed)return;const shouldRecover=seq===focusSeq&&(!doc.activeElement||doc.activeElement===doc.body||doc.activeElement.id===origin)&&!dialog.open;
      const accepted=host.resolve(ticket,outcome);if(accepted&&shouldRecover){if(!focus(origin))if(!focus('reload'))focus('toggle-open');}};
    if(schedule)schedule(ticket,finish);else{const resultType=$('next-result').value;const outcome=resultType==='error'?{error:'合成讀取逾時。這不是來源本身的檢查結果。'}:{page:fixturePage(ticket.more,resultType==='empty')};$('next-result').value='normal';
      if($('delay').checked){held.push(()=>finish(outcome));render();}else {const timer=setTimeout(()=>{timers.delete(timer);finish(outcome);},350);timers.add(timer);}}
  }
  function click(e){const b=e.target.closest('button');if(!b||b.disabled)return;const id=b.id;
    if(b.dataset.kind)return openDetail(b.dataset.kind,b.dataset.id,id);
    if(id==='layout-bridge'||id==='layout-dossier')host.setLayout(id.slice(7));
    else if(id==='toggle-open')request(()=>host.setOpen(!host.snapshot.knowledge.open),id);
    else if(id==='reload'||id==='more')request(()=>host.read(id==='more'),id);
    else if(id==='clear-filter'){host.setQuery('');host.setFilter('all');focus('query');}
    else if(id==='detail-close'||id==='detail-last')closeDetail();
    else if(id==='recheck')host.recheck();
    else if(id==='identity')host.changeIdentity();else if(id==='revoke')host.revoke();else if(id==='generation')host.newGeneration();
    else if(id==='settle'){const jobs=held;held=[];jobs.forEach(done=>done());render();}
  }
  function input(e){if(e.target.id==='query')host.setQuery(e.target.value);}
  function change(e){const el=e.target;if(el.id==='result-filter')host.setFilter(el.value);if(el.id==='offline')host.setContext({online:!el.checked});if(el.id==='mask')host.setContext({interactive:!el.checked});if(el.id==='busy')host.setContext({generalBusy:el.checked,indexBusy:el.checked,accountBusy:el.checked});}
  function key(e){if(!dialog.open)return;if(e.key==='Escape'){e.preventDefault();closeDetail();}if(e.key==='Tab'){if(e.shiftKey&&doc.activeElement.id==='detail-close'){e.preventDefault();focus('detail-last');}else if(!e.shiftKey&&doc.activeElement.id==='detail-last'){e.preventDefault();focus('detail-close');}}}
  function onFocus(){if(!restoring)focusSeq++;}
  root.addEventListener('click',click);root.addEventListener('input',input);root.addEventListener('change',change);dialog.addEventListener('keydown',key);dialog.addEventListener('cancel',e=>{e.preventDefault();closeDetail();});doc.addEventListener('focusin',onFocus);
  const unsubscribe=host.subscribe(render);render();request(()=>host.setOpen(true),'toggle-open');
  return {destroy(){destroyed=true;unsubscribe();timers.forEach(clearTimeout);root.removeEventListener('click',click);root.removeEventListener('input',input);root.removeEventListener('change',change);doc.removeEventListener('focusin',onFocus);root.innerHTML='';}};
}

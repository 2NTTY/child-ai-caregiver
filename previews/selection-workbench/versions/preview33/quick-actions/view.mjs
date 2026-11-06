// NEW DOM ADAPTER. Ordinary HTML controls; no camera, gesture recognizer or command library.
const commands = [
  { kind: 'text', number: '01', label: '用文字交代', short: '文字', destination: '/chat', detail: '回到對話，保留原本未送出的文字。', group: '開始交代' },
  { kind: 'photo', number: '02', label: '試放照片中繼資料', short: '合成照片', destination: '/chat', detail: '只用合成檔名與大小；另一個明確步驟才交接給草稿。', group: '開始交代' },
  { kind: 'care', number: '03', label: '查看記錄與補改', short: '記錄', destination: '/care', detail: '查看照護記錄的目的地意圖，不新增或更改記錄。', group: '回看與補充' },
];
const button = (command, attribute) => `<button type="button" ${attribute}="${command.kind}"><span class="command-number">${command.number}</span><span><strong>${command.label}</strong><small>${command.detail}</small></span><span aria-hidden="true">↗</span></button>`;

export function mountQuickApp(document, root, owner) {
  let layout = 'A', selection = null, pending = null, disposed = false;
  root.innerHTML = `
    <header class="masthead"><a class="brand" href="#qk-title" aria-label="快捷入口比較頁">育伴港<span>選配工作台 / QK01</span></a><span class="synthetic-tag">全頁合成 · 不連正式服務</span></header>
    <section class="intro"><p class="eyebrow">QUICK START / 快捷入口與記錄</p><h1 id="qk-title">先開始一件事，<br>把原本的留好。</h1><p class="intro-copy">比較兩種入口習慣。切換外觀不會換掉草稿；選入口也不代表已送出。</p></section>
    <nav class="layout-switch" aria-label="比較快捷入口版型"><button type="button" data-layout="A" aria-pressed="true"><span>A</span> 拇指托盤<small>直接選動作</small></button><button type="button" data-layout="B" aria-pressed="false"><span>B</span> 指令目錄<small>搜尋、選擇、確認</small></button></nav>
    <div class="workspace"><aside class="draft-panel" data-draft-summary aria-labelledby="draft-heading"><div class="panel-top"><span class="eyebrow">同一份 · 本頁記憶體</span><span class="draft-dot" aria-hidden="true"></span></div><h2 id="draft-heading">入口換了，草稿還在</h2><p class="context" data-context></p><div class="draft-paper"><p class="caption">保留中的文字</p><p data-text></p></div><div class="attachment" data-attachment></div><div class="operation" data-operation></div><div class="receipt" data-receipt></div><p class="fine-print">只有合成文字和檔案中繼資料。沒有真照片、相機、錄音、上傳或模型。</p></aside><section class="entry-panel" data-entry aria-label="快捷操作"></section></div>
    <p class="notice" role="status" aria-live="polite" aria-atomic="true" data-notice></p>
    <section class="delivery-panel" data-delivery hidden aria-label="合成附件回傳"><div><p class="eyebrow">合成回傳 · 第二步</p><h2>中繼資料準備好了</h2><p>沒有開啟選檔器。可現在交接，也可先換版型，再回來觀察較早回傳被拒絕。</p></div><div class="delivery-actions"><button type="button" data-action="deliver">完成合成回傳</button><button type="button" data-action="cancel-delivery">取消這次回傳</button></div></section>
    <details class="scenario-panel"><summary>試試不同情境 <span>只改本頁合成狀態</span></summary><div class="scenario-body"><div class="scenario-buttons"><button type="button" data-action="load-text">載入既有文字</button><button type="button" data-action="pending">載入處理中示例</button><button type="button" data-action="unknown">載入結果未定示例</button><button type="button" data-action="reset">清除普通合成草稿</button></div><label class="scope-label">接納範圍<select data-context-select><option value="private-A">私人首頁 · A</option><option value="private-B">私人首頁 · B</option><option value="shared">共享首頁</option><option value="away">已離開首頁</option></select></label><p>有文字、附件或未定操作時不切範圍。處理中／結果未定不能在這裡清除、重試或替換，須由原處理頁核對。</p><p class="ledger" data-ledger></p></div></details>
    <footer><p>A 偏向少選一步；B 讓目的地先看清楚。單點按鈕可操作，不需要拖曳或長按。</p><p>候選只做本頁比較，未接正式 owner。真觸控、鍵盤、讀屏與畫面尚未驗收。<a href="./sources.md">來源與限制</a></p></footer>`;
  const entry = root.querySelector('[data-entry]');
  const find = selector => root.querySelector(selector);
  const describe = value => { find('[data-notice]').textContent = value; };
  const syncSelection = () => {
    if (layout !== 'B') return;
    const command = commands.find(item => item.kind === selection?.kind);
    find('[data-selection-title]').textContent = command?.label ?? '先選一個入口';
    find('[data-selection-detail]').textContent = command ? `${command.detail} 目的地：${command.destination}` : '搜尋只過濾入口。選擇後再確認，不會自動執行第一個結果。';
    find('[data-action="confirm"]').disabled = !selection || !owner.snapshot().available;
    entry.querySelectorAll('[data-select]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.select === selection?.kind)));
  };
  const retire = () => {
    owner.retire(); selection = null;
    if (disposed) return;
    const tray = find('[data-tray]');
    if (tray) { tray.hidden = true; find('[data-action="toggle-tray"]').setAttribute('aria-expanded', 'false'); }
    syncSelection();
  };
  // Only an explicit local action may carry focus out of the region it hides.
  // Complete all old state changes first; focus is last because its listeners may start newer work.
  const afterLocalHide = (region, action, destination) => {
    const previous = document.activeElement, previousLayout = layout;
    const eligible = !document.hidden && previous?.isConnected && region?.contains(previous) && !previous.closest('[hidden]');
    let moved = false;
    const focusMoved = () => { moved = true; };
    if (eligible) document.addEventListener('focusin', focusMoved);
    let expectedGeneration;
    try { expectedGeneration = action(); }
    finally { if (eligible) document.removeEventListener('focusin', focusMoved); }
    if (!eligible || moved || disposed || document.hidden || layout !== previousLayout || owner.snapshot().generation !== expectedGeneration) return;
    if (document.activeElement !== previous && document.activeElement !== document.body) return;
    const next = destination();
    if (!next?.isConnected || !root.contains(next) || next.disabled || next.closest('[hidden]')) return;
    next.focus({ preventScroll: true });
  };
  const currentOpener = () => layout === 'A' ? find('[data-action="toggle-tray"]') : find('[data-search]');
  const renderEntry = () => {
    root.dataset.ia = layout;
    const workspace = find('.workspace'), summary = find('[data-draft-summary]');
    if (layout === 'B') workspace.append(summary); else workspace.prepend(summary);
    root.querySelectorAll('[data-layout]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.layout === layout)));
    entry.innerHTML = layout === 'A'
      ? `<div class="tray-scene"><div class="scene-heading"><span class="eyebrow">A / 拇指托盤</span><h2>想到什麼，<br>從這裡開始。</h2><p>常用入口放在下方，先保留，再交代。</p></div><div class="sample-note" aria-hidden="true"><span>今天想說的</span><p>一段話，或一張合成照片。</p><i>留在同一份草稿裡</i></div><div class="thumb-zone"><div class="tray" id="quick-tray" data-tray hidden><p class="caption">選擇下一步</p>${commands.map(command => button(command, 'data-kind')).join('')}<button class="quiet" type="button" data-action="close-tray">收起入口</button></div><button type="button" class="launch-button" data-action="toggle-tray" aria-expanded="false" aria-controls="quick-tray"><span aria-hidden="true">＋</span> 開啟快捷入口 <small>不會自動送出</small></button></div></div>`
      : `<div class="catalogue"><div class="catalogue-heading"><span class="eyebrow">B / 指令目錄</span><h2>你想先做什麼？</h2><p>先找到入口，再看清楚它會去哪裡。</p></div><label class="search-label" for="quick-search">搜尋入口</label><div class="search-box"><span aria-hidden="true">⌕</span><input type="search" id="quick-search" data-search placeholder="試試「照片」或「記錄」" autocomplete="off"><button type="button" class="quiet" data-action="clear-search">清除</button></div><div class="command-layout"><div class="command-list">${['開始交代','回看與補充'].map(group => `<section data-group><h3>${group}</h3>${commands.filter(command => command.group === group).map(command => button(command, 'data-select')).join('')}</section>`).join('')}<p data-empty hidden>沒有符合的入口。可以清除搜尋，查看全部三個選項。</p></div><section class="selection-card" aria-labelledby="selection-title"><span class="eyebrow">下一步預覽</span><h3 id="selection-title" data-selection-title></h3><p data-selection-detail></p><div class="retention-note"><span aria-hidden="true">○</span> 原草稿與未定操作都保留</div><button type="button" class="confirm-button" data-action="confirm" disabled>確認這個合成意圖 <span aria-hidden="true">↗</span></button><p class="fine-print">只是意圖回報，不是導航或保存收據。</p></section></div></div>`;
    syncSelection(); update();
  };
  let lastContext = '';
  function update() {
    if (disposed) return;
    const s = owner.snapshot(), identity = JSON.stringify(s.context);
    if (selection && selection.ticket.generation !== s.generation) selection = null;
    if (lastContext && identity !== lastContext) retire();
    lastContext = identity;
    find('[data-context]').textContent = `${s.context.private ? '私人' : '共享'}合成範圍 · ${s.context.scope.endsWith('A') ? 'A' : 'B'} · ${s.context.path === '/' ? '首頁' : '非首頁'}`;
    find('[data-context-select]').value = !s.context.private ? 'shared' : s.context.path !== '/' ? 'away' : s.context.scope.endsWith('A') ? 'private-A' : 'private-B';
    find('[data-text]').textContent = s.text || '還沒有文字。先選入口也沒關係。';
    find('[data-attachment]').textContent = s.attachments.length ? `合成附件 ${s.attachments[0].fileName} · ${s.attachments[0].bytes} bytes · 未上傳` : '目前沒有附件';
    find('[data-operation]').textContent = s.operation ? `${s.phase === 'unknown' ? '結果未定' : '處理中'} · ${s.operation.id}。回原處理頁核對，這裡不替換。` : '沒有載入待核對操作';
    find('[data-operation]').classList.toggle('pending', !!s.operation);
    const receipt = s.receipts.at(-1);
    find('[data-receipt]').textContent = receipt ? `合成意圖 ${receipt.id} → ${receipt.destination}。尚未導航、送出或保存。` : '尚未產生合成意圖';
    describe(s.notice);
    find('[data-ledger]').textContent = `本頁資源帳：${s.ledger.reduce((n, item) => n + item.transfers, 0)} 次交接 · ${s.ledger.reduce((n, item) => n + item.disposals, 0)} 次釋放。只有合成中繼資料。`;
    find('[data-delivery]').hidden = !pending;
    entry.querySelectorAll('[data-kind], [data-select], [data-action="toggle-tray"]').forEach(node => { node.disabled = !s.available; });
    for (const action of ['pending', 'unknown', 'load-text']) find(`[data-action="${action}"]`).disabled = !s.available || !!s.operation;
    find('[data-action="reset"]').disabled = !!s.operation;
    syncSelection();
  }
  const start = (kind, ticket = owner.begin(kind)) => {
    selection = null;
    if (!ticket) { update(); return; }
    if (kind === 'photo') {
      // A newer ticket already invalidated the old one. Release its local metadata before replacement.
      if (pending) owner.complete(pending.ticket, pending.item);
      pending = { ticket, item: owner.makeMetadata() };
      update(); describe('合成照片中繼資料已備妥；按「完成合成回傳」才嘗試交接。沒有開啟相機。');
    } else { owner.complete(ticket); update(); }
  };
  const click = event => {
    const target = event.target.closest('button');
    if (disposed || !target || !root.contains(target) || target.disabled) return;
    if (target.dataset.layout) {
      if (layout !== target.dataset.layout) { retire(); layout = target.dataset.layout; renderEntry(); }
      return;
    }
    if (target.dataset.kind) {
      const kind = target.dataset.kind;
      afterLocalHide(find('[data-tray]'), () => {
        retire(); const ticket = owner.begin(kind); start(kind, ticket); return ticket?.generation;
      }, () => kind === 'photo' ? find('[data-action="deliver"]') : currentOpener());
      return;
    }
    if (target.dataset.select) { retire(); const ticket = owner.begin(target.dataset.select); selection = ticket ? { kind: ticket.kind, ticket } : null; syncSelection(); return; }
    switch (target.dataset.action) {
      case 'toggle-tray': {
        const open = find('[data-tray]').hidden; retire();
        find('[data-tray]').hidden = !open; target.setAttribute('aria-expanded', String(open));
        if (open) find('[data-kind]').focus(); break;
      }
      case 'close-tray': retire(); find('[data-action="toggle-tray"]').focus(); break;
      case 'confirm': { const selected = selection; selection = null; if (selected) start(selected.kind, selected.ticket); syncSelection(); break; }
      case 'clear-search': { const input = find('[data-search]'); input.value = ''; filter(); input.focus(); break; }
      case 'deliver': {
        afterLocalHide(find('[data-delivery]'), () => {
          const delivery = pending, expected = owner.snapshot().generation; pending = null;
          if (delivery) owner.complete(delivery.ticket, delivery.item); update(); return expected;
        }, currentOpener); break;
      }
      case 'cancel-delivery': {
        afterLocalHide(find('[data-delivery]'), () => {
          const delivery = pending; pending = null; retire(); const expected = owner.snapshot().generation;
          if (delivery) owner.complete(delivery.ticket, delivery.item); update(); return expected;
        }, currentOpener); break;
      }
      case 'load-text': retire(); owner.loadText(); break;
      case 'pending': case 'unknown': retire(); owner.markOperation(target.dataset.action); break;
      case 'reset': retire(); if (owner.reset()) pending = null; update(); break;
    }
  };
  function filter() {
    retire(); const query = find('[data-search]').value.trim().toLocaleLowerCase();
    entry.querySelectorAll('[data-select]').forEach(node => { node.hidden = !node.textContent.toLocaleLowerCase().includes(query); });
    entry.querySelectorAll('[data-group]').forEach(node => { node.hidden = ![...node.querySelectorAll('[data-select]')].some(button => !button.hidden); });
    find('[data-empty]').hidden = [...entry.querySelectorAll('[data-select]')].some(node => !node.hidden);
  }
  const input = event => { if (event.target.matches('[data-search]')) filter(); };
  const change = event => {
    if (!event.target.matches('[data-context-select]')) return;
    retire();
    const value = event.target.value;
    owner.setContext({ scope: value === 'private-B' ? 'synthetic-child-B' : 'synthetic-child-A', private: value !== 'shared', path: value === 'away' ? '/care' : '/' });
  };
  const keydown = event => {
    if (event.key !== 'Escape' || !entry.contains(event.target)) return;
    const tray = find('[data-tray]'), wasOpen = tray && !tray.hidden;
    retire(); event.preventDefault();
    if (wasOpen) find('[data-action="toggle-tray"]').focus();
  };
  const hidden = () => { if (document.hidden) retire(); };
  const outside = event => { if (!root.contains(event.target)) retire(); };
  const win = document.defaultView;
  root.addEventListener('click', click); root.addEventListener('input', input); root.addEventListener('change', change); root.addEventListener('keydown', keydown);
  document.addEventListener('visibilitychange', hidden); document.addEventListener('pointerdown', outside); win.addEventListener('blur', retire);
  const unsubscribe = owner.subscribe(update);
  renderEntry();
  return {
    retire,
    dispose() {
      if (disposed) return;
      retire(); disposed = true; unsubscribe();
      root.removeEventListener('click', click); root.removeEventListener('input', input); root.removeEventListener('change', change); root.removeEventListener('keydown', keydown);
      document.removeEventListener('visibilitychange', hidden); document.removeEventListener('pointerdown', outside); win.removeEventListener('blur', retire);
      owner.dispose(); pending = null;
    },
  };
}

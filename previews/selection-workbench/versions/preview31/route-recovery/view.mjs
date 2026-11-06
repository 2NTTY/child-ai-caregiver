// Original DOM candidate. It does not mount React/Expo boundaries or product owners.
export function mountRecovery(document, host, authority) {
  let layout = 'card', intent = 'retry', expanded = false, alive = true, revision = 0;
  function node(tag, text, attrs = {}) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  }
  function button(text, action, callback, attrs = {}) {
    const n = node('button', text, { type: 'button', 'data-action': action, 'data-focus': action, ...attrs });
    n.addEventListener('click', () => { if (alive && n.isConnected && host.contains(n)) callback(); });
    return n;
  }
  function reference(s) {
    const box = node('div', undefined, { class: 'reference-slip' });
    box.append(node('p', '安全參考', { class: 'eyebrow' }), node('p', s.reference, { 'data-reference': '', class: 'reference' }), node('p', '只顯示錯誤類別與數字位置，不顯示原始訊息、網址或堆疊。此參考不會自動傳送。', { class: 'fine' }));
    return box;
  }
  function retry(s) {
    const n = button(s.phase === 'pending' ? '等待合成回覆…' : s.phase === 'rejected' ? '再次嘗試顯示' : '重新顯示頁面', 'retry', () => authority.requestRetry(), { class: 'primary', 'aria-disabled': s.phase === 'pending' });
    // aria-disabled keeps the current focus stable; authority owns actual admission.
    return n;
  }
  function heading(text) { return node('h2', text, { tabindex: '-1', 'data-focus': 'heading', id: 'recovery-heading' }); }
  function result(s) {
    const box = node('section', undefined, { class: 'result', 'aria-labelledby': 'recovery-heading' });
    const title = s.phase === 'loading' ? '正在開啟頁面…' : s.phase === 'complete' ? '合成 callback 已完成' : s.phase === 'home' ? '已記錄返回首頁意圖' : '返回示例未完成';
    if (s.phase === 'loading') box.setAttribute('role', 'status');
    box.append(node('span', s.phase === 'loading' ? 'LOADING' : 'LOCAL RECEIPT', { class: 'eyebrow' }), heading(title));
    box.append(node('p', s.phase === 'loading' ? '這是載入示例，沒有完成百分比，也沒有啟動重試。' : s.phase === 'home' ? '沒有真的離開這個頁面。這不是離頁守衛批准，也不能證明草稿或原收據仍在。' : s.phase === 'complete' ? '這只表示本機示例 callback 結束，不表示真實頁面或資料已恢復。' : '本機返回 callback 拒絕；沒有替你執行真實導航。'));
    return box;
  }
  function render() {
    if (!alive) return;
    const thisRevision = ++revision, s = authority.snapshot();
    const oldFocus = document.activeElement, hadFocus = host.contains(oldFocus);
    const key = hadFocus ? oldFocus.getAttribute('data-focus') : null;
    if (s.scope === 'root' && intent === 'home') intent = 'retry';
    const root = node('div', undefined, { class: 'recovery recovery-' + layout, 'data-layout': layout });
    if (['loading', 'home', 'home-rejected'].includes(s.phase) || (s.phase === 'complete' && layout === 'card')) root.append(result(s));
    else if (layout === 'card') {
      const card = node('section', undefined, { 'data-recovery-card': '', class: 'recovery-card', 'aria-labelledby': 'recovery-heading' });
      card.append(node('div', 'Ⅱ', { class: 'pause-mark', 'aria-hidden': 'true' }), node('p', s.scope === 'chat' ? 'CHAT VIEW · 聊天頁面' : 'APP VIEW · 全域頁面', { class: 'eyebrow' }), heading('頁面停了一下。'), node('p', '暫時未能顯示這個頁面。先試著重新顯示，再決定下一步。', { class: 'lead' }));
      const actions = node('div', undefined, { class: 'actions' }); actions.append(retry(s));
      if (s.scope === 'chat') actions.append(button('返回首頁示例', 'home', () => authority.returnHome(), { class: 'secondary' }));
      card.append(actions, node('p', s.phase === 'rejected' ? '這次合成重試沒有完成，你可以再試一次。' : s.phase === 'pending' ? '同一個合成重試正在等待；切換版式不會另開一次。' : '重新顯示不等於原操作查核；草稿與收據的存續仍需原系統確認。', { class: 'outcome', role: 'status' }));
      card.append(button(expanded ? '收起故障參考' : '查看故障參考', 'details', () => { expanded = !expanded; render(); }, { class: 'text-button', 'aria-expanded': expanded, 'aria-controls': 'safe-reference-panel' }));
      const detail = node('div', undefined, { id: 'safe-reference-panel' }); detail.hidden = !expanded; detail.append(reference(s)); card.append(detail); root.append(card);
    } else {
      const index = node('nav', undefined, { 'data-intent-index': '', class: 'intent-index', 'aria-label': '恢復意圖' });
      index.append(node('p', 'RECOVERY DESK', { class: 'eyebrow' }), node('p', '你想先做哪一步？', { class: 'index-title' }));
      const choices = [['retry', '01', '重新顯示'], ...(s.scope === 'chat' ? [['home', '02', '返回首頁']] : []), ['reference', s.scope === 'chat' ? '03' : '02', '閱讀故障參考']];
      for (const [id, num, label] of choices) {
        const n = button(num + '  ' + label, 'intent-' + id, () => { intent = id; render(); }, { 'data-intent': id, 'aria-pressed': intent === id, class: 'intent-button' });
        index.append(n);
      }
      index.append(node('p', s.scope === 'chat' ? '範圍：聊天頁面' : '範圍：全域頁面', { class: 'scope-label' }));
      const panel = node('section', undefined, { 'data-intent-panel': intent, class: 'intent-panel', 'aria-labelledby': 'recovery-heading' });
      panel.append(node('p', '暫時未能顯示頁面', { class: 'eyebrow' }));
      // Completion is a receipt, not permission to replace the current B intent.
      if (s.phase === 'complete' && intent !== 'retry') panel.append(node('p', '合成 callback 已完成；仍保留目前選擇。這不代表產品或資料已恢復。', { class: 'outcome', role: 'status' }));
      if (intent === 'retry' && s.phase === 'complete') {
        panel.append(heading('合成 callback 已完成'), node('p', '這只表示本機示例 callback 結束，不表示真實頁面或資料已恢復。', { class: 'lead' }));
      } else if (intent === 'retry') {
        panel.append(heading('再給畫面一次機會'), node('p', '只請本機示例重新顯示。這個按鈕不負責查核原寫入，也不保證原 owner、草稿或收據仍然存續。', { class: 'lead' }), node('p', s.phase === 'rejected' ? '上一個合成 callback 拒絕。你可以重新嘗試。' : s.phase === 'pending' ? '同一個合成 callback 正在等待，不會因換版重開。' : '按下後，可在下方合成控制台選擇完成或拒絕。', { class: 'outcome', role: 'status' }), retry(s));
      } else if (intent === 'home') {
        panel.append(heading('先離開這個畫面'), node('p', '正式聊天 fallback 有返回首頁入口。本候選只記錄本機意圖，不執行 router.replace，也不模擬守衛批准。', { class: 'lead' }), node('p', '草稿、尚未確認的操作，以及原收據是否存續，必須另做真正故障層級驗收。', { class: 'fine' }), button('記錄返回首頁意圖', 'home', () => authority.returnHome(), { class: 'primary' }));
      } else {
        panel.append(heading('留下可讀的故障線索'), node('p', '需要辨識錯誤時，只讀取這張安全參考。這裡沒有自動上報、複製或送出功能。', { class: 'lead' }), reference(s));
      }
      root.append(index, panel);
    }
    // Only restore current in-host focus. No saved-origin timer, no later second focus.
    if (!alive || thisRevision !== revision) return;
    host.replaceChildren(root);
    if (!alive || thisRevision !== revision || !hadFocus) return;
    const now = document.activeElement;
    if (now !== document.body && now !== document.documentElement && now !== oldFocus) return;
    const target = [...host.querySelectorAll('[data-focus]')].find(n => n.getAttribute('data-focus') === key) ?? host.querySelector('[data-focus="heading"]');
    if (target && target.isConnected && host.contains(target)) target.focus({ preventScroll: true });
  }
  const unsubscribe = authority.subscribe(render); render();
  return {
    setLayout(next) { if (!alive || !['card', 'navigator'].includes(next)) return; layout = next; render(); },
    selectIntent(next) { if (!alive || !['retry', 'home', 'reference'].includes(next)) return; intent = next; render(); },
    dispose() { if (!alive) return; alive = false; revision++; unsubscribe(); },
  };
}

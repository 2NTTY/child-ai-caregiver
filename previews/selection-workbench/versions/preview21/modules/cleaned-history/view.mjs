import { readState, dateInfo, visibleRows, groupRows, countText, stateText, lockReasonText } from './model.mjs';
const create = (doc, tag, className, text) => { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const focus = node => { node?.focus(); node?.scrollIntoView?.({ block: 'nearest' }); };
/** Presentation port: getSnapshot/subscribe plus exactly two read intents. */
export function mountHistory(root, port) {
  const doc = root.ownerDocument;
  root.innerHTML = `<section class="history" data-history data-layout="ledger" aria-labelledby="history-title">
    <header class="hero"><div class="hero-copy"><p class="eyebrow">TI01 / ORIGINAL EXPLORATION</p><h1 id="history-title">已清理<br class="hero-break">上載紀錄</h1><p class="hero-intro">留下參考，讓每一次交接有跡可循。</p></div><div class="hero-seal" aria-hidden="true"><span>READ<br>ONLY</span><b>01</b></div></header>
    <div class="boundary"><span class="synthetic-label">原創合成探索</span><p>僅供比較閱讀方式。原檔已清理，這裡只保留合成參考與紀錄狀態，不能再次匯入。</p><p class="small">不是暫存資料包，也不是匯入來源版本歷史。尚未接入正式帳戶或 API。</p></div>
    <div class="workspace-tools"><div class="layout-chooser" role="group" aria-label="閱讀布局"><button type="button" data-layout="ledger" aria-pressed="true"><span class="mode-number" aria-hidden="true">A</span> 案卷索引</button><button type="button" data-layout="signal" aria-pressed="false"><span class="mode-number" aria-hidden="true">B</span> 訊號檢索</button></div><p data-layout-note class="layout-note"></p></div>
    <div class="find-tools"><div class="search-field"><label for="history-search">搜尋檔名或原上載參考</label><input id="history-search" data-search type="search" autocomplete="off" aria-describedby="search-scope" placeholder="例如：雨後、syn-cln"><p id="search-scope" class="small">只搜尋已讀紀錄的檔名與參考，不搜尋未讀頁、雜湊或檔案內容。</p></div><div class="filter-field"><label for="history-filter">紀錄狀態</label><select id="history-filter" data-filter><option value="all">所有已讀狀態</option><option value="failed">上載失敗</option><option value="expired">已到期</option><option value="cancelled">已取消</option><option value="ready">曾達 ready</option><option value="reserved">曾預留</option><option value="receiving">曾接收或驗證中</option></select></div><button class="quiet" type="button" data-clear>清除篩選</button></div>
    <section class="results" aria-labelledby="history-results"><header class="result-header"><div><p class="eyebrow" aria-hidden="true">REFERENCE INDEX</p><h2 id="history-results" data-results-heading tabindex="-1">紀錄索引</h2><p data-count class="small"></p></div><div class="read-actions"><button type="button" data-read aria-describedby="read-availability">讀取／重讀紀錄</button><button type="button" data-more aria-describedby="read-availability page-condition">讀取更多</button></div></header><p id="read-availability" data-availability class="availability"></p><p id="page-condition" data-page-condition class="small"></p><div data-status class="read-status" role="status" aria-live="polite" aria-atomic="true"></div><p data-filter-status class="filter-status" role="status" aria-live="polite"></p><div class="read-workspace" data-workspace><div data-groups class="record-groups"></div><div data-reader-home class="reader-home"></div></div></section>
    <footer class="module-footer"><span>合成資料 · 唯讀探索</span><span>日期以香港時間顯示；日期未明不推定為已到期。</span></footer>
  </section>`;
  const q = selector => root.querySelector(selector), groups = q('[data-groups]'), workspace = q('[data-workspace]'), readerHome = q('[data-reader-home]');
  let snapshot = port.getSnapshot(), binding = snapshot.bindingKey, layout = 'ledger', query = '', filter = 'all', selectedId = null, disposed = false;
  const findButton = id => [...groups.querySelectorAll('[data-inspect]')].find(node => node.dataset.inspect === id);
  function closeDetail() { const id = selectedId; selectedId = null; render(); focus(findButton(id)); }
  function detail(row) {
    const section = create(doc, 'section', 'record-reader'); section.dataset.reader = ''; section.id = 'history-record-detail'; section.setAttribute('aria-labelledby', 'history-record-title');
    const top = create(doc, 'div', 'reader-top'); top.append(create(doc, 'span', 'eyebrow', 'REFERENCE / 合成欄位'));
    const close = create(doc, 'button', 'quiet', '收起欄位'); close.type = 'button'; close.dataset.closeDetail = ''; close.dataset.focus = `close:${row.id}`; close.addEventListener('click', closeDetail); top.append(close); section.append(top);
    const title = create(doc, 'h3', '', row.filename); title.id = 'history-record-title'; title.tabIndex = -1; title.dataset.detailHeading = ''; title.dataset.focus = `detail:${row.id}`; section.append(title);
    section.append(create(doc, 'p', 'reader-warning', '原檔已清理。以下是合成紀錄欄位，不是可用的資料包或匯入成功收據。'));
    const list = create(doc, 'dl', 'field-list');
    for (const [label, value] of [['原上載參考', row.id], ['上載日期（香港）', dateInfo(row.createdAt).label], ['原暫存期限（香港）', dateInfo(row.expiresAt).label], ['紀錄狀態', `已清理 · ${stateText(row.state)}`], ['已記錄的失敗原因', row.error || '未記錄失敗原因']]) { const pair = create(doc, 'div', 'field-pair'); pair.append(create(doc, 'dt', '', label), create(doc, 'dd', '', value)); list.append(pair); }
    section.append(list);
    if (row.state === 'failed') section.append(create(doc, 'p', 'failure-note', '此筆上載失敗，沒有可核對的包身份，不能當作已核實內容。'));
    const hash = create(doc, 'div', 'hash-note'); hash.append(create(doc, 'h4', '', '預期 SHA-256'));
    if (typeof row.expectedArchiveSha256 === 'string') { const value = create(doc, 'p', 'hash-value', row.expectedArchiveSha256); value.dataset.hash = ''; hash.append(value); } else hash.append(create(doc, 'p', '', '未提供預期雜湊。'));
    hash.append(create(doc, 'p', 'small', '預期值不代表已核實內容或簽章；這個探索沒有進行驗證。')); section.append(hash);
    section.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeDetail(); } });
    return section;
  }
  function render() {
    if (disposed) return;
    const active = doc.activeElement, wasContent = groups.contains(active) || readerHome.contains(active), focusedKey = active?.dataset?.focus, beforeBinding = binding;
    snapshot = port.getSnapshot(); binding = snapshot.bindingKey;
    if (beforeBinding !== binding) { selectedId = null; query = ''; filter = 'all'; q('[data-search]').value = ''; q('[data-filter]').value = 'all'; }
    const rows = visibleRows(snapshot.items, query, filter);
    if (selectedId && !rows.some(row => row.id === selectedId)) selectedId = null;
    q('[data-history]').dataset.layout = layout;
    q('[data-layout-note]').textContent = layout === 'ledger' ? '按上載月份順讀，在原位置展開欄位。' : '按紀錄狀態檢索，集中查看一筆參考。';
    root.querySelectorAll('button[data-layout]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.layout === layout)));
    q('[data-read]').setAttribute('aria-disabled', String(!snapshot.readAvailability.canRead)); q('[data-more]').setAttribute('aria-disabled', String(!snapshot.readAvailability.canReadMore));
    q('[data-availability]').textContent = snapshot.loading ? '正在讀取合成回應。控制保留焦點，重複按下不會另起讀取。' : snapshot.readAvailability.lockedReasons.length ? `${lockReasonText(snapshot.readAvailability.lockedReasons)}。目前不能讀取。` : '只讀取本頁內的合成資料，不連線到帳戶。';
    q('[data-page-condition]').textContent = snapshot.nextCursor ? '仍有下一頁；篩選只涵蓋已讀紀錄。' : snapshot.loaded ? '本次結果沒有下一頁，不表示已知歷史總數。' : '尚未取得分頁資訊。';
    q('[data-count]').textContent = countText(snapshot);
    const state = readState(snapshot), status = q('[data-status]'); status.dataset.state = state;
    const error = snapshot.error ? `${snapshot.error.status ? `HTTP ${snapshot.error.status}` : '連線或回應未能確認'} · ${snapshot.error.code}` : '';
    const states = { unread: '尚未讀取紀錄。可按「讀取／重讀紀錄」開始合成示範。', loading: '正在讀取合成紀錄，尚未有可閱讀結果。', refreshing: '正在讀取；先前已讀紀錄仍可查看，結果尚未更新。', error: `未能讀取（${error}）。這不代表沒有紀錄。`, 'stale-error': `未能讀取（${error}）。保留先前已讀紀錄；這不代表沒有紀錄，也不是最新結果。`, empty: '本次讀取未有紀錄，且沒有下一頁。', 'empty-page': '本頁未有紀錄，仍可讀取更多。不能由空頁推論沒有歷史。', ready: '目前顯示已讀合成紀錄。原檔不在這裡。' };
    status.textContent = states[state];
    q('[data-filter-status]').textContent = snapshot.items.length ? rows.length ? `符合目前條件 ${rows.length} 筆／已讀 ${snapshot.items.length} 筆` : '已讀紀錄中沒有符合項目。可清除篩選，或讀取更多。' : '';
    groups.replaceChildren(); readerHome.replaceChildren();
    workspace.classList.toggle('has-selection', !!selectedId);
    for (const group of groupRows(rows, layout)) {
      const section = create(doc, 'section', 'record-group'); const header = create(doc, 'h3', 'group-title'); header.append(create(doc, 'span', '', group.label), create(doc, 'span', 'group-count', `${group.items.length} 筆已讀`)); section.append(header);
      for (const row of group.items) {
        const article = create(doc, 'article', 'record'); article.dataset.rowId = row.id; if (row.id === selectedId) article.classList.add('selected');
        const index = create(doc, 'span', 'record-mark', layout === 'signal' ? '◆' : String(snapshot.items.indexOf(row) + 1).padStart(2, '0')); index.setAttribute('aria-hidden', 'true');
        const copy = create(doc, 'div', 'record-copy'); copy.append(create(doc, 'h4', 'record-name', row.filename), create(doc, 'p', 'record-meta', `上載 ${dateInfo(row.createdAt).label}${dateInfo(row.createdAt).known ? '（香港）' : ''}`), create(doc, 'p', 'record-reference', row.id), create(doc, 'p', 'record-state', `已清理 · ${stateText(row.state)}`));
        const inspect = create(doc, 'button', 'inspect', '查看欄位'); inspect.type = 'button'; inspect.dataset.inspect = row.id; inspect.dataset.focus = `inspect:${row.id}`; inspect.setAttribute('aria-label', `查看欄位：${row.filename}（${row.id}）`); inspect.setAttribute('aria-expanded', String(row.id === selectedId)); if (row.id === selectedId) inspect.setAttribute('aria-controls', 'history-record-detail');
        const observed = binding;
        inspect.addEventListener('click', () => { if (disposed || observed !== port.getSnapshot().bindingKey || !port.getSnapshot().items.some(item => item.id === row.id)) return; if (selectedId === row.id) { closeDetail(); return; } selectedId = row.id; render(); focus(q('[data-detail-heading]')); });
        article.append(index, copy, inspect);
        if (row.id === selectedId && layout === 'ledger') article.append(detail(row));
        section.append(article);
      }
      groups.append(section);
    }
    if (layout === 'signal') {
      const row = rows.find(item => item.id === selectedId);
      if (row) readerHome.append(detail(row));
      else { const placeholder = create(doc, 'div', 'reader-placeholder'); placeholder.append(create(doc, 'span', 'placeholder-orbit', '◎'), create(doc, 'h3', '', '選一筆，讀清楚'), create(doc, 'p', '', '從任一狀態區按「查看欄位」，在這裡比對日期、參考與預期雜湊。')); readerHome.append(placeholder); }
    }
    if (wasContent && !active.isConnected && (doc.activeElement === doc.body || doc.activeElement === active)) {
      const replacement = beforeBinding === binding && focusedKey ? [...root.querySelectorAll('[data-focus]')].find(node => node.dataset.focus === focusedKey) : null;
      (replacement || q('[data-results-heading]')).focus();
    }
  }
  q('[data-read]').addEventListener('click', () => { if (disposed || !snapshot.readAvailability.canRead) return; port.readCleanedHistory(snapshot.bindingKey); });
  q('[data-more]').addEventListener('click', () => { if (disposed || !snapshot.readAvailability.canReadMore) return; port.readMoreCleanedHistory(snapshot.bindingKey); });
  root.querySelectorAll('button[data-layout]').forEach(node => node.addEventListener('click', () => { layout = node.dataset.layout; render(); }));
  q('[data-search]').addEventListener('input', event => { query = event.target.value; render(); });
  q('[data-filter]').addEventListener('change', event => { filter = event.target.value; render(); });
  q('[data-clear]').addEventListener('click', () => { query = ''; filter = 'all'; q('[data-search]').value = ''; q('[data-filter]').value = 'all'; render(); });
  const unsubscribe = port.subscribe(render); render();
  return { getLocalState: () => ({ layout, query, filter, selectedId }), destroy() { disposed = true; unsubscribe(); root.replaceChildren(); } };
}
/** This lab is separate from the renderer port. All operations affect memory-only fixtures. */
export function mountHarness(root, host) {
  root.innerHTML = `<details class="fixture-lab"><summary>合成情境實驗室 <span>只改本頁示例</span></summary><div class="lab-content"><p>以下控制模擬讀取邊界，不是正式帳戶、操作收據或產品權限。</p><div class="lab-fields"><div><label for="fixture-scenario">讀取情境</label><select id="fixture-scenario" data-scenario><option value="normal">正常分頁（含同名及日期未明）</option><option value="unread">尚未讀取</option><option value="empty">本次空結果</option><option value="empty-page">空頁但仍有下一頁</option><option value="first-error">首次讀取 503</option><option value="reload-error">重讀 503，保留舊頁</option><option value="more-error">更多 503，保留舊頁</option><option value="forbidden">讀取 403，清除舊頁</option></select></div><div><label for="fixture-gate">合成讀取條件</label><select id="fixture-gate" data-gate><option value="ready">可讀取</option><option value="offline">離線</option><option value="importer-offline">匯入連線未就緒</option><option value="identity">身份未就緒</option><option value="account-not-ready">帳戶尚未就緒</option><option value="import-busy">匯入忙碌</option><option value="pending">原操作結果未確認</option><option value="account-busy">帳戶忙碌</option><option value="deletion">帳戶處理中</option></select></div></div><label class="hold-label"><input data-held type="checkbox"> 暫停自動合成回應，手動完成</label><div class="lab-actions"><button type="button" data-settle>完成合成回應</button><button type="button" data-error="503">回應為 503</button><button type="button" data-error="403">回應為 403</button><button type="button" data-identity>切換合成身份世代</button><button type="button" data-late>送回舊合成回應</button></div><p data-lab-status class="small" role="status" aria-live="polite"></p><p class="small">布局切換不改身份、不重讀。情境或身份切換會清除選取；舊回應不應帶回舊內容。</p></div></details>`;
  const q = selector => root.querySelector(selector);
  function render() { const h = host.getHarnessSnapshot(); q('[data-scenario]').value = h.scenario; q('[data-gate]').value = h.gate; q('[data-held]').checked = h.held; root.querySelectorAll('[data-settle],[data-error]').forEach(node => node.setAttribute('aria-disabled', String(!h.pending))); q('[data-late]').setAttribute('aria-disabled', String(!h.lastDiscarded)); q('[data-lab-status]').textContent = `合成世代 ${h.epoch} · 接納讀取 ${h.accepted} 次 · 等候 ${h.pending ? 1 : 0} 個回應 · 拒收過期回應 ${h.ignored} 次。這不是服務端成功次數。`; }
  q('[data-scenario]').addEventListener('change', event => host.setScenario(event.target.value)); q('[data-gate]').addEventListener('change', event => host.setGate(event.target.value)); q('[data-held]').addEventListener('change', event => host.setHeld(event.target.checked));
  q('[data-settle]').addEventListener('click', () => { const token = host.getHarnessSnapshot().pending; if (token) host.complete(token); });
  root.querySelectorAll('[data-error]').forEach(node => node.addEventListener('click', () => { const token = host.getHarnessSnapshot().pending; if (token) host.complete(token, { error: { status: Number(node.dataset.error), code: `synthetic_${node.dataset.error}` } }); }));
  q('[data-identity]').addEventListener('click', host.rotateIdentity); q('[data-late]').addEventListener('click', () => { if (host.getHarnessSnapshot().lastDiscarded) host.replayDiscarded(); });
  const unsubscribe = host.subscribe(render); render(); return { destroy() { unsubscribe(); root.replaceChildren(); } };
}

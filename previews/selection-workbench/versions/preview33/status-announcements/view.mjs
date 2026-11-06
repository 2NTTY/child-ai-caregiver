// Original UI adapter. Source-derived formulas and fixture authority live elsewhere.
import { channels, labels } from './fixture-owner.mjs';
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const priority = event => event.urgent ? '緊急 · assertive' : '一般 · polite';
const text = event => event.message || '目前沒有訊息';
export function mountWorkbench(document, host, owner) {
  let layout = 'context', selected = 'form', generation = owner.snapshot().generation;
  let renderedLayout = layout, renderedSource = selected, renderVersion = 0, disposed = false;
  const candidate = host.querySelector('#candidate');
  function field(state) {
    const error = state.entries[0];
    return `<div class="demo-field"><label for="synthetic-title">合成主題標題</label><input id="synthetic-title" data-field="title" maxlength="80" value="${esc(state.field)}" ${error ? 'aria-invalid="true"' : ''} aria-describedby="field-hint${error ? ' field-error' : ''}"><p id="field-hint" class="small">僅在這頁保留，不會保存或傳送。</p>${error ? `<p id="field-error" class="field-error">${esc(error.message)}</p><button type="button" class="text-button" data-focus-field="title">修正主題標題 ↗</button>` : ''}</div>`;
  }
  function accepted(state, channel) {
    const event = state.accepted[channel];
    return `<div class="accepted"><span class="small">已接受的播報內容 · ${esc(priority(event))}</span><p>${event.message ? esc(event.message) : '靜默，尚未接到新事件'}</p></div>`;
  }
  function card(state, channel) {
    const event = state.events[channel];
    const hidden = channel === 'operation' && !state.operationVisible;
    return `<section class="context-card ${event.urgent ? 'attention' : ''}" data-context-card="${channel}" aria-labelledby="heading-${channel}"><div class="card-top"><span class="card-number">${String(channels.indexOf(channel) + 1).padStart(2, '0')}</span><span class="priority">${esc(priority(event))}</span></div><h2 id="heading-${channel}">${labels[channel]}</h2><p class="current-message">${hidden ? '操作卡的可見訊息已隱藏' : esc(text(event))}</p>${hidden ? '<p class="small">原 caller 的 visible 不控制公告；新事件仍可更新下方播報投射。</p>' : ''}${channel === 'form' ? field(state) : channel === 'read' ? '<div class="placeholder-lines" aria-hidden="true"><i></i><i></i><i></i></div><p class="small">示例只呈現讀取訊息，不判斷舊資料是否仍可安全使用。</p>' : '<p class="reference">參考：DEMO-01 · 合成操作</p><p class="small">未知結果不等於失敗，也不會觸發重送。</p>'}${accepted(state, channel)}</section>`;
  }
  function review(state) {
    const event = state.events[selected];
    return `<section class="review-shell" aria-label="事件核對台"><nav class="source-index" data-source-index aria-label="選擇事件來源"><p class="eyebrow">從哪裡來？</p>${channels.map(channel => `<button type="button" data-source="${channel}" aria-pressed="${selected === channel}"><span>${labels[channel]}</span><small>${esc(priority(state.events[channel]))}</small></button>`).join('')}<p class="small">依來源檢視，沒有改變播報順序。</p></nav><div class="review-detail"><p class="eyebrow">當前來源 / ${labels[selected]}</p><h2>${labels[selected]}</h2><span class="priority">caller 輸入：${esc(priority(event))}</span><p class="review-message">${selected === 'operation' && !state.operationVisible ? '可見訊息已隱藏；播報契約保持獨立。' : esc(text(event))}</p>${selected === 'form' ? field(state) : ''}${accepted(state, selected)}<details class="event-key"><summary>查看當前 eventKey</summary><p>${esc(event.eventKey || '（空字串）')}</p><p class="small">只有 key 改變才接受新訊息。這是診斷文字，不是保存回執。</p></details></div></section><section class="event-history" data-event-history aria-labelledby="history-heading"><div class="section-heading"><h2 id="history-heading">剛才的變化</h2><p>最多六筆，只供回看，不是待播佇列。</p></div>${state.history.length ? `<ol>${state.history.map(item => `<li><span class="history-source">${labels[item.channel]}</span><p>${esc(item.message || '清空訊息')}</p><small>${esc(priority(item))}</small></li>`).join('')}</ol>` : '<p class="empty-history">還沒有新的事件。初次開頁的快照不會加入紀錄。</p>'}</section>`;
  }
  function render(state) {
    if (disposed) return;
    const version = ++renderVersion, nextLayout = layout, nextSource = selected;
    const current = () => !disposed && version === renderVersion && owner.token() === state.generation && layout === nextLayout && selected === nextSource;
    const sameScope = generation === state.generation;
    const sameView = sameScope && renderedLayout === layout && (layout !== 'review' || renderedSource === selected);
    const active = document.activeElement;
    const inside = candidate.contains(active);
    const focusField = sameView && inside ? active?.dataset?.field : null;
    const focusSource = sameScope && renderedLayout === layout && inside ? active?.dataset?.source : null;
    const focusCorrection = sameView && inside ? active?.dataset?.focusField : null;
    const focusSummary = sameView && inside && active.matches('.event-key > summary');
    const disclosureOpen = sameView && candidate.querySelector('.event-key')?.open;
    const selection = focusField ? [active.selectionStart, active.selectionEnd] : null;
    generation = state.generation; renderedLayout = layout; renderedSource = selected;
    host.dataset.layout = layout;
    candidate.innerHTML = layout === 'context' ? `<div class="context-grid">${channels.map(channel => card(state, channel)).join('')}</div>` : review(state);
    if (!current()) return;
    if (disclosureOpen) candidate.querySelector('.event-key').open = true;
    for (const button of host.querySelectorAll('[data-layout]')) button.setAttribute('aria-pressed', String(button.dataset.layout === layout));
    host.querySelector('#layout-note').textContent = layout === 'context' ? '三張工作卡，提示跟著內容走。' : '來源索引 → 單一檢視 → 有限紀錄。';
    host.querySelector('[data-lifecycle="mount"]').textContent = state.mounted ? '卸載播報區' : '重新掛載播報區';
    host.querySelector('#lifecycle-note').textContent = `合成範圍 ${state.generation} · 播報區${state.mounted ? '已掛載' : '已卸載'}`;
    // Preserve only the applicable reading control, never an old caller/layout or outside focus.
    const selector = focusField ? `[data-field="${focusField}"]` : focusSource ? `[data-source="${focusSource}"]` : focusCorrection ? `[data-focus-field="${focusCorrection}"]` : focusSummary ? '.event-key > summary' : null;
    const replacement = selector && candidate.querySelector(selector);
    if (replacement && current()) {
      replacement.focus();
      // Focus handlers may synchronously render a new intent or dispose this view.
      if (selection && current() && document.activeElement === replacement && replacement.isConnected) replacement.setSelectionRange(...selection);
    }
  }
  function click(event) {
    const button = event.target.closest('button');
    if (!button || !host.contains(button)) return;
    if (button.dataset.layout) { layout = button.dataset.layout; render(owner.snapshot()); }
    else if (button.dataset.source) { selected = button.dataset.source; render(owner.snapshot()); }
    else if (button.dataset.action) owner.dispatch(button.dataset.action);
    else if (button.dataset.lifecycle === 'mount') owner.setMounted(!owner.snapshot().mounted);
    else if (button.dataset.lifecycle === 'scope') owner.replaceScope();
    else if (button.dataset.focusField === 'title') candidate.querySelector('[data-field="title"]')?.focus();
  }
  function input(event) { if (event.target.matches('[data-field="title"]')) owner.setField(event.target.value); }
  host.addEventListener('click', click); host.addEventListener('input', input);
  const unsubscribe = owner.subscribe(render);
  render(owner.snapshot());
  return { dispose() { disposed = true; renderVersion++; unsubscribe(); host.removeEventListener('click', click); host.removeEventListener('input', input); } };
}

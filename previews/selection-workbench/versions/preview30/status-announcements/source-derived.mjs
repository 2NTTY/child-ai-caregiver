// Hand-transcribed presentation formulas from the four pinned TSX components.
// See sources.md. This is not execution of React Native or an authoritative owner.
export function createEventGate(initialKey) {
  let previous = initialKey;
  let accepted = { message: '', urgent: false, revision: 0 };
  return {
    update({ eventKey, message, urgent = false }) {
      if (previous === eventKey) return false;
      previous = eventKey;
      accepted = { message, urgent, revision: accepted.revision + 1 };
      return true;
    },
    snapshot() { return { ...accepted }; },
  };
}
export function formEvent(entries) {
  const message = entries.length ? `有 ${entries.length} 項資料需要修正。${entries.map(item => `${item.label}：${item.message}`).join(' ')}` : '';
  return { eventKey: message, message, urgent: true };
}
export function readEvent({ state, title, message = '', refreshing = false, scopeKey }, delayedScope = null) {
  const loadingKey = scopeKey ?? 'read';
  const loading = state === 'loading' && !refreshing;
  const visible = state !== 'ready' && (state !== 'loading' || loading && delayedScope === loadingKey);
  const label = { ready: '資料讀取完成', loading: '正在讀取…', empty: '目前沒有資料', error: '暫時無法讀取', stale: '目前顯示較早資料', unavailable: '暫時無法顯示' }[state];
  const heading = title || message || label;
  const detail = state !== 'loading' && title && message && title !== message ? message : '';
  const announcement = visible ? [heading, detail].filter(Boolean).join('。') : '';
  return { eventKey: announcement ? `${state}:${announcement}` : 'quiet', message: announcement, urgent: state === 'error' };
}
export function operationEvent({ state, title, message, referenceLabel }) {
  const label = state === 'saved' ? '已保存' : state === 'failed' ? '操作失敗' : state === 'unknown' ? '結果未知' : state === 'conflict' ? '版本待核對' : state === 'needs_confirmation' ? '待確認' : state === 'saving' ? '處理中' : '提示';
  const announcement = state !== 'none' || message ? [title || label, message !== title ? message : ''].filter(Boolean).join('。') : '';
  return { eventKey: `${state}:${referenceLabel ?? ''}:${announcement}`, message: announcement, urgent: state === 'failed' };
}

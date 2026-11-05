/** Original presentation helpers. No API, clock-derived expiry, permissions or package body. */
export function readState(s) {
  if (s.error) return s.items.length ? 'stale-error' : 'error';
  if (s.loading) return s.items.length ? 'refreshing' : 'loading';
  if (!s.loaded) return 'unread';
  if (!s.items.length) return s.nextCursor ? 'empty-page' : 'empty';
  return 'ready';
}
export function dateInfo(value) {
  const unknown = { known: false, label: '日期未明', month: '日期未明' };
  if (typeof value !== 'string') return unknown;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate() || +m[4] > 23 || +m[5] > 59 || +m[6] > 59) return unknown;
  const ms = Date.parse(value); if (!Number.isFinite(ms)) return unknown;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { known: true, label: `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`, month: `${p.year}年${p.month}月` };
}
const states = Object.freeze({ failed: '上載失敗', expired: '已到期（紀錄狀態）', cancelled: '已取消', ready: '曾達 ready 狀態', reserved: '曾預留', receiving: '曾接收或驗證中' });
export function stateText(state) { return states[state] ?? `未識別狀態（${String(state)}）`; }
export function visibleRows(items, query = '', filter = 'all') {
  const term = query.trim().toLocaleLowerCase('zh-Hant');
  return items.filter(row => (filter === 'all' || row.state === filter) && (!term || `${row.filename}\n${row.id}`.toLocaleLowerCase('zh-Hant').includes(term)));
}
export function groupRows(items, layout) {
  const groups = new Map();
  for (const row of items) {
    const key = layout === 'signal' ? row.state : dateInfo(row.createdAt).month;
    if (!groups.has(key)) groups.set(key, { key, label: layout === 'signal' ? stateText(key) : key, items: [] });
    groups.get(key).items.push(row);
  }
  return [...groups.values()];
}
export function countText(s) {
  if (!s.loaded && !s.items.length) return '尚未讀取有效結果 · 總數未提供';
  return `已讀 ${s.items.length} 筆 · ${s.nextCursor ? '尚有下一頁' : '本次結果無下一頁'} · 總數未提供`;
}
const locks = { identity_not_current: '合成身份未就緒，舊內容已清除', account_not_ready: '合成帳戶尚未就緒，舊內容已清除', offline: '合成離線', importer_offline: '合成匯入連線未就緒', importer_busy: '合成匯入或讀取忙碌', importer_pending: '合成原操作結果未確認', account_busy: '合成帳戶忙碌', account_deletion: '合成帳戶處理中' };
export function lockReasonText(reasons) { return reasons.map(reason => locks[reason] ?? '讀取條件尚未確認').join('；'); }

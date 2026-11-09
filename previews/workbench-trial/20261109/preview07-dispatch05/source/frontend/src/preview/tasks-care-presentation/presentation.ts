/** Readonly display contracts. No domain owner, hooks, routes, callbacks or admission. */
export type CareButtonVariant = 'primary' | 'secondary' | 'quiet';
export type CareActionId = 'assistant' | 'create' | 'history' | 'previous' | 'next' | 'load-more';
export interface CareActionPresentation {
  readonly id: CareActionId;
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly variant: CareButtonVariant;
  readonly density: 'compact' | 'standard';
  /** Already includes the host's scene/access/occupancy restrictions. */
  readonly disabled: boolean;
}
export function describeCareHeader(access: 'editable' | 'read_only' | 'lost', disabled: boolean, showPanel: boolean): {
  readonly title: string; readonly actions: readonly CareActionPresentation[];
} {
  const actions: CareActionPresentation[] = [];
  if (access === 'editable') {
    actions.push({ id: 'assistant', label: '請助手安排', accessibilityLabel: '請助手安排', variant: 'secondary', density: 'compact', disabled });
    actions.push({ id: 'create', label: '手動新增', accessibilityLabel: '手動新增共享事項', variant: showPanel ? 'quiet' : 'primary', density: 'compact', disabled });
  }
  if (access !== 'lost') actions.push({ id: 'history', label: '歷史', accessibilityLabel: '事項歷史', variant: 'quiet', density: 'compact', disabled });
  return { title: '待辦與預約', actions };
}

export interface CareDateSection<T> {
  readonly id: string;
  readonly label: string;
  readonly items: readonly T[];
}
/** Suppress unavailable/empty groups only. Keep section/item references and order. */
export function visibleCareSections<T>(sections: readonly CareDateSection<T>[], readUnavailable: boolean): readonly CareDateSection<T>[] {
  return readUnavailable ? [] : sections.filter(section => section.items.length > 0);
}
export interface CarePaginationInput {
  readonly tab: 'pending' | 'completed';
  readonly page: number;
  readonly pageCount: number;
  readonly disabled: boolean;
}
export function describeCarePagination({ tab, page, pageCount, disabled }: CarePaginationInput): {
  readonly label: string; readonly previous: CareActionPresentation; readonly next: CareActionPresentation;
} | null {
  if (tab !== 'pending' || pageCount <= 1) return null;
  return {
    label: `第 ${page + 1}／${pageCount} 頁`,
    previous: { id: 'previous', label: '上一頁', accessibilityLabel: '已載入事項上一頁', variant: 'quiet', density: 'compact', disabled: disabled || page === 0 },
    next: { id: 'next', label: '下一頁', accessibilityLabel: '已載入事項下一頁', variant: 'quiet', density: 'compact', disabled: disabled || page >= pageCount - 1 },
  };
}
export interface CareLoadMoreInput {
  readonly hasMore: boolean;
  readonly loading: boolean;
  /** Host includes offline, operation, access and scene restrictions. */
  readonly disabled: boolean;
}
export function describeCareLoadMore({ hasMore, loading, disabled }: CareLoadMoreInput): {
  readonly notice: string; readonly action: CareActionPresentation;
} | null {
  if (!hasMore) return null;
  const label = loading ? '正在載入更多事項…' : '載入更多事項';
  return {
    notice: '仍有事項未載入；月曆、搜尋及數目只包括已載入事項。',
    action: { id: 'load-more', label, accessibilityLabel: label, variant: 'secondary', density: 'standard', disabled: disabled || loading },
  };
}

export type CareReadNoticeState = 'ready' | 'loading' | 'empty' | 'error' | 'stale' | 'unavailable';
export interface CareReadNoticeInput {
  readonly state: CareReadNoticeState;
  readonly title?: string;
  readonly message?: string;
  readonly headingLevel?: 2 | 3 | 4 | 5 | 6;
}
/** The host computes read state/message and visibility. This only resolves display copy. */
export function describeCareReadNotice({ state, title, message = '', headingLevel = 2 }: CareReadNoticeInput) {
  const label = { ready: '資料讀取完成', loading: '正在讀取…', empty: '目前沒有資料', error: '暫時無法讀取', stale: '目前顯示較早資料', unavailable: '暫時無法顯示' }[state];
  return {
    heading: title || message || label,
    detail: state !== 'loading' && title && message && title !== message ? message : '',
    headingRole: title ? 'header' as const : 'text' as const,
    headingLevel: title ? headingLevel : undefined,
  };
}

export type CareStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';
/** Source display mapping only; no TaskView import or task projection. */
export function describeCareStatus(state: 'scheduled' | 'needs_review' | 'completed' | 'cancelled', kind: 'ordinary' | 'appointment'): {
  readonly label: string; readonly tone: CareStatusTone;
} {
  if (state === 'needs_review') return { label: '待覆核 · 已停催', tone: 'warning' };
  if (state === 'completed') return { label: '已完成', tone: 'success' };
  return { label: state === 'scheduled' ? kind === 'appointment' ? '預約' : '待回報' : '已取消', tone: 'neutral' };
}
export interface CareRowDisplay {
  readonly id: string;
  readonly title: string;
  readonly time: string;
  readonly assignee: string;
  readonly statusLabel: string;
  readonly statusTone: CareStatusTone;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly role: 'button' | 'link';
  readonly toggleOnRepeat: boolean;
  readonly warning?: string | null;
}
/** Truthful host semantics, not an import of Care's Link or always-view hint. */
export function describeCareRow(row: CareRowDisplay) {
  const hint = row.selected && row.role === 'button' && row.toggleOnRepeat ? '再次點按關閉詳情' : '查看事項詳情';
  return {
    accessibilityRole: row.role,
    accessibilityLabel: `${hint}：${row.title}；${row.time}；${row.assignee}；${row.statusLabel}${row.warning ? `；${row.warning}` : ''}`,
    accessibilityState: { selected: row.selected, disabled: row.disabled },
    'aria-current': row.selected ? 'true' as const : undefined,
    'aria-disabled': row.disabled,
  };
}
export interface CareRowVisualState {
  readonly selected: boolean;
  readonly hovered: boolean;
  readonly pressed: boolean;
  readonly focused: boolean;
  readonly disabled: boolean;
}
export function careRowVisualLayers(state: CareRowVisualState): readonly ('selected' | 'highlight' | 'focused')[] {
  const layers: ('selected' | 'highlight' | 'focused')[] = [];
  if (state.selected) layers.push('selected');
  if ((state.hovered || state.pressed) && !state.disabled) layers.push('highlight');
  if (state.focused) layers.push('focused');
  return layers;
}

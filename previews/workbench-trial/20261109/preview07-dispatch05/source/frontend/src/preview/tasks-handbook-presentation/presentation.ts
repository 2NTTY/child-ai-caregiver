/** Pure display contracts only. No owner, callbacks, data projection or admission. */
export type HandbookActionId = 'create' | 'assistant' | 'history';
export interface HandbookHeaderAction {
  readonly id: HandbookActionId;
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly variant: 'primary' | 'secondary' | 'text-link';
  readonly disabled: boolean;
}
export function describeHandbookHeader(access: 'editable' | 'read_only' | 'lost', disabled: boolean): {
  title: string; actions: readonly HandbookHeaderAction[];
} {
  const actions: HandbookHeaderAction[] = [];
  if (access === 'editable') {
    actions.push({ id: 'create', label: '新增事項', accessibilityLabel: '手動新增共享事項', variant: 'primary', disabled });
    actions.push({ id: 'assistant', label: '請助手安排', accessibilityLabel: '請助手安排', variant: 'secondary', disabled });
  }
  if (access === 'editable' || access === 'read_only') {
    actions.push({ id: 'history', label: '事項歷史', accessibilityLabel: '事項歷史', variant: 'text-link', disabled });
  }
  return { title: '待辦與安排', actions };
}
export type HandbookStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';
/** Display values are resolved by the current host; no TaskView is reprojected here. */
export interface HandbookRowDisplay {
  readonly id: string;
  readonly title: string;
  readonly time: string;
  readonly assignee: string;
  readonly statusLabel: string;
  readonly statusTone: HandbookStatusTone;
  readonly review: boolean;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly role: 'button' | 'link';
  readonly toggleOnRepeat: boolean;
  readonly warning?: string | null;
}
export function describeHandbookRow(row: HandbookRowDisplay) {
  const hint = row.selected && row.role === 'button' && row.toggleOnRepeat ? '再次點按關閉詳情' : '查看事項詳情';
  return {
    accessibilityRole: row.role,
    accessibilityLabel: `${hint}：${row.title}；${row.time}；${row.assignee}；${row.statusLabel}${row.warning ? `；${row.warning}` : ''}`,
    accessibilityState: { selected: row.selected, disabled: row.disabled },
    'aria-current': row.selected ? 'true' as const : undefined,
    'aria-disabled': row.disabled,
    chevron: row.selected ? 'chevron-left' as const : 'chevron-right' as const,
  };
}
export interface HandbookDateSection<T> {
  readonly id: string;
  readonly label: string;
  readonly items: readonly T[];
}
/** Only suppress unavailable/empty groups. Never sort, group, filter or clone owner items. */
export function visibleHandbookSections<T>(sections: readonly HandbookDateSection<T>[], readUnavailable: boolean): readonly HandbookDateSection<T>[] {
  return readUnavailable ? [] : sections.filter(section => section.items.length > 0);
}
export interface HandbookRowVisualState {
  readonly review: boolean;
  readonly selected: boolean;
  readonly hovered: boolean;
  readonly focused: boolean;
  readonly pressed: boolean;
  readonly disabled: boolean;
}
export type HandbookRowVisualLayer = 'review' | 'highlight' | 'focused' | 'pressed' | 'selectedPressed';
export function handbookRowVisualLayers(state: HandbookRowVisualState): HandbookRowVisualLayer[] {
  const layers: HandbookRowVisualLayer[] = [];
  const highlighted = state.selected || state.hovered || state.focused;
  if (state.review) layers.push('review');
  if (highlighted) layers.push('highlight');
  if (state.focused) layers.push('focused');
  if (state.pressed && !state.disabled) layers.push(highlighted ? 'selectedPressed' : 'pressed');
  return layers;
}

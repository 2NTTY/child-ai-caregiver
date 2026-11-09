import type { OriginalDateSection, OriginalRowDisplay, OriginalRowVisualState, OriginalTab } from './contracts';
import { originalColors as colors } from './source-theme';
/** Keep owner order and object identity. Explicit heading level is the current
 * host's accessibility improvement over Original's unlevelled header role.
 */
export function describeOriginalGroups<T>(sections: readonly OriginalDateSection<T>[], readUnavailable: boolean, headingLevel: 2 | 3 | 4 | 5 | 6) {
  return readUnavailable ? [] : sections.filter(section=>section.items.length>0)
    .map(section=>({section,countLabel:`${section.items.length} 項`,headingRole:'header' as const,headingLevel}));
}
/** Display copy only after the host confirms readState === 'empty'. Never
 * infer empty/read/online state from tasks or replace stale snapshot authority.
 */
export function originalEmptyMessage(input: {readonly tab: OriginalTab; readonly noPendingTasks: boolean; readonly openCount: number; readonly hasMoreTasks: boolean}) {
  return input.tab==='pending'
    ? input.noPendingTasks?'暫無待辦':input.openCount===0&&input.hasMoreTasks?'已載入的事項中暫無待辦':'沒有符合篩選的事項'
    : input.hasMoreTasks?'已載入的事項中暫無已完成的事項':'暫無已完成的事項';
}
/** Notice/empty geometry and copy do not install the historical 500ms timer,
 * announcements, reload implementation, retry authority or recovery owner.
 */
export function describeOriginalRead(input: {
  readonly state: 'ready' | 'loading' | 'empty' | 'error' | 'stale' | 'unavailable';
  readonly message: string; readonly canReload: boolean; readonly reloadDisabled: boolean;
}) {
  return { state:input.state,message:input.message,
    surface:input.state==='ready'?null:input.state==='empty'?'host-empty-card' as const:'host-read-notice' as const,
    emptyIcon:input.state==='empty'?'clipboard-check-outline' as const:null,
    retry:(input.state==='error'||input.state==='stale')&&input.canReload
      ? {id:'reload',label:'重新讀取事項',variant:'secondary' as const,density:'compact' as const,disabled:input.reloadDisabled}:null,
  };
}
/** Source TasksView pagination and separate remote load-more presentation. */
export function describeOriginalListFooter(input: {
  readonly tab: OriginalTab; readonly page: number; readonly pageCount: number; readonly occupied: boolean;
  readonly hasMoreTasks: boolean; readonly loadingMoreTasks: boolean; readonly online: boolean;
}) {
  const {tab,page,pageCount,occupied,hasMoreTasks,loadingMoreTasks,online}=input;
  return {
    pagination:tab==='pending'&&pageCount>1?{
      label:`第 ${page+1}／${pageCount} 頁`,
      previous:{id:'previous-page',label:'上一頁',accessibilityLabel:'已載入事項上一頁',variant:'quiet' as const,density:'compact' as const,disabled:occupied||page===0},
      next:{id:'next-page',label:'下一頁',accessibilityLabel:'已載入事項下一頁',variant:'quiet' as const,density:'compact' as const,disabled:occupied||page>=pageCount-1},
    }:null,
    loadMore:hasMoreTasks?{
      placement:'outside-tab-panel' as const,
      note:'仍有事項未載入；月曆、搜尋及數目只包括已載入事項。',
      action:{id:'load-more',label:loadingMoreTasks?'正在載入更多事項…':'載入更多事項',variant:'secondary' as const,disabled:loadingMoreTasks||!online||occupied},
    }:null,
  };
}
/** Source TaskListRow content; deliberately adapted to the existing route action.
 * No history mode, local hover/focus, callback, Pressable, Link or toggle behavior.
 */
export function describeOriginalRow(row: OriginalRowDisplay) {
  return {
    id:row.id,title:row.title,warning:row.warning??null,
    interactiveShell:'existing-host-row' as const,
    leading:{name:row.kind==='appointment'?'calendar-clock-outline' as const:row.completed?'checkbox-marked' as const:'checkbox-blank-outline' as const,size:21,color:row.review?colors.warningInk:colors.muted,decorative:true},
    metadata:[{kind:'time' as const,text:row.time},{kind:'assignee' as const,text:row.assignee},{kind:'status' as const,text:row.statusLabel,tone:row.statusTone}],
    accessibilityRole:row.role,
    accessibilityLabel:`查看事項詳情：${row.title}；${row.time}；${row.assignee}；${row.statusLabel}${row.warning?`；${row.warning}`:''}`,
    accessibilityState:{selected:row.selected,disabled:row.disabled},
    'aria-current':row.selected?'true' as const:undefined,'aria-disabled':row.disabled,
    chevron:'chevron-right' as const,
  };
}
export function originalRowVisualLayers(state: OriginalRowVisualState) {
  const layers: ('review'|'highlight'|'focused'|'pressed'|'selectedPressed')[]=[];
  const highlighted=state.selected||state.hovered||state.focused;
  if(state.review)layers.push('review');
  if(highlighted)layers.push('highlight');
  if(state.focused)layers.push('focused');
  if(state.pressed&&!state.disabled)layers.push(highlighted?'selectedPressed':'pressed');
  return layers;
}

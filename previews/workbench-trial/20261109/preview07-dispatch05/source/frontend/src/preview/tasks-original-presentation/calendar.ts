import type { OriginalCalendarDay, OriginalCalendarMonth, OriginalTab, OriginalAction } from './contracts';
/** Two existing host measurements, never a window/zoom fallback. No element,
 * measurement hook, disclosure, MotionDetail or protected detail owner is created.
 */
export function describeOriginalLayout(input: {
  readonly containerWidth: number | null; readonly pageWidth: number | null;
  readonly tab: OriginalTab; readonly readUnavailable: boolean; readonly noPendingTasks: boolean; readonly showPanel: boolean;
}) {
  const containerMeasured=input.containerWidth!==null&&Number.isFinite(input.containerWidth)&&input.containerWidth>=0;
  const pageMeasured=input.pageWidth!==null&&Number.isFinite(input.pageWidth)&&input.pageWidth>=0;
  const wide=containerMeasured&&input.containerWidth!>=840;
  const compact=pageMeasured?input.pageWidth!<650:null;
  const pending=input.tab==='pending'&&!input.readUnavailable;
  const calendarPlacement=!containerMeasured||input.showPanel||!pending?'none' as const
    :wide?'aside' as const:!input.noPendingTasks?'inline' as const:'none' as const;
  const showAside=input.showPanel||(wide&&pending);
  return {
    wide,compact,measurementPending:!containerMeasured||!pageMeasured,
    calendarPlacement,calendarTriggerVisible:calendarPlacement==='inline',
    listVisible:wide||!input.showPanel,showAside,
    asideContent:input.showPanel?'protected-detail' as const:calendarPlacement==='aside'?'calendar' as const:null,
    pageInset:compact===null?null:compact?16:24,pageMaxWidth:1260,
    workspaceStyleKeys:showAside&&wide?['workspace','workspaceWide'] as const:['workspace'] as const,
    listColumnStyleKeys:showAside&&wide?['column','listColumn'] as const:['column'] as const,
    asideColumnStyleKeys:wide?['column','detailColumn'] as const:['column'] as const,
  };
}
/** Existing projected month/weeks are consumed by reference, never recomputed.
 * Date formatting, previous/next month calculation and day toggles remain host ports.
 */
export function describeOriginalCalendar(input: {
  readonly calendar: OriginalCalendarMonth; readonly selectedDay: string | null;
  readonly currentDayLabel: string | null; readonly disabled: boolean;
}) {
  const {calendar,selectedDay,currentDayLabel,disabled}=input;
  const actions: OriginalAction[]=[];
  if(selectedDay) actions.push({id:'clear-day',label:'取消日期篩選',accessibilityLabel:'只取消日期篩選，保留搜尋及原有範圍',variant:'quiet',density:'compact',disabled});
  if(calendar.currentDay&&currentDayLabel) actions.push({id:'current-month',label:`回到 ${currentDayLabel}`,accessibilityLabel:`回到資料基準日所在月份 ${calendar.currentDay}`,variant:'quiet',density:'compact',disabled});
  return {
    monthLabel:calendar.label,monthHeadingRole:'header' as const,monthLiveRegion:'polite' as const,
    monthActions:[{id:'previous-month',accessibilityLabel:'上一個月',disabled:disabled||!calendar.month},
      {id:'next-month',accessibilityLabel:'下一個月',disabled:disabled||!calendar.month}],
    weeks:calendar.weeks,weekdays:['一','二','三','四','五','六','日'] as const,
    invalidNotice:calendar.weeks.length?null:'未有有效的資料日期或時區，請先查看清單。',
    legend:[{dot:'scheduled',label:'待辦／預約'},{dot:'review',label:'待覆核'}] as const,
    actions,missingCurrentDayLabel:!!calendar.currentDay&&!currentDayLabel,
    warning:calendar.unconfirmedCount>0?`${calendar.unconfirmedCount} 項日期待核對，可從清單範圍選擇查看。`:null,
  };
}
/** Source taskCalendarDayLabel plus CalendarDay display. Existing calendar owner
 * already implements repeated-day cancellation; this does not execute that action.
 */
export function describeOriginalCalendarDay(input: {
  readonly day: OriginalCalendarDay; readonly current: boolean; readonly selected: boolean;
  readonly disabled: boolean; readonly focused: boolean; readonly pressed: boolean;
}) {
  const {day,current,selected,disabled,focused,pressed}=input;
  const counts=[day.scheduled?`${day.scheduled} 項待辦或預約`:'',day.review?`${day.review} 項待覆核`:''].filter(Boolean);
  const label=`${day.label}；${counts.length?`已載入 ${day.scheduled+day.review} 項：${counts.join('、')}`:'已載入資料未有安排'}`;
  const visualLayers: ('selectedDay'|'focused'|'disabled'|'selectedPressed'|'pressed')[]=[];
  if(selected)visualLayers.push('selectedDay');
  if(focused)visualLayers.push('focused');
  if(disabled)visualLayers.push('disabled');
  if(pressed&&!disabled)visualLayers.push(selected?'selectedPressed':'pressed');
  const dots: ('scheduled'|'review')[]=[];
  if(day.scheduled>0)dots.push('scheduled');if(day.review>0)dots.push('review');
  return {
    date:day.date,number:day.day,current,selected,disabled,visualLayers,dots,
    accessibilityRole:'button' as const,
    accessibilityLabel:`${label}${current?'；資料基準日':''}${selected?'；已選取，再按取消日期篩選':''}`,
    accessibilityState:{selected,disabled},'aria-pressed':selected,'aria-disabled':disabled,
  };
}

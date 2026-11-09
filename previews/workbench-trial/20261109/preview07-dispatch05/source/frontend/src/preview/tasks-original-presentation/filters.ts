import type { OriginalBacklogFilter, OriginalFiltersInput } from './contracts';
const ranges: readonly {key: OriginalBacklogFilter; label: string}[] = [
  {key:'near',label:'近期 7 天'},{key:'earlier',label:'較早未處理'},
  {key:'later',label:'之後'},{key:'all',label:'全部'},{key:'review',label:'待覆核'},{key:'unconfirmed',label:'時間待核對'},
];
const contextLabels = {near:'近期 7 天',earlier:'較早未處理',later:'之後',review:'待覆核',unconfirmed:'時間待核對',all:'全部日期'} as const;
/** Source TasksView:142–160. Six regions for one filters slot. No projection,
 * local filter state, date formatting, dialog, route, callback or focus authority.
 */
export function describeOriginalFilters(input: OriginalFiltersInput) {
  const {tab,occupied,readUnavailable,noPendingTasks,openCount,completedCount,hasMoreTasks,query,filter,selectedDay,selectedDayLabel,calendarOpen,calendarTriggerVisible,backlog}=input;
  const showPending = tab === 'pending' && !readUnavailable && !noPendingTasks;
  const reviewSelected = tab === 'pending' && filter === 'review';
  const dayLabel = selectedDayLabel;
  return {
    tabs: { label:'事項分類',value:tab,items:[
      {key:'pending',label:'待處理',count:readUnavailable?undefined:`${openCount}${hasMoreTasks?'+':''}`},
      {key:'completed',label:'已完成'},
    ],disabled:occupied },
    review: !readUnavailable && backlog.counts.review > 0 ? {
      id:'review',title:`${backlog.counts.review} 項待覆核${hasMoreTasks?'（已載入）':''}`,
      accessibilityLabel:`查看已載入的 ${backlog.counts.review} 項待覆核安排，已停止催辦`,
      note:reviewSelected?'返回近期安排':'完成或取消仍未確定 · 已停催',
      chevron:reviewSelected?'chevron-left' as const:'chevron-right' as const,disabled:occupied,
    }:null,
    completedNote: tab==='completed' && !readUnavailable && completedCount>0 ? hasMoreTasks
      ? '目前只按已載入資料顯示最近 10 項，載入更多後會重新排序。'
      : '只顯示最近 10 項；較早及已取消的安排可到事項歷史查看。' : null,
    search: showPending ? {
      query:{label:'搜尋已載入事項',accessibilityLabel:'搜尋已載入事項',placeholder:'標題、內容或負責人',value:query,disabled:occupied,
        clear:query?{id:'clear-query',accessibilityLabel:'清除搜尋',disabled:occupied}:null},
      range:{label:'範圍',value:selectedDay?'day':filter,disabled:occupied,
        options:[...(selectedDay?[{value:'day',label:dayLabel}]:[]),
          ...ranges.filter(item=>item.key!=='unconfirmed'||backlog.counts.unconfirmed>0||filter===item.key)
            .map(item=>({value:item.key,label:item.label,count:backlog.counts[item.key]}))]},
      dateTrigger:calendarTriggerVisible?{id:'toggle-calendar',label:selectedDay?'日期 · 已選':'日期',calendar:true,expanded:calendarOpen,disabled:occupied}:null,
      missingDayLabel:!!selectedDay && !dayLabel,
    }:null,
    context:showPending?{
      text:`${selectedDay?dayLabel??'':contextLabels[filter]}${!selectedDay&&filter==='near'&&backlog.nearLabel?` · ${backlog.nearLabel}`:''}${query.trim()?' · 搜尋結果':''} · 已載入 ${backlog.total} 項${backlog.total>0?`，顯示 ${backlog.from}–${backlog.to}`:''}`,
      liveRegion:'polite' as const,
      earlier:backlog.counts.earlier>0&&filter!=='earlier'?{id:'earlier',label:`較早未處理 ${backlog.counts.earlier}`,accessibilityLabel:`查看已載入的 ${backlog.counts.earlier} 項較早未處理事項`,disabled:occupied}:null,
      clearDay:selectedDay?{id:'clear-day',label:'取消日期',accessibilityLabel:'只取消日期篩選',disabled:occupied}:null,
    }:null,
    // The existing host chooses the successful-empty branch; this does not create it.
    clear:showPending&&openCount>0?{id:'clear-filters',label:'清除篩選',variant:'quiet' as const,density:'compact' as const,disabled:occupied}:null,
  };
}

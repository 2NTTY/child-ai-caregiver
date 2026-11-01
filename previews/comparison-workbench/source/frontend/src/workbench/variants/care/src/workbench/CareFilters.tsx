// Exact Care source rendering; state/actions/recovery remain host-owned.
import type { CareSlotPorts } from './CareSlotPorts';
import { StyleSheet, View } from "react-native";
import { Text, TextInput } from "react-native-paper";
import { DateTime } from "luxon";
import { WorkspaceSwitch } from "../components/workspace/WorkspaceSwitch";
import { AppButton, AppSelect, AppSelectionTrigger, AppTextField, AppTabPanel } from "../components/ui";
import type { TaskBacklogFilter } from "../components/tasks/task-calendar";
import { chineseFont, colors, mobileLayout, readingType, spacing } from "../theme";
export function CareFilters({model,occupied,scopeKey,tabsId,tab,changeView,setQuery,anchor,readUnavailable,openCount,reviewCount,filter,completed,noPendingTasks,query,selectedDay,backlog,changeFilter,calendarOpen,setCalendarOpen,actions,dateList,mobileCalendar}: Pick<CareSlotPorts, 'model'|'occupied'|'scopeKey'|'tabsId'|'tab'|'changeView'|'setQuery'|'anchor'|'readUnavailable'|'openCount'|'reviewCount'|'filter'|'completed'|'noPendingTasks'|'query'|'selectedDay'|'backlog'|'changeFilter'|'calendarOpen'|'setCalendarOpen'|'actions'|'dateList'|'mobileCalendar'>) {
const backlogFilters: { key: TaskBacklogFilter; label: string }[] = [
  { key: "near", label: "近期 7 天" }, { key: "earlier", label: "較早未處理" },
  { key: "later", label: "之後" }, { key: "all", label: "全部" }, { key: "review", label: "待覆核" }, { key: "unconfirmed", label: "時間待核對" },
];
return <>
              <View testID="tasks-tab-toolbar"><WorkspaceSwitch id={tabsId} label="事項分類" items={[{ key: "pending", label: "待處理", description: "近期安排、預約與待回報事項", count: readUnavailable ? undefined : `${openCount}${model.hasMoreTasks ? "+" : ""}` }, { key: "completed", label: "已完成", description: "回看最近完成的安排" }]} value={tab} onChange={next => { if (occupied) return; setQuery(""); changeView({ tab: next, filter: "near", page: 0, day: null }, "push"); anchor.current = null; }} /></View>
              {!readUnavailable && reviewCount > 0 ? <View testID="tasks-review-shortcut" style={styles.reviewShortcut}><Text style={styles.reviewTitle}>{reviewCount} 項待覆核{model.hasMoreTasks ? "（已載入）" : ""} · 已停催</Text>
                <AppButton label={filter === "review" && tab === "pending" ? "返回近期安排" : "查看待覆核"} accessibilityLabel={`查看已載入的 ${reviewCount} 項待覆核安排，已停止催辦`} variant="quiet" disabled={occupied} onPress={() => { if (occupied) return; setQuery(""); changeView({ tab: "pending", filter: tab === "pending" && filter === "review" ? "near" : "review", day: null, page: 0 }, tab === "pending" ? "replace" : "push"); }} />
              </View> : null}
              {tab === "completed" && !readUnavailable && completed.length > 0 ? <Text style={styles.meta}>{model.hasMoreTasks ? "目前只按已載入資料顯示最近 10 項，載入更多後會重新排序。" : "只顯示最近 10 項；較早及已取消的安排可到事項歷史查看。"}</Text> : null}
              <AppTabPanel tabsId={tabsId} tabKey={tab} active>
              {tab === "pending" && !readUnavailable && !noPendingTasks ? <View style={styles.backlogToolbar}>
                <View style={styles.searchField}><AppTextField dense label="搜尋已載入事項" accessibilityLabel="搜尋已載入事項" placeholder="標題、內容或負責人…" value={query} disabled={occupied} right={query ? <TextInput.Icon icon="close" accessibilityLabel="清除搜尋" disabled={occupied} onPress={() => { if (!occupied) { anchor.current = null; setQuery(""); changeView({ page: 0 }); } }} /> : undefined} onChangeText={value => { if (occupied) return; anchor.current = null; setQuery(value); changeView({ page: 0 }); }} /></View>
                <AppSelect<TaskBacklogFilter | "day"> label="範圍" value={selectedDay ? "day" : filter} options={[
                  ...(selectedDay ? [{ value: "day" as const, label: DateTime.fromISO(selectedDay).toFormat("M月d日") }] : []),
                  ...backlogFilters.filter(item => item.key !== "unconfirmed" || backlog.counts.unconfirmed > 0 || filter === item.key).map(item => ({ value: item.key, label: item.label, count: backlog.counts[item.key] })),
                ]} disabled={occupied} onChange={value => { if (value !== "day") changeFilter(value); }} />
                <AppSelectionTrigger label={selectedDay ? "日期 · 已選" : "日期"} calendar expanded={calendarOpen} disabled={occupied} onPress={() => { if (!occupied) setCalendarOpen(open => !open); }} />
              </View> : null}
              {mobileCalendar}
              {dateList}
              </AppTabPanel>
              {model.hasMoreTasks ? <View style={styles.loadMore}><Text style={styles.meta}>仍有事項未載入；月曆、搜尋及數目只包括已載入事項。</Text><AppButton label={model.loadingMoreTasks ? "正在載入更多事項…" : "載入更多事項"} variant="secondary" disabled={model.loadingMoreTasks || !model.online || occupied} onPress={actions.loadMoreTasks} /></View> : null}
            </>;
}

const styles = StyleSheet.create({
reviewShortcut: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md, minHeight: 48, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderLeftWidth: 3, borderLeftColor: colors.statusWarmLine, backgroundColor: colors.paleAmber },
reviewTitle: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.body, fontWeight: "600" },
meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
backlogToolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md, minWidth: 0 },
searchField: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 160 },
loadMore: { gap: spacing.sm, alignItems: "flex-start" }
});

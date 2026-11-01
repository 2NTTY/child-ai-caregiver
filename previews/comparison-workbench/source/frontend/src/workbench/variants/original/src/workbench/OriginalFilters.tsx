// Derived from pinned Original TasksView; actual renderer, no task state/owner.
import type { TasksSlotPorts } from './TasksSlotPorts';
import { Pressable, StyleSheet, View } from "react-native";
import { Text, TextInput } from "react-native-paper";
import { DateTime } from "luxon";
import { MotionDisclosure } from "../motion";
import { AppIcon } from "../components/AppIcon";
import { AppButton, AppSelect, AppSelectionTrigger, AppTextField, UnderlineTabs, AppTabPanel, TabToolbar } from "../components/ui";
import type { TaskBacklogFilter } from "../components/tasks/task-calendar";
import { chineseFont, colors, spacing, mobileLayout, workspaceType, readingType } from "../theme";
export function OriginalFilters({model,occupied,compact,actionMenuOpen,setActionMenu,scopeKey,tabsId,tab,actions,setTab,setFilter,setQuery,setPage,setSelectedDay,anchor,readUnavailable,openCount,reviewCount,filter,completed,noPendingTasks,query,selectedDay,backlog,changeFilter,wide,calendarOpen,setCalendarOpen,pageActions,dateList,mobileCalendar}: Pick<TasksSlotPorts, 'model'|'occupied'|'compact'|'actionMenuOpen'|'setActionMenu'|'scopeKey'|'tabsId'|'tab'|'actions'|'setTab'|'setFilter'|'setQuery'|'setPage'|'setSelectedDay'|'anchor'|'readUnavailable'|'openCount'|'reviewCount'|'filter'|'completed'|'noPendingTasks'|'query'|'selectedDay'|'backlog'|'changeFilter'|'wide'|'calendarOpen'|'setCalendarOpen'|'pageActions'|'dateList'|'mobileCalendar'>) {
const backlogFilters: { key: TaskBacklogFilter; label: string }[] = [
  { key: "near", label: "近期 7 天" }, { key: "earlier", label: "較早未處理" },
  { key: "later", label: "之後" }, { key: "all", label: "全部" }, { key: "review", label: "待覆核" }, { key: "unconfirmed", label: "時間待核對" },
];
return <>
              <TabToolbar testID="tasks-tab-toolbar" actions={compact ? <AppButton label="操作" accessibilityLabel="待辦操作" variant="quiet" density="compact" expanded={actionMenuOpen} disabled={occupied} onPress={() => setActionMenu({ scope: scopeKey, open: !actionMenuOpen })} /> : pageActions}><UnderlineTabs id={tabsId} label="事項分類" items={[{ key: "pending", label: "待處理", count: readUnavailable ? undefined : `${openCount}${model.hasMoreTasks ? "+" : ""}` }, { key: "completed", label: "已完成" }]} value={tab} onChange={next => { if (occupied) return; actions.closePanel(); setTab(next); setFilter("near"); setQuery(""); setPage(0); setSelectedDay(null); anchor.current = null; }} /></TabToolbar>
              {compact ? <MotionDisclosure expanded={actionMenuOpen} scopeKey={scopeKey}><View testID="tasks-page-actions" style={styles.headerActions}>{pageActions}</View></MotionDisclosure> : null}
              {!readUnavailable && reviewCount > 0 ? <Pressable testID="tasks-review-shortcut" accessibilityRole="button" accessibilityLabel={`查看已載入的 ${reviewCount} 項待覆核安排，已停止催辦`} disabled={occupied} accessibilityState={{ disabled: occupied }} aria-disabled={occupied} onPress={() => { if (occupied) return; setTab("pending"); setQuery(""); changeFilter(tab === "pending" && filter === "review" ? "near" : "review"); }} style={({ pressed }) => [styles.reviewShortcut, pressed && !occupied && styles.reviewPressed]}><View style={styles.reviewCopy}><Text style={styles.reviewTitle}>{reviewCount} 項待覆核{model.hasMoreTasks ? "（已載入）" : ""}</Text><Text style={styles.reviewNote}>{filter === "review" && tab === "pending" ? "返回近期安排" : "完成或取消仍未確定 · 已停催"}</Text></View><AppIcon name={filter === "review" && tab === "pending" ? "chevron-left" : "chevron-right"} size={18} color={colors.warningInk} /></Pressable> : null}
              {tab === "completed" && !readUnavailable && completed.length > 0 ? <Text style={styles.meta}>{model.hasMoreTasks ? "目前只按已載入資料顯示最近 10 項，載入更多後會重新排序。" : "只顯示最近 10 項；較早及已取消的安排可到事項歷史查看。"}</Text> : null}
              <AppTabPanel tabsId={tabsId} tabKey={tab} active>
              {tab === "pending" && !readUnavailable && !noPendingTasks ? <View style={styles.backlogToolbar}>
                <View style={styles.searchField}><AppTextField dense label="搜尋已載入事項" accessibilityLabel="搜尋已載入事項" placeholder="標題、內容或負責人" value={query} disabled={occupied} right={query ? <TextInput.Icon icon="close" accessibilityLabel="清除搜尋" disabled={occupied} onPress={() => { if (!occupied) { anchor.current = null; actions.closePanel(); setQuery(""); setPage(0); } }} /> : undefined} onChangeText={value => { if (occupied) return; anchor.current = null; actions.closePanel(); setQuery(value); setPage(0); }} /></View>
                <AppSelect<TaskBacklogFilter | "day"> label="範圍" value={selectedDay ? "day" : filter} options={[
                  ...(selectedDay ? [{ value: "day" as const, label: DateTime.fromISO(selectedDay).toFormat("M月d日") }] : []),
                  ...backlogFilters.filter(item => item.key !== "unconfirmed" || backlog.counts.unconfirmed > 0 || filter === item.key).map(item => ({ value: item.key, label: item.label, count: backlog.counts[item.key] })),
                ]} disabled={occupied} onChange={value => { if (value !== "day") changeFilter(value); }} />
                {!wide ? <AppSelectionTrigger label={selectedDay ? "日期 · 已選" : "日期"} calendar expanded={calendarOpen} disabled={occupied} onPress={() => { if (!occupied) setCalendarOpen(open => !open); }} /> : null}
              </View> : null}
              {mobileCalendar}
              {dateList}
              </AppTabPanel>
              {model.hasMoreTasks ? <View style={styles.loadMore}><Text style={styles.meta}>仍有事項未載入；月曆、搜尋及數目只包括已載入事項。</Text><AppButton label={model.loadingMoreTasks ? "正在載入更多事項…" : "載入更多事項"} variant="secondary" disabled={model.loadingMoreTasks || !model.online || occupied} onPress={actions.loadMoreTasks} /></View> : null}
            </>;
}

const styles = StyleSheet.create({
headerActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
reviewShortcut: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderLeftWidth: 3, borderLeftColor: colors.statusWarmLine, backgroundColor: colors.paleAmber },
reviewPressed: { backgroundColor: colors.warningPressed },
reviewCopy: { flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: spacing.md, rowGap: spacing.xs },
reviewTitle: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool, fontWeight: "700" },
reviewNote: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.meta },
meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
backlogToolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md, minWidth: 0 },
searchField: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 160 },
loadMore: { gap: spacing.sm, alignItems: "flex-start" }
});

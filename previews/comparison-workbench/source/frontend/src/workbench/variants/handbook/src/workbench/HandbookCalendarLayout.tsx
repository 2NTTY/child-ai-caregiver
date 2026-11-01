// Exact Handbook JSX/styles; state, authority, refs and recovery remain in the host.
import type { HandbookTasksSlotPorts } from './HandbookTasksSlotPorts';
import { Platform, Pressable, StyleSheet, View, type ScrollView as NativeScrollView } from "react-native";
import { Text, TextInput } from "react-native-paper";
import { chineseFont, colors, mobileLayout, readingType, spacing } from "../theme";
import { MotionDetail, MotionDisclosure, MotionList } from "../motion";
import { TasksCalendar } from "../components/tasks/TasksCalendar";
export function HandbookCalendarLayout({wide,showAside,showPanel,scopeKey,listVisible,listRef,panelRef,model,pending,selectedDay,calendarMonth,occupied,selectCalendarDay,setCalendarMonth,tab,readUnavailable,noPendingTasks,calendarOpen,renderFilters,detailUnit}: Pick<HandbookTasksSlotPorts, 'wide'|'showAside'|'showPanel'|'scopeKey'|'listVisible'|'listRef'|'panelRef'|'model'|'pending'|'selectedDay'|'calendarMonth'|'occupied'|'selectCalendarDay'|'setCalendarMonth'|'tab'|'readUnavailable'|'noPendingTasks'|'calendarOpen'|'renderFilters'|'detailUnit'>) {
const calendar = <TasksCalendar items={pending} context={model.scheduleContext} selectedDay={selectedDay} month={calendarMonth} disabled={occupied}
    onSelectDay={selectCalendarDay} onChangeMonth={month => { if (!occupied) setCalendarMonth(month); }} />;
const mobileCalendar = tab === "pending" && !wide && !readUnavailable && !noPendingTasks ? <MotionDisclosure expanded={calendarOpen} scopeKey={scopeKey}><View style={styles.mobileCalendar}>{calendar}</View></MotionDisclosure> : null;
return <View testID="tasks-workspace" style={[styles.workspace, wide && showAside && styles.workspaceWide]}>
          <MotionDetail activeKey={showPanel ? "panel" : "list"} scopeKey={scopeKey} direction="back" compact={!wide && !showPanel} style={[styles.column, wide && showAside && styles.listColumn, !listVisible && styles.hidden]}>
            <View ref={listRef} tabIndex={-1} testID="tasks-list" style={styles.listSurface} pointerEvents={listVisible ? "auto" : "none"} aria-hidden={!listVisible} accessibilityElementsHidden={!listVisible} importantForAccessibility={listVisible ? "auto" : "no-hide-descendants"}>{renderFilters(mobileCalendar)}</View>
          </MotionDetail>
          {showAside ? <MotionDetail activeKey={showPanel ? model.selected?.id ?? "detail" : "calendar"} scopeKey={scopeKey} direction="forward" compact={!wide} style={[styles.column, wide && (showPanel ? styles.detailColumn : styles.calendarColumn)]}><View ref={panelRef} tabIndex={-1} testID={showPanel ? "task-detail-panel" : "task-calendar-panel"} style={[styles.aside, !showPanel && styles.calendarAside]}>
            {showPanel ? detailUnit : <><Text accessibilityRole="header" aria-level={2} style={styles.asideTitle}>按日期查看</Text><Text style={styles.meta}>點選日期，清單只顯示當天已載入的安排。</Text>{calendar}</>}
          </View></MotionDetail> : null}
        </View>;
}

const styles = StyleSheet.create({
workspace: { gap: spacing.lg, minWidth: 0 },
workspaceWide: { flexDirection: "row", alignItems: "flex-start" },
column: { minWidth: 0, width: "100%" },
listColumn: { flex: 1.2, width: undefined },
hidden: { display: "none" },
listSurface: { gap: spacing.md, minWidth: 0, backgroundColor: colors.paper, paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
detailColumn: { flex: 1, width: undefined },
calendarColumn: { width: 320, flexShrink: 0 },
aside: { gap: spacing.md, minWidth: 0, backgroundColor: colors.paper, padding: spacing.lg, borderTopWidth: 3, borderTopColor: colors.teal },
calendarAside: { backgroundColor: "transparent", padding: 0, borderTopWidth: 0 },
asideTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "700" },
meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
mobileCalendar: { marginBottom: spacing.md }
});

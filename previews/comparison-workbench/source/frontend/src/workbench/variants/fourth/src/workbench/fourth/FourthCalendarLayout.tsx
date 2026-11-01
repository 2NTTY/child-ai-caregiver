// Extracted from Fourth 76493c5e; presentation only, supplied single-owner ports.
import type { TasksSlotPorts } from '../TasksSlotPorts';
import { BackgroundSurface } from "../../components/appearance/BackgroundSurface";
import { StyleSheet, View } from "react-native";
import { spacing } from "../../theme";
import { MotionDetail, MotionDisclosure } from "../../motion";
import { TasksCalendar } from "../../components/tasks/TasksCalendar";
export function FourthCalendarLayout({wide,showAside,showPanel,scopeKey,listVisible,listRef,panelRef,model,pending,selectedDay,calendarMonth,occupied,selectCalendarDay,setCalendarMonth,tab,readUnavailable,noPendingTasks,calendarOpen,renderFilters,detailUnit}: Pick<TasksSlotPorts, 'wide'|'showAside'|'showPanel'|'scopeKey'|'listVisible'|'listRef'|'panelRef'|'model'|'pending'|'selectedDay'|'calendarMonth'|'occupied'|'selectCalendarDay'|'setCalendarMonth'|'tab'|'readUnavailable'|'noPendingTasks'|'calendarOpen'|'renderFilters'|'detailUnit'>) {
const calendar = <TasksCalendar items={pending} context={model.scheduleContext} selectedDay={selectedDay} month={calendarMonth} disabled={occupied}
    onSelectDay={selectCalendarDay} onChangeMonth={month => { if (!occupied) setCalendarMonth(month); }} />;
const mobileCalendar = tab === "pending" && !wide && !readUnavailable && !noPendingTasks ? <MotionDisclosure expanded={calendarOpen} scopeKey={scopeKey}><View style={styles.mobileCalendar}>{calendar}</View></MotionDisclosure> : null;
return <View testID="tasks-workspace" style={[styles.workspace, wide && showAside && styles.workspaceWide]}>
          <MotionDetail activeKey={showPanel ? "panel" : "list"} scopeKey={scopeKey} direction="back" compact={!wide && !showPanel} style={[styles.column, wide && showAside && styles.listColumn, !listVisible && styles.hidden]}>
            <BackgroundSurface padded ref={listRef} tabIndex={-1} testID="tasks-list" style={styles.listSurface} pointerEvents={listVisible ? "auto" : "none"} aria-hidden={!listVisible} accessibilityElementsHidden={!listVisible} importantForAccessibility={listVisible ? "auto" : "no-hide-descendants"}>{renderFilters(mobileCalendar)}</BackgroundSurface>
          </MotionDetail>
          {showAside ? <MotionDetail activeKey={showPanel ? model.selected?.id ?? "detail" : "calendar"} scopeKey={scopeKey} direction="forward" compact={!wide} style={[styles.column, wide && styles.detailColumn]}><BackgroundSurface padded ref={panelRef} tabIndex={-1} testID={showPanel ? "task-detail-panel" : "task-calendar-panel"} style={styles.stack}>
            {showPanel ? detailUnit : calendar}
          </BackgroundSurface></MotionDetail> : null}
        </View>;
}

const styles = StyleSheet.create({
workspace: { gap: spacing.lg, minWidth: 0 },
workspaceWide: { flexDirection: "row", alignItems: "flex-start" },
column: { minWidth: 0, width: "100%" },
listColumn: { flex: 1.05, width: undefined },
hidden: { display: "none" },
listSurface: { gap: spacing.md, minWidth: 0 },
detailColumn: { flex: 1, width: undefined },
stack: { gap: spacing.lg, minWidth: 0 },
mobileCalendar: { marginBottom: spacing.md }
});

// Derived from pinned Original TasksView; actual renderer, no task state/owner.
import type { TasksSlotPorts } from './TasksSlotPorts';
import { StyleSheet, View } from "react-native";
import { MotionDetail, MotionDisclosure } from "../motion";
import { BackgroundSurface } from "../components/appearance/BackgroundSurface";
import { TasksCalendar } from "../components/tasks/TasksCalendar";
import { chineseFont, colors, spacing, mobileLayout, workspaceType, readingType } from "../theme";
export function OriginalDetailAperture({wide,showAside,showPanel,scopeKey,listVisible,listRef,panelRef,model,pending,selectedDay,calendarMonth,occupied,selectCalendarDay,setCalendarMonth,tab,readUnavailable,noPendingTasks,calendarOpen,renderFilters,detailUnit}: Pick<TasksSlotPorts, 'wide'|'showAside'|'showPanel'|'scopeKey'|'listVisible'|'listRef'|'panelRef'|'model'|'pending'|'selectedDay'|'calendarMonth'|'occupied'|'selectCalendarDay'|'setCalendarMonth'|'tab'|'readUnavailable'|'noPendingTasks'|'calendarOpen'|'renderFilters'|'detailUnit'>) {
const calendar = <TasksCalendar items={pending} context={model.scheduleContext} selectedDay={selectedDay} month={calendarMonth} disabled={occupied}
    onSelectDay={selectCalendarDay} onChangeMonth={month => { if (!occupied) setCalendarMonth(month); }} />;
const mobileCalendar = tab === "pending" && !wide && !readUnavailable && !noPendingTasks ? <MotionDisclosure expanded={calendarOpen} scopeKey={scopeKey}><View style={styles.mobileCalendar}>{calendar}</View></MotionDisclosure> : null;
return showAside ? <MotionDetail activeKey={showPanel ? model.selected?.id ?? "detail" : "calendar"} scopeKey={scopeKey} direction="forward" compact={!wide} style={[styles.column, wide && styles.detailColumn]}><BackgroundSurface padded ref={panelRef} tabIndex={-1} testID={showPanel ? "task-detail-panel" : "task-calendar-panel"} style={styles.stack}>
            {showPanel ? detailUnit : calendar}
          </BackgroundSurface></MotionDetail> : null;
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

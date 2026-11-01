// Exact Care source rendering; state/actions/recovery remain host-owned.
import type { CareSlotPorts } from './CareSlotPorts';
import { StyleSheet, View } from "react-native";
import { MotionDetail, MotionDisclosure } from "../motion";
import { BackgroundSurface } from "../components/appearance/BackgroundSurface";
import { TasksCalendar } from "../components/tasks/TasksCalendar";
import { chineseFont, colors, mobileLayout, readingType, spacing } from "../theme";
export function CareCalendarLayout({wide,showAside,showPanel,scopeKey,listVisible,listRef,model,pending,selectedDay,calendarMonth,occupied,selectCalendarDay,changeView,tab,readUnavailable,noPendingTasks,calendarOpen,renderFilters,detailUnit}: Pick<CareSlotPorts, 'wide'|'showAside'|'showPanel'|'scopeKey'|'listVisible'|'listRef'|'model'|'pending'|'selectedDay'|'calendarMonth'|'occupied'|'selectCalendarDay'|'changeView'|'tab'|'readUnavailable'|'noPendingTasks'|'calendarOpen'|'renderFilters'|'detailUnit'>) {
const calendar = <TasksCalendar items={pending} context={model.scheduleContext} selectedDay={selectedDay} month={calendarMonth} disabled={occupied}
    onSelectDay={selectCalendarDay} onChangeMonth={month => { if (!occupied) changeView({ month }); }} />;
const mobileCalendar = tab === "pending" && !readUnavailable && !noPendingTasks ? <MotionDisclosure expanded={calendarOpen} scopeKey={scopeKey}><View style={styles.mobileCalendar}>{calendar}</View></MotionDisclosure> : null;
return <View testID="tasks-workspace" style={[styles.workspace, wide && showAside && styles.workspaceWide]}>
          <MotionDetail activeKey={showPanel ? "panel" : "list"} scopeKey={scopeKey} direction="back" compact={!wide && !showPanel} style={[styles.column, wide && showAside && styles.listColumn, !listVisible && styles.hidden]}>
            <BackgroundSurface padded ref={listRef} tabIndex={-1} testID="tasks-list" style={styles.listSurface} pointerEvents={listVisible ? "auto" : "none"} aria-hidden={!listVisible} accessibilityElementsHidden={!listVisible} importantForAccessibility={listVisible ? "auto" : "no-hide-descendants"}>{renderFilters(mobileCalendar)}</BackgroundSurface>
          </MotionDetail>
          {detailUnit}
        </View>;
}

const styles = StyleSheet.create({
workspace: { gap: spacing.lg, minWidth: 0 },
workspaceWide: { flexDirection: "row", alignItems: "flex-start" },
column: { minWidth: 0, width: "100%" },
listColumn: { flex: 1, width: undefined },
hidden: { display: "none" },
listSurface: { gap: spacing.lg, minWidth: 0, backgroundColor: colors.white, padding: spacing.lg },
mobileCalendar: { marginBottom: spacing.md }
});

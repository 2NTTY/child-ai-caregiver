import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { MotionDisclosure } from "../../../motion";
import { colors, spacing } from "../../../theme";
import { originalTaskStyles } from '../../../preview/tasks-original-presentation/styles';
import { isTaskCalendarPresentationVariant, type TaskPresentationTab, type TaskCalendarPresentationVariant } from "./contracts";

export type TaskCalendarPlacement = "inline" | "aside" | "none";
export interface TaskCalendarLayoutInput {
  variant: TaskCalendarPresentationVariant;
  compact: boolean;
  width: number;
  tab: TaskPresentationTab;
  showPanel: boolean;
  readUnavailable: boolean;
  noPendingTasks: boolean;
}
export interface TaskCalendarLayoutDescriptor {
  pageContentStyle?: StyleProp<ViewStyle>;
  wide: boolean;
  showAside: boolean;
  listVisible: boolean;
  calendarPlacement: TaskCalendarPlacement;
  calendarTriggerVisible: boolean;
  workspaceStyle: StyleProp<ViewStyle>;
  listColumnStyle: StyleProp<ViewStyle>;
  asideColumnStyle: StyleProp<ViewStyle>;
  listSurfaceStyle: StyleProp<ViewStyle>;
  calendarSurfaceStyle: StyleProp<ViewStyle>;
}
/** No measurement, state, callbacks or remounts. Existing host nodes/refs consume these styles. */
export function taskCalendarLayout(p: TaskCalendarLayoutInput): TaskCalendarLayoutDescriptor | null {
  if (!isTaskCalendarPresentationVariant(p.variant)) return null;
  if (p.variant === 'original-calendar-slot01') {
    const wide = p.width >= 840;
    const eligible = p.tab === 'pending' && !p.readUnavailable;
    const showAside = p.showPanel || (wide && eligible);
    const listVisible = wide || !p.showPanel;
    return {
      wide, showAside, listVisible,
      calendarPlacement: !eligible ? 'none' : wide ? !p.showPanel ? 'aside' : 'none' : !p.noPendingTasks ? 'inline' : 'none',
      calendarTriggerVisible: eligible && !p.noPendingTasks && !wide,
      pageContentStyle: [originalTaskStyles.page, p.compact && originalTaskStyles.mobilePage],
      workspaceStyle: [originalTaskStyles.workspace, wide && showAside && originalTaskStyles.workspaceWide],
      listColumnStyle: [originalTaskStyles.column, wide && showAside && originalTaskStyles.listColumn, !listVisible && originalTaskStyles.hidden],
      asideColumnStyle: [originalTaskStyles.column, wide && originalTaskStyles.detailColumn],
      listSurfaceStyle: originalTaskStyles.listSurface, calendarSurfaceStyle: originalTaskStyles.stack,
    };
  }
  const care = p.variant === "care";
  const handbook = p.variant === "handbook";
  const wide = p.width >= (care ? 1100 : 840);
  const calendarEligible = p.tab === "pending" && !p.readUnavailable;
  const showAside = p.showPanel || (!care && wide && calendarEligible && (!handbook || !p.noPendingTasks));
  const listVisible = wide || !p.showPanel;
  const calendarPlacement: TaskCalendarPlacement = !calendarEligible ? "none"
    : care || !wide ? p.noPendingTasks ? "none" : "inline"
      : !p.showPanel && showAside ? "aside" : "none";
  return {
    wide, showAside, listVisible, calendarPlacement,
    calendarTriggerVisible: calendarEligible && !p.noPendingTasks && (care || !wide),
    workspaceStyle: [styles.workspace, wide && showAside && styles.workspaceWide],
    listColumnStyle: [styles.column, wide && showAside && (care ? styles.careListColumn : handbook ? styles.handbookListColumn : styles.listColumn), !listVisible && styles.hidden],
    asideColumnStyle: [styles.column, care && styles.readerColumn, wide && (care ? styles.careDetailColumn : handbook && !p.showPanel ? styles.handbookCalendarColumn : styles.detailColumn)],
    listSurfaceStyle: care ? styles.careListSurface : handbook ? styles.handbookListSurface : p.variant === "fourth" ? styles.fourthListSurface : styles.listSurface,
    calendarSurfaceStyle: handbook ? styles.handbookCalendarAside : styles.stack,
  };
}
/** The host still owns calendarOpen and scope resets. It supplies the same calendar element. */
export function TasksCalendarDisclosure({ placement, open, scopeKey, children }: {
  placement: TaskCalendarPlacement; open: boolean; scopeKey: string; children: ReactNode;
}) {
  if (placement !== "inline") return null;
  return <MotionDisclosure expanded={open} scopeKey={scopeKey}><View style={styles.mobileCalendar}>{children}</View></MotionDisclosure>;
}
const styles = StyleSheet.create({
  hidden: { display: "none" }, stack: { gap: spacing.lg, minWidth: 0 },
  workspace: { gap: spacing.lg, minWidth: 0 }, workspaceWide: { flexDirection: "row", alignItems: "flex-start" },
  column: { minWidth: 0, width: "100%" }, listColumn: { flex: 1.05, width: undefined }, detailColumn: { flex: 1, width: undefined },
  handbookListColumn: { flex: 1.2, width: undefined }, handbookCalendarColumn: { width: 320, flexShrink: 0 },
  careListColumn: { flex: 1, width: undefined }, careDetailColumn: { flex: 1.3, width: undefined },
  readerColumn: { maxWidth: 760, backgroundColor: colors.white, padding: 16 },
  listSurface: { gap: spacing.md, minWidth: 0, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, borderRadius: 14, padding: spacing.lg },
  fourthListSurface: { gap: spacing.md, minWidth: 0 },
  handbookListSurface: { gap: spacing.md, minWidth: 0, backgroundColor: colors.paper, paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  careListSurface: { gap: spacing.lg, minWidth: 0, backgroundColor: colors.white, padding: spacing.lg },
  handbookCalendarAside: { gap: spacing.md, minWidth: 0, backgroundColor: "transparent", padding: 0, borderTopWidth: 0 },
  mobileCalendar: { marginBottom: spacing.md },
});

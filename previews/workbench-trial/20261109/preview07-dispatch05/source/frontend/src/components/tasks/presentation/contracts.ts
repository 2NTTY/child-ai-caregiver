import type { Ref } from "react";
import type { LayoutChangeEvent, View } from "react-native";
import type { TaskBacklogFilter, TaskCalendarMonth } from "../task-calendar";
import type { TaskScheduleContext } from "../../../task-view-model";

/** Recovered presentation sources, not an executable registry or an admission grant. */
export type TaskPresentationVariant = "harbour" | "fourth" | "handbook" | "care";
export function isTaskPresentationVariant(value: unknown): value is TaskPresentationVariant {
  return value === "harbour" || value === "fourth" || value === "handbook" || value === "care";
}
export type TaskPresentationTab = "pending" | "completed";
export interface TaskFiltersPresentationProps {
  variant: TaskPresentationVariant;
  region: "tabs" | "review" | "completed-note" | "search" | "context" | "clear";
  tabsId: string;
  tab: TaskPresentationTab;
  occupied: boolean;
  readUnavailable: boolean;
  noPendingTasks: boolean;
  openCount: number;
  completedCount: number;
  hasMoreTasks: boolean;
  query: string;
  filter: TaskBacklogFilter;
  selectedDay: string | null;
  calendarOpen: boolean;
  /** Supplied by the independently selected calendar-layout, not the filter variant. */
  calendarTriggerVisible: boolean;
  backlog: Readonly<{
    counts: Readonly<Record<TaskBacklogFilter, number>>;
    total: number; from: number; to: number; nearLabel: string | null;
  }>;
  /** The host retains route guards, scope checks, reset semantics and focus bookkeeping. */
  onChangeTab(tab: TaskPresentationTab): void;
  onChangeQuery(query: string): void;
  onClearQuery(): void;
  onChangeFilter(filter: TaskBacklogFilter): void;
  onReview(): void;
  onClearDay(): void;
  onToggleCalendar(): void;
  onClearFilters(): void;
}
export interface TaskCalendarPresentationProps {
  /** Observation of this actual root only; no product-state ownership. */
  rootRef?: Ref<View>;
  onLayout?: (event: LayoutChangeEvent) => void;
  variant: TaskPresentationVariant;
  /** The existing task-calendar projection of the current owner's loaded items. */
  calendar: TaskCalendarMonth;
  context: TaskScheduleContext;
  selectedDay: string | null;
  /** Actual measured calendar root width, not viewport width or display scale. */
  width: number;
  disabled: boolean;
  onSelectDay(day: string | null): void;
  onChangeMonth(month: string | null): void;
}

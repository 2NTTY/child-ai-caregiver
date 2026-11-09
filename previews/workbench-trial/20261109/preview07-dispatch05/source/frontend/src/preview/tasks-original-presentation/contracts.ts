/** Display inputs only. Match current host projection structurally; do not import an owner. */
export type OriginalTab = 'pending' | 'completed';
export type OriginalBacklogFilter = 'near' | 'earlier' | 'later' | 'all' | 'review' | 'unconfirmed';
export type OriginalStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';
export interface OriginalAction {
  readonly id: string; readonly label: string; readonly accessibilityLabel?: string;
  readonly variant?: 'primary' | 'secondary' | 'quiet'; readonly density?: 'compact'; readonly disabled: boolean;
}
export interface OriginalFiltersInput {
  readonly tab: OriginalTab; readonly occupied: boolean; readonly readUnavailable: boolean;
  readonly noPendingTasks: boolean; readonly openCount: number; readonly completedCount: number;
  readonly hasMoreTasks: boolean; readonly query: string; readonly filter: OriginalBacklogFilter;
  readonly selectedDay: string | null;
  /** Existing host's formatted date. Required whenever selectedDay is non-null. */
  readonly selectedDayLabel: string | null;
  readonly calendarOpen: boolean;
  /** Independently selected calendar-layout controls placement. */
  readonly calendarTriggerVisible: boolean;
  readonly backlog: Readonly<{ counts: Readonly<Record<OriginalBacklogFilter, number>>;
    total: number; from: number; to: number; nearLabel: string | null }>;
}
export interface OriginalDateSection<T> { readonly id: string; readonly label: string; readonly items: readonly T[] }
export interface OriginalRowDisplay {
  readonly id: string; readonly title: string; readonly time: string; readonly assignee: string;
  readonly kind: 'ordinary' | 'appointment'; readonly completed: boolean;
  readonly statusLabel: string; readonly statusTone: OriginalStatusTone; readonly review: boolean;
  readonly selected: boolean; readonly disabled: boolean; readonly warning?: string | null;
  /** Keep the current interactive shell's role. Never install a new Link or Pressable. */
  readonly role: 'button' | 'link';
}
export interface OriginalRowVisualState {
  readonly review: boolean; readonly selected: boolean; readonly hovered: boolean;
  readonly focused: boolean; readonly pressed: boolean; readonly disabled: boolean;
}
export interface OriginalCalendarDay {
  readonly date: string; readonly day: number; readonly label: string;
  readonly scheduled: number; readonly review: number;
}
export interface OriginalCalendarMonth {
  readonly month: string | null; readonly label: string; readonly currentDay: string | null;
  readonly weeks: readonly (readonly (OriginalCalendarDay | null)[])[];
  readonly unconfirmedCount: number;
}
/** Required existing ports. These declarations allocate no callbacks or refs.
 * Integrator binds action IDs to these live guarded callbacks, never captured local setters.
 */
export interface OriginalExistingHostPorts<RowRef, ActionRef> {
  readonly actionRefs: Readonly<Record<'assistant' | 'create' | 'history' | 'toggle-actions', ActionRef>>;
  readonly rowRef: (id: string, node: RowRef | null) => void;
  readonly onAgent: () => void; readonly onCreate: () => void; readonly onHistory: () => void;
  readonly onToggleActions: () => void; readonly onChangeTab: (tab: OriginalTab) => void;
  readonly onChangeQuery: (query: string) => void; readonly onClearQuery: () => void;
  readonly onChangeFilter: (filter: OriginalBacklogFilter) => void; readonly onReview: () => void;
  readonly onClearDay: () => void; readonly onToggleCalendar: () => void; readonly onClearFilters: () => void;
  readonly onSelectTask: (id: string) => void; readonly onPreviousPage: () => void; readonly onNextPage: () => void;
  readonly onLoadMore: () => void; readonly onReload: () => void;
  readonly onSelectDay: (day: string | null) => void; readonly onChangeMonth: (month: string | null) => void;
  readonly onPreviousMonth: () => void; readonly onNextMonth: () => void;
}

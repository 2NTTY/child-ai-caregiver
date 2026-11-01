/** Harbour local renderer ports. Task data/actions are the existing single owner;
 * UI selections/refs belong to the existing TasksView host, not the visual modules. */
import type { Dispatch, ReactNode, RefObject, SetStateAction } from 'react';
import type { View } from 'react-native';
import type { TasksViewModel, TasksActions, TaskView, taskScheduleSections } from '../task-view-model';
import type { TaskRouteState } from '../navigation/route-state';
import type { WriteRecoveryActions } from '../view-model';
import type { TaskBacklogFilter, projectTaskBacklog } from '../components/tasks/task-calendar';
export interface HarbourTasksSlotPorts {
 model: TasksViewModel; actions: TasksActions; recovery?: WriteRecoveryActions;
 locked: boolean; occupied: boolean; compact: boolean; wide: boolean; showAside: boolean; showPanel: boolean;
 scopeKey: string; listVisible: boolean; loading: boolean; readUnavailable: boolean;
 noPendingTasks: boolean; openCount: number; reviewCount: number;
 tab: 'pending'|'completed'; filter: TaskBacklogFilter; query: string; selectedDay: string|null;
 calendarMonth: string|null; calendarOpen: boolean; actionMenuOpen: boolean; tabsId: string;
 pending: TaskView[]; completed: TaskView[];
 backlog: ReturnType<typeof projectTaskBacklog>; sections: ReturnType<typeof taskScheduleSections>;
 readState: 'loading'|'error'|'stale'|'ready'|'empty'; readMessage: string;
 onAgent(): void; onHistory(): void; rememberList(id:string|null):void;
 changeFilter(next:TaskBacklogFilter):void; selectCalendarDay(day:string|null):void;
 setQuery(query:string):void; setCalendarOpen:Dispatch<SetStateAction<boolean>>;
 setActionMenu:Dispatch<SetStateAction<{scope:string;open:boolean}>>;
 anchor:RefObject<{id:string|null;position:number;scope:string}|null>;
 listRef:RefObject<View|null>; panelRef:RefObject<View|null>; rowRefs:RefObject<Map<string,View>>;
 previousLoading:RefObject<boolean>;
 page:number; containerLayout:{width:number};
 changeRoute(patch:Partial<TaskRouteState>,mode?:'push'|'replace'):void;
 createAction:ReactNode; pageActions:ReactNode; dateList:ReactNode; mobileCalendar:ReactNode; detailUnit:ReactNode;
 renderFilters(mobileCalendar:ReactNode):ReactNode;
}

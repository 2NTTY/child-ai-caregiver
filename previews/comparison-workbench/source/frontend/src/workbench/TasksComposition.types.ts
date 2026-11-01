/** Owned mixed presentation contract; no task data owner or executable implementation. */
import type {TaskBacklogFilter} from '../components/tasks/task-calendar';
import type {WriteRecoveryActions} from '../view-model';
import type {useTasksPreview} from '../preview/useTasksPreview';
import type {createState} from './draft.mjs';
import type {routeSupport} from './route-support.mjs';
import type {createTasksPresentation} from './tasks-presentation.mjs';
import type {TasksSlotPorts} from './TasksSlotPorts';
import type {OriginalCalendarLayout} from './variants/original/src/workbench/OriginalCalendarLayout';

export type TasksCompositionSlot = 'header-actions'|'filters'|'date-list'|'calendar-layout';
export type TasksCompositionVariant = 'original'|'harbour'|'care'|'handbook'|'fourth';
export type TasksCompositionMode = 'operation'|'pick';
export type PresentationUpdate<T> = T|((current:T)=>T);
export interface TasksPresentationRoute {
 tab:'pending'|'completed'; filter:TaskBacklogFilter; page:number;
 day:string|null; month:string|null; taskId:string|null;
}
export interface TasksPresentationSnapshot {
 readonly route:Readonly<TasksPresentationRoute>; readonly query:string; readonly revision:number;
}
/** serializeTasksRoute omits null fields; query is never a URL field. */
export interface TasksPresentationHref {
 pathname:'/tasks';
 params:{tab:TasksPresentationRoute['tab'];filter:TaskBacklogFilter;page:string;day?:string;month?:string;taskId?:string};
}
/** Intentional route/string input seam; absent fields preserve state, null clears nullable fields. */
export interface TasksPresentationInputHref {
 pathname:'/tasks';
 params:{tab?:TasksPresentationRoute['tab'];filter?:TaskBacklogFilter;page?:number|string;day?:string|null;month?:string|null;taskId?:string|null};
}
export interface TasksPresentationPorts {
 changeRoute(patch:Partial<TasksPresentationRoute>,mode?:'push'|'replace'):boolean;
 changeView(patch:Partial<TasksPresentationRoute>,mode?:'push'|'replace'):boolean;
 setQuery(query:string):boolean;
 setTab(tab:TasksPresentationRoute['tab'],nextFilter?:TaskBacklogFilter):boolean;
 setFilter(filter:PresentationUpdate<TaskBacklogFilter>):boolean;
 setPage(page:PresentationUpdate<number>,clearSelection?:boolean):boolean;
 setSelectedDay(day:PresentationUpdate<string|null>):boolean;
 setCalendarMonth(month:PresentationUpdate<string|null>):boolean;
 taskHref(id:string):TasksPresentationHref;
 openHref(href:TasksPresentationInputHref):boolean;
}
/** Actual owner return shapes; closePanel's refusal is not erased to a new void port. */
export interface TasksCompositionOwner {
 scopeKey:string; model:ReturnType<typeof useTasksPreview>['model'];
 actions:ReturnType<typeof useTasksPreview>['actions']; recovery:WriteRecoveryActions;
 mode:TasksCompositionMode; notice:string; dismissNotice():void;
 routeSupport:typeof routeSupport;
 requestRoute(path:string):ReturnType<typeof routeSupport>|{status:'blocked';reason:'PICK_MODE'};
}
export interface TasksCompositionCommands {
 pick(slot:TasksCompositionSlot,variant:TasksCompositionVariant):boolean;
 undo():boolean; restoreOriginal():boolean; save():string; load(text:string):boolean;
}
export interface TasksCompositionValue extends TasksCompositionCommands {
 state:Omit<ReturnType<typeof createState>,'mode'>&{mode:TasksCompositionMode};
 slots:Record<TasksCompositionSlot,TasksCompositionVariant>;
 presentation:TasksPresentationSnapshot; ports:TasksPresentationPorts;
 store:ReturnType<typeof createTasksPresentation>; owner:TasksCompositionOwner;
 topActions:boolean;
 layoutAside(input:Pick<TasksSlotPorts,'wide'|'showPanel'|'tab'|'readUnavailable'|'noPendingTasks'>):boolean;
}
export type OriginalCalendarLayoutProps = Parameters<typeof OriginalCalendarLayout>[0];

/** Handbook-only source signatures. These do not implement route publication.
 * TasksView retains NavigationAuthority and route-state publishers. Mixed host
 * admission must supply this seam explicitly, never map href to selectTask. */
import type { Href } from 'expo-router';
import type { TasksSlotPorts } from './TasksSlotPorts';
import type { TaskBacklogFilter } from '../components/tasks/task-calendar';
export interface HandbookTasksSlotPorts extends Omit<TasksSlotPorts, 'setTab'|'setFilter'|'setPage'|'setCalendarMonth'> {
 setTab(value:'pending'|'completed', nextFilter?:TaskBacklogFilter):void;
 setFilter(value:TaskBacklogFilter):void;
 setPage(value:number, clearSelection?:boolean):void;
 setCalendarMonth(value:string|null):void;
 taskHref?(id:string):Href;
}

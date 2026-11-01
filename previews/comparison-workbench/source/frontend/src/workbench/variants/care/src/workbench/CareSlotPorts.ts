/** Care-local rendering bridge. Atomic route semantics are not simulated by Original setters.
 * The four slot keys and common model/action/ref ownership are unchanged. */
import type { TasksSlotPorts } from './TasksSlotPorts';
import type { TaskRouteState } from '../navigation/route-state';
export interface CareSlotPorts extends Omit<TasksSlotPorts, 'setQuery'> {
 route: TaskRouteState;
 changeView(patch: Partial<TaskRouteState>, mode?: 'push'|'replace'): void;
 setQuery(query: string): void;
}

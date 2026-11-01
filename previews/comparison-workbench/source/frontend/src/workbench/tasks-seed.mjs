/** Only the admitted normal seed; never a production transport or state owner. */
import normal from './NormalTasksData';
export const taskPreviewClock=Object.freeze({...normal.scheduleContext});
/** @param {string} childId @param {import('../preview/task-fixture').TaskPreviewCondition} condition */
export function createTaskFixture(childId,condition){
 if(childId!==normal.child.id||condition!=='normal')throw Error('TASK_SCENARIO_UNAVAILABLE');
 return structuredClone(normal.fixture);
}
export const taskChild=Object.freeze({...normal.child});

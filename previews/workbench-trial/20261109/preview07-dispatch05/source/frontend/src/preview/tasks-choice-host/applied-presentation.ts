import { validateTaskRecipeDraft, type TaskRecipeSnapshot } from './recipe';

/** Data only. Epoch/revision identify presentation CAS, never product authority. */
export type AppliedPresentation = Readonly<{
  epoch: object; revision: number; active: boolean; applied: TaskRecipeSnapshot | null;
}>;
export function emptyAppliedPresentation(active: boolean): AppliedPresentation {
  return Object.freeze({ epoch: Object.freeze({}), revision: 0, active, applied: null });
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
/** The trusted caller must separately prove a current explicit Apply commit. */
export function publishAppliedPresentation(current: AppliedPresentation, expected: AppliedPresentation,
  applied: unknown): AppliedPresentation | null {
  if (current !== expected || !current.active || current.revision === Number.MAX_SAFE_INTEGER
    || !validateTaskRecipeDraft({ current: applied, undo: [], revision: 0 })) return null;
  const copy = freeze(JSON.parse(JSON.stringify(applied)) as TaskRecipeSnapshot);
  return Object.freeze({ epoch: current.epoch, revision: current.revision + 1, active: true, applied: copy });
}

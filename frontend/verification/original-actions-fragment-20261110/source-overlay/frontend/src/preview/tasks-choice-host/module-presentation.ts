import type { HeaderVariant } from '../task-header-actions-hf01/selection';
import type { TaskRecipeSnapshot } from './recipe';
import type { TaskPresentationVariant } from '../../components/tasks/presentation/contracts';

export type TaskSourceRegionProfile = Readonly<{variantId: 'harbour'|'fourth'|'handbook'|'care'; presentationId:'source-regions02'}>;
export function isTaskSourceRegionProfile(value: unknown): value is TaskSourceRegionProfile {
  return typeof value === 'object' && value !== null && (value as TaskSourceRegionProfile).presentationId === 'source-regions02'
    && ['harbour','fourth','handbook','care'].includes((value as TaskSourceRegionProfile).variantId);
}
/** Readonly appearance only. The Control's existing scene admission owns delivery. */
export type TaskModulePresentation = Readonly<{
  'header-actions': 'harbour' | 'fourth' | 'handbook' | 'original-actions-fragment01' | TaskSourceRegionProfile | null;
  filters: TaskPresentationVariant | null;
  'date-list': 'harbour' | 'fourth' | 'handbook' | 'original-row-fragment01' | TaskSourceRegionProfile | null;
  'calendar-layout': TaskPresentationVariant | null;
}>;
function headerOrRow(value: unknown): 'harbour' | 'fourth' | 'handbook' | null {
  return value === 'harbour' || value === 'fourth' || value === 'handbook' ? value : null;
}
function controlled(value: unknown): TaskPresentationVariant | null {
  return value === 'care' ? value : headerOrRow(value);
}
function regionProfile(selection: TaskRecipeSnapshot['date-list'], candidateId: string) {
  return selection?.candidateId === candidateId && selection.variantId !== 'original' && ['harbour','fourth','handbook','care'].includes(selection.variantId)
    ? Object.freeze({variantId: selection.variantId, presentationId:'source-regions02' as const}) : headerOrRow(selection?.variantId);
}
function isOriginalActions(selection: TaskRecipeSnapshot['header-actions']): boolean {
  return selection?.slotId === 'header-actions' && selection.variantId === 'original'
    && selection.candidateId === 'original-actions-fragment01';
}
/** Consume an already strict-pinned recipe; Original admits only named fragments. */
export function projectTaskModulePresentation(snapshot: TaskRecipeSnapshot): TaskModulePresentation | undefined {
  const result: TaskModulePresentation = {
    'header-actions': isOriginalActions(snapshot['header-actions']) ? 'original-actions-fragment01'
      : regionProfile(snapshot['header-actions'], 'header-source-regions02'),
    filters: controlled(snapshot.filters?.variantId),
    'date-list': snapshot['date-list']?.slotId === 'date-list' && snapshot['date-list'].variantId === 'original' && snapshot['date-list'].candidateId === 'original-row-fragment01'
      ? 'original-row-fragment01' : regionProfile(snapshot['date-list'], 'date-list-source-regions02'),
    'calendar-layout': controlled(snapshot['calendar-layout']?.variantId),
  };
  return Object.values(result).some(value => value !== null) ? Object.freeze(result) : undefined;
}
/** Existing action-behavior adapter, explicitly NOT the selected presentation source.
 * Handbook uses the host's real Harbour callbacks/guards. Every recipe choice
 * changes the complete recipe revision before the existing HF frame is committed.
 * The exact Original actions fragment reuses Fourth's matching action order and
 * compact disclosure shape; its presentation source remains Original, not Fourth.
 */
export function taskHeaderBehaviorVariant(snapshot: TaskRecipeSnapshot | null): HeaderVariant {
  return snapshot?.['header-actions']?.variantId === 'fourth' || isOriginalActions(snapshot?.['header-actions'] ?? null) ? 'fourth' : 'harbour';
}

/** Compatibility only. Care is carried explicitly by modulePresentation, not relabeled H. */
export function legacyTaskRowAppearance(value: TaskModulePresentation | undefined): 'harbour'|'fourth'|'handbook'|'original-row-fragment01'|undefined {
  const slot=value?.['date-list'];
  return slot === 'original-row-fragment01' ? slot : headerOrRow(isTaskSourceRegionProfile(slot)?slot.variantId:slot) ?? undefined;
}

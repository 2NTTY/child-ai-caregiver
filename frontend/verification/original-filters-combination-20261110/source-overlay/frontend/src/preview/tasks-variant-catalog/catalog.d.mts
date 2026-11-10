/** Public metadata contract. No value in this catalog grants runtime admission. */
export type TaskVariantId = 'original' | 'harbour' | 'care' | 'handbook' | 'fourth';
export type TaskSlotId = 'header-actions' | 'filters' | 'date-list' | 'calendar-layout';
export type SourceFile = Readonly<{ sourceId: string; path: string; sha256: string }>;
/** Matches the existing HF01 frontend-relative selection fingerprint shape. */
export type SourceFingerprint = Readonly<{
  assemblyMembersSha256: string;
  files: readonly Readonly<{ path: string; sha256: string }>[];
}>;
export type SourceIdentity = Readonly<{
  kind: 'restored-assembly'; sourceId: string; appCommit: null;
  baseCommit: string; baseTree: string; payloadCommit: string;
  assemblyMembersSha256: string; assemblyMemberCount: number;
}> | Readonly<{
  kind: 'historical-build-projection'; sourceId: string; appCommit: string;
  sourceTree: string; expectedProjectedRowsSha256: string;
  restoredProjectionCount: number; expectedProjectionCount: number;
}>;
export type NarrowCandidate = Readonly<{
  slotId: TaskSlotId;
  candidateId: 'original-filters-combination01' | 'original-search-frame-fragment01' | 'original-tabs-fragment01' | 'original-actions-fragment01' | 'original-row-fragment01' | 'header-actions' | 'row-appearance' | 'header-presentation' | 'filters-presentation' | 'date-list-presentation' | 'calendar-presentation' | 'header-source-regions02' | 'date-list-source-regions02';
  variantId: 'original' | 'harbour' | 'fourth' | 'handbook' | 'care';
  hostVariantId: 'harbour';
  coverage: 'historical-filters-combination' | 'historical-search-frame-fragment' | 'historical-tabs-fragment' | 'historical-actions-fragment' | 'historical-row-fragment' | 'actions-only' | 'row-appearance' | 'header-appearance' | 'controlled-filters-h-theme' | 'date-groups-and-rows' | 'controlled-calendar-layout-h-theme' | 'header-source-regions-partial-host' | 'date-list-source-regions-partial-host';
  adapterVersion: string;
  sourceAvailability: 'available';
  acceptance: 'bounded-source-accepted' | 'source-reviewed-integration-unverified';
  appearanceLimit?: string;
  /** Source-level partial adapter only, never a mount/release authorization. */
  prospectiveComposable: true;
  runtimeAdmission: false;
  sourceFingerprint: SourceFingerprint;
  dependenciesFingerprint: string;
  sourceFiles: readonly SourceFile[];
  referenceFiles: readonly SourceFile[];
  protectedOwner: 'tasks-single-owner-v1';
}>;
export type TaskSlot = Readonly<{
  slotId: TaskSlotId;
  label: string;
  sourceAvailability: 'available' | 'unavailable';
  sourceFiles: readonly SourceFile[];
  behaviorOwnership: Readonly<{
    authority: 'source-owned' | 'unavailable';
    injectable: false;
    state: readonly string[];
    ownerComponents: readonly string[];
    description: string;
  }>;
  sourceDifference: string;
  wholeSlotComposable: false;
  acceptance: 'not-accepted';
  runtimeAdmission: false;
  narrowCandidates: readonly NarrowCandidate[];
}>;
export type TaskVariant = Readonly<{
  variantId: TaskVariantId;
  label: string;
  ownerContract: 'tasks-single-owner-v1';
  source: Readonly<{
    availability: 'available' | 'partial' | 'unavailable';
    identity: SourceIdentity | null;
    fingerprint: SourceFingerprint | null;
    historicalPointer: Readonly<{
      kind: 'composite'; appCommit: null; sourceTree: string; recipeSha256: string;
    }> | null;
    files: readonly SourceFile[];
    missingInputs: readonly Readonly<{ path: string; sha256: string; bytes: number }>[];
    assemblyMembersVerified: boolean;
    fullTrackedBytesVerified: false;
    importClosureVerified: false;
    claimsLatest: false;
  }>;
  globalTheme: Readonly<{
    requiredVariantId: 'original';
    sourceVariantId: TaskVariantId | null;
    acceptance: 'not-accepted';
    runtimeAdmission: false;
  }>;
  slots: readonly TaskSlot[];
  protectedBehaviorGroup: Readonly<{
    members: readonly ['form', 'detail', 'dirty', 'saving', 'unknown', 'conflict', 'recovery'];
    splittable: false;
    selectable: false;
    sourceAvailability: 'available' | 'unavailable';
    sourceFiles: readonly SourceFile[];
  }>;
  existingLanes: readonly Readonly<{
    id: 'TC01' | 'C01' | 'TE01' | 'TH01';
    ownerStatus: 'unknown'; injectable: false; role: string;
  }>[];
  unavailableIntegrations: readonly Readonly<{
    id: 'TF01' | 'HF-TF'; availability: 'unavailable'; reason: string;
  }>[];
  runtimeAdmission: false;
  firstPhaseAccepted: false;
}>;
export type TaskSlotCapability = Readonly<{
  /** Source inspection/comparison only, not a rendered comparison. */
  sourceAvailable: boolean;
  prospectiveComposable: false;
  runtimeAdmission: false;
  reasons: readonly string[];
}>;
export const VARIANT_IDS: readonly ['original', 'harbour', 'care', 'handbook', 'fourth'];
export const TASK_SLOT_IDS: readonly ['header-actions', 'filters', 'date-list', 'calendar-layout'];
export const TASK_VARIANTS: readonly TaskVariant[];
export function getTaskVariant(variantId: unknown): TaskVariant | null;
export function getTaskSlot(variantId: unknown, slotId: unknown): TaskSlot | null;
export function getTaskNarrowCandidate(variantId: unknown, slotId: unknown, candidateId: unknown): NarrowCandidate | null;
export function checkTaskSlotCapability(variantId: unknown, slotId: unknown, purpose: unknown): TaskSlotCapability;
/** Exact current catalog validation, not a source registry or admission grant. */
export function validateTaskVariantCatalog(value: unknown): value is readonly TaskVariant[];

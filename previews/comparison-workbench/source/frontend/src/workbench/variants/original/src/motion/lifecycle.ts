export type PresentationStamp = { generation: number; scopeKey: string; epoch: number };

/** Completion belongs to the exact presentation that started it, not the latest token. */
export function isCurrentPresentation(presented: PresentationStamp, current: PresentationStamp) {
  return presented.generation === current.generation && presented.scopeKey === current.scopeKey && presented.epoch === current.epoch;
}

/** A startup accessibility query must never overwrite a newer system change event. */
export function canApplyInitialPreference(mounted: boolean, requestRevision: number, currentRevision: number) {
  return mounted && requestRevision === currentRevision;
}

export function planListProjection(previousIds: readonly string[], nextIds: readonly string[], previousScope: string, nextScope: string, animate: boolean) {
  const sameScope = previousScope === nextScope;
  const next = new Set(nextIds);
  return { sameScope, retainUntilLayout: sameScope, animate: sameScope && animate,
    focusRemovedIds: sameScope ? previousIds.filter(id => !next.has(id)) : [] };
}

export function disclosureStartHeight(expanded: boolean, inFlight: boolean, measured: number, current: number) {
  return inFlight ? Math.max(0, current) : expanded ? 0 : Math.max(0, measured);
}

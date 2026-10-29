import type { ProductionOwner } from './ProductionOwner';

// Called inside the existing appropriate leave guard. RecordsController selects the
// authorized child synchronously before its asynchronous record refresh.
export function selectChildForProfile(owner: Pick<ProductionOwner, 'getSnapshot' | 'controller'>, identityKey: string, childId: string, openProfile: () => void): void {
  const before = owner.getSnapshot();
  if (before.identityKey !== identityKey || !before.records.children.some(child => child.id === childId)) return;
  const selection = owner.controller.selectChild(childId);
  const after = owner.getSnapshot();
  if (after.identityKey === identityKey && after.records.selectedChildId === childId) openProfile();
  void selection;
}

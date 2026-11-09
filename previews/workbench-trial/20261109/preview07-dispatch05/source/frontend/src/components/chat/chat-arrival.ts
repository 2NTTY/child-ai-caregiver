// An explicit arrival event distinguishes a new reply from a history read.
// Previously observed IDs never replay when the recent-message window remounts them.
export function isNewReplyArrival(id: string, requestedId: string | undefined, knownIds: ReadonlySet<string>, previousLastId: string | undefined, currentIds: readonly string[]): boolean {
  if (id !== requestedId || knownIds.has(id)) return false;
  const index = currentIds.indexOf(id);
  if (index < 0) return false;
  if (previousLastId === undefined) return knownIds.size === 0;
  const previousLastIndex = currentIds.indexOf(previousLastId);
  return previousLastIndex >= 0 && index > previousLastIndex;
}

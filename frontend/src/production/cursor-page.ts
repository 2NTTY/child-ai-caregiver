/** A partial page must carry a usable continuation, including when it has no matches. */
export function cursorBoundary(page: { hasMore?: boolean; nextCursor?: string | null }, previous?: string | null) {
  const nextCursor = page.nextCursor ?? null;
  const hasMore = page.hasMore ?? nextCursor !== null;
  if (hasMore && (!nextCursor || nextCursor === previous) || !hasMore && nextCursor !== null) throw new Error('invalid_page_cursor');
  return { hasMore, nextCursor };
}
export function appendCursorItems<T extends { id: string }>(before: readonly T[], after: readonly T[]): T[] {
  const incoming = new Map(after.map(item => [item.id, item]));
  return [...before.map(item => incoming.get(item.id) ?? item), ...after.filter(item => !before.some(old => old.id === item.id))];
}

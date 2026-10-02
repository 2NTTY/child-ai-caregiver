// Local finite-page preview only. The cursor is an opaque synthetic token to callers.
export interface MemoryPreviewPage<T> { items: T[]; nextAfterId: string | null }

export function syntheticMemoryPage<T>(items: T[], afterId: string | null, pageSize = 50): MemoryPreviewPage<T> {
  const parsed = afterId === null ? 0 : /^fixture-([0-9a-z]+)$/.exec(afterId);
  if (parsed === null) throw new Error("Invalid synthetic memory cursor");
  const start = typeof parsed === "number" ? parsed : Number.parseInt(parsed[1], 36);
  if (!Number.isSafeInteger(start) || start < 0 || start > items.length) throw new Error("Invalid synthetic memory cursor");
  const end = Math.min(start + pageSize, items.length);
  return { items: items.slice(start, end), nextAfterId: end < items.length ? `fixture-${end.toString(36)}` : null };
}

export function appendMemoryPage<T>(loaded: T[], page: MemoryPreviewPage<T>, keyOf: (item: T) => string): MemoryPreviewPage<T> {
  const next = new Map(loaded.map(item => [keyOf(item), item]));
  for (const item of page.items) next.set(keyOf(item), item);
  return { items: [...next.values()], nextAfterId: page.nextAfterId };
}

export function loadedMemoryPages<T>(items: T[], count: number, keyOf: (item: T) => string): MemoryPreviewPage<T> {
  let result: MemoryPreviewPage<T> = { items: [], nextAfterId: null };
  let cursor: string | null = null;
  for (let index = 0; index < Math.max(1, count); index += 1) {
    const page: MemoryPreviewPage<T> = syntheticMemoryPage(items, cursor);
    result = appendMemoryPage(result.items, page, keyOf);
    cursor = page.nextAfterId;
    if (!cursor) break;
  }
  return result;
}

/** A bounded window into already-authorized, already-loaded rows; never fetches. */
export function historyPage<T>(items: readonly T[], requestedPage: number, pageSize = 20) {
  const page = Math.min(Math.max(0, requestedPage), Math.max(0, Math.ceil(items.length / pageSize) - 1));
  return { page, items: items.slice(page * pageSize, (page + 1) * pageSize), total: items.length, pageSize,
    hasPrevious: page > 0, hasNext: (page + 1) * pageSize < items.length };
}
export const historyVersionId = (id: string, version: string | number) => JSON.stringify([id, version]);
export type HistoryReaderRoute = { selectedId: string | null; page: number };
export type HistoryReaderNavigation = { route?: HistoryReaderRoute; onSelect?: (id: string | null) => void; onPageChange?: (page: number) => void };

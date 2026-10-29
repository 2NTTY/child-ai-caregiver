/** Replay an already read ID range with fresh cursors, never with cached old rows.
 * Both task and memory list APIs order stable IDs ascending. There is no cross-page
 * snapshot token: callers publish only after the whole range has been revalidated.
 */
export async function readLoadedIdWindow<T extends { items: { id: string }[]; nextAfterId: string | null }>(
  throughId: string | null, current: () => boolean, readPage: (after: string | null) => Promise<T>,
): Promise<T[]> {
  const pages: T[] = [];
  let after: string | null = null;
  do {
    if (!current()) throw new Error("Obsolete task or memory read");
    const page = await readPage(after);
    if (!current()) throw new Error("Obsolete task or memory read");
    let previous: string | null = after;
    for (const item of page.items) {
      if (previous !== null && item.id <= previous) throw new Error("Invalid task or memory page order");
      previous = item.id;
    }
    if (page.nextAfterId !== null && (!page.items.length || page.nextAfterId !== previous)) throw new Error("Invalid task or memory cursor");
    pages.push(page);
    if (page.nextAfterId === null || throughId === null || previous !== null && previous >= throughId) return pages;
    after = page.nextAfterId;
  } while (true);
}

import type { HistoryMatch } from '../src/shared/agent-work.ts';

/** Search walks one authorized page newest first. Keep a small chronological window without extra reads. */
export function historyNeighbors() {
  type Snippet = NonNullable<HistoryMatch['followingMessages']>[number];
  const newer: Snippet[] = [];
  let returned = 0;
  return {
    following() {
      const result = newer.slice(0, Math.max(0, 6 - returned));
      returned += result.length;
      return result;
    },
    observe(row: Omit<Snippet, 'totalCharacters'>) {
      newer.unshift({ ...row, text: row.text.slice(0, 140), totalCharacters: row.text.length });
      if (newer.length > 2) newer.pop();
    },
  };
}

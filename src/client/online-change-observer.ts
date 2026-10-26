import { publishOnlineRefresh } from "./online-refresh-events.ts";
import { sharedChangesPageSchema, sharedRefreshSelectionSchema, type SharedRefreshSelection } from "../shared/sharing.ts";
export type OnlineRefreshReason = "changed" | "forced" | "unavailable";
const uuid = /^[0-9a-f-]{36}$/iu;
const seq = /^(0|[1-9][0-9]{0,18})$/u;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** One identity's metadata cursor. Platform visibility owns start/stop; this never writes or repeats an operation. */
export function createOnlineChangeObserver(apiBaseUrl: string, userId: string,
  refresh: (reason: OnlineRefreshReason) => Promise<void>, fetcher: typeof fetch = fetch, selection?: SharedRefreshSelection) {
  const sharing = selection === undefined ? undefined : sharedRefreshSelectionSchema.parse(selection);
  const base = apiBaseUrl.replace(/\/$/u, ""), api = base.endsWith("/api") ? base : `${base}/api`;
  const cursors = new Map<string, { epoch: string; cursor: string; accessVersion: number | null }>();
  let sharedCursor: string | undefined;
  let busy = false, stopped = false;
  const abort = new AbortController();
  async function read(path: string) {
    if (stopped) throw new Error("Online observer stopped");
    // React Native's AbortSignal lacks any/timeout; keep this read deadline local and removable.
    const request = new AbortController();
    const cancel = () => request.abort();
    abort.signal.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(cancel, 10_000);
    try {
      const response = await fetcher(`${api}${path}`, { credentials: "include", cache: "no-store", signal: request.signal,
        headers: { Accept: "application/json", "x-expected-user-id": userId } });
      if (!response.ok) throw new Error("Online status unavailable");
      const value: unknown = await response.json();
      if (stopped || request.signal.aborted) throw new Error("Online observer stopped");
      return value;
    } finally { clearTimeout(timeout); abort.signal.removeEventListener("abort", cancel); }
  }
  const notify = async (reason: OnlineRefreshReason) => {
    if (stopped) return;
    await refresh(reason);
    if (!stopped) publishOnlineRefresh();
  };
  const check = async (force = false) => {
    if (busy || stopped) return;
    busy = true;
    try {
      if (sharing) {
        const query = new URLSearchParams({ spaceId: sharing.spaceId, childId: sharing.childId, module: sharing.module });
        if (sharedCursor !== undefined) query.set("cursor", sharedCursor);
        const page = sharedChangesPageSchema.safeParse(await read(`/online/shared-changes?${query}`));
        if (!page.success || page.data.spaceId !== sharing.spaceId || page.data.childId !== sharing.childId
          || page.data.module !== sharing.module) throw new Error("Invalid shared change page");
        sharedCursor = page.data.cursor;
        // Even when hasMore is true, leave the continuation to the next foreground check.
        if (page.data.changed || force) await notify(page.data.changed ? "changed" : "forced");
        return;
      }
      const body = await read("/online/spaces");
      if (!object(body) || !Array.isArray(body.workspaces)) throw new Error("Invalid online scopes");
      const seen = new Set<string>(); let changed = false;
      for (const value of body.workspaces) {
        if (!object(value) || typeof value.id !== "string" || !uuid.test(value.id) || typeof value.storageEpoch !== "string" || !uuid.test(value.storageEpoch)) throw new Error("Invalid online scope");
        const { id, storageEpoch } = value;
        seen.add(id);
        const prior = cursors.get(id);
        if (!prior || prior.epoch !== storageEpoch) { changed = true; cursors.set(id, { epoch: storageEpoch, cursor: "0", accessVersion: null }); }
        const current = cursors.get(id)!;
        const query = new URLSearchParams({ workspaceId: id, storageEpoch, cursor: current.cursor });
        const page = await read(`/online/changes?${query}`);
        if (!object(page) || page.workspaceId !== id || page.storageEpoch !== storageEpoch || typeof page.cursor !== "string" || !seq.test(page.cursor)
          || !Number.isSafeInteger(page.accessVersion) || !Array.isArray(page.changes) || typeof page.hasMore !== "boolean") throw new Error("Invalid online change page");
        if (page.changes.length || current.accessVersion !== page.accessVersion) changed = true;
        cursors.set(id, { epoch: storageEpoch, cursor: page.cursor, accessVersion: page.accessVersion as number });
      }
      for (const id of cursors.keys()) if (!seen.has(id)) { cursors.delete(id); changed = true; }
      if (changed || force) await notify(changed ? "changed" : "forced");
    } catch {
      sharedCursor = undefined;
      // A failed incremental read cannot confirm logout, deletion or successful writes.
      // Fresh normal reads still check identity and clear genuinely revoked scopes.
      if (!stopped) await notify("unavailable").catch(() => {});
    } finally { busy = false; }
  };
  return { check, dispose() { stopped = true; abort.abort(); } };
}

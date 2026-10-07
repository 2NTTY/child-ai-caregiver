import { useEffect, useRef } from "react";

export type OnlineRefreshReason = "changed" | "forced" | "unavailable";
export const ONLINE_REFRESH_EVENT = "yuban-online-refresh";
const uuid = /^[0-9a-f-]{36}$/iu;
const seq = /^(0|[1-9][0-9]{0,18})$/u;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Visible-page invalidations only. No writes, local storage, model calls or outbox. */
export function useOnlineUpdates(apiBaseUrl: string, userId: string | null, online: boolean, refresh: (reason: OnlineRefreshReason) => Promise<void>) {
  const latestRefresh = useRef(refresh); latestRefresh.current = refresh;
  useEffect(() => {
    if (!userId || !online || typeof window === "undefined") return;
    const base = apiBaseUrl.replace(/\/$/u, ""), api = base.endsWith("/api") ? base : `${base}/api`;
    const cursors = new Map<string, { epoch: string; cursor: string; accessVersion: number | null }>();
    let busy = false, stopped = false;
    const abort = new AbortController();
    async function read(path: string) {
      const response = await fetch(`${api}${path}`, { credentials: "include", cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]),
        headers: { Accept: "application/json", "x-expected-user-id": userId! } });
      if (!response.ok) throw new Error("Online status unavailable");
      return response.json() as Promise<unknown>;
    }
    const notify = async (reason: OnlineRefreshReason) => {
      if (stopped) return;
      await latestRefresh.current(reason);
      if (!stopped) window.dispatchEvent(new Event(ONLINE_REFRESH_EVENT));
    };
    const check = async (force = false) => {
      if (busy || stopped || document.visibilityState !== "visible") return;
      busy = true;
      try {
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
        // A failed incremental read cannot confirm logout, deletion or successful writes.
        // Fresh normal reads still check identity and clear genuinely revoked scopes.
        if (!stopped) await notify("unavailable").catch(() => {});
      } finally { busy = false; }
    };
    const event = () => { void check(true); };
    // Poll only metadata; domain owners retain invalidation until their write settles.
    const timer = setInterval(() => { void check(false); }, 5_000);
    window.addEventListener("focus", event);
    document.addEventListener("visibilitychange", event);
    event();
    return () => { stopped = true; clearInterval(timer); abort.abort(); window.removeEventListener("focus", event); document.removeEventListener("visibilitychange", event); };
  }, [apiBaseUrl, userId, online]);
}

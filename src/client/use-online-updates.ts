import { useEffect, useRef } from "react";
import { createOnlineChangeObserver, type OnlineRefreshReason } from "./online-change-observer.ts";
import type { SharedRefreshSelection } from "../shared/sharing.ts";
export type { OnlineRefreshReason } from "./online-change-observer.ts";
export { ONLINE_REFRESH_EVENT } from "./online-refresh-events.ts";

/** Same metadata protocol on both platforms; native activity is supplied by its device adapter. */
export function useOnlineUpdates(apiBaseUrl: string, userId: string | null, online: boolean,
  refresh: (reason: OnlineRefreshReason) => Promise<void>, fetcher: typeof fetch = fetch, nativeActive?: boolean,
  checkCurrentWork?: () => Promise<void>, selection?: SharedRefreshSelection) {
  const latestWork = useRef(checkCurrentWork); latestWork.current = checkCurrentWork;
  const latestRefresh = useRef(refresh); latestRefresh.current = refresh;
  useEffect(() => {
    const browser = nativeActive === undefined;
    if (!userId || !online || nativeActive === false
      || browser && (typeof window === "undefined" || typeof document === "undefined")) return;
    const observer = createOnlineChangeObserver(apiBaseUrl, userId, reason => latestRefresh.current(reason), fetcher, selection);
    const check = (force: boolean) => {
      if (!browser || document.visibilityState === "visible") {
        void latestWork.current?.();
        void observer.check(force);
      }
    };
    const event = () => check(true);
    const timer = setInterval(() => check(false), 5_000);
    if (browser) { window.addEventListener("focus", event); document.addEventListener("visibilitychange", event); }
    event();
    return () => {
      clearInterval(timer); observer.dispose();
      if (browser) { window.removeEventListener("focus", event); document.removeEventListener("visibilitychange", event); }
    };
  }, [apiBaseUrl, userId, online, fetcher, nativeActive, selection?.spaceId, selection?.childId, selection?.module]);
}

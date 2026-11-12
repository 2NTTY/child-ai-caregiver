import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { checkPushBrowserUser, ownedBrowserBinding, pushHomeScreen, suspendPushBrowser } from "../../../src/client/push-browser.ts";
import { createWebPushApi } from "../../../src/client/web-push-api.ts";
import type { ProductionOwner } from "./ProductionOwner";
import { webChatPresenceFor } from "./WebChatPresenceController";

export function useWebChatPresence(owner: ProductionOwner, identity: string | null, userId: string | null, childId: string | null, online: boolean) {
  const generation = owner.getSnapshot().sessionGeneration, previousUser = useRef<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (identity && userId) {
      previousUser.current = userId;
      void checkPushBrowserUser(userId, () => owner.getSnapshot().identityKey === identity && owner.getSnapshot().sessionGeneration === generation).catch(() => {});
    } else if (previousUser.current && !owner.getSnapshot().records.user) {
      previousUser.current = null; void suspendPushBrowser(() => !owner.getSnapshot().records.user && !owner.getSnapshot().identityKey).catch(() => {});
    }
    // Normal unmount leaves the installed worker active while the App is closed.
  }, [owner, identity, userId, generation]);
  useEffect(() => {
    if (Platform.OS !== "web" || !pushHomeScreen() || !identity || !userId || !online) return;
    const presence = webChatPresenceFor(owner, identity, userId), api = createWebPushApi(owner.apiBaseUrl, owner.fetcher, { version: 2 });
    const abort = new AbortController();
    const current = () => !abort.signal.aborted && owner.getSnapshot().identityKey === identity && owner.getSnapshot().sessionGeneration === generation;
    const update = () => {
      if (current()) void presence.foreground(document.visibilityState === "visible" && document.hasFocus() ? childId : null).catch(() => {});
    };
    void api.status(abort.signal, userId).then(async status => {
      const binding = await ownedBrowserBinding(status);
      if (!current()) return;
      presence.bind(binding); update();
    }).catch(() => {});
    document.addEventListener("visibilitychange", update); window.addEventListener("focus", update); window.addEventListener("blur", update);
    const heartbeat = setInterval(() => { if (childId && document.visibilityState === "visible" && document.hasFocus()) update(); }, 25_000);
    return () => {
      abort.abort(); api.resetOnline(); clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", update); window.removeEventListener("focus", update); window.removeEventListener("blur", update);
      void presence.foreground(null).catch(() => {});
    };
  }, [owner, identity, userId, childId, online, generation]);
}

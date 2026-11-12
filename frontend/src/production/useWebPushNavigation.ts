import { useEffect, useRef, useState } from "react";
import { useGlobalSearchParams } from "expo-router";
import { Platform } from "react-native";
import { browserPushSubscription, parseWebPushOpen } from "../../../src/client/push-browser.ts";
import { createWebPushApi, WebPushApiError, type WebPushChatTarget } from "../../../src/client/web-push-api.ts";
import { nativePushReferenceSchema, type NativePushReference } from "../../../src/shared/native-push.ts";
import type { ProductionOwner } from "./ProductionOwner";
const OPEN_STORAGE = "yuban-push-open-v1";

/** Keep the fixed wake-up tuple through login, then authorize its destination afresh. */
export function useWebPushNavigation(owner: ProductionOwner, identity: string | null, userId: string | null, online: boolean,
  navigate: (target: WebPushChatTarget) => void, notice: (message: string) => void) {
  const params = useGlobalSearchParams<{ pushBinding?: string; pushVersion?: string; pushDelivery?: string }>();
  const [pending, setPending] = useState<NativePushReference | null>(null), consumed = useRef<string | null>(null);
  const callbacks = useRef({ navigate, notice }); callbacks.current = { navigate, notice };
  const generation = owner.getSnapshot().sessionGeneration;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const capture = () => {
      let reference = parseWebPushOpen(window.location.href);
      try {
        if (reference) window.sessionStorage.setItem(OPEN_STORAGE, JSON.stringify(reference));
        else if (!["pushBinding", "pushVersion", "pushDelivery"].some(key => new URL(window.location.href).searchParams.has(key))) {
          const saved = nativePushReferenceSchema.safeParse(JSON.parse(window.sessionStorage.getItem(OPEN_STORAGE) ?? "null"));
          if (saved.success && saved.data.kind === "care") reference = saved.data;
        }
      } catch { /* In-memory recovery remains available if browser storage is blocked. */ }
      if (reference && JSON.stringify(reference) !== consumed.current) setPending(reference);
    };
    capture(); window.addEventListener("popstate", capture); window.addEventListener("pageshow", capture); window.addEventListener("focus", capture);
    return () => { window.removeEventListener("popstate", capture); window.removeEventListener("pageshow", capture); window.removeEventListener("focus", capture); };
  }, [params.pushBinding, params.pushVersion, params.pushDelivery]);
  useEffect(() => {
    if (Platform.OS !== "web" || !pending || !identity || !userId || !online) return;
    const api = createWebPushApi(owner.apiBaseUrl, owner.fetcher, { version: 2 }), abort = new AbortController();
    let retainForRecovery = false;
    const current = () => !abort.signal.aborted && owner.getSnapshot().identityKey === identity && owner.getSnapshot().sessionGeneration === generation;
    void (async () => {
      try { return await api.open(pending, abort.signal, userId); }
      catch (error) {
        if (!(error instanceof WebPushApiError) || error.status !== 409 || error.onlineCode !== "installation_proof_required" || !current()) throw error;
        const subscription = await browserPushSubscription();
        if (!subscription || !current()) throw error;
        return api.open(pending, abort.signal, userId, subscription);
      }
    })().then(target => { if (current()) callbacks.current.navigate(target); })
      .catch(error => {
        if (!current()) return;
        if (error instanceof WebPushApiError && (error.status === 401 || error.onlineCode === "session_changed")) {
          retainForRecovery = true; owner.handleDomainAccessError({ status: error.status, code: error.onlineCode });
          callbacks.current.notice("請重新登入，以核對通知的原聊天訊息。");
        } else {
          retainForRecovery = error instanceof WebPushApiError && (error.status === 0 || error.status >= 500);
          callbacks.current.notice("通知內容暫未能核對；請重新讀取原聊天或通知歷史。");
        }
      })
      .finally(() => {
        if (!current() || retainForRecovery) return;
        consumed.current = JSON.stringify(pending); setPending(null);
        try { if (window.sessionStorage.getItem(OPEN_STORAGE) === consumed.current) window.sessionStorage.removeItem(OPEN_STORAGE); } catch { /* Optional browser storage. */ }
        if (JSON.stringify(parseWebPushOpen(window.location.href)) === consumed.current) {
          const url = new URL(window.location.href);
          for (const key of ["pushBinding", "pushVersion", "pushDelivery"]) url.searchParams.delete(key);
          window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
        }
      });
    return () => { abort.abort(); api.resetOnline(); };
  }, [owner, identity, userId, generation, online, pending]);
}

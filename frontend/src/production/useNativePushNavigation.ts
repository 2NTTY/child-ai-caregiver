import { useEffect, useRef } from "react";
import { createNativePushApi, type NativePushTarget } from "../../../src/client/native-push-api.ts";
import { listenNativePush, clearNativePushOpen, nativePushSupported } from "../platform/native-push";
import type { ProductionOwner } from "./ProductionOwner";
/** Reauthorize a fixed reference; presentation never interprets a notification as an action. */
export function useNativePushNavigation(owner: ProductionOwner, identityKey: string | null, userId: string | null,
  navigate: (target: NativePushTarget) => void, notice: (message: string) => void) {
  const callbacks = useRef({ navigate, notice }); callbacks.current = { navigate, notice };
  const generation = owner.getSnapshot().sessionGeneration;
  useEffect(() => {
    if (!nativePushSupported() || !identityKey || !userId) return;
    const api = createNativePushApi(owner.apiBaseUrl, owner.fetcher), controller = new AbortController();
    let revision = 0;
    const current = () => !controller.signal.aborted && owner.getSnapshot().identityKey === identityKey && owner.getSnapshot().sessionGeneration === generation;
    const stop = listenNativePush({ tokenChanged() {}, opened(reference) {
      const expected = ++revision;
      void api.open(reference, controller.signal, userId).then(target => {
        if (current() && expected === revision) callbacks.current.navigate(target);
      }).catch(() => { if (current() && expected === revision) callbacks.current.notice("通知內容暫未能核對；請重新讀取原聊天、待辦或通知歷史。"); })
        .finally(() => { if (current()) { try { clearNativePushOpen(); } catch { /* Read/navigation outcome remains authoritative. */ } } });
    } });
    return () => { controller.abort(); stop(); api.resetOnline(); };
  }, [owner, identityKey, userId, generation]);
}

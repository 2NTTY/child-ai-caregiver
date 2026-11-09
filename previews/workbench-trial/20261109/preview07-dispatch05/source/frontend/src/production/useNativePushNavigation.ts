import { useEffect, useRef } from "react";
import { createNativePushApi, type NativePushTarget } from "../../../src/client/native-push-api.ts";
import { listenNativePush, clearNativePushOpen, nativePushSupported } from "../platform/native-push";
import type { ProductionOwner } from "./ProductionOwner";
/** Reauthorize a fixed reference; presentation never interprets a notification as an action. */
export function useNativePushNavigation(owner: ProductionOwner, identityKey: string | null, userId: string | null,
  navigate: (target: NativePushTarget) => void, notice: (message: string) => void) {
  const callbacks = useRef({ navigate, notice }); callbacks.current = { navigate, notice };
  useEffect(() => {
    if (!nativePushSupported() || !identityKey || !userId) return;
    const api = createNativePushApi(owner.apiBaseUrl, owner.fetcher), controller = new AbortController();
    const current = () => !controller.signal.aborted && owner.getSnapshot().identityKey === identityKey;
    const stop = listenNativePush({ tokenChanged() {}, opened(reference) {
      void api.open(reference, controller.signal, userId).then(target => {
        if (current()) callbacks.current.navigate(target);
      }).catch(() => { if (current()) callbacks.current.notice("通知事項暫未能核對；可在待辦及通知歷史查看。沒有執行或完成任何事項。"); })
        .finally(() => { if (current()) { try { clearNativePushOpen(); } catch { /* Read/navigation outcome remains authoritative. */ } } });
    } });
    return () => { controller.abort(); stop(); api.resetOnline(); };
  }, [owner, identityKey, userId]);
}

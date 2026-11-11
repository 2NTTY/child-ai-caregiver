import { useEffect } from "react";
import { AppState } from "react-native";
import { nativePushSupported, setNativePushForegroundCheck } from "../platform/native-push";
import type { ProductionOwner } from "./ProductionOwner";
import { nativeChatPresenceFor } from "./NativeChatPresenceController";
import { createNativePushApi } from "../../../src/client/native-push-api.ts";

export function useNativeChatPresence(owner: ProductionOwner, identity: string | null, userId: string | null, childId: string | null, online: boolean) {
  const generation = owner.getSnapshot().sessionGeneration;
  useEffect(() => {
    if (!nativePushSupported() || !identity || !userId) return;
    const presence = nativeChatPresenceFor(owner, identity, userId);
    let focused = AppState.currentState === "active";
    const update = () => { void presence.foreground(online && focused ? childId : null).catch(() => {}); };
    const app = AppState.addEventListener("change", state => { focused = state === "active"; update(); });
    // Android notification shade focus can change without an AppState transition.
    const blur = AppState.addEventListener("blur", () => { focused = false; update(); });
    const focus = AppState.addEventListener("focus", () => { focused = AppState.currentState === "active"; update(); });
    update();
    const timer = setInterval(() => { if (focused && online && childId) update(); }, 25_000);
    const api = createNativePushApi(owner.apiBaseUrl, owner.fetcher), abort = new AbortController();
    const stop = setNativePushForegroundCheck(async reference => {
      const target = await api.open(reference, abort.signal, userId);
      const current = owner.getSnapshot();
      if (abort.signal.aborted || current.identityKey !== identity || current.sessionGeneration !== generation) return false;
      return !(target.kind === "chat" && focused && AppState.currentState === "active" && childId === target.childId);
    });
    return () => { clearInterval(timer); app.remove(); blur.remove(); focus.remove(); stop(); abort.abort(); api.resetOnline(); void presence.foreground(null).catch(() => {}); };
  }, [owner, identity, userId, childId, online, generation]);
}

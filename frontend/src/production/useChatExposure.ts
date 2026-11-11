import { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { useProduction } from "./ProductionProvider";

export function useChatForeground() {
  const actual = () => Platform.OS === "web" ? typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus()
    : AppState.currentState === "active";
  const [active, setActive] = useState(actual);
  useEffect(() => {
    const update = () => setActive(actual()); update();
    if (Platform.OS === "web") {
      document.addEventListener("visibilitychange", update); window.addEventListener("focus", update); window.addEventListener("blur", update);
      return () => { document.removeEventListener("visibilitychange", update); window.removeEventListener("focus", update); window.removeEventListener("blur", update); };
    }
    const state = AppState.addEventListener("change", update), blur = AppState.addEventListener("blur", () => setActive(false)), focus = AppState.addEventListener("focus", update);
    return () => { state.remove(); blur.remove(); focus.remove(); };
  }, []);
  return active;
}

/** Only measured rows exposed on the foreground main chat may acknowledge a proactive message. */
export function useChatExposure(active: boolean, ids: readonly string[]) {
  const { owner, scopeKey, identityKey, userId, selectedChildId, sharedChild, chatState, online } = useProduction();
  const sent = useRef(new Set<string>());
  useEffect(() => { sent.current.clear(); }, [identityKey, scopeKey]);
  useEffect(() => {
    if (!active || !online || !scopeKey || !identityKey || !userId || !selectedChildId || sharedChild.target) return;
    const abort = new AbortController(), generation = owner.getSnapshot().sessionGeneration;
    const timer = setTimeout(() => {
      const snapshot = owner.getSnapshot();
      if (snapshot.identityKey !== identityKey || snapshot.sessionGeneration !== generation || snapshot.scopeKey !== scopeKey) return;
      for (const id of ids) {
      const message = chatState.messages.find(item => item.id === id);
      if (!message || message.role !== "model" || message.proactive !== true || sent.current.has(id)) continue;
      sent.current.add(id);
      const base = owner.apiBaseUrl.replace(/\/$/u, "");
      void owner.fetcher((base.endsWith("/api") ? base : base + "/api") + "/children/" + encodeURIComponent(selectedChildId) + "/chat/messages/" + encodeURIComponent(id) + "/seen", {
        method: "POST", cache: "no-store", signal: abort.signal, headers: { Accept: "application/json", "Content-Type": "application/json", "x-expected-user-id": userId }, body: "{}",
      }).then(response => {
        if (!response.ok && owner.getSnapshot().identityKey === identityKey && owner.getSnapshot().sessionGeneration === generation) sent.current.delete(id);
      }).catch(() => { if (owner.getSnapshot().identityKey === identityKey && owner.getSnapshot().sessionGeneration === generation) sent.current.delete(id); });
    } }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [active, online, scopeKey, identityKey, userId, selectedChildId, sharedChild.target, ids, chatState.messages, owner]);
}

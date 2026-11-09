import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useProductionOwner } from "../production/ProductionProvider";
import { usePreviewExternalGuard } from "./PreviewNavigationGuard";
import { createNativeCompareController, NATIVE_COMPARE_IDENTITY } from "./native-compare-long-lived-session.mjs";
import { prepareNativeCompareDocument } from "./native-compare-document.mjs";
import { openSyntheticPreviewComparisonRetirement } from "./synthetic-preview-runtime.mjs";

type NativePort = { read(): unknown; requestExternalNavigation(params: Record<string,string>, mode: "push" | "replace", lease: unknown): unknown; revoke(): void };
type ComparePort = { register(port: NativePort): () => void; changed(port: NativePort): void };
const Context = createContext<ComparePort | null>(null);
export const useNativeCompare = () => useContext(Context);

/** No second owner. Only this native provider captures the actual owner and guard. */
export function NativeCompareProvider({ children }: { children: ReactNode }) {
  const owner = useProductionOwner(), guard = usePreviewExternalGuard();
  const committed = useRef<{ owner: typeof owner; guard: typeof guard } | null>(null);
  const guardStop = useRef<(() => void) | null>(null), effectsStop = useRef<(() => void) | null>(null);
  const [bridge] = useState(() => createNativeCompareController({
    getContext() {
      const live = committed.current;
      if (!live) return null;
      const snapshot = live.owner.getSnapshot();
      return { owner: live.owner, scopeKey: snapshot.scopeKey, identityKey: snapshot.identityKey,
        childId: snapshot.records.selectedChildId, ready: snapshot.account.gate === "ready" && snapshot.records.online };
    },
    getGuard: () => committed.current?.guard ?? null,
    openRetirement: (expectedOwner: typeof owner) => openSyntheticPreviewComparisonRetirement(expectedOwner),
    stopOrdinaryObservers() {
      guardStop.current?.(); guardStop.current = null;
      effectsStop.current?.(); effectsStop.current = null;
    },
  }));
  useLayoutEffect(() => {
    committed.current = { owner, guard };
    const stop = guard?.subscribe(() => bridge.changed());
    guardStop.current = stop ?? null;
    bridge.changed();
    return () => { committed.current = null; stop?.(); guardStop.current = null; bridge.changed(); };
  }, [bridge, owner, guard]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const installation = prepareNativeCompareDocument({ realm: window, document: window.document,
      identity: NATIVE_COMPARE_IDENTITY, bridge });
    if (!installation) return;
    // Publish observer stop BEFORE start may synchronously emit the one notice.
    effectsStop.current = installation.stopObservers;
    installation.start();
    return () => {
      if (effectsStop.current === installation.stopObservers) effectsStop.current = null;
      installation.dispose();
    };
  }, [bridge]);
  return <Context.Provider value={bridge.port}>{children}</Context.Provider>;
}

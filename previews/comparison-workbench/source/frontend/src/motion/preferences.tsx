import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, AppState, Platform, useWindowDimensions } from "react-native";
import { canApplyInitialPreference } from "./lifecycle";
import { resolveReducedMotion } from "./preferencePolicy";

export type MotionPreferenceStorage = "loading" | "browser" | "session";
export interface MotionPreferences {
  reducedMotion: boolean; enabled: boolean; active: boolean; epoch: number;
  systemReducedMotion: boolean | null;
  manualReducedMotion: boolean;
  preferenceReady: boolean;
  preferenceStorage: MotionPreferenceStorage;
  setManualReducedMotion: (value: boolean) => void;
}
const MotionContext = createContext<MotionPreferences>({
  reducedMotion: true, enabled: false, active: false, epoch: 0, systemReducedMotion: null,
  manualReducedMotion: false, preferenceReady: false, preferenceStorage: "loading", setManualReducedMotion: () => {},
});

export function MotionProvider({ children }: { children: ReactNode }) {
  const [systemReducedMotion, setSystemReducedMotion] = useState<boolean | null>(null);
  const [systemPreferenceReady, setSystemPreferenceReady] = useState(false);
  const [manualReducedMotion, setManualState] = useState(false);
  const preferenceStorage: MotionPreferenceStorage = "session";
  const [active, setActive] = useState(() => Platform.OS === "web"
    ? typeof document !== "undefined" && !document.hidden
    : AppState.currentState === "active");
  const [epoch, setEpoch] = useState(0);
  const { width, height } = useWindowDimensions();
  const dimensions = useRef({ width, height });
  useEffect(() => {
    if (dimensions.current.width !== width || dimensions.current.height !== height) {
      dimensions.current = { width, height };
      setEpoch(value => value + 1);
    }
  }, [width, height]);

  // Workbench: session-only preference; no persisted state or cross-frame listeners.
  const setManualReducedMotion = useCallback((value: boolean) => setManualState(value), []);

  useEffect(() => {
    let mounted = true;
    if (Platform.OS === "web") {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") { setSystemPreferenceReady(true); return; }
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      const update = () => { setSystemReducedMotion(query.matches); setSystemPreferenceReady(true); };
      const visibility = () => { setActive(!document.hidden); setEpoch(value => value + 1); };
      update();
      query.addEventListener("change", update);
      document.addEventListener("visibilitychange", visibility);
      return () => { query.removeEventListener("change", update); document.removeEventListener("visibilitychange", visibility); };
    }
    let preferenceRevision = 0;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", value => { preferenceRevision += 1; setSystemReducedMotion(value); setSystemPreferenceReady(true); });
    const requestRevision = preferenceRevision;
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (canApplyInitialPreference(mounted, requestRevision, preferenceRevision)) { setSystemReducedMotion(value); setSystemPreferenceReady(true); }
    }, () => { if (mounted) setSystemPreferenceReady(true); });
    const app = AppState.addEventListener("change", state => { setActive(state === "active"); setEpoch(value => value + 1); });
    return () => { mounted = false; subscription.remove(); app.remove(); };
  }, []);
  const reducedMotion = resolveReducedMotion(systemReducedMotion, manualReducedMotion);
  const preferenceReady = systemPreferenceReady;
  return <MotionContext.Provider value={{ reducedMotion, active, enabled: active && preferenceReady && !reducedMotion, epoch,
    systemReducedMotion, manualReducedMotion, preferenceReady, preferenceStorage, setManualReducedMotion }}>{children}</MotionContext.Provider>;
}

export function useMotionPreferences() { return useContext(MotionContext); }

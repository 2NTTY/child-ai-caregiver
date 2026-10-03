import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, AppState, Platform, useWindowDimensions } from "react-native";
import { canApplyInitialPreference } from "./lifecycle";

const MotionContext = createContext({ reducedMotion: true, enabled: false, epoch: 0 });

export function MotionProvider({ children }: { children: ReactNode }) {
  const [reducedMotion, setReducedMotion] = useState(true);
  const [active, setActive] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const { width, height } = useWindowDimensions();
  const dimensions = useRef({ width, height });
  useEffect(() => {
    if (dimensions.current.width !== width || dimensions.current.height !== height) {
      dimensions.current = { width, height };
      setEpoch(value => value + 1);
    }
  }, [width, height]);
  useEffect(() => {
    let mounted = true;
    if (Platform.OS === "web") {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      const update = () => setReducedMotion(query.matches);
      const visibility = () => { setActive(!document.hidden); setEpoch(value => value + 1); };
      update();
      query.addEventListener("change", update);
      document.addEventListener("visibilitychange", visibility);
      return () => { query.removeEventListener("change", update); document.removeEventListener("visibilitychange", visibility); };
    }
    let preferenceRevision = 0;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", value => { preferenceRevision += 1; setReducedMotion(value); });
    const requestRevision = preferenceRevision;
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (canApplyInitialPreference(mounted, requestRevision, preferenceRevision)) setReducedMotion(value);
    }, () => {});
    const app = AppState.addEventListener("change", state => { setActive(state === "active"); setEpoch(value => value + 1); });
    return () => { mounted = false; subscription.remove(); app.remove(); };
  }, []);
  return <MotionContext.Provider value={{ reducedMotion, enabled: active && !reducedMotion, epoch }}>{children}</MotionContext.Provider>;
}

export function useMotionPreferences() { return useContext(MotionContext); }

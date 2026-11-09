import { useLayoutEffect, useRef, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useMotionPreferences } from "./preferences";
import { motionData } from "./viewProps";
import "./paperMotion.css";

export function MotionPaperScope({ children, reduced: explicitReduced }: { children: ReactNode; reduced?: boolean }) {
  const preferences = useMotionPreferences();
  const reduced = explicitReduced ?? (preferences.reducedMotion || !preferences.preferenceReady);
  const root = useRef<View>(null);
  useLayoutEffect(() => {
    if (!reduced) return;
    // These decorative spans are created imperatively by Paper. Only clear
    // descendants of our own stable scope, including owned modal surfaces.
    const node = root.current as unknown as HTMLElement | null;
    node?.querySelectorAll('[data-paper-ripple]').forEach(ripple => ripple.remove());
  }, [reduced]);
  return <View ref={root} {...motionData({ motionPaperScope: "true", motionReduced: reduced ? "true" : "false" })} style={styles.scope}>{children}</View>;
}
const styles = StyleSheet.create({ scope: { flex: 1, minWidth: 0, minHeight: 0 } });

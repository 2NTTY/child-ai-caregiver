import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "expo-router";
import type { View } from "react-native";
import { cancelAnimation, ReduceMotion, runOnJS, useSharedValue, withTiming } from "react-native-reanimated";
import { colors } from "../theme";
import { useMotionPreferences } from "./preferences";
import { motionTokens } from "./tokens";
import type { MotionBackdropProps } from "./MotionBackdrop";

const exitListenerId = -1;
// Only transient decorative exits are registered; live modal layers never are.
const pendingExits = new Set<() => void>();

/** The owner outlives RN Modal's focus trap; only an empty dim layer may exit. */
export function useModalBackdrop(open: boolean): Pick<MotionBackdropProps, "progress" | "phase" | "ref"> {
  const preferences = useMotionPreferences();
  const path = usePathname();
  const progress = useSharedValue(open && !preferences.enabled ? 1 : 0);
  const previous = useRef({ open: false, path, epoch: preferences.epoch });
  const generation = useRef(0);
  const portalHost = useRef<HTMLElement | null>(null);
  const exitNode = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState("settled");
  const ref = useCallback((view: View | null) => {
    if (!view) return;
    // The supplied ref belongs to our decorative layer. RN Web 0.21 places
    // its modal in a direct body portal; never query or copy the form tree.
    let host = view as unknown as HTMLElement;
    while (host.parentElement && host.parentElement !== document.body) host = host.parentElement;
    portalHost.current = host.parentElement === document.body ? host : null;
  }, []);
  const clearExit = useCallback(function clearOwnExit() {
    progress.removeListener(exitListenerId);
    exitNode.current?.remove(); exitNode.current = null;
    pendingExits.delete(clearOwnExit);
  }, [progress]);
  const complete = useCallback((token: number) => {
    if (token !== generation.current) return;
    clearExit(); setPhase("settled");
  }, [clearExit]);
  useLayoutEffect(() => {
    const old = previous.current; previous.current = { open, path, epoch: preferences.epoch };
    const token = ++generation.current;
    cancelAnimation(progress);
    if (!preferences.enabled || old.path !== path || old.epoch !== preferences.epoch || old.open === open) {
      clearExit(); progress.value = open ? 1 : 0; setPhase("settled"); return;
    }
    if (open) {
      // Keep the same value during a rapid reversal. The newly mounted live
      // backdrop replaces the exiting decoration without restarting at zero.
      // An older body host can reopen above a later host's fading decoration.
      // Drop only those exits; unrelated owners do not transfer their opacity.
      for (const clear of [...pendingExits]) clear();
      clearExit(); setPhase("entering");
    } else {
      clearExit();
      const host = portalHost.current;
      const opacity = Math.max(0, Math.min(1, progress.value));
      if (!host || host.parentElement !== document.body || opacity === 0) {
        progress.value = 0; setPhase("settled"); return;
      }
      const node = document.createElement("div");
      node.inert = true; node.setAttribute("aria-hidden", "true");
      node.dataset.motionKind = "modal-backdrop"; node.dataset.motionPhase = "exiting"; node.dataset.motionExit = "true";
      // Match RN Web ModalAnimation's z-index and preserve its body order.
      // In nested dialogs this sits above the parent and below newer modals.
      Object.assign(node.style, { position: "fixed", inset: "0", zIndex: "9999", pointerEvents: "none", userSelect: "none", backgroundColor: colors.overlay, opacity: String(opacity) });
      document.body.insertBefore(node, host); exitNode.current = node;
      progress.addListener(exitListenerId, value => { if (exitNode.current === node) node.style.opacity = String(value); });
      pendingExits.add(clearExit);
      setPhase("exiting");
    }
    progress.value = withTiming(open ? 1 : 0, { duration: open ? motionTokens.backdrop.enter : motionTokens.backdrop.exit, easing: motionTokens.ease, reduceMotion: ReduceMotion.System }, finished => {
      if (finished) runOnJS(complete)(token);
    });
  }, [open, path, preferences.enabled, preferences.epoch, progress, clearExit, complete]);
  useLayoutEffect(() => () => {
    generation.current += 1; cancelAnimation(progress); clearExit(); portalHost.current = null;
  }, [progress, clearExit]);
  return { progress, phase, ref };
}

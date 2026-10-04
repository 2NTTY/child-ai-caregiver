import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Animated, { cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { motionData, type MotionViewProps } from "./viewProps";
import { useMotionPreferences } from "./preferences";
import { motionTokens } from "./tokens";
import { drawerGeometry } from "./drawerGeometry";

export interface MotionDrawerRightProps extends MotionViewProps {
  open: boolean; width: number; scopeKey: string; mode: "dock" | "overlay";
  eligible?: boolean; animateOnMount?: boolean; surfaceRef?: Ref<View>;
  backdrop?: ReactNode;
}

/** A single live surface. Width and translation always use the same progress. */
export function MotionDrawerRight({ open, width, scopeKey, mode, eligible = true, animateOnMount = false, surfaceRef, backdrop, children, style, ...props }: MotionDrawerRightProps) {
  const preferences = useMotionPreferences();
  const progress = useSharedValue(!animateOnMount && open && eligible ? 1 : 0);
  const previous = useRef({ open: animateOnMount ? false : open, scopeKey, width, epoch: preferences.epoch });
  const currentScope = useRef(scopeKey);
  const generation = useRef(0);
  const mounted = useRef(true);
  const node = useRef<View>(null);
  const [present, setPresent] = useState(open && eligible);
  const [phase, setPhase] = useState("settled");
  const visible = eligible && (open || (present && currentScope.current === scopeKey));
  const complete = useCallback((token: number, opened: boolean) => {
    if (!mounted.current || token !== generation.current) return;
    setPresent(opened); setPhase("settled");
  }, []);
  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = { open, scopeKey, width, epoch: preferences.epoch };
    currentScope.current = scopeKey;
    const token = ++generation.current;
    cancelAnimation(progress);
    if (Platform.OS === "web" && node.current) (node.current as unknown as HTMLElement).inert = !open || !eligible;
    const target = open && eligible;
    const interrupted = old.scopeKey !== scopeKey || old.width !== width || old.epoch !== preferences.epoch || !preferences.enabled || !eligible;
    if (interrupted || old.open === open) {
      progress.value = target ? 1 : 0; setPresent(target); setPhase("settled"); return;
    }
    setPresent(true); setPhase(target ? "entering" : "exiting");
    progress.value = withTiming(target ? 1 : 0, { duration: target ? motionTokens.drawerRight.enter : motionTokens.drawerRight.exit, easing: motionTokens.ease, reduceMotion: ReduceMotion.System }, finished => {
      if (finished) runOnJS(complete)(token, target);
    });
  }, [open, width, scopeKey, eligible, preferences.enabled, preferences.epoch, progress, complete]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; cancelAnimation(progress); }; }, [progress]);
  const frame = useAnimatedStyle(() => ({ width: drawerGeometry(width, progress.value, mode).frameWidth }));
  const surface = useAnimatedStyle(() => ({ transform: [{ translateX: drawerGeometry(width, progress.value, mode).translateX }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  return <>
    {visible && backdrop ? <Animated.View {...motionData({ motionKind: "drawer-backdrop", motionPhase: phase })}
      accessible={false} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      pointerEvents={open && eligible ? "auto" : "none"} style={[StyleSheet.absoluteFill, backdropStyle]}>{backdrop}</Animated.View> : null}
    <Animated.View {...motionData({ motionKind: "drawer-right", motionMode: mode, motionPhase: phase })} style={[styles.frame, frame]} pointerEvents={open && eligible ? "auto" : "none"}>
    {visible ? <Animated.View {...props} ref={(value: View | null) => {
      node.current = value;
      if (typeof surfaceRef === "function") surfaceRef(value); else if (surfaceRef) surfaceRef.current = value;
    }} aria-hidden={!open || !eligible} accessibilityElementsHidden={!open || !eligible} importantForAccessibility={open && eligible ? "auto" : "no-hide-descendants"}
      style={[styles.surface, { width }, style, surface]}>{children}</Animated.View> : null}
    </Animated.View>
  </>;
}

const styles = StyleSheet.create({ frame: { height: "100%", flexShrink: 0, overflow: "hidden" }, surface: { position: "absolute", top: 0, right: 0, height: "100%" } });

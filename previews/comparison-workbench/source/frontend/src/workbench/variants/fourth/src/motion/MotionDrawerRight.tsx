import { useCallback, useLayoutEffect, useRef, useState, type Ref } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Animated, { cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { motionData, type MotionViewProps } from "./viewProps";
import { useMotionPreferences } from "./preferences";
import { motionTokens } from "./tokens";
import { drawerGeometry } from "./drawerGeometry";
import { MotionBackdrop } from "./MotionBackdrop";

export interface MotionDrawerRightProps extends MotionViewProps {
  open: boolean; width: number; scopeKey: string; mode: "dock" | "overlay";
  eligible?: boolean; animateOnMount?: boolean; surfaceRef?: Ref<View>;
  onBackdropPress?: () => void;
}

/** A single live surface. Dock allocation stays stable while its surface slides. */
export function MotionDrawerRight({ open, width, scopeKey, mode, eligible = true, animateOnMount = false, surfaceRef, onBackdropPress, children, style, ...props }: MotionDrawerRightProps) {
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
  // Keep the closing surface visible for its exit without resizing the page every frame.
  // Semantics follow open immediately; present is only decorative exit retention.
  const frame = { width: mode === "dock" && !visible ? 0 : width };
  const surface = useAnimatedStyle(() => ({ transform: [{ translateX: drawerGeometry(width, progress.value, mode).translateX }] }));
  return <>
    {visible && onBackdropPress ? <MotionBackdrop open={open && eligible} onPress={onBackdropPress} progress={progress} phase={phase} kind="drawer-backdrop" /> : null}
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

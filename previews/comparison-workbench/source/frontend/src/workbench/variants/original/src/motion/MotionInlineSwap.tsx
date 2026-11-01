import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Animated, { cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { motionData, type MotionViewProps } from "./viewProps";
import { useMotionPreferences } from "./preferences";
import { motionTokens } from "./tokens";

export interface MotionInlineSwapProps extends MotionViewProps {
  active: boolean; scopeKey: string; resetKey: string; primary: ReactNode;
}

/** Two live surfaces exchange a fixed slot; presentation never changes its size. */
export function MotionInlineSwap({ active, scopeKey, resetKey, primary, children, style, ...props }: MotionInlineSwapProps) {
  const preferences = useMotionPreferences();
  const progress = useSharedValue(active ? 1 : 0);
  const distance = useSharedValue(0);
  const frame = useRef<View>(null);
  const primaryRef = useRef<View>(null);
  const secondaryRef = useRef<View>(null);
  const [width, setWidth] = useState(0);
  const [phase, setPhase] = useState("settled");
  const previous = useRef({ active, scopeKey, resetKey, width, epoch: preferences.epoch });
  const generation = useRef(0);
  const mounted = useRef(true);
  const complete = useCallback((token: number) => {
    if (mounted.current && token === generation.current) setPhase("settled");
  }, []);

  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    if (primaryRef.current) (primaryRef.current as unknown as HTMLElement).inert = active;
    if (secondaryRef.current) (secondaryRef.current as unknown as HTMLElement).inert = !active;
    const measured = (frame.current as unknown as HTMLElement | null)?.getBoundingClientRect().width;
    if (measured && measured !== width) setWidth(measured);
  }, [active, width]);
  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = { active, scopeKey, resetKey, width, epoch: preferences.epoch };
    const token = ++generation.current;
    cancelAnimation(progress);
    distance.value = width;
    const interrupted = !preferences.enabled || old.scopeKey !== scopeKey || old.width !== width
      || old.epoch !== preferences.epoch || width <= 0;
    if (interrupted || old.active === active) {
      progress.value = active ? 1 : 0; setPhase("settled"); return;
    }
    // A reversal keeps the current progress. Other route changes settle above.
    setPhase(active ? "entering" : "exiting");
    progress.value = withTiming(active ? 1 : 0, {
      duration: motionTokens.route.duration, easing: motionTokens.ease, reduceMotion: ReduceMotion.System,
    }, finished => { if (finished) runOnJS(complete)(token); });
  }, [active, scopeKey, resetKey, width, preferences.enabled, preferences.epoch, progress, distance, complete]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; cancelAnimation(progress); };
  }, [progress]);
  const primaryStyle = useAnimatedStyle(() => ({ opacity: progress.value === 1 ? 0 : 1, transform: progress.value === 0 ? [] : [{ translateX: progress.value * distance.value }] }));
  const secondaryStyle = useAnimatedStyle(() => ({ opacity: progress.value === 0 ? 0 : 1, transform: progress.value === 1 ? [] : [{ translateX: (progress.value - 1) * distance.value }] }));
  return <View {...props} ref={frame} {...motionData({ ...props.dataSet, motionKind: "inline-swap", motionPhase: phase, motionActive: active ? "secondary" : "primary" })}
    onLayout={event => setWidth(event.nativeEvent.layout.width)} style={[styles.frame, style]}>
    <Animated.View ref={primaryRef} testID="header-brand-layer" pointerEvents={active ? "none" : "auto"}
      aria-hidden={active} accessibilityElementsHidden={active} importantForAccessibility={active ? "no-hide-descendants" : "auto"}
      style={[styles.surface, primaryStyle]}>{primary}</Animated.View>
    <Animated.View ref={secondaryRef} testID="header-context-layer" pointerEvents={active ? "auto" : "none"}
      aria-hidden={!active} accessibilityElementsHidden={!active} importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      style={[styles.surface, secondaryStyle]}>{children}</Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  frame: { position: "relative", minWidth: 0, overflow: "hidden" },
  surface: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, justifyContent: "center", minWidth: 0 },
});

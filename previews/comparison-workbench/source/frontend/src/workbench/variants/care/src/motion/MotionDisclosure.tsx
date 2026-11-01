import { motionData, type MotionViewProps } from "./viewProps";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Animated, { cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { motionTokens } from "./tokens";
import { useMotionPreferences } from "./preferences";

export interface MotionDisclosureProps extends MotionViewProps { expanded: boolean; scopeKey: string; measureWhileCollapsed?: boolean }
export function MotionDisclosure({ expanded, scopeKey, measureWhileCollapsed = false, style, children, ...props }: MotionDisclosureProps) {
  const preferences = useMotionPreferences();
  const opacity = useSharedValue(expanded ? 1 : 0);
  const inner = useRef<View>(null);
  const previous = useRef({ expanded, scopeKey, epoch: preferences.epoch });
  const token = useRef(0), mounted = useRef(true);
  const [running, setRunning] = useState(false);
  const done = useCallback((generation: number) => {
    if (mounted.current && generation === token.current) setRunning(false);
  }, []);
  useLayoutEffect(() => {
    if (Platform.OS === "web" && inner.current) (inner.current as unknown as HTMLElement).inert = !expanded;
    const old = previous.current; previous.current = { expanded, scopeKey, epoch: preferences.epoch };
    const generation = ++token.current;
    cancelAnimation(opacity);
    if (!expanded || old.expanded || old.scopeKey !== scopeKey || old.epoch !== preferences.epoch || !preferences.enabled) {
      opacity.value = expanded ? 1 : 0; setRunning(false); return;
    }
    // The disclosure takes its natural layout now; only new content fades in.
    opacity.value = 0; setRunning(true);
    opacity.value = withTiming(1, { duration: motionTokens.disclosure.duration, easing: motionTokens.ease, reduceMotion: ReduceMotion.System }, finished => {
      if (finished) runOnJS(done)(generation);
    });
  }, [expanded, scopeKey, preferences.enabled, preferences.epoch, opacity, done]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; token.current += 1; cancelAnimation(opacity); };
  }, [opacity]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View {...props} {...motionData({ ...props.dataSet, motionKind: "disclosure", motionPhase: running ? "entering" : "settled" })}
    style={[styles.outer, style, expanded ? styles.expanded : measureWhileCollapsed ? styles.measurableCollapsed : styles.collapsed, animatedStyle]} pointerEvents={expanded ? "auto" : "none"}>
    <View ref={inner} aria-hidden={!expanded} accessibilityElementsHidden={!expanded} importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}>{children}</View>
  </Animated.View>;
}
const styles = StyleSheet.create({
  outer: { overflow: "hidden", minWidth: 0 },
  expanded: { height: "auto", display: "flex" },
  collapsed: { height: 0, display: "none" },
  // Preserve the optional measurable collapsed subtree without animating its size.
  measurableCollapsed: { height: 0, display: "flex" },
});

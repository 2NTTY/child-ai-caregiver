import { motionData, type MotionViewProps } from "./viewProps";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View, type ViewProps } from "react-native";
import Animated, { cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { motionTokens } from "./tokens";
import { useMotionPreferences } from "./preferences";
import { disclosureStartHeight } from "./lifecycle";

export interface MotionDisclosureProps extends MotionViewProps { expanded: boolean; scopeKey: string }
export function MotionDisclosure({ expanded, scopeKey, style, children, ...props }: MotionDisclosureProps) {
  const preferences = useMotionPreferences();
  const height = useSharedValue(0);
  const measured = useRef(0);
  const awaitingMeasure = useRef(false);
  const inner = useRef<View>(null);
  const previous = useRef({ expanded, scopeKey, epoch: preferences.epoch });
  const token = useRef(0);
  const mounted = useRef(true);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const done = useCallback((generation: number) => { if (mounted.current && generation === token.current) { runningRef.current = false; setRunning(false); } }, []);
  useLayoutEffect(() => {
    if (Platform.OS === "web" && inner.current) (inner.current as unknown as HTMLElement).inert = !expanded;
    const old = previous.current; previous.current = { expanded, scopeKey, epoch: preferences.epoch };
    const inFlight = runningRef.current, currentHeight = height.value;
    const generation = ++token.current; cancelAnimation(height);
    if (old.expanded === expanded || old.scopeKey !== scopeKey || old.epoch !== preferences.epoch || !preferences.enabled) {
      height.value = expanded ? measured.current : 0; awaitingMeasure.current = false; runningRef.current = false; setRunning(false); return;
    }
    height.value = disclosureStartHeight(expanded, inFlight, measured.current, currentHeight);
    awaitingMeasure.current = false; runningRef.current = true; setRunning(true);
    if (expanded && measured.current <= 0) { awaitingMeasure.current = true; return; }
    height.value = withTiming(expanded ? measured.current : 0, { duration: motionTokens.disclosure.duration, easing: motionTokens.ease, reduceMotion: ReduceMotion.System }, finished => { if (finished) runOnJS(done)(generation); });
  }, [expanded, scopeKey, preferences.enabled, preferences.epoch, height, done]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; token.current += 1; cancelAnimation(height); }; }, [height]);
  const animatedStyle = useAnimatedStyle(() => ({ height: running ? height.value : expanded ? undefined : 0, display: !expanded && !running ? "none" : "flex" }));
  return <Animated.View {...props} {...motionData({ ...props.dataSet, motionKind: "disclosure", motionPhase: running ? "resizing" : "settled" })} style={[styles.outer, style, animatedStyle]} pointerEvents={expanded ? "auto" : "none"}>
    <View ref={inner} aria-hidden={!expanded} accessibilityElementsHidden={!expanded} importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}
      onLayout={event => { measured.current = event.nativeEvent.layout.height;
        if (expanded && awaitingMeasure.current && measured.current > 0) {
          awaitingMeasure.current = false; const generation = token.current;
          height.value = withTiming(measured.current, { duration: motionTokens.disclosure.duration, easing: motionTokens.ease, reduceMotion: ReduceMotion.System }, finished => { if (finished) runOnJS(done)(generation); });
        } else if (expanded && !running) height.value = measured.current; }}>{children}</View>
  </Animated.View>;
}
const styles = StyleSheet.create({ outer: { overflow: "hidden", minWidth: 0 } });

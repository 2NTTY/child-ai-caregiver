import { motionData, type MotionViewProps } from "./viewProps";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View, type ViewProps } from "react-native";
import { Text } from "react-native-paper";
import Animated, { cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { colors, spacing } from "../theme";
import { motionTokens } from "./tokens";
import { useMotionPreferences } from "./preferences";
import type { MotionPhase } from "./MotionReveal";
import { isCurrentPresentation, type PresentationStamp } from "./lifecycle";

export interface MotionScopeBoundaryProps extends MotionViewProps { scopeKey: string; eligible?: boolean }
export function MotionScopeBoundary({ scopeKey, eligible = true, children, style, ...props }: MotionScopeBoundaryProps) {
  const preferences = useMotionPreferences();
  const previous = useRef({ scopeKey, epoch: preferences.epoch });
  const generation = useRef(0);
  const token = useRef(0);
  const operation = useRef<PresentationStamp | null>(null);
  const mounted = useRef(true);
  const node = useRef<View>(null);
  const width = useSharedValue(0), progress = useSharedValue(1);
  const measured = useRef(0);
  const [state, setState] = useState({ scopeKey, generation: 0, epoch: preferences.epoch, phase: "settled" as MotionPhase });
  const latest = useRef({ scopeKey, epoch: preferences.epoch, enabled: preferences.enabled, eligible });
  latest.current = { scopeKey, epoch: preferences.epoch, enabled: preferences.enabled, eligible };
  const covered = useCallback((current: number) => {
    const active = operation.current, now = latest.current;
    if (mounted.current && active && active.generation === current && isCurrentPresentation(active, { generation: token.current, scopeKey: now.scopeKey, epoch: now.epoch }) && now.enabled && now.eligible)
      setState({ ...active, phase: "swapping" });
  }, []);
  const complete = useCallback((current: number) => {
    const active = operation.current, now = latest.current;
    if (mounted.current && active && active.generation === current && isCurrentPresentation(active, { generation: token.current, scopeKey: now.scopeKey, epoch: now.epoch })) {
      operation.current = null; setState({ ...active, phase: "settled" });
    }
  }, []);
  const mismatch = state.scopeKey !== scopeKey;
  const conceal = preferences.enabled && eligible && (mismatch || state.phase === "covering");
  useLayoutEffect(() => {
    if (Platform.OS === "web" && node.current) (node.current as unknown as HTMLElement).inert = conceal;
  }, [conceal]);
  useLayoutEffect(() => {
    const old = previous.current; previous.current = { scopeKey, epoch: preferences.epoch };
    if (old.scopeKey === scopeKey && old.epoch === preferences.epoch && preferences.enabled && eligible) return;
    const current = ++token.current; cancelAnimation(progress);
    if (old.scopeKey !== scopeKey) generation.current += 1;
    if (old.scopeKey === scopeKey || !preferences.enabled || !eligible || old.epoch !== preferences.epoch || measured.current <= 0) {
      progress.value = 1; operation.current = null; setState({ scopeKey, generation: current, epoch: preferences.epoch, phase: "settled" }); return;
    }
    operation.current = { scopeKey, generation: current, epoch: preferences.epoch };
    progress.value = -1; setState({ ...operation.current, phase: "covering" });
    progress.value = withTiming(0, { duration: motionTokens.scope.cover, easing: motionTokens.coverEase, reduceMotion: ReduceMotion.System }, finished => { if (finished) runOnJS(covered)(current); });
  }, [scopeKey, eligible, preferences.enabled, preferences.epoch, progress, covered]);
  useLayoutEffect(() => {
    const active = operation.current, now = latest.current;
    if (state.phase !== "swapping" || !active || !isCurrentPresentation(state, active)
      || !isCurrentPresentation(state, { generation: token.current, scopeKey: now.scopeKey, epoch: now.epoch }) || !now.enabled || !now.eligible) return;
    const current = state.generation;
    setState({ ...state, phase: "revealing" });
    progress.value = withTiming(1, { duration: motionTokens.scope.reveal, easing: motionTokens.ease, reduceMotion: ReduceMotion.System }, finished => { if (finished) runOnJS(complete)(current); });
  }, [state.phase, state.scopeKey, state.generation, state.epoch, scopeKey, progress, complete]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; token.current += 1; cancelAnimation(progress); }; }, [progress]);
  const curtain = useAnimatedStyle(() => ({ transform: [{ translateX: progress.value * width.value }] }));
  const moving = preferences.enabled && eligible && state.scopeKey === scopeKey && state.phase !== "settled";
  return <View {...props} testID={props.testID ?? "motion-child-scope"} style={[styles.boundary, style]} {...motionData({ ...props.dataSet, motionKind: "scope", motionPhase: mismatch ? "covering" : state.phase, motionScopeGeneration: String(generation.current) })}
    onLayout={event => { measured.current = event.nativeEvent.layout.width; width.value = measured.current; props.onLayout?.(event); }}>
    <View ref={node} style={[styles.content, conceal && styles.concealed]} pointerEvents={conceal ? "none" : "auto"} aria-hidden={conceal} accessibilityElementsHidden={conceal} importantForAccessibility={conceal ? "no-hide-descendants" : "auto"}>{children}</View>
    {conceal ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.placeholder]}><Text>正在切換孩子…</Text></View> : null}
    {moving ? <Animated.View testID="motion-child-curtain" {...motionData({ motionOverlay: "true" })} pointerEvents="none" accessible={false} aria-hidden={true} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, styles.curtain, curtain]} /> : null}
  </View>;
}
const styles = StyleSheet.create({
  boundary: { position: "relative", overflow: "hidden", minWidth: 0, minHeight: 0 },
  content: { flex: 1, minWidth: 0, minHeight: 0 }, concealed: { opacity: 0 },
  placeholder: { backgroundColor: colors.canvas, justifyContent: "center", alignItems: "center", padding: spacing.lg },
  curtain: { zIndex: 2, backgroundColor: motionTokens.scope.color },
});

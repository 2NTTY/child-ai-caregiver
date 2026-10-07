import { motionData, type MotionViewProps } from "./viewProps";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import Animated, { cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { colors, spacing } from "../theme";
import { motionTokens } from "./tokens";
import { useMotionPreferences } from "./preferences";
import type { MotionPhase } from "./MotionReveal";
import { isCurrentPresentation, type PresentationStamp } from "./lifecycle";

type ScopePresentation = PresentationStamp & { resetKey: string };
const delayedStatusMs = 5000;

export interface MotionScopeBoundaryProps extends MotionViewProps { scopeKey: string; resetKey?: string; eligible?: boolean; childKey?: string | null }
export function MotionScopeBoundary({ scopeKey, resetKey = "", eligible = true, childKey = scopeKey, children, style, ...props }: MotionScopeBoundaryProps) {
  const preferences = useMotionPreferences();
  const previous = useRef({ scopeKey, resetKey, childKey, eligible, epoch: preferences.epoch });
  const generation = useRef(0);
  const token = useRef(0);
  const operation = useRef<ScopePresentation | null>(null);
  const mounted = useRef(true);
  const node = useRef<View>(null);
  const width = useSharedValue(0), progress = useSharedValue(1);
  const measured = useRef(0);
  const [state, setState] = useState({ scopeKey, resetKey, generation: 0, epoch: preferences.epoch, phase: "settled" as MotionPhase });
  const [delayedStatus, setDelayedStatus] = useState<ScopePresentation | null>(null);
  const waiting = preferences.enabled && eligible && state.scopeKey === scopeKey && state.resetKey === resetKey
    && state.epoch === preferences.epoch && (state.phase === "covering" || state.phase === "swapping");
  const latest = useRef({ scopeKey, resetKey, epoch: preferences.epoch, enabled: preferences.enabled, eligible, waiting });
  latest.current = { scopeKey, resetKey, epoch: preferences.epoch, enabled: preferences.enabled, eligible, waiting };
  const covered = useCallback((current: number) => {
    const active = operation.current, now = latest.current;
    if (mounted.current && active && active.generation === current && active.resetKey === now.resetKey && isCurrentPresentation(active, { generation: token.current, scopeKey: now.scopeKey, epoch: now.epoch }) && now.enabled && now.eligible)
      setState({ ...active, phase: "swapping" });
  }, []);
  const complete = useCallback((current: number) => {
    const active = operation.current, now = latest.current;
    if (mounted.current && active && active.generation === current && active.resetKey === now.resetKey && isCurrentPresentation(active, { generation: token.current, scopeKey: now.scopeKey, epoch: now.epoch })) {
      // An interrupted animation ends presentation; it must not leave a false busy state.
      operation.current = null; progress.value = 1; setState({ ...active, phase: "settled" });
    }
  }, [progress]);
  const mismatch = state.scopeKey !== scopeKey;
  const conceal = preferences.enabled && eligible && (mismatch || waiting);
  useLayoutEffect(() => {
    if (Platform.OS === "web" && node.current) (node.current as unknown as HTMLElement).inert = conceal;
  }, [conceal]);
  useLayoutEffect(() => {
    const old = previous.current; previous.current = { scopeKey, resetKey, childKey, eligible, epoch: preferences.epoch };
    if (old.scopeKey === scopeKey && old.resetKey === resetKey && old.epoch === preferences.epoch && preferences.enabled && eligible) return;
    const current = ++token.current; cancelAnimation(progress);
    if (old.scopeKey !== scopeKey) generation.current += 1;
    if (!old.eligible || !old.childKey || !childKey || old.childKey === childKey || old.scopeKey === scopeKey || old.resetKey !== resetKey || !preferences.enabled || !eligible || old.epoch !== preferences.epoch || measured.current <= 0) {
      progress.value = 1; operation.current = null; setState({ scopeKey, resetKey, generation: current, epoch: preferences.epoch, phase: "settled" }); return;
    }
    operation.current = { scopeKey, resetKey, generation: current, epoch: preferences.epoch };
    progress.value = -1; setState({ ...operation.current, phase: "covering" });
    progress.value = withTiming(0, { duration: motionTokens.scope.cover, easing: motionTokens.coverEase, reduceMotion: ReduceMotion.System }, finished => { if (finished) runOnJS(covered)(current); else runOnJS(complete)(current); });
  }, [scopeKey, resetKey, childKey, eligible, preferences.enabled, preferences.epoch, progress, covered, complete]);
  useLayoutEffect(() => {
    const active = operation.current, now = latest.current;
    if (state.phase !== "swapping" || !active || active.resetKey !== now.resetKey || !isCurrentPresentation(state, active)
      || !isCurrentPresentation(state, { generation: token.current, scopeKey: now.scopeKey, epoch: now.epoch }) || !now.enabled || !now.eligible) return;
    const current = state.generation;
    setState({ ...state, phase: "revealing" });
    progress.value = withTiming(1, { duration: motionTokens.scope.reveal, easing: motionTokens.ease, reduceMotion: ReduceMotion.System }, () => { runOnJS(complete)(current); });
  }, [state.phase, state.scopeKey, state.generation, state.epoch, scopeKey, resetKey, progress, complete]);
  useLayoutEffect(() => {
    setDelayedStatus(null);
    const active = operation.current;
    if (!waiting || !active) return;
    // Only the current concealed presentation may announce a prolonged wait.
    // This timer never holds the curtain or delays a data/route operation.
    const timer = setTimeout(() => {
      const now = latest.current;
      if (mounted.current && now.waiting && active.resetKey === now.resetKey && operation.current === active
        && isCurrentPresentation(active, { generation: token.current, scopeKey: now.scopeKey, epoch: now.epoch })) setDelayedStatus(active);
    }, delayedStatusMs);
    return () => clearTimeout(timer);
  }, [waiting, state.generation, state.scopeKey, state.epoch, resetKey]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; token.current += 1; cancelAnimation(progress); }; }, [progress]);
  const curtain = useAnimatedStyle(() => ({ transform: [{ translateX: progress.value * width.value }] }));
  const moving = preferences.enabled && eligible && state.scopeKey === scopeKey && state.resetKey === resetKey
    && state.epoch === preferences.epoch && state.phase !== "settled";
  const showDelayedStatus = waiting && delayedStatus !== null && delayedStatus.resetKey === resetKey && isCurrentPresentation(delayedStatus, state);
  return <View {...props} testID={props.testID ?? "motion-child-scope"} style={[styles.boundary, style]} {...motionData({ ...props.dataSet, motionKind: "scope", motionPhase: mismatch ? "covering" : state.phase, motionScopeGeneration: String(generation.current) })}
    onLayout={event => { measured.current = event.nativeEvent.layout.width; width.value = measured.current; props.onLayout?.(event); }}>
    <View ref={node} style={[styles.content, conceal && styles.concealed]} pointerEvents={conceal ? "none" : "auto"} aria-hidden={conceal} accessibilityElementsHidden={conceal} importantForAccessibility={conceal ? "no-hide-descendants" : "auto"}>{children}</View>
    {conceal ? <View pointerEvents="none" accessible={false} aria-hidden={true} style={[StyleSheet.absoluteFill, styles.placeholder]} /> : null}
    {moving ? <Animated.View testID="motion-child-curtain" {...motionData({ motionOverlay: "true" })} pointerEvents="none" accessible={false} aria-hidden={true} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, styles.curtain, curtain]} /> : null}
    {showDelayedStatus ? <View testID="motion-child-delayed-status" pointerEvents="none" accessibilityLiveRegion="polite"
      style={[StyleSheet.absoluteFill, styles.delayedStatus]}>
      {preferences.reducedMotion ? null : <ActivityIndicator size={20} color={colors.teal} animating={preferences.enabled} />}
      <Text>正在切換孩子…</Text>
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  boundary: { position: "relative", overflow: "hidden", minWidth: 0, minHeight: 0 },
  content: { flex: 1, minWidth: 0, minHeight: 0 }, concealed: { opacity: 0 },
  placeholder: { backgroundColor: colors.canvas, justifyContent: "center", alignItems: "center", padding: spacing.lg },
  curtain: { zIndex: 2, backgroundColor: motionTokens.scope.color },
  delayedStatus: { zIndex: 3, justifyContent: "center", alignItems: "center", gap: spacing.sm, padding: spacing.lg },
});

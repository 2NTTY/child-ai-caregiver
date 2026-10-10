import { motionData, type MotionViewProps } from "./viewProps";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import Animated, { cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { colors, spacing } from "../theme";
import { AppButton } from "../components/ui";
import { motionTokens } from "./tokens";
import { useMotionPreferences } from "./preferences";
import type { MotionPhase } from "./MotionReveal";
import type { StartupReadiness } from "../startup/dataReadiness";
import { isCurrentPresentation, type PresentationStamp } from "./lifecycle";

type ScopePresentation = PresentationStamp & { resetKey: string; fromChild: string };
type ScopeState = PresentationStamp & { resetKey: string; phase: MotionPhase };
const recoveryAfterMs = 15000;

export interface MotionScopeBoundaryProps extends MotionViewProps {
  scopeKey: string; resetKey?: string; eligible?: boolean; childKey?: string | null;
  readiness?: StartupReadiness; readinessKey?: string; onRetry?: () => void; onReturn?: (childKey: string) => void; canReturn?: (childKey: string) => boolean;
}
export function MotionScopeBoundary({ scopeKey, resetKey = "", eligible = true, childKey = scopeKey,
  readiness = "ready", readinessKey = "", onRetry, onReturn, canReturn, children, style, ...props }: MotionScopeBoundaryProps) {
  const preferences = useMotionPreferences();
  const previous = useRef({ scopeKey, resetKey, childKey, eligible, epoch: preferences.epoch, enabled: preferences.enabled });
  const generation = useRef(0), token = useRef(0), mounted = useRef(true);
  const operation = useRef<ScopePresentation | null>(null), node = useRef<View>(null);
  const width = useSharedValue(0), progress = useSharedValue(1), measured = useRef(0);
  const [state, setState] = useState<ScopeState>({ scopeKey, resetKey, generation: 0, epoch: preferences.epoch, phase: "settled" });
  const [timedOut, setTimedOut] = useState<ScopePresentation | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const latest = useRef({ scopeKey, resetKey, epoch: preferences.epoch, enabled: preferences.enabled, eligible, readiness, readinessKey });
  latest.current = { scopeKey, resetKey, epoch: preferences.epoch, enabled: preferences.enabled, eligible, readiness, readinessKey };
  const currentOperation = useCallback((current: number) => {
    const active = operation.current, now = latest.current;
    return mounted.current && active && active.generation === current && active.resetKey === now.resetKey && now.eligible
      && isCurrentPresentation(active, { generation: token.current, scopeKey: now.scopeKey, epoch: now.epoch }) ? active : null;
  }, []);
  const complete = useCallback((current: number) => {
    const active = currentOperation(current); if (!active) return;
    // Animation completion never substitutes for current child/route readiness.
    if (latest.current.readiness !== "ready") { progress.value = 0; setState({ ...active, phase: "swapping" }); return; }
    operation.current = null; progress.value = 1; setState({ ...active, phase: "settled" });
  }, [currentOperation, progress]);
  const reveal = useCallback((current: number) => {
    const active = currentOperation(current); if (!active || latest.current.readiness !== "ready") return;
    if (!latest.current.enabled || measured.current <= 0) { complete(current); return; }
    setState({ ...active, phase: "revealing" });
    progress.value = withTiming(1, { duration: motionTokens.scope.reveal, easing: motionTokens.ease, reduceMotion: ReduceMotion.System }, () => { runOnJS(complete)(current); });
  }, [currentOperation, complete, progress]);
  const covered = useCallback((current: number) => {
    const active = currentOperation(current); if (!active) return;
    if (latest.current.readiness === "ready") reveal(current);
    else { progress.value = 0; setState({ ...active, phase: "swapping" }); }
  }, [currentOperation, reveal, progress]);
  const mismatch = state.scopeKey !== scopeKey;
  const active = operation.current;
  const current = !!active && active.scopeKey === scopeKey && active.resetKey === resetKey;
  const waiting = eligible && current && (state.phase === "covering" || state.phase === "swapping" || readiness !== "ready");
  // Conceal synchronously before effects and independently of animation preferences.
  const conceal = eligible && (mismatch || waiting);
  useLayoutEffect(() => {
    if (Platform.OS === "web" && node.current) (node.current as unknown as HTMLElement).inert = conceal;
  }, [conceal]);
  useLayoutEffect(() => {
    const old = previous.current; previous.current = { scopeKey, resetKey, childKey, eligible, epoch: preferences.epoch, enabled: preferences.enabled };
    if (old.scopeKey === scopeKey && old.resetKey === resetKey && old.epoch === preferences.epoch && old.enabled === preferences.enabled && old.eligible === eligible) return;
    const continuing = operation.current?.scopeKey === scopeKey && operation.current.resetKey === resetKey && eligible ? operation.current : null;
    const changedChild = old.eligible && old.childKey && childKey && old.childKey !== childKey && old.scopeKey !== scopeKey && old.resetKey === resetKey && eligible;
    const current = ++token.current; cancelAnimation(progress);
    if (old.scopeKey !== scopeKey) generation.current += 1;
    if (!changedChild && !continuing) {
      progress.value = 1; operation.current = null; setState({ scopeKey, resetKey, generation: current, epoch: preferences.epoch, phase: "settled" }); return;
    }
    operation.current = { scopeKey, resetKey, generation: current, epoch: preferences.epoch, fromChild: continuing?.fromChild ?? old.childKey! };
    // Reduced motion and interrupted presentations retain a static privacy barrier.
    if (continuing || !preferences.enabled || measured.current <= 0) {
      progress.value = 0; setState({ ...operation.current, phase: "swapping" }); return;
    }
    progress.value = -1; setState({ ...operation.current, phase: "covering" });
    progress.value = withTiming(0, { duration: motionTokens.scope.cover, easing: motionTokens.coverEase, reduceMotion: ReduceMotion.System }, () => { runOnJS(covered)(current); });
  }, [scopeKey, resetKey, childKey, eligible, preferences.enabled, preferences.epoch, progress, covered]);
  useLayoutEffect(() => {
    const active = operation.current; if (!active || !currentOperation(active.generation)) return;
    if (state.phase === "swapping" && readiness === "ready") reveal(active.generation);
    else if (state.phase === "revealing" && readiness !== "ready") {
      // A new required read/route during reveal must be covered in this render too.
      cancelAnimation(progress); progress.value = 0; setState({ ...active, phase: "swapping" });
    }
  }, [state.phase, state.generation, readiness, readinessKey, currentOperation, reveal, progress]);
  useLayoutEffect(() => {
    setTimedOut(null);
    const active = operation.current; if (!waiting || !active) return;
    const timer = setTimeout(() => {
      if (!currentOperation(active.generation) || latest.current.readinessKey !== readinessKey) return;
      if (latest.current.readiness === "ready") { cancelAnimation(progress); complete(active.generation); }
      else setTimedOut(active);
    }, recoveryAfterMs);
    return () => clearTimeout(timer);
  }, [waiting, state.generation, readinessKey, retryAttempt, currentOperation, progress, complete]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; token.current += 1; operation.current = null; cancelAnimation(progress); }; }, [progress]);
  const curtain = useAnimatedStyle(() => ({ transform: [{ translateX: progress.value * width.value }] }));
  const moving = eligible && current && state.phase !== "settled";
  const recovery = waiting && (readiness === "error" || timedOut !== null && !!active && isCurrentPresentation(timedOut, active));
  const showStatus = waiting && (state.phase === "swapping" || recovery);
  return <View {...props} testID={props.testID ?? "motion-child-scope"} style={[styles.boundary, style]}
    {...motionData({ ...props.dataSet, motionKind: "scope", motionPhase: mismatch ? "covering" : state.phase, motionScopeGeneration: String(generation.current), motionData: readiness })}
    onLayout={event => { measured.current = event.nativeEvent.layout.width; width.value = measured.current; props.onLayout?.(event); }}>
    <View ref={node} aria-busy={waiting} style={[styles.content, conceal && styles.concealed]} pointerEvents={conceal ? "none" : "auto"} aria-hidden={conceal} accessibilityElementsHidden={conceal} importantForAccessibility={conceal ? "no-hide-descendants" : "auto"}>{children}</View>
    {conceal ? <View pointerEvents="none" accessible={false} aria-hidden={true} style={[StyleSheet.absoluteFill, styles.placeholder]} /> : null}
    {moving ? <Animated.View testID="motion-child-curtain" {...motionData({ motionOverlay: "true" })} pointerEvents="none" accessible={false} aria-hidden={true} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, styles.curtain, curtain]} /> : null}
    {showStatus ? <View testID={recovery ? "motion-child-recovery" : "motion-child-loading"} style={[StyleSheet.absoluteFill, styles.status]}>
      <View accessibilityLiveRegion="polite" style={styles.message}>
        {!recovery && preferences.enabled ? <ActivityIndicator size={20} color={colors.teal} /> : null}
        <Text>{recovery ? readiness === "error" ? "未能載入這位孩子的資料。" : "載入時間較長，尚未完成。" : "正在載入孩子及本頁資料…"}</Text>
      </View>
      {recovery ? <View style={styles.actions}>
        {onRetry ? <AppButton label="重新載入" onPress={() => { if (!active || !currentOperation(active.generation) || latest.current.readinessKey !== readinessKey) return; setRetryAttempt(value => value + 1); onRetry(); }} /> : null}
        {onReturn && active && (canReturn?.(active.fromChild) ?? true) ? <AppButton label="返回上一位孩子" variant="quiet" onPress={() => { if (currentOperation(active.generation) && latest.current.readinessKey === readinessKey) onReturn(active.fromChild); }} /> : null}
      </View> : null}
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  boundary: { position: "relative", overflow: "hidden", minWidth: 0, minHeight: 0 },
  content: { flex: 1, minWidth: 0, minHeight: 0 }, concealed: { opacity: 0 },
  placeholder: { backgroundColor: colors.canvas }, curtain: { zIndex: 2, backgroundColor: motionTokens.scope.color },
  status: { zIndex: 3, justifyContent: "center", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  message: { alignItems: "center", gap: spacing.sm }, actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm },
});

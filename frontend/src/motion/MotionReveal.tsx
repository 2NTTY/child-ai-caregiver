import { motionData, type MotionViewProps } from "./viewProps";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useMotionPreferences } from "./preferences";
import { motionTokens } from "./tokens";
import { isCurrentPresentation, type PresentationStamp } from "./lifecycle";

export type MotionTrigger = string | number | null;
export type MotionPhase = "idle" | "covering" | "swapping" | "revealing" | "settled";
export interface MotionRevealProps<T> {
  value: T; contentKey: string; scopeKey: string; regionKey: string;
  /** New intent can be armed while pending; null explicitly cancels it on failure/unknown. */
  triggerKey: MotionTrigger; eligible: boolean; preset?: "local" | "summary";
  children: (displayed: T) => ReactNode; style?: StyleProp<ViewStyle>; testID?: string;
}

export function MotionReveal<T>({ value, contentKey, scopeKey, regionKey, triggerKey, eligible, preset = "local", children, style, testID }: MotionRevealProps<T>) {
  const preferences = useMotionPreferences();
  const progress = useSharedValue(1);
  const width = useSharedValue(0);
  const widthRef = useRef(0);
  const region = useRef<View>(null);
  const mounted = useRef(true);
  const token = useRef(0);
  const armed = useRef(false);
  const lastIntent = useRef(triggerKey);
  const targetKey = useRef<string | null>(null);
  const operation = useRef<(PresentationStamp & { triggerKey: MotionTrigger; contentKey: string }) | null>(null);
  const previous = useRef({ scopeKey, triggerKey, epoch: preferences.epoch });
  const scopeGeneration = useRef(0);
  const contentRevision = useRef({ key: contentKey, serial: 1 });
  if (contentRevision.current.key !== contentKey) contentRevision.current = { key: contentKey, serial: contentRevision.current.serial + 1 };
  const contentSerial = contentRevision.current.serial;
  const latest = useRef({ value, contentKey, contentSerial, scopeKey, eligible, triggerKey, enabled: preferences.enabled, epoch: preferences.epoch });
  latest.current = { value, contentKey, contentSerial, scopeKey, eligible, triggerKey, enabled: preferences.enabled, epoch: preferences.epoch };
  const [display, setDisplay] = useState({ value, contentKey, contentSerial, scopeKey, generation: 0, epoch: preferences.epoch, phase: "idle" as MotionPhase });
  const displayRef = useRef(display); displayRef.current = display;
  const settle = useCallback(() => {
    token.current += 1; targetKey.current = null; operation.current = null;
    cancelAnimation(progress); progress.value = 1;
    if (mounted.current) {
      const current = latest.current;
      setDisplay({ value: current.value, contentKey: current.contentKey, contentSerial: current.contentSerial, scopeKey: current.scopeKey, generation: token.current, epoch: current.epoch, phase: "settled" });
    }
  }, [progress]);
  const covered = useCallback((generation: number) => {
    const current = latest.current;
    const active = operation.current;
    if (!mounted.current || !active || !isCurrentPresentation(active, { generation: token.current, scopeKey: current.scopeKey, epoch: current.epoch }) || generation !== active.generation
      || !current.enabled || !current.eligible || current.triggerKey === null || current.triggerKey !== active.triggerKey || current.contentKey !== active.contentKey) return;
    // This React commit puts the new read-only projection under the fully opaque curtain.
    setDisplay({ value: current.value, contentKey: current.contentKey, contentSerial: current.contentSerial, scopeKey: current.scopeKey, generation: active.generation, epoch: active.epoch, phase: "swapping" });
  }, []);
  const revealed = useCallback((generation: number) => {
    if (mounted.current && generation === token.current) { targetKey.current = null; operation.current = null; setDisplay(current => ({ ...current, phase: "settled" })); }
  }, []);

  useLayoutEffect(() => {
    const old = previous.current;
    const changedScope = old.scopeKey !== scopeKey;
    const changedTrigger = old.triggerKey !== triggerKey;
    previous.current = { scopeKey, triggerKey, epoch: preferences.epoch };
    if (changedScope || old.epoch !== preferences.epoch || !preferences.enabled) {
      if (changedScope) scopeGeneration.current += 1;
      armed.current = false; lastIntent.current = triggerKey; settle(); return;
    }
    if (triggerKey === null) { armed.current = false; settle(); return; }
    if (changedTrigger && lastIntent.current !== triggerKey) { armed.current = true; lastIntent.current = triggerKey; }
    if (!eligible) {
      // Pending retains intent. Callers explicitly pass null for failed/unknown outcomes.
      if (displayRef.current.phase === "covering" || displayRef.current.phase === "revealing" || displayRef.current.phase === "swapping" || displayRef.current.contentKey !== contentKey) settle();
      return;
    }
    if (!armed.current) {
      if (targetKey.current === contentKey) return;
      if (displayRef.current.contentKey !== contentKey) settle();
      return;
    }
    armed.current = false;
    if (Platform.OS === "web" && region.current) {
      const measured = (region.current as unknown as HTMLElement).getBoundingClientRect().width;
      if (measured > 0) { widthRef.current = measured; width.value = measured; }
    }
    if (displayRef.current.contentKey === contentKey || widthRef.current <= 0) { settle(); return; }
    const generation = ++token.current; targetKey.current = contentKey;
    operation.current = { generation, scopeKey, epoch: preferences.epoch, triggerKey, contentKey };
    cancelAnimation(progress); progress.value = -1;
    setDisplay(current => ({ ...current, generation, epoch: preferences.epoch, phase: "covering" }));
    progress.value = withTiming(0, { duration: motionTokens[preset].cover, easing: motionTokens.coverEase, reduceMotion: ReduceMotion.System }, finished => { if (finished) runOnJS(covered)(generation); });
  }, [value, contentKey, scopeKey, triggerKey, eligible, preferences.enabled, preferences.epoch, preset, progress, covered, settle]);

  useLayoutEffect(() => {
    const current = latest.current;
    const active = operation.current;
    if (display.phase !== "swapping" || !active || !isCurrentPresentation(display, active)
      || !isCurrentPresentation(display, { generation: token.current, scopeKey: current.scopeKey, epoch: current.epoch })
      || !current.enabled || !current.eligible || current.triggerKey === null || current.triggerKey !== active.triggerKey
      || display.contentKey !== targetKey.current || display.contentKey !== current.contentKey) return;
    const generation = display.generation;
    // This effect runs after the replacement layout has committed, not after a timer.
    setDisplay(current => ({ ...current, phase: "revealing" }));
    progress.value = withTiming(1, { duration: motionTokens[preset].reveal, easing: motionTokens.ease, reduceMotion: ReduceMotion.System }, finished => { if (finished) runOnJS(revealed)(generation); });
  }, [display.phase, display.scopeKey, display.generation, display.epoch, display.contentKey, preset, progress, revealed]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; token.current += 1; cancelAnimation(progress); }; }, [progress]);
  const curtain = useAnimatedStyle(() => ({ transform: [{ translateX: progress.value * width.value }] }));
  const sameScope = display.scopeKey === scopeKey;
  const phase = sameScope ? display.phase : "settled";
  const moving = sameScope && preferences.enabled && triggerKey !== null && ["covering", "swapping", "revealing"].includes(phase);
  return <View ref={region} testID={testID} style={[styles.region, style]} {...motionData({ motionKind: "reveal", motionRegion: regionKey, motionPhase: phase, motionContent: String(sameScope ? display.contentSerial : contentSerial), motionScopeGeneration: String(scopeGeneration.current) })}
    onLayout={event => { const next = event.nativeEvent.layout.width; if (next > 0) { widthRef.current = next; width.value = next; } }}>
    {children(sameScope && moving ? display.value : value)}
    {moving ? <Animated.View testID={`motion-curtain-${regionKey}`} pointerEvents="none" accessible={false} aria-hidden={true} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" {...motionData({ motionOverlay: "true" })} style={[StyleSheet.absoluteFill, styles.curtain, { backgroundColor: motionTokens[preset].color }, curtain]} /> : null}
  </View>;
}
const styles = StyleSheet.create({ region: { position: "relative", overflow: "hidden", minWidth: 0 }, curtain: { zIndex: 1 } });

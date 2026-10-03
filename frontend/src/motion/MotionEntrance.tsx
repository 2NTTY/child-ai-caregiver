import { motionData, type MotionViewProps } from "./viewProps";
import { useCallback, useLayoutEffect, useRef, useState, type Ref } from "react";
import { type View, type ViewProps } from "react-native";
import Animated, { cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useMotionPreferences } from "./preferences";
import { motionTokens } from "./tokens";
import type { MotionTrigger } from "./MotionReveal";

export type MotionEntrancePreset = "message" | "dialog" | "item-add" | "detail-add" | "panel" | "route" | "detail-forward" | "detail-back";
export interface MotionEntranceProps extends MotionViewProps {
  triggerKey: MotionTrigger; scopeKey: string; preset: MotionEntrancePreset;
  enabled?: boolean; animateOnMount?: boolean; ref?: Ref<View>;
}

export function MotionEntrance({ triggerKey, scopeKey, preset, enabled = true, animateOnMount = false, style, children, ...props }: MotionEntranceProps) {
  const preferences = useMotionPreferences();
  const progress = useSharedValue(1);
  const token = useRef(0);
  const mounted = useRef(true);
  const first = useRef(true);
  const previous = useRef({ scopeKey, triggerKey, epoch: preferences.epoch });
  const [running, setRunning] = useState(false);
  const config = preset === "item-add" ? motionTokens.add : preset === "detail-add" ? motionTokens.detailAdd : preset.startsWith("detail-") ? motionTokens.detail : motionTokens[preset as "message" | "dialog" | "panel" | "route"];
  const horizontal = preset === "route" || preset === "detail-forward" || preset === "detail-back";
  const distance = preset === "detail-back" ? -config.distance : config.distance;
  const completed = useCallback((generation: number) => { if (mounted.current && generation === token.current) setRunning(false); }, []);
  useLayoutEffect(() => {
    const old = previous.current;
    const initial = first.current; first.current = false;
    previous.current = { scopeKey, triggerKey, epoch: preferences.epoch };
    const generation = ++token.current;
    cancelAnimation(progress);
    if (!preferences.enabled || !enabled || triggerKey === null || old.scopeKey !== scopeKey || old.epoch !== preferences.epoch || (initial ? !animateOnMount : old.triggerKey === triggerKey)) {
      progress.value = 1; setRunning(false); return;
    }
    progress.value = 0; setRunning(true);
    progress.value = withTiming(1, { duration: config.duration, easing: motionTokens.ease, reduceMotion: ReduceMotion.System }, finished => { if (finished) runOnJS(completed)(generation); });
  }, [triggerKey, scopeKey, enabled, preferences.enabled, preferences.epoch, animateOnMount, progress, config.duration, completed]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; token.current += 1; cancelAnimation(progress); }; }, [progress]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: progress.value, transform: progress.value === 1 ? [] : horizontal ? [{ translateX: (1 - progress.value) * distance }] : [{ translateY: (1 - progress.value) * distance }] }));
  return <Animated.View {...props} {...motionData({ ...props.dataSet, motionKind: preset, motionPhase: running ? "entering" : "settled" })} style={[style, animatedStyle]}>{children}</Animated.View>;
}

export interface MotionDetailProps extends MotionViewProps {
  activeKey: string; scopeKey: string; direction: "forward" | "back" | "none"; compact: boolean; animateOnMount?: boolean;
}
export function MotionDetail({ activeKey, scopeKey, direction, compact, animateOnMount = false, ...props }: MotionDetailProps) {
  return <MotionEntrance {...props} triggerKey={activeKey} scopeKey={scopeKey} enabled={compact && direction !== "none"} animateOnMount={animateOnMount && compact && direction !== "none"} preset={direction === "back" ? "detail-back" : "detail-forward"} />;
}

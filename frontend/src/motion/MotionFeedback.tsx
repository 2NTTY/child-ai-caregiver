import { motionData, type MotionViewProps } from "./viewProps";
import { useLayoutEffect, useRef } from "react";
import type { ViewProps } from "react-native";
import Animated, { cancelAnimation, interpolateColor, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useMotionPreferences } from "./preferences";
import { motionTokens } from "./tokens";
import type { MotionTrigger } from "./MotionReveal";

export interface MotionFeedbackProps extends MotionViewProps { active: boolean; triggerKey: MotionTrigger; scopeKey: string; animateOnMount?: boolean }
export function MotionFeedback({ active, triggerKey, scopeKey, animateOnMount = false, children, style, ...props }: MotionFeedbackProps) {
  const preferences = useMotionPreferences();
  const progress = useSharedValue(0);
  const previous = useRef({ triggerKey, scopeKey, epoch: preferences.epoch });
  const lastIntent = useRef(triggerKey);
  const first = useRef(true);
  useLayoutEffect(() => {
    const old = previous.current; previous.current = { triggerKey, scopeKey, epoch: preferences.epoch };
    cancelAnimation(progress);
    const initial = first.current; first.current = false;
    const changed = triggerKey !== null && (triggerKey !== lastIntent.current || (initial && animateOnMount));
    if (triggerKey !== null) lastIntent.current = triggerKey;
    if (active && changed && old.scopeKey === scopeKey && old.epoch === preferences.epoch && preferences.enabled) {
      progress.value = 1;
      progress.value = withTiming(0, { duration: motionTokens.feedback.duration, easing: motionTokens.ease, reduceMotion: ReduceMotion.System });
    } else progress.value = 0;
  }, [active, triggerKey, scopeKey, animateOnMount, preferences.enabled, preferences.epoch, progress]);
  useLayoutEffect(() => () => cancelAnimation(progress), [progress]);
  const animatedStyle = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(progress.value, [0, 1], ["rgba(226,236,227,0)", motionTokens.feedback.color]) }));
  return <Animated.View {...props} {...motionData({ ...props.dataSet, motionKind: "feedback" })} style={[style, animatedStyle]}>{children}</Animated.View>;
}

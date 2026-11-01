import { useCallback, useLayoutEffect, useRef, useState, type Ref } from "react";
import { StyleSheet, type View } from "react-native";
import Animated, { cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { colors } from "../theme";
import { useMotionPreferences } from "./preferences";
import { motionTokens } from "./tokens";
import { motionData } from "./viewProps";

export interface MotionBackdropProps {
  open: boolean;
  ref?: Ref<View>;
  onPress?: () => void;
  /** An enclosing drawer owns this progress, including its noninteractive exit. */
  progress?: SharedValue<number>;
  phase?: string;
  kind?: "modal-backdrop" | "drawer-backdrop";
}

/** One decorative dim layer; it never owns modal focus or delays closing. */
export function MotionBackdrop({ open, onPress, progress, phase, ref, kind = "modal-backdrop" }: MotionBackdropProps) {
  const preferences = useMotionPreferences();
  const ownProgress = useSharedValue(open && !preferences.enabled ? 1 : 0);
  const previous = useRef({ open: false, epoch: preferences.epoch });
  const generation = useRef(0);
  const [ownPhase, setOwnPhase] = useState("settled");
  const complete = useCallback((token: number) => {
    if (token === generation.current) setOwnPhase("settled");
  }, []);
  useLayoutEffect(() => {
    if (progress) return;
    const old = previous.current; previous.current = { open, epoch: preferences.epoch };
    const token = ++generation.current;
    cancelAnimation(ownProgress);
    if (!open || !preferences.enabled || old.epoch !== preferences.epoch || old.open === open) {
      ownProgress.value = open ? 1 : 0; setOwnPhase("settled"); return;
    }
    ownProgress.value = 0; setOwnPhase("entering");
    ownProgress.value = withTiming(1, { duration: motionTokens.backdrop.enter, easing: motionTokens.ease, reduceMotion: ReduceMotion.System }, finished => {
      if (finished) runOnJS(complete)(token);
    });
  }, [open, progress, preferences.enabled, preferences.epoch, ownProgress, complete]);
  useLayoutEffect(() => () => { generation.current += 1; cancelAnimation(ownProgress); }, [ownProgress]);
  const opacity = progress ?? ownProgress;
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View ref={ref} {...motionData({ motionKind: kind, motionPhase: phase ?? ownPhase })}
    accessible={false} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    pointerEvents={open && onPress ? "auto" : "none"}
    onStartShouldSetResponder={() => open && !!onPress} onResponderRelease={() => { if (open) onPress?.(); }}
    style={[StyleSheet.absoluteFill, styles.dim, animatedStyle]} />;
}

const styles = StyleSheet.create({ dim: { backgroundColor: colors.overlay } });

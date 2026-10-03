import { motionData, type MotionViewProps } from "./viewProps";
import { useLayoutEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import Animated, { cancelAnimation, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { colors } from "../theme";
import { useMotionPreferences } from "./preferences";
import { motionTokens } from "./tokens";

export function MotionSelectionMarker({ x, width, selectionKey }: { x: number; width: number; selectionKey: string }) {
  const preferences = useMotionPreferences();
  const left = useSharedValue(x), size = useSharedValue(width);
  const previous = useRef({ selectionKey, epoch: preferences.epoch, ready: width > 0 });
  useLayoutEffect(() => {
    const old = previous.current; previous.current = { selectionKey, epoch: preferences.epoch, ready: width > 0 };
    cancelAnimation(left); cancelAnimation(size);
    if (!preferences.enabled || old.epoch !== preferences.epoch || !old.ready || old.selectionKey === selectionKey) { left.value = x; size.value = width; return; }
    const config = { duration: motionTokens.selection.duration, easing: motionTokens.ease, reduceMotion: ReduceMotion.System };
    left.value = withTiming(x, config); size.value = withTiming(width, config);
  }, [x, width, selectionKey, preferences.enabled, preferences.epoch, left, size]);
  useLayoutEffect(() => () => { cancelAnimation(left); cancelAnimation(size); }, [left, size]);
  const animated = useAnimatedStyle(() => ({ width: size.value, transform: [{ translateX: left.value }] }));
  return <Animated.View pointerEvents="none" accessible={false} aria-hidden={true} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" {...motionData({ motionKind: "selection" })} style={[styles.marker, animated]} />;
}
const styles = StyleSheet.create({ marker: { position: "absolute", height: 2, bottom: 0, left: 0, backgroundColor: colors.teal } });

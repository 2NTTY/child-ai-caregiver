import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { cancelAnimation, ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { useMotionPreferences } from "../motion/preferences";
import { chineseFont, colors, typeScale } from "../theme";

function LoadingDot({ index, enabled }: { index: number; enabled: boolean }) {
  const offset = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(offset); offset.value = 0;
    if (enabled) offset.value = withDelay(index * 140, withRepeat(withSequence(
      withTiming(-3, { duration: 180, reduceMotion: ReduceMotion.System }),
      withTiming(0, { duration: 180, reduceMotion: ReduceMotion.System }),
      withTiming(0, { duration: 640, reduceMotion: ReduceMotion.System }),
    ), -1, false, undefined, ReduceMotion.System));
    return () => { cancelAnimation(offset); offset.value = 0; };
  }, [enabled, index, offset]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: enabled ? offset.value : 0 }] }));
  return <Animated.View testID={`startup-loading-dot-${index}`} style={[styles.dotSlot, style]}><Text style={styles.text}>.</Text></Animated.View>;
}

export function StartupLoadingLabel({ label }: { label: string }) {
  const { enabled } = useMotionPreferences();
  return <View testID="startup-loading-label" accessible accessibilityRole="text" accessibilityLabel={`${label}…`} style={styles.row}>
    <Text accessible={false} aria-hidden style={styles.text}>{label}</Text>
    <View accessible={false} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.dots}>
      {[0, 1, 2].map(index => <LoadingDot key={index} index={index} enabled={enabled} />)}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" }, dots: { flexDirection: "row", width: 18, height: 24 }, dotSlot: { width: 6, height: 24 },
  text: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 24 },
});

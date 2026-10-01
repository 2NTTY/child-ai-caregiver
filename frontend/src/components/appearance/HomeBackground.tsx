import { useId } from "react";
import { Image, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useBackground } from "../../preview/BackgroundContext";

export function HomeBackground({ surface, protectFullWidth = false, fadeBottom = false, wideIllustration = false }: { surface: string; protectFullWidth?: boolean; fadeBottom?: boolean; wideIllustration?: boolean }) {
  const { source, selected } = useBackground();
  const fade = useId();
  const bottom = `${fade}-bottom`;
  return <View aria-hidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={StyleSheet.absoluteFill}>
    <Image testID="home-background-image" source={source} accessible={false} resizeMode="cover" style={[styles.image, wideIllustration && !selected && styles.wideIllustration]} />
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} aria-hidden focusable={false}>
      <Defs>
        <LinearGradient id={fade} x1={0} y1={0} x2={1} y2={0}>
          <Stop offset={0} stopColor={surface} stopOpacity={1} />
          <Stop offset={0.64} stopColor={surface} stopOpacity={1} />
          <Stop offset={0.88} stopColor={surface} stopOpacity={protectFullWidth ? 0.94 : 0} />
          <Stop offset={1} stopColor={surface} stopOpacity={protectFullWidth ? 0.94 : 0} />
        </LinearGradient>
        <LinearGradient id={bottom} x1={0} y1={0} x2={0} y2={1}>
          <Stop offset={0.7} stopColor={surface} stopOpacity={0} />
          <Stop offset={1} stopColor={surface} stopOpacity={1} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${fade})`} />
      {fadeBottom ? <Rect width="100%" height="100%" fill={`url(#${bottom})`} /> : null}
    </Svg>
  </View>;
}
const styles = StyleSheet.create({
  image: { ...StyleSheet.absoluteFill, width: "100%", height: "100%" },
  wideIllustration: { left: "50%", right: 0, width: "50%" },
});

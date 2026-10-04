import { useId, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useBackground } from "../../preview/BackgroundContext";
import { useFirstScreenImage } from "../../startup/FirstScreenGate";

export function HomeBackground({ surface, protectFullWidth = false, fadeBottom = false, wideIllustration = false, fitIllustration = false }: { surface: string; protectFullWidth?: boolean; fadeBottom?: boolean; wideIllustration?: boolean; fitIllustration?: boolean }) {
  const { source, selected } = useBackground();
  const fade = useId();
  const bottom = `${fade}-bottom`;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const wholeIllustration = fitIllustration && !selected;
  const illustrationHeight = Math.min(size.height, size.width / (1672 / 941));
  const startupImage = useFirstScreenImage("home-hero", !wholeIllustration || illustrationHeight > 0);
  const illustrationFadeStart = Math.max(0.42, size.width > 0 ? 1 - illustrationHeight * (1672 / 941) / size.width : 0.42);
  return <View aria-hidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={StyleSheet.absoluteFill}
    onLayout={wholeIllustration ? ({ nativeEvent: { layout } }) => setSize(current => current.width === layout.width && current.height === layout.height ? current : { width: layout.width, height: layout.height }) : undefined}>
    {!startupImage.fallback || selected ? <Image testID="home-background-image" source={source} accessible={false} resizeMode={wholeIllustration ? "contain" : "cover"}
      onLoad={startupImage.onLoad} onError={startupImage.onError}
      style={[styles.image, wideIllustration && !selected && styles.wideIllustration,
        wholeIllustration && { left: "auto", right: 0, width: illustrationHeight * (1672 / 941), height: illustrationHeight, top: (size.height - illustrationHeight) / 2, opacity: illustrationHeight > 0 ? 1 : 0 }]} /> : null}
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} aria-hidden focusable={false}>
      <Defs>
        <LinearGradient id={fade} x1={0} y1={0} x2={1} y2={0}>
          <Stop offset={0} stopColor={surface} stopOpacity={1} />
          <Stop offset={wholeIllustration ? illustrationFadeStart : 0.64} stopColor={surface} stopOpacity={1} />
          <Stop offset={wholeIllustration ? Math.max(0.68, illustrationFadeStart + 0.16) : 0.88} stopColor={surface} stopOpacity={protectFullWidth ? 0.94 : 0} />
          <Stop offset={1} stopColor={surface} stopOpacity={protectFullWidth ? 0.94 : 0} />
        </LinearGradient>
        <LinearGradient id={bottom} x1={0} y1={0} x2={0} y2={1}>
          <Stop offset={wholeIllustration ? 0.94 : 0.7} stopColor={surface} stopOpacity={0} />
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

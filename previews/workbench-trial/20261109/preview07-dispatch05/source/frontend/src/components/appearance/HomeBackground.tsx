import { useId } from "react";
import { Image, Platform, StyleSheet, View, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { defaultHomeBackground, useBackground } from "../../preview/BackgroundContext";
import { useFirstScreenImage } from "../../startup/FirstScreenGate";
import { useContainerSize } from "../useContainerSize";

export function HomeBackground({ surface, protectFullWidth = false, fadeBottom = false, wideIllustration = false, fitIllustration = false, illustrationInset = 0, useCustomImage = true, fadeStart = 0.64, fadeEnd = 0.88, illustrationMinWidth = 0, containIllustration = false, webCssFade = false }: { surface: string; protectFullWidth?: boolean; fadeBottom?: boolean; wideIllustration?: boolean; fitIllustration?: boolean; illustrationInset?: number; useCustomImage?: boolean; fadeStart?: number; fadeEnd?: number; illustrationMinWidth?: number; containIllustration?: boolean; webCssFade?: boolean }) {
  const background = useBackground();
  const selected = useCustomImage ? background.selected : null, source = selected ? background.source : defaultHomeBackground;
  const fade = useId();
  const bottom = `${fade}-bottom`;
  const heightContained = containIllustration && !selected;
  const wholeIllustration = fitIllustration && !selected && !heightContained;
  const { ref, size, onLayout } = useContainerSize(wholeIllustration);
  const illustrationHeight = Math.min(Math.max(0, size.height - illustrationInset * 2), size.width / (1672 / 941));
  const startupImage = useFirstScreenImage("home-hero", !wholeIllustration || illustrationHeight > 0);
  const illustrationFadeStart = Math.max(0.42, size.width > 0 ? 1 - illustrationHeight * (1672 / 941) / size.width : 0.42);
  const illustration = !startupImage.fallback || selected ? <Image testID="home-background-image" source={source} accessible={false} resizeMode={wholeIllustration || heightContained ? "contain" : "cover"}
      onLoad={startupImage.onLoad} onError={startupImage.onError}
      style={[styles.image, !heightContained && wideIllustration && !selected && styles.wideIllustration,
        !heightContained && wideIllustration && !selected && illustrationMinWidth > 0 && { left: "auto", minWidth: illustrationMinWidth },
        wholeIllustration && { left: "auto", right: 0, width: illustrationHeight * (1672 / 941), height: illustrationHeight, top: wholeIllustration && illustrationInset > 0 ? size.height - illustrationHeight - illustrationInset / 2 : (size.height - illustrationHeight) / 2, opacity: illustrationHeight > 0 ? 1 : 0 }]} /> : null;
  // The welcome's Web-only fade avoids SVG objectBoundingBox coordinates under CSS zoom.
  // Other consumers and native keep their existing SVG protection/bottom-fade behavior.
  const cssFade = Platform.OS === "web" && webCssFade && !wholeIllustration && !protectFullWidth && !fadeBottom;
  const cssFadeStyle: ViewStyle & { backgroundImage: string } = {
    backgroundImage: `linear-gradient(to right, ${surface} 0%, ${surface} ${fadeStart * 100}%, transparent ${fadeEnd * 100}%, transparent 100%)`,
  };
  return <View ref={ref} aria-hidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
    {heightContained && illustration ? <View testID="home-illustration-frame" style={styles.containedIllustration}>{illustration}</View> : illustration}
    {cssFade ? <View testID="home-background-css-fade" style={[StyleSheet.absoluteFill, cssFadeStyle]} /> : <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} aria-hidden focusable={false}>
      <Defs>
        <LinearGradient id={fade} x1={0} y1={0} x2={1} y2={0}>
          <Stop offset={0} stopColor={surface} stopOpacity={1} />
          <Stop offset={wholeIllustration ? illustrationFadeStart : fadeStart} stopColor={surface} stopOpacity={1} />
          <Stop offset={wholeIllustration ? Math.max(0.68, illustrationFadeStart + 0.16) : fadeEnd} stopColor={surface} stopOpacity={protectFullWidth ? 0.94 : 0} />
          <Stop offset={1} stopColor={surface} stopOpacity={protectFullWidth ? 0.94 : 0} />
        </LinearGradient>
        <LinearGradient id={bottom} x1={0} y1={0} x2={0} y2={1}>
          <Stop offset={wholeIllustration ? 0.94 : 0.7} stopColor={surface} stopOpacity={0} />
          <Stop offset={1} stopColor={surface} stopOpacity={1} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${fade})`} />
      {fadeBottom ? <Rect width="100%" height="100%" fill={`url(#${bottom})`} /> : null}
    </Svg>}
  </View>;
}
const styles = StyleSheet.create({
  image: { ...StyleSheet.absoluteFill, width: "100%", height: "100%" },
  // Percentage height and aspect ratio stay in layout units; never reuse zoomed DOM bounds.
  containedIllustration: { position: "absolute", right: 0, top: 0, height: "100%", aspectRatio: 1672 / 941 },
  wideIllustration: { left: "50%", right: 0, width: "50%" },
});

import type { ReactNode } from "react";
import { Image, StyleSheet, View } from "react-native";
import { useBackground } from "../../preview/BackgroundContext";
import { colors } from "../../theme";

/** Persistent Home-only decoration, independent from the once-per-session greeting. */
export function HomeBackdrop({ children }: { children: ReactNode }) {
  const background = useBackground();
  return <View style={styles.root} testID="home-backdrop">
    {background.selected ? <View pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      <Image testID="custom-home-background" accessible={false} source={background.source} resizeMode="cover" onError={() => { if (background.selected) background.imageFailed(background.selected); }} style={styles.image} />
      <View style={styles.tint} />
    </View> : null}
    {children}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.canvas },
  image: { ...StyleSheet.absoluteFill, width: "100%", height: "100%" },
  tint: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(255,255,255,0.18)" },
});

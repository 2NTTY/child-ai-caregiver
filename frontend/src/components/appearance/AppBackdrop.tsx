import type { ReactNode } from "react";
import { Image, StyleSheet, View } from "react-native";
import { useBackground } from "../../preview/BackgroundContext";
import { BackgroundSurfaceProvider } from "./BackgroundSurface";
import { colors } from "../../theme";

/** One device-local decoration inside the authenticated shell, independent of route and greeting. */
export function AppBackdrop({ children, preview = false }: { children: ReactNode; preview?: boolean }) {
  const background = useBackground();
  return <BackgroundSurfaceProvider active={!!background.selected}><View style={styles.root} testID={preview ? "background-preview-backdrop" : "app-backdrop"}>
    {background.selected ? <View pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      <Image testID={preview ? "custom-background-preview" : "custom-app-background"} accessible={false} source={background.source} resizeMode="cover" onError={() => { if (background.selected) background.imageFailed(background.selected); }} style={styles.image} />
      <View style={styles.tint} />
    </View> : null}
    {children}
  </View></BackgroundSurfaceProvider>;
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.canvas },
  image: { ...StyleSheet.absoluteFill, width: "100%", height: "100%" },
  tint: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(255,255,255,0.08)" },
});

import { Stack, usePathname } from "expo-router";
import Head from "expo-router/head";
import { brand } from "../src/branding";
import { BrandLogo } from "../src/components/BrandLogo";
import { chineseFont, colors, spacing, typeScale } from "../src/theme";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { PreviewNavigationGuard } from "../src/preview/PreviewNavigationGuard";
import { MotionProvider } from "../src/motion";
import { MotionPaperProvider } from "../src/motion/MotionPaperProvider";
import { FirstScreenGate } from "../src/startup/FirstScreenGate";

export default function RootLayout() {
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  return (
    <SafeAreaProvider><MotionProvider><MotionPaperProvider>
      <Head><title>{brand.previewName}</title></Head>
      <PreviewNavigationGuard><FirstScreenGate pathname={pathname} width={width} launch={<View style={styles.launch}>
          <BrandLogo style={styles.logo} decorative />
          <Text accessibilityRole="text" style={styles.launchText}>正在開啟{brand.name}…</Text>
        </View>}>
        <Stack screenOptions={{ headerShown: false, animation: "none" }} />
      </FirstScreenGate></PreviewNavigationGuard>
    </MotionPaperProvider></MotionProvider></SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  launch: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  logo: { width: 164, height: 53 },
  launchText: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small },
});

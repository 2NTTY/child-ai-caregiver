import { Stack } from "expo-router";
import Head from "expo-router/head";
import { brand } from "../src/branding";
import { BrandLogo } from "../src/components/BrandLogo";
import { PaperProvider } from "react-native-paper";
import { chineseFont, colors, paperTheme, spacing, typeScale } from "../src/theme";
import { PaperSvgIcon } from "../src/components/AppIcon";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { PreviewNavigationGuard } from "../src/preview/PreviewNavigationGuard";

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  // Keep the exported HTML and first client render identical before reading viewport dimensions.
  const renderRoutes = Platform.OS !== "web" || ready;
  return (
    <SafeAreaProvider><PaperProvider theme={paperTheme} settings={{ icon: PaperSvgIcon }}>
      <Head><title>{brand.previewName}</title></Head>
      <PreviewNavigationGuard><View style={styles.root} testID={ready ? "frontend-preview-ready" : undefined}>
        {renderRoutes ? <Stack screenOptions={{ headerShown: false, animation: "none" }} /> : <View style={styles.launch}>
          <BrandLogo style={styles.logo} decorative />
          <Text accessibilityRole="text" style={styles.launchText}>正在開啟{brand.name}…</Text>
        </View>}
      </View></PreviewNavigationGuard>
    </PaperProvider></SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  launch: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  logo: { width: 164, height: 53 },
  launchText: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small },
});

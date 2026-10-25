export { RouteError as ErrorBoundary, RouteLoading as SuspenseFallback } from "../src/components/RouteFeedback";
import { Stack } from "expo-router";
import Head from "expo-router/head";
import { brand } from "../src/branding";
import { BrandLogo } from "../src/components/BrandLogo";
import { spacing } from "../src/theme";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { PreviewNavigationGuard } from "../src/preview/PreviewNavigationGuard";
import { MotionProvider } from "../src/motion";
import { MotionPaperProvider } from "../src/motion/MotionPaperProvider";
import { ProductionFirstScreenGate } from "../src/production/ProductionFirstScreenGate";
import { StartupLoadingLabel } from "../src/startup/StartupLoadingLabel";
import { ProductionProvider } from "../src/production/ProductionProvider";

export default function RootLayout() {
  const { width } = useWindowDimensions();
  return (
    <SafeAreaProvider><MotionProvider><MotionPaperProvider>
      <Head>
        <title>{brand.name}</title>
        <meta name="theme-color" content="#F3F6F4" />
        <style id="harbour-desk-accessibility">{`
html { color-scheme: light; }
:focus-visible { outline: 3px solid #245C50; outline-offset: 3px; }
[data-testid="workspace-skip-link"] { top: -100px; }
[data-testid="workspace-skip-link"]:focus { top: 12px; }
[role="heading"] { scroll-margin-top: 24px; text-wrap: balance; }
button, a, [role="button"] { touch-action: manipulation; }
[role="dialog"] { overscroll-behavior: contain; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
        `}</style>
      </Head>
      <PreviewNavigationGuard><ProductionProvider><ProductionFirstScreenGate width={width} launch={<View style={styles.launch}>
          <BrandLogo style={styles.logo} decorative />
          <StartupLoadingLabel label={`正在開啟${brand.name}`} />
        </View>}>
        <Stack screenOptions={{ headerShown: false, animation: "none" }} />
      </ProductionFirstScreenGate></ProductionProvider></PreviewNavigationGuard>
    </MotionPaperProvider></MotionProvider></SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  launch: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  logo: { width: 164, height: 53 },
});

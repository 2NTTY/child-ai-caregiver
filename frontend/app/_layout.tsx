import { Stack } from "expo-router";
import { PaperProvider } from "react-native-paper";
import { chineseFont, colors, paperTheme, spacing, typeScale } from "../src/theme";
import { PaperSvgIcon } from "../src/components/AppIcon";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";

const logo = require("../assets/brand/logo-horizontal.png");

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  // Keep the exported HTML and first client render identical before reading viewport dimensions.
  const renderRoutes = Platform.OS !== "web" || ready;
  return (
    <SafeAreaProvider><PaperProvider theme={paperTheme} settings={{ icon: PaperSvgIcon }}>
      <View style={styles.root} testID={ready ? "frontend-preview-ready" : undefined}>
        {renderRoutes ? <Stack screenOptions={{ headerShown: false, animation: "none" }} /> : <View style={styles.launch}>
          <Image source={logo} resizeMode="contain" style={styles.logo} accessible={false} />
          <Text accessibilityRole="text" style={styles.launchText}>正在開啟育伴港…</Text>
        </View>}
      </View>
    </PaperProvider></SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  launch: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  logo: { width: 164, height: 53 },
  launchText: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small },
});

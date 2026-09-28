import { Stack } from "expo-router";
import { PaperProvider } from "react-native-paper";
import { paperTheme } from "../src/theme";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { View } from "react-native";

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  return (
    <SafeAreaProvider><PaperProvider theme={paperTheme}>
      <View style={{ flex: 1 }} testID={ready ? "frontend-preview-ready" : undefined}><Stack screenOptions={{ headerShown: false, animation: "none" }} /></View>
    </PaperProvider></SafeAreaProvider>
  );
}

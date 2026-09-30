import { Slot, Tabs } from "expo-router";
import { Platform } from "react-native";
import { AppIcon } from "../../src/components/AppIcon";
import { AppShell } from "../../src/components/AppShell";
import { NativeAppShell } from "../../src/components/NativeAppShell";
import { PreviewProvider } from "../../src/preview/PreviewContext";
import { colors, typeScale } from "../../src/theme";

export default function DashboardLayout() {
  return <PreviewProvider>{Platform.OS === "web" ? <AppShell><Slot /></AppShell> : <NativeAppShell>
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.teal, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.line }, tabBarLabelStyle: { fontSize: typeScale.caption }, tabBarHideOnKeyboard: true }}>
      <Tabs.Screen name="index" options={{ title: "主頁", tabBarIcon: ({ color, size }) => <AppIcon name="home-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="chat" options={{ title: "對話", tabBarIcon: ({ color, size }) => <AppIcon name="message-text-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="tasks" options={{ title: "待辦", tabBarIcon: ({ color, size }) => <AppIcon name="clipboard-check-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="memory" options={{ title: "記憶", tabBarIcon: ({ color, size }) => <AppIcon name="book-open-page-variant-outline" color={color} size={size} /> }} />
      {["care", "profile", "family", "settings", "guide", "motion-preview"].map(name => <Tabs.Screen key={name} name={name} options={{ href: null }} />)}
    </Tabs>
  </NativeAppShell>}</PreviewProvider>;
}

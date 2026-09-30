import { Slot, Tabs } from "expo-router";
import { Platform } from "react-native";
import { AppIcon } from "../../src/components/AppIcon";
import { AppShell } from "../../src/components/AppShell";
import { NativeAppShell } from "../../src/components/NativeAppShell";
import { PreviewProvider } from "../../src/preview/PreviewContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, mobileIcons, mobileLayout, mobileType } from "../../src/theme";

export default function DashboardLayout() {
  return <PreviewProvider>{Platform.OS === "web" ? <AppShell><Slot /></AppShell> : <NativeAppShell>
    <NativeDashboardTabs />
  </NativeAppShell>}</PreviewProvider>;
}

function NativeDashboardTabs() {
  const insets = useSafeAreaInsets();
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.teal, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.line, minHeight: mobileLayout.tabMinHeight + insets.bottom }, tabBarItemStyle: { minHeight: mobileLayout.touchTarget }, tabBarLabelStyle: mobileType.caption, tabBarHideOnKeyboard: true }}>
      <Tabs.Screen name="index" options={{ title: "主頁", tabBarIcon: ({ color }) => <AppIcon name="home-outline" color={color} size={mobileIcons.navigation} /> }} />
      <Tabs.Screen name="chat" options={{ title: "對話", tabBarIcon: ({ color }) => <AppIcon name="message-text-outline" color={color} size={mobileIcons.navigation} /> }} />
      <Tabs.Screen name="tasks" options={{ title: "待辦", tabBarIcon: ({ color }) => <AppIcon name="clipboard-check-outline" color={color} size={mobileIcons.navigation} /> }} />
      <Tabs.Screen name="memory" options={{ title: "記憶", tabBarIcon: ({ color }) => <AppIcon name="book-open-page-variant-outline" color={color} size={mobileIcons.navigation} /> }} />
      {["care", "photos", "sources", "growth", "profile", "family", "settings", "guide", "motion-preview"].map(name => <Tabs.Screen key={name} name={name} options={{ href: null }} />)}
    </Tabs>;
}

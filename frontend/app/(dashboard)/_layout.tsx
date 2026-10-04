import { usePathname, Slot, Tabs } from "expo-router";
import { Platform } from "react-native";
import { AppIcon } from "../../src/components/AppIcon";
import { AppShell } from "../../src/components/AppShell";
import { NativeAppShell } from "../../src/components/NativeAppShell";
import { PreviewProvider, usePreview } from "../../src/preview/PreviewContext";
import { usePreviewNavigation } from "../../src/preview/PreviewNavigationGuard";
import { BackgroundProvider } from "../../src/preview/BackgroundContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, mobileIcons, mobileLayout, mobileType } from "../../src/theme";
import { MotionScopeBoundary, MotionEntrance } from "../../src/motion";

export default function DashboardLayout() {
  return <PreviewProvider><PreviewAppearance>{Platform.OS === "web" ? <AppShell><Slot /></AppShell> : <NativeAppShell>
    <NativeDashboardTabs />
  </NativeAppShell>}</PreviewAppearance></PreviewProvider>;
}

function PreviewAppearance({ children }: { children: React.ReactNode }) {
  const { model } = usePreview();
  return <BackgroundProvider key={model.caregiverName}>{children}</BackgroundProvider>;
}

function NativeDashboardTabs() {
  const insets = useSafeAreaInsets();
  const leave = usePreviewNavigation();
  const { model } = usePreview();
  const pathname = usePathname();
  const scopeKey = `${model.caregiverName}:${model.selectedChildId ?? "none"}`;
  return <Tabs screenLayout={({ children }) => <MotionScopeBoundary scopeKey={scopeKey} eligible={model.selectedChildId !== null} style={{ flex: 1 }}><MotionEntrance preset="route" triggerKey={pathname} scopeKey={scopeKey} style={{ flex: 1 }} testID="motion-route">{children}</MotionEntrance></MotionScopeBoundary>} screenListeners={({ navigation, route }) => ({ tabPress: event => {
    event.preventDefault(); leave(() => navigation.navigate(route.name));
  } })} screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.teal, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.line, minHeight: mobileLayout.tabMinHeight + insets.bottom }, tabBarItemStyle: { minHeight: mobileLayout.touchTarget }, tabBarLabelStyle: mobileType.caption, tabBarHideOnKeyboard: true }}>
      <Tabs.Screen name="index" options={{ title: "主頁", tabBarIcon: ({ color }) => <AppIcon name="home-outline" color={color} size={mobileIcons.navigation} /> }} />
      <Tabs.Screen name="chat" options={{ title: "對話", tabBarIcon: ({ color }) => <AppIcon name="message-text-outline" color={color} size={mobileIcons.navigation} /> }} />
      <Tabs.Screen name="tasks" options={{ title: "待辦", tabBarIcon: ({ color }) => <AppIcon name="clipboard-check-outline" color={color} size={mobileIcons.navigation} /> }} />
      <Tabs.Screen name="memory" options={{ title: "記憶", tabBarIcon: ({ color }) => <AppIcon name="book-open-page-variant-outline" color={color} size={mobileIcons.navigation} /> }} />
      <Tabs.Screen name="more" options={{ title: "更多", tabBarIcon: ({ color }) => <AppIcon name="dots-horizontal" color={color} size={mobileIcons.navigation} /> }} />
      {["care", "photos", "sources", "growth", "summary", "contact", "profile", "family", "settings", "guide", "motion-preview"].map(name => <Tabs.Screen key={name} name={name} options={{ href: null }} />)}
    </Tabs>;
}

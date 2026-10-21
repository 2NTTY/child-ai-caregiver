import { usePathname, Slot, Tabs } from "expo-router";
import type { ReactNode } from "react";
import { Platform } from "react-native";
import { RecordsNavButton } from "../../src/components/navigation/RecordsNavButton";
import { MobileQuickInputDock } from "../../src/components/agent/MobileQuickInputDock";
import { AppIcon } from "../../src/components/AppIcon";
import { AppShell } from "../../src/components/AppShell";
import { NativeAppShell, NativeKeyboardPane } from "../../src/components/NativeAppShell";
import { usePreviewNavigation } from "../../src/preview/PreviewNavigationGuard";
import { BackgroundProvider } from "../../src/preview/BackgroundContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, mobileIcons, mobileLayout, mobileType } from "../../src/theme";
import { MotionScopeBoundary, MotionEntrance } from "../../src/motion";
import { useProduction } from "../../src/production/ProductionProvider";
import { ProductionGate } from "../../src/production/ProductionGate";
import ProductionUnavailable from "../../src/production/ProductionUnavailable";
import { isProductionRouteConnected } from "../../src/production/routes";
import { useProductionSwitchReadiness } from "../../src/production/ProductionFirstScreenGate";
import { ProductionDomains } from "../../src/production/ProductionDomains";

export default function DashboardLayout() {
  const { identityKey, user, owner } = useProduction();
  const backgroundScope = identityKey && user ? JSON.stringify([owner.apiBaseUrl, user.id]) : null;
  return <ProductionGate><BackgroundProvider key={identityKey} scope={backgroundScope}><ProductionDomains>
    {Platform.OS === "web" ? <AppShell><ConnectedRoute><Slot /></ConnectedRoute></AppShell> : <NativeAppShell><NativeDashboardTabs /></NativeAppShell>}
  </ProductionDomains></BackgroundProvider></ProductionGate>;
}

function ConnectedRoute({ children }: { children: ReactNode }) {
  return isProductionRouteConnected(usePathname()) ? children : <ProductionUnavailable />;
}

function NativeDashboardTabs() {
  const insets = useSafeAreaInsets();
  const leave = usePreviewNavigation();
  const { scopeKey: childScope, identityKey, selectedChildId, actions, model } = useProduction();
  const pathname = usePathname();
  const switchReadiness = useProductionSwitchReadiness();
  const scopeKey = childScope ?? identityKey ?? "signed-out";
  return <Tabs screenLayout={({ children }) => <NativeKeyboardPane><MotionScopeBoundary scopeKey={scopeKey} resetKey={identityKey ?? "signed-out"} readiness={switchReadiness.state} readinessKey={switchReadiness.key} onRetry={switchReadiness.retry} onReturn={actions.selectChild} canReturn={id => model.children.some(child => child.id === id)} childKey={selectedChildId} eligible={!!childScope} style={{ flex: 1 }}>
    <MotionEntrance preset="route" triggerKey={pathname} scopeKey={scopeKey} style={{ flex: 1 }} testID="motion-route"><ConnectedRoute>{children}</ConnectedRoute></MotionEntrance>
    {pathname === "/" ? <MobileQuickInputDock key={scopeKey} supportedKinds={["voice", "text"]} /> : null}
  </MotionScopeBoundary></NativeKeyboardPane>} screenListeners={({ navigation, route }) => ({ tabPress: event => {
    event.preventDefault(); leave(() => navigation.navigate(route.name), "workspace");
  } })} screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.teal, tabBarActiveBackgroundColor: colors.selectedNav, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.line, minHeight: mobileLayout.tabMinHeight + insets.bottom }, tabBarItemStyle: { minHeight: mobileLayout.touchTarget }, tabBarLabelStyle: mobileType.caption, tabBarHideOnKeyboard: false }}>
    <Tabs.Screen name="index" options={{ title: "今日", tabBarIcon: ({ color }) => <AppIcon name="home-outline" color={color} size={mobileIcons.navigation} /> }} />
    <Tabs.Screen name="chat" options={{ title: "助手", tabBarIcon: ({ color }) => <AppIcon name="message-text-outline" color={color} size={mobileIcons.navigation} /> }} />
    <Tabs.Screen name="tasks" options={{ title: "待辦", tabBarIcon: ({ color }) => <AppIcon name="clipboard-check-outline" color={color} size={mobileIcons.navigation} /> }} />
    <Tabs.Screen name="growth" options={{ title: "關注", tabBarIcon: ({ color }) => <AppIcon name="chart-bar" color={color} size={mobileIcons.navigation} /> }} />
    <Tabs.Screen name="care" options={{ title: "記錄", tabBarButton: () => <RecordsNavButton active={pathname === "/care" || pathname === "/more" || pathname === "/photos" || pathname === "/history"} scopeKey={scopeKey} /> }} />
    {["more", "history", "memory", "photos", "sources", "summary", "contact", "profile", "family", "settings", "guide"].map(name => <Tabs.Screen key={name} name={name} options={{ href: null }} />)}
  </Tabs>;
}

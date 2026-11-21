import { usePathname, Slot, Tabs } from "expo-router";
import type { ReactNode } from "react";
import { Platform, Pressable } from "react-native";
import { RecordsNavButton } from "../../src/components/navigation/RecordsNavButton";
import { navigationItems } from "../../src/components/navigation/app-navigation";
import { MobileNavSelection } from "../../src/components/navigation/MobileNavSelection";
import { MobileQuickInputDock } from "../../src/components/agent/MobileQuickInputDock";
import { AppIcon } from "../../src/components/AppIcon";
import { AppBackdrop } from "../../src/components/appearance/AppBackdrop";
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
import { SharedScopeGate } from '../../src/production/SharedScopeGate';

export default function DashboardLayout() {
  const { identityKey, user, owner } = useProduction();
  const backgroundScope = identityKey && user ? JSON.stringify([owner.apiBaseUrl, user.id]) : null;
  return <ProductionGate><BackgroundProvider key={identityKey} scope={backgroundScope}><ProductionDomains>
    <AppBackdrop>{Platform.OS === "web" ? <AppShell><ConnectedRoute><Slot /></ConnectedRoute></AppShell> : <NativeAppShell><NativeDashboardTabs /></NativeAppShell>}</AppBackdrop>
  </ProductionDomains></BackgroundProvider></ProductionGate>;
}

function ConnectedRoute({ children }: { children: ReactNode }) {
  return isProductionRouteConnected(usePathname()) ? <SharedScopeGate>{children}</SharedScopeGate> : <ProductionUnavailable />;
}

function NativeDashboardTabs() {
  const insets = useSafeAreaInsets();
  const leave = usePreviewNavigation();
  const { scopeKey: childScope, identityKey, actions, model,sharedChild } = useProduction();
  const pathname = usePathname();
  const switchReadiness = useProductionSwitchReadiness();
  const scopeKey = childScope ?? identityKey ?? "signed-out";
  return <Tabs screenLayout={({ children }) => <NativeKeyboardPane><MotionScopeBoundary scopeKey={scopeKey} resetKey={identityKey ?? "signed-out"} readiness={switchReadiness.state} readinessKey={switchReadiness.key} onRetry={switchReadiness.retry} onReturn={actions.selectChild} canReturn={id => model.children.some(child => child.id === id)} childKey={model.selectedChildId} eligible={!!childScope} style={{ flex: 1 }}>
    <MotionEntrance preset="route" triggerKey={pathname} scopeKey={scopeKey} style={{ flex: 1 }} testID="motion-route"><ConnectedRoute>{children}</ConnectedRoute></MotionEntrance>
    {pathname === "/" && !sharedChild.target ? <MobileQuickInputDock key={scopeKey} supportedKinds={["voice", "text"]} /> : null}
  </MotionScopeBoundary></NativeKeyboardPane>} screenListeners={({ navigation, route }) => ({ tabPress: event => {
    event.preventDefault(); leave(() => navigation.navigate(route.name), "workspace");
  } })} screenOptions={{ sceneStyle: { backgroundColor: "transparent" }, headerShown: false, tabBarActiveTintColor: colors.teal, tabBarActiveBackgroundColor: colors.selectedNav, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.line, minHeight: mobileLayout.tabMinHeight + insets.bottom }, tabBarItemStyle: { minHeight: mobileLayout.touchTarget }, tabBarLabelStyle: mobileType.caption, tabBarHideOnKeyboard: false,
    tabBarButton: ({ ref, ...props }) => <Pressable {...props} ref={node => {
      if (typeof ref === "function") return ref(node);
      if (ref) ref.current = node;
    }}>{props["aria-selected"] ? <MobileNavSelection /> : null}{props.children}</Pressable> }}>
    <Tabs.Screen name="index" options={{ title: navigationItems.home.short, tabBarIcon: ({ color }) => <AppIcon name={navigationItems.home.icon} color={color} size={mobileIcons.navigation} /> }} />
    <Tabs.Screen name="chat" options={{ title: navigationItems.chat.short, tabBarIcon: ({ color }) => <AppIcon name={navigationItems.chat.icon} color={color} size={mobileIcons.navigation} /> }} />
    <Tabs.Screen name="tasks" options={{ title: navigationItems.tasks.short, tabBarIcon: ({ color }) => <AppIcon name={navigationItems.tasks.icon} color={color} size={mobileIcons.navigation} /> }} />
    <Tabs.Screen name="growth" options={{ title: navigationItems.growth.short, tabBarIcon: ({ color }) => <AppIcon name={navigationItems.growth.icon} color={color} size={mobileIcons.navigation} /> }} />
    <Tabs.Screen name="care" options={{ title: navigationItems.care.short, tabBarButton: () => <RecordsNavButton active={pathname === navigationItems.care.href || pathname === navigationItems.more.href || pathname === navigationItems.photos.href || pathname === navigationItems.history.href} scopeKey={scopeKey} /> }} />
    {["more", "history", "memory", "photos", "sources", "summary", "contact", "profile", "family", "classes", "teachers", "settings", "guide", "share"].map(name => <Tabs.Screen key={name} name={name} options={{ href: null }} />)}
  </Tabs>;
}

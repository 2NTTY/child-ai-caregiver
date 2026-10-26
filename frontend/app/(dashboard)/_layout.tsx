import { usePathname, Slot, Tabs } from "expo-router";
import type { ReactNode, Ref } from "react";
import { Platform, Pressable, Text, type View } from "react-native";
import { navigationItems } from "../../src/components/navigation/app-navigation";
import { mobileNavigationKeyForPath } from "../../src/components/workspace/workspace-navigation";
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

export default function DashboardLayout() {
  const { identityKey, user, owner } = useProduction();
  const backgroundScope = identityKey && user ? JSON.stringify([owner.apiBaseUrl, user.id]) : null;
  return <ProductionGate><BackgroundProvider key={identityKey} scope={backgroundScope}><ProductionDomains>
    <AppBackdrop>{Platform.OS === "web" ? <AppShell><ConnectedRoute><Slot /></ConnectedRoute></AppShell> : <NativeAppShell><NativeDashboardTabs /></NativeAppShell>}</AppBackdrop>
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
  const mobileDestination = mobileNavigationKeyForPath(pathname);
  return <Tabs screenLayout={({ children }) => <NativeKeyboardPane><MotionScopeBoundary scopeKey={scopeKey} resetKey={identityKey ?? "signed-out"} readiness={switchReadiness.state} readinessKey={switchReadiness.key} onRetry={switchReadiness.retry} onReturn={actions.selectChild} canReturn={id => model.children.some(child => child.id === id)} childKey={selectedChildId} eligible={!!childScope} style={{ flex: 1 }}>
    <MotionEntrance preset="route" triggerKey={pathname} scopeKey={scopeKey} style={{ flex: 1 }} testID="motion-route"><ConnectedRoute>{children}</ConnectedRoute></MotionEntrance>
    {pathname === "/" ? <MobileQuickInputDock key={scopeKey} supportedKinds={["voice", "text"]} /> : null}
  </MotionScopeBoundary></NativeKeyboardPane>} screenListeners={({ navigation, route }) => ({ tabPress: event => {
    event.preventDefault(); leave(() => navigation.navigate(route.name), "workspace");
  } })} screenOptions={({ route }) => {
    const key = route.name === "index" ? "home" : route.name;
    const item = navigationItems[key as keyof typeof navigationItems] ?? navigationItems.more;
    const selected = key === mobileDestination;
    return { sceneStyle: { backgroundColor: "transparent" }, headerShown: false, tabBarActiveTintColor: colors.teal, tabBarActiveBackgroundColor: colors.selectedNav, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.line, minHeight: mobileLayout.tabMinHeight + insets.bottom }, tabBarItemStyle: { minHeight: mobileLayout.touchTarget }, tabBarLabelStyle: mobileType.caption, tabBarHideOnKeyboard: false,
    tabBarButton: props => <Pressable {...props} ref={props.ref as Ref<View>} accessibilityLabel={item.label} accessibilityState={{ ...props.accessibilityState, selected }} aria-selected={selected}
      style={[props.style, { flex: 1, minHeight: mobileLayout.touchTarget, alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: selected ? colors.selectedNav : colors.white }]}>
      {selected ? <MobileNavSelection /> : null}<AppIcon name={item.icon} color={selected ? colors.deepTeal : colors.muted} size={mobileIcons.navigation} />
      <Text style={[mobileType.caption, { color: selected ? colors.deepTeal : colors.muted, fontWeight: selected ? "700" : "400" }]}>{item.short}</Text>
    </Pressable> }; }}>
    <Tabs.Screen name="index" options={{ title: navigationItems.home.short, tabBarIcon: ({ color }) => <AppIcon name={navigationItems.home.icon} color={color} size={mobileIcons.navigation} /> }} />
    <Tabs.Screen name="chat" options={{ title: navigationItems.chat.short, tabBarIcon: ({ color }) => <AppIcon name={navigationItems.chat.icon} color={color} size={mobileIcons.navigation} /> }} />
    <Tabs.Screen name="tasks" options={{ title: navigationItems.tasks.short, tabBarIcon: ({ color }) => <AppIcon name={navigationItems.tasks.icon} color={color} size={mobileIcons.navigation} /> }} />
    <Tabs.Screen name="care" options={{ title: navigationItems.care.short, tabBarIcon: ({ color }) => <AppIcon name={navigationItems.care.icon} color={color} size={mobileIcons.navigation} /> }} />
    <Tabs.Screen name="more" options={{ title: navigationItems.more.short, tabBarIcon: ({ color }) => <AppIcon name={navigationItems.more.icon} color={color} size={mobileIcons.navigation} /> }} />
    {["growth", "history", "memory", "photos", "sources", "summary", "contact", "profile", "family", "settings", "guide"].map(name => <Tabs.Screen key={name} name={name} options={{ href: null }} />)}
  </Tabs>;
}

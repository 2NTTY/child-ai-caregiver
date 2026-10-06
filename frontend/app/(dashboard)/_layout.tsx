import { usePathname, Slot, Tabs } from "expo-router";
import { Platform } from "react-native";
import { RecordsNavButton } from "../../src/components/navigation/RecordsNavButton";
import { MobileQuickInputDock } from "../../src/components/agent/MobileQuickInputDock";
import { PhotosWorkspaceProvider } from "../../src/preview/PhotosWorkspaceProvider";
import { TasksWorkspaceProvider } from "../../src/preview/TasksWorkspaceProvider";
import { ProfileWorkspaceProvider } from "../../src/preview/ProfileWorkspaceProvider";
import { PreparationWorkspaceProvider } from "../../src/preview/PreparationWorkspaceProvider";
import { CareWorkspaceProvider } from "../../src/preview/CareWorkspaceProvider";
import { MemoryReferenceWorkspaceProvider } from "../../src/preview/MemoryReferenceWorkspaceProvider";
import { GrowthWorkspaceProvider } from "../../src/preview/GrowthWorkspaceProvider";
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
  // Reset identity-owned background resources only on caregiver/session changes.
  // Child/source scopes are handled by their owners; the shell and motion boundary stay mounted.
  return (
    <BackgroundProvider key={model.caregiverName}>
      <PhotosWorkspaceProvider>
        <TasksWorkspaceProvider>
          <ProfileWorkspaceProvider>
            <PreparationWorkspaceProvider>
              <CareWorkspaceProvider>
                <MemoryReferenceWorkspaceProvider>
                  <GrowthWorkspaceProvider>
                    {children}
                  </GrowthWorkspaceProvider>
                </MemoryReferenceWorkspaceProvider>
              </CareWorkspaceProvider>
            </PreparationWorkspaceProvider>
          </ProfileWorkspaceProvider>
        </TasksWorkspaceProvider>
      </PhotosWorkspaceProvider>
    </BackgroundProvider>
  );
}

function NativeDashboardTabs() {
  const insets = useSafeAreaInsets();
  const leave = usePreviewNavigation();
  const { model } = usePreview();
  const pathname = usePathname();
  const scopeKey = `${model.caregiverName}:${model.selectedChildId ?? "none"}`;
  return <Tabs screenLayout={({ children }) => <MotionScopeBoundary scopeKey={scopeKey} eligible={model.selectedChildId !== null} style={{ flex: 1 }}><MotionEntrance preset="route" triggerKey={pathname} scopeKey={scopeKey} style={{ flex: 1 }} testID="motion-route">{children}</MotionEntrance>{pathname === "/" ? <MobileQuickInputDock key={scopeKey} /> : null}</MotionScopeBoundary>} screenListeners={({ navigation, route }) => ({ tabPress: event => {
    event.preventDefault(); leave(() => navigation.navigate(route.name));
  } })} screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.teal, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.line, minHeight: mobileLayout.tabMinHeight + insets.bottom }, tabBarItemStyle: { minHeight: mobileLayout.touchTarget }, tabBarLabelStyle: mobileType.caption, tabBarHideOnKeyboard: true }}>
      <Tabs.Screen name="index" options={{ title: "今日", tabBarIcon: ({ color }) => <AppIcon name="home-outline" color={color} size={mobileIcons.navigation} /> }} />
      <Tabs.Screen name="chat" options={{ title: "助手", tabBarIcon: ({ color }) => <AppIcon name="message-text-outline" color={color} size={mobileIcons.navigation} /> }} />
      <Tabs.Screen name="tasks" options={{ title: "待辦", tabBarIcon: ({ color }) => <AppIcon name="clipboard-check-outline" color={color} size={mobileIcons.navigation} /> }} />
      <Tabs.Screen name="growth" options={{ title: "成長", tabBarIcon: ({ color }) => <AppIcon name="chart-bar" color={color} size={mobileIcons.navigation} /> }} />
      <Tabs.Screen name="care" options={{ title: "記錄", tabBarButton: () => <RecordsNavButton active={pathname === "/care" || pathname === "/more" || pathname === "/photos" || pathname === "/history"} scopeKey={scopeKey} /> }} />
      {["more", "history", "memory", "photos", "sources", "summary", "contact", "profile", "family", "settings", "guide", "motion-preview"].map(name => <Tabs.Screen key={name} name={name} options={{ href: null }} />)}
    </Tabs>;
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useGlobalSearchParams, usePathname } from "expo-router";
import { useRouteTabFocus } from "../navigation/useRouteTabFocus";
import { ReaderPositionProvider } from "../navigation/ReaderPosition";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "react-native-paper";
import { PreviewLink } from "../preview/PreviewNavigationGuard";
import { WorkspaceNavigation } from "./workspace/WorkspaceNavigation";
import { WorkspaceLink } from "./workspace/WorkspaceLink";
import { mobileNavigationKeyForPath } from "./workspace/workspace-navigation";
import { workspaceGroups } from "./workspace/workspace-navigation";
import { navigationItems, type NavigationItem } from "./navigation/app-navigation";
import { brand } from "../branding";
import { BrandLogo } from "./BrandLogo";
import { AppIcon } from "./AppIcon";
import { AppScrollView } from "./AppScrollView";
import { ChildPicker } from "./ChildPicker";
import { ChildKeyFacts } from "./ChildKeyFacts";
import { CompactHeaderIdentity } from "./CompactHeaderIdentity";
import { NotificationBell } from "./NotificationBell";
import { MotionEntrance, MotionScopeBoundary } from "../motion";
import { useProductionSwitchReadiness } from "../production/ProductionFirstScreenGate";
import { useHeaderOperationHints } from "../production/useHeaderOperationHints";
import { useProductionHome as useProduction } from "../production/useProductionHome";
import { chineseFont, colors, mobileIcons, spacing } from "../theme";

function MobileNavigationLink({ item, active, scopeKey, isCurrent }: { item: NavigationItem; active: boolean; scopeKey?: string | null; isCurrent?: () => boolean }) {
  const [pressed, setPressed] = useState(false);
  return <PreviewLink href={item.href} scopeKey={scopeKey} isCurrent={isCurrent}><Pressable
    accessibilityRole="link" accessibilityLabel={item.label} aria-current={active ? "true" : undefined}
    onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    style={StyleSheet.flatten([styles.bottomNavItem, active && styles.navActive, pressed && styles.navPressed])}>
    <AppIcon name={item.icon} size={mobileIcons.navigation} color={active ? colors.deepTeal : colors.muted} importantForAccessibility="no" />
    <Text style={[styles.bottomLabel, active && styles.navActiveText]}>{item.short}</Text>
  </Pressable></PreviewLink>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname(), { width } = useWindowDimensions(), insets = useSafeAreaInsets();
  const compact = width < 1024;
  const { model, actions, notice, dismissNotice, scopeKey, identityKey, owner } = useProduction();
  const hints = useHeaderOperationHints(), readiness = useProductionSwitchReadiness();
  const routeSurface = useRef<View>(null), previousPath = useRef(pathname);
  const motionScope = scopeKey ?? identityKey ?? "signed-out";
  const current = () => { const snapshot = owner.getSnapshot(); return snapshot.scopeKey === scopeKey && snapshot.identityKey === identityKey; };
  useEffect(() => {
    const changed = previousPath.current !== pathname; previousPath.current = pathname;
    if (!changed || Platform.OS !== "web") return;
    const surface = routeSurface.current as unknown as HTMLElement | null;
    const target = surface?.querySelector<HTMLElement>('[data-page-surface="true"]') ?? surface?.querySelector<HTMLElement>('[role="heading"],h1,h2');
    if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
  }, [pathname]);
  useRouteTabFocus(routeSurface, { pathname, searchKey: JSON.stringify(useGlobalSearchParams()), scopeKey: scopeKey ?? null, identityKey: identityKey ?? null }, current);
  const selectedChild = model.children.find(child => child.id === model.selectedChildId);
  const brandLink = <WorkspaceLink href="/" label={brand.homeLabel} scopeKey={scopeKey} isCurrent={current} style={styles.brandLink}><BrandLogo style={styles.logo} decorative /></WorkspaceLink>;
  return <WorkspaceNavigation.Root pathname={pathname} layout={compact ? "compact" : "sidebar"} scopeKey={scopeKey} isCurrent={current}><View style={styles.root}>
    <Pressable testID="workspace-skip-link" accessibilityRole="button" onPress={() => {
      const surface = routeSurface.current as unknown as HTMLElement | null;
      const target = surface?.querySelector<HTMLElement>('[data-page-surface="true"]') ?? surface;
      if (Platform.OS === "web" && target) { target.tabIndex = -1; target.focus(); }
    }} style={styles.skipLink}><Text style={styles.skipLabel}>跳至主要內容</Text></Pressable>
    {!compact ? <View testID="care-purpose-sidebar" style={styles.sidebar}>
      {brandLink}
      <AppScrollView contentContainerStyle={styles.sideContent}>
        <WorkspaceNavigation.Primary /><WorkspaceNavigation.Local />
      </AppScrollView>
      <WorkspaceLink href="/more" label="全部功能" scopeKey={scopeKey} isCurrent={current} style={styles.catalogue}><AppIcon name="dots-horizontal" size={20} importantForAccessibility="no" /><Text style={styles.catalogueLabel}>全部功能</Text></WorkspaceLink>
    </View> : null}
    <View style={styles.stage}>
      <MotionScopeBoundary scopeKey={motionScope} resetKey={identityKey ?? "signed-out"} readiness={readiness.state} readinessKey={readiness.key} onRetry={readiness.retry}
        onReturn={actions.selectChild} canReturn={id => model.children.some(child => child.id === id)} childKey={model.selectedChildId} eligible={!!model.selectedChildId} style={styles.stage}>
        <View style={[styles.topbar, compact && styles.compactTopbar]}>
          {compact ? <CompactHeaderIdentity hints={hints} showContext scopeKey={motionScope} routeKey={pathname} model={model} actions={actions} brand={brandLink} />
            : <ChildPicker children={model.children} selectedId={model.selectedChildId} onSelect={actions.selectChild} />}
          {!compact && width >= 1280 ? <ChildKeyFacts hints={hints} child={selectedChild} load={model.profileLoad} /> : null}
          <View testID="header-actions" style={styles.topActions}><NotificationBell /></View>
        </View>
        <View style={[styles.notice, !notice && styles.noticeEmpty]}><Text accessibilityLiveRegion="polite" style={styles.noticeText}>{notice ?? ""}</Text>{notice ? <Pressable accessibilityRole="button" accessibilityLabel="關閉提示" onPress={dismissNotice} style={styles.dismiss}><AppIcon name="close" size={20} importantForAccessibility="no" /></Pressable> : null}</View>
        <MotionEntrance ref={routeSurface} preset="route" triggerKey={pathname} scopeKey={motionScope} style={styles.content} testID="motion-route"><ReaderPositionProvider pathname={pathname} scopeKey={scopeKey ?? null} identityKey={identityKey ?? null} isCurrent={current}>{children}</ReaderPositionProvider></MotionEntrance>
      </MotionScopeBoundary>
      {compact ? <View role="navigation" accessibilityLabel="主要工作區" testID="mobile-bottom-navigation" style={[styles.bottomNav, { paddingBottom: Math.max(8, insets.bottom) }]}>
        {workspaceGroups.map(group => <MobileNavigationLink key={group.home} item={navigationItems[group.home]} active={mobileNavigationKeyForPath(pathname) === group.home} scopeKey={scopeKey} isCurrent={current} />)}
      </View> : null}
    </View>
  </View></WorkspaceNavigation.Root>;
}
const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", minWidth: 0, minHeight: 0, backgroundColor: colors.canvas },
  skipLink: { position: "absolute", left: 16, right: 16, zIndex: 100, backgroundColor: colors.ink, padding: 12, borderRadius: 8 }, skipLabel: { color: colors.white, fontFamily: chineseFont, fontWeight: "700" },
  sidebar: { width: 200, flexShrink: 0, paddingHorizontal: 16, paddingVertical: 16, backgroundColor: colors.sidebar, borderRightWidth: 1, borderRightColor: colors.softLine },
  sideContent: { paddingVertical: 24 }, brandLink: { minHeight: 48, minWidth: 44, justifyContent: "center", alignSelf: "flex-start" }, logo: { width: 132, height: 44 },
  catalogue: { minHeight: 44, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 }, catalogueLabel: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 22 },
  stage: { flex: 1, minWidth: 0, minHeight: 0 }, content: { flex: 1, minWidth: 0, minHeight: 0 },
  topbar: { minHeight: 64, flexShrink: 0, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.softLine, paddingHorizontal: 24, flexDirection: "row", alignItems: "center", gap: 16 },
  compactTopbar: { paddingHorizontal: 16, gap: 8 }, topActions: { marginLeft: "auto", flexShrink: 0 },
  // Keep the empty live text mounted; never use display:none/aria-hidden for it.
  noticeEmpty: { height: 0, minHeight: 0, paddingVertical: 0, overflow: "hidden" },
  notice: { backgroundColor: colors.paleAmber, paddingLeft: 16, paddingRight: 8, flexDirection: "row", alignItems: "center", gap: 8 }, noticeText: { flex: 1, fontFamily: chineseFont, color: colors.warningInk, fontSize: 16, lineHeight: 26 }, dismiss: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  bottomNav: { flexShrink: 0, minHeight: 64, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.softLine, flexDirection: "row", gap: 8, paddingHorizontal: 8, paddingTop: 8 },
  bottomNavItem: { flex: 1, minWidth: 44, minHeight: 48, paddingVertical: 4, alignItems: "center", justifyContent: "center", gap: 4, borderRadius: 8 },
  bottomLabel: { fontFamily: chineseFont, color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center" }, navActive: { backgroundColor: colors.paleTeal }, navActiveText: { color: colors.deepTeal, fontWeight: "700" }, navPressed: { backgroundColor: colors.pressedOverlay },
});

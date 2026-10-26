import { mobileNavigationKeyForPath } from "./workspace/workspace-navigation";
import { WorkspaceNavigation } from "./workspace/WorkspaceNavigation";
import { useHeaderOperationHints } from "../production/useHeaderOperationHints";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "expo-router";
import { PreviewLink } from "../preview/PreviewNavigationGuard";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { brand } from "../branding";
import { MotionDrawerOverlay, MotionDrawerRight, MotionEntrance, MotionScopeBoundary } from "../motion";
import { BrandLogo } from "./BrandLogo";
import { Text } from "react-native-paper";
import { AppIcon } from "./AppIcon";
import { MobileQuickInputDock } from "./agent/MobileQuickInputDock";
import { MobileNavSelection } from "./navigation/MobileNavSelection";
import { navigationItems, type NavigationItem } from "./navigation/app-navigation";
import { RightRailContent } from "./RightRailContent";
import { ChildKeyFacts } from "./ChildKeyFacts";
import { ChildPicker } from "./ChildPicker";
import { CompactHeaderIdentity } from "./CompactHeaderIdentity";
import { NotificationBell } from "./NotificationBell";
import { ToolbarIconButton } from "./ToolbarIconButton";
import { chineseFont, colors, mobileIcons, mobileLayout, mobileType, radius, spacing, typeScale } from "../theme";

import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { combineStartupReadiness, startupReadState, visibleRailStartupReadiness, visibleRailStartupRequirements } from "../startup/dataReadiness";
import { useProductionSwitchReadiness } from "../production/ProductionFirstScreenGate";
import { useProductionHome as useProduction } from "../production/useProductionHome";
import type { HomeActions, HomeViewModel } from "../view-model";


function MobileNavigationLink({ item, active }: { item: NavigationItem; active: boolean }) {
  const [pressed, setPressed] = useState(false);
  return <PreviewLink href={item.href}><Pressable
    accessibilityRole="link" accessibilityLabel={item.label} accessibilityState={{ selected: active }} aria-current={active ? "true" : undefined}
    onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    style={StyleSheet.flatten([styles.bottomNavItem, pressed && styles.navPressed])}
  >
    {active ? <MobileNavSelection /> : null}
    <AppIcon name={item.icon} size={mobileIcons.navigation} color={active ? colors.deepTeal : colors.muted} />
    <Text numberOfLines={1} style={[styles.bottomLabel, active && styles.navActiveText]}>{item.short}</Text>
  </Pressable></PreviewLink>;
}

export function RightRail({ model, actions, contextPath = "/", overlay = false, onClose }: {
  model: HomeViewModel;
  actions: HomeActions;
  contextPath?: string;
  overlay?: boolean;
  onClose?: () => void;
}) {
  return <View testID="context-rail" style={[styles.rail, overlay && styles.railFill]}>
    <View style={styles.railHeader}>
      <View><Text style={styles.railEyebrow}>你的照顧空間</Text><Text accessibilityRole="header" aria-level={2} style={styles.railTitle}>照顧資訊</Text></View>
      {onClose ? <ToolbarIconButton icon="close" label="關閉資訊側欄" onPress={onClose} /> : null}
    </View>
    <RightRailContent model={model} actions={actions} contextPath={contextPath} />
  </View>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const operationHints = useHeaderOperationHints();
  const switchReadiness = useProductionSwitchReadiness();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 1024;
  const tiny = width < 390;
  const wide = !compact;
  const { model, actions, notice, dismissNotice, scopeKey, identityKey } = useProduction();
  const railTasks = useTasksWorkspace();
  const railProps = { model, actions, contextPath: pathname };
  // The docked context rail is shell state, not a separate choice for every route.
  const [railOpen, setRailOpen] = useState(false);
  const shell = useRef<View>(null);
  const railAnchor = useRef<View>(null);
  const routeSurface = useRef<View>(null);
  const previousPath = useRef(pathname);
  useEffect(() => {
    const changed = previousPath.current !== pathname; previousPath.current = pathname;
    if (!changed || Platform.OS !== "web") return;
    const surface = routeSurface.current as unknown as HTMLElement | null;
    const target = surface?.querySelector<HTMLElement>('[data-page-surface="true"]') ?? surface?.querySelector<HTMLElement>('[role="heading"],h1,h2');
    if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
  }, [pathname]);
  const [railModal, setRailModal] = useState(false);
  const railContext = useRef({ path: pathname, scope: "" });
  useEffect(() => { if (wide) setRailModal(false); }, [wide]);
  useEffect(() => { setRailModal(false); }, [pathname]);
  function closeRail() {
    setRailModal(false);
  }
  const mobileDestination = mobileNavigationKeyForPath(pathname);
  const selectedChild = model.children.find(item => item.id === model.selectedChildId);
  const motionScope = scopeKey ?? identityKey ?? "signed-out";
  const sameRailContext = railContext.current.path === pathname && railContext.current.scope === motionScope;
  const overlayOpen = railModal && !wide && sameRailContext;
  const railExpanded = wide ? railOpen : overlayOpen;
  const railRequirements = visibleRailStartupRequirements(railExpanded);
  const railReadiness = visibleRailStartupReadiness(railExpanded, {
    tasks: startupReadState(railTasks?.scopeKey === scopeKey ? railTasks.model.access === "lost" ? "error" : railTasks.model.readState : undefined),
  });
  const screenReadiness = combineStartupReadiness([switchReadiness.state, railReadiness]);
  const screenReadinessKey = `${switchReadiness.key}:rail:${railExpanded ? "attention" : "closed"}`;
  useEffect(() => { setRailModal(false); }, [motionScope]);

  return <View ref={shell} style={styles.root}>
    <Pressable testID="workspace-skip-link" accessibilityRole="button" onPress={() => {
      const surface = routeSurface.current as unknown as HTMLElement | null;
      const target = surface?.querySelector<HTMLElement>('[data-page-surface="true"]') ?? surface;
      if (Platform.OS === "web" && target) { target.tabIndex = -1; target.focus(); }
    }} style={styles.skipLink}><Text style={styles.skipLabel}>跳至主要內容</Text></Pressable>
    {!compact ? <View testID="workspace-global-header" style={styles.globalHeader}>
      <PreviewLink href="/"><Pressable accessibilityRole="link" accessibilityLabel={brand.homeLabel} style={styles.workspaceBrand}>
        <BrandLogo style={styles.workspaceLogo} decorative />
      </Pressable></PreviewLink>
      <WorkspaceNavigation.Root pathname={pathname}><WorkspaceNavigation.Primary /></WorkspaceNavigation.Root>
    </View> : null}
    <View style={styles.stage}>
      <MotionScopeBoundary scopeKey={motionScope} resetKey={identityKey ?? "signed-out"} readiness={screenReadiness} readinessKey={screenReadinessKey} onRetry={switchReadiness.retry ? () => switchReadiness.retry?.(railRequirements) : undefined} onReturn={actions.selectChild} canReturn={id => model.children.some(child => child.id === id)} childKey={model.selectedChildId} eligible={model.selectedChildId !== null} style={styles.scopePane}>
      <View style={[styles.topbar, compact && styles.topbarCompact, tiny && styles.topbarTiny]}>
        {compact ? <CompactHeaderIdentity hints={operationHints} showContext scopeKey={motionScope} routeKey={pathname} model={model} actions={actions}
          brand={<PreviewLink href="/"><Pressable accessibilityRole="link" accessibilityLabel={brand.homeLabel} style={StyleSheet.flatten([styles.topBrandLink, tiny && styles.topBrandLinkTiny])}><BrandLogo style={[styles.topLogo, tiny && styles.topLogoTiny]} decorative /></Pressable></PreviewLink>} /> : null}
        {!compact ? <ChildPicker children={model.children} selectedId={model.selectedChildId} onSelect={actions.selectChild} /> : null}
        {!compact && width >= 1280 ? <ChildKeyFacts hints={operationHints} child={selectedChild} load={model.profileLoad} /> : null}
        {!compact ? <View style={styles.contextDivider} /> : null}
        {!compact ? <WorkspaceNavigation.Root pathname={pathname}><WorkspaceNavigation.Local /></WorkspaceNavigation.Root> : null}
        <View testID="header-actions" style={styles.topActions}>
          <NotificationBell />
          <ToolbarIconButton ref={railAnchor} icon="page-layout-sidebar-right" label={railExpanded ? "收起資訊側欄" : "開啟資訊側欄"}
            expanded={railExpanded} onPress={() => {
              if (wide) setRailOpen(value => !value);
              else { railContext.current = { path: pathname, scope: motionScope }; setRailModal(true); }
            }} />
        </View>
      </View>

      {notice ? <Pressable accessibilityRole="button" accessibilityLabel="關閉提示" onPress={dismissNotice} style={styles.notice}><Text style={styles.noticeText}>{notice}</Text><AppIcon name="close" size={18} color={colors.warningInk} /></Pressable> : null}
      <View style={styles.body}>
        <MotionEntrance ref={routeSurface} preset="route" triggerKey={pathname} scopeKey={motionScope} style={styles.content} testID="motion-route">{children}</MotionEntrance>
        {compact && pathname === "/" ? <MobileQuickInputDock key={motionScope} supportedKinds={["voice", "text"]} /> : null}
        {wide ? <MotionDrawerRight open={railOpen} width={310} mode="dock" scopeKey={motionScope} testID="motion-context-rail"><RightRail {...railProps} /></MotionDrawerRight> : null}
      </View>
      </MotionScopeBoundary>
      {compact ? <View testID="mobile-bottom-navigation" style={[styles.bottomNav, { paddingBottom: insets.bottom }]}>
        {(["home", "chat", "tasks", "care", "more"] as const).map(key => <MobileNavigationLink key={key} item={navigationItems[key]} active={mobileDestination === key} />)}
      </View> : null}
      <MotionDrawerOverlay open={overlayOpen} scopeKey={`${motionScope}:${pathname}:${wide ? "dock" : "overlay"}`} label="照顧資訊側欄" onRequestClose={closeRail}
        backgroundRef={shell} returnFocusRef={railAnchor} restoreFocusOnClose={sameRailContext}>
        <SafeAreaView testID="context-drawer" style={styles.drawerContent}><RightRail {...railProps} overlay onClose={closeRail} /></SafeAreaView>
      </MotionDrawerOverlay>
    </View>

  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, minWidth: 0, backgroundColor: colors.canvas },
  skipLink: { position: "absolute", left: 16, right: 16, zIndex: 100, backgroundColor: colors.ink, padding: 12, borderRadius: 8 }, skipLabel: { color: colors.white, fontFamily: chineseFont, fontWeight: "700" },
  globalHeader: { minHeight: 80, paddingHorizontal: 24, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 20, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  workspaceBrand: { width: 145, minHeight: 48, justifyContent: "center" }, workspaceLogo: { width: 145, height: 47 },
  settingsLink: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, borderRadius: 8 },
  contextDivider: { width: 1, height: 28, backgroundColor: colors.line },
  pressed: { backgroundColor: colors.paleTeal }, scenarioPressed: { backgroundColor: colors.inkPressed },
  navPressed: { backgroundColor: colors.selectedNav }, navActiveText: { color: colors.deepTeal, fontWeight: "800" },
  stage: { flex: 1, minWidth: 0, minHeight: 0 },
  scopePane: { flex: 1, minWidth: 0, minHeight: 0 }, drawerContent: { flex: 1 },
  topbar: { minHeight: 64, flexShrink: 0, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.softLine, paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", gap: spacing.lg },
  topbarCompact: { height: 64, paddingHorizontal: spacing.md, gap: spacing.sm },
  topbarTiny: { paddingHorizontal: spacing.sm, gap: spacing.xs },
  topBrandLink: { width: 124, height: 44, alignItems: "center", justifyContent: "center", marginRight: "auto" },
  topBrandLinkTiny: { width: 114 },
  topLogo: { width: 124, height: 44 },
  topLogoTiny: { width: 114 },
  topActions: { marginLeft: "auto", flexShrink: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  notice: { backgroundColor: colors.paleAmber, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.md },
  noticeText: { flex: 1, fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.caption },
  body: { flex: 1, flexDirection: "row", minHeight: 0 },
  content: { flex: 1, minWidth: 0, minHeight: 0 },
  rail: { width: 310, height: "100%", backgroundColor: colors.sidebar, borderLeftWidth: 1, borderLeftColor: colors.line },
  railFill: { width: "100%" },
  railHeader: { minHeight: 74, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  railEyebrow: { fontFamily: chineseFont, color: colors.teal, fontSize: typeScale.caption, fontWeight: "700" },
  railTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.title, fontWeight: "800" },
  bottomNav: { minHeight: mobileLayout.tabMinHeight, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, flexDirection: "row" },
  bottomNavItem: { flex: 1, minWidth: mobileLayout.touchTarget, paddingVertical: spacing.sm, alignItems: "center", justifyContent: "center", gap: spacing.xs },
  bottomLabel: { fontFamily: chineseFont, color: colors.muted, ...mobileType.caption, fontWeight: "700" },
});

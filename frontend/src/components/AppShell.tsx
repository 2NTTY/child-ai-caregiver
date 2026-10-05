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
import { AgentEntryButton } from "./AgentEntryButton";
import { MobileQuickInputDock } from "./agent/MobileQuickInputDock";
import { RecordsNavButton } from "./navigation/RecordsNavButton";
import { RightRailContent } from "./RightRailContent";
import { ChildKeyFacts } from "./ChildKeyFacts";
import { ChildPicker } from "./ChildPicker";
import { CompactHeaderIdentity } from "./CompactHeaderIdentity";
import { NotificationBell } from "./NotificationBell";
import { ToolbarIconButton } from "./ToolbarIconButton";
import { chineseFont, colors, mobileIcons, mobileLayout, mobileType, radius, spacing, typeScale } from "../theme";
import { scenarioLabels, type PreviewScenario } from "../preview/fixture";
import { usePreview } from "../preview/PreviewContext";
import type { HomeActions, HomeViewModel } from "../view-model";

type AppPath = "/" | "/chat" | "/care" | "/photos" | "/sources" | "/growth" | "/summary" | "/contact" | "/profile" | "/family" | "/memory" | "/settings" | "/guide" | "/tasks" | "/more";
const navigation: { href: AppPath; label: string; short: string; icon: React.ComponentProps<typeof AppIcon>["name"] }[] = [
  { href: "/", label: "今日", short: "今日", icon: "home-outline" },
  { href: "/chat", label: "助手", short: "助手", icon: "message-text-outline" },
  { href: "/care", label: "記錄與核對", short: "記錄", icon: "notebook-outline" },
  { href: "/photos", label: "照片與記錄", short: "照片", icon: "image-outline" },
  { href: "/sources", label: "私人來源", short: "來源", icon: "link-variant" },
  { href: "/tasks", label: "待辦與預約", short: "待辦", icon: "clipboard-check-outline" },
  { href: "/growth", label: "成長與關注", short: "成長", icon: "chart-bar" },
  { href: "/summary", label: "回顧與到診", short: "摘要", icon: "clipboard-check-outline" },
  { href: "/contact", label: "聯絡授權", short: "聯絡", icon: "bell-outline" },
  { href: "/profile", label: "子女檔案", short: "孩子", icon: "account-child-outline" },
  { href: "/family", label: "家庭協調", short: "家庭", icon: "account-group-outline" },
  { href: "/memory", label: "記憶與話題", short: "記憶", icon: "book-open-variant" },
];
const scenarios: PreviewScenario[] = ["normal", "first_login", "setup_incomplete", "empty", "loading", "offline", "needs_confirmation", "saving", "saved", "failed", "unknown", "focus_task", "focus_growth", "focus_unavailable"];
const navigationGroups = [
  { label: "常用", paths: ["/"] },
  { label: "行動與成長", paths: ["/tasks", "/growth"] },
  { label: "照顧資料", paths: ["/care", "/summary"] },
  { label: "資料管理", paths: ["/profile"] },
];

function NavItem({ item, active, compact = false }: { item: typeof navigation[number]; active: boolean; compact?: boolean }) {
  const [pressed, setPressed] = useState(false);
  return <PreviewLink href={item.href}><Pressable
    accessibilityRole="link" accessibilityLabel={item.label} accessibilityState={{ selected: active }} aria-current={active ? "page" : undefined}
    onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    style={StyleSheet.flatten([compact ? styles.bottomNavItem : styles.navItem, active && !compact && styles.navActive, pressed && styles.pressed])}
  >
    <AppIcon name={item.icon} size={compact ? mobileIcons.navigation : 21} color={active ? colors.deepTeal : colors.muted} />
    <Text numberOfLines={1} style={[compact ? styles.bottomLabel : styles.navLabel, active && styles.navActiveText]}>{compact ? item.short : item.label}</Text>
  </Pressable></PreviewLink>;
}

export function PreviewToolbar() {
  const { scenario, setScenario } = usePreview();
  const [expanded, setExpanded] = useState(false);
  return <View style={styles.previewArea}>
    <View style={styles.previewLine}>
      <Text style={styles.previewLabel}>介面預覽 · 合成資料 · 未接駁 Server</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="切換合成預覽情境" accessibilityState={{ expanded }} aria-expanded={expanded}
        onPress={() => setExpanded(value => !value)} style={({ pressed }) => [styles.previewToggle, pressed && styles.pressed]}>
        <Text style={styles.previewToggleText}>{scenarioLabels[scenario]}　{expanded ? "收起" : "切換情境"}</Text><AppIcon name={expanded ? "chevron-up" : "chevron-down"} size={16} />
      </Pressable>
    </View>
    {expanded ? <View style={styles.scenarios}>{scenarios.map(item => <Pressable
      key={item} accessibilityRole="button" accessibilityLabel={scenarioLabels[item]}
      accessibilityState={{ selected: scenario === item }} onPress={() => setScenario(item)}
      style={({ pressed }) => [styles.scenario, scenario === item && styles.scenarioSelected, pressed && styles.pressed]}
    ><Text style={[styles.scenarioText, scenario === item && styles.scenarioSelectedText]}>{scenarioLabels[item]}</Text></Pressable>)}</View> : null}
  </View>;
}

export function RightRail({ model, actions, home = false, contextPath = "/", overlay = false, onClose }: {
  model: HomeViewModel;
  actions: HomeActions;
  home?: boolean;
  contextPath?: string;
  overlay?: boolean;
  onClose?: () => void;
}) {
  return <View testID="context-rail" style={[styles.rail, overlay && styles.railFill]}>
    <View style={styles.railHeader}>
      <View><Text style={styles.railEyebrow}>你的照顧空間</Text><Text accessibilityRole="header" style={styles.railTitle}>照顧資訊</Text></View>
      {onClose ? <ToolbarIconButton icon="close" label="關閉資訊側欄" onPress={onClose} /> : null}
    </View>
    <RightRailContent model={model} actions={actions} home={home} contextPath={contextPath} />
  </View>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 900;
  const tiny = width < 390;
  const wide = !compact;
  const { model, actions, notice, dismissNotice } = usePreview();
  const railProps = { model, actions, home: pathname === "/", contextPath: pathname };
  // The docked context rail is shell state, not a separate choice for every route.
  const [railOpen, setRailOpen] = useState(false);
  const shell = useRef<View>(null);
  const railAnchor = useRef<View>(null);
  const routeSurface = useRef<View>(null);
  const previousPath = useRef(pathname);
  useEffect(() => {
    const changed = previousPath.current !== pathname; previousPath.current = pathname;
    if (!changed || Platform.OS !== "web") return;
    const heading = (routeSurface.current as unknown as HTMLElement | null)?.querySelector<HTMLElement>('[role="heading"],h1,h2');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }, [pathname]);
  const [railModal, setRailModal] = useState(false);
  const railContext = useRef({ path: pathname, scope: "" });
  useEffect(() => { if (wide) setRailModal(false); }, [wide]);
  useEffect(() => { setRailModal(false); }, [pathname]);
  function closeRail() {
    setRailModal(false);
  }
  const active = (path: AppPath) => pathname === path;
  const mobileHome = width < 650 && active("/");
  const selectedChild = model.children.find(item => item.id === model.selectedChildId);
  const showGuideNav = model.guideStatus === "first_login" || model.guideStatus === "incomplete";
  const motionScope = `${model.caregiverName}:${model.selectedChildId ?? "none"}:${selectedChild?.accessRole ?? "none"}`;
  const sameRailContext = railContext.current.path === pathname && railContext.current.scope === motionScope;
  const overlayOpen = railModal && !wide && sameRailContext;
  const railExpanded = wide ? railOpen : overlayOpen;
  useEffect(() => { setRailModal(false); }, [motionScope]);

  return <View ref={shell} style={styles.root}>
    {!compact ? <View testID="web-sidebar" style={styles.sidebar}>
      <PreviewLink href="/"><Pressable accessibilityRole="link" accessibilityLabel={brand.homeLabel} style={styles.brandLink}>
        <BrandLogo style={styles.logo} decorative />
        <Text style={styles.brandLine}>用資料 · 陪伴成長</Text>
      </Pressable></PreviewLink>
      <ScrollView testID="sidebar-navigation" style={styles.navScroll} contentContainerStyle={styles.navList}>
        {navigationGroups.map(group => <View key={group.label} style={styles.navGroup}>
          <Text style={styles.navGroupLabel}>{group.label}</Text>
          {group.paths.map(path => navigation.find(item => item.href === path)!).map(item => <NavItem key={item.href} item={item} active={active(item.href)} />)}
        </View>)}
      </ScrollView>
      <View style={styles.sidebarBottom}>
        <AgentEntryButton active={active("/chat")} />
      </View>
      <NavItem item={{ href: "/settings", label: "設定", short: "設定", icon: "cog-outline" }} active={active("/settings")} />
      <NavItem item={{ href: "/more", label: "更多功能", short: "更多", icon: "dots-horizontal" }} active={active("/more")} />
      {showGuideNav ? <NavItem item={{ href: "/guide", label: "使用引導", short: "引導", icon: "compass-outline" }} active={active("/guide")} /> : null}
    </View> : null}
    <View style={styles.stage}>
      <MotionScopeBoundary scopeKey={motionScope} resetKey={pathname} eligible={model.selectedChildId !== null} style={styles.scopePane}>
      <View style={[styles.topbar, compact && styles.topbarCompact, tiny && styles.topbarTiny]}>
        {compact ? <CompactHeaderIdentity showContext={!mobileHome} scopeKey={motionScope} routeKey={pathname} model={model} actions={actions}
          brand={<PreviewLink href="/"><Pressable accessibilityRole="link" accessibilityLabel={brand.homeLabel} style={StyleSheet.flatten([styles.topBrandLink, tiny && styles.topBrandLinkTiny])}><BrandLogo style={[styles.topLogo, tiny && styles.topLogoTiny]} decorative /></Pressable></PreviewLink>} /> : null}
        {!compact ? <ChildPicker children={model.children} selectedId={model.selectedChildId} onSelect={actions.selectChild} /> : null}
        {!compact ? <ChildKeyFacts child={selectedChild} load={model.profileLoad} /> : null}
        <View testID="header-actions" style={styles.topActions}>
          <NotificationBell operation={model.operation} connection={model.connection} onReview={actions.reviewOperation} />
          <ToolbarIconButton ref={railAnchor} icon="page-layout-sidebar-right" label={railExpanded ? "收起資訊側欄" : "開啟資訊側欄"}
            expanded={railExpanded} onPress={() => {
              if (wide) setRailOpen(value => !value);
              else { railContext.current = { path: pathname, scope: motionScope }; setRailModal(true); }
            }} />
        </View>
      </View>
      <PreviewToolbar />
      {notice ? <Pressable accessibilityRole="button" accessibilityLabel="關閉預覽提示" onPress={dismissNotice} style={styles.notice}><Text style={styles.noticeText}>{notice}</Text><AppIcon name="close" size={18} color={colors.warningInk} /></Pressable> : null}
      <View style={styles.body}>
        <MotionEntrance ref={routeSurface} preset="route" triggerKey={pathname} scopeKey={motionScope} style={styles.content} testID="motion-route">{children}</MotionEntrance>
        {wide ? <MotionDrawerRight open={railOpen} width={310} mode="dock" scopeKey={motionScope} testID="motion-context-rail"><RightRail {...railProps} /></MotionDrawerRight> : null}
      </View>
      </MotionScopeBoundary>
      {compact && pathname === "/" ? <MobileQuickInputDock key={motionScope} /> : null}
      {compact ? <View testID="mobile-bottom-navigation" style={[styles.bottomNav, { paddingBottom: insets.bottom }]}>
        {["/", "/chat", "/tasks", "/growth"].map(path => navigation.find(item => item.href === path)!).map(item => <NavItem key={item.href} item={item} active={active(item.href)} compact />)}
        <RecordsNavButton active={active("/care") || active("/photos") || active("/more")} scopeKey={motionScope} />
      </View> : null}
      <MotionDrawerOverlay open={overlayOpen} scopeKey={`${motionScope}:${pathname}:${wide ? "dock" : "overlay"}`} label="照顧上下文" onRequestClose={closeRail}
        backgroundRef={shell} returnFocusRef={railAnchor} restoreFocusOnClose={sameRailContext}>
        <SafeAreaView testID="context-drawer" style={styles.drawerContent}><RightRail {...railProps} overlay onClose={closeRail} /></SafeAreaView>
      </MotionDrawerOverlay>
    </View>

  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", minHeight: 0, backgroundColor: colors.canvas },
  pressed: { opacity: 0.68 },
  sidebar: { width: 216, minHeight: 0, backgroundColor: colors.sidebar, borderRightColor: colors.line, borderRightWidth: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md, gap: spacing.xs },
  brandLink: { width: "100%", minHeight: 93, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  logo: { width: 164, height: 53 },
  brandLine: { fontFamily: chineseFont, color: colors.teal, fontSize: typeScale.caption, textAlign: "center" },
  navScroll: { flex: 1, minHeight: 0, marginRight: -spacing.sm }, navList: { gap: spacing.md, paddingBottom: spacing.md, paddingRight: spacing.sm },
  navGroup: { gap: spacing.xs }, navGroupLabel: { fontFamily: chineseFont, color: colors.muted, fontSize: 12, lineHeight: 18, paddingHorizontal: spacing.md },
  navItem: { minHeight: 46, borderRadius: radius.small, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md },
  navActive: { backgroundColor: colors.selectedNav, borderLeftColor: colors.teal, borderLeftWidth: 3 },
  navGlyph: { width: 23, textAlign: "center", fontSize: 22, color: colors.deepTeal },
  navLabel: { fontFamily: chineseFont, fontSize: typeScale.small, fontWeight: "600", color: colors.ink },
  navActiveText: { color: colors.deepTeal, fontWeight: "800" },
  sidebarBottom: { paddingBottom: spacing.sm },
  stage: { flex: 1, minWidth: 0, minHeight: 0 },
  scopePane: { flex: 1, minWidth: 0, minHeight: 0 }, drawerContent: { flex: 1 },
  topbar: { height: 70, flexShrink: 0, backgroundColor: colors.sidebar, borderBottomWidth: 1, borderBottomColor: colors.softLine, paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", gap: spacing.lg },
  topbarCompact: { height: 64, paddingHorizontal: spacing.md, gap: spacing.sm },
  topbarTiny: { paddingHorizontal: spacing.sm, gap: spacing.xs },
  topBrandLink: { width: 124, height: 44, alignItems: "center", justifyContent: "center", marginRight: "auto" },
  topBrandLinkTiny: { width: 114 },
  topLogo: { width: 124, height: 44 },
  topLogoTiny: { width: 114 },
  topActions: { marginLeft: "auto", flexShrink: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  panelIcon: { width: 20, height: 17, borderWidth: 1.7, borderColor: colors.deepTeal, borderRadius: 4, alignItems: "flex-end", justifyContent: "center" },
  panelIconDivider: { width: 6, height: 15, borderLeftWidth: 1.7, borderLeftColor: colors.deepTeal },
  menuDialog: { maxWidth: 400 },
  previewArea: { backgroundColor: colors.previewSurface, borderBottomWidth: 1, borderBottomColor: colors.line },
  previewLine: { minHeight: 36, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  previewLabel: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, flexShrink: 1 },
  previewToggle: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: spacing.xs, justifyContent: "center", paddingHorizontal: spacing.sm },
  previewToggleText: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.caption, fontWeight: "700" },
  scenarios: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  scenario: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, justifyContent: "center" },
  scenarioSelected: { backgroundColor: colors.teal, borderColor: colors.teal },
  scenarioText: { fontFamily: chineseFont, fontSize: typeScale.caption, color: colors.ink, fontWeight: "700" },
  scenarioSelectedText: { color: colors.white },
  notice: { backgroundColor: colors.paleAmber, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.md },
  noticeText: { flex: 1, fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.caption },
  body: { flex: 1, flexDirection: "row", minHeight: 0 },
  content: { flex: 1, minWidth: 0, minHeight: 0 },
  rail: { width: 310, height: "100%", backgroundColor: colors.sidebar, borderLeftWidth: 1, borderLeftColor: colors.line },
  railFill: { width: "100%" },
  railHeader: { minHeight: 74, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  railEyebrow: { fontFamily: chineseFont, color: colors.teal, fontSize: typeScale.caption, fontWeight: "700" },
  railTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.title, fontWeight: "800" },
  railCards: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  railIdentity: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  railAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  railAvatarText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.title, fontWeight: "800" },
  railIdentityText: { flex: 1, minWidth: 0 },
  railRecordTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800" },
  railMeta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 19 },
  railRecord: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  recordMark: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" },
  recordMarkText: { color: colors.deepTeal, fontSize: 18 },
  divider: { backgroundColor: colors.softLine },
  railCaution: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.caption },
  railTip: { backgroundColor: colors.mintSurface, borderRadius: radius.medium, padding: spacing.lg, gap: spacing.xs },
  bottomNav: { minHeight: mobileLayout.tabMinHeight, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, flexDirection: "row" },
  bottomNavItem: { flex: 1, minWidth: mobileLayout.touchTarget, paddingVertical: spacing.sm, alignItems: "center", justifyContent: "center", gap: spacing.xs },
  bottomGlyph: { fontSize: 22, color: colors.muted },
  bottomLabel: { fontFamily: chineseFont, color: colors.muted, ...mobileType.caption, fontWeight: "700" },
});

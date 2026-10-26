import { useHeaderOperationHints } from "../production/useHeaderOperationHints";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "expo-router";
import { PreviewLink } from "../preview/PreviewNavigationGuard";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { brand } from "../branding";
import { MotionEntrance, MotionScopeBoundary } from "../motion";
import { BrandLogo } from "./BrandLogo";
import { Text } from "react-native-paper";
import { AppIcon } from "./AppIcon";

import { MobileNavSelection } from "./navigation/MobileNavSelection";
import { navigationItems, type AppPath, type NavigationItem } from "./navigation/app-navigation";
import { ChildKeyFacts } from "./ChildKeyFacts";
import { ChildPicker } from "./ChildPicker";

import { NotificationBell } from "./NotificationBell";
import { chineseFont, colors, mobileIcons, mobileLayout, mobileType, spacing, typeScale } from "../theme";

import { useProductionSwitchReadiness } from "../production/ProductionFirstScreenGate";
import { useProductionHome as useProduction } from "../production/useProductionHome";

const journalChapters = [
  { label: "每天照顧", keys: ["home", "chat", "tasks", "growth"] },
  { label: "記錄手冊", keys: ["care", "summary", "history", "profile"] },
  { label: "參考資料", keys: ["memory", "photos", "sources"] },
  { label: "家庭與設定", keys: ["settings", "contact", "family", "guide", "more"] },
] as const;

function NavItem({ item, active, compact = false }: { item: NavigationItem; active: boolean; compact?: boolean }) {
  const [pressed, setPressed] = useState(false);
  return <PreviewLink href={item.href}><Pressable
    accessibilityRole="link" accessibilityLabel={item.label} accessibilityState={{ selected: active }} aria-current={active ? "page" : undefined}
    onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} onHoverIn={() => setPressed(true)} onHoverOut={() => setPressed(false)}
    style={StyleSheet.flatten([compact ? styles.bottomNavItem : styles.navItem, active && !compact && styles.navActive, pressed && styles.navPressed])}
  >
    {compact && active ? <MobileNavSelection /> : null}
    <AppIcon name={item.icon} size={compact ? mobileIcons.navigation : 21} color={active ? colors.deepTeal : colors.muted} />
    <Text numberOfLines={1} style={[compact ? styles.bottomLabel : styles.navLabel, active && styles.navActiveText]}>{compact ? item.short : item.label}</Text>
  </Pressable></PreviewLink>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const operationHints = useHeaderOperationHints();
  const switchReadiness = useProductionSwitchReadiness();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 1024;
  const chapter = journalChapters.find(group => group.keys.some(key => navigationItems[key].href === pathname)) ?? journalChapters[0];
  const [skipFocused, setSkipFocused] = useState(false);
  const { model, actions, notice, dismissNotice, scopeKey, identityKey } = useProduction();
  const routeSurface = useRef<View>(null);
  const previousPath = useRef(pathname);
  useEffect(() => {
    const changed = previousPath.current !== pathname; previousPath.current = pathname;
    if (!changed || Platform.OS !== "web") return;
    const surface = routeSurface.current as unknown as HTMLElement | null;
    const target = surface?.querySelector<HTMLElement>('[data-page-surface="true"]') ?? surface?.querySelector<HTMLElement>('[role="heading"],h1,h2');
    if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
  }, [pathname]);
  const active = (path: AppPath) => pathname === path;
  const selectedChild = model.children.find(item => item.id === model.selectedChildId);
  const motionScope = scopeKey ?? identityKey ?? "signed-out";

  return <View style={styles.root}>
    <View style={styles.stage}>
      <MotionScopeBoundary scopeKey={motionScope} resetKey={identityKey ?? "signed-out"} readiness={switchReadiness.state} readinessKey={switchReadiness.key} onRetry={switchReadiness.retry} onReturn={actions.selectChild} canReturn={id => model.children.some(child => child.id === id)} childKey={model.selectedChildId} eligible={model.selectedChildId !== null} style={styles.scopePane}>
      {Platform.OS === "web" ? <Pressable accessibilityRole="button" accessibilityLabel="跳到主要內容" onFocus={() => setSkipFocused(true)} onBlur={() => setSkipFocused(false)}
        onPress={() => (routeSurface.current as unknown as HTMLElement | null)?.focus({ preventScroll: true })}
        style={[styles.skip, !skipFocused && styles.skipHidden]}><Text style={styles.skipText}>跳到主要內容</Text></Pressable> : null}
      <View style={[styles.masthead, compact && styles.mastheadCompact]}>
        <PreviewLink href="/"><Pressable accessibilityRole="link" accessibilityLabel={brand.homeLabel} style={StyleSheet.flatten([styles.brandLink, compact && styles.brandLinkCompact])}>
          <BrandLogo style={[styles.logo, compact && styles.logoCompact]} decorative />
        </Pressable></PreviewLink>
        {!compact ? <View role="navigation" accessibilityLabel="主要章節" style={styles.chapters}>{journalChapters.map(group => <PreviewLink key={group.label} href={navigationItems[group.keys[0]].href}>
          <Pressable accessibilityRole="link" accessibilityLabel={group.label} aria-current={chapter === group ? "true" : undefined}
            style={StyleSheet.flatten([styles.chapter, chapter === group && styles.chapterActive])}>
            <Text style={[styles.chapterText, chapter === group && styles.chapterActiveText]}>{group.label}</Text>
          </Pressable></PreviewLink>)}</View> : null}
        <View style={styles.identity}><ChildPicker children={model.children} selectedId={model.selectedChildId} onSelect={actions.selectChild} compact /></View>
        <View testID="header-actions" style={styles.topActions}><NotificationBell /></View>
      </View>
      {operationHints.length > 0 ? <View style={[styles.contextBar, compact && styles.contextBarCompact]}>
        <ChildKeyFacts hints={operationHints} child={selectedChild} load={model.profileLoad} />
      </View> : null}
      {!compact ? <ScrollView horizontal testID="journal-section-navigation" role="navigation" accessibilityLabel={`${chapter.label}頁面`} style={styles.sectionNavigation} contentContainerStyle={styles.sectionNavigationContent}>
        {chapter.keys.map(key => <NavItem key={key} item={navigationItems[key]} active={active(navigationItems[key].href)} />)}
      </ScrollView> : null}

      {notice ? <Pressable accessibilityRole="button" accessibilityLabel="關閉提示" onPress={dismissNotice} style={styles.notice}><Text style={styles.noticeText}>{notice}</Text><AppIcon name="close" size={18} color={colors.warningInk} /></Pressable> : null}
      <View style={styles.body}>
        <MotionEntrance ref={routeSurface} role="main" tabIndex={-1} accessibilityLabel="主要內容" preset="route" triggerKey={pathname} scopeKey={motionScope} style={styles.content} testID="motion-route">{children}</MotionEntrance>
      </View>
      </MotionScopeBoundary>
      {compact ? <View testID="mobile-bottom-navigation" style={[styles.bottomNav, { paddingBottom: insets.bottom }]}>
        {(["home", "chat", "tasks", "growth", "more"] as const).map(key => navigationItems[key]).map(item => <NavItem key={item.href} item={item} active={active(item.href)} compact />)}
      </View> : null}

    </View>

  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.canvas },
  masthead: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: spacing.xl, paddingHorizontal: spacing.xxl, backgroundColor: colors.white },
  mastheadCompact: { minHeight: 68, paddingHorizontal: spacing.md, gap: spacing.sm },
  chapters: { flex: 1, flexDirection: "row", gap: spacing.sm, alignSelf: "stretch" },
  chapter: { justifyContent: "center", paddingHorizontal: spacing.md, borderBottomWidth: 3, borderBottomColor: "transparent" },
  chapterActive: { borderBottomColor: colors.teal },
  chapterText: { fontFamily: chineseFont, fontSize: 15, fontWeight: "600", color: colors.muted },
  chapterActiveText: { color: colors.ink, fontWeight: "800" },
  contextBar: { minHeight: 58, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.xxl, gap: spacing.md, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.softLine },
  contextBarCompact: { paddingHorizontal: spacing.md, minHeight: 54, gap: spacing.sm },
  sectionNavigation: { flexGrow: 0, flexShrink: 0, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.softLine, borderBottomWidth: 1, borderBottomColor: colors.line },
  sectionNavigationContent: { paddingHorizontal: spacing.xl, gap: spacing.xs, alignItems: "center" },
  skip: { position: "absolute", top: 8, left: 8, zIndex: 100, backgroundColor: colors.ink, padding: 12, borderRadius: 8 },
  skipHidden: { transform: [{ translateY: -1000 }] },
  skipText: { color: colors.white, fontFamily: chineseFont, fontWeight: "700" },
  brandLink: { width: 138, minHeight: 48, alignItems: "center", justifyContent: "center" },
  logo: { width: 138, height: 44 }, brandLinkCompact: { width: 86 }, logoCompact: { width: 86, height: 34 }, identity: { minWidth: 0, flexShrink: 0 },
  navItem: { minHeight: 48, borderBottomWidth: 3, borderBottomColor: "transparent", paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  navActive: { backgroundColor: colors.quietSurface, borderBottomColor: colors.teal },
  navPressed: { backgroundColor: colors.selectedNav },
  navLabel: { fontFamily: chineseFont, fontSize: typeScale.small, fontWeight: "600", color: colors.ink },
  navActiveText: { color: colors.deepTeal, fontWeight: "800" },
  stage: { flex: 1, minWidth: 0, minHeight: 0 },
  scopePane: { flex: 1, minWidth: 0, minHeight: 0 },
  topActions: { marginLeft: "auto", flexShrink: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  notice: { backgroundColor: colors.paleAmber, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.md },
  noticeText: { flex: 1, fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.caption },
  body: { flex: 1, flexDirection: "row", minHeight: 0 },
  content: { flex: 1, minWidth: 0, minHeight: 0 },
  bottomNav: { minHeight: mobileLayout.tabMinHeight, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, flexDirection: "row" },
  bottomNavItem: { flex: 1, minWidth: mobileLayout.touchTarget, paddingVertical: spacing.sm, alignItems: "center", justifyContent: "center", gap: spacing.xs },
  bottomLabel: { fontFamily: chineseFont, color: colors.muted, ...mobileType.caption, fontWeight: "700" },
});

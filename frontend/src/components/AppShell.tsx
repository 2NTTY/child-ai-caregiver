import { useEffect, useState, type ReactNode } from "react";
import { Link, usePathname, useRouter } from "expo-router";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { brand } from "../branding";
import { BrandLogo } from "./BrandLogo";
import { Button, Divider, Portal, Text } from "react-native-paper";
import { AppDialog as Dialog } from "./AppDialog";
import { AppIcon } from "./AppIcon";
import { AppMenuList } from "./AppMenuList";
import { AgentEntryButton } from "./AgentEntryButton";
import { AppButton, ConnectionPill, OperationPill, SectionCard, SectionHeader, TextLink } from "./ui";
import { ChildKeyFacts } from "./ChildKeyFacts";
import { ChildPicker } from "./ChildPicker";
import { NotificationBell } from "./NotificationBell";
import { ToolbarIconButton } from "./ToolbarIconButton";
import { PreviewTodoCard } from "./PreviewTodoCard";
import { chineseFont, colors, mobileIcons, mobileLayout, mobileType, radius, spacing, typeScale } from "../theme";
import { previewChecklist, scenarioLabels, type PreviewScenario } from "../preview/fixture";
import { usePreview } from "../preview/PreviewContext";
import type { HomeActions, HomeViewModel } from "../view-model";

type AppPath = "/" | "/chat" | "/care" | "/photos" | "/sources" | "/growth" | "/summary" | "/contact" | "/profile" | "/family" | "/memory" | "/settings" | "/guide" | "/tasks";
const navigation: { href: AppPath; label: string; short: string; icon: React.ComponentProps<typeof AppIcon>["name"] }[] = [
  { href: "/", label: "主頁", short: "主頁", icon: "home-outline" },
  { href: "/chat", label: "與 Agent 對話", short: "對話", icon: "message-text-outline" },
  { href: "/care", label: "照顧記錄", short: "記錄", icon: "notebook-outline" },
  { href: "/photos", label: "照片與記錄", short: "照片", icon: "image-outline" },
  { href: "/sources", label: "私人來源", short: "來源", icon: "link-variant" },
  { href: "/tasks", label: "任務與預約", short: "待辦", icon: "clipboard-check-outline" },
  { href: "/growth", label: "成長關注", short: "關注", icon: "chart-bar" },
  { href: "/summary", label: "照顧摘要", short: "摘要", icon: "clipboard-check-outline" },
  { href: "/contact", label: "聯絡授權", short: "聯絡", icon: "bell-outline" },
  { href: "/profile", label: "子女檔案", short: "孩子", icon: "account-child-outline" },
  { href: "/family", label: "家庭協調", short: "家庭", icon: "account-group-outline" },
  { href: "/memory", label: "記憶與話題", short: "記憶", icon: "book-open-variant" },
];
const scenarios: PreviewScenario[] = ["normal", "first_login", "setup_incomplete", "empty", "loading", "offline", "needs_confirmation", "saving", "saved", "failed", "unknown"];

function NavItem({ item, active, compact = false }: { item: typeof navigation[number]; active: boolean; compact?: boolean }) {
  const [pressed, setPressed] = useState(false);
  return <Link href={item.href} asChild><Pressable
    accessibilityRole="link" accessibilityLabel={item.label} accessibilityState={{ selected: active }} aria-current={active ? "page" : undefined}
    onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    style={StyleSheet.flatten([compact ? styles.bottomNavItem : styles.navItem, active && !compact && styles.navActive, pressed && styles.pressed])}
  >
    <AppIcon name={item.icon} size={compact ? mobileIcons.navigation : 21} color={active ? colors.deepTeal : colors.muted} />
    <Text numberOfLines={1} style={[compact ? styles.bottomLabel : styles.navLabel, active && styles.navActiveText]}>{compact ? item.short : item.label}</Text>
  </Pressable></Link>;
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

export function RightRail({ model, actions, checkedPreviewItems, togglePreviewItem, overlay = false }: {
  model: HomeViewModel;
  actions: HomeActions;
  checkedPreviewItems: Record<string, boolean>;
  togglePreviewItem: (id: string) => void;
  overlay?: boolean;
}) {
  const child = model.children.find(item => item.id === model.selectedChildId);
  const records = model.records.filter(item => item.childId === model.selectedChildId).slice(0, 3);
  const checklist = previewChecklist.filter(item => item.childId === model.selectedChildId);
  return <View style={[styles.rail, overlay && styles.railFill]}>
    <View style={styles.railHeader}>
      <View><Text style={styles.railEyebrow}>你的照顧空間</Text><Text accessibilityRole="header" style={styles.railTitle}>資訊與提醒</Text></View>
    </View>
    <ScrollView contentContainerStyle={styles.railCards}>
      <SectionCard>
        <SectionHeader title="目前孩子" action={<TextLink label="查看檔案" onPress={() => actions.open("profile")} />} />
        {child ? <View style={styles.railIdentity}>
          <View style={styles.railAvatar}><Text style={styles.railAvatarText}>{child.displayName.slice(0, 1)}</Text></View>
          <View style={styles.railIdentityText}><Text style={styles.railRecordTitle}>{child.displayName}</Text><Text style={styles.railMeta}>{child.ageLabel}</Text><Text style={styles.railMeta}>{child.regionLabel} · {child.profileConfirmed ? "檔案已確認" : "檔案待核對"}</Text></View>
        </View> : <Text style={styles.railMeta}>尚未選擇孩子；請先建立檔案。</Text>}
      </SectionCard>
      <PreviewTodoCard items={checklist} checked={checkedPreviewItems} onToggle={togglePreviewItem} onOpen={actions.open} />
      <AppButton label="查看任務與預約" variant="secondary" onPress={() => actions.open("tasks")} />
      <SectionCard>
        <SectionHeader title="近期已確認記錄" action={<TextLink label="查看全部" onPress={() => actions.open("care")} />} />
        {model.recordsLoad === "loading" ? <Text style={styles.railMeta}>正在讀取記錄…</Text> : records.length === 0 ? <Text style={styles.railMeta}>目前沒有已載入記錄。</Text> : records.map((record, index) => <View key={record.id}>
          {index > 0 ? <Divider style={styles.divider} /> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={`查看${record.title}`} onPress={() => actions.open("care")} style={({ pressed }) => [styles.railRecord, pressed && styles.pressed]}>
            <View style={styles.recordMark}><AppIcon name="file-document-outline" size={20} /></View>
            <View style={styles.railIdentityText}><Text style={styles.railRecordTitle}>{record.title}</Text><Text numberOfLines={2} style={styles.railMeta}>{record.eventTimeLabel} · {record.detail}</Text></View>
          </Pressable>
        </View>)}
        {model.connection === "offline" ? <Text style={styles.railCaution}>目前離線；以上可能不是最新資料。</Text> : null}
      </SectionCard>
      <SectionCard>
        <SectionHeader title="最近操作" />
        <OperationPill state={model.operation.state} />
        <Text style={styles.railMeta}>{model.operation.detail}</Text>
        <TextLink label={model.operation.state === "unknown" ? "查核原操作" : "查看相關記錄"} onPress={() => model.operation.state === "none" ? actions.open("care") : actions.reviewOperation()} />
      </SectionCard>
      <View style={styles.railTip}>
        <Text style={styles.railRecordTitle}>小提示</Text>
        <Text style={styles.railMeta}>網絡可用不等於資料已保存；以原操作的確認結果為準。</Text>
      </View>
    </ScrollView>
  </View>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const compact = width < 900;
  const tiny = width < 390;
  const wide = width >= 1280;
  const { model, actions, checkedPreviewItems, togglePreviewItem, notice, dismissNotice } = usePreview();
  const railProps = { model, actions, checkedPreviewItems, togglePreviewItem };
  const [railOpen, setRailOpen] = useState(true);
  const [railModal, setRailModal] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => { if (wide) setRailModal(false); }, [wide]);
  const active = (path: AppPath) => pathname === path;
  const mobileHome = width < 650 && active("/");
  const selectedChild = model.children.find(item => item.id === model.selectedChildId);
  const showGuideNav = model.guideStatus === "first_login" || model.guideStatus === "incomplete";
  const railExpanded = wide ? railOpen : railModal;

  return <View style={styles.root}>
    {!compact ? <View testID="web-sidebar" style={styles.sidebar}>
      <Link href="/" asChild><Pressable accessibilityRole="link" accessibilityLabel={brand.homeLabel} style={styles.brandLink}>
        <BrandLogo style={styles.logo} decorative />
        <Text style={styles.brandLine}>用資料 · 陪伴成長</Text>
      </Pressable></Link>
      <View style={styles.navList}>{navigation.filter(item => item.href !== "/chat").map(item => <NavItem key={item.href} item={item} active={active(item.href)} />)}</View>
      <View style={styles.sidebarBottom}>
        <AgentEntryButton active={active("/chat")} />
      </View>
      <NavItem item={{ href: "/settings", label: "設定", short: "設定", icon: "cog-outline" }} active={active("/settings")} />
      {showGuideNav ? <NavItem item={{ href: "/guide", label: "使用引導", short: "引導", icon: "compass-outline" }} active={active("/guide")} /> : null}
    </View> : null}
    <View style={styles.stage}>
      <View style={[styles.topbar, compact && styles.topbarCompact, tiny && styles.topbarTiny]}>
        {compact ? <Link href="/" asChild><Pressable accessibilityRole="link" accessibilityLabel={brand.homeLabel} style={StyleSheet.flatten([styles.topBrandLink, tiny && styles.topBrandLinkTiny])}><BrandLogo style={[styles.topLogo, tiny && styles.topLogoTiny]} decorative /></Pressable></Link> : null}
        {!compact ? <ChildPicker children={model.children} selectedId={model.selectedChildId} onSelect={actions.selectChild} /> : null}
        {!compact ? <ChildKeyFacts child={selectedChild} load={model.profileLoad} /> : null}
        <View testID="header-actions" style={styles.topActions}>
          {!compact ? <ConnectionPill state={model.connection} /> : null}
          <NotificationBell operation={model.operation} connection={model.connection} onReview={actions.reviewOperation} />
          {compact ? <Link href="/settings" asChild><Pressable accessibilityRole="link" accessibilityLabel="開啟設定" style={StyleSheet.flatten([styles.accountAction, width < mobileLayout.breakpoint && styles.mobileAction])}><View style={styles.accountAvatar}><Text style={styles.accountAvatarText}>{model.caregiverName.slice(0, 1)}</Text></View></Pressable></Link> : null}
          <ToolbarIconButton icon="page-layout-sidebar-right" label={railExpanded ? "收起資訊側欄" : "開啟資訊側欄"}
            expanded={railExpanded} onPress={() => wide ? setRailOpen(value => !value) : setRailModal(value => !value)} />
        </View>
      </View>
      {compact && !mobileHome ? <View style={styles.compactFacts}><ChildPicker children={model.children} selectedId={model.selectedChildId} onSelect={actions.selectChild} compact /><ChildKeyFacts child={selectedChild} load={model.profileLoad} /></View> : null}
      <PreviewToolbar />
      {notice ? <Pressable accessibilityRole="button" accessibilityLabel="關閉預覽提示" onPress={dismissNotice} style={styles.notice}><Text style={styles.noticeText}>{notice}</Text><AppIcon name="close" size={18} color={colors.warningInk} /></Pressable> : null}
      <View style={styles.body}>
        <View style={styles.content}>{children}</View>
        {wide && railOpen ? <RightRail {...railProps} /> : null}
      </View>
      {compact ? <View style={styles.bottomNav}>
        {navigation.filter(item => ["/", "/chat", "/tasks", "/memory"].includes(item.href)).map(item => <NavItem key={item.href} item={item} active={active(item.href)} compact />)}
        <Pressable accessibilityRole="button" accessibilityLabel="更多頁面" accessibilityState={{ expanded: moreOpen }} aria-expanded={moreOpen} onPress={() => setMoreOpen(true)} style={({ pressed }) => [styles.bottomNavItem, pressed && styles.pressed]}><AppIcon name="dots-horizontal" size={mobileIcons.navigation} color={["/care", "/photos", "/sources", "/growth", "/summary", "/contact", "/profile", "/family", "/settings", "/guide"].includes(pathname) ? colors.deepTeal : colors.muted} /><Text style={[styles.bottomLabel, ["/care", "/photos", "/sources", "/growth", "/summary", "/contact", "/profile", "/family", "/settings", "/guide"].includes(pathname) && styles.navActiveText]}>更多</Text></Pressable>
      </View> : null}
      {railModal && !wide ? <View style={[styles.railOverlay, compact ? styles.railOverlayCompact : styles.railOverlayDesktop]}>
        <Pressable accessibilityRole="button" accessibilityLabel="關閉資訊側欄背景" onPress={() => setRailModal(false)} style={styles.railScrim} />
        <View style={styles.railDrawer}><RightRail {...railProps} overlay /></View>
      </View> : null}
    </View>
    <Portal>
      <Dialog visible={moreOpen} onDismiss={() => setMoreOpen(false)} style={styles.menuDialog}>
        <Dialog.Title>更多頁面</Dialog.Title>
        <Dialog.Content>
          <AppMenuList items={[
            ...navigation.filter(item => ["/family", "/care", "/photos", "/sources", "/growth", "/summary", "/contact", "/profile", "/memory"].includes(item.href)).map(item => ({ key: item.href, label: item.label, icon: item.icon, onPress: () => { setMoreOpen(false); router.push(item.href); } })),
            { key: "settings", label: "設定", icon: "cog-outline", onPress: () => { setMoreOpen(false); router.push("/settings"); } },
            ...(showGuideNav ? [{ key: "guide", label: "使用引導", icon: "compass-outline" as const, onPress: () => { setMoreOpen(false); router.push("/guide"); } }] : []),
          ]} />
        </Dialog.Content>
        <Dialog.Actions><Button onPress={() => setMoreOpen(false)}>關閉</Button></Dialog.Actions>
      </Dialog>
    </Portal>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", minHeight: 0, backgroundColor: colors.canvas },
  pressed: { opacity: 0.68 },
  sidebar: { width: 220, backgroundColor: colors.sidebar, borderRightColor: colors.line, borderRightWidth: 1, paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md, gap: spacing.xs },
  brandLink: { width: "100%", minHeight: 93, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  logo: { width: 164, height: 53 },
  brandLine: { fontFamily: chineseFont, color: colors.teal, fontSize: typeScale.caption, textAlign: "center" },
  navList: { gap: spacing.xs },
  navItem: { minHeight: 46, borderRadius: radius.small, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md },
  navActive: { backgroundColor: colors.selectedNav, borderLeftColor: colors.teal, borderLeftWidth: 3 },
  navGlyph: { width: 23, textAlign: "center", fontSize: 22, color: colors.deepTeal },
  navLabel: { fontFamily: chineseFont, fontSize: typeScale.small, fontWeight: "600", color: colors.ink },
  navActiveText: { color: colors.deepTeal, fontWeight: "800" },
  sidebarBottom: { marginTop: "auto", paddingBottom: spacing.sm },
  accountAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  accountAction: { width: 44, height: 44, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  mobileAction: { width: mobileLayout.touchTarget, height: mobileLayout.touchTarget, minWidth: mobileLayout.touchTarget, minHeight: mobileLayout.touchTarget },
  accountAvatarText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.small, fontWeight: "800" },
  stage: { flex: 1, minWidth: 0, minHeight: 0 },
  topbar: { height: 70, backgroundColor: colors.sidebar, borderBottomWidth: 1, borderBottomColor: colors.softLine, paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", gap: spacing.lg },
  topbarCompact: { height: 64, paddingHorizontal: spacing.md, gap: spacing.sm },
  topbarTiny: { paddingHorizontal: spacing.sm, gap: spacing.xs },
  topBrandLink: { width: 124, height: 44, alignItems: "center", justifyContent: "center", marginRight: "auto" },
  topBrandLinkTiny: { width: 114 },
  topLogo: { width: 124, height: 44 },
  topLogoTiny: { width: 114 },
  topActions: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: spacing.sm },
  panelIcon: { width: 20, height: 17, borderWidth: 1.7, borderColor: colors.deepTeal, borderRadius: 4, alignItems: "flex-end", justifyContent: "center" },
  panelIconDivider: { width: 6, height: 15, borderLeftWidth: 1.7, borderLeftColor: colors.deepTeal },
  compactFacts: { minHeight: 52, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, gap: spacing.md, flexDirection: "row", alignItems: "center", backgroundColor: colors.sidebar, borderBottomWidth: 1, borderBottomColor: colors.softLine },
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
  railOverlay: { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 5, flexDirection: "row", justifyContent: "flex-end" },
  railOverlayCompact: { top: 64 },
  railOverlayDesktop: { top: 70 },
  railScrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.overlay },
  railDrawer: { width: "92%", maxWidth: 370, height: "100%", backgroundColor: colors.sidebar },
  bottomNav: { minHeight: mobileLayout.tabMinHeight, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, flexDirection: "row" },
  bottomNavItem: { flex: 1, minWidth: mobileLayout.touchTarget, paddingVertical: spacing.sm, alignItems: "center", justifyContent: "center", gap: spacing.xs },
  bottomGlyph: { fontSize: 22, color: colors.muted },
  bottomLabel: { fontFamily: chineseFont, color: colors.muted, ...mobileType.caption, fontWeight: "700" },
});

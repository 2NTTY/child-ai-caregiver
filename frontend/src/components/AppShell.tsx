import { useState, type ReactNode } from "react";
import { usePathname, useRouter } from "expo-router";
import { Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Button, Dialog, Divider, Modal, Portal, RadioButton, Text } from "react-native-paper";
import { ConnectionPill, OperationPill, SectionCard, SectionHeader, TextLink } from "./ui";
import { NotificationBell } from "./NotificationBell";
import { PreviewTodoCard } from "./PreviewTodoCard";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import { previewChecklist, scenarioLabels, type PreviewScenario } from "../preview/fixture";
import { usePreview } from "../preview/PreviewContext";
import type { HomeActions, HomeViewModel } from "../view-model";

const logo = require("../../assets/brand/logo-horizontal.png");
const harbourArt = require("../../assets/images/harbour-family-hero.png");

type AppPath = "/" | "/chat" | "/care" | "/profile" | "/family" | "/memory" | "/settings";
const navigation: { href: AppPath; label: string; short: string; glyph: string }[] = [
  { href: "/", label: "主頁", short: "主頁", glyph: "⌂" },
  { href: "/chat", label: "與 Agent 對話", short: "對話", glyph: "✦" },
  { href: "/care", label: "照顧記錄", short: "記錄", glyph: "▤" },
  { href: "/profile", label: "子女檔案", short: "孩子", glyph: "◉" },
  { href: "/family", label: "家庭協調", short: "家庭", glyph: "♙" },
  { href: "/memory", label: "記憶與話題", short: "記憶", glyph: "◎" },
];
const scenarios: PreviewScenario[] = ["normal", "empty", "loading", "offline", "needs_confirmation", "saving", "saved", "failed", "unknown"];

function NavItem({ item, active, compact = false }: { item: typeof navigation[number]; active: boolean; compact?: boolean }) {
  const router = useRouter();
  return <Pressable
    accessibilityRole="link" accessibilityLabel={item.label} accessibilityState={{ selected: active }}
    onPress={() => router.push(item.href)}
    style={({ pressed }) => [compact ? styles.bottomNavItem : styles.navItem, active && !compact && styles.navActive, pressed && styles.pressed]}
  >
    <Text style={[compact ? styles.bottomGlyph : styles.navGlyph, active && styles.navActiveText]}>{item.glyph}</Text>
    <Text numberOfLines={1} style={[compact ? styles.bottomLabel : styles.navLabel, active && styles.navActiveText]}>{compact ? item.short : item.label}</Text>
  </Pressable>;
}

function ChildPicker({ compact, tiny }: { compact: boolean; tiny: boolean }) {
  const { model, actions } = usePreview();
  const [visible, setVisible] = useState(false);
  const selected = model.children.find(child => child.id === model.selectedChildId);
  return <>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`選擇孩子，目前${selected?.displayName ?? "尚未有孩子"}`}
      accessibilityState={{ expanded: visible, disabled: model.children.length === 0 }}
      disabled={model.children.length === 0}
      onPress={() => setVisible(true)}
      style={({ pressed }) => [styles.childPicker, compact && styles.childPickerCompact, tiny && styles.childPickerTiny, pressed && styles.pressed]}
    >
      {!tiny ? <View style={styles.childAvatar}><Text style={styles.childAvatarText}>{selected?.displayName.slice(0, 1) ?? "育"}</Text></View> : null}
      <View style={styles.childText}>
        <Text numberOfLines={1} style={styles.childName}>{selected?.displayName ?? "尚未有孩子"}</Text>
        {!compact && selected ? <Text numberOfLines={1} style={styles.childAge}>{selected.ageLabel}</Text> : null}
      </View>
      <Text style={styles.childArrow}>⌄</Text>
    </Pressable>
    <Portal><Dialog visible={visible} onDismiss={() => setVisible(false)}>
      <Dialog.Title>選擇孩子</Dialog.Title>
      <Dialog.Content>{model.children.map(child => <RadioButton.Item
        key={child.id} label={`${child.displayName} · ${child.ageLabel}`} value={child.id}
        status={child.id === model.selectedChildId ? "checked" : "unchecked"}
        onPress={() => { setVisible(false); actions.selectChild(child.id); }}
      />)}</Dialog.Content>
      <Dialog.Actions><Button onPress={() => setVisible(false)}>關閉</Button></Dialog.Actions>
    </Dialog></Portal>
  </>;
}

function PreviewToolbar() {
  const { scenario, setScenario } = usePreview();
  const [expanded, setExpanded] = useState(false);
  return <View style={styles.previewArea}>
    <View style={styles.previewLine}>
      <Text style={styles.previewLabel}>介面預覽 · 合成資料 · 未接駁 Server</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="切換合成預覽情境" accessibilityState={{ expanded }}
        onPress={() => setExpanded(value => !value)} style={({ pressed }) => [styles.previewToggle, pressed && styles.pressed]}>
        <Text style={styles.previewToggleText}>{scenarioLabels[scenario]}　{expanded ? "收起 ↑" : "切換情境 ↓"}</Text>
      </Pressable>
    </View>
    {expanded ? <View style={styles.scenarios}>{scenarios.map(item => <Pressable
      key={item} accessibilityRole="button" accessibilityLabel={scenarioLabels[item]}
      accessibilityState={{ selected: scenario === item }} onPress={() => setScenario(item)}
      style={({ pressed }) => [styles.scenario, scenario === item && styles.scenarioSelected, pressed && styles.pressed]}
    ><Text style={[styles.scenarioText, scenario === item && styles.scenarioSelectedText]}>{scenarioLabels[item]}</Text></Pressable>)}</View> : null}
  </View>;
}

function RightRail({ model, actions, checkedPreviewItems, togglePreviewItem, onClose }: {
  model: HomeViewModel;
  actions: HomeActions;
  checkedPreviewItems: Record<string, boolean>;
  togglePreviewItem: (id: string) => void;
  onClose: () => void;
}) {
  const child = model.children.find(item => item.id === model.selectedChildId);
  const records = model.records.filter(item => item.childId === model.selectedChildId).slice(0, 3);
  const checklist = previewChecklist.filter(item => item.childId === model.selectedChildId);
  return <View style={styles.rail}>
    <View style={styles.railHeader}>
      <View><Text style={styles.railEyebrow}>你的照顧空間</Text><Text accessibilityRole="header" style={styles.railTitle}>資訊與提醒</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="關閉資訊側欄" onPress={onClose} style={({ pressed }) => [styles.iconAction, pressed && styles.pressed]}><Text style={styles.iconActionText}>×</Text></Pressable>
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
      <SectionCard>
        <SectionHeader title="近期已確認記錄" action={<TextLink label="查看全部" onPress={() => actions.open("care")} />} />
        {model.recordsLoad === "loading" ? <Text style={styles.railMeta}>正在讀取記錄…</Text> : records.length === 0 ? <Text style={styles.railMeta}>目前沒有已載入記錄。</Text> : records.map((record, index) => <View key={record.id}>
          {index > 0 ? <Divider style={styles.divider} /> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={`查看${record.title}`} onPress={() => actions.open("care")} style={({ pressed }) => [styles.railRecord, pressed && styles.pressed]}>
            <View style={styles.recordMark}><Text style={styles.recordMarkText}>▤</Text></View>
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
  const [accountOpen, setAccountOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const active = (path: AppPath) => pathname === path;

  return <View style={styles.root}>
    {!compact ? <View style={styles.sidebar}>
      <Image source={logo} resizeMode="contain" accessibilityLabel="育伴港" style={styles.logo} />
      <Text style={styles.brandLine}>用資料 · 陪伴成長</Text>
      <View style={styles.navList}>{navigation.map(item => <NavItem key={item.href} item={item} active={active(item.href)} />)}</View>
      <View style={styles.sidebarBottom}>
        <Image source={harbourArt} resizeMode="cover" accessibilityLabel="香港海旁照顧者與孩子插畫" style={styles.sidebarArt} />
        <Text style={styles.sidebarArtCaption}>用可靠資料，陪孩子健康成長。</Text>
      </View>
      <Pressable accessibilityRole="link" accessibilityLabel="設定" accessibilityState={{ selected: active("/settings") }} onPress={() => router.push("/settings")}
        style={({ pressed }) => [styles.navItem, active("/settings") && styles.navActive, pressed && styles.pressed]}>
        <Text style={[styles.navGlyph, active("/settings") && styles.navActiveText]}>⚙</Text><Text style={[styles.navLabel, active("/settings") && styles.navActiveText]}>設定</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="用戶選單" accessibilityState={{ expanded: accountOpen }} onPress={() => setAccountOpen(true)} style={({ pressed }) => [styles.account, pressed && styles.pressed]}>
        <View style={styles.accountAvatar}><Text style={styles.accountAvatarText}>{model.caregiverName.slice(0, 1)}</Text></View>
        <View style={styles.accountCopy}><Text style={styles.accountName}>{model.caregiverName}</Text><Text style={styles.accountHint}>合成預覽帳戶</Text></View>
        <Text style={styles.accountArrow}>⌄</Text>
      </Pressable>
    </View> : null}
    <View style={styles.stage}>
      <View style={[styles.topbar, compact && styles.topbarCompact, tiny && styles.topbarTiny]}>
        {compact ? <Image source={logo} resizeMode="contain" accessibilityLabel="育伴港" style={[styles.topLogo, tiny && styles.topLogoTiny]} /> : null}
        <ChildPicker compact={compact} tiny={tiny} />
        {!compact ? <Text numberOfLines={1} style={styles.topContext}>用資料陪伴每一步</Text> : null}
        <View style={styles.topActions}>
          {!compact ? <ConnectionPill state={model.connection} /> : null}
          <NotificationBell operation={model.operation} connection={model.connection} onReview={actions.reviewOperation} />
          <Pressable accessibilityRole="button" accessibilityLabel={wide && railOpen ? "收起資訊側欄" : "開啟資訊側欄"}
            accessibilityState={{ expanded: wide ? railOpen : railModal }}
            onPress={() => wide ? setRailOpen(value => !value) : setRailModal(true)}
            style={({ pressed }) => [styles.infoAction, tiny && styles.infoActionTiny, pressed && styles.pressed]}><Text style={styles.infoActionText}>☷</Text></Pressable>
        </View>
      </View>
      <PreviewToolbar />
      {notice ? <Pressable accessibilityRole="button" accessibilityLabel="關閉預覽提示" onPress={dismissNotice} style={styles.notice}><Text style={styles.noticeText}>{notice}　×</Text></Pressable> : null}
      <View style={styles.body}>
        <View style={styles.content}>{children}</View>
        {wide && railOpen ? <RightRail {...railProps} onClose={() => setRailOpen(false)} /> : null}
      </View>
      {compact ? <View style={styles.bottomNav}>
        {navigation.slice(0, 4).map(item => <NavItem key={item.href} item={item} active={active(item.href)} compact />)}
        <Pressable accessibilityRole="button" accessibilityLabel="更多頁面" accessibilityState={{ expanded: moreOpen }} onPress={() => setMoreOpen(true)} style={({ pressed }) => [styles.bottomNavItem, pressed && styles.pressed]}><Text style={[styles.bottomGlyph, ["/family", "/memory", "/settings"].includes(pathname) && styles.navActiveText]}>☷</Text><Text style={[styles.bottomLabel, ["/family", "/memory", "/settings"].includes(pathname) && styles.navActiveText]}>更多</Text></Pressable>
      </View> : null}
    </View>
    <Portal>
      <Modal visible={railModal && !wide} onDismiss={() => setRailModal(false)} contentContainerStyle={styles.railModal}>
        <RightRail {...railProps} onClose={() => setRailModal(false)} />
      </Modal>
      <Dialog visible={accountOpen} onDismiss={() => setAccountOpen(false)}>
        <Dialog.Title>用戶與帳戶</Dialog.Title>
        <Dialog.Content><Text style={styles.dialogBody}>{model.caregiverName} · 合成預覽帳戶。正式登入、登出及權限由主聊天接線。</Text></Dialog.Content>
        <Dialog.Actions>
          <Button onPress={() => { setAccountOpen(false); router.push("/login"); }}>查看登入畫面</Button>
          <Button onPress={() => { setAccountOpen(false); router.push("/settings"); }}>設定</Button>
          <Button onPress={() => setAccountOpen(false)}>關閉</Button>
        </Dialog.Actions>
      </Dialog>
      <Dialog visible={moreOpen} onDismiss={() => setMoreOpen(false)}>
        <Dialog.Title>更多頁面</Dialog.Title>
        <Dialog.Content>
          <Button onPress={() => { setMoreOpen(false); router.push("/family"); }}>家庭協調</Button>
          <Button onPress={() => { setMoreOpen(false); router.push("/memory"); }}>記憶與話題</Button>
          <Button onPress={() => { setMoreOpen(false); router.push("/settings"); }}>設定</Button>
          <Button onPress={() => { setMoreOpen(false); setAccountOpen(true); }}>用戶與帳戶</Button>
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
  logo: { width: 164, height: 53, alignSelf: "flex-start" },
  brandLine: { fontFamily: chineseFont, color: colors.teal, fontSize: typeScale.caption, marginLeft: spacing.lg, marginBottom: spacing.xl },
  navList: { gap: spacing.xs },
  navItem: { minHeight: 46, borderRadius: radius.small, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md },
  navActive: { backgroundColor: colors.selectedNav, borderLeftColor: colors.teal, borderLeftWidth: 3 },
  navGlyph: { width: 23, textAlign: "center", fontSize: 22, color: colors.deepTeal },
  navLabel: { fontFamily: chineseFont, fontSize: typeScale.small, fontWeight: "600", color: colors.ink },
  navActiveText: { color: colors.deepTeal, fontWeight: "800" },
  sidebarBottom: { marginTop: "auto", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.mintSurface, borderRadius: radius.medium, overflow: "hidden" },
  sidebarArt: { width: "100%", height: 105 },
  sidebarArtCaption: { fontFamily: chineseFont, color: colors.ink, textAlign: "center", fontSize: typeScale.caption, lineHeight: 19, padding: spacing.sm },
  account: { minHeight: 56, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium, backgroundColor: colors.white, paddingHorizontal: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  accountAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" },
  accountAvatarText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.small, fontWeight: "800" },
  accountCopy: { flex: 1, minWidth: 0 },
  accountName: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "700" },
  accountHint: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption },
  accountArrow: { color: colors.deepTeal, fontSize: typeScale.title },
  stage: { flex: 1, minWidth: 0, minHeight: 0 },
  topbar: { height: 70, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.softLine, paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", gap: spacing.lg },
  topbarCompact: { height: 64, paddingHorizontal: spacing.md, gap: spacing.sm },
  topbarTiny: { paddingHorizontal: spacing.sm, gap: spacing.xs },
  topLogo: { width: 98, height: 35, marginRight: "auto" },
  topLogoTiny: { width: 70 },
  childPicker: { minWidth: 185, maxWidth: 260, minHeight: 46, paddingHorizontal: spacing.sm, gap: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.quietSurface, flexDirection: "row", alignItems: "center" },
  childPickerCompact: { minWidth: 130, maxWidth: 170, flexShrink: 1 },
  childPickerTiny: { minWidth: 98, maxWidth: 112, paddingHorizontal: spacing.sm, gap: spacing.xs },
  childAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  childAvatarText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.small, fontWeight: "800" },
  childText: { flex: 1, minWidth: 0 },
  childName: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800" },
  childAge: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption },
  childArrow: { color: colors.teal, fontSize: 20 },
  topContext: { fontFamily: chineseFont, fontSize: typeScale.small, color: colors.muted, flex: 1 },
  topActions: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: spacing.sm },
  infoAction: { minWidth: 44, minHeight: 44, backgroundColor: colors.quietSurface, borderRadius: radius.small, alignItems: "center", justifyContent: "center" },
  infoActionTiny: { minWidth: 38, minHeight: 40 },
  infoActionText: { color: colors.deepTeal, fontSize: 23 },
  previewArea: { backgroundColor: colors.previewSurface, borderBottomWidth: 1, borderBottomColor: colors.line },
  previewLine: { minHeight: 36, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  previewLabel: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption, flexShrink: 1 },
  previewToggle: { minHeight: 32, justifyContent: "center", paddingHorizontal: spacing.sm },
  previewToggleText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption, fontWeight: "700" },
  scenarios: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  scenario: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, justifyContent: "center" },
  scenarioSelected: { backgroundColor: colors.teal, borderColor: colors.teal },
  scenarioText: { fontFamily: chineseFont, fontSize: typeScale.caption, color: colors.ink, fontWeight: "700" },
  scenarioSelectedText: { color: colors.white },
  notice: { backgroundColor: colors.paleAmber, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  noticeText: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.caption },
  body: { flex: 1, flexDirection: "row", minHeight: 0 },
  content: { flex: 1, minWidth: 0, minHeight: 0 },
  rail: { width: 310, height: "100%", backgroundColor: colors.sidebar, borderLeftWidth: 1, borderLeftColor: colors.line },
  railHeader: { minHeight: 74, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  railEyebrow: { fontFamily: chineseFont, color: colors.teal, fontSize: typeScale.caption, fontWeight: "700" },
  railTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.title, fontWeight: "800" },
  iconAction: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  iconActionText: { fontSize: 25, color: colors.deepTeal },
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
  railModal: { alignSelf: "flex-end", width: "92%", maxWidth: 370, height: "92%", backgroundColor: colors.sidebar, borderRadius: radius.large, overflow: "hidden" },
  dialogBody: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 22 },
  bottomNav: { height: 68, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, flexDirection: "row" },
  bottomNavItem: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center", gap: 2 },
  bottomGlyph: { fontSize: 22, color: colors.muted },
  bottomLabel: { fontFamily: chineseFont, color: colors.muted, fontSize: 11, fontWeight: "700" },
});

import { AvatarView } from '../components/avatar/AvatarView';
import { AvatarEditor } from '../components/avatar/AvatarEditor';
import { useProductionAvatar } from '../production/useProductionAvatar';
import { BackgroundSurface } from "../components/appearance/BackgroundSurface";
import { AdminEntry } from '../production/AdminEntry';
import { EmptyListCard } from "../components/EmptyListCard";
import { useContainerWidth } from "../components/useContainerWidth";
import { useEffect, useId, useState } from "react";
import { useLocalSearchParams, usePathname } from "expo-router";
import { useProductionVisibleSettingsSection } from "../production/ProductionFirstScreenGate";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { Pressable, StyleSheet, View } from "react-native";
import { Divider, Text } from "react-native-paper";
import { BackgroundSettings } from "../components/appearance/BackgroundSettings";
import { MotionSettings } from "../components/appearance/MotionSettings";
import { PageFrame } from "../components/PageFrame";
import { AppButton, AppTabPanel, SectionHeader, TextLink } from "../components/ui";
import { useProduction } from "../production/ProductionProvider";
import { AccountDataControls, AccountSecurityControls } from "../components/account/AccountDataControls";
import { AgentAuthorization } from "../production/AgentAuthorization";
import { ModelSettingsView } from "../components/model-settings/ModelSettingsView";
import { ProductionChannelSettings, ProductionNotificationPreferences, useProductionSettingsDomains } from "../production/SettingsDomains";
import { AppIcon } from "../components/AppIcon";
import { SettingsNavigation } from "../components/settings/SettingsNavigation";
import { SettingsSection as SectionCard } from "../components/settings/SettingsSection";
import { chineseFont, colors, readingType, spacing, typeScale } from "../theme";

type SettingsTab = "account" | "children" | "family" | "preferences" | "notifications" | "model" | "assistant" | "privacy";
const tabs: { key: SettingsTab; label: string; group?: string }[] = [
  { key: "account", label: "帳戶", group: "身份與資料" }, { key: "children", label: "孩子" },
  { key: "family", label: "家庭" }, { key: "preferences", label: "外觀", group: "使用體驗" }, { key: "notifications", label: "通知" },
  { key: "assistant", label: "助手", group: "授權與控制" }, { key: "model", label: "模型" }, { key: "privacy", label: "私隱" },
];

const sectionDescriptions: Record<SettingsTab, string> = { account: "個人資料、登入身份與會話安全", children: "選擇孩子，查看及補充檔案", family: "協作開放狀態與本人可用功能", preferences: "選擇背景與適合自己的動態效果", notifications: "接收方式、安靜時段與通知渠道", assistant: "按孩子設定助手可以代辦的範圍", model: "選用的模型服務與本人憑據", privacy: "資料可見範圍、匯出與帳戶控制" };

function LabeledValue({ label, value }: { label: string; value: string }) {
  return <View style={styles.valueRow}><Text style={styles.valueLabel}>{label}</Text><Text style={styles.valueText}>{value}</Text></View>;
}

export default function SettingsPage() {
  const avatar = useProductionAvatar('self', true);
  const pathname = usePathname();
  const leave = usePreviewNavigation();
  const containerLayout = useContainerWidth();
  const width = containerLayout.width;
  const { model, actions, user, scopeKey, authorization, signOut, recordsState, online } = useProduction();
  const { modelSettings } = useProductionSettingsDomains();
  const { section } = useLocalSearchParams<{ section?: string | string[] }>();
  const requestedSection = Array.isArray(section) ? section[0] : section;
  const initialTab = tabs.find(item => item.key === requestedSection)?.key ?? "account";
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  useProductionVisibleSettingsSection(tab);
  useEffect(() => { setTab(initialTab); }, [initialTab]);
  useEffect(() => { if (authorization.pending) setTab("assistant"); }, [authorization.pending]);
  const tabsId = useId();
  const accountName = user?.name ?? "";
  const compactNavigation = width < 720;
  return <PageFrame density="compact" title="設定">
    <View ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={[styles.workspace, compactNavigation && styles.workspaceStack]}>
    <SettingsNavigation id={tabsId} items={tabs} value={tab} onChange={setTab} compact={compactNavigation} />
    <View style={styles.settingsContent}>
    <View style={styles.sectionHeading}><Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>{tabs.find(item => item.key === tab)?.label}</Text><Text style={styles.body}>{sectionDescriptions[tab]}</Text></View>
    <AppTabPanel tabsId={tabsId} tabKey="account" active={tab === "account"} style={styles.sections}>
      <View style={styles.accountGrid}><View style={styles.accountIdentity}>
        <SectionCard surface="plain"><SectionHeader title="你的身份" subtitle="這是登入與私人資料使用的帳戶。" />
          <View style={styles.identity}><AvatarView name={accountName} uri={avatar.state.uri} size={55} /><View style={styles.identityText}><Text style={styles.identityName}>{accountName || "未命名"}</Text><Text style={styles.muted}>{user?.email ?? "尚未讀取電郵"}</Text></View></View>
          <AvatarEditor lane={avatar.lane} state={avatar.state} name={accountName} kind="self" />
          <Divider style={styles.divider} />
          <LabeledValue label="登入方式" value="電郵與密碼" />
        </SectionCard>
        <SectionCard><SectionHeader density="compact" title="語言與地區" />
          <LabeledValue label="介面語言" value="繁體中文（香港）" /><LabeledValue label="地區" value="香港" />
        </SectionCard>
      </View>
      <View style={styles.accountSecurity}>
        <SectionCard surface="plain" testID="account-settings"><SectionHeader title="登入與安全" subtitle="管理本人會話與登入憑證。" />

          <AppButton label="登出本人帳戶" variant="secondary" onPress={() => leave(() => { void signOut(); })} />
          <AccountSecurityControls />
          <AdminEntry />

        </SectionCard>
      </View></View>
    </AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="children" active={tab === "children"}><SectionCard>
      {model.children.length === 0 ? recordsState.childrenLoadedAt && !recordsState.childrenLoading && !recordsState.childrenError && online ? <EmptyListCard title="目前沒有孩子檔案" /> : <Text style={styles.body}>{recordsState.childrenLoading ? "正在讀取孩子列表…" : recordsState.childrenError ? "孩子列表未能讀取，請重新核對。" : "孩子列表尚未核對。"}</Text> : model.children.map(child => <Pressable key={child.id} accessibilityRole="button" accessibilityLabel={`查看${child.displayName}的檔案`} onPress={() => leave(() => { actions.selectChild(child.id); actions.open("profile"); })} style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}><View style={styles.miniAvatar}><Text style={styles.avatarText}>{child.displayName.slice(0, 1)}</Text></View><View style={styles.identityText}><Text style={styles.identityName}>{child.displayName}</Text><Text style={styles.muted}>{child.ageLabel} · {child.profileConfirmed ? "已確認" : "待核對"}</Text></View><AppIcon name="arrow-right" size={18} /></Pressable>)}

    </SectionCard></AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="family" active={tab === "family"}><SectionCard><Text style={styles.muted}>家庭協作尚未開放。本人聯絡與授權仍可管理。</Text>
      <View style={styles.timeRow}><AppButton label="聯絡" variant="quiet" onPress={() => actions.open("contact")} /></View>
    </SectionCard></AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="preferences" active={tab === "preferences"} style={styles.sections}>
      <MotionSettings />
      <BackgroundSettings />
    </AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="notifications" active={tab === "notifications"} style={styles.sections}>
      <ProductionNotificationPreferences />
      <ProductionChannelSettings />
    </AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="assistant" active={tab === "assistant"}>
      {scopeKey ? <AgentAuthorization key={scopeKey} /> : <SectionCard><Text style={styles.body}>先選擇孩子。</Text></SectionCard>}
    </AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="model" active={tab === "model"}><ModelSettingsView model={modelSettings.model} actions={modelSettings.actions} active={pathname === "/settings" && tab === "model"} /></AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="privacy" active={tab === "privacy"} style={styles.sections}>
      <View style={styles.sectionGroup}><SectionCard><SectionHeader density="compact" title="私隱" />
        <LabeledValue label="私人聊天" value="只對本人可見" /><LabeledValue label="共享資料" value="按孩子及家庭角色授權" />
      </SectionCard>
        <SectionCard testID="settings-data-sources"><SectionHeader density="compact" title="來源" icon="link-variant" />
          <AppButton label="管理來源" variant="quiet" onPress={() => actions.open("sources")} />
          <Text style={styles.draftNote}>完整來源保持本人私人；共享照護記錄須另行確認。</Text>
        </SectionCard>
      </View>
      <View style={styles.sectionGroup}><SectionCard><SectionHeader density="compact" title="帳戶操作" />
        <AccountDataControls />
        <TextLink label="查看帳戶資料" onPress={() => setTab("account")} />
      </SectionCard></View>
    </AppTabPanel>
    </View>
    </View>
  </PageFrame>;
}

const styles = StyleSheet.create({
  accountGrid: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: spacing.xxl, minWidth: 0 },
  accountIdentity: { flexGrow: 1, flexBasis: 320, minWidth: 0, maxWidth: "100%", gap: spacing.xl },
  accountSecurity: { flexGrow: 1, flexBasis: 260, minWidth: 0, maxWidth: "100%", padding: spacing.lg, borderRadius: 12, backgroundColor: colors.quietSurface },
  sectionHeading: { gap: spacing.sm, paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.line }, sectionTitle: { fontFamily: chineseFont, fontSize: 24, lineHeight: 34, fontWeight: "700", color: colors.ink },
  workspace: { width: "100%", minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: spacing.xxl },
  workspaceStack: { flexDirection: "column", gap: spacing.lg },
  settingsContent: { flex: 1, flexBasis: "auto", width: "100%", minWidth: 0, gap: spacing.xl, maxWidth: 800 },
  scopeNote: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: spacing.md },
  pressed: { backgroundColor: colors.pressedOverlay },
  sections: { gap: spacing.xl, width: "100%", minWidth: 0 },
  sectionGroup: { width: "100%", minWidth: 0, gap: spacing.xl },
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.md }, avatar: { width: 55, height: 55, borderRadius: 28, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center" }, avatarText: { color: colors.white, fontFamily: chineseFont, fontSize: typeScale.title, fontWeight: "800" }, identityText: { flex: 1, minWidth: 0, gap: spacing.xs }, identityName: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "800" }, muted: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta }, divider: { backgroundColor: colors.softLine }, label: { fontFamily: chineseFont, color: colors.ink, ...readingType.meta, fontWeight: "700" }, draftNote: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  valueRow: { minHeight: 40, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine }, valueLabel: { width: 96, fontFamily: chineseFont, color: colors.muted, ...readingType.meta }, valueText: { flex: 1, minWidth: 130, fontFamily: chineseFont, color: colors.ink, ...readingType.tool }, body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  settingGroup: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md, gap: spacing.md }, helpTitle: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "800" }, listRow: { minHeight: 66, borderBottomWidth: 1, borderBottomColor: colors.softLine, flexDirection: "row", alignItems: "center", gap: spacing.md }, miniAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center" },
  timeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
});

import { RouteTextLink } from "../components/RouteTextLink";
import { parseSettingsRoute, serializeSettingsRoute } from "../navigation/route-state";
import { useGuardedRoute } from "../navigation/useGuardedRoute";
import { projectHomeChildren } from "../production/home-projection";
import { useProfileWorkspace } from "../workspaces/ProfileWorkspace";
import { AvatarView } from '../components/avatar/AvatarView';
import { AvatarEditor } from '../components/avatar/AvatarEditor';
import { useProductionAvatar } from '../production/useProductionAvatar';
import { AdminEntry } from '../production/AdminEntry';
import { EmptyListCard } from "../components/EmptyListCard";
import { useContainerWidth } from "../components/useContainerWidth";
import { useEffect, useId, useState } from "react";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { useProductionVisibleSettingsSection } from "../production/ProductionFirstScreenGate";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { StyleSheet, View } from "react-native";
import { Divider, Text, TouchableRipple } from "react-native-paper";
import { BackgroundSettings } from "../components/appearance/BackgroundSettings";
import { MotionSettings } from "../components/appearance/MotionSettings";
import { PageFrame } from "../components/PageFrame";
import { AppButton, AppTabPanel, SectionHeader } from "../components/ui";
import { useProduction } from "../production/ProductionProvider";
import { AccountDataControls, AccountSecurityControls } from "../components/account/AccountDataControls";
import { AgentAuthorization } from "../production/AgentAuthorization";
import { ModelSettingsView } from "../components/model-settings/ModelSettingsView";
import { ProductionChannelSettings, ProductionNotificationPreferences, useSettingsRetainedDrafts, useProductionSettingsDomains } from "../production/SettingsDomains";
import { AppIcon } from "../components/AppIcon";
import { ReadTargetLink } from "../components/ReadTargetLink";
import { SettingsNavigation } from "../components/settings/SettingsNavigation";
import { SettingsSection as SectionCard } from "../components/settings/SettingsSection";
import { chineseFont, colors, readingType, spacing } from "../theme";

type SettingsTab = "account" | "children" | "family" | "preferences" | "notifications" | "model" | "assistant" | "privacy";
const tabs: { key: SettingsTab; label: string; group?: string }[] = [
  { key: "account", label: "帳戶", group: "身份與資料" }, { key: "children", label: "孩子" },
  { key: "preferences", label: "外觀", group: "使用體驗" }, { key: "notifications", label: "通知" },
  { key: "assistant", label: "助手", group: "授權與控制" }, { key: "model", label: "模型" }, { key: "privacy", label: "私隱" },
];


function ChildProfileAction({ child, onOpen }: { child: ReturnType<typeof projectHomeChildren>[number]; onOpen(): void }) {
  const [focused, setFocused] = useState(false);
  return <TouchableRipple accessibilityRole="button" accessibilityLabel={`查看${child.displayName}的檔案`} onPress={onOpen}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={[styles.childAction, focused && styles.childFocused]}>
    <View style={styles.listRow}><AvatarView name={child.displayName} uri={null} size={40} />
      <View style={styles.identityText}><Text style={styles.identityName}>{child.displayName}</Text><Text style={styles.muted}>{child.ageLabel} · {child.profileReadLabel}</Text></View>
      <AppIcon name="arrow-right" size={18} />
    </View>
  </TouchableRipple>;
}

function LabeledValue({ label, value }: { label: string; value: string }) {
  return <View style={styles.valueRow}><Text style={styles.valueLabel}>{label}</Text><Text style={styles.valueText}>{value}</Text></View>;
}

export default function SettingsPage() {
  const avatar = useProductionAvatar('self', true);
  const pathname = usePathname();
  const leave = usePreviewNavigation();
  const containerLayout = useContainerWidth();
  const width = containerLayout.width;
  const { owner, model, actions, user, scopeKey, identityKey, authorization, signOut, recordsState, online } = useProduction();
  const profile = useProfileWorkspace();
  const children = projectHomeChildren(model, profile);
  const { modelSettings } = useProductionSettingsDomains();
  const params = useLocalSearchParams(), router = useRouter();
  const { section } = parseSettingsRoute(params);
  const tab = section === "family" ? "children" : section;
  const navigate = useGuardedRoute(scopeKey, owner), retainedDrafts = useSettingsRetainedDrafts();
  function setTab(next: SettingsTab) {
    if (next !== tab) navigate({ pathname: "/settings", params: serializeSettingsRoute({ section: next }) }, "push", "navigation", retainedDrafts.isCurrent, retainedDrafts.ids());
  }
  useProductionVisibleSettingsSection(tab);
  useEffect(() => {
    if (pathname === "/settings" && authorization.pending && tab !== "assistant") router.replace({ pathname: "/settings", params: { section: "assistant" } });
  }, [pathname, authorization.pending, tab]);
  const tabsId = useId();
  const accountName = user?.name ?? "";
  const compactNavigation = width < 720;
  if (pathname !== "/settings") return null;
  return <PageFrame density="compact" title="我的">
    <View ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={[styles.workspace, compactNavigation && styles.workspaceStack]}>
    <SettingsNavigation items={tabs} hrefFor={next => ({ pathname: "/settings", params: serializeSettingsRoute({ section: next }) })} value={tab} onChange={setTab} compact={compactNavigation} />
    <View style={styles.settingsContent}>
    <View style={styles.sectionHeading}><Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>{tabs.find(item => item.key === tab)?.label}</Text></View>
    <AppTabPanel hasTabList={false} tabsId={tabsId} tabKey="account" active={tab === "account"} style={styles.sections}>
      <View style={styles.accountGrid}><View style={styles.accountIdentity}>
        <SectionCard surface="plain"><SectionHeader headingLevel={3} title="登入身份" />
          <View style={styles.identity}><AvatarView name={accountName} uri={avatar.state.uri} size={55} /><View style={styles.identityText}><Text style={styles.identityName}>{accountName || "未命名"}</Text><Text style={styles.muted}>{user?.email ?? "尚未讀取電郵"}</Text></View></View>
          <AvatarEditor lane={avatar.lane} state={avatar.state} name={accountName} kind="self" />
          <Divider style={styles.divider} />
          <LabeledValue label="登入方式" value="電郵與密碼" />
        </SectionCard>
        <SectionCard><SectionHeader headingLevel={3} density="compact" title="語言與地區" />
          <LabeledValue label="介面語言" value="繁體中文（香港）" /><LabeledValue label="地區" value="香港" />
        </SectionCard>
      </View>
      <View style={styles.accountSecurity}>
        <SectionCard surface="plain" testID="account-settings"><SectionHeader headingLevel={3} title="登入與安全" />

          <AppButton label="登出本人帳戶" variant="secondary" onPress={() => leave(() => { void signOut(); })} />
          <AccountSecurityControls />
          <AdminEntry />

        </SectionCard>
      </View></View>
    </AppTabPanel>
    <AppTabPanel hasTabList={false} tabsId={tabsId} tabKey="children" active={tab === "children"}><SectionCard>
      {children.length === 0 ? recordsState.childrenLoadedAt && !recordsState.childrenLoading && !recordsState.childrenError && online ? <EmptyListCard title="目前沒有孩子檔案" /> : <Text style={styles.body}>{recordsState.childrenLoading ? "正在讀取孩子列表…" : recordsState.childrenError ? "孩子列表未能讀取，請重新核對。" : "孩子列表尚未核對。"}</Text> : children.map(child => <ChildProfileAction key={child.id} child={child} onOpen={() => actions.openChildProfile(child.id)} />)}

      <View style={styles.secondaryStatus}><Text style={styles.body}>家庭協作尚未開放。本人聯絡與授權仍可管理。</Text>
        <RouteTextLink href="/contact" scopeKey={scopeKey} label="管理本人聯絡方式" />
      </View>
    </SectionCard></AppTabPanel>
    <AppTabPanel hasTabList={false} tabsId={tabsId} tabKey="preferences" active={tab === "preferences"} style={styles.sections}>
      <MotionSettings />
      <BackgroundSettings />
    </AppTabPanel>
    <AppTabPanel hasTabList={false} tabsId={tabsId} tabKey="notifications" active={tab === "notifications"} style={styles.sections}>
      <ProductionNotificationPreferences />
      <ProductionChannelSettings />
    </AppTabPanel>
    <AppTabPanel hasTabList={false} tabsId={tabsId} tabKey="assistant" active={tab === "assistant"}>
      {scopeKey ? <AgentAuthorization key={scopeKey} notificationSettingsLink={<ReadTargetLink href={{ pathname: "/settings", params: { section: "notifications" } }} label="前往通知設定" routeFocusKey={compactNavigation ? "settings-category" : "settings-section-notifications"} onOpen={() => setTab("notifications")} style={styles.inlineLink}><Text style={styles.body}>前往通知設定</Text></ReadTargetLink>} /> : <SectionCard><Text style={styles.body}>先選擇孩子。</Text></SectionCard>}
    </AppTabPanel>
    <AppTabPanel hasTabList={false} tabsId={tabsId} tabKey="model" active={tab === "model"}><ModelSettingsView model={modelSettings.model} actions={modelSettings.actions} active={pathname === "/settings" && tab === "model"} /></AppTabPanel>
    <AppTabPanel hasTabList={false} tabsId={tabsId} tabKey="privacy" active={tab === "privacy"} style={styles.sections}>
      <View style={styles.sectionGroup}><SectionCard><SectionHeader headingLevel={3} density="compact" title="資料可見範圍" />
        <LabeledValue label="私人聊天" value="只對本人可見" /><LabeledValue label="共享資料" value="按孩子及家庭角色授權" />
      </SectionCard>
        <SectionCard testID="settings-data-sources"><SectionHeader headingLevel={3} density="compact" title="原始來源" />
          <RouteTextLink href="/sources" scopeKey={scopeKey} label="管理來源" />
          <Text style={styles.draftNote}>完整來源保持本人私人；共享照護記錄須另行確認。</Text>
        </SectionCard>
      </View>
      <View style={styles.sectionGroup}><SectionCard><SectionHeader headingLevel={3} density="compact" title="帳戶資料" />
        <AccountDataControls />
        <ReadTargetLink href={{ pathname: "/settings", params: { section: "account" } }} label="查看帳戶資料" routeFocusKey={compactNavigation ? "settings-category" : "settings-section-account"} onOpen={() => setTab("account")} style={styles.inlineLink}><Text style={styles.body}>查看帳戶資料</Text></ReadTargetLink>
      </SectionCard></View>
    </AppTabPanel>
    </View>
    </View>
    <RouteTextLink href="/more" scopeKey={scopeKey} label="全部功能與使用說明" />
  </PageFrame>;
}

const styles = StyleSheet.create({
  accountGrid: { gap: spacing.xxl, minWidth: 0 },
  accountIdentity: { minWidth: 0, gap: spacing.xl },
  accountSecurity: { minWidth: 0, paddingTop: spacing.xl, borderTopWidth: 1, borderTopColor: colors.line },
  sectionHeading: { paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line },
  sectionTitle: { fontFamily: chineseFont, fontSize: 24, lineHeight: 34, fontWeight: "700", color: colors.ink },
  workspace: { width: "100%", minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: spacing.xxl },
  workspaceStack: { flexDirection: "column", gap: spacing.md },
  settingsContent: { flex: 1, flexBasis: "auto", width: "100%", minWidth: 0, gap: spacing.xl, maxWidth: 720 },
  sections: { gap: spacing.xxl, width: "100%", minWidth: 0 },
  sectionGroup: { width: "100%", minWidth: 0, gap: spacing.xl },
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  identityText: { flex: 1, minWidth: 0, gap: spacing.xs },
  identityName: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "700" },
  muted: { fontFamily: chineseFont, color: colors.muted, ...readingType.body }, divider: { backgroundColor: colors.softLine },
  draftNote: { fontFamily: chineseFont, color: colors.muted, ...readingType.body },
  valueRow: { minHeight: 44, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  valueLabel: { width: 96, fontFamily: chineseFont, color: colors.muted, ...readingType.body },
  valueText: { flex: 1, minWidth: 130, fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.body },
  listRow: { minHeight: 72, borderBottomWidth: 1, borderBottomColor: colors.softLine, flexDirection: "row", alignItems: "center", gap: spacing.md },
  childAction: { width: "100%", minWidth: 0 },
  childFocused: { outlineWidth: 2, outlineStyle: "solid", outlineColor: colors.ink, outlineOffset: 2 },
  secondaryStatus: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.lg, gap: spacing.sm },
  inlineLink: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start", paddingVertical: spacing.sm },
});

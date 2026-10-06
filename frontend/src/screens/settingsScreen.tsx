import { useContainerWidth } from "../components/useContainerWidth";
import { brand } from "../branding";
import { useEffect, useId, useState } from "react";
import { usePreviewNavigation, usePreviewLeaveGuard } from "../preview/PreviewNavigationGuard";
import { Pressable, StyleSheet, View } from "react-native";
import { Divider, Text } from "react-native-paper";
import { BackgroundSettings } from "../components/appearance/BackgroundSettings";
import { MotionSettings } from "../components/appearance/MotionSettings";
import { PageFrame } from "../components/PageFrame";
import { AppButton, AppTabPanel, AppTextField, SectionHeader, TextLink } from "../components/ui";
import { useProduction } from "../production/ProductionProvider";
import { ModelSettingsView } from "../components/model-settings/ModelSettingsView";
import { ProductionChannelSettings, ProductionNotificationPreferences, useProductionSettingsDomains } from "../production/SettingsDomains";
import { AppIcon } from "../components/AppIcon";
import { SettingsNavigation } from "../components/settings/SettingsNavigation";
import { SettingsSection as SectionCard } from "../components/settings/SettingsSection";
import { chineseFont, colors, readingType, spacing, typeScale } from "../theme";

type SettingsTab = "account" | "children" | "family" | "preferences" | "notifications" | "model" | "privacy";
const tabs: { key: SettingsTab; label: string }[] = [
  { key: "account", label: "個人與帳戶" }, { key: "children", label: "孩子設定" },
  { key: "family", label: "家庭成員" }, { key: "preferences", label: "應用偏好" }, { key: "notifications", label: "通知渠道" },
  { key: "model", label: "模型設定" }, { key: "privacy", label: "資料與私隱" },
];

function LabeledValue({ label, value }: { label: string; value: string }) {
  return <View style={styles.valueRow}><Text style={styles.valueLabel}>{label}</Text><Text style={styles.valueText}>{value}</Text></View>;
}

export default function SettingsPage() {
  const leave = usePreviewNavigation();
  const containerLayout = useContainerWidth();
  const width = containerLayout.width;
  const { model, actions, user, identityKey, signOut } = useProduction();
  const { modelSettings } = useProductionSettingsDomains();
  const [tab, setTab] = useState<SettingsTab>("account");
  const tabsId = useId();
  const accountName = user?.name ?? "";
  const [displayName, setDisplayName] = useState(accountName);
  useEffect(() => { setDisplayName(accountName); }, [identityKey, accountName]);
  usePreviewLeaveGuard(displayName !== accountName, false, "account");
  const compactNavigation = width < 720;
  const accountDirty = displayName !== accountName;
  return <PageFrame density="compact" title="設定" description="管理個人偏好、孩子與家庭資料。" eyebrow={`${brand.name} · 個人空間`}>
    <View ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={[styles.workspace, compactNavigation && styles.workspaceStack]}>
    <SettingsNavigation id={tabsId} items={tabs} value={tab} onChange={setTab} compact={compactNavigation} />
    <View style={styles.settingsContent}>
    <View style={styles.scopeNote}><Text style={styles.valueLabel}>本人的設定</Text>{accountDirty ? <Text style={styles.muted}>未保存草稿會保留</Text> : null}</View>
    <AppTabPanel tabsId={tabsId} tabKey="account" active={tab === "account"} style={styles.sections}>
      <View style={styles.sectionGroup}>
        <SectionCard><SectionHeader density="compact" title="個人資料" />
          <View style={styles.identity}><View style={styles.avatar}><Text style={styles.avatarText}>{displayName.slice(0, 1) || "育"}</Text></View><View style={styles.identityText}><Text style={styles.identityName}>{displayName || "未命名"}</Text><Text style={styles.muted}>{user?.email ?? "尚未讀取電郵"}</Text></View></View>
          <Divider style={styles.divider} />
          <Text style={styles.label}>顯示名稱</Text><AppTextField accessibilityLabel="顯示名稱草稿" value={displayName} onChangeText={setDisplayName} />
          {accountDirty ? <View style={styles.draftBoundary}><Text style={styles.draftTitle}>顯示名稱有未保存修改</Text><AppButton label="還原顯示名稱草稿" variant="quiet" onPress={() => setDisplayName(accountName)} /></View> : null}
          <LabeledValue label="電郵地址" value={user?.email ?? "尚未讀取"} />
          <Text style={styles.draftNote}>暫未能更改顯示名稱。</Text>
          <LabeledValue label="登入方式" value="電郵與密碼" />
        </SectionCard>
        <SectionCard><SectionHeader density="compact" title="語言與地區" />
          <LabeledValue label="介面語言" value="繁體中文（香港）" /><LabeledValue label="地區" value="香港" /><LabeledValue label="時間顯示" value="24 小時制 · Asia/Hong_Kong" />
        </SectionCard>
      </View>
      <View style={styles.sectionGroup}>
        <SectionCard testID="account-settings"><SectionHeader density="compact" title="登入與安全" subtitle="切換帳戶入口集中在這裏。" />

          <AppButton label="登出本人帳戶" variant="secondary" onPress={() => leave(() => { void signOut(); })} />
          <Text style={styles.draftNote}>社交登入、重設密碼及刪除帳戶暫不可用。</Text>
          <View style={styles.settingGroup}><SectionHeader density="compact" title="模型服務" subtitle="管理平台服務、個人密鑰及呼叫上限。" />
            <AppButton label="管理模型設定" variant="secondary" onPress={() => setTab("model")} />
          </View>
          <View style={styles.settingGroup}><SectionHeader density="compact" title="資料狀態" />
            <Text style={styles.body}>查看資料的使用方式與私人範圍。</Text>
            <TextLink label="查看資料與私隱" onPress={() => setTab("privacy")} />
          </View>
          <View style={styles.settingGroup}><SectionHeader density="compact" title="使用引導" subtitle="即使完成初始設定，也可隨時重看操作次序。" />
            <Text style={styles.body}>查看孩子資料、已保存記錄及家庭偏好的入口。</Text>
            <TextLink label="開啟使用引導" onPress={() => actions.open("guide")} />
          </View>
          <View style={styles.settingGroup}><Text style={styles.helpTitle}>需要協助？</Text><Text style={styles.body}>客服支援暫不可用。</Text></View>
        </SectionCard>
      </View>
    </AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="children" active={tab === "children"}><SectionCard><SectionHeader density="compact" title="孩子設定" />
      {model.children.length === 0 ? <Text style={styles.body}>目前沒有孩子檔案。</Text> : model.children.map(child => <Pressable key={child.id} accessibilityRole="button" accessibilityLabel={`查看${child.displayName}的檔案`} onPress={() => leave(() => { actions.selectChild(child.id); actions.open("profile"); })} style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}><View style={styles.miniAvatar}><Text style={styles.avatarText}>{child.displayName.slice(0, 1)}</Text></View><View style={styles.identityText}><Text style={styles.identityName}>{child.displayName}</Text><Text style={styles.muted}>{child.ageLabel} · {child.profileConfirmed ? "已確認" : "待核對"}</Text></View><AppIcon name="arrow-right" size={18} /></Pressable>)}

    </SectionCard></AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="family" active={tab === "family"}><SectionCard><SectionHeader density="compact" title="家庭成員" subtitle="共享記錄與私人聊天的權限分開處理。" />
      <View style={styles.timeRow}><AppButton label="查看家庭協調" onPress={() => actions.open("family")} /><AppButton label="聯絡與授權" variant="secondary" onPress={() => actions.open("contact")} /></View>
    </SectionCard></AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="preferences" active={tab === "preferences"} style={styles.sections}>
      <View style={styles.sectionGroup}>
        <MotionSettings />
        <ProductionNotificationPreferences />
        <BackgroundSettings />
      </View><View style={styles.sectionGroup}>
        <SectionCard><SectionHeader density="compact" title="通知渠道" />
          <LabeledValue label="站內狀態" value="依原事項／收據顯示" />
          <Text style={styles.body}>本人綁定與安靜時段分開設定。</Text>
          <TextLink label="查看本人通知渠道" onPress={() => setTab("notifications")} />
        </SectionCard>
      </View>
    </AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="notifications" active={tab === "notifications"}><ProductionChannelSettings /></AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="model" active={tab === "model"}><ModelSettingsView model={modelSettings.model} actions={modelSettings.actions} active={tab === "model"} /></AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="privacy" active={tab === "privacy"} style={styles.sections}>
      <View style={styles.sectionGroup}><SectionCard><SectionHeader density="compact" title="資料與私隱" />
        <Text style={styles.body}>孩子資料、已保存記錄與私人聊天的可見範圍，須按目前身份與家庭角色重新檢查。退出或撤權後會清除不再可見的資料。</Text>
        <LabeledValue label="私人聊天" value="只對本人可見" /><LabeledValue label="共享資料" value="按孩子及家庭角色授權" />
      </SectionCard>
        <SectionCard testID="settings-data-sources"><SectionHeader density="compact" title="資料來源" subtitle="你提供的來源，在同一處查看和管理。" icon="link-variant" />
          <Text style={styles.body}>管理私人來源及用途，需要時帶到聊天草稿，核對後再送出。</Text>
          <AppButton label="管理資料來源" variant="secondary" onPress={() => actions.open("sources")} />
          <Text style={styles.draftNote}>完整來源保持本人私人；共享照護記錄須另行確認。</Text>
        </SectionCard>
      </View>
      <View style={styles.sectionGroup}><SectionCard><SectionHeader density="compact" title="帳戶操作" />
        <Text style={styles.body}>資料匯出、刪除帳戶及儲存用量暫不可用。</Text>
        <TextLink label="查看帳戶資料" onPress={() => setTab("account")} />
      </SectionCard></View>
    </AppTabPanel>
    </View>
    </View>
  </PageFrame>;
}

const styles = StyleSheet.create({
  workspace: { width: "100%", minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: spacing.xxl },
  workspaceStack: { flexDirection: "column", gap: spacing.lg },
  settingsContent: { flex: 1, flexBasis: "auto", width: "100%", minWidth: 0, gap: spacing.xl, maxWidth: 800 },
  scopeNote: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: spacing.md },
  draftBoundary: { borderLeftWidth: 2, borderLeftColor: colors.line, paddingLeft: spacing.md, gap: spacing.xs },
  draftTitle: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  pressed: { backgroundColor: colors.pressedOverlay },
  sections: { gap: spacing.xl, width: "100%", minWidth: 0 },
  sectionGroup: { width: "100%", minWidth: 0, gap: spacing.xl },
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.md }, avatar: { width: 55, height: 55, borderRadius: 28, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center" }, avatarText: { color: colors.white, fontFamily: chineseFont, fontSize: typeScale.title, fontWeight: "800" }, identityText: { flex: 1, minWidth: 0, gap: spacing.xs }, identityName: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "800" }, muted: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta }, divider: { backgroundColor: colors.softLine }, label: { fontFamily: chineseFont, color: colors.ink, ...readingType.meta, fontWeight: "700" }, draftNote: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  valueRow: { minHeight: 40, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine }, valueLabel: { width: 96, fontFamily: chineseFont, color: colors.muted, ...readingType.meta }, valueText: { flex: 1, minWidth: 130, fontFamily: chineseFont, color: colors.ink, ...readingType.tool }, body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  settingGroup: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md, gap: spacing.md }, helpTitle: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "800" }, listRow: { minHeight: 66, borderBottomWidth: 1, borderBottomColor: colors.softLine, flexDirection: "row", alignItems: "center", gap: spacing.md }, miniAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center" },
  timeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
});

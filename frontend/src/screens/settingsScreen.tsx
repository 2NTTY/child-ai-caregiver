import { brand } from "../branding";
import { useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { Divider, Text } from "react-native-paper";
import { PreferencesPreview } from "../components/PreferencesPreview";
import { BackgroundSettings } from "../components/appearance/BackgroundSettings";
import { ChannelSettingsPreview } from "../components/notifications/ChannelSettingsPreview";
import { useChannelSettingsPreview } from "../preview/useChannelSettingsPreview";
import { ModelSettingsPreview } from "../components/model-settings/ModelSettingsPreview";
import { useModelSettingsPreview } from "../preview/useModelSettingsPreview";
import { PageFrame } from "../components/PageFrame";
import { AppButton, AppTextField, SectionCard, SectionHeader, TextLink, UnderlineTabs } from "../components/ui";
import { usePreview } from "../preview/PreviewContext";
import { AppIcon } from "../components/AppIcon";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";

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
  const router = useRouter();
  const [width, setWidth] = useState(0);
  const { model, actions } = usePreview();
  const channels = useChannelSettingsPreview(model.connection === "online");
  const modelSettings = useModelSettingsPreview(model.connection === "online", channels.identity);
  const [tab, setTab] = useState<SettingsTab>("account");
  const [displayName, setDisplayName] = useState(model.caregiverName);
  const stacked = width < 850;
  return <PageFrame title="設定" description="管理個人偏好、孩子與家庭資料；此獨立 Web 預覽沒有連接帳戶或保存設定。" eyebrow={`${brand.name} · 個人空間`}>
    <UnderlineTabs items={tabs} value={tab} onChange={setTab} />
    {tab === "account" ? <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={[styles.columns, stacked && styles.stack]}>
      <View style={[styles.column, stacked && styles.fullColumn]}>
        <SectionCard><SectionHeader title="個人資料" subtitle="目前資料只屬合成示例。" />
          <View style={styles.identity}><View style={styles.avatar}><Text style={styles.avatarText}>{displayName.slice(0, 1) || "育"}</Text></View><View style={styles.identityText}><Text style={styles.identityName}>{displayName || "未命名"}</Text><Text style={styles.muted}>preview@example.invalid · 合成資料</Text></View></View>
          <Divider style={styles.divider} />
          <Text style={styles.label}>顯示名稱</Text><AppTextField accessibilityLabel="顯示名稱預覽草稿" value={displayName} onChangeText={setDisplayName} />
          <Text style={styles.draftNote}>修改只在此畫面預覽；未保存至帳戶。正式版須沿用既有身份契約。</Text>
          <LabeledValue label="電郵地址" value="preview@example.invalid（合成）" />
          <LabeledValue label="登入方式" value="電郵與密碼（正式 App 已支援）" />
        </SectionCard>
        <SectionCard><SectionHeader title="語言與地區" subtitle="畫面現以香港繁體中文呈現；偏好尚未接線。" />
          <LabeledValue label="介面語言" value="繁體中文（香港）" /><LabeledValue label="地區" value="香港" /><LabeledValue label="時間顯示" value="24 小時制 · Asia/Hong_Kong" />
        </SectionCard>
      </View>
      <View style={[styles.column, stacked && styles.fullColumn]}>
        <SectionCard testID="account-settings"><SectionHeader title="登入與安全" subtitle="切換帳戶入口集中在這裏。" />
          <Text style={styles.body}>下方會開啟登入預覽，目前不會登出或切換真帳戶。</Text>
          <AppButton label="切換帳戶" variant="secondary" onPress={() => router.push("/login")} />
        </SectionCard>
        <SectionCard><SectionHeader title="模型服務" subtitle="管理平台服務、個人密鑰及呼叫上限。" />
          <AppButton label="管理模型設定" variant="secondary" onPress={() => setTab("model")} />
        </SectionCard>
        <SectionCard><SectionHeader title="資料狀態" />
          <Text style={styles.body}>目前展示的是合成孩子與記錄。真資料是否已保存，以原操作收據和授權讀取結果為準。</Text>
          <TextLink label="查看資料與私隱" onPress={() => setTab("privacy")} />
        </SectionCard>
        <SectionCard><SectionHeader title="使用引導" subtitle="即使完成初始設定，也可隨時重看操作次序。" />
          <Text style={styles.body}>查看孩子資料、已確認記錄及家庭偏好的入口。</Text>
          <TextLink label="開啟使用引導" onPress={() => actions.open("guide")} />
        </SectionCard>
        <View style={styles.helpCard}><Text style={styles.helpTitle}>需要協助？</Text><Text style={styles.body}>正式支援入口須由產品提供；預覽不會開啟不存在的客服渠道。</Text></View>
      </View>
    </View> : null}
    {tab === "children" ? <SectionCard><SectionHeader title="孩子設定" subtitle="切換孩子時必須隔離另一位孩子的資料與草稿。" />
      {model.children.length === 0 ? <Text style={styles.body}>目前沒有孩子檔案。</Text> : model.children.map(child => <Pressable key={child.id} accessibilityRole="button" accessibilityLabel={`查看${child.displayName}的檔案`} onPress={() => { actions.selectChild(child.id); actions.open("profile"); }} style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}><View style={styles.miniAvatar}><Text style={styles.avatarText}>{child.displayName.slice(0, 1)}</Text></View><View style={styles.identityText}><Text style={styles.identityName}>{child.displayName}</Text><Text style={styles.muted}>{child.ageLabel} · {child.profileConfirmed ? "已確認" : "待核對"}</Text></View><AppIcon name="arrow-right" size={18} /></Pressable>)}
      <Text style={styles.draftNote}>新增、刪除及共享孩子資料屬正式 API 與權限控制；此預覽不執行。</Text>
    </SectionCard> : null}
    {tab === "family" ? <SectionCard><SectionHeader title="家庭成員" subtitle="共享記錄與私人聊天的權限分開處理。" />
      <Text style={styles.body}>正式版已有家庭邀請、角色和撤權流程。這裏只提供視覺入口，權限由 Server 核定。</Text><AppButton label="查看家庭協調" onPress={() => actions.open("family")} />
    </SectionCard> : null}
    {tab === "preferences" ? <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={[styles.columns, stacked && styles.stack]}>
      <View style={[styles.column, stacked && styles.fullColumn]}>
        <PreferencesPreview online={model.connection === "online"} />
        <BackgroundSettings />
      </View><View style={[styles.column, stacked && styles.fullColumn]}>
        <SectionCard><SectionHeader title="通知渠道" />
          <LabeledValue label="站內狀態" value="依原事項／收據顯示" />
          <Text style={styles.body}>本人綁定與安靜時段分開設定。Web Push／Telegram 可比較合成流程，真渠道尚未接駁此介面。</Text>
          <TextLink label="查看本人通知渠道" onPress={() => setTab("notifications")} />
        </SectionCard>
      </View>
    </View> : null}
    {tab === "notifications" ? <ChannelSettingsPreview controller={channels} /> : null}
    {tab === "model" ? <ModelSettingsPreview controller={modelSettings} onSwitchAccount={channels.switchAccount} /> : null}
    {tab === "privacy" ? <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={[styles.columns, stacked && styles.stack]}>
      <View style={[styles.column, stacked && styles.fullColumn]}><SectionCard><SectionHeader title="資料與私隱" />
        <Text style={styles.body}>孩子資料、已確認記錄與私人聊天的可見範圍，須按目前身份與家庭角色重新檢查。退出或撤權後，正式 App 必須清除不再可見的資料。</Text>
        <LabeledValue label="私人聊天" value="只對本人可見" /><LabeledValue label="共享資料" value="按孩子及家庭角色授權" />
      </SectionCard></View>
      <View style={[styles.column, stacked && styles.fullColumn]}><SectionCard><SectionHeader title="帳戶操作" />
        <Text style={styles.body}>匯出資料、刪除帳戶及儲存用量未有此預覽可用的完整契約；不顯示可點擊的假操作。</Text>
        <TextLink label="查看接線說明" onPress={() => setTab("account")} />
      </SectionCard></View>
    </View> : null}
  </PageFrame>;
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.68 },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg }, stack: { flexDirection: "column" }, column: { flex: 1, width: "100%", minWidth: 0, gap: spacing.lg },
  fullColumn: { flex: undefined, flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.md }, avatar: { width: 55, height: 55, borderRadius: 28, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center" }, avatarText: { color: colors.white, fontFamily: chineseFont, fontSize: typeScale.title, fontWeight: "800" }, identityText: { flex: 1, minWidth: 0, gap: spacing.xs }, identityName: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800" }, muted: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 19 }, divider: { backgroundColor: colors.softLine }, label: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.caption, fontWeight: "700" }, draftNote: { backgroundColor: colors.paleAmber, borderRadius: radius.small, padding: spacing.md, fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.caption, lineHeight: 20 },
  valueRow: { minHeight: 40, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine }, valueLabel: { width: 96, fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption }, valueText: { flex: 1, minWidth: 130, fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small }, body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 23 },
  helpCard: { backgroundColor: colors.mintSurface, padding: spacing.lg, borderRadius: radius.medium, gap: spacing.sm }, helpTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800" }, listRow: { minHeight: 66, borderBottomWidth: 1, borderBottomColor: colors.softLine, flexDirection: "row", alignItems: "center", gap: spacing.md }, miniAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center" }, chevron: { color: colors.teal, fontSize: 23 },
  timeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md }, timeField: { flex: 1, minWidth: 120, gap: spacing.xs }, switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 58 },
});

import { brand } from "../branding";
import { useId, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { MemoryFactList, MemoryHistoryCard, MemorySummaryCard, MemoryTopicList } from "../components/memory/MemoryCards";
import { MemoryEditorPanel } from "../components/memory/MemoryEditor";
import { PageFrame } from "../components/PageFrame";
import { PreviewWriteNotice } from "../components/PreviewWritePanel";
import { AppButton, AppSelect, AppTabPanel, SectionCard, SectionHeader, UnderlineTabs } from "../components/ui";
import { roleLabels, type MemoryRole } from "../memory-view-model";
import { usePreview } from "../preview/PreviewContext";
import { useMemoryPreview } from "../preview/useMemoryPreview";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";

type Tab = "facts" | "topics" | "summary";
const tabs: { key: Tab; label: string }[] = [{ key: "facts", label: "已確認與候選" }, { key: "topics", label: "話題" }, { key: "summary", label: "私人摘要" }];

function MemoryWorkspace({ childId, role, sourceChanged, expired, online, loading, tab, tabsId }: {
  childId: string; role: MemoryRole; sourceChanged: boolean; expired: boolean; online: boolean; loading: boolean; tab: Tab; tabsId: string;
}) {
  const preview = useMemoryPreview(childId, role, sourceChanged, expired);
  const [contentWidth, setContentWidth] = useState(0);
  const stacked = contentWidth < 760;
  const disabled = !online || loading || preview.blocked;
  return <View style={styles.workspace} onLayout={event => setContentWidth(event.nativeEvent.layout.width)}>
    {!online ? <View accessibilityRole="alert" style={styles.warning}><Text style={styles.body}>目前離線；當前草稿保留。恢復連線後由你重新核對，系統不會自動提交。</Text></View> : null}
    <PreviewWriteNotice controller={preview.controller} online={online && !loading} />
    {loading ? <SectionCard><Text accessibilityRole="alert" style={styles.body}>正在模擬重新讀取這位孩子的記憶；暫不展示舊資料或接受寫入。</Text></SectionCard> : null}
    <AppTabPanel tabsId={tabsId} tabKey="summary" active={!loading && tab === "summary"}>{!loading && tab === "summary" ? <MemorySummaryCard summary={preview.data.summary} /> : null}</AppTabPanel>
    <View style={[styles.columns, stacked && styles.stack, (loading || tab === "summary") && styles.hidden]}>
      <View style={[styles.listColumn, stacked && styles.stackedColumn]}>
        <AppTabPanel tabsId={tabsId} tabKey="facts" active={tab === "facts"}>{tab !== "topics" ? <MemoryFactList preview={preview} role={role} disabled={disabled} /> : null}</AppTabPanel>
        <AppTabPanel tabsId={tabsId} tabKey="topics" active={tab === "topics"}>{tab === "topics" ? <MemoryTopicList preview={preview} role={role} disabled={disabled} /> : null}</AppTabPanel>
      </View>
      <View style={[styles.editorColumn, stacked && styles.stackedColumn]}><MemoryEditorPanel preview={preview} role={role} online={online && !loading} /></View>
    </View>
    {!loading ? <MemoryHistoryCard preview={preview} /> : null}
  </View>;
}

function MemoryChildScope({ childId, childName, online, loading }: { childId: string; childName: string; online: boolean; loading: boolean }) {
  const [tab, setTab] = useState<Tab>("facts");
  const tabsId = useId();
  const [role, setRole] = useState<MemoryRole>("caregiver");
  const [sourceState, setSourceState] = useState<"current" | "changed">("current");
  const [expiry, setExpiry] = useState<"valid" | "expired">("valid");
  const [permission, setPermission] = useState<"active" | "revoked">("active");
  const [toolsOpen, setToolsOpen] = useState(false);
  const scope = `${childId}:${role}:${sourceState}:${expiry}:${permission}`;
  return <>
    <View style={styles.context}><View style={styles.contextText}><Text style={styles.contextTitle}>{childName}的記憶</Text><Text style={styles.meta}>本人私人資料與可見家庭共享資料 · 合成預覽 · {roleLabels[role]}</Text></View>
      <AppButton label={toolsOpen ? "收起情境工具" : "合成情境工具"} variant="quiet" onPress={() => setToolsOpen(value => !value)} />
    </View>
    {toolsOpen ? <SectionCard><SectionHeader title="合成記憶情境" subtitle="切換情境會重新載入合成資料、清除草稿與未完成計時器；沒有連接 Server。" />
      <View style={styles.scenarios}>
        <View style={styles.scenario}><AppSelect label="記憶角色" value={role} options={[{ value: "owner", label: "家庭擁有人" }, { value: "caregiver", label: "照顧者" }, { value: "viewer", label: "唯讀成員" }]} onChange={setRole} /></View>
        <View style={styles.scenario}><AppSelect label="記錄來源" value={sourceState} options={[{ value: "current", label: "目前版本" }, { value: "changed", label: "已更改版本" }]} onChange={setSourceState} /></View>
        <View style={styles.scenario}><AppSelect label="私人事實期限" value={expiry} options={[{ value: "valid", label: "有效" }, { value: "expired", label: "已過期" }]} onChange={setExpiry} /></View>
        <View style={styles.scenario}><AppSelect label="孩子存取權" value={permission} options={[{ value: "active", label: "有效" }, { value: "revoked", label: "已失效" }]} onChange={setPermission} /></View>
      </View>
    </SectionCard> : null}
    <UnderlineTabs id={tabsId} label="記憶分類" items={tabs} value={tab} onChange={setTab} />
    {permission === "revoked" ? tabs.map(item => <AppTabPanel key={item.key} tabsId={tabsId} tabKey={item.key} active={tab === item.key}>
      {tab === item.key ? <SectionCard><Text accessibilityRole="alert" style={styles.body}>存取權已失效。這位孩子的記憶、摘要、版本與草稿已清除；未完成的合成操作不會再改動清單。</Text></SectionCard> : null}
    </AppTabPanel>)
      : <MemoryWorkspace key={scope} childId={childId} role={role} sourceChanged={sourceState === "changed"} expired={expiry === "expired"} online={online} loading={loading} tab={tab} tabsId={tabsId} />}
  </>;
}

export default function MemoryPage() {
  const { model, actions } = usePreview();
  const child = model.children.find(item => item.id === model.selectedChildId);
  return <PageFrame title="記憶與話題" description="候選事實未確認前只供本人；來源、期限與版本須核對。話題狀態不代表任何任務已完成。" eyebrow={`${brand.name} · 記憶與話題`}>
    {child ? <MemoryChildScope key={child.id} childId={child.id} childName={child.displayName} online={model.connection === "online"} loading={model.recordsLoad === "loading"} />
      : <SectionCard><Text style={styles.body}>選擇孩子後才可查看對應記憶；不會顯示上一位孩子的資料或草稿。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard>}
  </PageFrame>;
}

const styles = StyleSheet.create({
  workspace: { width: "100%", minWidth: 0, gap: spacing.lg },
  context: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.sm, backgroundColor: colors.mintSurface, padding: spacing.lg, borderRadius: radius.medium },
  contextText: { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: spacing.xs },
  contextTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.title, lineHeight: 28, fontWeight: "800" },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg, minWidth: 0 }, stack: { flexDirection: "column" },
  listColumn: { flex: 1.2, width: "100%", minWidth: 0 }, editorColumn: { flex: 1, width: "100%", minWidth: 0 },
  stackedColumn: { flexGrow: 0, flexShrink: 0, flexBasis: "auto" }, hidden: { display: "none" },
  scenarios: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, scenario: { flexGrow: 1, flexBasis: 220, minWidth: 0, maxWidth: "100%" },
  warning: { backgroundColor: colors.paleAmber, padding: spacing.md, borderRadius: radius.small },
  body: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23 },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
});

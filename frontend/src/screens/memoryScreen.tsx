import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { brand } from "../branding";
import { MemoryReferenceView } from "../components/memory/MemoryReferenceView";
import { PageFrame } from "../components/PageFrame";
import { ReadStateNotice } from "../components/ReadStateNotice";
import { AppButton, AppSelect, SectionCard, SectionHeader } from "../components/ui";
import { usePreview } from "../preview/PreviewContext";
import { useMemoryReferencePreviewTools } from "../preview/MemoryReferenceWorkspaceProvider";
import { chineseFont, colors, readingType, spacing } from "../theme";

function MemoryPreviewTools() {
  const tools = useMemoryReferencePreviewTools();
  const [open, setOpen] = useState(false);
  if (!tools) return null;
  return <View style={styles.tools}>
    <AppButton label={open ? "收起預覽工具" : "預覽工具"} expanded={open} variant="quiet" density="compact" onPress={() => setOpen(value => !value)} />
    {open ? <SectionCard><SectionHeader density="compact" title="合成記憶情境" subtitle="只切換本次預覽資料，沒有連接或改動資料庫。" />
      <View style={styles.scenarios}><View style={styles.scenario}><AppSelect label="記錄來源" value={tools.sourceChanged ? "changed" : "current"} options={[{ value: "current", label: "目前版本" }, { value: "changed", label: "來源已更改" }]} onChange={value => tools.setSourceChanged(value === "changed")} /></View>
        <View style={styles.scenario}><AppSelect label="私人記憶適用性" value={tools.expired ? "expired" : "valid"} options={[{ value: "valid", label: "適用" }, { value: "expired", label: "待重新核對" }]} onChange={value => tools.setExpired(value === "expired")} /></View>
        <View style={styles.scenario}><AppSelect label="孩子存取權" value={tools.revoked ? "revoked" : "active"} options={[{ value: "active", label: "有效" }, { value: "revoked", label: "已失效" }]} onChange={value => tools.setRevoked(value === "revoked")} /></View></View>
      <Text style={styles.meta}>目前沒有本輪 Agent 脈絡的讀取接口，也未提供可公開顯示的知識來源。長期區直接使用同一記憶 owner；候選及停用仍保留原狀態。正式接線須注入原來源、版本及授權範圍。</Text>
    </SectionCard> : null}
  </View>;
}
export default function MemoryPage() {
  const { model, actions } = usePreview();
  const child = model.children.find(item => item.id === model.selectedChildId);
  return <PageFrame density="compact" title="記憶與參考" description="查閱對話脈絡、已保存記憶與參考來源" eyebrow={`${brand.name} · 資料查閱`}>
    {child ? <><MemoryReferenceView onPrepareQuestion={actions.prepareQuestion} /><MemoryPreviewTools /></>
      : <ReadStateNotice state="empty" title="先選擇孩子" message="選擇孩子後才可查看對應記憶與參考。"><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></ReadStateNotice>}
  </PageFrame>;
}
const styles = StyleSheet.create({
  tools: { gap: spacing.sm, minWidth: 0 },
  scenarios: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  scenario: { flexGrow: 1, flexBasis: 220, minWidth: 0, maxWidth: "100%" },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});

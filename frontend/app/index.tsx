import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { HomeDashboard } from "../src/components/HomeDashboard";
import { createPreviewModel, scenarioLabels, type PreviewScenario } from "../src/preview/fixture";
import { chineseFont, colors, radius, spacing, typeScale } from "../src/theme";
import type { HomeActions, HomeDestination } from "../src/view-model";

const scenarios: PreviewScenario[] = ["normal", "empty", "loading", "offline", "needs_confirmation", "saving", "saved", "failed", "unknown"];
const destinationLabels: Record<HomeDestination, string> = {
  chat: "基本聊天", care: "照顧記錄", profile: "子女檔案", family: "家庭協調", memory: "記憶與話題",
};

export default function HomePreview() {
  const [scenario, setScenario] = useState<PreviewScenario>("normal");
  const [selectedChildId, setSelectedChildId] = useState("preview-child-1");
  const [controlsOpen, setControlsOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);
  const model = createPreviewModel(scenario, selectedChildId);
  const actions: HomeActions = {
    selectChild(id) {
      setSelectedChildId(id);
      setMessage("已切換合成孩子。正式版須先清除上一位孩子的可見資料，再讀取新孩子的授權資料。");
    },
    refresh() {
      setScenario("loading");
      setMessage("合成預覽正在模擬重新讀取；沒有向 Server 發出請求。");
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => { setScenario("normal"); setMessage("合成預覽讀取完成；這不是 Server 確認。"); }, 650);
    },
    reviewOperation() {
      setMessage(scenario === "unknown"
        ? "結果未知的正式操作必須用原 opId 查核；預覽不會推測成功，也不會自動重送。"
        : scenario === "needs_confirmation"
          ? "待確認內容仍是候選；正式版會開啟原記錄的核對頁。"
          : "正式版會返回原操作並保留輸入；預覽沒有提交資料。"
      );
    },
    open(destination) {
      setMessage(`「${destinationLabels[destination]}」屬現有產品功能；此獨立預覽只交付主頁，入口須由主聊天接到正式 App。`);
    },
  };

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: controlsOpen }} accessibilityLabel="切換合成預覽情境" onPress={() => setControlsOpen(value => !value)} style={styles.toolbarButton}>
          <Text style={styles.toolbarButtonText}>合成預覽：{scenarioLabels[scenario]}　{controlsOpen ? "收起 ↑" : "展開 ↓"}</Text>
        </Pressable>
        <Text style={styles.toolbarHint}>只改變預覽資料，不會呼叫 Server</Text>
      </View>
      {controlsOpen ? <ScrollView horizontal={false} style={styles.controlScroll} contentContainerStyle={styles.controls}>
        {scenarios.map(item => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: item === scenario }} onPress={() => { if (refreshTimer.current) clearTimeout(refreshTimer.current); setScenario(item); setMessage(null); }} style={[styles.scenarioButton, item === scenario && styles.scenarioSelected]}>
          <Text style={[styles.scenarioText, item === scenario && styles.scenarioSelectedText]}>{scenarioLabels[item]}</Text>
        </Pressable>)}
      </ScrollView> : null}
      <HomeDashboard model={model} actions={actions} preview={{ message }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.canvas },
  toolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: colors.ink, gap: spacing.sm },
  toolbarButton: { minHeight: 34, justifyContent: "center", borderRadius: radius.small, paddingHorizontal: spacing.sm },
  toolbarButtonText: { fontFamily: chineseFont, color: colors.white, fontSize: typeScale.caption, fontWeight: "700" },
  toolbarHint: { fontFamily: chineseFont, color: "#D1E7DF", fontSize: 11 },
  controlScroll: { flexGrow: 0, maxHeight: 102, backgroundColor: "#EDF5F1" },
  controls: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  scenarioButton: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 34 },
  scenarioSelected: { backgroundColor: colors.teal, borderColor: colors.teal },
  scenarioText: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.caption, fontWeight: "700" },
  scenarioSelectedText: { color: colors.white },
});

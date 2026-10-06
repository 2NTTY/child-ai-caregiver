import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { AppStatusBadge } from "../components/AppStatusBadge";
import { AppButton, AppSelect } from "../components/ui";
import type { PreparationCondition } from "../preparation-view-model";
import { usePreparationPreviewTools } from "./PreparationWorkspaceProvider";
import { chineseFont, colors, readingType, spacing } from "../theme";

const conditionOptions: { value: PreparationCondition; label: string }[] = [
  { value: "ready", label: "可查閱示例" }, { value: "empty", label: "沒有已備妥文件" },
  { value: "loading", label: "讀取中" }, { value: "unavailable", label: "文件未能取得" },
  { value: "source_changed", label: "來源版本已更新" }, { value: "source_invalidated", label: "來源已失效" },
  { value: "private_revoked", label: "私人來源撤權" }, { value: "unknown", label: "來源狀態未知" },
  { value: "read_only", label: "唯讀" }, { value: "lost", label: "孩子權限失效" },
];

export function PreparationPreviewTools() {
  const preview = usePreparationPreviewTools();
  const [expanded, setExpanded] = useState(false);
  if (!preview) return null;
  return <View style={styles.sourceNotice}>
    <View style={styles.row}><AppStatusBadge label="合成準備單示例" tone="neutral" />
      <AppButton label="預覽來源與限制" variant="quiet" density="compact" expanded={expanded} onPress={() => setExpanded(value => !value)} /></View>
    {expanded ? <View style={styles.stack}>
      <Text style={styles.meta}>以下文件來自預先寫好的版面示例，並非真實孩子資料或即時 Agent 生成。清單及歸檔只保留在本次預覽；重新載入會重設，沒有通知、上傳或傳送給其他人。</Text>
      <Text style={styles.meta}>正式版仍需接入文件讀取、Agent 產出、版本保存、歸檔及原操作結果查核。現有到診共享準備不會在這裏另存一份。</Text>
      <AppSelect label="準備單預覽狀態" value={preview.condition} options={conditionOptions} onChange={preview.setCondition} />
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({ sourceNotice: { gap: spacing.md }, row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm }, stack: { gap: spacing.md }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta } });

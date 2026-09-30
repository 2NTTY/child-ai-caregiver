import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { ModelSettingsPreviewController } from "../../preview/useModelSettingsPreview";
import { chineseFont, colors, spacing, typeScale } from "../../theme";
import { AppButton, AppSelect, SectionCard, SectionHeader } from "../ui";
import { ModelSettingsView } from "./ModelSettingsView";

export function ModelSettingsPreview({ controller, onSwitchAccount }: { controller: ModelSettingsPreviewController; onSwitchAccount: () => void }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  return <View style={styles.root}>
    <SectionCard><SectionHeader title="模型設定合成預覽" subtitle="這裏不會連接供應商或保存真密鑰。請只使用測試文字。" />
      <AppButton label={toolsOpen ? "收起模型情境工具" : "顯示模型情境工具"} variant="quiet" onPress={() => setToolsOpen(value => !value)} />
      {toolsOpen ? <><View style={styles.controls}><AppSelect label="模型保存結果" value={controller.saveOutcome} disabled={!!controller.model.busy} onChange={controller.setSaveOutcome} options={[
        { value: "saved", label: "已保存" }, { value: "failed", label: "失敗（未保存）" }, { value: "unknown_applied", label: "結果未知（稍後讀到新版本）" },
        { value: "unknown_unapplied", label: "結果未知（稍後仍是原版本）" }, { value: "conflict", label: "版本衝突" }, { value: "denied", label: "身份或權限改變" },
      ]} /><AppSelect label="模型資料查核結果" value={controller.checkOutcome} disabled={!!controller.model.busy} onChange={controller.setCheckOutcome} options={[
        { value: "accessible", label: "模型資料可讀" }, { value: "unavailable", label: "模型資料不可讀" }, { value: "limited", label: "429 查核限流" }, { value: "failed", label: "讀取失敗" },
      ]} /><AppSelect label="模型服務可用性" value={controller.availability} disabled={!!controller.model.busy} onChange={controller.setAvailability} options={[
        { value: "available", label: "可用" }, { value: "personal_off", label: "個人服務不可用" }, { value: "all_off", label: "AI 總開關停用" },
      ]} /></View>
      <View style={styles.controls}><AppButton label="切換模型合成帳戶" variant="secondary" onPress={onSwitchAccount} />
        <AppButton label="切換模型合成 Server" variant="secondary" onPress={controller.switchServer} />
        {!controller.model.authorized ? <AppButton label="恢復合成登入" variant="secondary" onPress={controller.restoreIdentity} /> : null}
      </View><Text style={styles.meta}>只保留本次預覽的無密鑰 metadata；不寫入瀏覽器儲存、原操作台帳或重播隊列。</Text></> : null}
    </SectionCard>
    <ModelSettingsView key={controller.model.scopeKey} model={controller.model} actions={controller.actions} />
  </View>;
}
const styles = StyleSheet.create({ root: { gap: spacing.lg }, controls: { gap: spacing.sm }, meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 } });

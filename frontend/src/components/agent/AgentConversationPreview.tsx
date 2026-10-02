import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { useAgentPreview, type AgentDecisionOutcome, type AgentReadOutcome } from "../../preview/useAgentPreview";
import { conversationRunId, type AgentRunScenario } from "../../preview/agent-fixture";
import { chineseFont, colors, radius, spacing, typeScale } from "../../theme";
import { AppButton, AppSelect, SectionCard, SectionHeader } from "../ui";
import { AgentInboxView } from "./AgentInboxView";
import { AgentRunView } from "./AgentRunView";
import type { LocateAnswerSource } from "../chat/AnswerSources";

const scenarioOptions: { value: AgentRunScenario; label: string }[] = [
  { value: "standard", label: "建立任務及私人記憶" }, { value: "changes", label: "任務變更及共享記憶" },
  { value: "empty", label: "沒有候選或引用" }, { value: "expired", label: "確認期限已過" },
  { value: "running", label: "仍在處理中" }, { value: "stopped", label: "運行已停止" },
  { value: "unknown", label: "運行結果及統計未知" }, { value: "degraded", label: "關鍵詞降級檢索" },
  { value: "many_sources", label: "多個來源（12 項）" },
];
const decisionOptions: { value: AgentDecisionOutcome; label: string }[] = [
  { value: "success", label: "合成收據成功" }, { value: "unknown", label: "結果未知" }, { value: "conflict", label: "確認基準衝突" },
];
const readOptions: { value: AgentReadOutcome; label: string }[] = [
  { value: "latest", label: "原候選狀態" }, { value: "accepted", label: "原候選已接受" }, { value: "dismissed", label: "原候選已略過" },
  { value: "version_changed", label: "候選版本已變更" }, { value: "missing", label: "原候選未出現在回覆" },
  { value: "failed", label: "讀取失敗" }, { value: "denied", label: "權限或登入失效" },
];

export function AgentConversationPreview({ childId, online, onLocateSource }: { childId: string; online: boolean; onLocateSource?: LocateAnswerSource }) {
  const [identity, setIdentity] = useState("preview-self");
  const [toolsVisible, setToolsVisible] = useState(false);
  // Server/user/child changes must replace private contents before an old result can render.
  return <AgentConversationContents key={JSON.stringify(["isolated-preview", identity, childId])}
    childId={childId} online={online} identity={identity} setIdentity={setIdentity} toolsVisible={toolsVisible} setToolsVisible={setToolsVisible} onLocateSource={onLocateSource} />;
}
function AgentConversationContents({ childId, online, identity, setIdentity, toolsVisible, setToolsVisible, onLocateSource }: {
  childId: string; online: boolean; identity: string; setIdentity(value: string): void;
  toolsVisible: boolean; setToolsVisible(value: boolean): void;
  onLocateSource?: LocateAnswerSource;
}) {
  const preview = useAgentPreview(childId, online);
  const blocked = !!preview.model.busy || !!preview.model.pendingDecision || preview.model.readState === "denied";
  return <View style={styles.stack}>
    <SectionCard>
      <SectionHeader title="後續操作" icon="star-four-points" subtitle="候選屬於這一則示例回覆；先核對內容，再決定下一步。" />
      <Text style={styles.body}>下方可操作的運行與候選均為合成資料，沒有連接 Agent、建立任務或寫入記憶。</Text>
      <AppButton label="查看來源與候選" variant="secondary" disabled={!online || blocked}
        onPress={() => preview.selectRun(conversationRunId(childId))} />
    </SectionCard>
    {preview.model.readState !== "idle" ? <AgentRunView model={preview.model} actions={preview.actions} onLocateSource={onLocateSource} /> : null}
    <AgentInboxView model={preview.inbox} actions={preview.inboxActions} />
    <View style={styles.toolsToggle}><AppButton label={toolsVisible ? "收起 Agent 情境工具" : "顯示 Agent 情境工具"} variant="quiet" onPress={() => setToolsVisible(!toolsVisible)} /></View>
    {toolsVisible ? <SectionCard style={styles.tools}>
      <SectionHeader title="Agent 合成情境工具" subtitle="只測試畫面狀態；不改真正登入、不呼叫服務或外發。" />
      <AppSelect label="執行結果身份示例" value={identity} options={[{ value: "preview-self", label: "本人樣本" }, { value: "preview-other", label: "另一帳戶樣本" }]} onChange={setIdentity} />
      <Text style={styles.meta}>身份選擇只清理這區的合成私人結果；正式版須連同整頁聊天及草稿按登入身份隔離。</Text>
      <AppSelect label="Agent 運行情境" value={preview.scenario} options={scenarioOptions} onChange={preview.changeScenario} disabled={blocked} />
      <AppSelect label="模擬候選決定結果" value={preview.decisionOutcome} options={decisionOptions} onChange={preview.setDecisionOutcome} disabled={!!preview.model.busy} />
      <AppSelect label="模擬原運行讀取" value={preview.readOutcome} options={readOptions} onChange={preview.setReadOutcome} disabled={!!preview.model.busy} />
    </SectionCard> : null}
  </View>;
}
const styles = StyleSheet.create({
  stack: { gap: spacing.lg, minWidth: 0 }, body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 23 },
  toolsToggle: { alignItems: "flex-start" }, tools: { backgroundColor: colors.quietSurface, borderRadius: radius.large },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 21 },
});

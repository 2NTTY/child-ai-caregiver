import { AppStatusBadge } from "../AppStatusBadge";
import { View } from "react-native";
import { Text } from "react-native-paper";
import type { SourcesActions, SourcesViewModel } from "../../shared-input-view-model";
import { AppButton, AppTextField, SectionCard, SectionHeader } from "../ui";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { sourceStyles as s } from "./source-styles";
import { SourceIntakeEditor } from "./SourceIntakeEditor";
import { validSourceIntakeText } from "../../source-intake";

export function SourceIntakeConversation({ model, actions }: { model: SourcesViewModel; actions: SourcesActions }) {
  const intake = model.intake?.selected, source = model.selected, adapter = actions.intake;
  if (intake && source && adapter && model.intake?.mode === "production") {
    const locked = !model.fresh || !source.canManage || model.access !== "editable" || !!model.direct;
    const enabled = source.management?.enabled !== false;
    return <SectionCard surface="plain" style={s.workflowSection} testID="source-intake-conversation">
      <SectionHeader density="compact" title="整理這份私人來源" subtitle="先查看保存原文，再核對用途及摘錄授權。" icon="star-four-points" />
      <Text selectable style={s.body}>你的說明：{source.management?.intention || intake.intention || "用途尚未設定。"}</Text>
      <Text style={s.meta}>{source.text.trim() ? `已保存 ${source.text.length.toLocaleString("en-HK")} 字原文，可在下方查看。` : "連結已保存，尚未取得正文。"}</Text>
      {!enabled ? <Text style={s.warning}>來源已停用；重新啟用並保存後才可讀取或提取。</Text> : null}
      {intake.stage === "awaiting_read" || intake.stage === "unavailable" ? <AppButton label="查看保存狀態並整理用途" variant="secondary" disabled={locked || !enabled} onPress={adapter.read} /> : null}
      {intake.stage === "clarifying" ? <><Text style={s.body}>請填寫用途、來源性質及時效。</Text><AppButton label="填寫來源設定" disabled={locked} onPress={adapter.propose} /></> : null}
      <SourceIntakeEditor model={model} actions={actions} />
      {adapter.discuss ? <><AppButton label="交給 Agent 討論" variant="secondary" disabled={locked || !enabled || !!model.managementDraft?.dirty} onPress={adapter.discuss} />
        <Text style={s.meta}>只把來源識別及已保存用途帶到聊天草稿，由你核對後送出。先保存修改；不會自動發起模型請求。</Text></> : null}
    </SectionCard>;
  }
  if (!intake || !source || !adapter || model.intake?.mode !== "synthetic") return null;
  const locked = !model.fresh || !source.canManage || model.access !== "editable" || !!model.direct;
  const stageLabel = intake.stage === "awaiting_read" ? "等待查看來源" : intake.stage === "reading" ? "正在示範查看來源" : intake.stage === "read_unknown" ? "查看結果未知"
    : intake.stage === "unavailable" ? "來源未能讀取" : intake.stage === "clarifying" ? "先談談怎樣使用" : intake.stage === "review" ? "整理建議待你確認"
      : intake.stage === "connection_unknown" ? "接入結果未知，須查核" : "用途已確認，正式接入未連線";
  const step = ["awaiting_read", "reading", "read_unknown", "unavailable"].includes(intake.stage) ? 0 : intake.stage === "clarifying" ? 1 : intake.stage === "review" ? 2 : 3;
  return <SectionCard surface="plain" style={s.workflowSection} testID="source-intake-conversation">
    <SectionHeader density="compact" title="和助手整理這份來源" subtitle="合成流程示範：沒有讀取網頁、呼叫模型或接入回答。" icon="star-four-points" />
    <View style={s.intakeSteps} accessibilityLabel={`目前步驟：${stageLabel}`}>{["查看來源", "釐清用途", "核對建議", "正式接入"].map((label, index) => <View key={label} style={[s.intakeStep, index === step && s.intakeStepCurrent]}><Text style={index === step ? s.stepActiveText : s.meta}>{index + 1} · {label}</Text></View>)}</View>
    <StatusAnnouncement eventKey={`${source.id}:${intake.stage}`} message={stageLabel} urgent={intake.stage === "unavailable"} />
    <AppStatusBadge label={stageLabel} tone={intake.stage === "reading" || intake.stage === "clarifying" ? "info" : "warning"} />
    {["awaiting_read", "unavailable", "clarifying", "confirmed_pending_connection"].includes(intake.stage) ? <AppButton label={intake.stage === "confirmed_pending_connection" ? "編輯用途草稿" : "自行填寫接入資料"} variant="quiet" disabled={locked} onPress={adapter.editManually} /> : null}
    <View style={s.review}><Text style={s.meta}>你的說明</Text><Text selectable style={s.body}>{intake.intention || "先保存來源，用途稍後再談。"}</Text></View>
    {intake.stage === "awaiting_read" ? <>
      <Text style={s.body}>助手會先了解來源內容，再跟你商量如何使用。你的用途說明不代表同意家庭共享、建立記錄或訂閱。</Text>
      <Text style={s.meta}>{source.text.trim() ? "這份來源已有你提供的原文。正式處理須讓你核對送往模型的確切片段。" : "這份來源目前只有連結。正式處理須先取得你同意，才讀取可公開存取的正文；需要登入的內容由你自行貼上。"}</Text>
      <AppButton label="預覽查看來源" disabled={locked} onPress={adapter.read} />
      <Text style={s.meta}>此按鈕只展示閱讀流程，不授予正式網頁取得或模型使用同意。</Text>
    </> : null}
    {intake.stage === "reading" ? <Text style={s.body}>正在展示查看步驟，請稍候。沒有發出真實請求。</Text> : null}
    {intake.stage === "read_unknown" ? <>
      <Text style={s.warning}>本次示範尚未能確認查看結果。保留原來源和用途，不會再發起一次閱讀。</Text>
      <AppButton label="查核原次查看結果（預覽）" disabled={locked} onPress={adapter.checkRead} />
    </> : null}
    {intake.stage === "unavailable" ? <>
      <Text style={s.warning}>未能讀取來源，不能根據連結猜測內容或提出已讀建議。需要登入、付費或無法取得的材料，可自行貼上有權提供的原文。</Text>
      {source.kind === "personal_source" ? <AppButton label="自行貼上原文" variant="secondary" disabled={locked || !model.canCreate} onPress={actions.recreateWithText} /> : null}
      <Text style={s.meta}>這是受控的不可讀示例，不是對你這個網址的實際檢查結果。</Text>
    </> : null}
    {intake.proposalOrigin === "assisted" && (intake.stage === "clarifying" || intake.stage === "review") ? <View style={s.review}>
      <Text style={s.meta}>助手 · 閱讀回報示例</Text>
      <Text style={s.body}>正式助手會在這裏說明讀到了甚麼、仍缺甚麼，以及為甚麼需要補充。此預覽沒有讀取你的資料，沒有核實內容或來源。</Text>
    </View> : null}
    {intake.stage === "clarifying" ? <>
      <Text style={s.body}>還有甚麼想讓助手知道？例如只用來回答問題、整理待核對記錄，或只在某段時間參考。</Text>
      <AppTextField label="補充說明（可略過）" accessibilityLabel="補充來源用途" value={intake.clarification} multiline error={!validSourceIntakeText(intake.clarification)} disabled={locked} onChangeText={adapter.setClarification} />
      <Text style={validSourceIntakeText(intake.clarification) ? s.meta : s.error}>補充說明最多 1,000 字，原文不會截短。</Text>
      <AppButton label="查看整理建議（預覽）" disabled={locked || !validSourceIntakeText(intake.clarification)} onPress={adapter.propose} />
      <Text style={s.meta}>下一步是固定合成建議樣例，不表示助手已理解以上內容；你可以修改。</Text>
    </> : null}
    <SourceIntakeEditor key={intake.proposalOrigin} model={model} actions={actions} />
    {intake.stage === "confirmed_pending_connection" ? <Text style={s.warning}>你已確認用途。正式接入仍未連線，這份來源尚未加入回答參考、孩子記錄或追蹤話題。</Text> : null}
    {intake.stage === "connection_unknown" ? <>
      <Text style={s.warning}>接入結果未知（合成情境）。原用途與來源保持鎖定，先查核原次結果，不重新確認或重送。</Text>
      <AppButton label="查核原次接入結果（預覽）" disabled={locked} onPress={adapter.checkConnection} />
    </> : null}
  </SectionCard>;
}

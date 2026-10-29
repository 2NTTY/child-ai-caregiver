import { View } from "react-native";
import { Text } from "react-native-paper";
import { growthTime } from "../../growth-view-model";
import { taskDisplayTime } from "../tasks/TaskContent";
import type { GrowthActions, GrowthAttempt, GrowthViewModel } from "../../growth-view-model";
import { AppCheckbox } from "../AppCheckbox";
import { AppButton, SectionCard, SectionHeader } from "../ui";
import { growthStyles as s } from "./growth-styles";

export function GrowthOriginalRequest({attempt}:{attempt:GrowthAttempt}){
  return <View testID="growth-original-request" style={s.smallStack}><Text style={s.title}>{attempt.label}</Text>
    <Text style={s.meta}>{attempt.kind === "concern_create" ? `原建立請求 · 原授權基準 ${attempt.authorityVersion}` : `原版本 ${attempt.input.expectedVersion} · 原授權基準 ${attempt.input.authorityVersion}`}</Text>
    {attempt.kind === "concern_create" ? <>
      <Text selectable style={s.body}>原名稱：{attempt.input.title}</Text><Text selectable style={s.body}>原關注原因：{attempt.input.reason}</Text>
      <Text selectable style={s.body}>原觀察：{attempt.input.observation}</Text><Text style={s.meta}>原觀察時間：{growthTime(attempt.input.observedAt)}</Text>
      <Text style={s.meta}>原站內跟進時間：{attempt.input.followUpAt ? growthTime(attempt.input.followUpAt) : "沒有安排"} · 家庭共享</Text>
    </> : attempt.kind === "concern_update" ? <>
      {attempt.input.action === "append" ? <><Text selectable style={s.body}>原追加觀察：{attempt.input.text}</Text><Text style={s.meta}>原觀察時間：{growthTime(attempt.input.observedAt)}</Text></>
        : <Text style={s.body}>{attempt.input.followUpAt ? `原站內跟進安排：${growthTime(attempt.input.followUpAt)}` : "原決定：撤回這次站內跟進安排"}</Text>}
      <Text style={s.body}>家庭共享；不更改原始記錄或連結任務。</Text>
    </> : attempt.kind==="concern"?<Text style={s.body}>{attempt.input.action === "restore" ? "只恢復這條關注並保留前後經過；不更改建議、原始記錄或連結任務。" : "只結束這條關注並保留歷史；不更改建議、原始記錄或連結任務。"}</Text>:attempt.kind==="item"?(attempt.input.action==="accept"?(attempt.input.task.kind==="none"?<Text style={s.body}>只記錄已知悉，不建立任務。</Text>:attempt.input.task.kind==="create"?<>
      <Text style={s.body}>{attempt.input.task.values.title}</Text><Text selectable style={s.body}>{attempt.input.task.values.details}</Text><Text style={s.meta}>原負責人：{attempt.assigneeLabel??attempt.input.task.values.assigneeUserId} · 時間：{taskDisplayTime(attempt.input.task.values.dueAt, attempt.input.task.values.timeZone)}</Text>
    </>:<Text style={s.body}>原連結任務：{attempt.input.task.id} · 版本 {attempt.input.task.expectedVersion}</Text>):attempt.input.action==="snooze"?<Text style={s.body}>原延後時間：{growthTime(attempt.input.until)}</Text>:<Text selectable style={s.body}>原關閉備註：{attempt.input.note||"沒有備註"}</Text>):
      attempt.input.action==="set_enabled"?<Text style={s.body}>{attempt.input.enabled?"重新啟用主題":"永久停用主題"}</Text>:<>
        {(attempt.summary??Object.entries(attempt.input.values).map(([key,value])=>`${key} · ${value}`)).map((text,index)=><Text key={index} selectable style={s.body}>原選擇：{text}</Text>)}
        {attempt.input.expectedFacts.map(fact=><Text key={fact.id} selectable style={s.meta}>原已確認資料：{fact.id} · 版本 {fact.version}</Text>)}
      </>}
    <Text style={s.body}>查回沿原對象、完整內容及基準；不另建請求或默換新版本。</Text>
  </View>;
}

export function GrowthOperationRecovery({ model, actions, includeRefresh = false }: {
  model: GrowthViewModel; actions: GrowthActions; includeRefresh?: boolean;
}) {
  if (!model.pending || model.access === "lost") return null;
  const retryDisabled = model.busy || !model.online || model.access !== "editable" || model.load !== "ready" || !model.page?.canManage
    || !model.pending.reviewed || model.pending.reconfirm || !model.originalConsent;
  return <SectionCard testID="growth-pending">
    <SectionHeader density="compact" title={model.pending.reconfirm ? "這次提交未獲接受" : "原操作結果待核對"} icon="information-outline" />
    <GrowthOriginalRequest attempt={model.pending.attempt} />
    {includeRefresh ? <AppButton label={model.busy ? "正在讀取／提交…" : "重讀並核對原操作"} variant="quiet" disabled={model.busy || !model.online} onPress={actions.refresh} /> : null}
    <AppCheckbox label="我已核對並同意查回同一份原內容及版本" checked={model.originalConsent}
      disabled={model.busy || !model.online || model.access !== "editable" || model.load !== "ready" || !model.page?.canManage || !model.pending.reviewed || model.pending.reconfirm}
      onChange={actions.setOriginalConsent} />
    <AppButton label="明確查回原操作" disabled={retryDisabled} onPress={actions.retryOriginal} />
  </SectionCard>;
}

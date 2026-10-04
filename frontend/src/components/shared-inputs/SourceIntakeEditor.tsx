import { useState } from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";
import type { SourcesActions, SourcesViewModel } from "../../shared-input-view-model";
import { sourceNatureOptions, sourcePurposeOptions, sourceTimeOptions, validSourceIntakeProposal, type SourceIntakeProposal } from "../../source-intake";
import { AppButton, AppSelect, AppTextField } from "../ui";
import { sourceStyles as s } from "./source-styles";

// The one editor for both a manually entered draft and an Agent-assisted proposal.
export function SourceIntakeEditor({ model, actions }: { model: SourcesViewModel; actions: SourcesActions }) {
  const intake = model.intake?.selected, source = model.selected, adapter = actions.intake;
  const [editing, setEditing] = useState(intake?.proposalOrigin === "manual");
  if (!intake?.proposal || !source || !adapter) return null;
  const proposal = intake.proposal;
  const locked = !model.fresh || !source.canManage || model.access !== "editable" || !!model.direct;
  function change<K extends keyof SourceIntakeProposal>(key: K, value: SourceIntakeProposal[K]) {
    adapter!.editProposal({ ...proposal!, [key]: value });
  }
  return (
    <View style={s.review} testID="source-intake-review">
      <Text style={s.title}>{intake.stage === "review" ? "待你確認的接入摘要" : "這次已核對的用途"}</Text>
      {intake.clarification ? <Text selectable style={s.body}>補充：{intake.clarification}</Text> : null}
      <Text style={s.body}>用途：{sourcePurposeOptions.find(option => option.value === proposal.purpose)?.label}</Text>
      <Text style={s.body}>來源性質：{sourceNatureOptions.find(option => option.value === proposal.nature)?.label}</Text>
      <Text style={s.body}>核實狀態：尚未核實；稱為官方或較長期參考，都不代表已驗證。</Text>
      <Text style={s.body}>時效：{sourceTimeOptions.find(option => option.value === proposal.timeScope)?.label}</Text>
      {proposal.timeScope === "specific_period" ? <Text selectable style={s.body}>適用期間／條件：{proposal.validityText || "尚待補充"}</Text> : null}
      <Text style={s.body}>可見範圍：{model.accountName}本人，在{model.childName}的私人來源內。</Text>
      <Text style={s.meta}>正式來源沿既有加密儲存保存，不加入公共官方／新聞知識庫。本次用途和對話只留在預覽記憶，離開或切換範圍後清除。</Text>
      {proposal.purpose === "record_candidate" ? <Text style={s.meta}>只表達想整理候選；仍須分開核對孩子關係、記錄內容和家庭共享，現在不建立記錄。</Text>
        : proposal.purpose === "track_topic" ? <Text style={s.meta}>只表達持續關注意向；未建立話題、任務、提醒、訂閱或外發授權。</Text>
          : <Text style={s.meta}>只表達回答時參考的意向；正式私人檢索／回答引用尚未接線。</Text>}
      {intake.stage === "review" ? <>
        <AppButton label={editing ? "收起建議欄位" : "修改整理建議"} variant="quiet" disabled={locked} onPress={() => setEditing(value => !value)} />
        {editing ? <View style={s.stack}>
          <AppSelect label="建議用途" value={proposal.purpose} options={sourcePurposeOptions} disabled={locked} onChange={value => change("purpose", value)} />
          <AppSelect label="來源性質（不代表已核實）" value={proposal.nature} options={sourceNatureOptions} disabled={locked} onChange={value => change("nature", value)} />
          <AppSelect label="資料時效" value={proposal.timeScope} options={sourceTimeOptions} disabled={locked} onChange={value => change("timeScope", value)} />
          {proposal.timeScope === "specific_period" ? <>
            <AppTextField label="適用期間或失效條件" accessibilityLabel="適用期間或失效條件" value={proposal.validityText} disabled={locked} multiline onChangeText={value => change("validityText", value)} error={!validSourceIntakeProposal(proposal)} />
            <Text style={validSourceIntakeProposal(proposal) ? s.meta : s.error}>請用原文說明期間或條件，最多 300 字；不會自動推算到期日。</Text>
          </> : null}
        </View> : null}
        <AppButton label="確認這個用途（預覽）" disabled={locked || !validSourceIntakeProposal(proposal)} onPress={adapter.confirmProposal} />
        <Text style={s.meta}>確認只記下本頁意向；未有正式接入回應，不會顯示已接通。</Text>
      </> : null}
    </View>
  );
}

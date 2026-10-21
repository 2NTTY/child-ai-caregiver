import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";
import type { SourcesActions, SourcesViewModel } from "../../shared-input-view-model";
import { sourceNatureOptions, sourcePurposeOptions, sourceTimeOptions, validSourceIntakeProposal, type SourceIntakeProposal } from "../../source-intake";
import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";
import { FormDialog } from "../FormDialog";
import { SourceStatus } from "./SourceStatus";
import { AppButton, AppSelect, AppTextField } from "../ui";
import { AppCheckbox } from "../AppCheckbox";
import { sourceComposerDefaults, sourceComposerSchema, validSourceExcerpt } from "./source-form";
import { sourceStyles as s } from "./source-styles";

// The one editor for both a manually entered draft and an Agent-assisted proposal.
export function SourceIntakeEditor({ model, actions }: { model: SourcesViewModel; actions: SourcesActions }) {
  const intake = model.intake?.selected, source = model.selected, adapter = actions.intake;
  const [editing, setEditing] = useState(intake?.proposalOrigin === "manual");
  const basis = useRef(intake?.proposal ?? null);
  const editTrigger = useRef<View>(null);
  useEffect(() => { if (intake?.stage === "confirmed_pending_connection") setEditing(false); }, [intake?.stage]);
  if (model.intake?.mode === "production") return <ProductionSourceIntakeEditor model={model} actions={actions} />;
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
      <Text style={s.meta}>來源保持私人，不加入公共知識庫。本次用途草稿和對話會在離開或切換範圍後清除。</Text>
      {proposal.purpose === "record_candidate" ? <Text style={s.meta}>只表達想整理候選；仍須分開核對孩子關係、記錄內容和家庭共享，現在不建立記錄。</Text>
        : proposal.purpose === "track_topic" ? <Text style={s.meta}>只表達持續關注意向；未建立話題、任務、提醒、訂閱或外發授權。</Text>
          : <Text style={s.meta}>回答引用暫不可用。</Text>}
      {intake.stage === "review" ? <>
        <AppButton ref={editTrigger} label="修改整理建議" variant="quiet" disabled={locked} onPress={() => { basis.current = proposal; setEditing(true); }} />
      </> : null}
      <FormDialog formKey={model.formKey} visible={editing} scopeKey={`${model.scopeKey}:${source.id}`} title="修改來源用途" returnFocusRef={editTrigger} onClose={() => { if (basis.current && intake.stage === "review") adapter.editProposal(basis.current); setEditing(false); }} recovery={<SourceStatus model={model} actions={actions} production={false} />}>
        {intake.stage === "review" ? <View style={s.stack}>
          <AppSelect label="建議用途" value={proposal.purpose} options={sourcePurposeOptions} disabled={locked} onChange={value => change("purpose", value)} />
          <AppSelect label="來源性質（不代表已核實）" value={proposal.nature} options={sourceNatureOptions} disabled={locked} onChange={value => change("nature", value)} />
          <AppSelect label="資料時效" value={proposal.timeScope} options={sourceTimeOptions} disabled={locked} onChange={value => change("timeScope", value)} />
          {proposal.timeScope === "specific_period" ? <>
            <AppTextField label="適用期間或失效條件" accessibilityLabel="適用期間或失效條件" value={proposal.validityText} disabled={locked} multiline onChangeText={value => change("validityText", value)} error={!validSourceIntakeProposal(proposal)} />
            <Text style={validSourceIntakeProposal(proposal) ? s.meta : s.error}>請用原文說明期間或條件，最多 300 字；不會自動推算到期日。</Text>
          </> : null}
        <AppButton label="確認這個用途（預覽）" disabled={locked || !validSourceIntakeProposal(proposal)} onPress={adapter.confirmProposal} />
        <Text style={s.meta}>確認只記下本頁意向；未有正式接入回應，不會顯示已接通。</Text>
        </View> : null}
        {intake.stage === "connection_unknown" ? <><Text style={s.warning}>接入結果未知（合成情境），原用途保持鎖定。</Text><AppButton label="查核原次接入結果（預覽）" disabled={locked} onPress={adapter.checkConnection} /></> : null}
      </FormDialog>
    </View>
  );
}

function ProductionSourceIntakeEditor({ model, actions }: { model: SourcesViewModel; actions: SourcesActions }) {
  const source = model.selected, intake = model.intake?.selected, draft = model.managementDraft, adapter = actions.management;
  const editTrigger = useRef<View>(null), reading = useRef<View>(null);
  usePreviewLeaveGuard(!!draft?.dirty && !(model.operation.phase === "manage" && ["saving", "unknown", "unconfirmed", "confirmed_unavailable"].includes(model.operation.state)));
  if (!source || !intake || !draft || !adapter || !actions.intake) return null;
  const locked = !model.fresh || !source.canManage || model.access !== "editable" || !!model.direct;
  const editing = intake.stage === "review", management = draft.management, content = draft.content;
  const contentResult = content ? sourceComposerSchema(model.sources).safeParse({ ...sourceComposerDefaults, ...content, sourceUrl: content.sourceUrl ?? "", sourceDateText: content.sourceDateText ?? "" }) : null;
  const reasonValid = !!draft.reason.trim() && draft.reason.length <= 500 && !/[\u0000\uD800-\uDFFF]/u.test(draft.reason);
  const excerptValid = draft.modelExcerpt.length <= 6000 && validSourceExcerpt(source.text, draft.modelExcerpt);
  const valid = validSourceIntakeProposal(intake.proposal) && management.intention.length <= 1000 && !/[\u0000\uD800-\uDFFF]/u.test(management.intention)
    && reasonValid && (!contentResult || contentResult.success) && (!draft.modelPermission || excerptValid);
  function contentField(key: "sourceLabel" | "sourceUrl" | "sourceDateText" | "sourceNotes" | "text", label: string) {
    if (!content) return null;
    const message = contentResult && !contentResult.success ? contentResult.error.issues.find(issue => issue.path[0] === key)?.message : undefined;
    return <View><AppTextField label={label} accessibilityLabel={label} value={content[key] ?? ""} multiline={key === "text" || key === "sourceNotes"}
      disabled={locked} error={!!message} onChangeText={value => adapter!.editContent({ ...content, [key]: (key === "sourceUrl" || key === "sourceDateText") && !value.length ? null : value })} />
      {message ? <Text style={s.error}>{message}</Text> : null}</View>;
  }
  return <View ref={reading} tabIndex={-1} accessibilityLabel="來源設定" style={s.review} testID="source-intake-review">
    <Text style={s.title}>{editing ? "核對並保存來源設定" : source.management ? "已保存的來源設定" : "來源用途尚未設定"}</Text>
    <Text style={s.body}>用途：{source.management ? sourcePurposeOptions.find(option => option.value === source.management?.purpose)?.label : "尚未設定"}</Text>
    {source.management ? <><Text style={s.body}>來源性質：{sourceNatureOptions.find(option => option.value === source.management?.nature)?.label}</Text>
      <Text style={s.body}>時效：{sourceTimeOptions.find(option => option.value === source.management?.timeScope)?.label}</Text>
      {source.management.validityText ? <Text selectable style={s.body}>適用期間／條件：{source.management.validityText}</Text> : null}</> : null}
    <Text style={s.meta}>來源性質只記下你的說明；稱為官方或較長期參考都不代表已核實。</Text>
    <Text style={s.body}>目前狀態：{source.management?.enabled === false ? "已停用" : "可使用"} · {source.management?.modelExcerpt ? "已授權所選摘錄供聊天模型使用" : "沒有聊天模型摘錄授權"}</Text>
    {!editing ? <AppButton ref={editTrigger} label="編輯來源設定" variant="quiet" disabled={locked} onPress={actions.intake.editManually} /> : null}
    <FormDialog formKey={model.formKey} visible={editing} scopeKey={`${model.scopeKey}:${source.id}`} title="編輯來源設定" returnFocusRef={editTrigger} fallbackFocusRef={reading} onClose={() => actions.discardDraft?.("management")} recovery={<SourceStatus model={model} actions={actions} production />}><View style={s.stack}>
      <AppTextField label="這份資料想用來做甚麼？" accessibilityLabel="這份資料想用來做甚麼" multiline value={management.intention} disabled={locked} onChangeText={actions.intake.setIntention} />
      <AppSelect label="來源用途" value={management.purpose} options={sourcePurposeOptions} disabled={locked} onChange={purpose => adapter.edit({ purpose })} />
      <AppSelect label="來源性質（不代表已核實）" value={management.nature} options={sourceNatureOptions} disabled={locked} onChange={nature => adapter.edit({ nature })} />
      <AppSelect label="資料時效" value={management.timeScope} options={sourceTimeOptions} disabled={locked} onChange={timeScope => adapter.edit({ timeScope })} />
      {management.timeScope === "specific_period" ? <AppTextField label="適用期間或失效條件" accessibilityLabel="適用期間或失效條件" value={management.validityText} disabled={locked} multiline onChangeText={validityText => adapter.edit({ validityText })} error={!validSourceIntakeProposal(intake.proposal)} /> : null}
      <AppCheckbox label="啟用這份私人來源" checked={management.enabled} disabled={locked} onChange={enabled => adapter.edit({ enabled })} />
      {source.kind === "personal_source" ? <>
        {source.recordId ? <Text style={s.meta}>已連結家庭記錄，只可更改用途設定或停用；不能改寫原來源內容。</Text> : <AppButton label={content ? "取消原來源內容修改" : "原地編輯來源名稱、連結或原文"} variant="quiet" disabled={locked || source.management?.enabled === false} onPress={content ? adapter.cancelContentEdit : adapter.beginContentEdit} />}
        {content ? <View style={s.stack}>
          {contentField("sourceLabel", "來源名稱")}{contentField("sourceUrl", "來源連結")}{contentField("text", "來源原文")}
          {contentField("sourceDateText", "來源日期原文")}{contentField("sourceNotes", "私人來源備註")}
          <Text style={s.warning}>更改來源內容會撤銷舊模型摘錄授權。先保存原文，再另行選取摘錄授權；連結和備註不會交模型。</Text>
        </View> : null}
      </> : null}
      {management.enabled && source.management?.enabled !== false && !content && !!source.text.trim() ? <View style={s.stack}>
        <AppTextField label="容許聊天模型使用的原文摘錄" accessibilityLabel="容許聊天模型使用的原文摘錄" multiline value={draft.modelExcerpt} disabled={locked} onChangeText={adapter.setModelExcerpt} />
        <Text style={excerptValid ? s.meta : s.error}>{excerptValid ? "摘錄與保存原文完全相符。" : "請選取 1–6,000 字、與保存原文完全相符的連續摘錄。"}</Text>
        <AppCheckbox label="保存這次設定時，我同意聊天模型使用以上確切原文摘錄" checked={draft.modelPermission} disabled={locked || !excerptValid} onChange={adapter.setModelPermission} />
      </View> : <Text style={s.meta}>{source.management?.enabled === false && management.enabled ? "先保存啟用設定，之後才可讀取原文、編輯內容或授權摘錄。" : management.enabled ? "保存正文後才可選取摘錄授權。" : "停用後不能讀取或提取，並會撤銷模型摘錄授權。"}</Text>}
      <Text style={s.meta}>保存設定不會呼叫模型。不勾選摘錄授權會保存為沒有聊天模型存取權；網址及私人備註不在授權範圍。</Text>
      <AppTextField label="這次修改原因" accessibilityLabel="這次修改原因" multiline value={draft.reason} disabled={locked} onChangeText={adapter.setReason} />
      <Text style={reasonValid ? s.meta : s.error}>請填寫原因，最多 500 字；用途最多 1,000 字，適用條件最多 300 字。</Text>
      <AppButton label="保存來源設定" disabled={locked || !valid} onPress={actions.intake.confirmProposal} />
      <Text style={s.meta}>記錄用途不會建立孩子事實或家庭記錄；持續關注意向不會建立任務、提醒或外發。</Text>
    </View></FormDialog>
  </View>;
}

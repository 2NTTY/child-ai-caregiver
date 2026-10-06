import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";
import { View } from "react-native";
import { Text } from "react-native-paper";
import { useForm, useFormState } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { PhotoDraftFields } from "../../photo-view-model";
import type { SourcesActions, SourcesViewModel } from "../../shared-input-view-model";
import { AppCheckbox } from "../AppCheckbox";
import { RecordDraftFields, recordDraftFieldOrder, recordDraftFieldLabels } from "../RecordDraftFields";
import { FormErrorSummary } from "../FormErrorSummary";
import { AppButton, AppSelect, SectionCard, SectionHeader } from "../ui";
import { sourceRecordSchema } from "./source-form";
import { sourceStyles as s } from "./source-styles";
export function SourceRecordForm({ model, actions }: { model: SourcesViewModel; actions: SourcesActions }) {
  const { control, handleSubmit, getValues, setFocus } = useForm<PhotoDraftFields>({ defaultValues: model.draft, mode: "onSubmit", shouldFocusError: false, resolver: zodResolver(sourceRecordSchema(model.confirmationKind)) });
  const { isDirty, errors } = useFormState({ control });
  const visibleFields = model.confirmationKind === "family_record" ? recordDraftFieldOrder : ["text" as const];
  const errorEntries = visibleFields.flatMap(field => errors[field]?.message ? [{ field, label: `來源${recordDraftFieldLabels[field]}`, message: String(errors[field]?.message) }] : []);
  usePreviewLeaveGuard(isDirty);
  function change<K extends keyof PhotoDraftFields>(name: K, value: PhotoDraftFields[K]) { actions.editDraft({ ...getValues(), [name]: value }); }
  return <SectionCard surface="plain" style={s.workflowSection} testID="source-record-form"><SectionHeader density="compact" title="人工核對記錄" subtitle="原文已私人保存；這份草稿仍未與家庭共享。" icon="pencil-outline" />
    <FormErrorSummary entries={errorEntries} onFocus={field => setFocus(field as keyof PhotoDraftFields)} />
    <AppSelect label="記錄用途" value={model.confirmationKind} disabled={model.formLocked} options={[{ value: "reference", label: "外部參考（預設）" }, { value: "family_record", label: "孩子實際記錄" }]} onChange={actions.setConfirmationKind} />
    {model.confirmationKind === "reference" ? <Text style={s.meta}>外部參考保存為備註，不附數值或事件時間，不自動成為孩子事實或任務授權。</Text> : <Text style={s.meta}>請另行核對這些內容確實與目前孩子有關；原日期不當作事件日期。</Text>}
    <RecordDraftFields control={control} locked={model.formLocked} prefix="來源" showDetails={model.confirmationKind === "family_record"} onFieldChange={change} />
    {model.draftUncertainties.map((text, index) => <Text key={index} style={s.warning}>仍須核對：{text}</Text>)}
    <AppButton label="預覽家庭共享內容" disabled={!model.canConfirm} onPress={handleSubmit(actions.reviewDraft, invalid => {
      const first = visibleFields.find(field => invalid[field]?.message); if (first) setFocus(first);
    })} />
    {model.reviewed ? <View testID="source-shared-review" style={s.review}><Text style={s.title}>待確認 · 尚未家庭共享</Text>
      <Text style={s.body}>{model.reviewed.text}</Text><Text style={s.body}>用途：{model.confirmationKind === "reference" ? "外部參考備註" : "孩子實際記錄"}</Text>
      {model.draftUncertainties.map((text, index) => <Text key={index} style={s.warning}>仍須核對：{text}</Text>)}
      {model.confirmationKind === "family_record" ? <><Text style={s.body}>數值原文：{model.reviewed.rawValue || "未填寫"} · 單位：{model.reviewed.unit || "未填寫"}</Text>
        <Text style={s.body}>事件時間原文：{model.reviewed.timeRaw || "未知"}；{model.reviewed.approximate ? "包含約數／約略時間" : "未標記約數"}</Text>
        <AppCheckbox label="我確認以上內容確實與這個孩子有關" checked={model.childFactConsent} disabled={!model.canConfirm} onChange={actions.setChildFactConsent} />
      </> : null}
      <Text style={s.meta}>共享核對後的記錄文字及來源名稱；來源原文、網址、日期、私人備註及候選不會一起公開。</Text>
      <AppCheckbox label="我確認把以上記錄與獲授權家庭成員共享" checked={model.sharedConsent} disabled={!model.canConfirm || model.confirmationKind === "family_record" && !model.childFactConsent} onChange={actions.setSharedConsent} />
      <AppButton label="確認家庭共享" disabled={!model.canConfirm || !model.sharedConsent || model.confirmationKind === "family_record" && !model.childFactConsent} onPress={actions.confirm} />
    </View> : null}
  </SectionCard>;
}

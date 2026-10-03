import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";
import { View } from "react-native";
import { Text } from "react-native-paper";
import { useForm, useFormState } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { careKindOptions } from "../../care-view-model";
import type { PhotoDraftFields, PhotosActions, PhotosViewModel } from "../../photo-view-model";
import { AppCheckbox } from "../AppCheckbox";
import { AppButton, SectionCard, SectionHeader } from "../ui";
import { FormErrorSummary } from "../FormErrorSummary";
import { RecordDraftFields, recordDraftFieldLabels, recordDraftFieldOrder } from "../RecordDraftFields";
import { photoDraftSchema } from "./photo-form";
import { photoStyles as s } from "./photo-styles";

export function PhotoRecordForm({ model, actions }: { model: PhotosViewModel; actions: PhotosActions }) {
  const { control, handleSubmit, getValues, setFocus } = useForm<PhotoDraftFields>({ defaultValues: model.draft, resolver: zodResolver(photoDraftSchema), mode: "onSubmit", shouldFocusError: false });
  const { isDirty, errors } = useFormState({ control });
  const errorEntries = recordDraftFieldOrder.flatMap(name => {
    const message = errors[name]?.message;
    return message ? [{ field: name, label: `照片${recordDraftFieldLabels[name]}`, message }] : [];
  });
  usePreviewLeaveGuard(isDirty);
  function change<K extends keyof PhotoDraftFields>(name: K, value: PhotoDraftFields[K]) { actions.editDraft({ ...getValues(), [name]: value }); }
  return <SectionCard testID="photo-record-form"><SectionHeader density="compact" title="核對記錄內容" subtitle="本頁手動草稿尚未共享；提取失敗或結果未知也可手動整理。" icon="pencil-outline" />
    <FormErrorSummary entries={errorEntries} onFocus={name => {
      const target = recordDraftFieldOrder.find(field => field === name);
      if (target) setFocus(target);
    }} />
    <RecordDraftFields control={control} locked={model.formLocked} prefix="照片" onFieldChange={change} />
    <Text style={s.meta}>資料來源：{model.selected?.source ?? model.source}。更改草稿後須重新預覽及勾選共享範圍。</Text>
    <Text style={s.meta}>離開這頁、切換孩子或重新載入會清除本次原檔及草稿；沒有離線寫入隊列。</Text>
    <AppButton density="compact" label="預覽共享" accessibilityLabel="預覽照片共享內容" disabled={model.formLocked || !model.fresh} onPress={handleSubmit(actions.reviewDraft, invalidFields => {
      const first = recordDraftFieldOrder.find(name => invalidFields[name]?.message);
      if (first) setFocus(first);
    })} />
    {model.reviewed ? <View style={s.review} testID="photo-shared-review"><Text style={s.title}>待確認 · 尚未家庭共享</Text>
      <Text style={s.original}>{model.reviewed.text}</Text>
      <Text style={s.body}>種類：{careKindOptions.find(item => item.value === model.reviewed?.kind)?.label}；數值：{model.reviewed.rawValue || "未填寫"}；單位：{model.reviewed.unit || "未填寫"}</Text>
      <Text style={s.body}>時間原文：{model.reviewed.timeRaw || "未知"}；{model.reviewed.approximate ? "包含約數／約略時間" : "未標記約數"}</Text>
      <AppCheckbox label="我確認原照片及這份記錄與孩子所屬家庭共享" checked={model.sharedConsent} disabled={model.formLocked} onChange={actions.setSharedConsent} />
      {model.selected?.state !== "ready" ? <Text style={s.meta}>先私人保存完整原照片，再確認家庭共享。</Text> : null}
      <AppButton density="compact" label="確認家庭共享" accessibilityLabel="確認照片及記錄家庭共享" disabled={!model.canConfirm} onPress={actions.confirmShared} />
      <Text style={s.meta}>不會共享私人聊天，也不代表已通知照顧者。未查明寫入結果時，查核原操作後才繼續。</Text>
    </View> : null}
  </SectionCard>;
}

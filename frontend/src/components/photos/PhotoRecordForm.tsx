import { View } from "react-native";
import { HelperText, Text } from "react-native-paper";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { careKindOptions } from "../../care-view-model";
import type { PhotoDraftFields, PhotosActions, PhotosViewModel } from "../../photo-view-model";
import { AppCheckbox } from "../AppCheckbox";
import { AppButton, AppSelect, AppTextField, SectionCard, SectionHeader } from "../ui";
import { photoDraftSchema } from "./photo-form";
import { photoStyles as s } from "./photo-styles";

export function PhotoRecordForm({ model, actions }: { model: PhotosViewModel; actions: PhotosActions }) {
  const { control, handleSubmit, getValues } = useForm<PhotoDraftFields>({ defaultValues: model.draft, resolver: zodResolver(photoDraftSchema), mode: "onBlur" });
  function change<K extends keyof PhotoDraftFields>(name: K, value: PhotoDraftFields[K]) { actions.editDraft({ ...getValues(), [name]: value }); }
  function textField(name: "text" | "rawValue" | "unit" | "timeRaw", label: string, help?: string) {
    return <Controller name={name} control={control} render={({ field, fieldState }) => <View>
      <AppTextField ref={field.ref} label={label} accessibilityLabel={label} value={field.value} multiline={name === "text"} disabled={model.formLocked} error={!!fieldState.error}
        onBlur={field.onBlur} onChangeText={value => { field.onChange(value); change(name, value); }} />
      {fieldState.error || help ? <HelperText type={fieldState.error ? "error" : "info"} visible>{fieldState.error?.message ?? help}</HelperText> : null}
    </View>} />;
  }
  return <SectionCard testID="photo-record-form"><SectionHeader title="核對記錄內容" subtitle="本頁手動草稿尚未共享；提取失敗或結果未知也可手動整理。" icon="pencil-outline" />
    <Controller name="kind" control={control} render={({ field }) => <AppSelect label="照片記錄種類" value={field.value} options={careKindOptions} disabled={model.formLocked} onChange={value => { field.onChange(value); change("kind", value); }} />} />
    {textField("text", "照片記錄原文", "最多 5,000 字。保留原文字，不自動補寫事實。")}
    <View style={s.quantities}><View style={s.quantity}>{textField("rawValue", "照片數值原文")}</View><View style={s.quantity}>{textField("unit", "照片數值單位")}</View></View>
    <Controller name="approximate" control={control} render={({ field }) => <AppCheckbox label="內容含約數或約略時間" checked={field.value} disabled={model.formLocked} onChange={value => { field.onChange(value); change("approximate", value); }} />} />
    {textField("timeRaw", "照片事件時間原文", "保留原時間說法。日期未確定時，不會推算成精準時間。")}
    <Text style={s.meta}>資料來源：{model.selected?.source ?? model.source}。更改草稿後須重新預覽及勾選共享範圍。</Text>
    <Text style={s.meta}>離開這頁、切換孩子或重新載入會清除本次原檔及草稿；沒有離線寫入隊列。</Text>
    <AppButton label="預覽共享" accessibilityLabel="預覽照片共享內容" disabled={model.formLocked} onPress={handleSubmit(actions.reviewDraft)} />
    {model.reviewed ? <View style={s.review} testID="photo-shared-review"><Text style={s.title}>待確認 · 尚未家庭共享</Text>
      <Text style={s.body}>{model.reviewed.text}</Text>
      <Text style={s.body}>種類：{careKindOptions.find(item => item.value === model.reviewed?.kind)?.label}；數值：{model.reviewed.rawValue || "未填寫"}；單位：{model.reviewed.unit || "未填寫"}</Text>
      <Text style={s.body}>時間原文：{model.reviewed.timeRaw || "未知"}；{model.reviewed.approximate ? "包含約數／約略時間" : "未標記約數"}</Text>
      <AppCheckbox label="我確認原照片及這份記錄與孩子所屬家庭共享" checked={model.sharedConsent} disabled={model.formLocked} onChange={actions.setSharedConsent} />
      {model.selected?.state !== "ready" ? <Text style={s.meta}>先私人保存完整原照片，再確認家庭共享。</Text> : null}
      <AppButton label="確認家庭共享" accessibilityLabel="確認照片及記錄家庭共享" disabled={!model.canConfirm} onPress={actions.confirmShared} />
      <Text style={s.meta}>不會共享私人聊天，也不代表已通知照顧者。未查明寫入結果時，查核原操作後才繼續。</Text>
    </View> : null}
  </SectionCard>;
}

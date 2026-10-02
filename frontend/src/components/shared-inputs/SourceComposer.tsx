import { View } from "react-native";
import { HelperText, Text } from "react-native-paper";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { SourcesActions, SourcesViewModel } from "../../shared-input-view-model";
import { AppButton, AppSelect, AppTextField, SectionCard, SectionHeader } from "../ui";
import { sourceComposerDefaults, sourceComposerSchema, sourceCreateProjection, type SourceComposerDraft } from "./source-form";
import { sourceStyles as s } from "./source-styles";
import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";

export function SourceComposer({ model, actions }: { model: SourcesViewModel; actions: SourcesActions }) {
  const seed = model.composerSeed;
  const { control, watch, handleSubmit, formState: { isDirty } } = useForm<SourceComposerDraft>({ mode: "onBlur", resolver: zodResolver(sourceComposerSchema(model.sources)),
    defaultValues: seed ? { ...sourceComposerDefaults, sourceLabel: seed.sourceLabel, sourceUrl: seed.sourceUrl ?? "", sourceDateText: seed.sourceDateText ?? "", sourceNotes: seed.sourceNotes } : sourceComposerDefaults });
  const kind = watch("kind"), text = watch("text");
  usePreviewLeaveGuard(isDirty, model.busy || ["unknown", "unconfirmed", "confirmed_unavailable"].includes(model.operation.state));
  const locked = model.busy || !model.canChoose || model.access !== "editable";
  function field(name: "sourceLabel" | "sourceUrl" | "sourceDateText" | "sourceNotes" | "text", label: string, help?: string) {
    return <Controller name={name} control={control} render={({ field: input, fieldState }) => <View>
      <AppTextField label={label} accessibilityLabel={label} ref={input.ref} value={input.value} onBlur={input.onBlur} onChangeText={input.onChange}
        disabled={locked} error={!!fieldState.error} multiline={name === "text" || name === "sourceNotes"} autoCapitalize={name === "sourceUrl" ? "none" : "sentences"} autoCorrect={name !== "sourceUrl"} />
      {fieldState.error || help ? <HelperText type={fieldState.error ? "error" : "info"} visible>{fieldState.error?.message ?? help}</HelperText> : null}
    </View>} />;
  }
  return <SectionCard testID="source-composer"><SectionHeader title="新增私人來源" subtitle={`保存到${model.childName}的來源區，只供${model.accountName}本人讀取。`} icon="lock-outline" />
    {seed ? <Text style={s.warning}>原來源仍保留；這次會另建一項，請自行貼上正文。</Text> : null}
    <Controller name="kind" control={control} render={({ field: input }) => <AppSelect label="來源方式" value={input.value} disabled={locked} onChange={input.onChange} options={[
      { value: "personal_source", label: "自行設定私人來源" }, { value: "paste", label: "貼上原文" }, { value: "public_source", label: "清單中的公開來源" },
    ]} />} />
    {kind === "public_source" ? <><Text style={s.body}>建立私人來源後，仍要另外同意取得正文。</Text>
      <Controller name="sourceId" control={control} render={({ field: input, fieldState }) => <View>
        <AppSelect label="公開來源" value={input.value} disabled={locked || !model.sources.length} onChange={input.onChange} options={model.sources.map(source => ({ value: source.id, label: `${source.publisher} · ${source.url}` }))} />
        {fieldState.error ? <Text accessibilityRole="alert" style={s.error}>{fieldState.error.message}</Text> : null}
      </View>} />{!model.sources.length ? <Text style={s.meta}>目前沒有可選的公開來源。</Text> : null}</> : <>
      {field("sourceLabel", "來源名稱", "最多 200 字。")}
      {field("sourceUrl", "來源 HTTPS 網址", "可留空；最多 1,000 字，不含帳密。貼上網址只會保存連結。")}
      {kind === "personal_source" ? field("sourceNotes", "來源備註", "可留空；最多 1,000 字，不會自動送到模型。") : null}
      {field("sourceDateText", "來源日期原文", "可留空；保留發布日期或原日期說法，不推算為保存日期。")}
      {field("text", "自備來源原文", kind === "personal_source" ? "網址或原文至少一項。可貼上自備材料，最多 10,000 字。" : "請貼上原文，最多 10,000 字。")}
      <Text style={s.meta}>{text.length.toLocaleString("en-HK")} 字 · 超限會提示，不會替你截短原文。</Text>
      {kind === "personal_source" && !text.trim() ? <Text style={s.meta}>只保存連結不代表已取得或分析正文；需登入的材料請自行貼上。</Text> : null}
    </>}
    <AppButton label="保存私人來源" disabled={!model.fresh || !model.canCreate || !model.canChoose} onPress={handleSubmit(value => actions.create(sourceCreateProjection(value)))} />
    {!model.canCreate ? <Text style={s.warning}>目前不能新增來源。已保存的本人內容仍可按權限讀取。</Text> : null}
  </SectionCard>;
}

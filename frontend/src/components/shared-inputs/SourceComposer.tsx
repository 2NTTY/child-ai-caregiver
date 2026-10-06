import { useEffect, useId, useState } from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { SourcesActions, SourcesViewModel } from "../../shared-input-view-model";
import { AppButton, AppSelect, AppTextField, SectionCard, SectionHeader } from "../ui";
import { sourceComposerDefaults, sourceComposerSchema, sourceCreateProjection, type SourceComposerDraft } from "./source-form";
import { sourceStyles as s } from "./source-styles";
import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";
import { FormErrorSummary, FormFieldMessage } from "../FormErrorSummary";
import { validSourceIntakeText } from "../../source-intake";

export function SourceComposer({ model, actions }: { model: SourcesViewModel; actions: SourcesActions }) {
  const seed = model.composerSeed;
  const formId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<keyof SourceComposerDraft | null>(null);
  const { control, watch, handleSubmit, setFocus, formState: { isDirty, errors } } = useForm<SourceComposerDraft>({ mode: "onSubmit", shouldFocusError: false, resolver: zodResolver(sourceComposerSchema(model.sources)),
    defaultValues: seed ? { ...sourceComposerDefaults, sourceLabel: seed.sourceLabel, sourceUrl: seed.sourceUrl ?? "", sourceDateText: seed.sourceDateText ?? "", sourceNotes: seed.sourceNotes } : sourceComposerDefaults });
  const kind = watch("kind"), text = watch("text");
  const intake = model.intake, intakeActions = actions.intake;
  useEffect(() => { if (pendingFocus) { setFocus(pendingFocus); setPendingFocus(null); } }, [pendingFocus, detailsOpen, setFocus]);
  const fieldId = (name: keyof SourceComposerDraft) => `${formId}-${name}`;
  const visibleFields: { field: keyof SourceComposerDraft; label: string }[] = kind === "public_source" ? [{ field: "sourceId", label: "公開來源" }]
    : [{ field: "sourceUrl", label: "來源連結" }, { field: "text", label: "來源原文" }, { field: "sourceLabel", label: "來源名稱" }, { field: "sourceDateText", label: "來源日期原文" }, ...(kind === "personal_source" ? [{ field: "sourceNotes" as const, label: "私人來源備註" }] : [])];
  const errorEntries = visibleFields.flatMap(item => errors[item.field]?.message ? [{ ...item, message: String(errors[item.field]?.message) }] : []);
  usePreviewLeaveGuard(isDirty || !!intake?.intention, model.busy || ["unknown", "unconfirmed", "confirmed_unavailable"].includes(model.operation.state));
  const locked = model.busy || !model.canChoose || model.access !== "editable";
  function field(name: "sourceLabel" | "sourceUrl" | "sourceDateText" | "sourceNotes" | "text", label: string, help?: string) {
    return <Controller name={name} control={control} render={({ field: input, fieldState }) => <View>
      <AppTextField nativeID={fieldId(name)} aria-invalid={!!fieldState.error} aria-describedby={fieldState.error || help ? `${fieldId(name)}-message` : undefined} label={label} accessibilityLabel={label} ref={input.ref} value={input.value} onBlur={input.onBlur} onChangeText={input.onChange}
        disabled={locked} error={!!fieldState.error} multiline={name === "text" || name === "sourceNotes"} autoCapitalize={name === "sourceUrl" ? "none" : "sentences"} autoCorrect={name !== "sourceUrl"} />
      <FormFieldMessage id={`${fieldId(name)}-message`} error={fieldState.error?.message} help={help} />
    </View>} />;
  }
  return <SectionCard surface="plain" style={s.workflowSection} testID="source-composer"><SectionHeader density="compact" title="加入資料來源" subtitle={`先放到${model.childName}的私人來源，只供${model.accountName}本人讀取。`} icon="lock-outline" />
    <FormErrorSummary entries={errorEntries} onFocus={name => { setDetailsOpen(true); setPendingFocus(name as keyof SourceComposerDraft); }} />
    {seed ? <Text style={s.warning}>原來源仍保留；這次會另建一項，請自行貼上正文。</Text> : null}
    <Controller name="kind" control={control} render={({ field: input }) => <AppSelect ref={input.ref} onBlur={input.onBlur} id={fieldId("kind")} label="來源方式" value={input.value} disabled={locked} onChange={input.onChange} options={[
      { value: "personal_source", label: "自行設定私人來源" }, { value: "paste", label: "貼上原文" }, { value: "public_source", label: "清單中的公開來源" },
    ]} />} />
    {kind === "public_source" ? <><Text style={s.body}>建立私人來源後，仍要另外同意取得正文。</Text>
      <Controller name="sourceId" control={control} render={({ field: input, fieldState }) => <View>
        <AppSelect ref={input.ref} onBlur={input.onBlur} id={fieldId("sourceId")} invalid={!!fieldState.error} describedBy={fieldState.error ? `${fieldId("sourceId")}-message` : undefined} label="公開來源" value={input.value} disabled={locked || !model.sources.length} onChange={input.onChange} options={model.sources.map(source => ({ value: source.id, label: `${source.publisher} · ${source.url}` }))} />
        <FormFieldMessage id={`${fieldId("sourceId")}-message`} error={fieldState.error?.message} />
      </View>} />{!model.sources.length ? <Text style={s.meta}>目前沒有可選的公開來源。</Text> : null}</> : <>
      {field("sourceUrl", "來源連結", "可留空；HTTPS 網址不含帳密。貼上網址不會立即取得正文。")}
      {field("text", "來源原文", kind === "personal_source" ? "連結或原文至少一項。需要登入的材料，請貼上你有權提供的原文。" : "請貼上原文，最多 10,000 字。")}
      <Text style={s.meta}>{text.length.toLocaleString("en-HK")} 字 · 最多 10,000 字，不會截短原文。</Text>
      <AppButton expanded={detailsOpen} label={detailsOpen ? "收起來源補充資料" : "補充名稱、日期或備註"} variant="quiet" disabled={locked} onPress={() => setDetailsOpen(value => !value)} />
      {detailsOpen ? <>
        {field("sourceLabel", "來源名稱", "最多 200 字；可先用預設名稱。")}
        {field("sourceDateText", "來源日期原文", "可留空；來源日期不是保存日期，也不是有效期。")}
        {kind === "personal_source" ? field("sourceNotes", "私人來源備註", "可留空；最多 1,000 字，不會自動送到模型。") : null}
      </> : null}
    </>}
    {intake && intakeActions ? <View style={s.section}>
      <AppTextField label="這份資料想用來做甚麼？" accessibilityLabel="這份資料想用來做甚麼" value={intake.intention} error={!validSourceIntakeText(intake.intention)} disabled={locked} multiline onChangeText={intakeActions.setIntention} />
      {!validSourceIntakeText(intake.intention) ? <Text style={s.error}>用途說明最多 1,000 字，請移除無效字元；不會截短。</Text> : null}
      <Text style={s.meta}>用一句話說就可以，也可以先保存。助手會先查看來源，再和你商量；你亦可隨時改用同一表單自行整理。</Text>

    </View> : null}
    <Text style={s.meta}>正式來源沿既有加密儲存保存，不加入公共官方／新聞知識庫；家庭成員不會取得完整原文。</Text>
    <AppButton label={intake ? "私人保存並開始整理（預覽）" : "保存私人來源"} disabled={!model.fresh || !model.canCreate || !model.canChoose || !!intake && !validSourceIntakeText(intake.intention)} onPress={handleSubmit(value => actions.create(sourceCreateProjection(value)), invalid => {
      const first = visibleFields.find(item => invalid[item.field]?.message); if (first) { setDetailsOpen(true); setPendingFocus(first.field); }
    })} />
    {!model.canCreate ? <Text style={s.warning}>目前不能新增來源。已保存的本人內容仍可按權限讀取。</Text> : null}
  </SectionCard>;
}

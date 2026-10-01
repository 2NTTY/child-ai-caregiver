import { brand } from "../../branding";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { StyleSheet, View } from "react-native";
import { ActivityIndicator, Text } from "react-native-paper";
import { AppCheckbox } from "../AppCheckbox";
import { AppDialog as Dialog } from "../AppDialog";
import { AppButton, AppSelect, AppTextField, OperationPill, SectionCard, SectionHeader } from "../ui";
import { personalLimits, type ModelMode, type ModelSettings, type ModelSettingsActions, type ModelSettingsUsage, type ModelSettingsViewModel } from "../../model-settings-view-model";
import { chineseFont, colors, spacing, typeScale } from "../../theme";
import { modelCommandFromDraft, modelSettingsDraft, modelSettingsSchema, removeModelKeyCommand, type ModelSettingsDraft } from "./model-settings-form";

const empty: ModelSettings = { version: 0, mode: "disabled", provider: "gemini", model: "gemini-3.1-flash-lite", keyConfigured: false,
  backgroundEnabled: false, dailyLimit: personalLimits.daily.default, maxModelCalls: personalLimits.modelCalls.default, maxQueryEmbeddings: personalLimits.queryEmbeddings.default, updatedAt: null };
const modeLabels: Record<ModelMode, string> = { platform: brand.platformServiceLabel, personal: "我的個人密鑰", disabled: "停用 AI" };
function FieldError({ message }: { message?: string }) { return message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null; }
function UsageCard({ label, usage }: { label: string; usage: ModelSettingsUsage }) {
  return <SectionCard><SectionHeader title={label} subtitle={`計數日：${usage.day}（UTC）；資料來自最後讀取。`} />
    <Text style={styles.count}>{usage.attempts} <Text style={styles.body}>次呼叫嘗試</Text></Text>
    <Text style={styles.meta}>輸入 {usage.inputTokens} · 輸出 {usage.outputTokens} · 快取 {usage.cachedTokens} tokens</Text>
    <Text style={styles.meta}>有 {usage.unknownUsageAttempts} 次用量未能確認。</Text>
  </SectionCard>;
}

export function ModelSettingsView({ model, actions }: { model: ModelSettingsViewModel; actions: ModelSettingsActions }) {
  const [width, setWidth] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const snapshot = model.snapshot, settings = snapshot?.settings ?? empty;
  const { control, reset, setValue, watch, handleSubmit, formState: { errors, isDirty } } = useForm<ModelSettingsDraft>({
    resolver: zodResolver(modelSettingsSchema(settings.keyConfigured)), defaultValues: modelSettingsDraft(settings), mode: "onChange",
  });
  const mode = watch("mode"), keyText = watch("keyText"), consent = watch("consent");
  const locked = !model.online || !model.authorized || !!model.busy || model.needsRead || !snapshot;
  const available = mode === "personal" ? snapshot?.personalAvailable : mode === "platform" ? snapshot?.platformAvailable : true;
  const canSave = !locked && available && (mode !== "personal" || consent && (settings.keyConfigured || !!keyText.trim()));
  useEffect(() => {
    reset(modelSettingsDraft(settings)); setDeleteOpen(false); setDeleteConfirmed(false);
  }, [model.scopeKey, model.formRevision, settings, reset]);
  useEffect(() => {
    setValue("keyText", ""); setValue("consent", false); setDeleteOpen(false); setDeleteConfirmed(false);
  }, [model.secretRevision, model.online, model.authorized, setValue]);
  function clearSecret() { setValue("keyText", ""); setValue("consent", false); }
  const submit = handleSubmit(draft => {
    if (!canSave) return;
    const command = modelCommandFromDraft(draft, settings);
    clearSecret(); actions.save(command);
  });
  function changeMode(value: ModelMode) {
    clearSecret(); setValue("mode", value, { shouldDirty: true });
    if (value !== "personal") setValue("backgroundEnabled", false);
  }
  const narrow = width < 820;
  return <View testID="model-settings-view" onLayout={event => setWidth(event.nativeEvent.layout.width)} style={styles.root}>
    <SectionCard><SectionHeader title="本人模型設定" subtitle={`適用於${model.accountName} · ${model.serverLabel}；切換孩子會沿用本人的設定。`} />
      <View style={styles.statusRow}>{model.busy ? <ActivityIndicator size={20} /> : null}
        {model.operation !== "none" ? <OperationPill state={model.operation} /> : null}
        <Text accessibilityLiveRegion="polite" style={[styles.body, model.operation === "unknown" && styles.warning]}>{model.notice || (model.busy ? "正在讀取模型設定…" : "選擇平台服務、自己的密鑰，或停用 AI。")}</Text>
      </View>
      {!model.online ? <Text style={styles.warning}>目前離線，密鑰輸入已清除；恢復連線後先重讀設定。</Text> : null}
      {!model.authorized ? <Text style={styles.error}>本人身份或權限已改變，請重新登入。</Text> : null}
      <AppButton label="重新讀取模型設定" variant="secondary" disabled={!model.online || !model.authorized || !!model.busy} onPress={actions.refresh} />
    </SectionCard>
    {snapshot && model.authorized ? <View style={[styles.columns, narrow && styles.stacked]}>
      <View style={[styles.column, narrow && styles.fullColumn]}>
        <SectionCard><SectionHeader title="使用方式" subtitle={`最後讀到的版本：${settings.version} · ${modeLabels[settings.mode]}`} />
          <Text style={styles.meta}>{isDirty ? "編輯草稿 · 尚未保存。" : "下方選項在確認保存前屬草稿。"}</Text>
          <AppSelect label="模型模式" value={mode} disabled={locked} options={Object.entries(modeLabels).map(([value, label]) => ({ value: value as ModelMode, label }))} onChange={changeMode} />
          {!snapshot.enabled ? <Text style={styles.warning}>AI 總開關目前停用。你仍可管理或刪除本人密鑰。</Text> : null}
          {!available ? <Text style={styles.warning}>所選服務目前不可用；你仍可選擇停用或刪除密鑰。</Text> : null}
          <Text style={styles.meta}>模型：{settings.model}</Text>
          <Text style={styles.body}>{settings.keyConfigured ? "個人密鑰已保存，不會顯示原文。" : "尚未保存個人密鑰。"}</Text>
          {mode === "personal" ? <>
            <Controller control={control} name="keyText" render={({ field }) => <AppTextField label={settings.keyConfigured ? "替換 API 密鑰" : "個人 API 密鑰"}
              accessibilityLabel="個人 API 密鑰" testID="model-api-key" secureTextEntry autoComplete="off" textContentType="none" autoCapitalize="none" autoCorrect={false}
              importantForAutofill="no" maxLength={512} value={model.online && model.authorized ? field.value : ""} onChangeText={field.onChange} onBlur={field.onBlur} ref={field.ref} disabled={locked || !available} error={!!errors.keyText} />} />
            <FieldError message={errors.keyText?.message} />
            <Text style={styles.meta}>{settings.keyConfigured ? "留空會保留已保存密鑰。" : ""}密鑰只在確認保存時送出；送出或失敗後會清空，原密鑰不會讀回。</Text>
            <Controller control={control} name="consent" render={({ field }) => <AppCheckbox checked={field.value} onChange={value => setValue("consent", value, { shouldValidate: true })} disabled={locked || !available}
              label="我同意個人服務的費用及資料外送" description="使用你自己的 Google AI 服務；必要對話與資料會送到供應商，費用按其帳戶計算。" />} />
            <FieldError message={errors.consent?.message} />
            <Controller control={control} name="backgroundEnabled" render={({ field }) => <AppCheckbox checked={field.value} onChange={field.onChange} disabled={locked || !available}
              label="另行允許背景任務使用此密鑰" description="背景處理亦會使用供應商服務及計入用量；不會因加入密鑰而自動啟用。" />} />
            <View style={styles.limitFields}>{([
              ["dailyText", "個人每日呼叫上限", personalLimits.daily], ["modelCallsText", "每次 Agent 生成上限", personalLimits.modelCalls], ["queryEmbeddingsText", "每次查詢向量上限", personalLimits.queryEmbeddings],
            ] as const).map(([name, label, range]) => <View key={name} style={styles.limitField}>
              <Controller control={control} name={name} render={({ field }) => <AppTextField accessibilityLabel={label} label={name === "dailyText" ? "每日呼叫上限" : name === "modelCallsText" ? "每次生成上限" : "查詢向量上限"} keyboardType="number-pad" inputMode="numeric"
                value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} ref={field.ref} disabled={locked || !available} error={!!errors[name]} />} />
              <Text style={styles.meta}>{range.min}–{range.max} 次 · 整數</Text><FieldError message={errors[name]?.message} />
            </View>)}</View>
          </> : <Text style={styles.meta}>{mode === "platform" ? "平台沿用既定配額，每次 Agent 最多生成 4 次、查詢向量 2 次。" : "保存停用後不會自行切回平台；已有密鑰會保留，刪除須另行確認。"}</Text>}
          <View style={styles.actions}><AppButton label="保存模型設定" disabled={!canSave} loading={model.busy === "save"} onPress={() => void submit()} />
            <AppButton label="刪除個人密鑰" variant="secondary" disabled={locked || !settings.keyConfigured} onPress={() => { clearSecret(); setDeleteConfirmed(false); setDeleteOpen(true); }} />
          </View>
        </SectionCard>
        {settings.keyConfigured ? <SectionCard><SectionHeader title="已保存密鑰的模型資料" subtitle="此檢查只讀取供應商模型資料，不使用未保存的輸入。" />
          <Text style={styles.body}>{model.keyCheck?.version === settings.version ? model.keyCheck.status === "accessible" ? "模型資料可讀取。" : "目前未能讀取模型資料。" : "尚未取得此版本的模型資料查核結果。"}</Text>
          <Text style={styles.meta}>密鑰已保存、模型資料可讀及實際生成／查詢向量可用，須分開核對；這項檢查不能確認帳單或剩餘配額。</Text>
          <AppButton label="檢查已保存密鑰" variant="secondary" loading={model.busy === "check"} disabled={locked || !snapshot.enabled || !snapshot.personalAvailable || settings.mode !== "personal" || !!keyText.trim()}
            onPress={() => actions.check(settings.version)} />
          <Text style={styles.meta}>每帳戶每分鐘最多一次；遇到 429 請稍後手動重試。</Text>
        </SectionCard> : null}
      </View>
      <View style={[styles.column, narrow && styles.fullColumn]}>
        <UsageCard label="平台服務用量" usage={snapshot.usage.platform} /><UsageCard label="個人服務用量" usage={snapshot.usage.personal} />
        <SectionCard><SectionHeader title="用量與安全上限" />
          <Text style={styles.body}>已保存的個人每日上限：{settings.dailyLimit} 次</Text>
          <Text style={styles.meta}>全站個人服務安全上限：{snapshot.personalGlobalLimit} 次；個人上限只在個人模式生效。</Text>
          <Text style={styles.meta}>每日 UTC 00:00（香港 08:00）重置。生成及查詢向量的嘗試均計次，metadata 不代表完整供應商帳單。</Text>
          <Text style={styles.meta}>固定上限：工具 8 次 · 每次運行 90 秒 · 每次輸出 1024 tokens · 上下文 32000 字元。</Text>
          <Text style={styles.meta}>停用或刪除不會撤回供應商已接受的呼叫。</Text>
        </SectionCard>
      </View>
    </View> : null}
    <Dialog danger visible={deleteOpen} onDismiss={() => setDeleteOpen(false)}>
      <Dialog.Title danger>刪除個人密鑰並停用 AI</Dialog.Title><Dialog.Content>
        <Text style={styles.body}>將刪除目前版本 {settings.version} 的已保存密鑰並停用 AI。使用平台服務須另行選擇及保存。</Text>
        <AppCheckbox label="我確認刪除密鑰並停用 AI" checked={deleteConfirmed} onChange={setDeleteConfirmed} disabled={locked} />
      </Dialog.Content><Dialog.Actions><AppButton label="取消" variant="quiet" onPress={() => setDeleteOpen(false)} />
        <AppButton label="確認刪除並停用" variant="danger" disabled={locked || !deleteConfirmed} onPress={() => { if (locked || !deleteConfirmed) return; clearSecret(); setDeleteOpen(false); actions.save(removeModelKeyCommand(settings)); }} />
      </Dialog.Actions>
    </Dialog>
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: spacing.lg }, columns: { flexDirection: "row", gap: spacing.lg, alignItems: "flex-start" }, stacked: { flexDirection: "column" },
  column: { flex: 1, minWidth: 0, width: "100%", gap: spacing.lg }, fullColumn: { flex: undefined, flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
  statusRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm }, actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  limitFields: { gap: spacing.md }, limitField: { gap: spacing.xs },
  body: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23, flexShrink: 1 },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
  count: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.heading, fontWeight: "700" },
  error: { fontFamily: chineseFont, color: colors.errorInk, fontSize: typeScale.caption, lineHeight: 20 },
  warning: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, lineHeight: 23 },
});

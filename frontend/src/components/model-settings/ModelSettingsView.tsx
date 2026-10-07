import { AppStatusBadge } from "../AppStatusBadge";
import { SettingsSection as SectionCard } from "../settings/SettingsSection";
import { useContainerWidth } from "../useContainerWidth";
import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";
import { brand } from "../../branding";
import { useEffect, useId, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { StyleSheet, View } from "react-native";
import { ActivityIndicator, Text } from "react-native-paper";
import { AppCheckbox } from "../AppCheckbox";
import { AppDialog as Dialog } from "../AppDialog";
import { AppButton, AppSelect, AppTextField, OperationPill, SectionHeader } from "../ui";
import { FormErrorSummary, FormFieldMessage } from "../FormErrorSummary";
import { ReadStateNotice } from "../ReadStateNotice";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { personalLimits, type ModelMode, type ModelSettings, type ModelSettingsActions, type ModelSettingsUsage, type ModelSettingsViewModel } from "../../model-settings-view-model";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../../theme";
import { MotionFeedback, MotionReveal } from "../../motion";
import { modelCommandFromDraft, modelSettingsDraft, modelSettingsSchema, removeModelKeyCommand, type ModelSettingsDraft } from "./model-settings-form";

const empty: ModelSettings = { version: 0, mode: "disabled", provider: "gemini", model: "gemini-3.1-flash-lite", keyConfigured: false,
  backgroundEnabled: false, dailyLimit: personalLimits.daily.default, maxModelCalls: personalLimits.modelCalls.default, maxQueryEmbeddings: personalLimits.queryEmbeddings.default, updatedAt: null };
const modeLabels: Record<ModelMode, string> = { platform: brand.platformServiceLabel, personal: "我的個人密鑰", disabled: "停用 AI" };
const formFields = [
  { name: "mode", label: "模型模式" }, { name: "keyText", label: "個人 API 密鑰" }, { name: "consent", label: "費用及資料外送同意" },
  { name: "dailyText", label: "個人每日呼叫上限" }, { name: "modelCallsText", label: "每次 Agent 生成上限" }, { name: "queryEmbeddingsText", label: "每次查詢向量上限" },
] as const;
function UsageCard({ label, usage }: { label: string; usage: ModelSettingsUsage }) {
  return <SectionCard><SectionHeader density="compact" title={label} subtitle={`計數日：${usage.day}（UTC）；資料來自最後讀取。`} />
    <Text style={styles.count}>{usage.attempts} <Text style={styles.body}>次呼叫嘗試</Text></Text>
    <Text style={styles.meta}>輸入 {usage.inputTokens} · 輸出 {usage.outputTokens} · 快取 {usage.cachedTokens} tokens</Text>
    <Text style={styles.meta}>有 {usage.unknownUsageAttempts} 次用量未能確認。</Text>
  </SectionCard>;
}

export function ModelSettingsView({ model, actions: sourceActions, active = true }: { model: ModelSettingsViewModel; actions: ModelSettingsActions; active?: boolean }) {
  const containerLayout = useContainerWidth();
  const width = containerLayout.width;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const formId = useId();
  const snapshot = model.snapshot, settings = snapshot?.settings ?? empty;
  const motionSerial = useRef(0);
  const [readIntent, setReadIntent] = useState<{ serial: number; scopeKey: string } | null>(null);
  const [saveIntent, setSaveIntent] = useState<{ serial: number; scopeKey: string; baseVersion: number } | null>(null);
  const metadata = { version: settings.version, mode: settings.mode };
  const readEligible = active && model.online && model.authorized && !!snapshot && !model.busy && !model.needsRead && model.operation !== "unknown" && model.operation !== "failed";
  const readTrigger = readIntent && readIntent.scopeKey === model.scopeKey && active && model.online && model.authorized && (model.busy === "read" || readEligible) ? readIntent.serial : null;
  const saved = active && model.online && model.authorized && !model.busy && !model.needsRead && model.operation === "saved"
    && saveIntent !== null && saveIntent.scopeKey === model.scopeKey && settings.version > saveIntent.baseVersion;
  const actions: ModelSettingsActions = {
    ...sourceActions,
    refresh() {
      setSaveIntent(null); setReadIntent({ serial: ++motionSerial.current, scopeKey: model.scopeKey });
      sourceActions.refresh();
    },
    save(command) {
      setReadIntent(null); setSaveIntent({ serial: ++motionSerial.current, scopeKey: model.scopeKey, baseVersion: settings.version });
      sourceActions.save(command);
    },
  };
  const { control, reset, setValue, setFocus, watch, handleSubmit, formState: { errors, isDirty } } = useForm<ModelSettingsDraft>({
    resolver: zodResolver(modelSettingsSchema(settings.keyConfigured)), defaultValues: modelSettingsDraft(settings), mode: "onChange", shouldFocusError: false,
  });
  usePreviewLeaveGuard(isDirty, false, "account");
  const mode = watch("mode"), keyText = watch("keyText"), consent = watch("consent");
  const fieldId = (name: keyof ModelSettingsDraft) => `${formId}-${name}`;
  const visibleFields = formFields.filter(item => item.name === "mode" || mode === "personal");
  const errorEntries = visibleFields.flatMap(item => {
    const message = errors[item.name]?.message;
    return message ? [{ field: item.name, label: item.label, message }] : [];
  });
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
  useEffect(() => { if (!active) { setValue("keyText", ""); setValue("consent", false); setDeleteOpen(false); setDeleteConfirmed(false); } }, [active, setValue]);
  const submit = handleSubmit(draft => {
    if (!canSave) return;
    const command = modelCommandFromDraft(draft, settings);
    clearSecret(); actions.save(command);
  }, invalidFields => {
    const first = visibleFields.find(item => invalidFields[item.name]?.message);
    if (first) setFocus(first.name);
  });
  function changeMode(value: ModelMode) {
    clearSecret(); setValue("mode", value, { shouldDirty: true });
    if (value !== "personal") setValue("backgroundEnabled", false);
  }
  const narrow = width < 820;
  const statusMessage = model.notice || (model.busy === "read" ? "正在讀取模型設定…" : model.busy === "check" ? "正在讀取已保存密鑰的模型資料…"
    : model.busy === "save" ? "正在保存模型設定…" : !model.authorized ? "本人身份或權限已改變，請重新登入。"
      : !model.online ? "目前離線，密鑰輸入已清除；恢復連線後先重讀設定。" : snapshot ? "模型設定已讀取；密鑰不會讀回。" : "");
  return <View testID="model-settings-view" ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={styles.root}>
    <StatusAnnouncement eventKey={String(model.online)} message={active ? model.online ? "已恢復連線，請先重新讀取模型設定及版本。" : "目前離線，密鑰輸入已清除；恢復連線後先重讀設定。" : ""} />
    <StatusAnnouncement eventKey={String(model.authorized)} message={active && !model.authorized ? "本人身份或權限已改變，輸入及模型資料已清除。請重新登入。" : ""} urgent={!model.authorized} />
    <StatusAnnouncement eventKey={`${model.busy ?? "none"}:${model.operation}:${model.notice}:${model.keyCheck?.status ?? "none"}`}
      message={active && model.online && model.authorized ? statusMessage : ""} urgent={!model.busy && (model.operation === "failed" || model.keyCheck?.status === "unavailable")} />
    <SectionCard><SectionHeader density="compact" title="本人模型設定" subtitle={`適用於${model.accountName} · ${model.serverLabel}；切換孩子會沿用本人的設定。`} />
      <View style={styles.statusRow}>{model.busy && (snapshot || model.busy !== "read") ? <ActivityIndicator size={20} /> : null}
        {model.operation !== "none" ? <OperationPill state={model.operation} /> : null}
        {!snapshot && model.busy === "read" ? <ReadStateNotice state="loading" message="正在讀取模型設定…" />
          : <Text style={[styles.body, model.operation === "unknown" && styles.warning]}>{model.notice || (model.busy ? "正在讀取模型設定…" : "選擇平台服務、自己的密鑰，或停用 AI。")}</Text>}
      </View>
      {!model.online ? <Text style={styles.warning}>目前離線，密鑰輸入已清除；恢復連線後先重讀設定。</Text> : null}
      {!model.authorized ? <Text style={styles.error}>本人身份或權限已改變，請重新登入。</Text> : null}
      <AppButton label="重新讀取模型設定" variant="secondary" disabled={!model.online || !model.authorized || !!model.busy} onPress={actions.refresh} />
    </SectionCard>
    {snapshot && model.authorized ? <View style={[styles.columns, narrow && styles.stacked]}>
      <View style={[styles.column, narrow && styles.fullColumn]}>
        <SectionCard><MotionFeedback active={saved} triggerKey={saved ? saveIntent?.serial ?? null : null} scopeKey={model.scopeKey} testID="model-settings-feedback">
          <MotionReveal value={metadata} contentKey={JSON.stringify([metadata.version, metadata.mode])} scopeKey={model.scopeKey} regionKey="model-settings-metadata" triggerKey={readTrigger} eligible={readEligible}>
            {shown => <SectionHeader density="compact" title="使用方式" subtitle={`最後讀到的版本：${shown.version} · ${modeLabels[shown.mode]}`} />}
          </MotionReveal></MotionFeedback>
          <FormErrorSummary entries={errorEntries} onFocus={name => {
            const target = visibleFields.find(item => item.name === name);
            if (target) setFocus(target.name);
          }} />
          <Text style={styles.meta}>{isDirty ? "編輯草稿 · 尚未保存。" : "下方選項在確認保存前屬草稿。"}</Text>
          <Controller control={control} name="mode" render={({ field, fieldState }) => <View>
            <AppSelect ref={field.ref} id={fieldId("mode")} label="模型模式" value={field.value} disabled={locked} onBlur={field.onBlur}
              invalid={!!fieldState.error} describedBy={fieldState.error ? `${fieldId("mode")}-message` : undefined} options={Object.entries(modeLabels).map(([value, label]) => ({ value: value as ModelMode, label }))} onChange={changeMode} />
            <FormFieldMessage id={`${fieldId("mode")}-message`} error={fieldState.error?.message} />
          </View>} />
          {!snapshot.enabled ? <Text style={styles.warning}>AI 總開關目前停用。你仍可管理或刪除本人密鑰。</Text> : null}
          {!available ? <Text style={styles.warning}>所選服務目前不可用；你仍可選擇停用或刪除密鑰。</Text> : null}
          <Text style={styles.meta}>模型：{settings.model}</Text>
          <AppStatusBadge label={settings.keyConfigured ? "個人密鑰已保存" : "尚未保存個人密鑰"} tone={settings.keyConfigured ? "success" : "neutral"} /><Text style={styles.meta}>密鑰原文不會顯示。</Text>
          {mode === "personal" ? <View style={styles.group}>
            <Controller control={control} name="keyText" render={({ field }) => <AppTextField label={settings.keyConfigured ? "替換 API 密鑰" : "個人 API 密鑰"}
              accessibilityLabel="個人 API 密鑰" testID="model-api-key" secureTextEntry autoComplete="off" textContentType="none" autoCapitalize="none" autoCorrect={false}
              importantForAutofill="no" nativeID={fieldId("keyText")} aria-invalid={!!errors.keyText} aria-describedby={`${fieldId("keyText")}-message`} maxLength={512} value={model.online && model.authorized ? field.value : ""} onChangeText={field.onChange} onBlur={field.onBlur} ref={field.ref} disabled={locked || !available} error={!!errors.keyText} />} />
            <FormFieldMessage id={`${fieldId("keyText")}-message`} error={errors.keyText?.message}
              help={`${settings.keyConfigured ? "留空會保留已保存密鑰。" : ""}密鑰只在確認保存時送出；送出或失敗後會清空，原密鑰不會讀回。`} />
            <Text style={styles.body}>保存時，密鑰會送到目前連接的育有方 Server（{model.serverLabel}）並加密儲存，只供你授權的 Google AI 呼叫使用；密鑰原文不會讀回。</Text>
            <Controller control={control} name="consent" render={({ field }) => <AppCheckbox ref={field.ref} id={fieldId("consent")} invalid={!!errors.consent} describedBy={errors.consent ? `${fieldId("consent")}-message` : undefined} onBlur={field.onBlur} checked={field.value} onChange={value => setValue("consent", value, { shouldValidate: true })} disabled={locked || !available}
              label="我同意個人服務的費用及資料外送" description="使用你自己的 Google AI 服務；必要對話與資料會送到供應商，費用按其帳戶計算。" />} />
            <FormFieldMessage id={`${fieldId("consent")}-message`} error={errors.consent?.message} />
            <Controller control={control} name="backgroundEnabled" render={({ field }) => <AppCheckbox checked={field.value} onChange={field.onChange} disabled={locked || !available}
              label="另行允許背景任務使用此密鑰" description="背景處理亦會使用供應商服務及計入用量；不會因加入密鑰而自動啟用。" />} />
            <View style={styles.limitFields}><Text accessibilityRole="header" style={styles.groupTitle}>個人呼叫上限</Text>{([
              ["dailyText", "個人每日呼叫上限", personalLimits.daily], ["modelCallsText", "每次 Agent 生成上限", personalLimits.modelCalls], ["queryEmbeddingsText", "每次查詢向量上限", personalLimits.queryEmbeddings],
            ] as const).map(([name, label, range]) => <View key={name} style={styles.limitField}>
              <Controller control={control} name={name} render={({ field }) => <AppTextField accessibilityLabel={label} label={name === "dailyText" ? "每日呼叫上限" : name === "modelCallsText" ? "每次生成上限" : "查詢向量上限"} keyboardType="number-pad" inputMode="numeric"
                nativeID={fieldId(name)} aria-invalid={!!errors[name]} aria-describedby={`${fieldId(name)}-message`} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} ref={field.ref} disabled={locked || !available} error={!!errors[name]} />} />
              <FormFieldMessage id={`${fieldId(name)}-message`} error={errors[name]?.message} help={`${range.min}–${range.max} 次 · 整數`} />
            </View>)}</View>
          </View> : <Text style={styles.meta}>{mode === "platform" ? "平台沿用既定配額，每次 Agent 最多生成 4 次、查詢向量 2 次。" : "保存停用後不會自行切回平台；已有密鑰會保留，刪除須另行確認。"}</Text>}
          <View style={[styles.actions, styles.group]}><AppButton label="保存模型設定" disabled={!canSave} loading={model.busy === "save"} onPress={() => void submit()} />
            <AppButton label="刪除個人密鑰" variant="danger-secondary" disabled={locked || !settings.keyConfigured} onPress={() => { clearSecret(); setDeleteConfirmed(false); setDeleteOpen(true); }} />
          </View>
        </SectionCard>
        {settings.keyConfigured ? <SectionCard><SectionHeader density="compact" title="已保存密鑰的模型資料" subtitle="此檢查只讀取供應商模型資料，不使用未保存的輸入。" />
          <AppStatusBadge label={model.keyCheck?.version === settings.version ? model.keyCheck.status === "accessible" ? "模型資料可讀取" : "目前未能讀取模型資料" : "此版本模型資料待查核"} tone={model.keyCheck?.version === settings.version && model.keyCheck.status === "accessible" ? "success" : "warning"} />
          <Text style={styles.meta}>密鑰已保存、模型資料可讀及實際生成／查詢向量可用，須分開核對；這項檢查不能確認帳單或剩餘配額。</Text>
          <AppButton label="檢查已保存密鑰" variant="secondary" loading={model.busy === "check"} disabled={locked || !snapshot.enabled || !snapshot.personalAvailable || settings.mode !== "personal" || !!keyText.trim()}
            onPress={() => actions.check(settings.version)} />
          <Text style={styles.meta}>每帳戶每分鐘最多一次；遇到 429 請稍後手動重試。</Text>
        </SectionCard> : null}
      </View>
      <View style={[styles.column, narrow && styles.fullColumn]}>
        <UsageCard label="平台服務用量" usage={snapshot.usage.platform} /><UsageCard label="個人服務用量" usage={snapshot.usage.personal} />
        <SectionCard><SectionHeader density="compact" title="用量與安全上限" />
          <Text style={styles.body}>已保存的個人每日上限：{settings.dailyLimit} 次</Text>
          <Text style={styles.meta}>全站個人服務安全上限：{snapshot.personalGlobalLimit} 次；個人上限只在個人模式生效。</Text>
          <Text style={styles.meta}>每日 UTC 00:00（香港 08:00）重置。生成及查詢向量的嘗試均計次，metadata 不代表完整供應商帳單。</Text>
          <Text style={styles.meta}>固定上限：工具 8 次 · 每次運行 90 秒 · 每次輸出 1024 tokens。</Text>
          <Text style={styles.meta}>{snapshot.agentInputCharacters === undefined ? "互動上下文上限未提供" : `互動上下文上限：${snapshot.agentInputCharacters} 字元`}</Text>
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
  group: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md, gap: spacing.md },
  groupTitle: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  limitFields: { gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md }, limitField: { gap: spacing.xs },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, flexShrink: 1 },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  count: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.title },
  error: { fontFamily: chineseFont, color: colors.errorInk, ...readingType.tool },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool },
});

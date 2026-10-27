import { AppStatusBadge } from "../AppStatusBadge";
import { SettingsSection as SectionCard } from "../settings/SettingsSection";
import { useContainerWidth } from "../useContainerWidth";
import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";
import { brand } from "../../branding";
import { useEffect, useId, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AppState, StyleSheet, View } from "react-native";
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
import { modelCatalogSelection, modelCommandFromDraft, modelEmbeddingRouteChanged, modelSettingsDraft, modelSettingsSchema, removeModelKeyCommand, modelLimitFields, type ModelSettingsDraft } from "./model-settings-form";

const modelReasonText = (reason: string) => ({ invalid_key: "密鑰無效或沒有存取權限。", region_unavailable: "供應商不支援目前服務地區。",
  model_unavailable: "這份憑證目前不能存取所選模型。", quota_exceeded: "供應商配額或速率已達上限。", timeout: "供應商查核逾時。",
  metadata_unsupported: "此服務暫不支援模型資料查核；不代表模型無法回答。", unavailable: "供應商暫時未能完成查核。" })[reason] ?? "目前未能完成查核。";
const empty: ModelSettings = { version: 0, mode: "disabled", provider: "gemini", model: "gemini-3.1-flash-lite", keyConfigured: false,
  backgroundEnabled: false, dailyLimit: personalLimits.daily.default, maxModelCalls: personalLimits.modelCalls.default, maxQueryEmbeddings: personalLimits.queryEmbeddings.default, updatedAt: null };
const modeLabels: Record<ModelMode, string> = { platform: brand.platformServiceLabel, personal: "我的個人密鑰", disabled: "停用 AI" };
const formFields = [
  { name: "mode", label: "模型模式" }, { name: "keyText", label: "個人 API 密鑰" }, { name: "consent", label: "費用及資料外送同意" },
  { name: "provider", label: "模型服務" }, { name: "baseUrl", label: "API 基底地址" }, { name: "model", label: "聊天模型" },
  { name: "embeddingProvider", label: "向量服務" }, { name: "embeddingProject", label: "GCP 專案" },
  { name: "embeddingLocation", label: "Vertex 地區" }, { name: "embeddingKeyText", label: "向量 API 密鑰" },
  ...modelLimitFields.map(([name, label]) => ({ name, label })),
] as const;
function UsageCard({ label, usage }: { label: string; usage: ModelSettingsUsage }) {
  return <SectionCard><SectionHeader density="compact" title={label} subtitle={`計數日：${usage.day}（UTC）；資料來自最後讀取。`} />
    <Text style={styles.count}>{usage.attempts} <Text style={styles.body}>次呼叫嘗試</Text></Text>
    <Text style={styles.meta}>輸入 {usage.inputTokens} · 輸出 {usage.outputTokens} · 快取 {usage.cachedTokens} tokens</Text>
    <Text style={styles.meta}>有 {usage.unknownUsageAttempts} 次用量未能確認。</Text>
  </SectionCard>;
}

type ModelSettingsViewProps = { model: ModelSettingsViewModel; actions: ModelSettingsActions; active?: boolean };
export function ModelSettingsView(props: ModelSettingsViewProps) {
  return <ModelSettingsForm key={props.model.scopeKey} {...props} />;
}
function ModelSettingsForm({ model, actions: sourceActions, active = true }: ModelSettingsViewProps) {
  const containerLayout = useContainerWidth();
  const width = containerLayout.width;
  const [deleteReview, setDeleteReview] = useState<{ basis: string; settings: ModelSettings } | null>(null);
  const [deleteNotice, setDeleteNotice] = useState("");
  const deleteOpen = !!deleteReview;
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const formId = useId();
  const snapshot = model.snapshot, settings = snapshot?.settings ?? empty;
  const settingsBasis = JSON.stringify(settings), formBasis = JSON.stringify([settings, snapshot?.effective]);
  const deleteCurrent = deleteReview?.basis === settingsBasis;
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
    resolver: zodResolver(modelSettingsSchema(settings.keyConfigured, settings.provider, settings.baseUrl, settings)), defaultValues: modelSettingsDraft(settings, snapshot?.effective), mode: "onChange", shouldFocusError: false,
  });
  usePreviewLeaveGuard(active && (isDirty || deleteOpen), false, "account");
  const setDraftEditing = sourceActions.setDraftEditing;
  useEffect(() => {
    setDraftEditing?.(active && (isDirty || deleteOpen));
    return () => setDraftEditing?.(false);
  }, [active, isDirty, deleteOpen, setDraftEditing]);
  const provider = watch("provider"), selectedModel = watch("model"), baseUrl = watch("baseUrl");
  const embeddingKeyText = watch("embeddingKeyText"), removeEmbeddingKey = watch("removeEmbeddingKey");
  const embeddingProvider = watch("embeddingProvider"), embeddingProject = watch("embeddingProject"), embeddingLocation = watch("embeddingLocation");
  const embeddingRouteChanged = modelEmbeddingRouteChanged({ embeddingProvider, embeddingProject, embeddingLocation }, settings);
  const modelSelection = modelCatalogSelection(model.catalog, provider, selectedModel);
  const selectedCapabilities = modelSelection.capabilities;
  const mode = watch("mode"), keyText = watch("keyText"), consent = watch("consent");
  const fieldId = (name: keyof ModelSettingsDraft) => `${formId}-${name}`;
  const visibleFields = formFields.filter(item => item.name === "mode" || mode === "personal" && (item.name !== "baseUrl" || provider === "openai-compatible")
    && (!["embeddingProject", "embeddingLocation"].includes(item.name) || embeddingProvider === "vertex"));
  const errorEntries = visibleFields.flatMap(item => {
    const message = errors[item.name]?.message;
    return message ? [{ field: item.name, label: item.label, message }] : [];
  });
  const locked = !active || !model.online || !model.authorized || !!model.busy || model.needsRead || !snapshot;
  const available = mode === "personal" ? snapshot?.personalAvailable : mode === "platform" ? snapshot?.platformAvailable : true;
  const canSave = !locked && available && (mode !== "personal" || consent && (settings.keyConfigured || !!keyText.trim()));
  useEffect(() => {
    reset(modelSettingsDraft(settings, snapshot?.effective));
  }, [model.scopeKey, model.formRevision, formBasis, reset]);
  useEffect(() => {
    setValue("keyText", ""); setValue("embeddingKeyText", ""); setValue("removeEmbeddingKey", false); setValue("consent", false);
  }, [model.secretRevision, model.online, model.authorized, setValue]);
  useEffect(() => {
    if (deleteReview && (!deleteCurrent || !snapshot || !model.online || !model.authorized || model.needsRead || model.operation === "unknown")) {
      setDeleteReview(null); setDeleteConfirmed(false);
      setDeleteNotice("設定或存取狀態已改變，刪除確認已失效；請重新核對後再開啟。");
    }
  }, [deleteCurrent, deleteReview, !!snapshot, model.online, model.authorized, model.needsRead, model.operation]);
  function clearSecret() { setValue("keyText", ""); setValue("embeddingKeyText", ""); setValue("removeEmbeddingKey", false); setValue("consent", false); }
  function clearEmbeddingSecret() { setValue("embeddingKeyText", ""); setValue("removeEmbeddingKey", false); setValue("consent", false); }
  useEffect(() => {
    if (!active) {
      reset(modelSettingsDraft(settings, snapshot?.effective));
      setDeleteReview(null); setDeleteConfirmed(false);
    }
  }, [active, formBasis, reset]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state !== "active") { clearSecret(); setDeleteReview(null); setDeleteConfirmed(false); }
    });
    return () => subscription.remove();
  }, [setValue]);
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
    : model.busy === "catalog" ? "正在查核模型目錄…" : model.busy === "save" ? "正在保存模型設定…" : !model.authorized ? "本人身份或權限已改變，請重新登入。"
      : !model.online ? "目前離線，密鑰輸入已清除；恢復連線後先重讀設定。" : snapshot ? "模型設定已讀取；密鑰不會讀回。" : "");
  return <View testID="model-settings-view" ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={styles.root}>
    <StatusAnnouncement eventKey={String(model.online)} message={active ? model.online ? "已恢復連線，請先重新讀取模型設定及版本。" : "目前離線，密鑰輸入已清除；恢復連線後先重讀設定。" : ""} />
    <StatusAnnouncement eventKey={String(model.authorized)} message={active && !model.authorized ? "本人身份或權限已改變，輸入及模型資料已清除。請重新登入。" : ""} urgent={!model.authorized} />
    <StatusAnnouncement eventKey={`${model.busy ?? "none"}:${model.operation}:${model.notice}:${model.keyCheck?.status ?? "none"}`}
      message={active && model.online && model.authorized ? statusMessage : ""} urgent={!model.busy && (model.operation === "failed" || model.keyCheck?.status === "unavailable")} />
    <SectionCard><SectionHeader density="compact" title="本人模型設定" subtitle={`適用於${model.accountName}；切換孩子會沿用本人的設定。`}
      action={!model.originalOperationId && (!snapshot || model.needsRead || model.operation === "failed" || isDirty || deleteOpen) ? <AppButton label="重新讀取" accessibilityLabel="重新讀取模型設定" variant="quiet" density="compact" disabled={!model.online || !model.authorized || !!model.busy} onPress={actions.refresh} /> : undefined} />
      <View style={styles.statusRow}>{model.busy && (snapshot || model.busy !== "read") ? <ActivityIndicator size={20} /> : null}
        {model.operation !== "none" ? <OperationPill state={model.operation} /> : null}
        {!snapshot && model.busy === "read" ? <ReadStateNotice state="loading" message="正在讀取模型設定…" />
          : <Text style={[styles.body, model.operation === "unknown" && styles.warning]}>{model.notice || (model.busy ? statusMessage : "選擇平台服務、自己的密鑰，或停用 AI。")}</Text>}
      </View>
      {!model.online ? <Text style={styles.warning}>目前離線，密鑰輸入已清除；恢復連線後先重讀設定。</Text> : null}
      {!model.authorized ? <Text style={styles.error}>本人身份或權限已改變，請重新登入。</Text> : null}
      {model.originalOperationId ? <AppButton label="查回原操作及目前設定" variant="secondary" disabled={!model.online || !model.authorized || !!model.busy} onPress={actions.refresh} /> : null}
    </SectionCard>
    {snapshot && model.authorized ? <View style={[styles.columns, narrow && styles.stacked]}>
      <View style={[styles.column, narrow && styles.fullColumn]}>
        <SectionCard><MotionFeedback active={saved} triggerKey={saved ? saveIntent?.serial ?? null : null} scopeKey={model.scopeKey} testID="model-settings-feedback">
          <MotionReveal value={metadata} contentKey={JSON.stringify([metadata.version, metadata.mode])} scopeKey={model.scopeKey} regionKey="model-settings-metadata" triggerKey={readTrigger} eligible={readEligible}>
            {shown => <SectionHeader density="compact" title="使用方式" subtitle={`上次讀取：${modeLabels[shown.mode]}`} />}
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
          <Text style={styles.meta}>已保存的個人模型：{settings.model}</Text>
          <AppStatusBadge label={settings.keyConfigured ? "個人密鑰已保存" : "尚未保存個人密鑰"} tone={settings.keyConfigured ? "success" : "neutral"} /><Text style={styles.meta}>密鑰原文不會顯示。</Text>
          {mode === "personal" ? <View style={styles.group}>
            <Controller control={control} name="provider" render={({ field }) => <AppSelect ref={field.ref} id={fieldId("provider")} label="模型服務" value={field.value} disabled={locked}
              options={[{ value: "gemini", label: "Gemini Developer API" }, { value: "vertex", label: "Vertex AI Express API key" }, { value: "openai-compatible", label: "OpenAI 相容服務" }]}
              onChange={value => { clearSecret(); field.onChange(value); actions.selectProvider?.(value); }} onBlur={field.onBlur} />} />
            {provider === "openai-compatible" ? <View>
              <Controller control={control} name="baseUrl" render={({ field }) => <AppTextField ref={field.ref} nativeID={fieldId("baseUrl")}
                label="API 基底地址" accessibilityLabel="API 基底地址" placeholder="https://api.example.com/v1" value={field.value} disabled={locked}
                maxLength={512} autoCapitalize="none" autoCorrect={false} inputMode="url" onBlur={field.onBlur}
                onChangeText={value => { clearSecret(); field.onChange(value); }} error={!!errors.baseUrl}
                aria-invalid={!!errors.baseUrl} aria-describedby={`${fieldId("baseUrl")}-message`} />} />
              <FormFieldMessage id={`${fieldId("baseUrl")}-message`} error={errors.baseUrl?.message}
                help="填寫供應商的公開 HTTPS API 基底地址（含其要求的 /v1 等路徑）；系統會接上 /chat/completions。更換地址須重新輸入聊天密鑰。" />
            </View> : <AppSelect label="模型參考選項" value={selectedModel} disabled={locked} options={modelSelection.options}
              onChange={value => setValue("model", value, { shouldDirty: true, shouldValidate: true })} />}
            <Controller control={control} name="model" render={({ field }) => <AppTextField ref={field.ref} nativeID={fieldId("model")}
              label="聊天模型 ID" accessibilityLabel="聊天模型 ID" value={field.value} disabled={locked} maxLength={128}
              autoCapitalize="none" autoCorrect={false} onChangeText={field.onChange} onBlur={field.onBlur}
              error={!!errors.model} aria-invalid={!!errors.model} aria-describedby={`${fieldId("model")}-message`} />} />
            <FormFieldMessage id={`${fieldId("model")}-message`} error={errors.model?.message} />
            <Text style={styles.meta}>直接輸入所選供應商的模型 ID 即可保存及試用，不需先通過模型目錄查核。服務或模型不接受某項請求時，助手會顯示相關錯誤，不會自動替換模型。</Text>
            {provider === "vertex" ? <Text style={styles.meta}>此處使用 Vertex AI Express API key，不接受服務帳戶 JSON。知識搜尋可另選下方的向量服務並填寫本人密鑰。</Text> : null}
            {!model.catalog && !model.busy && provider !== "openai-compatible" ? <Text style={styles.meta}>模型目錄暫未讀取，仍可直接輸入模型 ID。</Text> : null}
            {selectedCapabilities && Object.values(selectedCapabilities).some(Boolean)
              ? <Text style={styles.meta}>模型能力資料：{Object.entries(selectedCapabilities).filter(([, enabled]) => enabled).map(([key]) => ({ tools: "工具", image: "圖片", audio: "音訊", textStreaming: "文字串流" })[key]).join("、")}。即使模型支援文字串流，回覆也不一定會逐字顯示。</Text>
              : <Text style={styles.meta}>此型號的能力資料未提供，不代表不能使用。助手執行操作需要工具呼叫能力；照片與錄音亦需模型支援相應輸入。</Text>}
            <Controller control={control} name="keyText" render={({ field }) => <AppTextField label={settings.keyConfigured ? "替換 API 密鑰" : "個人 API 密鑰"}
              accessibilityLabel="個人 API 密鑰" testID="model-api-key" secureTextEntry autoComplete="off" textContentType="none" autoCapitalize="none" autoCorrect={false}
              importantForAutofill="no" nativeID={fieldId("keyText")} aria-invalid={!!errors.keyText} aria-describedby={`${fieldId("keyText")}-message`} maxLength={512} value={active && model.online && model.authorized ? field.value : ""} onChangeText={field.onChange} onBlur={field.onBlur} ref={field.ref} disabled={locked || !available} error={!!errors.keyText} />} />
            <FormFieldMessage id={`${fieldId("keyText")}-message`} error={errors.keyText?.message}
              help={`${settings.keyConfigured && provider === settings.provider && (provider !== "openai-compatible" || baseUrl.replace(/\/+$/u, "") === settings.baseUrl) ? "留空會保留已保存聊天密鑰。" : "請輸入所選服務及地址對應的聊天密鑰。"}密鑰只在保存時送出；送出、失敗或離開頁面後清空，不會讀回。`} />
            <View style={styles.group}>
              <Text accessibilityRole="header" style={styles.groupTitle}>知識搜尋用向量服務（可選）</Text>
              <Text style={styles.meta}>知識搜尋使用 Google 的 gemini-embedding-001（1024 維）。未配置時仍可試用聊天，需向量的搜尋會顯示缺少配置，不會借用平台額度。</Text>
              <Controller control={control} name="embeddingProvider" render={({ field, fieldState }) => <AppSelect ref={field.ref} id={fieldId("embeddingProvider")}
                label="向量服務" value={field.value} disabled={locked || !available} onBlur={field.onBlur}
                invalid={!!fieldState.error} describedBy={fieldState.error ? `${fieldId("embeddingProvider")}-message` : undefined}
                options={[{ value: "gemini", label: "Gemini Developer API" }, { value: "vertex", label: "Vertex AI" }]}
                onChange={value => { if (value !== field.value) clearEmbeddingSecret(); field.onChange(value); }} />} />
              <FormFieldMessage id={`${fieldId("embeddingProvider")}-message`} error={errors.embeddingProvider?.message} />
              {embeddingProvider === "vertex" ? <>
                <Text style={styles.meta}>Vertex 向量服務使用本人的獨立 API key、GCP 專案及地區，不會沿用聊天密鑰。請確認該專案已啟用所需服務及付款。</Text>
                <Controller control={control} name="embeddingProject" render={({ field }) => <AppTextField ref={field.ref} nativeID={fieldId("embeddingProject")}
                  label="GCP 專案 ID 或編號" accessibilityLabel="GCP 專案 ID 或編號" value={field.value} disabled={locked || !available}
                  maxLength={30} autoComplete="off" autoCapitalize="none" autoCorrect={false} onBlur={field.onBlur}
                  onChangeText={value => { if (value !== field.value) clearEmbeddingSecret(); field.onChange(value); }} error={!!errors.embeddingProject}
                  aria-invalid={!!errors.embeddingProject} aria-describedby={`${fieldId("embeddingProject")}-message`} />} />
                <FormFieldMessage id={`${fieldId("embeddingProject")}-message`} error={errors.embeddingProject?.message} help="填寫這份向量密鑰所屬的本人 GCP 專案。" />
                <Controller control={control} name="embeddingLocation" render={({ field }) => <AppTextField ref={field.ref} nativeID={fieldId("embeddingLocation")}
                  label="Vertex 地區" accessibilityLabel="Vertex 地區" placeholder="例如 asia-east1 或 global" value={field.value} disabled={locked || !available}
                  maxLength={63} autoComplete="off" autoCapitalize="none" autoCorrect={false} onBlur={field.onBlur}
                  onChangeText={value => { if (value !== field.value) clearEmbeddingSecret(); field.onChange(value); }} error={!!errors.embeddingLocation}
                  aria-invalid={!!errors.embeddingLocation} aria-describedby={`${fieldId("embeddingLocation")}-message`} />} />
                <FormFieldMessage id={`${fieldId("embeddingLocation")}-message`} error={errors.embeddingLocation?.message} help="填寫提供所選向量模型的 Vertex 地區。" />
              </> : <Text style={styles.meta}>Gemini 聊天可沿用同一密鑰；使用其他聊天服務時，可另填本人 Gemini API key。</Text>}
              <AppStatusBadge label={embeddingRouteChanged ? "向量服務已更改，須重新填寫密鑰" : settings.embeddingKeyConfigured ? "已保存獨立向量密鑰" : "沒有獨立向量密鑰"}
                tone={embeddingRouteChanged ? "warning" : settings.embeddingKeyConfigured ? "success" : "neutral"} />
              <Controller control={control} name="embeddingKeyText" render={({ field }) => <AppTextField ref={field.ref} nativeID={fieldId("embeddingKeyText")}
                label={`${settings.embeddingKeyConfigured && !embeddingRouteChanged ? "替換 " : ""}${embeddingProvider === "vertex" ? "Vertex" : "Gemini"} 向量密鑰`}
                accessibilityLabel={`${embeddingProvider === "vertex" ? "Vertex" : "Gemini"} 向量密鑰`} testID="model-embedding-api-key"
                secureTextEntry autoComplete="off" textContentType="none" autoCapitalize="none" autoCorrect={false} importantForAutofill="no"
                maxLength={512} value={active && model.online && model.authorized ? field.value : ""} onChangeText={field.onChange} onBlur={field.onBlur}
                disabled={locked || !available || removeEmbeddingKey} error={!!errors.embeddingKeyText}
                aria-invalid={!!errors.embeddingKeyText} aria-describedby={`${fieldId("embeddingKeyText")}-message`} />} />
              <FormFieldMessage id={`${fieldId("embeddingKeyText")}-message`} error={errors.embeddingKeyText?.message}
                help={embeddingRouteChanged ? "更換向量服務、專案或地區後，請重新輸入相應密鑰，或明確選擇刪除。" : embeddingProvider === "vertex" && !settings.embeddingKeyConfigured
                  ? "請輸入此專案及地區的本人獨立向量密鑰；不會沿用聊天密鑰。" : "留空保留已保存向量密鑰；密鑰原文不會讀回。"} />
              {settings.embeddingKeyConfigured ? <Controller control={control} name="removeEmbeddingKey" render={({ field }) => <AppCheckbox
                label="保存時刪除獨立向量密鑰" checked={field.value} disabled={locked || !available}
                onChange={value => { setValue("embeddingKeyText", ""); field.onChange(value); }}
                description={embeddingProvider === "gemini" && provider === "gemini" ? "刪除後，知識搜尋會沿用本人的 Gemini 聊天密鑰。" : "刪除後，需要向量的知識搜尋將無法使用；不會改用平台。"} />} /> : null}
            </View>
            <Text style={styles.body}>保存時，密鑰會送到目前連接的{brand.name}服務（{model.serverLabel}）並加密儲存，只用於你授權的所選模型及向量服務；密鑰原文不會讀回。</Text>
            <Controller control={control} name="consent" render={({ field }) => <AppCheckbox ref={field.ref} id={fieldId("consent")} invalid={!!errors.consent} describedBy={errors.consent ? `${fieldId("consent")}-message` : undefined} onBlur={field.onBlur} checked={field.value} onChange={value => setValue("consent", value, { shouldValidate: true })} disabled={locked || !available}
              label="我同意個人服務的費用及資料外送" description={`必要對話、孩子資料及附件會送到${provider === "openai-compatible" ? "你填寫的 API 服務" : "所選 Google 服務"}；啟用知識搜尋時，必要搜尋文字亦會送到 Google 向量服務。費用按各服務帳戶計算。`} />} />
            <FormFieldMessage id={`${fieldId("consent")}-message`} error={errors.consent?.message} />
            <Controller control={control} name="backgroundEnabled" render={({ field }) => <AppCheckbox checked={field.value} onChange={field.onChange} disabled={locked || !available}
              label="另行允許背景任務使用此密鑰" description="背景處理亦會使用供應商服務及計入用量；不會因加入密鑰而自動啟用。" />} />
            <View style={styles.limitFields}><Text accessibilityRole="header" style={styles.groupTitle}>個人呼叫上限</Text>{modelLimitFields.map(([name, label, range, unit]) => <View key={name} style={styles.limitField}>
              <Controller control={control} name={name} render={({ field }) => <AppTextField accessibilityLabel={label} label={label} keyboardType="number-pad" inputMode="numeric"
                nativeID={fieldId(name)} aria-invalid={!!errors[name]} aria-describedby={`${fieldId(name)}-message`} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} ref={field.ref} disabled={locked || !available} error={!!errors[name]} />} />
              <FormFieldMessage id={`${fieldId(name)}-message`} error={errors[name]?.message} help={`${range.min}–${range.max} ${unit} · 整數`} />
            </View>)}</View>
            <Text style={styles.meta}>保存後按本人設定及管理員共用保護計算。模型按需要使用預算，不必用盡；重試亦計入原運行及每日次數。</Text>
          </View> : <Text style={styles.meta}>{mode === "platform" ? "平台模型及限額由管理員統一設定，實際值見「用量與安全上限」。" : "保存停用後不會自行切回平台；已有密鑰會保留，刪除須另行確認。"}</Text>}
          <View style={[styles.actions, styles.group]}><AppButton label="保存模型設定" disabled={!canSave} loading={model.busy === "save"} onPress={() => void submit()} />
            <AppButton label="刪除個人密鑰" variant="danger-secondary" disabled={locked || !settings.keyConfigured && !settings.embeddingKeyConfigured} onPress={() => { clearSecret(); setDeleteConfirmed(false); setDeleteNotice(""); setDeleteReview({ basis: settingsBasis, settings: { ...settings } }); }} />
          </View>
        </SectionCard>
        {settings.keyConfigured ? <SectionCard><SectionHeader density="compact" title="已保存密鑰的模型資料" subtitle="查核是可選操作，不是使用模型的前置條件。" />
          {settings.provider !== "gemini" ? <Text style={styles.meta}>此接入方式不另查模型目錄；可直接到助手試用已保存的模型。是否可用及具體錯誤，以該次實際請求為準。</Text> : <>
          <AppStatusBadge label={model.keyCheck?.version === settings.version ? model.keyCheck.status === "accessible" ? "模型資料可讀取" : "目前未能讀取模型資料" : "此版本模型資料待查核"} tone={model.keyCheck?.version === settings.version && model.keyCheck.status === "accessible" ? "success" : "warning"} />
          <Text style={styles.meta}>密鑰已保存、模型資料可讀及實際生成／查詢向量可用，須分開核對；這項檢查不能確認帳單或剩餘配額。</Text>
          <AppButton label="檢查已保存密鑰" variant="secondary" loading={model.busy === "check"} disabled={locked || !snapshot.enabled || !snapshot.personalAvailable || settings.mode !== "personal" || provider !== settings.provider || !!keyText.trim() || !!embeddingKeyText || removeEmbeddingKey || embeddingRouteChanged}
            onPress={() => actions.check(settings.version)} />
          {model.keyCheck?.reason ? <Text style={styles.warning}>{modelReasonText(model.keyCheck.reason)}</Text> : null}
          {actions.refreshCatalog ? <AppButton label="查核已保存密鑰的模型目錄" variant="quiet" disabled={locked || !snapshot.enabled || !snapshot.personalAvailable || provider !== settings.provider || !!keyText.trim() || !!embeddingKeyText || removeEmbeddingKey || embeddingRouteChanged}
            loading={model.busy === "catalog"} onPress={() => actions.refreshCatalog?.(settings.version)} /> : null}
          {model.catalog?.reason ? <Text style={styles.warning}>{modelReasonText(model.catalog.reason)}</Text> : null}
          {model.catalog?.truncated ? <Text style={styles.meta}>供應商目錄只讀取了有界部分；未列出不代表模型不存在。</Text> : null}
          <Text style={styles.meta}>查核與目錄共用每帳戶每分鐘一次限制，不呼叫生成；遇到 429 請稍後手動重試。</Text></>}
        </SectionCard> : null}
      </View>
      <View style={[styles.column, narrow && styles.fullColumn]}>
        <UsageCard label="平台服務用量" usage={snapshot.usage.platform} /><UsageCard label="個人服務用量" usage={snapshot.usage.personal} />
        <SectionCard><SectionHeader density="compact" title="用量與安全上限" />
          <Text style={styles.body}>已保存的個人每日上限：{settings.dailyLimit} 次</Text>
          <Text style={styles.meta}>全站個人服務安全上限：{snapshot.personalGlobalLimit} 次；個人上限只在個人模式生效。</Text>
          <Text style={styles.meta}>每日 UTC 00:00（香港 08:00）重置。生成及查詢向量的嘗試均計次；此處用量不代表供應商的完整帳單。</Text>
          {snapshot.effective ? <View style={styles.group}>
            <Text style={styles.body}>目前生效上限</Text>
            <Text style={styles.meta}>每日本人 {snapshot.effective.dailyLimit}／共用 {snapshot.effective.dailyGlobalLimit} 次</Text>
            <Text style={styles.meta}>每輪生成 {snapshot.effective.maxModelCalls}／工具 {snapshot.effective.maxToolCalls}／查詢向量 {snapshot.effective.maxQueryEmbeddings} 次</Text>
            <Text style={styles.meta}>整輪 {snapshot.effective.maxRunSeconds} 秒 · 單次模型 {snapshot.effective.modelRequestSeconds} 秒 · 最多額外重試 {snapshot.effective.maxModelRetries} 次</Text>
            <Text style={styles.meta}>{snapshot.effective.cappedByAdministrator.length ? "部分個人設定高於管理員保護上限，實際按上述較低值執行。" : "目前設定未被較低的管理員上限調低。"} 一般修改於新運行生效；保存不會清零用量。</Text>
          </View> : <Text style={styles.meta}>目前連接的服務尚未提供實際生效上限；如需確認，請聯絡服務管理員。</Text>}
          <Text style={styles.meta}>{snapshot.agentInputCharacters === undefined ? "互動上下文上限未提供" : `互動上下文上限：${snapshot.agentInputCharacters} 字元`}</Text>
          <Text style={styles.meta}>連接服務：{model.serverLabel}</Text>
          <Text style={styles.meta}>停用或刪除不會撤回供應商已接受的呼叫。</Text>
        </SectionCard>
      </View>
    </View> : null}
    {deleteNotice ? <Text accessibilityLiveRegion="polite" style={styles.warning}>{deleteNotice}</Text> : null}
    <Dialog danger visible={deleteOpen} onDismiss={() => setDeleteReview(null)}>
      <Dialog.Title danger>刪除個人密鑰並停用 AI</Dialog.Title><Dialog.Content>
        <Text style={styles.body}>將刪除已核對版本 {deleteReview?.settings.version} 的聊天及獨立向量密鑰，並停用 AI。使用平台服務須另行選擇及保存。</Text>
        <AppCheckbox label="我確認刪除密鑰並停用 AI" checked={deleteConfirmed} onChange={setDeleteConfirmed} disabled={locked || !deleteCurrent} />
      </Dialog.Content><Dialog.Actions><AppButton label="取消" variant="quiet" onPress={() => setDeleteReview(null)} />
        <AppButton label="確認刪除並停用" variant="danger" disabled={locked || !deleteCurrent || !deleteConfirmed} onPress={() => { if (locked || !deleteCurrent || !deleteConfirmed || !deleteReview) return; clearSecret(); setDeleteReview(null); actions.save(removeModelKeyCommand(deleteReview.settings)); }} />
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  PERSONAL_DAILY_LIMIT, PERSONAL_MODEL, PERSONAL_RUN_LIMITS,
  type ModelMode, type ModelSettings, type ModelSettingsView, type ModelSettingsUsage,
} from "../shared/model-settings.ts";
import { createModelSettingsApi, ModelSettingsApiError } from "./model-settings-api.ts";

interface Props { userId: string; online: boolean; apiBaseUrl: string }
const modeLabels: Record<ModelMode, string> = { platform: "使用平台模型", personal: "使用個人密鑰", disabled: "停用 AI" };
function Action({ label, disabled = false, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
function Confirmation({ label, checked, disabled, onToggle }: { label: string; checked: boolean; disabled: boolean; onToggle: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }}
    disabled={disabled} onPress={onToggle} style={[styles.group, disabled && styles.disabled]}
    {...(Platform.OS === "web" ? {
      "aria-checked": checked,
      onKeyDown: (event: { key?: string; nativeEvent?: { key?: string }; preventDefault: () => void }) => {
        if ((event.nativeEvent?.key ?? event.key) === " ") { event.preventDefault(); if (!disabled) onToggle(); }
      },
    } : {})}><Text style={styles.body}>{checked ? "☑" : "☐"} {label}</Text></Pressable>;
}
function Usage({ label, usage }: { label: string; usage: ModelSettingsUsage }) {
  return <View style={styles.group}>
    <Text style={styles.body}>{label}（{usage.day}）：{usage.attempts} 次呼叫嘗試</Text>
    <Text style={styles.hint}>輸入 {usage.inputTokens}／輸出 {usage.outputTokens}／快取 {usage.cachedTokens} tokens；{usage.unknownUsageAttempts} 次用量未能確認。</Text>
  </View>;
}

export function ModelSettingsPanel(props: Props) {
  return <ModelSettingsWorkspace key={JSON.stringify([props.apiBaseUrl, props.userId])} {...props} />;
}

function ModelSettingsWorkspace({ userId, online, apiBaseUrl }: Props) {
  const api = useMemo(() => createModelSettingsApi(apiBaseUrl), [apiBaseUrl]);
  const [view, setView] = useState<ModelSettingsView | null>(null);
  const [mode, setMode] = useState<ModelMode>("platform");
  const [keyText, setKeyText] = useState("");
  const [dailyText, setDailyText] = useState(String(PERSONAL_DAILY_LIMIT.default));
  const [modelCallsText, setModelCallsText] = useState(String(PERSONAL_RUN_LIMITS.modelCalls.default));
  const [queryEmbeddingsText, setQueryEmbeddingsText] = useState(String(PERSONAL_RUN_LIMITS.queryEmbeddings.default));
  const [backgroundEnabled, setBackgroundEnabled] = useState(false);
  const [consent, setConsent] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const [authorized, setAuthorized] = useState(true);
  const [needsRead, setNeedsRead] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const requests = useRef(new Set<AbortController>());
  const inFlight = useRef(false);
  const needsReadRef = useRef(false);
  const available = online && authorized && !!userId;
  const availableRef = useRef(available); availableRef.current = available;
  const refreshRef = useRef<() => void>(() => {});

  const requireRead = (value: boolean) => { needsReadRef.current = value; setNeedsRead(value); };
  const applySettings = (settings: ModelSettings) => {
    setMode(settings.mode); setDailyText(String(settings.dailyLimit));
    setModelCallsText(String(settings.maxModelCalls)); setQueryEmbeddingsText(String(settings.maxQueryEmbeddings));
    setBackgroundEnabled(settings.mode === "personal" && settings.backgroundEnabled);
    setKeyText(""); setConsent(false); setDeleteConfirmation(false);
  };
  const cancelRequests = useCallback(() => {
    generation.current++;
    for (const request of requests.current) request.abort();
    requests.current.clear(); inFlight.current = false; setBusy("");
  }, []);
  const clearIdentity = () => {
    cancelRequests(); setAuthorized(false); setView(null); setKeyText("");
    setConsent(false); setBackgroundEnabled(false); setDeleteConfirmation(false);
    setMode("platform"); setDailyText(String(PERSONAL_DAILY_LIMIT.default));
    setModelCallsText(String(PERSONAL_RUN_LIMITS.modelCalls.default));
    setQueryEmbeddingsText(String(PERSONAL_RUN_LIMITS.queryEmbeddings.default));
    requireRead(false);
    setNotice("登入帳號或權限已改變，模型設定及輸入已清除。請重新登入。");
  };
  const start = (label: string) => {
    if (!availableRef.current || inFlight.current) return null;
    inFlight.current = true;
    const started = generation.current;
    const controller = new AbortController(); requests.current.add(controller);
    setBusy(label); setNotice("");
    return {
      signal: controller.signal,
      current: () => availableRef.current && generation.current === started && !controller.signal.aborted,
      finish: () => {
        requests.current.delete(controller);
        if (generation.current === started) { inFlight.current = false; setBusy(""); }
      },
    };
  };
  const fail = (error: unknown, saving = false) => {
    setKeyText(""); setConsent(false); setDeleteConfirmation(false);
    const failure = error instanceof ModelSettingsApiError ? error : new ModelSettingsApiError();
    if (failure.status === 401 || failure.status === 403) { clearIdentity(); return; }
    if (saving && failure.unknownResult) {
      requireRead(true);
      setNotice("保存結果未知。密鑰輸入已清除，系統不會自動重送。請先重新讀取目前設定及版本，核對後才重新提交。");
      return;
    }
    if (failure.code === "version_conflict" || failure.status === 409) {
      requireRead(true); setNotice("設定版本已改變，請先重新讀取並核對目前設定，再確認操作。"); return;
    }
    if (saving) requireRead(false);
    setNotice(failure.code === "key_required" ? "請輸入個人密鑰後再確認保存。"
      : failure.code === "consent_required" ? "請明確確認個人密鑰的處理及收費安排。"
      : failure.code === "invalid_input" ? "設定未被接納，請核對每日及每次 Agent 上限與選項。"
      : failure.code === "unavailable" || failure.status === 503 ? "模型服務目前不可用，請稍後重新讀取設定。"
      : saving ? "設定未被接納，密鑰輸入已清除，請核對後再確認。"
      : "模型設定或存取檢查未能讀取，請手動重試。");
  };

  const refresh = () => {
    const request = start("讀取"); if (!request) return;
    const reviewing = needsReadRef.current;
    void api.read(request.signal, userId).then(next => {
      if (!request.current()) return;
      setView(next); applySettings(next.settings); requireRead(false);
      if (reviewing) setNotice("目前設定及版本已讀取。請核對下方狀態；如仍需更改，重新輸入密鑰並明確確認保存。");
    }).catch(error => { if (request.current()) fail(error); }).finally(request.finish);
  };
  refreshRef.current = refresh;

  useEffect(() => () => {
    generation.current++;
    for (const request of requests.current) request.abort();
    requests.current.clear(); inFlight.current = false;
  }, []);
  useEffect(() => {
    cancelRequests(); setKeyText(""); setConsent(false); setDeleteConfirmation(false);
    if (available && !needsReadRef.current) refreshRef.current();
    else if (needsReadRef.current) setNotice("提交結果需要核對。請回復連線後，手動重新讀取目前設定及版本。");
    else setNotice("");
  }, [available, cancelRequests]);

  const save = (removeKey = false) => {
    if (!view || needsReadRef.current || !availableRef.current || inFlight.current) return;
    const dailyLimit = Number(dailyText);
    if (!removeKey && mode === "personal" && (!consent || !validDaily || !validModelCalls || !validQueryEmbeddings || !view.personalAvailable
      || !keyText.trim() && !view.settings.keyConfigured)) return;
    if (!removeKey && mode === "platform" && !view.platformAvailable) return;
    if (removeKey && (!deleteConfirmation || !view.settings.keyConfigured)) return;
    const request = start(removeKey ? "刪除" : "保存"); if (!request) return;
    setKeyText(""); setConsent(false); setDeleteConfirmation(false); requireRead(true);
    // The entered key lives only in the direct request after submission; no retry payload is kept.
    const saving = api.save({
      expectedVersion: view.settings.version, mode: removeKey ? "disabled" : mode,
      backgroundEnabled: !removeKey && mode === "personal" && backgroundEnabled,
      dailyLimit: removeKey || mode !== "personal" ? view.settings.dailyLimit : dailyLimit,
      maxModelCalls: removeKey || mode !== "personal" ? view.settings.maxModelCalls : maxModelCalls,
      maxQueryEmbeddings: removeKey || mode !== "personal" ? view.settings.maxQueryEmbeddings : maxQueryEmbeddings,
      consent: !removeKey && mode === "personal" && consent,
      ...(removeKey ? { removeKey: true } : mode === "personal" && keyText.trim() ? { apiKey: keyText.trim() } : {}),
    }, request.signal, userId);
    void saving.then(async settings => {
      if (!request.current()) return;
      setView(current => current ? { ...current, settings } : null); applySettings(settings); requireRead(false);
      setNotice(removeKey ? "個人密鑰已刪除，AI 已停用。使用平台模型需要另外明確選擇及保存。" : "模型設定已保存。密鑰輸入已清除。");
      try {
        const next = await api.read(request.signal, userId);
        if (request.current()) { setView(next); applySettings(next.settings); }
      } catch (error) {
        if (!request.current()) return;
        if (error instanceof ModelSettingsApiError && (error.status === 401 || error.status === 403)) clearIdentity();
        else setNotice(removeKey ? "個人密鑰已刪除，AI 已停用；最新用量未能讀取，請手動重新讀取。"
          : "模型設定已保存；最新用量未能讀取，請手動重新讀取。密鑰輸入已清除。");
      }
    }).catch(error => { if (request.current()) fail(error, true); }).finally(request.finish);
  };
  const check = () => {
    if (!view || needsReadRef.current || view.settings.mode !== "personal" || !view.settings.keyConfigured) return;
    const request = start("檢查"); if (!request) return;
    void api.check(view.settings.version, request.signal, userId).then(result => {
      if (!request.current()) return;
      setNotice(result.status === "accessible" ? "模型 metadata 可讀取。這不代表實際生成、embedding、收費或剩餘配額已驗證。"
        : "目前未能讀取模型 metadata。這項檢查不能確認實際生成、收費或剩餘配額。");
    }).catch(error => { if (request.current()) fail(error); }).finally(request.finish);
  };

  const dailyLimit = Number(dailyText);
  const validDaily = /^\d+$/u.test(dailyText) && Number.isInteger(dailyLimit)
    && dailyLimit >= PERSONAL_DAILY_LIMIT.min && dailyLimit <= PERSONAL_DAILY_LIMIT.max;
  const maxModelCalls = Number(modelCallsText);
  const validModelCalls = /^\d+$/u.test(modelCallsText) && Number.isInteger(maxModelCalls)
    && maxModelCalls >= PERSONAL_RUN_LIMITS.modelCalls.min && maxModelCalls <= PERSONAL_RUN_LIMITS.modelCalls.max;
  const maxQueryEmbeddings = Number(queryEmbeddingsText);
  const validQueryEmbeddings = /^\d+$/u.test(queryEmbeddingsText) && Number.isInteger(maxQueryEmbeddings)
    && maxQueryEmbeddings >= PERSONAL_RUN_LIMITS.queryEmbeddings.min && maxQueryEmbeddings <= PERSONAL_RUN_LIMITS.queryEmbeddings.max;
  const ready = available && !!view && !busy && !needsRead;
  const personalReady = !!view?.personalAvailable && validDaily && validModelCalls && validQueryEmbeddings && consent && (!!keyText.trim() || !!view?.settings.keyConfigured);
  const saveReady = ready && !deleteConfirmation && (mode === "personal" ? personalReady : mode === "disabled" || !!view?.platformAvailable);

  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>我的 AI 模型設定</Text>
    <Text style={styles.hint}>設定屬於你本人，切換孩子不會改變密鑰。模型固定為 Gemini {PERSONAL_MODEL}。</Text>
    <Text style={styles.hint}>個人密鑰使用 Gemini Developer API，受 Google 的地區限制；香港環境可能無法使用。</Text>
    <Action label={busy === "讀取" ? "正在讀取…" : "重新讀取目前設定及版本"} disabled={!available || !!busy} onPress={refresh} />
    {!online && <Text style={styles.warning}>目前離線，密鑰輸入已清除，不能保存或檢查模型。</Text>}
    {!authorized && <Text style={styles.warning}>請重新登入後讀取模型設定。</Text>}
    {!!notice && <Text accessibilityRole="alert" style={styles.warning}>{notice}</Text>}
    {available && view && <>
      <Text style={styles.body}>目前：{modeLabels[view.settings.mode]}；版本 {view.settings.version}；個人密鑰{view.settings.keyConfigured ? "已保存" : "未保存"}。</Text>
      {!view.enabled && <Text style={styles.warning}>Server 的 AI 服務目前停用。</Text>}
      <View accessibilityRole="radiogroup" style={styles.group}>
        {(["platform", "personal", "disabled"] as const).map(value => <Pressable key={value} accessibilityRole="radio"
          accessibilityState={{ checked: mode === value, disabled: !ready }} disabled={!ready}
          onPress={() => { setMode(value); setKeyText(""); setConsent(false); setDeleteConfirmation(false); if (value !== "personal") setBackgroundEnabled(false); }}
          style={[styles.button, !ready && styles.disabled]}><Text style={styles.buttonText}>{mode === value ? "●" : "○"} {modeLabels[value]}</Text></Pressable>)}
      </View>
      {mode === "platform" && <Text style={styles.hint}>保存後會明確使用平台模型。已保存的個人密鑰會保留，個人背景處理會停用；如需刪除，請使用下方刪除按鈕。</Text>}
      {mode === "disabled" && <Text style={styles.hint}>保存後停用 AI 及個人背景處理。已保存的密鑰會保留；停用不等於刪除。</Text>}
      {mode === "personal" && <View style={styles.group}>
        {!view.personalAvailable && <Text style={styles.warning}>Server 目前不提供個人密鑰模型服務。</Text>}
        <Text style={styles.body}>個人 Gemini API key{view.settings.keyConfigured ? "（留空可沿用已保存密鑰）" : "（必填）"}</Text>
        <TextInput accessibilityLabel="個人 Gemini API key" value={keyText} onChangeText={setKeyText} secureTextEntry
          autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" spellCheck={false}
          editable={ready} style={styles.input} />
        <Text style={styles.hint}>密鑰只保留在目前輸入欄，提交、失敗、離線或離開此頁後會清除；Server 不會傳回密鑰。</Text>
        <Text style={styles.body}>個人每日呼叫上限（生成與查詢 embedding 合併計次；失敗嘗試亦計入）</Text>
        <Text style={styles.hint}>可設定 {PERSONAL_DAILY_LIMIT.min}–{PERSONAL_DAILY_LIMIT.max} 次，預設 {PERSONAL_DAILY_LIMIT.default} 次。</Text>
        <TextInput accessibilityLabel="個人每日呼叫上限" value={dailyText} onChangeText={setDailyText}
          keyboardType="number-pad" editable={ready} style={styles.input} />
        {!validDaily && <Text style={styles.warning}>請輸入 {PERSONAL_DAILY_LIMIT.min} 至 {PERSONAL_DAILY_LIMIT.max} 的整數。</Text>}
        <Text style={styles.body}>個人每次 Agent 生成上限</Text>
        <Text style={styles.hint}>可設定 {PERSONAL_RUN_LIMITS.modelCalls.min}–{PERSONAL_RUN_LIMITS.modelCalls.max} 次，預設 {PERSONAL_RUN_LIMITS.modelCalls.default} 次。</Text>
        <TextInput accessibilityLabel="個人每次 Agent 生成上限" value={modelCallsText} onChangeText={setModelCallsText}
          keyboardType="number-pad" editable={ready} style={styles.input} />
        {!validModelCalls && <Text style={styles.warning}>請輸入 {PERSONAL_RUN_LIMITS.modelCalls.min} 至 {PERSONAL_RUN_LIMITS.modelCalls.max} 的整數。</Text>}
        <Text style={styles.body}>個人每次 Agent 查詢 embedding 上限</Text>
        <Text style={styles.hint}>可設定 {PERSONAL_RUN_LIMITS.queryEmbeddings.min}–{PERSONAL_RUN_LIMITS.queryEmbeddings.max} 次，預設 {PERSONAL_RUN_LIMITS.queryEmbeddings.default} 次。</Text>
        <TextInput accessibilityLabel="個人每次 Agent 查詢 embedding 上限" value={queryEmbeddingsText} onChangeText={setQueryEmbeddingsText}
          keyboardType="number-pad" editable={ready} style={styles.input} />
        {!validQueryEmbeddings && <Text style={styles.warning}>請輸入 {PERSONAL_RUN_LIMITS.queryEmbeddings.min} 至 {PERSONAL_RUN_LIMITS.queryEmbeddings.max} 的整數。</Text>}
        <Text style={styles.hint}>以上每日及每次 Agent 限制只在個人模式使用。平台模式維持每次最多 4 次生成、2 次查詢 embedding，並按平台每日配額執行。</Text>
        <Confirmation label="允許背景 Agent 使用我的個人密鑰" checked={backgroundEnabled} disabled={!ready}
          onToggle={() => { setBackgroundEnabled(value => !value); setConsent(false); }} />
        <Confirmation label="我同意將相關資料送交 Google 處理，由我的 Google 專案承擔費用，並由 Server 加密保存密鑰；背景處理只在我勾選允許時使用個人密鑰。"
          checked={consent} disabled={!ready} onToggle={() => setConsent(value => !value)} />
      </View>}
      <Text style={styles.hint}>固定安全上限：每次 Agent 最多 8 次工具、90 秒；每次生成最多 1024 output tokens。</Text>
      <Action label={busy === "保存" ? "正在保存…" : "保存模型設定"} disabled={!saveReady} onPress={() => save()} />
      {view.settings.keyConfigured && <View style={styles.group}>
        <Action label="刪除已保存的個人密鑰" disabled={!ready || deleteConfirmation} onPress={() => { setKeyText(""); setConsent(false); setDeleteConfirmation(true); }} />
        {deleteConfirmation && <>
          <Text style={styles.warning}>確認後會刪除此帳號的個人密鑰並停用 AI，不會自動改用平台模型。</Text>
          <Action label="確認刪除密鑰並停用 AI" disabled={!ready} onPress={() => save(true)} />
          <Action label="取消刪除" disabled={!ready} onPress={() => setDeleteConfirmation(false)} />
        </>}
      </View>}
      <Action label={busy === "檢查" ? "正在檢查…" : "檢查模型存取"}
        disabled={!ready || !view.enabled || !view.personalAvailable || view.settings.mode !== "personal" || !view.settings.keyConfigured}
        onPress={check} />
      <Text style={styles.hint}>使用已保存的個人密鑰，只查詢模型 metadata，輸入欄的新密鑰不會用於此檢查。不產生內容或 embedding；不能驗證實際生成、收費安排或剩餘配額，也不保證沒有費用。</Text>
      <Text style={styles.body}>UTC 當日用量（香港時間每日 08:00 重置；平台與個人分開）</Text>
      <Usage label="平台模型" usage={view.usage.platform} />
      <Usage label="個人密鑰" usage={view.usage.personal} />
      <Text style={styles.hint}>個人模型的全站服務安全上限：每日 {view.personalGlobalLimit} 次，由 Server 設定，只供讀取。這個上限不等於 Google 餘額；以上用量 metadata 不等於完整帳單或 Google 剩餘配額。</Text>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 10, padding: 18, borderWidth: 1, borderColor: "#D8E2DE", borderRadius: 14 },
  heading: { fontSize: 20, fontWeight: "700", color: "#245D4B" },
  body: { fontSize: 16, color: "#253A32" }, hint: { fontSize: 14, color: "#536D61" },
  warning: { fontSize: 14, color: "#8A431D" }, group: { gap: 8 },
  input: { borderWidth: 1, borderColor: "#A7BEB3", borderRadius: 8, padding: 10, fontSize: 16 },
  button: { alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: "#245D4B" },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" }, disabled: { opacity: 0.45 },
});

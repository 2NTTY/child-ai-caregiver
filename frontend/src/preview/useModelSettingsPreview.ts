import { useEffect, useRef, useState } from "react";
import { personalLimits, type ModelKeyCheck, type ModelSettings, type ModelSettingsCommand, type ModelSettingsSnapshot, type ModelSettingsViewModel } from "../model-settings-view-model";

export type ModelSaveOutcome = "saved" | "failed" | "unknown_applied" | "unknown_unapplied" | "conflict" | "denied";
export type ModelCheckOutcome = "accessible" | "unavailable" | "limited" | "failed";
type Availability = "available" | "personal_off" | "all_off";
type Workspace = Omit<ModelSettingsViewModel, "accountName" | "serverLabel" | "online">;
function fixture(scopeKey: string): ModelSettingsSnapshot {
  return { settings: { version: 3, mode: "platform", provider: "gemini", model: "gemini-3.1-flash-lite", keyConfigured: false, backgroundEnabled: false,
    dailyLimit: personalLimits.daily.default, maxModelCalls: personalLimits.modelCalls.default, maxQueryEmbeddings: personalLimits.queryEmbeddings.default, updatedAt: "2026-10-01T00:00:00Z" },
    enabled: true, platformAvailable: true, personalAvailable: true, personalGlobalLimit: 100,
    usage: { platform: { day: "2026-10-01", attempts: 2, inputTokens: 160, outputTokens: 48, cachedTokens: 20, unknownUsageAttempts: 1 },
      personal: { day: "2026-10-01", attempts: scopeKey.includes("dad") ? 3 : 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 } } };
}
function workspace(scopeKey: string): Workspace {
  return { scopeKey, snapshot: null, authorized: true, busy: null, operation: "none", notice: "", needsRead: false,
    formRevision: 0, secretRevision: 0, keyCheck: null };
}

export function useModelSettingsPreview(online: boolean, identity: { id: string; name: string }) {
  const [server, setServer] = useState("preview-server-a");
  const [saveOutcome, setSaveOutcome] = useState<ModelSaveOutcome>("saved");
  const [checkOutcome, setCheckOutcome] = useState<ModelCheckOutcome>("accessible");
  const [availability, setAvailability] = useState<Availability>("available");
  const scopeKey = `${server}|${identity.id}`;
  const [state, setState] = useState<Workspace>(() => workspace(scopeKey));
  const stateRef = useRef(state); stateRef.current = state;
  const scopeRef = useRef(scopeKey); scopeRef.current = scopeKey;
  const onlineRef = useRef(online); onlineRef.current = online;
  const store = useRef(new Map<string, ModelSettingsSnapshot>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  function cancel() { generation.current++; if (timer.current) clearTimeout(timer.current); timer.current = null; inFlight.current = false; }
  function currentSnapshot() { return store.current.get(scopeKey) ?? fixture(scopeKey); }
  function withAvailability(value: ModelSettingsSnapshot): ModelSettingsSnapshot {
    return { ...value, enabled: availability !== "all_off", personalAvailable: availability === "available", platformAvailable: availability !== "all_off" };
  }
  // Deferred work receives only secret-free metadata. Never retain or retry a command.
  function later(callback: () => void) {
    const started = generation.current, startedScope = scopeKey;
    inFlight.current = true;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (started !== generation.current || scopeRef.current !== startedScope || !onlineRef.current) return;
      inFlight.current = false; callback();
    }, 450);
  }
  function refresh() {
    if (!onlineRef.current || inFlight.current || scopeRef.current !== scopeKey || !stateRef.current.authorized) return;
    const reviewing = stateRef.current.needsRead;
    setState(current => ({ ...current, busy: "read", notice: "正在讀取模型設定…", secretRevision: current.secretRevision + 1 }));
    later(() => setState(current => ({ ...current, snapshot: withAvailability(currentSnapshot()), busy: null, needsRead: false,
      operation: reviewing ? "needs_confirmation" : "none", formRevision: current.formRevision + 1, keyCheck: null,
      notice: reviewing ? "目前設定及版本已讀取。請核對內容；如需再改，重新確認後保存。原密鑰不會重送。" : "已讀取目前設定；密鑰不會讀回。" })));
  }
  function finishSave(candidate: ModelSettings, outcome: ModelSaveOutcome, removing: boolean) {
    later(() => {
      if (outcome === "denied") { setState(current => ({ ...workspace(scopeKey), authorized: false, operation: "failed", secretRevision: current.secretRevision + 1,
        notice: "身份或權限已改變，輸入及模型資料已清除。請重新登入。" })); return; }
      if (outcome === "saved" || outcome === "unknown_applied") store.current.set(scopeKey, { ...currentSnapshot(), settings: candidate });
      if (outcome === "conflict") store.current.set(scopeKey, { ...currentSnapshot(), settings: { ...currentSnapshot().settings, version: candidate.version, dailyLimit: 150 } });
      setState(current => ({ ...current, busy: null, keyCheck: null,
        operation: outcome.startsWith("unknown") ? "unknown" : outcome === "conflict" ? "needs_confirmation" : outcome === "saved" ? "saved" : "failed",
        needsRead: outcome.startsWith("unknown") || outcome === "conflict",
        snapshot: outcome === "saved" ? withAvailability(currentSnapshot()) : current.snapshot,
        formRevision: current.formRevision + (outcome === "saved" ? 1 : 0), secretRevision: current.secretRevision + 1,
        notice: outcome.startsWith("unknown") ? "保存結果未知。密鑰輸入已清除，不會自動重送。請先重新讀取設定及版本。"
          : outcome === "conflict" ? "版本已改變。請重新讀取目前設定並核對，再確認操作。"
          : outcome === "failed" ? "這次設定未被接納，沒有保存。密鑰輸入已清除，其餘選項草稿保留。"
          : removing ? "個人密鑰已刪除，AI 已停用。使用平台服務須另行選擇並保存。" : "模型設定已保存；密鑰輸入已清除。尚未確認生成或查詢向量可用。" }));
    });
  }
  function save(command: ModelSettingsCommand) {
    const current = stateRef.current;
    if (!onlineRef.current || inFlight.current || scopeRef.current !== scopeKey || current.scopeKey !== scopeKey || !current.authorized || !current.snapshot || current.needsRead) return;
    if (command.expectedVersion !== current.snapshot.settings.version) {
      setState(value => ({ ...value, needsRead: true, operation: "needs_confirmation", secretRevision: value.secretRevision + 1, notice: "版本已改變，請重新讀取設定。" })); return;
    }
    const available = withAvailability(current.snapshot);
    if (!command.removeKey && (command.mode === "personal" && !available.personalAvailable || command.mode === "platform" && !available.platformAvailable)) return;
    // This projection contains no entered key, key hash or command body.
    const candidate: ModelSettings = { version: command.expectedVersion + 1, mode: command.mode, provider: "gemini", model: current.snapshot.settings.model,
      keyConfigured: command.removeKey ? false : Boolean(command.apiKey) || current.snapshot.settings.keyConfigured,
      backgroundEnabled: command.backgroundEnabled, dailyLimit: command.dailyLimit, maxModelCalls: command.maxModelCalls,
      maxQueryEmbeddings: command.maxQueryEmbeddings, updatedAt: "2026-10-01T01:00:00Z" };
    setState(value => ({ ...value, busy: "save", operation: "saving", needsRead: true, notice: "正在保存模型設定…", secretRevision: value.secretRevision + 1, keyCheck: null }));
    finishSave(candidate, saveOutcome, command.removeKey === true);
  }
  function check(expectedVersion: number) {
    const current = stateRef.current;
    if (!onlineRef.current || inFlight.current || !current.authorized || current.needsRead || !current.snapshot
      || current.scopeKey !== scopeKey || scopeRef.current !== scopeKey || current.snapshot.settings.version !== expectedVersion
      || current.snapshot.settings.mode !== "personal" || !current.snapshot.settings.keyConfigured
      || !withAvailability(current.snapshot).enabled || !withAvailability(current.snapshot).personalAvailable) return;
    setState(value => ({ ...value, busy: "check", notice: "正在讀取已保存密鑰的模型資料…", keyCheck: null }));
    const result: ModelKeyCheck = { version: expectedVersion, scope: "model_metadata_only", status: checkOutcome === "accessible" ? "accessible" : "unavailable" };
    const outcome = checkOutcome;
    later(() => setState(value => ({ ...value, busy: null, keyCheck: outcome === "failed" || outcome === "limited" ? null : result,
      secretRevision: value.secretRevision + (outcome === "failed" || outcome === "limited" ? 1 : 0),
      notice: outcome === "accessible" ? "模型資料可讀取。實際生成、查詢向量、收費及剩餘配額仍未驗證。"
        : outcome === "limited" ? "查核太頻密（429），每帳戶每分鐘最多一次。請稍後手動重試。"
        : outcome === "failed" ? "這次未能讀取模型資料，請稍後手動重試。密鑰輸入已清除。"
        : "目前未能讀取模型資料。不能據此確認生成或查詢向量可用。" })));
  }
  useEffect(() => {
    cancel(); setState(workspace(scopeKey));
    if (onlineRef.current) {
      setState(value => ({ ...value, busy: "read" }));
      later(() => setState(value => ({ ...value, snapshot: withAvailability(currentSnapshot()), busy: null, formRevision: value.formRevision + 1 })));
    }
    return cancel;
    // Scope changes invalidate both metadata and late results; child selection is not a scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);
  useEffect(() => {
    if (online) return;
    const saving = stateRef.current.busy === "save";
    cancel(); setState(value => ({ ...value, busy: null, needsRead: true, secretRevision: value.secretRevision + 1,
      operation: saving ? "unknown" : value.operation, notice: saving ? "連線中斷，保存結果未知。密鑰已清除，恢復連線後先重讀設定。" : "目前離線。密鑰輸入已清除，恢復連線後請重讀設定。" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);
  const active = state.scopeKey === scopeKey ? state : workspace(scopeKey);
  return { model: { ...active, snapshot: active.snapshot ? withAvailability(active.snapshot) : null, online, accountName: identity.name,
    serverLabel: server.endsWith("a") ? "合成 Server A" : "合成 Server B" } as ModelSettingsViewModel,
    actions: { refresh, save, check }, saveOutcome, setSaveOutcome, checkOutcome, setCheckOutcome, availability, setAvailability,
    switchServer() { cancel(); setServer(value => value.endsWith("a") ? "preview-server-b" : "preview-server-a"); },
    restoreIdentity() { cancel(); setState(workspace(scopeKey)); setState(value => ({ ...value, snapshot: withAvailability(currentSnapshot()), formRevision: value.formRevision + 1 })); } };
}
export type ModelSettingsPreviewController = ReturnType<typeof useModelSettingsPreview>;

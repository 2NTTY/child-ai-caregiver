import { useEffect, useMemo, useRef, useState } from "react";
import { createModelSettingsApi, ModelSettingsApiError, readModelSettingsRecovery } from "../../../src/client/model-settings-api.ts";
import type { ModelSettingsActions, ModelSettingsViewModel } from "../model-settings-view-model";
import { useDomainWriteGuard } from "./useDomainEnvironment";
import { settingsAccessError, settingsFailure, settingsRead, useSettingsRefresh, useSettingsRequests, type SettingsEnvironment } from "./SettingsDomainSupport";
export function useProductionModelSettings(env: SettingsEnvironment) {
  const api = useMemo(() => createModelSettingsApi(env.apiBaseUrl, env.owner.fetcher), [env.apiBaseUrl, env.owner.fetcher]);
  const requests = useSettingsRequests(env, true);
  const [draftEditing, setDraftEditing] = useState(false);
  const [state, setState] = useState<ModelSettingsViewModel>({ scopeKey: env.identityKey, accountName: "", serverLabel: env.apiBaseUrl,
    snapshot: null, online: env.online, authorized: true, busy: null, operation: "none", notice: "", needsRead: false,
    formRevision: 0, secretRevision: 0, keyCheck: null });
  const latest = useRef(state); latest.current = state;
  // Retain only operation identity/version, never the command or secret.
  const pending = useRef<{ opId: string; expectedVersion: number } | null>(null);
  const patch = (value: Partial<ModelSettingsViewModel>) => setState(current => ({ ...current, ...value }));
  const fail = (error: unknown, saving = false) => {
    if (settingsAccessError(env, error, true)) { pending.current = null; patch({ catalog: null, originalOperationId: null, snapshot: null, authorized: settingsFailure(error).status === 403, keyCheck: null, needsRead: false,
      secretRevision: latest.current.secretRevision + 1, notice: settingsFailure(error).status === 403 ? "目前模型設定不可讀取或修改；內容及密鑰輸入已清除，請重新讀取。" : "身份或權限已改變，模型設定已清除。" }); return; }
    const failure = error instanceof ModelSettingsApiError ? error : new ModelSettingsApiError();
    if (saving && !failure.unknownResult) pending.current = null;
    patch({ originalOperationId: pending.current?.opId ?? null, ...(saving ? { operation: failure.unknownResult ? "unknown" : "failed" } : { snapshot: null, keyCheck: null }),
      needsRead: saving && failure.unknownResult || failure.status === 409 || latest.current.needsRead,
      secretRevision: latest.current.secretRevision + 1,
      notice: saving && failure.unknownResult ? "保存結果未知；密鑰已清除。請查回原操作及目前設定，系統不會重播密鑰。"
        : failure.code === "client_update_required" ? "請更新應用程式後管理這份模型設定。"
        : failure.status === 409 ? "設定版本已改變，請先重新讀取。"
        : failure.code === "key_required" ? "請提供所選供應商的密鑰；切換供應商不能沿用另一份密鑰。"
        : failure.code === "model_unsupported" ? "所選模型尚未接線，請重新讀取模型目錄。"
        : failure.status === 429 ? "模型資料查核暫受限，請稍後手動重試。" : "模型設定未能確認，請核對連線後重新讀取。" });
  };
  const refresh = async () => {
    const request = requests.start(); if (!request || !env.userId) return;
    patch({ busy: "read", keyCheck: null, secretRevision: latest.current.secretRevision + 1 });
    try {
      const original = pending.current;
      const recovery = original ? await readModelSettingsRecovery(api, original, request.signal, env.userId!) : null;
      const snapshot = recovery?.snapshot ?? await settingsRead(env, "model", true, () => api.read(request.signal, env.userId!));
      if (!request.current()) return;
      // A null receipt alone does not prove that an in-flight write cannot commit.
      const unresolved = recovery?.outcome === "unknown", confirmed = recovery?.outcome === "confirmed";
      if (!unresolved) pending.current = null;
      patch({ snapshot, authorized: true, catalog: null, originalOperationId: pending.current?.opId ?? null,
        needsRead: unresolved, operation: unresolved ? "unknown" : confirmed ? "saved" : "none",
        notice: unresolved ? "原操作尚未確認；保留原操作識別，稍後可再查。密鑰不會自動重送。"
          : confirmed ? "原操作已保存，並已讀取目前設定；沒有再次提交密鑰。"
          : original ? "目前版本已更新，舊版本不能再寫入；請核對目前設定。" : "目前設定及版本已讀取。",
        formRevision: latest.current.formRevision + 1, secretRevision: latest.current.secretRevision + 1 });
      try {
        const catalog = await api.catalog(snapshot.settings.version, false, request.signal, env.userId!);
        if (request.current()) patch({ catalog });
      } catch (error) {
        const failure = settingsFailure(error);
        if (request.current() && (failure.status === 401 || failure.status === 403 || failure.code === "session_changed")) fail(error);
        // Optional metadata failure must not discard an otherwise confirmed settings read.
      }
    } catch (error) { if (request.current()) fail(error); }
    finally { if (request.current()) patch({ busy: null }); request.finish(); }
  };
  const actions: ModelSettingsActions = { setDraftEditing, refresh: () => { void refresh(); },
    save(command) {
      const current = latest.current;
      if (!env.userId || !current.snapshot || current.needsRead || !current.authorized || command.expectedVersion !== current.snapshot.settings.version) return;
      const request = requests.start(true); if (!request) return;
      const opId = crypto.randomUUID(); pending.current = { opId, expectedVersion: command.expectedVersion };
      patch({ originalOperationId: opId, catalog: null, busy: "save", needsRead: true, keyCheck: null, operation: "saving", secretRevision: current.secretRevision + 1 });
      // Do not retain the command or entered key in a retry buffer or cache.
      void api.save({ ...command, opId }, request.signal, env.userId).then(async settings => {
        if (!request.current()) return;
        pending.current = null;
        patch({ originalOperationId: null, snapshot: { ...current.snapshot!, effective: undefined, settings }, needsRead: false, operation: "saved", notice: "模型設定已保存。",
          formRevision: latest.current.formRevision + 1, secretRevision: latest.current.secretRevision + 1 });
        env.invalidate();
        try {
          const snapshot = await settingsRead(env, "model", true, () => api.read(request.signal, env.userId!));
          if (request.current()) patch({ snapshot });
          const catalog = await api.catalog(snapshot.settings.version, false, request.signal, env.userId!);
          if (request.current()) patch({ catalog });
        } catch (error) {
          if (!request.current()) return;
          if (!settingsAccessError(env, error, true)) patch({ notice: "模型設定已保存；最新用量尚未讀取，請手動重新讀取。" });
          else fail(error);
        }
      }).catch(error => { if (request.current()) fail(error, true); })
        .finally(() => { if (request.current()) patch({ busy: null }); request.finish(); });
    },
    refreshCatalog(expectedVersion) {
      const current = latest.current;
      if (!env.userId || !current.snapshot?.settings.keyConfigured || current.needsRead || !current.authorized
        || current.snapshot.settings.version !== expectedVersion) return;
      const request = requests.start(true); if (!request) return;
      patch({ busy: "catalog", keyCheck: null, secretRevision: current.secretRevision + 1 });
      void api.catalog(expectedVersion, true, request.signal, env.userId).then(catalog => {
        if (request.current()) patch({ catalog, notice: "已查核已保存密鑰的模型目錄；未呼叫生成，亦未改變所選模型。" });
      }).catch(error => { if (request.current()) fail(error); })
        .finally(() => { if (request.current()) patch({ busy: null }); request.finish(); });
    },
    check(expectedVersion) {
      const current = latest.current;
      if (!env.userId || !current.snapshot?.settings.keyConfigured || current.needsRead || !current.authorized
        || !current.snapshot.enabled || !current.snapshot.personalAvailable || current.snapshot.settings.version !== expectedVersion) return;
      const request = requests.start(true); if (!request) return;
      patch({ busy: "check", keyCheck: null, secretRevision: current.secretRevision + 1 });
      void api.check(expectedVersion, request.signal, env.userId).then(keyCheck => {
        if (request.current()) patch({ keyCheck, notice: "只查核已保存版本的模型資料；不代表生成或帳單已驗證。" });
      }).catch(error => { if (request.current()) fail(error); })
        .finally(() => { if (request.current()) patch({ busy: null }); request.finish(); });
    } };
  useEffect(() => { if (!env.online) patch({ busy: null, keyCheck: null, catalog: null,
    ...(pending.current ? { operation: "unknown", needsRead: true, originalOperationId: pending.current.opId } : {}),
    secretRevision: latest.current.secretRevision + 1 }); }, [env.online]);
  useSettingsRefresh(env, actions.refresh, !requests.busy && !state.needsRead, true, draftEditing);
  useDomainWriteGuard(false, state.operation === "unknown" || state.busy === "save", "account");
  const user = env.owner.getSnapshot().records.user;
  return { model: { ...state, scopeKey: env.identityKey, accountName: user?.name ?? "", online: env.online,
    snapshot: env.currentIdentity() ? state.snapshot : null, authorized: env.currentIdentity() && state.authorized }, actions };
}

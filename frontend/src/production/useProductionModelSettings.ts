import { useEffect, useMemo, useRef, useState } from "react";
import { createModelSettingsApi, ModelSettingsApiError } from "../../../src/client/model-settings-api.ts";
import type { ModelSettingsActions, ModelSettingsViewModel } from "../model-settings-view-model";
import { useDomainWriteGuard } from "./useDomainEnvironment";
import { settingsAccessError, settingsFailure, settingsRead, useSettingsRefresh, useSettingsRequests, type SettingsEnvironment } from "./SettingsDomainSupport";
export function useProductionModelSettings(env: SettingsEnvironment) {
  const api = useMemo(() => createModelSettingsApi(env.apiBaseUrl, env.owner.fetcher), [env.apiBaseUrl, env.owner.fetcher]);
  const requests = useSettingsRequests(env, true);
  const [state, setState] = useState<ModelSettingsViewModel>({ scopeKey: env.identityKey, accountName: "", serverLabel: env.apiBaseUrl,
    snapshot: null, online: env.online, authorized: true, busy: null, operation: "none", notice: "", needsRead: false,
    formRevision: 0, secretRevision: 0, keyCheck: null });
  const latest = useRef(state); latest.current = state;
  const patch = (value: Partial<ModelSettingsViewModel>) => setState(current => ({ ...current, ...value }));
  const fail = (error: unknown, saving = false) => {
    if (settingsAccessError(env, error, true)) { patch({ snapshot: null, authorized: settingsFailure(error).status === 403, keyCheck: null, needsRead: false,
      secretRevision: latest.current.secretRevision + 1, notice: settingsFailure(error).status === 403 ? "目前模型設定不可讀取或修改；內容及密鑰輸入已清除，請重新讀取。" : "身份或權限已改變，模型設定已清除。" }); return; }
    const failure = error instanceof ModelSettingsApiError ? error : new ModelSettingsApiError();
    patch({ ...(saving ? { operation: failure.unknownResult ? "unknown" : "failed" } : { snapshot: null, keyCheck: null }),
      needsRead: saving && failure.unknownResult || failure.status === 409 || latest.current.needsRead,
      secretRevision: latest.current.secretRevision + 1,
      notice: saving && failure.unknownResult ? "保存結果未知；密鑰已清除。請先重新讀取目前設定，核對後明確保存，系統不會重播密鑰。"
        : failure.status === 409 ? "設定版本已改變，請先重新讀取。"
        : failure.status === 429 ? "模型資料查核暫受限，請稍後手動重試。" : "模型設定未能確認，請核對連線後重新讀取。" });
  };
  const refresh = async () => {
    const request = requests.start(); if (!request || !env.userId) return;
    patch({ busy: "read", keyCheck: null, secretRevision: latest.current.secretRevision + 1 });
    try {
      const snapshot = await settingsRead(env, "model", true, () => api.read(request.signal, env.userId!));
      if (!request.current()) return;
      patch({ snapshot, authorized: true, needsRead: false, operation: "none", notice: "目前設定及版本已讀取。",
        formRevision: latest.current.formRevision + 1, secretRevision: latest.current.secretRevision + 1 });
    } catch (error) { if (request.current()) fail(error); }
    finally { if (request.current()) patch({ busy: null }); request.finish(); }
  };
  const actions: ModelSettingsActions = { refresh: () => { void refresh(); },
    save(command) {
      const current = latest.current;
      if (!env.userId || !current.snapshot || current.needsRead || !current.authorized || command.expectedVersion !== current.snapshot.settings.version) return;
      const request = requests.start(true); if (!request) return;
      patch({ busy: "save", needsRead: true, keyCheck: null, operation: "saving", secretRevision: current.secretRevision + 1 });
      // Do not retain the command or entered key in a retry buffer or cache.
      void api.save(command, request.signal, env.userId).then(async settings => {
        if (!request.current()) return;
        patch({ snapshot: { ...current.snapshot!, settings }, needsRead: false, operation: "saved", notice: "模型設定已保存。",
          formRevision: latest.current.formRevision + 1, secretRevision: latest.current.secretRevision + 1 });
        env.invalidate();
        try {
          const snapshot = await settingsRead(env, "model", true, () => api.read(request.signal, env.userId!));
          if (request.current()) patch({ snapshot });
        } catch (error) {
          if (!request.current()) return;
          if (!settingsAccessError(env, error, true)) patch({ notice: "模型設定已保存；最新用量尚未讀取，請手動重新讀取。" });
          else fail(error);
        }
      }).catch(error => { if (request.current()) fail(error, true); })
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
  useEffect(() => { if (!env.online) patch({ busy: null, keyCheck: null, secretRevision: latest.current.secretRevision + 1 }); }, [env.online]);
  useSettingsRefresh(env, actions.refresh, !requests.busy && !state.needsRead, true);
  useDomainWriteGuard(false, state.operation === "unknown" || state.busy === "save", "account");
  const user = env.owner.getSnapshot().records.user;
  return { model: { ...state, scopeKey: env.identityKey, accountName: user?.name ?? "", online: env.online,
    snapshot: env.currentIdentity() ? state.snapshot : null, authorized: env.currentIdentity() && state.authorized }, actions };
}
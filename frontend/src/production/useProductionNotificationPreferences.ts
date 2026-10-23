import { useEffect, useMemo, useRef, useState } from "react";
import { createFamilyApi, FamilyApiError } from "../../../src/client/family-api.ts";
import type { NotificationPreferences } from "../../../src/shared/family.ts";
import { useDomainWriteGuard } from "./useDomainEnvironment";
import { settingsAccessError, settingsFailure, settingsRead, useSettingsRefresh, useSettingsRequests, type SettingsEnvironment } from "./SettingsDomainSupport";
export type ProductionPreferenceValues = Omit<NotificationPreferences, "version">;
type OriginalPreference = { input: ProductionPreferenceValues & { expectedVersion: number }; confirmed: boolean; reviewed: boolean; consent: boolean };
export function useProductionNotificationPreferences(env: SettingsEnvironment) {
  const api = useMemo(() => createFamilyApi(env.apiBaseUrl, env.owner.fetcher), [env.apiBaseUrl, env.owner.fetcher]), requests = useSettingsRequests(env, true);
  const [draftEditing, setDraftEditing] = useState(false);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null), [notice, setNotice] = useState("");
  const [original, setOriginal] = useState<OriginalPreference | null>(null), [fresh, setFresh] = useState(false), [denied, setDenied] = useState(false);
  const pending = useRef<OriginalPreference | null>(null), values = useRef(preferences); values.current = preferences;
  const retain = (entry: OriginalPreference | null) => { pending.current = entry; setOriginal(entry ? { ...entry } : null); };
  const read = async (signal: AbortSignal) => {
    const result = await settingsRead(env, "notification-preferences", true, () => api.getPreferences(signal));
    if (await api.getSession(signal) !== env.userId) throw new FamilyApiError(401); return result;
  };
  const failed = (error: unknown, entry?: OriginalPreference) => {
    if (settingsAccessError(env, error, true)) { setPreferences(null); setDenied(true); retain(null); api.resetOnline?.(); setFresh(false); setNotice("目前通知偏好不可讀取或修改；內容已清除，請重新讀取。"); return; }
    const failure = settingsFailure(error);
    if (entry && failure.confirmed) entry.confirmed = true;
    if (entry && (entry.confirmed || api.hasPendingOnline?.() || failure.status === 0 || failure.status >= 500)) {
      entry.reviewed = false; entry.consent = false; retain(entry);
      setNotice(entry.confirmed ? "原保存已確認；目前通知偏好待重新讀取，請勿重送。" : "保存結果待查核；請先查原收據及讀取目前偏好。");
    } else { if (entry) retain(null); setNotice(failure.status === 409 ? "通知偏好版本已改變；請讀取目前版本後重新核對。" : "通知偏好未能讀取或保存。請手動重新讀取。"); }
    setFresh(false);
  };
  const refresh = async () => {
    const request = requests.start(); if (!request || !env.userId) return;
    const entry = pending.current;
    if (entry) { entry.reviewed = false; entry.consent = false; retain(entry); }
    try {
      const receipt = entry ? await api.reconcilePending?.(request.signal, env.userId) : null;
      if (entry && receipt?.state === "confirmed") entry.confirmed = true;
      const next = await read(request.signal); if (!request.current()) return;
      setPreferences(next); setFresh(true); setDenied(false);
      if (entry && !entry.confirmed && api.hasPendingOnline?.()) { entry.reviewed = receipt?.state === "unconfirmed"; retain(entry); setNotice("原保存仍未確認；目前偏好已讀取，請核對後明確重試原內容。"); }
      else { retain(null); setNotice(entry?.confirmed ? "原保存已確認；目前通知偏好已重新讀取。" : "目前通知偏好已讀取。"); }
    } catch (error) { if (request.current()) failed(error, entry ?? undefined); }
    finally { request.finish(!!pending.current); }
  };
  const save = async (input: ProductionPreferenceValues, expectedVersion: number, retry = false) => {
    if (!env.userId || !fresh || denied || !values.current || !retry && (pending.current || api.hasPendingOnline?.())) return;
    if (!retry && expectedVersion !== values.current.version) { setNotice("通知偏好版本已改變，請重新核對草稿及目前版本。"); return; }
    const entry: OriginalPreference = retry ? pending.current! : { input: { ...input, expectedVersion }, confirmed: false, reviewed: false, consent: false };
    if (retry && (!entry || !entry.reviewed || !entry.consent || entry.confirmed || !api.hasPendingOnline?.())) return;
    const request = requests.start(true, retry); if (!request) return;
    entry.reviewed = false; entry.consent = false; retain(entry); setNotice("正在保存通知偏好。");
    try {
      await api.savePreferences(entry.input, request.signal, env.userId); entry.confirmed = true;
      if (request.current()) env.invalidate();
      const next = await read(request.signal); if (!request.current()) return;
      setPreferences(next); setFresh(true); retain(null); setNotice("通知偏好已保存並讀取目前版本。");
    } catch (error) { if (request.current()) failed(error, entry); }
    finally { request.finish(!!pending.current); }
  };
  useEffect(() => () => { api.resetOnline?.(); pending.current = null; }, [api]);
  useEffect(() => { if (!env.online) { setFresh(false); if (pending.current) { pending.current.consent = false; pending.current.reviewed = false; retain(pending.current); } } }, [env.online]);
  useSettingsRefresh(env, () => { void refresh(); }, !requests.busy && !original, true, draftEditing);
  useDomainWriteGuard(false, !!original || requests.writing, "account");
  return { scopeKey: JSON.stringify([env.identityKey, env.owner.getSnapshot().sessionGeneration]), setDraftEditing, preferences: env.currentIdentity() ? preferences : null, online: env.online, busy: requests.busy, original, fresh, notice,
    refresh: () => { void refresh(); }, save: (input: ProductionPreferenceValues, expectedVersion: number) => { void save(input, expectedVersion); },
    confirmOriginal(value: boolean) { if (pending.current?.reviewed) { pending.current.consent = value; retain(pending.current); } },
    retryOriginal() { if (pending.current) void save(pending.current.input, pending.current.input.expectedVersion, true); } };
}
import { useEffect, useMemo, useRef, useState } from "react";
import { createWebPushApi } from "../../../src/client/web-push-api.ts";
import type { PushRegistrationInput, WebPushStatus } from "../../../src/shared/web-push.ts";
import { activatePushBrowser, ownedBrowserBinding, pushBrowserSupported, pushPermission, requestPushPermission, subscribePushBrowser, suspendPushBrowser, unsubscribePushBrowser } from "../../../src/client/push-browser.ts";
import type { ChannelReview, PushSettingsActions, PushSettingsModel } from "../channel-view-model";
import { pushTestAllowed } from "../channel-view-model";
import { useDomainWriteGuard } from "./useDomainEnvironment";
import { settingsAccessError, settingsFailure, settingsRead, useSettingsRefresh, useSettingsRequests, type SettingsEnvironment } from "./SettingsDomainSupport";
type PushReview = Omit<ChannelReview, "kind"> & { kind: "enable" | "revoke" | "test" } & { id: string | null };
type OriginalPush = { review: PushReview; input: PushRegistrationInput | null; confirmed: boolean; reviewed: boolean; consent: boolean };
export function useProductionPushSettings(env: SettingsEnvironment) {
  const api = useMemo(() => createWebPushApi(env.apiBaseUrl, env.owner.fetcher), [env.apiBaseUrl, env.owner.fetcher]), requests = useSettingsRequests(env, true);
  const [status, setStatus] = useState<WebPushStatus | null>(null), [bindingId, setBindingId] = useState<string | null>(null);
  const [permission, setPermission] = useState(pushPermission), [readState, setReadState] = useState<PushSettingsModel["readState"]>("loading");
  const [review, setReview] = useState<PushReview | null>(null), [original, setOriginal] = useState<OriginalPush | null>(null), [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false), [savedReference, setSavedReference] = useState<string | null>(null);
  const pending = useRef<OriginalPush | null>(null), currentStatus = useRef(status), currentReview = useRef(review), currentBinding = useRef(bindingId);
  currentStatus.current = status; currentReview.current = review; currentBinding.current = bindingId;
  const retain = (entry: OriginalPush | null) => { pending.current = entry; setOriginal(entry ? { ...entry } : null); };
  const read = async (signal: AbortSignal, current: () => boolean) => {
    const epoch = await suspendPushBrowser();
    const next = await settingsRead(env, "web-push", true, () => api.status(signal, env.userId!));
    if (!current()) return null;
    const binding = await ownedBrowserBinding(next);
    if (!current()) return null;
    if (epoch && binding) await activatePushBrowser(epoch, { userId: env.userId!, id: binding.id, version: binding.version });
    if (!current()) { await suspendPushBrowser(); return null; }
    setStatus(next); setBindingId(binding?.id ?? null); setPermission(pushPermission()); setReadState("ready"); return next;
  };
  const failed = (error: unknown, entry?: OriginalPush) => {
    setPermission(pushPermission()); setReview(null);
    if (settingsAccessError(env, error, true)) { api.resetOnline(); retain(null); setStatus(null); setBindingId(null); setReadState(settingsFailure(error).status === 403 ? "failed" : "session_changed"); setNotice("本人通知設定不可讀取或修改；內容已清除，請重新讀取。"); void suspendPushBrowser().catch(() => {}); return; }
    const failure = settingsFailure(error);
    if (entry && failure.confirmed) entry.confirmed = true;
    if (entry && (entry.confirmed || api.hasPendingOnline() || failure.status === 0 || failure.status >= 500)) {
      entry.reviewed = false; entry.consent = false; retain(entry);
      setNotice(entry.confirmed ? "原通知操作已確認；目前狀態待重新讀取，請勿重送。" : "原通知操作結果未知，請先查原收據及目前狀態；不會自行重發測試。");
    } else { if (entry) retain(null); setConflict(failure.status === 409); setNotice(failure.status === 409 ? "訂閱版本或測試限制已改變，請重新讀取再核對。" : "通知狀態或操作未能確認，請手動重新讀取。"); }
    setReadState("failed"); setStatus(null); setBindingId(null);
  };
  const refresh = async () => {
    const request = requests.start(); if (!request || !env.userId) return;
    setReview(null); setSavedReference(null);
    const entry = pending.current;
    if (entry) { entry.reviewed = false; entry.consent = false; retain(entry); }
    try {
      const receipt = entry ? await api.reconcilePending(request.signal, env.userId) : null;
      if (entry && receipt?.state === "confirmed") entry.confirmed = true;
      const next = await read(request.signal, request.current); if (!request.current() || !next) return;
      setConflict(false);
      if (entry && !entry.confirmed && api.hasPendingOnline()) {
        entry.reviewed = receipt?.state === "unconfirmed"; retain(entry); setNotice("已查原收據及目前訂閱；原操作尚未確認，請核對後明確重試原內容。");
      } else { retain(null); setNotice(entry?.confirmed ? "原通知操作已確認，狀態已重新讀取。渠道接受不代表已讀。" : "目前本人瀏覽器狀態已讀取。"); }
    } catch (error) { if (request.current()) failed(error, entry ?? undefined); }
    finally { request.finish(!!pending.current); }
  };
  const submit = async (retry = false) => {
    const actual = currentStatus.current, staged = retry ? pending.current?.review : currentReview.current;
    if (!actual || !staged || !env.userId || readState !== "ready") return;
    const entry: OriginalPush = retry ? pending.current! : { review: { ...staged }, input: null, confirmed: false, reviewed: false, consent: false };
    if (retry ? !entry.reviewed || !entry.consent || entry.confirmed || !api.hasPendingOnline() : !staged.confirmed || pending.current || api.hasPendingOnline()) return;
    const binding = actual.bindings.find(item => item.id === staged.id);
    if (!retry && staged.kind === "enable" && (!actual.available || !actual.publicKey || !pushBrowserSupported() || pushPermission() === "denied")) return;
    if (!retry && staged.kind !== "enable" && (!binding || binding.version !== staged.expectedVersion)) return;
    if (!retry && staged.kind === "test" && (!binding || !actual.workerEnabled || actual.testsRemaining < 1 || actual.nextTestAt && Date.parse(actual.nextTestAt) > Date.now())) return;
    const request = requests.start(true, retry); if (!request) return;
    // Called before the first await so browser consent stays in the explicit click gesture.
    const permissionRequest = staged.kind === "enable" && !retry ? requestPushPermission() : null;
    entry.reviewed = false; entry.consent = false; retain(entry); setReview(null); setSavedReference(null);
    let submitted = false;
    try {
      let result;
      if (staged.kind === "enable") {
        if (!retry) {
          if (await permissionRequest !== "granted") { retain(null); throw new Error("Browser consent unavailable"); }
          if (!request.current()) return;
          const browser = await subscribePushBrowser(actual.publicKey!, currentBinding.current !== null);
          if (!request.current()) { await suspendPushBrowser(); return; }
          entry.input = { subscription: browser.subscription, label: staged.targetLabel }; retain(entry);
        }
        if (!entry.input) return;
        submitted = true; result = await api.register(entry.input, request.signal, env.userId);
      } else if (staged.kind === "revoke") {
        if (!retry && staged.id === currentBinding.current) { await unsubscribePushBrowser(); setBindingId(null); }
        if (!request.current()) return;
        submitted = true; result = await api.revoke(staged.id!, staged.expectedVersion!, request.signal, env.userId);
      } else { submitted = true; result = await api.test(staged.id!, staged.expectedVersion!, request.signal, env.userId); }
      entry.confirmed = true;
      if (request.current()) env.invalidate();
      const next = await read(request.signal, request.current); if (!request.current() || !next) return;
      retain(null); setSavedReference(result.id); setConflict(false); setNotice(staged.kind === "test" ? "一般測試請求已保存；實際投遞結果請看台帳，不代表已讀。" : "本人通知設定已保存並讀取目前狀態。");
    } catch (error) { if (request.current()) { if (!submitted && !api.hasPendingOnline()) retain(null); failed(error, submitted && pending.current === entry ? entry : undefined); } }
    finally { request.finish(!!pending.current); }
  };
  const stage = (next: PushReview) => { if (!requests.busy && env.online && readState === "ready" && !pending.current && !!env.canStartWrite()) { setReview(next); setSavedReference(null); setConflict(false); } };
  const actions: PushSettingsActions = { refresh: () => { void refresh(); },
    stageEnable(label) { if (label.trim() && label.trim().length <= 80) stage({ kind: "enable", id: null, targetLabel: label.trim(), expectedVersion: null, confirmed: false }); },
    stageRevoke(id) { const item = status?.bindings.find(binding => binding.id === id); if (item && item.status !== "revoked") stage({ kind: "revoke", id, targetLabel: item.label, expectedVersion: item.version, confirmed: false }); },
    stageTest(id) { const item = status?.bindings.find(binding => binding.id === id); if (item && pushTestAllowed({ available: status!.available, workerEnabled: status!.workerEnabled, testsRemaining: status!.testsRemaining, nextTestAt: status!.nextTestAt }, { ...item, providerLabel: item.provider })) stage({ kind: "test", id, targetLabel: item.label, expectedVersion: item.version, confirmed: false }); },
    confirmReview(value) { setReview(current => current ? { ...current, confirmed: value } : null); }, submit: () => { void submit(); },
    cancel() { if (!requests.busy && !pending.current) setReview(null); }, useLatest() { if (!pending.current) void refresh(); } };
  useEffect(() => () => { api.resetOnline(); pending.current = null; void suspendPushBrowser().catch(() => {}); }, [api]);
  useEffect(() => { if (!env.online) { setReview(current => current ? { ...current, confirmed: false } : null); if (pending.current) { pending.current.reviewed = false; pending.current.consent = false; retain(pending.current); } } }, [env.online]);
  useSettingsRefresh(env, actions.refresh, !requests.busy && !original && !review, true);
  useDomainWriteGuard(!!review, !!original || requests.writing, "account");
  const visible = env.currentIdentity() ? status : null;
  const model: PushSettingsModel = { online: env.online, readState: env.currentIdentity() ? readState : "session_changed", locked: requests.busy || !!original,
    conflict, notice, workerEnabled: visible?.workerEnabled ?? false, review, available: visible?.available ?? false, browserSupported: pushBrowserSupported(), permission,
    currentBindingId: visible ? bindingId : null, bindings: visible?.bindings.map(item => ({ ...item, providerLabel: item.provider })) ?? [],
    deliveries: visible?.deliveries.map(item => ({ ...item, label: visible.bindings.find(binding => binding.id === item.bindingId)?.label ?? "本人訂閱", reasonLabel: item.reason })) ?? [],
    testsRemaining: visible?.testsRemaining ?? 0, nextTestAt: visible?.nextTestAt ?? null };
  return { model, actions, original, busy: requests.busy, savedReference,
    confirmOriginal(value: boolean) { if (pending.current?.reviewed) { pending.current.consent = value; retain(pending.current); } },
    retryOriginal: () => { void submit(true); } };
}
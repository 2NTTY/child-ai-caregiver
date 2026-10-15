import { useEffect, useMemo, useRef, useState } from "react";
import { Linking } from "react-native";
import { createTelegramApi, TelegramApiError } from "../../../src/client/telegram-api.ts";
import { createFamilyApi } from "../../../src/client/family-api.ts";
import type { TelegramStatus } from "../../../src/shared/telegram.ts";
import type { ChannelReview, TelegramSettingsActions, TelegramSettingsModel } from "../channel-view-model";
import { blocksAnotherTelegramTest, telegramBeginAllowed } from "../channel-view-model";
import { useDomainWriteGuard } from "./useDomainEnvironment";
import { settingsAccessError, settingsFailure, settingsRead, useSettingsRefresh, useSettingsRequests, type SettingsEnvironment } from "./SettingsDomainSupport";
type TelegramReview = Omit<ChannelReview, "kind"> & { kind: "begin" | "confirm" | "revoke" | "test" } & { id: string | null; accountKey: string | null };
type OriginalTelegram = { review: TelegramReview; confirmed: boolean; reviewed: boolean; consent: boolean };
const candidateKey = (value: TelegramStatus["challenge"]) => value ? JSON.stringify([value.id, value.version, value.candidate]) : null;
export function useProductionTelegramSettings(env: SettingsEnvironment) {
  const api = useMemo(() => createTelegramApi(env.apiBaseUrl, env.owner.fetcher), [env.apiBaseUrl, env.owner.fetcher]);
  const sessions = useMemo(() => createFamilyApi(env.apiBaseUrl, env.owner.fetcher), [env.apiBaseUrl, env.owner.fetcher]), requests = useSettingsRequests(env, true);
  const [status, setStatus] = useState<TelegramStatus | null>(null), [readState, setReadState] = useState<TelegramSettingsModel["readState"]>("loading");
  const [review, setReview] = useState<TelegramReview | null>(null), [original, setOriginal] = useState<OriginalTelegram | null>(null), [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false), [savedReference, setSavedReference] = useState<string | null>(null);
  const pending = useRef<OriginalTelegram | null>(null), currentStatus = useRef(status), currentReview = useRef(review);
  currentStatus.current = status; currentReview.current = review;
  const retain = (entry: OriginalTelegram | null) => { pending.current = entry; setOriginal(entry ? { ...entry } : null); };
  const read = async (signal: AbortSignal) => {
    const next = await settingsRead(env, "telegram", true, () => api.status(signal, env.userId!));
    if (await sessions.getSession(signal) !== env.userId) throw new TelegramApiError(409, "session_changed"); return next;
  };
  const failed = (error: unknown, entry?: OriginalTelegram) => {
    setReview(null);
    if (settingsAccessError(env, error, true)) { api.resetOnline(); retain(null); setStatus(null); setReadState(settingsFailure(error).status === 403 ? "failed" : "session_changed"); setNotice("本人 Telegram 設定不可讀取或修改；內容已清除，請重新讀取。"); return; }
    const failure = settingsFailure(error);
    if (entry && failure.confirmed) entry.confirmed = true;
    if (entry && (entry.confirmed || api.hasPendingOnline() || failure.status === 0 || failure.status >= 500)) {
      entry.reviewed = false; entry.consent = false; retain(entry);
      setNotice(entry.confirmed ? "原 Telegram 操作已確認；目前狀態待重新讀取，請勿重送。" : "原 Telegram 操作結果待查核；原目標及版本保留，不會自行再發測試。");
    } else { if (entry) retain(null); setConflict(failure.status === 409); setNotice(failure.status === 409 ? "綁定版本、期限或發送狀態已改變；請重讀後核對。" : "Telegram 狀態或操作未能確認，請手動重新讀取。"); }
    setReadState("failed"); setStatus(null);
  };
  const refresh = async () => {
    const request = requests.start(); if (!request || !env.userId) return;
    setReview(null); setSavedReference(null);
    const entry = pending.current;
    if (entry) { entry.reviewed = false; entry.consent = false; retain(entry); }
    try {
      const receipt = entry ? await api.reconcilePending(request.signal, env.userId) : null;
      if (entry && receipt?.state === "confirmed") entry.confirmed = true;
      const next = await read(request.signal); if (!request.current()) return;
      setStatus(next); setReadState("ready"); setConflict(false);
      if (entry && !entry.confirmed && api.hasPendingOnline()) {
        entry.reviewed = receipt?.state === "unconfirmed"; retain(entry); setNotice("原操作尚無確認收據；目前資料已讀取，請重新明確同意後才重試原內容。");
      } else { retain(null); setNotice(entry?.confirmed ? "原 Telegram 操作已確認，狀態已讀回。綁定與通知授權分開。" : "目前本人 Telegram 狀態已讀取。"); }
    } catch (error) { if (request.current()) failed(error, entry ?? undefined); }
    finally { request.finish(!!pending.current); }
  };
  const submit = async (retry = false) => {
    const actual = currentStatus.current, staged = retry ? pending.current?.review : currentReview.current;
    if (!actual || !staged || !env.userId || readState !== "ready") return;
    const entry: OriginalTelegram = retry ? pending.current! : { review: { ...staged }, confirmed: false, reviewed: false, consent: false };
    if (retry ? !entry.reviewed || !entry.consent || entry.confirmed || !api.hasPendingOnline() : !staged.confirmed || pending.current || api.hasPendingOnline()) return;
    const binding = actual.binding, challenge = actual.challenge;
    if (!retry && staged.kind !== "revoke" && !actual.configured) return;
    if (!retry && staged.kind === "begin" && !telegramBeginAllowed(actual)) return;
    if (staged.kind === "confirm" && (!challenge || challenge.state !== "seen" || challenge.id !== staged.id || challenge.version !== staged.expectedVersion
      || Date.parse(challenge.expiresAt) <= Date.now() || candidateKey(challenge) !== staged.accountKey || binding && binding.status !== "revoked")) return;
    if (!retry && (staged.kind === "revoke" || staged.kind === "test") && (!binding || binding.id !== staged.id || binding.version !== staged.expectedVersion)) return;
    if (!retry && staged.kind === "test" && (!actual.workerEnabled || binding?.status !== "active" || blocksAnotherTelegramTest(actual.deliveries.map(item => ({ ...item, label: binding.label, reasonLabel: item.reason })), binding.id))) return;
    const request = requests.start(true, retry); if (!request) return;
    entry.reviewed = false; entry.consent = false; retain(entry); setReview(null); setSavedReference(null);
    try {
      const result = staged.kind === "begin" ? await api.begin(request.signal, env.userId)
        : staged.kind === "confirm" ? await api.confirm(staged.id!, staged.expectedVersion!, request.signal, env.userId)
          : staged.kind === "revoke" ? await api.revoke(staged.id!, staged.expectedVersion!, request.signal, env.userId)
            : await api.test(staged.id!, staged.expectedVersion!, request.signal, env.userId);
      entry.confirmed = true;
      if (request.current()) env.invalidate();
      const next = await read(request.signal); if (!request.current()) return;
      setStatus(next); setReadState("ready"); retain(null); setSavedReference(result.id); setConflict(false);
      setNotice(staged.kind === "begin" ? "私人綁定步驟已建立。請本人開啟 Telegram，完成後手動讀取並核對候選帳號。"
        : staged.kind === "test" ? "一般測試請求已保存；結果以投遞台帳為準，不代表已讀。" : "本人 Telegram 設定已保存並重新讀取。");
    } catch (error) { if (request.current()) failed(error, entry); }
    finally { request.finish(!!pending.current); }
  };
  const stage = (next: TelegramReview) => { if (!requests.busy && env.online && readState === "ready" && !pending.current && !!env.canStartWrite()) { setReview(next); setSavedReference(null); setConflict(false); } };
  const actions: TelegramSettingsActions = { refresh: () => { void refresh(); },
    stageBegin() { if (status && telegramBeginAllowed(status)) stage({ kind: "begin", id: null, accountKey: null, targetLabel: "本人的 Telegram 私人渠道", expectedVersion: null, confirmed: false }); },
    stageConfirm() { const challenge = status?.challenge; if (challenge?.state === "seen" && challenge.candidate && Date.parse(challenge.expiresAt) > Date.now()) stage({ kind: "confirm", id: challenge.id, accountKey: candidateKey(challenge), targetLabel: challenge.candidate.label + "（" + challenge.candidate.chatIdHint + "）", expectedVersion: challenge.version, confirmed: false }); },
    stageRevoke() { const binding = status?.binding; if (binding && binding.status !== "revoked") stage({ kind: "revoke", id: binding.id, accountKey: null, targetLabel: binding.label + "（" + binding.chatIdHint + "）", expectedVersion: binding.version, confirmed: false }); },
    stageTest() { const binding = status?.binding; if (binding?.status === "active") stage({ kind: "test", id: binding.id, accountKey: null, targetLabel: binding.label + "（" + binding.chatIdHint + "）", expectedVersion: binding.version, confirmed: false }); },
    confirmReview(value) { setReview(current => current ? { ...current, confirmed: value } : null); }, submit: () => { void submit(); },
    cancel() { if (!requests.busy && !pending.current) setReview(null); }, useLatest() { if (!pending.current) void refresh(); },
    openStartLink() {
      const value = currentStatus.current;
      if (!requests.available() || requests.busy || pending.current || !value?.configured || !value.challenge || Date.parse(value.challenge.expiresAt) <= Date.now()) return;
      try { const url = new URL(value.challenge.startUrl); if (url.protocol !== "https:" || url.hostname !== "t.me" || url.username || url.password) return;
        void Linking.openURL(value.challenge.startUrl).catch(() => setNotice("Telegram 未能開啟，請核對瀏覽器或應用設定。")); } catch { setNotice("私人綁定連結未能核對，請重新讀取。"); }
    } };
  useEffect(() => () => { api.resetOnline(); pending.current = null; }, [api]);
  useEffect(() => { if (!env.online) { setReview(current => current ? { ...current, confirmed: false } : null); if (pending.current) { pending.current.reviewed = false; pending.current.consent = false; retain(pending.current); } } }, [env.online]);
  useSettingsRefresh(env, actions.refresh, !requests.busy && !original && !review, true);
  useDomainWriteGuard(!!review, !!original || requests.busy, "account");
  const visible = env.currentIdentity() ? status : null;
  const model: TelegramSettingsModel = { online: env.online, readState: env.currentIdentity() ? readState : "session_changed", locked: requests.busy || !!original,
    conflict, notice, workerEnabled: visible?.workerEnabled ?? false, review, configured: visible?.configured ?? false,
    binding: visible?.binding ?? null, challenge: visible?.challenge ?? null,
    deliveries: visible?.deliveries.map(item => ({ ...item, label: visible.binding?.label ?? "本人 Telegram", reasonLabel: item.reason })) ?? [] };
  return { model, actions, original, busy: requests.busy, savedReference,
    confirmOriginal(value: boolean) { if (pending.current?.reviewed) { pending.current.consent = value; retain(pending.current); } },
    retryOriginal: () => { void submit(true); } };
}
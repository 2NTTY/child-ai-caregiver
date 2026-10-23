import { useEffect, useMemo, useRef, useState } from "react";
import { createContactApi } from "../../../src/client/contact-api.ts";
import type { ContactActions, ContactDecision, ContactPending, ContactViewModel } from "../contact-view-model";
import { contactMayAcknowledge, sameContactBinding } from "../contact-view-model";
import { useDomainWriteGuard } from "./useDomainEnvironment";
import { settingsAccessError, settingsFailure, settingsRead, useSettingsRefresh, useSettingsRequests, type SettingsEnvironment } from "./SettingsDomainSupport";
let contactPresentationEpoch = 0;
export function useProductionContact(env: SettingsEnvironment) {
  const api = useMemo(() => createContactApi(env.apiBaseUrl, env.owner.fetcher), [env.apiBaseUrl, env.owner.fetcher]), requests = useSettingsRequests(env);
  const [state, setState] = useState<ContactViewModel>(() => ({ scopeKey: env.scopeKey, childName: env.childName, userId: env.userId ?? "", dataLabel: "尚未讀取", page: null,
    online: env.online, access: env.role === "viewer" ? "read_only" : "editable", load: "loading", busy: false, locked: true, notice: "", operation: "none", pending: null,
    originalConsent: false, dirty: false, epoch: ++contactPresentationEpoch, confirmationEpoch: 0, missingTasks: [] }));
  const latest = useRef(state); latest.current = state;
  const pending = useRef<ContactPending | null>(null);
  const patch = (value: Partial<ContactViewModel>) => setState(current => ({ ...current, ...value }));
  const retain = (entry: ContactPending | null) => { pending.current = entry; patch({ pending: entry ? { ...entry } : null }); };
  const currentPage = async (signal: AbortSignal) => settingsRead(env, "contact", false, () => api.page(env.childId!, signal, env.userId!));
  const apply = (page: NonNullable<ContactViewModel["page"]>) => {
    const currentIds = new Set(page.tasks.map(task => task.id));
    patch({ page, access: page.canManage && env.role !== "viewer" ? "editable" : "read_only", load: "ready",
      dataLabel: "最後讀取：" + new Date().toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }),
      missingTasks: latest.current.page?.tasks.filter(task => !currentIds.has(task.id)).map(task => task.id) ?? [],
      originalConsent: false, confirmationEpoch: latest.current.confirmationEpoch + 1 });
  };
  const failed = (error: unknown, entry?: ContactPending) => {
    const failure = settingsFailure(error);
    if (settingsAccessError(env, error)) { api.resetOnline(); retain(null); patch({ page: null, access: "lost", load: "error", dirty: false, originalConsent: false,
      epoch: ++contactPresentationEpoch, notice: "身份或孩子權限已改變，聯絡資料已清除。" }); return; }
    if (entry && failure.confirmed) entry.confirmed = true;
    if (entry && (entry.confirmed || api.hasPendingOnline() || failure.status === 0 || failure.status >= 500)) {
      entry.reviewed = false; retain(entry); patch({ operation: entry.confirmed ? "confirmed_unread" : "unknown", originalConsent: false,
        notice: entry.confirmed ? "原操作已確認；目前聯絡資料未讀回，請勿重送。" : "原決定結果待查核。原內容及版本保留，請先查原收據及讀取目前資料。" });
    } else { if (entry) retain(null); patch({ operation: entry ? failure.status === 409 ? "conflict" : "failed" : latest.current.operation,
      notice: failure.status === 409 ? "聯絡版本已改變，請先更新並重新核對。" : "聯絡資料未能讀取或決定未獲接納，請手動更新。" }); }
    patch({ load: "error", originalConsent: false, confirmationEpoch: latest.current.confirmationEpoch + 1 });
  };
  const refresh = async () => {
    const request = requests.start(); if (!request || !env.childId || !env.userId) return;
    const entry = pending.current;
    patch({ load: "loading", originalConsent: false, confirmationEpoch: latest.current.confirmationEpoch + 1 });
    if (entry) { entry.reviewed = false; retain(entry); }
    try {
      const receipt = entry ? await api.reconcilePending(request.signal, env.userId) : null;
      if (entry && receipt?.state === "confirmed") { entry.confirmed = true; entry.reference = receipt.operation.opId; }
      const page = await currentPage(request.signal); if (!request.current()) return;
      apply(page);
      if (entry && !entry.confirmed && api.hasPendingOnline()) {
        entry.reviewed = receipt?.state === "unconfirmed"; retain(entry);
        patch({ operation: "unknown", notice: "原決定尚無確認收據；已讀取目前資料。請重新明確同意後才可沿原內容及版本重試。" });
      } else { retain(null); patch({ operation: entry?.confirmed ? "saved" : "none",
        notice: entry?.confirmed ? "原決定已確認；目前聯絡資料已讀回。" : entry ? "已無待查原操作，並未據此視為成功；請核對目前資料再明確保存。" : "目前聯絡資料已更新；未提交選項保留。" }); }
    } catch (error) { if (request.current()) failed(error, entry ?? undefined); }
    finally { request.finish(!!pending.current); }
  };
  const allowed = (decision: ContactDecision) => {
    const page = latest.current.page;
    if (!page?.canManage || env.role === "viewer") return false;
    if (decision.kind === "consent") return decision.input.expectedVersion === page.consent.version && (!decision.input.enabled || decision.input.bindings.length > 0
      && decision.input.bindings.every(binding => page.availableBindings.some(actual => sameContactBinding(actual, binding))));
    if (decision.kind === "authorization") {
      const task = page.tasks.find(item => item.id === decision.taskId), grant = page.grants.find(item => item.taskId === decision.taskId);
      return !!task && task.version === decision.input.expectedTaskVersion && (grant?.version ?? 0) === decision.input.expectedVersion;
    }
    const attempt = page.requests.flatMap(item => item.attempts).find(item => item.id === decision.attemptId);
    return !!attempt && contactMayAcknowledge(attempt, env.userId ?? "");
  };
  const save = async (decision: ContactDecision, labels: string[], retry = false) => {
    const state = latest.current;
    if (!env.childId || !env.userId || state.load !== "ready" || state.access !== "editable" || !state.page?.canManage) return;
    if (!retry && (pending.current || api.hasPendingOnline() || !allowed(decision))) return;
    const entry: ContactPending = retry ? pending.current! : { reference: "", decision: structuredClone(decision), body: JSON.stringify(decision), labels: [...labels], confirmed: false, reviewed: false };
    if (retry && (!entry || !entry.reviewed || entry.confirmed || !state.originalConsent || !api.hasPendingOnline()
      || entry.decision.kind === "authorization" && !state.page.tasks.some(task => entry.decision.kind === "authorization" && task.id === entry.decision.taskId))) return;
    const request = requests.start(true, retry); if (!request) return;
    entry.reviewed = false; retain(entry); patch({ operation: "saving", originalConsent: false, confirmationEpoch: state.confirmationEpoch + 1 });
    try {
      const original = entry.decision;
      if (original.kind === "consent") await api.consent(env.childId, original.input, request.signal, env.userId);
      else if (original.kind === "authorization") await api.authorization(env.childId, original.taskId, original.input, request.signal, env.userId);
      else await api.acknowledge(env.childId, original.attemptId, original.input, request.signal, env.userId);
      entry.confirmed = true;
      if (request.current()) env.invalidate();
      const page = await currentPage(request.signal); if (!request.current()) return;
      apply(page); retain(null); patch({ operation: "saved", dirty: false, notice: original.kind === "acknowledge" ? "已確認收到通知；照護任務完成仍須另行回報。" : "聯絡決定已保存並讀回目前資料。" });
    } catch (error) { if (request.current()) failed(error, entry); }
    finally { request.finish(!!pending.current); }
  };
  const actions: ContactActions = { refresh: () => { void refresh(); }, markDirty() { patch({ dirty: true }); },
    discard() { if (!requests.busy && !pending.current && latest.current.load === "ready") patch({ dirty: false, epoch: ++contactPresentationEpoch, confirmationEpoch: latest.current.confirmationEpoch + 1 }); },
    save: (decision, labels) => { void save(decision, labels); },
    setOriginalConsent(value) { if (pending.current?.reviewed && !pending.current.confirmed) patch({ originalConsent: value }); },
    retryOriginal() { if (pending.current) void save(pending.current.decision, pending.current.labels, true); } };
  useEffect(() => () => { api.resetOnline(); pending.current = null; }, [api]);
  useEffect(() => { if (!env.online) { if (pending.current) { pending.current.reviewed = false; retain(pending.current); } patch({ originalConsent: false, confirmationEpoch: latest.current.confirmationEpoch + 1 }); } }, [env.online]);
  useSettingsRefresh(env, actions.refresh, !requests.busy && !state.pending && !state.dirty);
  useDomainWriteGuard(state.dirty, !!state.pending || requests.writing);
  return { model: { ...state, scopeKey: env.scopeKey, childName: env.childName, userId: env.userId ?? "", online: env.online, busy: requests.busy,
    locked: requests.busy || !env.online || !!state.pending || state.load !== "ready" || state.access !== "editable" || !state.page?.canManage, page: env.current() ? state.page : null,
    access: env.current() ? state.access : "lost" as const }, actions };
}
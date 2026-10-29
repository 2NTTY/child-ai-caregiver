import { useEffect, useRef, useState } from "react";
import { MemoryApiError, type MemoryApi } from "../../../src/client/memory-api";
import type { FactCreate, FactConfirm, FactRevise, FactDeactivate, MemoryDelete, TopicCreate, TopicChange, TopicReopen, MemoryFact, MemoryTopic } from "../../../src/shared/memory";
import type { MemoryFactView, MemoryTopicView } from "../memory-view-model";
import { useDomainWriteGuard } from "./useDomainEnvironment";
import { domainFailure, type TaskKnowledgeEnvironment, type useTaskKnowledgeRuntime } from "./task-knowledge-runtime";

export type MemoryManagementEntity = { kind: "fact"; item: MemoryFactView } | { kind: "topic"; item: MemoryTopicView };
export type MemoryManagementIntent =
  | { kind: "create_fact"; input: FactCreate }
  | { kind: "confirm_fact"; basis: MemoryFactView; input: FactConfirm }
  | { kind: "revise_fact"; basis: MemoryFactView; input: FactRevise }
  | { kind: "deactivate_fact"; basis: MemoryFactView; input: FactDeactivate }
  | { kind: "delete_fact"; basis: MemoryFactView; input: MemoryDelete }
  | { kind: "create_topic"; input: TopicCreate }
  | { kind: "change_topic"; basis: MemoryTopicView; input: TopicChange }
  | { kind: "reopen_topic"; basis: MemoryTopicView; input: TopicReopen }
  | { kind: "delete_topic"; basis: MemoryTopicView; input: MemoryDelete };
type Runtime = ReturnType<typeof useTaskKnowledgeRuntime>;
type Pending = { intent: MemoryManagementIntent; checked: boolean; confirmed: boolean; reference: string | null };
export function useTaskKnowledgeMemoryManagement({ env, api, runtime, loadAll, changed, currentEntity, latestEntity, reading, readFailed }: {
  env: TaskKnowledgeEnvironment; api: MemoryApi; runtime: Runtime; reading(): boolean; readFailed(): void;
  loadAll(signal: AbortSignal, current: () => boolean): Promise<void>;
  changed(intent: MemoryManagementIntent, value: MemoryFact | MemoryTopic | void): void;
  currentEntity(entity: MemoryManagementEntity): MemoryManagementEntity | null;
  latestEntity(entity: MemoryManagementEntity, signal: AbortSignal): Promise<MemoryManagementEntity | null>;
}) {
  const [operation, setOperation] = useState<"none" | "saving" | "saved" | "unknown" | "conflict" | "failed">("none");
  const [pending, setPending] = useState<Pending | null>(null), [dirty, setDirty] = useState(false), [epoch, setEpoch] = useState(0);
  const [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [consent, setConsent] = useState(false);
  const [conflict, setConflict] = useState<{ original: MemoryManagementEntity; latest: MemoryManagementEntity | null } | null>(null);
  const original = useRef<Pending | null>(null), inFlight = useRef(false);
  useEffect(() => () => { inFlight.current = false; original.current = null; api.resetOnline?.(); }, [api]);
  const canManage = env.role === "owner" || env.role === "caregiver";
  useDomainWriteGuard(!runtime.lost && dirty, !runtime.lost && (operation === "saving" || !!pending));
  const entity = (intent: MemoryManagementIntent): MemoryManagementEntity | null => "basis" in intent ? intent.kind.endsWith("fact") ? { kind: "fact", item: intent.basis as MemoryFactView } : { kind: "topic", item: intent.basis as MemoryTopicView } : null;
  const access = (error: unknown) => {
    if (!runtime.accessError(error)) return false;
    api.resetOnline?.(); original.current = null; setPending(null); setConflict(null); setDirty(false); setEpoch(value => value + 1); return true;
  };
  const call = (intent: MemoryManagementIntent, signal: AbortSignal) => {
    const childId = env.childId!, userId = env.userId!;
    switch (intent.kind) {
      case "create_fact": return api.createFact(childId, intent.input, signal, userId);
      case "confirm_fact": return api.confirmFact(childId, intent.basis.id, intent.input, signal, userId);
      case "revise_fact": return api.reviseFact(childId, intent.basis.id, intent.input, signal, userId);
      case "deactivate_fact": return api.deactivateFact(childId, intent.basis.id, intent.input, signal, userId);
      case "delete_fact": return api.deleteFact(childId, intent.basis.id, intent.input, signal, userId);
      case "create_topic": return api.createTopic(childId, intent.input, signal, userId);
      case "change_topic": return api.changeTopic(childId, intent.basis.id, intent.input, signal, userId);
      case "reopen_topic": return api.reopenTopic(childId, intent.basis.id, intent.input, signal, userId);
      case "delete_topic": return api.deleteTopic(childId, intent.basis.id, intent.input, signal, userId);
    }
  };
  const allowed = (intent: MemoryManagementIntent) => {
    if (intent.kind === "create_fact") return intent.input.intendedVisibility === "private" || canManage;
    if (intent.kind === "create_topic") return intent.input.visibility === "private" || canManage && intent.input.confirmShared;
    const basis = entity(intent)!, actual = currentEntity(basis);
    if (!actual || actual.item.childId !== env.childId || actual.item.version !== basis.item.version || (actual.item.visibility === "private" ? !actual.item.authorSelf : !canManage)) return false;
    if (intent.input.expectedVersion !== actual.item.version) return false;
    if (intent.kind === "confirm_fact") return actual.kind === "fact" && actual.item.status !== "confirmed" && actual.item.sourceState === "current"
      && (!actual.item.validUntil || Date.parse(actual.item.validUntil) > Date.now()) && (actual.item.intendedVisibility !== "family" || canManage && intent.input.confirmShared);
    if (intent.kind === "revise_fact") return actual.item.visibility !== "family" || canManage && intent.input.confirmShared;
    if (intent.kind === "deactivate_fact") return actual.kind === "fact" && actual.item.status !== "inactive" && !!intent.input.reason.trim() && intent.input.reason.length <= 500;
    if (intent.kind === "change_topic") return actual.kind === "topic" && !["answered", "resolved"].includes(actual.item.status);
    if (intent.kind === "reopen_topic") return actual.kind === "topic" && ["answered", "resolved"].includes(actual.item.status) && !!intent.input.reason.trim() && intent.input.reason.length <= 500;
    return true;
  };
  const write = (entry: Pending, retry = false) => {
    if (inFlight.current || reading() || !runtime.live() || !env.online || !retry && (!env.canStartWrite() || !allowed(entry.intent))) return;
    inFlight.current = true; original.current = entry; entry.checked = false; setPending({ ...entry }); setBusy(true); setConsent(false); setNotice(""); setOperation("saving");
    void runtime.request(async (signal, current) => {
      try {
        if (await api.getSession(signal) !== env.userId) throw new MemoryApiError(401);
        const value = await call(entry.intent, signal); entry.confirmed = true;
        if (await api.getSession(signal) !== env.userId) throw new MemoryApiError(401);
        if (!current()) return;
        changed(entry.intent, value); setDirty(false); setEpoch(value => value + 1);
        original.current = null; setPending(null); setConflict(null); setOperation("saved");
        try { await loadAll(signal, current); }
        catch (error) { if (!current() || access(error)) return; readFailed(); setNotice("原記憶操作已確認，最新清單未讀回；請重新讀取，毋須再提交。"); }
        if (current()) { setNotice(previous => previous || "記憶操作已確認。"); env.invalidate(); }
      } catch (error) {
        if (!current() || access(error)) return;
        const failure = domainFailure(error); entry.confirmed ||= failure.confirmed;
        if (!entry.confirmed && failure.status === 409 && failure.code === "version_conflict" && entity(entry.intent)) {
          original.current = null; setPending(null); setConflict({ original: entity(entry.intent)!, latest: null }); setOperation("conflict");
          setNotice("版本已改變；原草稿保留。請讀取最新版本並明確重新套用。");
        } else if (entry.confirmed || api.hasPendingOnline?.() || failure.status === 0 || failure.status >= 500 || failure.status === 409) {
          setPending({ ...entry }); setOperation("unknown"); setNotice(entry.confirmed ? "原操作已確認，最新結果待讀回；毋須再次提交。" : "結果未知；原內容與操作識別保留，請先查原收據。");
        } else { original.current = null; setPending(null); setOperation("failed"); setNotice("輸入未獲接納；保留草稿，請核對內容與權限。"); }
      } finally { if (current()) { inFlight.current = false; setBusy(false); } }
    });
  };
  const check = () => {
    if (inFlight.current || reading() || !runtime.live() || !env.online) return;
    inFlight.current = true; setBusy(true); setConsent(false);
    const entry = original.current;
    void runtime.request(async (signal, current) => {
      try {
        if (entry) {
          if (await api.getSession(signal) !== env.userId) throw new MemoryApiError(401);
          const receipt = entry.confirmed ? null : await api.reconcilePending?.(signal, env.userId!);
          if (receipt?.state === "confirmed") { entry.confirmed = true; entry.reference = receipt.operation.opId; }
          if (await api.getSession(signal) !== env.userId) throw new MemoryApiError(401);
        }
        await loadAll(signal, current);
        if (!current()) return;
        if (entry?.confirmed) {
          original.current = null; setPending(null); setDirty(false); setEpoch(value => value + 1); setOperation("saved"); setNotice("原操作已確認，最新記憶已讀回；毋須再次提交。"); env.invalidate();
        } else if (entry) {
          entry.checked = true; setPending({ ...entry }); setOperation("unknown"); setNotice(api.hasPendingOnline?.() ? "已核對目前清單；原操作尚未確認，可明確沿原識別重試。" : "目前沒有待查操作識別；請明確解除提交並重新核對草稿。");
        } else if (conflict) {
          const value = await latestEntity(conflict.original, signal);
          if (current()) { setConflict({ ...conflict, latest: value }); setNotice(value ? "已讀取最新版本，請比較後明確重新套用草稿。" : "未取得最新版本，不能默換原草稿依據。"); }
        }
      } catch (error) {
        if (!current() || access(error)) return;
        if (entry) { entry.confirmed ||= domainFailure(error).confirmed; entry.checked = false; setPending({ ...entry }); }
        readFailed(); setNotice("原收據、清單或最新版本未能核對；原操作及草稿保留，不能另建副本。");
      } finally { if (current()) { inFlight.current = false; setBusy(false); } }
    });
  };
  return {
    operation, pending: runtime.lost ? null : pending, conflict: runtime.lost ? null : conflict, notice, busy, dirty, epoch, consent,
    locked: busy || !!pending || !!conflict || runtime.lost || !env.online,
    markDirty() { if (!busy && !original.current && !runtime.lost) { setDirty(true); setOperation("none"); } },
    discard() {
      if (busy || original.current || !runtime.live()) return false;
      setDirty(false); setConflict(null); setOperation("none"); setEpoch(value => value + 1); return true;
    },
    submit(intent: MemoryManagementIntent) {
      if (original.current || conflict || !allowed(intent)) return;
      write({ intent: structuredClone(intent), checked: false, confirmed: false, reference: null });
    },
    check,
    setConsent(value: boolean) { if (!busy && original.current?.checked && !original.current.confirmed) setConsent(value); },
    retry() { if (consent && original.current?.checked && !original.current.confirmed && api.hasPendingOnline?.()) write(original.current, true); },
    dismissUnsent() { if (!busy && original.current?.checked && !original.current.confirmed && !api.hasPendingOnline?.()) { original.current = null; setPending(null); setOperation("none"); setConsent(false); setNotice("已解除未送出提交，草稿保留；請重新核對及確認。"); } },
    useLatest(): MemoryManagementEntity | null {
      if (busy || original.current || !conflict?.latest) return null;
      const value = conflict.latest; setConflict(null); setOperation("none"); setNotice("已明確使用最新版本；原草稿保留，需要重新確認內容及共享範圍。"); return value;
    },
  };
}
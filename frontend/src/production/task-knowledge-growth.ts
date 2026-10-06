import { useEffect, useMemo, useRef, useState } from "react";
import { createGrowthApi, GrowthApiError, requiresFreshGrowthConfirmation } from "../../../src/client/growth-api";
import { growthActionSchema, growthTopicActionSchema } from "../../../src/shared/growth";
import { growthActionable, growthRefreshNotice, type GrowthAttempt, type GrowthPage, type GrowthPending, type GrowthViewModel } from "../growth-view-model";
import type { GrowthWorkspaceValue } from "../workspaces/GrowthWorkspace";
import { useDomainWriteGuard } from "./useDomainEnvironment";
import { useTaskKnowledgeRefresh, useTaskKnowledgeRuntime, type TaskKnowledgeEnvironment } from "./task-knowledge-runtime";

export function useTaskKnowledgeGrowth(env: TaskKnowledgeEnvironment): GrowthWorkspaceValue {
  const api = useMemo(() => createGrowthApi(env.apiBaseUrl), [env.apiBaseUrl]);
  const runtime = useTaskKnowledgeRuntime(env, "growth");
  const [page, setPage] = useState<GrowthPage | null>(null), [load, setLoad] = useState<GrowthViewModel["load"]>("loading");
  const [busy, setBusy] = useState(false), [pending, setPending] = useState<GrowthPending | null>(null), [originalConsent, setOriginalConsent] = useState(false);
  const [operation, setOperation] = useState<GrowthViewModel["operation"]>("none"), [notice, setNotice] = useState("");
  const [dirtyKeys, setDirtyKeys] = useState<string[]>([]), [discardAsked, setDiscardAsked] = useState(false), [epoch, setEpoch] = useState(0);
  const [resetCounts, setResetCounts] = useState<Record<string, number>>({}), [refreshPending, setRefreshPending] = useState(false), [missingTargets, setMissingTargets] = useState<string[]>([]);
  const inFlight = useRef(false), original = useRef<GrowthPending | null>(null), dirty = dirtyKeys.length > 0;
  useEffect(() => () => { inFlight.current = false; }, []);
  const canManage = env.role === "owner" || env.role === "caregiver";
  useDomainWriteGuard(!runtime.lost && dirty, !runtime.lost && (operation === "saving" || !!pending));
  const projected = (value: GrowthPage): GrowthPage => ({ ...value,
    concerns: { state: "unavailable", items: [], label: "已接有限成長候選；持續關注鏈、歸檔與還原尚未接通。" },
    archive: { scopeKey: env.scopeKey, childId: env.childId!, authorityVersion: value.authorityVersion, state: "unavailable", snapshot: null,
      label: "年度／季度檔案、持續關注歷史及報告尚未接通；沒有用有限候選偽造檔案。" },
  });
  const savePage = (value: GrowthPage, settledKey?: string) => {
    const oldItems = page?.items.filter(item => dirtyKeys.includes(`item:${item.id}`) && `item:${item.id}` !== settledKey && !value.items.some(latest => latest.id === item.id)) ?? [];
    const oldTopics = page?.topics.filter(topic => dirtyKeys.includes(`topic:${topic.id}`) && `topic:${topic.id}` !== settledKey && !value.topics.some(latest => latest.id === topic.id)) ?? [];
    const missing = [...oldItems.map(item => `item:${item.id}`), ...oldTopics.map(topic => `topic:${topic.id}`)];
    setMissingTargets(missing);
    setPage(projected({ ...value, items: [...value.items, ...oldItems.map(item => ({ ...item, sourceAvailable: false }))], topics: [...value.topics, ...oldTopics],
      notices: missing.length ? [...value.notices, "本次候選視窗沒有部分草稿對象；保留原草稿及資料供核對，相關新操作暫停。"] : value.notices }));
  };
  const clearAccess = (error: unknown) => {
    if (!runtime.accessError(error)) return false;
    original.current = null; setPending(null); setPage(null); setDirtyKeys([]); setOriginalConsent(false); setEpoch(value => value + 1); return true;
  };
  const refresh = (manual = true) => {
    if (!env.online || !runtime.live()) return;
    if (inFlight.current || !manual && (dirty || !!original.current)) { setRefreshPending(true); return; }
    inFlight.current = true; setBusy(true); setLoad("loading"); setOriginalConsent(false);
    const entry = original.current;
    void runtime.request(async (signal, current) => {
      try {
        const value = await runtime.read(["page"], next => api.getPage(env.childId!, next, env.userId!), signal);
        if (!current()) return;
        savePage(value); setLoad("ready"); setRefreshPending(false);
        if (entry?.reconfirm) {
          original.current = null; setPending(null); setOperation("conflict");
          setNotice("這次提交未獲接納，已讀取目前版本；保留草稿，請明確重新核對。先前未知結果不能由這次拒絕推定。");
        } else if (entry) {
          const present = entry.attempt.kind === "item" ? value.items.some(item => item.id === entry.attempt.id) : entry.attempt.kind === "topic" && value.topics.some(item => item.id === entry.attempt.id);
          const next = { ...entry, reviewed: present }; original.current = next; setPending(next); setOperation("unknown");
          if (!present) setMissingTargets(previous => Array.from(new Set([...previous, `${entry.attempt.kind}:${entry.attempt.id}`])));
          setNotice(present ? "已讀取目前原對象；結果仍未知。重試只沿原內容、原版本明確提交。" : "目前頁面沒有原對象；原未知請求仍保留，不能推定成功或另建操作。");
        } else setNotice(growthRefreshNotice);
      } catch (error) {
        if (!current() || clearAccess(error)) return;
        setLoad("error"); setNotice("未能讀取最新成長候選；原草稿及操作保留，暫停提交。");
      } finally { if (current()) { inFlight.current = false; setBusy(false); } }
    });
  };
  useTaskKnowledgeRefresh(() => refresh(false), env.online && !!env.childId && !runtime.lost, busy);
  const write = (attempt: Exclude<GrowthAttempt, { kind: "concern" }>, retry = false) => {
    if (inFlight.current || !runtime.live() || !env.online || !canManage || !page?.canManage || load !== "ready" || !retry && !env.canStartWrite()) return;
    const entry: GrowthPending = { attempt, reviewed: false, reconfirm: false };
    inFlight.current = true; original.current = entry; setPending(entry); setBusy(true); setOriginalConsent(false); setOperation("saving");
    void runtime.request(async (signal, current) => {
      try {
        const result = attempt.kind === "item" ? await api.decideAttention(env.childId!, attempt.id, attempt.input, signal, env.userId!)
          : await api.updateTopic(env.childId!, attempt.id, attempt.input, signal, env.userId!);
        if (!current()) return;
        if (attempt.kind === "item") {
          const item = result as GrowthPage["items"][number];
          setPage(before => before ? { ...before, items: before.items.map(old => old.id === item.id ? item : old) } : null);
        } else savePage(result as GrowthPage, `topic:${attempt.id}`);
        const key = `${attempt.kind}:${attempt.id}`;
        setDirtyKeys(before => before.filter(item => item !== key)); setResetCounts(before => ({ ...before, [key]: (before[key] ?? 0) + 1 }));
        original.current = null; setPending(null); setOperation("saved"); setNotice("成長操作已獲 Server 確認；重新讀取可核對目前狀態。"); setMissingTargets([]);
        try {
          const next = await runtime.read(["page"], nextSignal => api.getPage(env.childId!, nextSignal, env.userId!), signal);
          if (current()) { savePage(next, key); setLoad("ready"); }
        } catch (error) {
          if (!current() || clearAccess(error)) return;
          setLoad("error"); setNotice("成長操作已確認，最新頁面未能讀回；請重新讀取，毋須再提交。");
        }
        if (current()) env.invalidate();
      } catch (error) {
        if (!current() || clearAccess(error)) return;
        const failure = error instanceof GrowthApiError ? error : new GrowthApiError();
        entry.reconfirm = requiresFreshGrowthConfirmation(failure); original.current = entry; setPending({ ...entry });
        setOperation(entry.reconfirm ? failure.status === 409 ? "conflict" : "failed" : "unknown");
        setNotice(entry.reconfirm ? "這次提交未獲接納；請重新讀取目前版本，再明確確認。" : "結果未知；原內容及版本保留，不會自動重送。請先重讀並核對原對象。");
      } finally { if (current()) { inFlight.current = false; setBusy(false); } }
    });
  };
  const visible = runtime.lost ? null : page;
  const locked = busy || !!pending || runtime.lost || !env.online || load !== "ready" || !canManage || !visible?.canManage;
  return { scopeKey: env.scopeKey, model: {
    scopeKey: env.scopeKey, childId: env.childId!, childName: env.childName, dataLabel: "Server 有限 P2 成長候選與主題近況；持續關注鏈及檔案尚未接通。",
    online: env.online, access: runtime.lost ? "lost" : canManage && visible?.canManage !== false ? "editable" : "read_only", load,
    page: visible, busy, locked, pending: runtime.lost ? null : pending, originalConsent, operation, notice,
    dirty: !runtime.lost && dirty, discardAsked, epoch, resetCounts, refreshPending, missingTargets,
  }, actions: {
    refresh() { refresh(); }, markDirty(key) { if (!locked) setDirtyKeys(before => before.includes(key) ? before : [...before, key]); },
    askDiscard() { if (!busy) setDiscardAsked(true); },
    discardDrafts() { if (busy || original.current || !runtime.live()) return; setDirtyKeys([]); setEpoch(value => value + 1); setDiscardAsked(false); if (env.online) refresh(); },
    setOriginalConsent(value) { if (!busy && original.current?.reviewed && !original.current.reconfirm) setOriginalConsent(value); },
    retryOriginal() {
      const entry = original.current;
      if (!entry || entry.attempt.kind === "concern" || !entry.reviewed || entry.reconfirm || !originalConsent || busy) return;
      write(entry.attempt, true);
    },
    decide(item, input) {
      const actual = visible?.items.find(value => value.id === item.id);
      const parsed = growthActionSchema.safeParse(input);
      if (locked || missingTargets.includes(`item:${item.id}`) || !actual || actual.childId !== env.childId || !growthActionable(actual) || !parsed.success
        || input.expectedVersion !== actual.version || input.authorityVersion !== visible!.authorityVersion
        || visible!.topics.find(topic => topic.id === actual.topicId)?.disabled !== false) return;

      if (parsed.data.action === "accept" && parsed.data.task.kind === "create") {
        const assigneeId = parsed.data.task.values.assigneeUserId;
        if (!visible!.eligibleAssignees.some(person => person.userId === assigneeId)) return;
      }
      const frozen = structuredClone(parsed.data);
      write({ kind: "item", id: actual.id, input: frozen, body: JSON.stringify(frozen), label: actual.title,
      });
    },
    updateTopic(topic, input) {
      const actual = visible?.topics.find(value => value.id === topic.id), parsed = growthTopicActionSchema.safeParse(input);
      if (locked || missingTargets.includes(`topic:${topic.id}`) || !actual || !parsed.success || input.expectedVersion !== actual.version || input.authorityVersion !== visible!.authorityVersion) return;
      const frozen = structuredClone(parsed.data);
      write({ kind: "topic", id: actual.id, input: frozen, body: JSON.stringify(frozen), label: actual.title });
    },
    archiveConcern() {}, restoreConcern() {},
  } };
}
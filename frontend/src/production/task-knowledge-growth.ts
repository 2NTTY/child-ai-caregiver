import { useEffect, useMemo, useRef, useState } from "react";
import { readGrowthPages } from "./growth-read";
import { createGrowthApi, GrowthApiError, requiresFreshGrowthConfirmation } from "../../../src/client/growth-api";
import { createConcernsApi, ConcernApiError, requiresFreshConcernConfirmation } from "../../../src/client/concerns-api";
import { concernChangeSchema, concernValuesSchema, type Concern, type ConcernPage } from "../../../src/shared/concerns";
import { growthActionSchema, growthTopicActionSchema } from "../../../src/shared/growth";
import { growthActionable, growthConcernCanRestore, growthRefreshNotice, type GrowthAttempt, type GrowthConcernChange, type GrowthPage, type GrowthPending, type GrowthViewModel } from "../growth-view-model";
import type { GrowthWorkspaceValue } from "../workspaces/GrowthWorkspace";
import { useDomainWriteGuard } from "./useDomainEnvironment";
import { useTaskKnowledgeRefresh, useTaskKnowledgeRuntime, type TaskKnowledgeEnvironment } from "./task-knowledge-runtime";

export function useTaskKnowledgeGrowth(env: TaskKnowledgeEnvironment): GrowthWorkspaceValue {
  const api = useMemo(() => createGrowthApi(env.apiBaseUrl, env.owner.fetcher), [env.apiBaseUrl, env.owner.fetcher]);
  const concernsApi = useMemo(() => createConcernsApi(env.apiBaseUrl, env.owner.fetcher), [env.apiBaseUrl, env.owner.fetcher]);
  const runtime = useTaskKnowledgeRuntime(env, "growth");
  const [page, setPage] = useState<GrowthPage | null>(null), [load, setLoad] = useState<GrowthViewModel["load"]>("loading");
  const [busy, setBusy] = useState(false), [pending, setPending] = useState<GrowthPending | null>(null), [originalConsent, setOriginalConsent] = useState(false);
  const [operation, setOperation] = useState<GrowthViewModel["operation"]>("none"), [notice, setNotice] = useState("");
  const [dirtyKeys, setDirtyKeys] = useState<string[]>([]), [discardAsked, setDiscardAsked] = useState(false), [epoch, setEpoch] = useState(0);
  const [resetCounts, setResetCounts] = useState<Record<string, number>>({}), [refreshPending, setRefreshPending] = useState(false), [missingTargets, setMissingTargets] = useState<string[]>([]);
  const [lastConcernChange, setLastConcernChange] = useState<GrowthConcernChange | null>(null);
  const inFlight = useRef(false), original = useRef<GrowthPending | null>(null), dirty = dirtyKeys.length > 0;
  useEffect(() => () => { inFlight.current = false; }, []);
  const canManage = env.role === "owner" || env.role === "caregiver";
  useDomainWriteGuard(!runtime.lost && dirty, !runtime.lost && (operation === "saving" || !!pending));
  const readPage = async (signal: AbortSignal): Promise<GrowthPage> => {
    const [growth, concerns] = await readGrowthPages(
      () => runtime.read(["page"], next => api.getPage(env.childId!, next, env.userId!), signal),
      () => runtime.read(["concerns"], next => concernsApi.getPage(env.childId!, next, env.userId!), signal), signal, undefined, runtime.live,
    );
    return projected(growth, concerns);
  };
  const projected = (value: GrowthPage, concerns: ConcernPage): GrowthPage => ({ ...value,
    concerns: { state: "ready", items: concerns.items, label: "持續關注及已載入的跟進記錄。" },
    archive: { scopeKey: env.scopeKey, childId: env.childId!, authorityVersion: value.authorityVersion, state: "unavailable", snapshot: null,
      label: "年度／季度成長檔案及報告尚未接通。" },
  });
  const savePage = (value: GrowthPage, settledKey?: string) => {
    const oldItems = page?.items.filter(item => dirtyKeys.includes(`item:${item.id}`) && `item:${item.id}` !== settledKey && !value.items.some(latest => latest.id === item.id)) ?? [];
    const oldTopics = page?.topics.filter(topic => dirtyKeys.includes(`topic:${topic.id}`) && `topic:${topic.id}` !== settledKey && !value.topics.some(latest => latest.id === topic.id)) ?? [];
    const missing = [...oldItems.map(item => `item:${item.id}`), ...oldTopics.map(topic => `topic:${topic.id}`)];
    setMissingTargets(missing);
    setPage({ ...value, items: [...value.items, ...oldItems.map(item => ({ ...item, sourceAvailable: false }))], topics: [...value.topics, ...oldTopics],
      notices: missing.length ? [...value.notices, "本次候選視窗沒有部分草稿對象；保留原草稿及資料供核對，相關新操作暫停。"] : value.notices });
  };
  const clearAccess = (error: unknown) => {
    if (!runtime.accessError(error)) return false;
    original.current = null; setPending(null); setPage(null); setLastConcernChange(null); setDirtyKeys([]); setOriginalConsent(false); setEpoch(value => value + 1); return true;
  };
  const refresh = (manual = true) => {
    if (!env.online || !runtime.live()) return;
    if (inFlight.current || !manual && (dirty || !!original.current)) { setRefreshPending(true); return; }
    inFlight.current = true; setBusy(true); setLoad("loading"); setOriginalConsent(false);
    const entry = original.current;
    void runtime.request(async (signal, current) => {
      try {
        const value = await readPage(signal);
        if (!current()) return;
        savePage(value); setLoad("ready"); setRefreshPending(false);
        if (entry?.reconfirm) {
          original.current = null; setPending(null); setOperation("conflict");
          setNotice("這次提交未獲接納，已讀取目前版本；保留草稿，請明確重新核對。先前未知結果不能由這次拒絕推定。");
        } else if (entry) {
          const present = entry.attempt.kind === "item" ? value.items.some(item => item.id === entry.attempt.id)
            : entry.attempt.kind === "topic" ? value.topics.some(item => item.id === entry.attempt.id)
              : entry.attempt.kind === "concern_create" ? true
              : value.concerns?.items.some(item => item.childId === env.childId && item.id === entry.attempt.id) === true;
          const next = { ...entry, reviewed: present }; original.current = next; setPending(next); setOperation("unknown");
          if (!present) setMissingTargets(previous => Array.from(new Set([...previous, `${entry.attempt.kind}:${entry.attempt.id}`])));
          setNotice(entry.attempt.kind === "concern_create" ? "已核對目前孩子及權限；建立結果仍未知。查回只沿原操作及內容，不另建關注。"
            : present ? "已讀取目前原對象；結果仍未知。重試只沿原內容、原版本明確提交。" : "目前頁面沒有原對象；原未知請求仍保留，不能推定成功或另建操作。");
        } else setNotice(growthRefreshNotice);
      } catch (error) {
        if (!current() || clearAccess(error)) return;
        setLoad("error"); setNotice(entry ? "未能核對原操作；原草稿及操作保留，請重新讀取。" : page ? "未能更新，仍顯示上次讀取的關注。" : "未能讀取關注，請重試。");
      } finally { if (current()) { inFlight.current = false; setBusy(false); } }
    });
  };
  useTaskKnowledgeRefresh(() => refresh(false), env.online && !!env.childId && !runtime.lost, busy);
  const write = (attempt: GrowthAttempt, retry = false) => {
    if (inFlight.current || !runtime.live() || !env.online || !canManage || !page?.canManage || load !== "ready" || !retry && !env.canStartWrite()) return;
    const entry: GrowthPending = { attempt, reviewed: false, reconfirm: false };
    inFlight.current = true; original.current = entry; setPending(entry); setBusy(true); setOriginalConsent(false); setOperation("saving");
    void runtime.request(async (signal, current) => {
      try {
        const result = attempt.kind === "item" ? await api.decideAttention(env.childId!, attempt.id, attempt.input, signal, env.userId!)
          : attempt.kind === "topic" ? await api.updateTopic(env.childId!, attempt.id, attempt.input, signal, env.userId!)
            : attempt.kind === "concern_create" ? await concernsApi.create(env.childId!, attempt.input, signal, env.userId!)
            : await concernsApi.change(env.childId!, attempt.id, concernChangeSchema.parse(attempt.input), signal, env.userId!);
        if (!current()) return;
        if (attempt.kind === "item") {
          const item = result as GrowthPage["items"][number];
          setPage(before => before ? { ...before, items: before.items.map(old => old.id === item.id ? item : old) } : null);
        } else if (attempt.kind !== "topic") {
          const concern = result as Concern;
          setPage(before => before?.concerns?.state === "ready" ? { ...before, concerns: { ...before.concerns,
            items: before.concerns.items.some(old => old.id === concern.id) ? before.concerns.items.map(old => old.id === concern.id ? concern : old)
              : [concern, ...before.concerns.items] } } : before);
          if (attempt.kind === "concern") setLastConcernChange({ scopeKey: env.scopeKey, authorityVersion: attempt.input.authorityVersion,
            id: concern.id, version: concern.version, action: attempt.input.action });
        }
        const key = `${attempt.kind}:${attempt.id}`;
        setDirtyKeys(before => before.filter(item => item !== key)); setResetCounts(before => ({ ...before, [key]: (before[key] ?? 0) + 1 }));
        original.current = null; setPending(null); setOperation("saved");
        setNotice(attempt.kind === "concern_create" ? "已建立這條家庭共享關注，可查看原始觀察及站內跟進狀態。"
          : attempt.kind === "concern_update" ? attempt.input.action === "append" ? "已追加這次觀察，原有經過及連結任務保留。"
            : attempt.input.followUpAt ? "已保存這次站內跟進安排；實際處理狀態以關注歷程為準。" : "已撤回這次站內跟進安排，原有觀察及連結任務保留。"
          : attempt.kind === "concern" ? attempt.input.action === "archive" ? "已結束這條關注，原有經過及連結任務保留。" : "已恢復這條關注，前後經過及連結任務保留。"
          : "成長操作已確認；重新讀取可核對目前狀態。"); setMissingTargets([]);
        try {
          const next = await readPage(signal);
          if (current()) { savePage(next, key); setLoad("ready"); }
        } catch (error) {
          if (!current() || clearAccess(error)) return;
          setLoad("error"); setNotice("成長操作已確認，最新頁面未能讀回；請重新讀取，毋須再提交。");
        }
        if (current()) env.invalidate();
      } catch (error) {
        if (!current() || clearAccess(error)) return;
        const failure = attempt.kind !== "item" && attempt.kind !== "topic" ? error instanceof ConcernApiError ? error : new ConcernApiError()
          : error instanceof GrowthApiError ? error : new GrowthApiError();
        entry.reconfirm = failure instanceof ConcernApiError ? requiresFreshConcernConfirmation(failure) : requiresFreshGrowthConfirmation(failure);
        original.current = entry; setPending({ ...entry });
        setOperation(entry.reconfirm ? failure.status === 409 ? "conflict" : "failed" : "unknown");
        setNotice(entry.reconfirm ? "這次提交未獲接納；請重新讀取目前版本，再明確確認。" : "結果未知；原內容及版本保留，不會自動重送。請先重讀並核對原對象。");
      } finally { if (current()) { inFlight.current = false; setBusy(false); } }
    });
  };
  const visible = runtime.lost ? null : page;
  const locked = busy || !!pending || runtime.lost || !env.online || load !== "ready" || !canManage || !visible?.canManage;
  const changeConcern = (id: string, expectedVersion: number, authorityVersion: string, action: "archive" | "restore") => {
    const actual = visible?.concerns?.state === "ready" ? visible.concerns.items.find(item => item.id === id && item.childId === env.childId) : null;
    if (locked || dirty || !actual || actual.version !== expectedVersion || authorityVersion !== visible?.authorityVersion
      || action === "archive" && actual.status === "closed" || action === "restore" && !growthConcernCanRestore(actual)) return;
    const parsed = concernChangeSchema.safeParse({ action, expectedVersion, authorityVersion, confirm: true });
    if (!parsed.success || parsed.data.action !== "archive" && parsed.data.action !== "restore") return;
    const frozen = structuredClone(parsed.data);
    write({ kind: "concern", id: actual.id, input: frozen, body: JSON.stringify(frozen), label: actual.title });
  };
  return { scopeKey: env.scopeKey, model: {
    scopeKey: env.scopeKey, childId: env.childId!, childName: env.childName, dataLabel: "可核對的成長建議",
    online: env.online, access: runtime.lost ? "lost" : canManage && visible?.canManage !== false ? "editable" : "read_only", load,
    page: visible, busy, locked, pending: runtime.lost ? null : pending, originalConsent, operation, notice,
    dirty: !runtime.lost && dirty, discardAsked, epoch, resetCounts, refreshPending, missingTargets, lastConcernChange: runtime.lost ? null : lastConcernChange,
  }, actions: {
    refresh() { refresh(); }, markDirty(key) { if (!locked) setDirtyKeys(before => before.includes(key) ? before : [...before, key]); },
    discardLocalDraft(key) {
      if (!runtime.live() || original.current && `${original.current.attempt.kind}:${original.current.attempt.id}` === key) return;
      setDirtyKeys(before => before.filter(item => item !== key));
    },
    askDiscard() { if (!busy) setDiscardAsked(true); },
    discardDrafts() { if (busy || original.current || !runtime.live()) return; setDirtyKeys([]); setEpoch(value => value + 1); setDiscardAsked(false); if (env.online) refresh(); },
    setOriginalConsent(value) { if (!busy && original.current?.reviewed && !original.current.reconfirm) setOriginalConsent(value); },
    retryOriginal() {
      const entry = original.current;
      if (!entry || !entry.reviewed || entry.reconfirm || !originalConsent || busy) return;
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
    archiveConcern(id, expectedVersion, authorityVersion) { changeConcern(id, expectedVersion, authorityVersion, "archive"); },
    restoreConcern(id, expectedVersion, authorityVersion) { changeConcern(id, expectedVersion, authorityVersion, "restore"); },
    createConcern(input, authorityVersion, confirmShared) {
      const parsed = concernValuesSchema.safeParse(input);
      if (locked || !confirmShared || visible?.concerns?.state !== "ready" || authorityVersion !== visible.authorityVersion || !parsed.success) return;
      const frozen = structuredClone(parsed.data);
      write({ kind: "concern_create", id: "new", input: frozen, authorityVersion, body: JSON.stringify(frozen), label: `建立關注：${frozen.title}` });
    },
    updateConcern(id, input, confirmShared) {
      const actual = visible?.concerns?.state === "ready" ? visible.concerns.items.find(item => item.id === id && item.childId === env.childId) : null;
      const parsed = concernChangeSchema.safeParse(input);
      if (locked || !confirmShared || !actual || actual.status !== "following" || !parsed.success
        || parsed.data.action !== "append" && parsed.data.action !== "schedule_followup"
        || input.expectedVersion !== actual.version || input.authorityVersion !== visible?.authorityVersion) return;
      const frozen = structuredClone(parsed.data);
      write({ kind: "concern_update", id: actual.id, input: frozen, body: JSON.stringify(frozen), label: `${frozen.action === "append" ? "追加觀察" : "站內跟進"}：${actual.title}` });
    },
  } };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { HistoryPage } from "../shared/care.ts";
import type { ConversationSummary, FactSource, FactValues, MemoryFact, MemoryTopic, MemoryVisibility, TopicStatus } from "../shared/memory.ts";
import type { Child } from "../shared/records.ts";
import { MemoryApiError, type MemoryApi } from "./memory-api.ts";
import { ONLINE_REFRESH_EVENT } from "./use-online-updates.ts";

type Role = Child["accessRole"];
interface Props { userId: string; childId: string; role: Role; api: MemoryApi; onSessionChanged: () => void; active?: boolean }
type Entity = { kind: "fact"; item: MemoryFact } | { kind: "topic"; item: MemoryTopic };
type Write = { label: string; kind: "fact" | "topic"; target?: Entity };
type WriteOperation = (signal: AbortSignal, current: () => boolean) => Promise<void>;
type Conflict = { original: Entity; latest: Entity | null; reviewed: boolean };
const emptyValues = (): FactValues => ({ key: "", content: "", source: { kind: "manual", description: "" }, validUntil: null });
const factStatus: Record<MemoryFact["status"], string> = { candidate: "待確認候選", confirmed: "已確認", inactive: "不活躍" };
const topicStatusText: Record<TopicStatus, string> = { pending: "待處理", answered: "已回答", snoozed: "已暫緩", resolved: "已解決" };
const visibilityText: Record<MemoryVisibility, string> = { private: "只供自己查看", family: "與家庭共享" };
const isoValid = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
const sourceText = (source: FactSource) => `${source.kind === "manual" ? "手動描述" : source.kind === "care_record" ? "照顧記錄" : "私人聊天"}：${source.description}${source.kind === "care_record" ? `（記錄版本 ${source.version}）` : ""}${source.kind === "private_chat" && !source.messageId ? "（訊息編號已隱藏）" : ""}`;
const factText = (item: MemoryFact) => `${item.key}：${item.content}；${sourceText(item.source)}；有效至：${item.validUntil ?? "未設定"}；${visibilityText[item.visibility]}；狀態：${factStatus[item.status]}；版本 ${item.version}`;
const topicText = (item: MemoryTopic) => `${item.title}；${item.note || "沒有備註"}；${visibilityText[item.visibility]}；狀態：${topicStatusText[item.status]}；版本 ${item.version}${item.resumeAfter ? `；暫緩至 ${item.resumeAfter}` : ""}`;
function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
function Field({ label, value, onChangeText, editable = true, multiline = false, placeholder }: { label: string; value: string; onChangeText: (value: string) => void; editable?: boolean; multiline?: boolean; placeholder?: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} editable={editable} multiline={multiline} placeholder={placeholder} style={[styles.input, multiline && styles.multiline]} /></View>;
}
function Choice<T extends string>({ values, selected, labels, onSelect, disabled }: { values: readonly T[]; selected: T; labels: Record<T, string>; onSelect: (value: T) => void; disabled: boolean }) {
  return <View style={styles.row}>{values.map(value => <Action key={value} label={`${selected === value ? "已選：" : ""}${labels[value]}`} onPress={() => onSelect(value)} disabled={disabled} />)}</View>;
}

export function MemoryPanel({ userId, childId, role, api, onSessionChanged, active = true }: Props) {
  const scope = `${userId}\n${childId}\n${role}`;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const activeRef = useRef(active); activeRef.current = active;
  const generation = useRef(0);
  const requests = useRef(new Set<AbortController>());
  const inFlight = useRef(false);
  const pendingWrite = useRef<{ write: Write; controller: AbortController } | null>(null);
  const pendingAttempt = useRef<{ label: string; operation: WriteOperation; write: Write } | null>(null);
  const activeWrite = useRef<Write | null>(null);
  const confirmedUnknown = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const [visibleScope, setVisibleScope] = useState(scope);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [factCursor, setFactCursor] = useState<string | null>(null);
  const [topics, setTopics] = useState<MemoryTopic[]>([]);
  const [topicCursor, setTopicCursor] = useState<string | null>(null);
  const [summary, setSummary] = useState<ConversationSummary | null>(null);
  const [factBasis, setFactBasis] = useState<MemoryFact | null>(null);
  const [factDraft, setFactDraft] = useState<FactValues>(emptyValues);
  const [intendedVisibility, setIntendedVisibility] = useState<MemoryVisibility>("private");
  const [factReason, setFactReason] = useState("");
  const [factPreview, setFactPreview] = useState(false);
  const [factSharedChecked, setFactSharedChecked] = useState(false);
  const [topicBasis, setTopicBasis] = useState<MemoryTopic | null>(null);
  const [topicTitle, setTopicTitle] = useState("");
  const [topicNote, setTopicNote] = useState("");
  const [topicVisibility, setTopicVisibility] = useState<MemoryVisibility>("private");
  const [topicStatus, setTopicStatus] = useState<TopicStatus>("pending");
  const [resumeAfter, setResumeAfter] = useState("");
  const [topicReason, setTopicReason] = useState("");
  const [topicPreview, setTopicPreview] = useState(false);
  const [topicSharedChecked, setTopicSharedChecked] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<Entity | null>(null);
  const [historyItems, setHistoryItems] = useState<(MemoryFact | MemoryTopic)[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Entity | null>(null);
  const [uncertain, setUncertain] = useState<Write | null>(null);
  const [uncertainReviewed, setUncertainReviewed] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const canManage = role === "owner" || role === "caregiver";
  const locked = !active || !!busy || !!uncertain || !!conflict;

  const clear = useCallback(() => {
    setFacts([]); setFactCursor(null); setTopics([]); setTopicCursor(null); setSummary(null);
    setFactBasis(null); setFactDraft(emptyValues()); setIntendedVisibility("private"); setFactReason(""); setFactPreview(false); setFactSharedChecked(false);
    setTopicBasis(null); setTopicTitle(""); setTopicNote(""); setTopicVisibility("private"); setTopicStatus("pending"); setResumeAfter(""); setTopicReason(""); setTopicPreview(false); setTopicSharedChecked(false);
    setHistoryTarget(null); setHistoryItems([]); setHistoryCursor(null); setDeleteTarget(null);
  }, []);
  const resetFact = () => { setFactBasis(null); setFactDraft(emptyValues()); setIntendedVisibility("private"); setFactReason(""); setFactPreview(false); setFactSharedChecked(false); };
  const resetTopic = () => { setTopicBasis(null); setTopicTitle(""); setTopicNote(""); setTopicVisibility("private"); setTopicStatus("pending"); setResumeAfter(""); setTopicReason(""); setTopicPreview(false); setTopicSharedChecked(false); };
  const editFact = (item: MemoryFact) => { setFactBasis(item); setFactDraft({ key: item.key, content: item.content, source: item.source, validUntil: item.validUntil }); setIntendedVisibility(item.intendedVisibility); setFactReason(""); setFactPreview(false); setFactSharedChecked(false); setDeleteTarget(null); };
  const editTopic = (item: MemoryTopic) => { setTopicBasis(item); setTopicTitle(item.title); setTopicNote(item.note); setTopicVisibility(item.visibility); setTopicStatus(item.status); setResumeAfter(item.resumeAfter ?? ""); setTopicReason(""); setTopicPreview(false); setTopicSharedChecked(false); setDeleteTarget(null); };
  const verified = useCallback(async <T,>(operation: (signal: AbortSignal) => Promise<T>, signal: AbortSignal) => {
    if (await api.getSession(signal) !== userId) throw new MemoryApiError(401);
    const result = await operation(signal);
    if (activeWrite.current) confirmedUnknown.current = true;
    if (await api.getSession(signal) !== userId) throw new MemoryApiError(401);
    return result;
  }, [api, userId]);
  const run = useCallback(async (label: string, operation: WriteOperation, write?: Write, retry = false) => {
    if (!active || inFlight.current || (write && (conflict || (uncertain && !retry)))) return;
    inFlight.current = true;
    const started = generation.current, requestScope = scope;
    const controller = new AbortController(); requests.current.add(controller);
    if (write) {
      pendingWrite.current = { write, controller };
      pendingAttempt.current = { label, operation, write };
      activeWrite.current = write;
      confirmedUnknown.current = false;
      if (retry) { setUncertain(null); setUncertainReviewed(false); }
    }
    const current = () => activeRef.current && !controller.signal.aborted && generation.current === started && scopeRef.current === requestScope;
    setBusy(label); setNotice("");
    try {
      await operation(controller.signal, current);
      if (write && current()) {
        pendingAttempt.current = null; confirmedUnknown.current = false;
        setUncertain(null); setUncertainReviewed(false);
      }
    }
    catch (error) {
      if (!current()) return;
      const status = error instanceof MemoryApiError ? error.status : 0;
      const code = error instanceof MemoryApiError ? error.onlineCode : null;
      if (error instanceof MemoryApiError && error.confirmed) confirmedUnknown.current = true;
      if ([401, 403, 404].includes(status)) {
        api.resetOnline?.(); pendingAttempt.current = null; confirmedUnknown.current = false;
        clear(); setUncertain(null); setConflict(null); setNotice("登入帳號或孩子權限已改變，資料及表單已清除。請重新選擇孩子。"); onSessionChanged();
      } else if (write && confirmedUnknown.current) {
        setUncertain(write); setUncertainReviewed(false); setSummary(null);
        setNotice("Server 已確認原操作，但結果或會話讀取未能完成。請查收據並重新讀取；毋須再次提交。");
      } else if (status === 409 && write && code === "version_conflict" && write.target) {
        let sameUser: boolean | null = null;
        try { sameUser = await api.getSession(controller.signal) === userId; } catch { /* Keep the draft blocked until identity can be checked. */ }
        if (!current()) return;
        if (sameUser === false) { api.resetOnline?.(); pendingAttempt.current = null; clear(); setUncertain(null); setConflict(null); setNotice("登入帳號已改變，資料及表單已清除。"); onSessionChanged(); }
        else if (sameUser) { pendingAttempt.current = null; setConflict({ original: write.target, latest: null, reviewed: false }); setFactPreview(false); setTopicPreview(false); setNotice("版本已改變。草稿仍在；請重新讀取最新版本，再比較及明確重新套用。"); }
        else { setUncertain(write); setUncertainReviewed(false); setNotice("暫未能核對登入帳號。草稿保留；請先查收據。"); }
      } else if (status === 409 && write && code === "session_changed") {
        let sameUser: boolean | null = null;
        try { sameUser = await api.getSession(controller.signal) === userId; } catch { /* Keep the draft blocked. */ }
        if (!current()) return;
        if (sameUser === false) { api.resetOnline?.(); pendingAttempt.current = null; clear(); setUncertain(null); setConflict(null); setNotice("登入帳號已改變，資料及表單已清除。"); onSessionChanged(); }
        else { setUncertain(write); setUncertainReviewed(false); setNotice("登入狀態或原操作尚待核對，草稿保留；不能當作版本更正。"); }
      } else if (status === 409 && write) {
        setUncertain(write); setUncertainReviewed(false);
        setNotice(code === "storage_epoch_changed" || code === "operation_mismatch"
          ? "Server 世代或原操作識別不符。草稿及操作識別保留；請先查收據，不能當作版本更正或另建副本。"
          : "原操作尚待核對。草稿及操作識別保留；請重新讀取收據，不會自動重送。");
      } else if (status === 400 || status === 415 || status === 428) setNotice("輸入未被接納，請核對內容及登入帳號後再試。");
      else if (status >= 400 && status < 500) setNotice("操作未被接納，請核對權限及內容。");
      else { if (write) { setUncertain(write); setUncertainReviewed(false); } setNotice(write ? "提交結果未知。草稿及原操作識別保留；請先查收據，系統不會自動重送。" : "讀取失敗，請稍後重新讀取；表單已保留。"); }
    } finally {
      requests.current.delete(controller);
      if (pendingWrite.current?.controller === controller) {
        if (!activeRef.current && scopeRef.current === requestScope) { setUncertain(pendingWrite.current.write); setUncertainReviewed(false); setSummary(null); }
        pendingWrite.current = null; activeWrite.current = null;
      }
      if (current()) { inFlight.current = false; setBusy(""); }
    }
  }, [scope, api, userId, active, uncertain, conflict, clear, onSessionChanged]);
  const loadAll = useCallback(async (signal: AbortSignal, current: () => boolean) => {
    const [nextFacts, nextTopics, nextSummary] = await verified(next => Promise.all([api.facts(childId, null, next), api.topics(childId, null, next), api.summary(childId, next)]), signal);
    if (!current()) return;
    setFacts(nextFacts.items); setFactCursor(nextFacts.nextAfterId); setTopics(nextTopics.items); setTopicCursor(nextTopics.nextAfterId); setSummary(nextSummary);
  }, [api, childId, verified]);
  useEffect(() => {
    generation.current++;
    for (const request of requests.current) request.abort(); requests.current.clear(); inFlight.current = false;
    clear(); setVisibleScope(scope); setBusy(""); setNotice(""); setUncertain(null); setUncertainReviewed(false); setConflict(null);
    pendingWrite.current = null; pendingAttempt.current = null; activeWrite.current = null; confirmedUnknown.current = false;
    api.resetOnline?.();
    return () => {
      generation.current++; for (const request of requests.current) request.abort(); requests.current.clear(); inFlight.current = false;
      pendingWrite.current = null; pendingAttempt.current = null; activeWrite.current = null; confirmedUnknown.current = false; api.resetOnline?.();
    };
  }, [scope, clear]);
  useEffect(() => {
    if (active) return;
    if (pendingWrite.current) { setUncertain(pendingWrite.current.write); setUncertainReviewed(false); pendingWrite.current = null; activeWrite.current = null; setSummary(null); }
    generation.current++;
    for (const request of requests.current) request.abort();
    requests.current.clear(); inFlight.current = false; setBusy("");
  }, [active]);
  useEffect(() => {
    if (visibleScope !== scope || !active) return;
    void run("讀取", loadAll);
    // A hidden or offline panel keeps drafts and starts only a read when active again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, visibleScope, active]);
  const refresh = () => { void run("重新讀取", async (signal, current) => {
    let receipt: Awaited<ReturnType<NonNullable<MemoryApi["reconcilePending"]>>> = null;
    let lookupIssue: string | null = null;
    if (uncertain && !confirmedUnknown.current && api.reconcilePending) {
      if (await api.getSession(signal) !== userId) throw new MemoryApiError(401);
      try { receipt = await api.reconcilePending(signal, userId); }
      catch (error) {
        if (error instanceof MemoryApiError && (error.onlineCode === "storage_epoch_changed" || error.onlineCode === "operation_mismatch")) lookupIssue = error.onlineCode;
        else throw error;
      }
      if (receipt?.state === "confirmed") confirmedUnknown.current = true;
      if (await api.getSession(signal) !== userId) throw new MemoryApiError(401);
    }
    if (uncertain && (receipt?.state === "confirmed" || confirmedUnknown.current)) {
      if (!current()) return;
      if (uncertain.kind === "fact") resetFact(); else resetTopic();
      setDeleteTarget(null); setHistoryTarget(null); setHistoryItems([]); setHistoryCursor(null);
      setUncertain(null); setUncertainReviewed(false); setSummary(null); pendingAttempt.current = null; confirmedUnknown.current = false;
      try { await loadAll(signal, current); }
      catch (error) {
        if (error instanceof MemoryApiError && [401, 403, 404].includes(error.status)) throw error;
        if (current()) setNotice("Server 已確認原操作。清單重新讀取失敗，請稍後手動讀取；毋須再次提交。");
        return;
      }
      if (current()) setNotice("Server 已確認原操作，已清除這次操作草稿並重新讀取；毋須再次提交。");
      return;
    }
    await loadAll(signal, current);
    if (!current()) return;
    if (uncertain) {
      if (lookupIssue) { setUncertainReviewed(false); setNotice("原操作識別或 Server 世代尚未核對。已更新清單，草稿保留；不能另建副本或當作版本更正。"); }
      else {
        setUncertainReviewed(true);
        setNotice(receipt?.state === "unconfirmed"
          ? "原操作尚未確認。已核對清單；如要重試，須明確沿原操作識別提交。"
          : "沒有待核對的操作識別。已核對清單，草稿保留；請明確處理這次未送出的提交。");
      }
    } else if (conflict) {
      const { original } = conflict;
      const page = original.kind === "fact"
        ? await verified(next => api.factHistory(childId, original.item.id, null, next), signal)
        : await verified(next => api.topicHistory(childId, original.item.id, null, next), signal);
      if (!current()) return;
      const item = page.revisions[0];
      const latest = item ? ({ kind: original.kind, item } as Entity) : null;
      setConflict({ original, latest, reviewed: !!latest });
      setNotice(latest ? "已讀取最新版本。請比較原版本、最新版本及草稿，然後明確重新套用。" : "未找到最新版本，不能重新套用草稿；可保留草稿另行核對。");
    } else setNotice("資料已更新；未提交草稿仍保留。");
  }); };
  refreshRef.current = () => { void run("更新記憶", async (signal, current) => { await loadAll(signal, current); }); };
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const update = () => refreshRef.current();
    window.addEventListener(ONLINE_REFRESH_EVENT, update);
    return () => window.removeEventListener(ONLINE_REFRESH_EVENT, update);
  }, [active, scope]);
  const nextFacts = () => { if (!factCursor) return; void run("載入事實", async (signal, current) => { const page = await verified(next => api.facts(childId, factCursor, next), signal); if (current()) { setFacts(previous => [...previous, ...page.items.filter(item => !previous.some(existing => existing.id === item.id))]); setFactCursor(page.nextAfterId); } }); };
  const nextTopics = () => { if (!topicCursor) return; void run("載入話題", async (signal, current) => { const page = await verified(next => api.topics(childId, topicCursor, next), signal); if (current()) { setTopics(previous => [...previous, ...page.items.filter(item => !previous.some(existing => existing.id === item.id))]); setTopicCursor(page.nextAfterId); } }); };
  const showHistory = (target: Entity, before: number | null = null) => { void run("讀取歷史", async (signal, current) => {
    const page: HistoryPage<MemoryFact | MemoryTopic> = target.kind === "fact"
      ? await verified(next => api.factHistory(childId, target.item.id, before, next), signal)
      : await verified(next => api.topicHistory(childId, target.item.id, before, next), signal);
    if (current()) { setHistoryTarget(target); setHistoryItems(previous => before === null ? page.revisions : [...previous, ...page.revisions]); setHistoryCursor(page.nextBeforeVersion); }
  }); };
  const updateFact = (item: MemoryFact) => setFacts(previous => [item, ...previous.filter(old => old.id !== item.id)]);
  const updateTopic = (item: MemoryTopic) => setTopics(previous => [item, ...previous.filter(old => old.id !== item.id)]);
  const factValid = !!factDraft.key.trim() && factDraft.key.length <= 100 && !!factDraft.content.trim() && factDraft.content.length <= 4000 && !!factDraft.source.description.trim() && factDraft.source.description.length <= 500 && (!factDraft.validUntil || isoValid(factDraft.validUntil)) && !(factDraft.source.kind === "private_chat" && !factDraft.source.messageId);
  const factUnchanged = !factBasis || (factDraft.key === factBasis.key && factDraft.content === factBasis.content && factDraft.validUntil === factBasis.validUntil && JSON.stringify(factDraft.source) === JSON.stringify(factBasis.source));
  const saveFact = () => {
    const basis = factBasis, values = factDraft;
    void run(basis ? "更正事實" : "新增候選事實", async (signal, current) => {
      const item = basis ? await verified(next => api.reviseFact(childId, basis.id, { values, expectedVersion: basis.version, reason: factReason, confirm: true, confirmShared: basis.visibility === "family" }, next, userId), signal)
        : await verified(next => api.createFact(childId, { values, intendedVisibility }, next, userId), signal);
      if (current()) { updateFact(item); setSummary(null); resetFact(); setNotice(basis ? "事實已更正，舊版本保留在歷史。" : "候選事實已建立，確認前只供自己查看。"); }
    }, { kind: "fact", label: basis ? "更正事實" : "新增候選事實", target: basis ? { kind: "fact", item: basis } : undefined });
  };
  const confirmFact = (item: MemoryFact) => { void run("確認事實", async (signal, current) => {
    const result = await verified(next => api.confirmFact(childId, item.id, { expectedVersion: item.version, confirm: true, confirmShared: item.intendedVisibility === "family" }, next, userId), signal);
    if (current()) { updateFact(result); setSummary(null); resetFact(); setNotice("事實已確認。"); }
  }, { kind: "fact", label: "確認事實", target: { kind: "fact", item } }); };
  const deactivateFact = (item: MemoryFact) => { if (!factUnchanged) return; void run("停用事實", async (signal, current) => {
    const result = await verified(next => api.deactivateFact(childId, item.id, { expectedVersion: item.version, reason: factReason }, next, userId), signal);
    if (current()) { updateFact(result); setSummary(null); resetFact(); setNotice("事實已標記為不活躍。"); }
  }, { kind: "fact", label: "停用事實", target: { kind: "fact", item } }); };
  const topicValid = !!topicTitle.trim() && topicTitle.length <= 200 && topicNote.length <= 2000 && (topicStatus !== "snoozed" || isoValid(resumeAfter));
  const saveTopic = () => {
    const basis = topicBasis;
    void run(basis ? "更新話題" : "新增話題", async (signal, current) => {
      const item = basis ? await verified(next => api.changeTopic(childId, basis.id, { expectedVersion: basis.version, status: topicStatus, note: topicNote, resumeAfter: topicStatus === "snoozed" ? resumeAfter : null }, next, userId), signal)
        : await verified(next => api.createTopic(childId, { title: topicTitle, note: topicNote, visibility: topicVisibility, confirmShared: topicVisibility === "family" }, next, userId), signal);
      if (current()) { updateTopic(item); setSummary(null); resetTopic(); setNotice(basis ? "話題狀態已更新。這不代表已完成任何任務。" : "話題已建立，這不代表已建立任務。"); }
    }, { kind: "topic", label: basis ? "更新話題" : "新增話題", target: basis ? { kind: "topic", item: basis } : undefined });
  };
  const reopenTopic = () => { if (!topicBasis) return; const basis = topicBasis; void run("重開話題", async (signal, current) => {
    const item = await verified(next => api.reopenTopic(childId, basis.id, { expectedVersion: basis.version, reason: topicReason }, next, userId), signal);
    if (current()) { updateTopic(item); setSummary(null); resetTopic(); setNotice("已建立新的待處理話題；原來的已回答／已解決話題仍保留。"); }
  }, { kind: "topic", label: "重開話題", target: { kind: "topic", item: basis } }); };
  const deleteItem = (target: Entity) => { void run("永久刪除", async (signal, current) => {
    if (target.kind === "fact") await verified(next => api.deleteFact(childId, target.item.id, { expectedVersion: target.item.version, confirmDelete: true }, next, userId), signal);
    else await verified(next => api.deleteTopic(childId, target.item.id, { expectedVersion: target.item.version, confirmDelete: true }, next, userId), signal);
    if (current()) { if (target.kind === "fact") { setFacts(previous => previous.filter(item => item.id !== target.item.id)); resetFact(); } else { setTopics(previous => previous.filter(item => item.id !== target.item.id)); resetTopic(); } setSummary(null); setDeleteTarget(null); setHistoryTarget(null); setHistoryItems([]); setNotice("記憶及全部歷史已永久刪除。"); }
  }, { kind: target.kind, label: "永久刪除", target }); };
  const retryUnknown = () => {
    const attempt = pendingAttempt.current;
    if (!active || !uncertain || !uncertainReviewed || confirmedUnknown.current || !api.hasPendingOnline?.() || !attempt || attempt.write.kind !== uncertain.kind) return;
    void run(attempt.label, attempt.operation, attempt.write, true);
  };
  const dismissUnsent = () => {
    if (!active || !uncertain || !uncertainReviewed || confirmedUnknown.current || api.hasPendingOnline?.()) return;
    pendingAttempt.current = null; setUncertain(null); setUncertainReviewed(false);
    setFactPreview(false); setTopicPreview(false);
    setNotice("這次提交沒有建立待核對的操作識別。草稿仍在；如需提交，請重新預覽及確認。");
  };
  const setFactField = (key: "key" | "content", value: string) => { setFactDraft(previous => ({ ...previous, [key]: value })); setFactPreview(false); };
  const sourceChange = (description: string) => { setFactDraft(previous => ({ ...previous, source: { kind: "manual", description } })); setFactPreview(false); };
  const factDirty = factBasis
    ? !factUnchanged || !!factReason.trim()
    : !!factDraft.key || !!factDraft.content || !!factDraft.source.description || !!factDraft.validUntil || intendedVisibility !== "private";
  const topicDirty = topicBasis
    ? topicTitle !== topicBasis.title || topicNote !== topicBasis.note || topicVisibility !== topicBasis.visibility || topicStatus !== topicBasis.status || resumeAfter !== (topicBasis.resumeAfter ?? "") || !!topicReason.trim()
    : !!topicTitle || !!topicNote || topicVisibility !== "private";
  const hasUnsavedWork = factDirty || topicDirty || !!uncertain || !!conflict || !!pendingWrite.current || !!api.hasPendingOnline?.();
  useEffect(() => {
    if (!hasUnsavedWork || typeof window === "undefined") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedWork]);
  if (visibleScope !== scope) return null;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>長期記憶</Text>
    <Text style={styles.hint}>候選事實未確認前只供自己查看。家庭共享資料須再次預覽及確認。話題狀態不代表任務完成。</Text>
    <Text style={styles.hint}>草稿只保留在目前頁面；切換孩子、重新整理或關閉頁面會失去未提交內容。</Text>
    {!active && <Text style={styles.warning}>目前未能核對登入或連線；草稿暫時保留，恢復後會重新讀取，再由你決定是否提交。</Text>}
    <Action label={busy === "重新讀取" ? "正在讀取…" : "重新讀取並核對"} onPress={refresh} disabled={!active || !!busy} />
    {!!notice && <Text accessibilityRole="alert" style={styles.warning}>{notice}</Text>}
    {uncertain && <View style={styles.confirmation}>
      <Text style={styles.warning}>「{uncertain.label}」的結果未知。請先重新讀取並查核原操作收據；系統不會自動重送。</Text>
      <Action label="明確重試原操作識別" onPress={retryUnknown} disabled={!active || !uncertainReviewed || !api.hasPendingOnline?.() || confirmedUnknown.current || !!busy} />
      <Action label="沒有待核對操作，保留草稿重新預覽" onPress={dismissUnsent} disabled={!active || !uncertainReviewed || !!api.hasPendingOnline?.() || confirmedUnknown.current || !!busy} />
    </View>}
    {conflict && <View style={styles.confirmation}>
      <Text style={styles.warning}>版本衝突。原版本：{conflict.original.kind === "fact" ? factText(conflict.original.item) : topicText(conflict.original.item)}。最新版本：{conflict.latest ? conflict.latest.kind === "fact" ? factText(conflict.latest.item) : topicText(conflict.latest.item) : "尚未核對"}。本地草稿：{conflict.original.kind === "fact" ? `${factDraft.key}：${factDraft.content}；${sourceText(factDraft.source)}；原因：${factReason}` : `${topicTitle}；${topicNote}；狀態：${topicStatusText[topicStatus]}；原因：${topicReason}`}。</Text>
      <Action label="已比較，將草稿套用至最新版本" disabled={!active || !conflict.reviewed || !conflict.latest || !!busy} onPress={() => {
        const latest = conflict.latest; if (!latest) return;
        if (latest.kind === "fact") setFactBasis(latest.item); else setTopicBasis(latest.item);
        if (deleteTarget?.kind === latest.kind && deleteTarget.item.id === latest.item.id) setDeleteTarget(latest);
        setConflict(null); setFactPreview(false); setTopicPreview(false); setFactSharedChecked(false); setTopicSharedChecked(false);
        setNotice("已改用最新版本作基準。請再預覽及確認草稿。");
      }} />
      <Action label="取消此次操作，保留草稿另行核對" onPress={() => { setConflict(null); setDeleteTarget(null); setFactPreview(false); setTopicPreview(false); }} disabled={!active || !!busy} />
    </View>}
    {deleteTarget && <View style={styles.confirmation}>
      <Text style={styles.warning}>永久刪除「{deleteTarget.kind === "fact" ? deleteTarget.item.key : deleteTarget.item.title}」及全部更正歷史，無法從歷史還原。</Text>
      <Action label="第二次確認：永久刪除記憶及歷史" onPress={() => deleteItem(deleteTarget)} disabled={locked} />
      <Action label="取消刪除" onPress={() => setDeleteTarget(null)} disabled={!!busy} />
    </View>}
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>私人對話摘要</Text>
      <Text style={styles.body}>{summary ? summary.text : "目前沒有摘要。"}</Text>
      {summary && <Text style={styles.hint}>摘要版本 {summary.version}；建立時間：{summary.createdAt}；覆蓋私人聊天訊息 {summary.coveredMessageIds.length} 則；最後覆蓋訊息：{summary.lastCoveredMessageId}；前一摘要：{summary.previousId ?? "沒有（首個版本）"}。覆蓋範圍以這些私人訊息及前一摘要為基準；摘要不會更改已解決話題狀態。</Text>}
    </View>
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>事實</Text>
      {facts.length === 0 && <Text style={styles.hint}>目前沒有可見事實。</Text>}
      {facts.map(item => <View key={item.id} style={styles.entry}>
        <Text style={styles.label}>{item.key} · {factStatus[item.status]} · {visibilityText[item.visibility]} · 版本 {item.version}</Text>
        <Text style={styles.body}>{item.content}</Text>
        <Text style={styles.hint}>來源：{sourceText(item.source)}；來源狀態：{item.sourceState === "changed" ? "來源已更改，請重新核對" : "目前版本"}；期限：{item.validUntil ? Date.parse(item.validUntil) <= Date.now() ? "已過期" : `有效至 ${item.validUntil}` : "未設定"}；目前適用：{item.applicable ? "是" : "否"}</Text>
        {item.status === "candidate" && <Text style={styles.hint}>擬確認範圍：{visibilityText[item.intendedVisibility]}。確認前只供自己查看。</Text>}
        {item.status === "inactive" && <Text style={styles.hint}>重新確認前須檢視來源、適用性及最新內容。</Text>}
        <View style={styles.row}>
          <Action label="查看歷史" onPress={() => showHistory({ kind: "fact", item })} disabled={!active || !!busy} />
          {(canManage || item.visibility === "private") && <Action label="更正" onPress={() => editFact(item)} disabled={locked} />}
          {(canManage || item.visibility === "private") && <Action label="永久刪除" onPress={() => setDeleteTarget({ kind: "fact", item })} disabled={locked} />}
          {(item.status === "candidate" || item.status === "inactive") && (canManage || item.intendedVisibility === "private") && <Action label="檢視並確認" onPress={() => { editFact(item); setFactPreview(true); }} disabled={locked} />}
        </View>
      </View>)}
      {factCursor && <Action label="載入下一頁事實" onPress={nextFacts} disabled={!active || !!busy} />}
    </View>
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>{factBasis ? "更正／確認事實" : "新增候選事實"}</Text>
      <Text style={styles.hint}>來源只填你知道的內容；不要把私人聊天內容當作家庭資料自動分享。</Text>
      <Field label="事實欄目" value={factDraft.key} onChangeText={value => setFactField("key", value)} editable={!locked} />
      <Field label="內容" value={factDraft.content} onChangeText={value => setFactField("content", value)} editable={!locked} multiline />
      {!factBasis && <Choice values={["private", "family"]} selected={intendedVisibility} labels={visibilityText} onSelect={value => { setIntendedVisibility(value); setFactPreview(false); setFactSharedChecked(false); }} disabled={locked || !canManage} />}
      {factBasis && <Text style={styles.hint}>既有範圍：{visibilityText[factBasis.visibility]}；更正會保留這個範圍。</Text>}
      {factDraft.source.kind === "manual" ? <Field label="資料來源描述" value={factDraft.source.description} onChangeText={sourceChange} editable={!locked} /> : <>
        <Text style={styles.hint}>既有來源：{sourceText(factDraft.source)}。更正時會原樣保留來源參照。</Text>
        <Action label="改用手動描述來源" onPress={() => { setFactDraft(previous => ({ ...previous, source: { kind: "manual", description: "" } })); setFactPreview(false); }} disabled={locked} />
        {factDraft.source.kind === "private_chat" && !factDraft.source.messageId && <Text style={styles.warning}>私人聊天訊息編號已隱藏，不能原樣重新提交；請明確改用手動來源。</Text>}
      </>}
      <Field label="有效至（ISO 日期時間，可空）" value={factDraft.validUntil ?? ""} onChangeText={value => { setFactDraft(previous => ({ ...previous, validUntil: value.trim() || null })); setFactPreview(false); }} editable={!locked} placeholder="2026-12-31T23:59:00+08:00" />
      {factBasis && <Field label="更正／停用原因" value={factReason} onChangeText={value => { setFactReason(value); setFactPreview(false); }} editable={!locked} />}
      <Action label={factBasis ? "預覽更正內容" : "新增候選事實"} onPress={factBasis ? () => { setFactPreview(true); setFactSharedChecked(false); } : saveFact} disabled={locked || !factValid || (!!factBasis && !factReason.trim())} />
      {factBasis && factPreview && <View style={styles.confirmation}>
        <Text style={styles.warning}>請核對版本 {factBasis.version} 的內容、來源及範圍：{factDraft.key}：{factDraft.content}；{sourceText(factDraft.source)}；有效至 {factDraft.validUntil ?? "未設定"}；目前{visibilityText[factBasis.visibility]}；確認後{visibilityText[factBasis.intendedVisibility]}；原因：{factReason || "確認現有內容"}。</Text>
        {(factBasis.visibility === "family" || factBasis.intendedVisibility === "family") && <Action label={`${factSharedChecked ? "☑" : "☐"} 我已核對家庭共享內容`} onPress={() => setFactSharedChecked(value => !value)} disabled={!!busy} />}
        {!factUnchanged && <Text style={styles.hint}>草稿已更改。請先提交更正，再重新檢視及確認更新後的版本。</Text>}
        <Action label="確認這項候選／不活躍事實" onPress={() => confirmFact(factBasis)} disabled={locked || factBasis.status === "confirmed" || !factValid || !factUnchanged || (factBasis.intendedVisibility === "family" && !factSharedChecked) || factBasis.sourceState === "changed" || (!!factBasis.validUntil && Date.parse(factBasis.validUntil) <= Date.now())} />
        <Action label="我已核對，提交更正" onPress={saveFact} disabled={locked || !factValid || !factReason.trim() || (factBasis.visibility === "family" && !factSharedChecked)} />
        <Action label="取消預覽" onPress={() => setFactPreview(false)} disabled={!!busy} />
      </View>}
      {factBasis && factBasis.status !== "inactive" && <Action label="標記為不活躍" onPress={() => deactivateFact(factBasis)} disabled={locked || !factUnchanged || !factReason.trim()} />}
      {factBasis && <Action label="取消編輯" onPress={resetFact} disabled={locked} />}
    </View>
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>話題</Text>
      {topics.length === 0 && <Text style={styles.hint}>目前沒有可見話題。</Text>}
      {topics.map(item => <View key={item.id} style={styles.entry}>
        <Text style={styles.label}>{item.title} · {topicStatusText[item.status]} · {visibilityText[item.visibility]} · 版本 {item.version}</Text>
        <Text style={styles.body}>{item.note || "沒有備註"}</Text>
        <Text style={styles.hint}>可再次提問：{item.mayAsk ? "可以" : "暫不應重問"}{item.resumeAfter ? `；暫緩至 ${item.resumeAfter}` : ""}{item.reopenedFrom ? `；由舊話題 ${item.reopenedFrom} 重開` : ""}</Text>
        <View style={styles.row}>
          <Action label="查看歷史" onPress={() => showHistory({ kind: "topic", item })} disabled={!active || !!busy} />
          {(canManage || item.visibility === "private") && <Action label={item.status === "answered" || item.status === "resolved" ? "按原因重開" : "更新狀態"} onPress={() => editTopic(item)} disabled={locked} />}
          {(canManage || item.visibility === "private") && <Action label="永久刪除" onPress={() => setDeleteTarget({ kind: "topic", item })} disabled={locked} />}
        </View>
      </View>)}
      {topicCursor && <Action label="載入下一頁話題" onPress={nextTopics} disabled={!active || !!busy} />}
    </View>
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>{topicBasis ? "更新／重開話題" : "新增話題"}</Text>
      {topicBasis ? <Text style={styles.hint}>原話題：{topicText(topicBasis)}。已回答或已解決話題只能用原因重開為新話題。</Text> : <Field label="話題標題" value={topicTitle} onChangeText={value => { setTopicTitle(value); setTopicPreview(false); }} editable={!locked} />}
      <Field label="備註" value={topicNote} onChangeText={value => { setTopicNote(value); setTopicPreview(false); }} editable={!locked && (!topicBasis || (topicBasis.status !== "answered" && topicBasis.status !== "resolved"))} multiline />
      {!topicBasis && <Choice values={["private", "family"]} selected={topicVisibility} labels={visibilityText} onSelect={value => { setTopicVisibility(value); setTopicPreview(false); setTopicSharedChecked(false); }} disabled={locked || !canManage} />}
      {topicBasis && topicBasis.status !== "answered" && topicBasis.status !== "resolved" && <>
        <Choice values={["pending", "answered", "snoozed", "resolved"]} selected={topicStatus} labels={topicStatusText} onSelect={value => { setTopicStatus(value); setTopicPreview(false); }} disabled={locked} />
        {topicStatus === "snoozed" && <Field label="暫緩至（ISO 日期時間）" value={resumeAfter} onChangeText={value => { setResumeAfter(value); setTopicPreview(false); }} editable={!locked} placeholder="2026-12-31T09:00:00+08:00" />}
      </>}
      {topicBasis && (topicBasis.status === "answered" || topicBasis.status === "resolved") && <Field label="重開原因" value={topicReason} onChangeText={setTopicReason} editable={!locked} />}
      <Action label={topicBasis ? topicBasis.status === "answered" || topicBasis.status === "resolved" ? "預覽重開話題" : "預覽狀態更新" : "預覽新增話題"} onPress={() => { setTopicPreview(true); setTopicSharedChecked(false); }} disabled={locked || !topicValid || (!!topicBasis && (topicBasis.status === "answered" || topicBasis.status === "resolved") && !topicReason.trim())} />
      {topicPreview && <View style={styles.confirmation}>
        <Text style={styles.warning}>{topicBasis ? topicBasis.status === "answered" || topicBasis.status === "resolved" ? `將以原因「${topicReason}」建立新待處理話題，原終態仍保留。` : `將話題改為${topicStatusText[topicStatus]}；備註：${topicNote || "沒有"}；${topicStatus === "snoozed" ? `暫緩至 ${resumeAfter}` : "沒有暫緩日期"}。` : `將新增${visibilityText[topicVisibility]}話題「${topicTitle}」；備註：${topicNote || "沒有"}。`}這不代表任務已完成。</Text>
        {!topicBasis && topicVisibility === "family" && <Action label={`${topicSharedChecked ? "☑" : "☐"} 我已核對家庭共享話題`} onPress={() => setTopicSharedChecked(value => !value)} disabled={!!busy} />}
        <Action label="確認提交話題" onPress={topicBasis && (topicBasis.status === "answered" || topicBasis.status === "resolved") ? reopenTopic : saveTopic} disabled={locked || (!topicBasis && topicVisibility === "family" && !topicSharedChecked)} />
        <Action label="取消預覽" onPress={() => setTopicPreview(false)} disabled={!!busy} />
      </View>}
      {topicBasis && <Action label="取消編輯" onPress={resetTopic} disabled={locked} />}
    </View>
    {historyTarget && <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>更正歷史</Text>
      {historyItems.length === 0 && <Text style={styles.hint}>沒有較早版本。</Text>}
      {historyItems.map((item, index) => <Text key={`${item.version}-${index}`} style={styles.body}>版本 {item.version}：{"key" in item ? factText(item) : topicText(item)}{"reason" in item ? `；原因：${item.reason}` : item.reopenReason ? `；重開原因：${item.reopenReason}` : ""}</Text>)}
      {historyCursor !== null && <Action label="載入更早版本" onPress={() => showHistory(historyTarget, historyCursor)} disabled={!active || !!busy} />}
      <Action label="關閉歷史" onPress={() => { setHistoryTarget(null); setHistoryItems([]); setHistoryCursor(null); }} disabled={!!busy} />
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, padding: 16, borderWidth: 1, borderColor: "#d6dfdc", borderRadius: 10, marginTop: 20 },
  group: { gap: 8, padding: 12, backgroundColor: "#f7faf8", borderRadius: 8 },
  entry: { gap: 5, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#e1e8e4" },
  confirmation: { gap: 8, padding: 10, borderWidth: 1, borderColor: "#b88132", borderRadius: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, field: { gap: 4 },
  heading: { fontSize: 20, fontWeight: "700", color: "#183f35" }, label: { fontSize: 15, fontWeight: "600", color: "#203e35" },
  body: { fontSize: 15, color: "#24352e" }, hint: { fontSize: 13, color: "#465c52" }, warning: { fontSize: 14, color: "#80501b" },
  input: { borderWidth: 1, borderColor: "#a8b9b0", borderRadius: 6, padding: 9, backgroundColor: "#fff", color: "#183f35" },
  multiline: { minHeight: 90, textAlignVertical: "top" }, button: { backgroundColor: "#275e4e", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 6, alignSelf: "flex-start" },
  buttonText: { color: "#fff", fontWeight: "600" }, disabled: { opacity: 0.45 },
});

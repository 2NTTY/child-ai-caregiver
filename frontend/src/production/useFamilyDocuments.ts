import { useEffect, useMemo, useRef, useState } from "react";
import { createFamilyDocumentsApi, FamilyDocumentApiError, requiresFreshDocumentConfirmation } from "../../../src/client/family-documents-api";
import { documentChangeSchema, documentRequestSchema, type DocumentChange, type DocumentPage, type DocumentRequest,
  type DocumentSnapshot, type FamilyDocument } from "../../../src/shared/family-documents";
import type { GrowthArchiveProjection, GrowthArchiveSnapshot } from "../growth-view-model";
import type { GrowthReportExportRequest } from "../components/growth/growth-archive-view";
import type { PreparationDocumentView, PreparationPurpose } from "../preparation-view-model";
import type { PreparationWorkspaceValue } from "../workspaces/PreparationWorkspace";
import type { WriteOperationView, WriteRecoveryActions } from "../view-model";
import { useDomainWriteGuard } from "./useDomainEnvironment";
import { useTaskKnowledgeRefresh, useTaskKnowledgeRuntime, type TaskKnowledgeEnvironment } from "./task-knowledge-runtime";

type Attempt = { kind: "create"; input: DocumentRequest } | { kind: "change"; id: string; input: DocumentChange };
type Pending = { attempt: Attempt; checked: boolean; reconfirm: boolean };
const snapshotKey = (snapshot: DocumentSnapshot) => snapshot.id + ":" + snapshot.version;
const preparationView = (item: FamilyDocument): PreparationDocumentView => {
  const snapshot = item.readState === "invalidated" ? null : item.current;
  return { id: item.id, childId: item.childId, purpose: item.purpose as PreparationPurpose, version: item.version, status: item.status,
    archivedAt: item.archivedAt, readState: item.readState === "invalidated" ? "invalidated" : snapshot ? item.readState : "unknown",
    revision: snapshot ? { id: snapshot.id, number: snapshot.version, title: snapshot.title, summary: snapshot.summary,
      eventDate: snapshot.eventDate, updatedAt: snapshot.generatedAt, sourceAsOf: snapshot.generatedAt, sections: snapshot.sections,
      sourceRefs: snapshot.sources.map(source => ({ id: source.id, version: source.version })) } : null,
    sources: snapshot?.sources.map(source => ({ id: source.id, childId: item.childId, label: source.label, version: source.version,
      updatedAt: source.at, state: "available", visibility: "family" })) ?? [] };
};
const reportSnapshot = (snapshot: DocumentSnapshot): GrowthArchiveSnapshot => ({
  id: snapshot.id, version: snapshot.version, title: snapshot.title, ageLabel: snapshot.ageLabel,
  periodLabel: snapshot.period.from + " 至 " + snapshot.period.to, generatedAt: snapshot.generatedAt,
  sourceBasisVersion: snapshot.sourceBasis, coverageNote: snapshot.coverageNote,
  revisionChanges: snapshot.changes.map((text, index) => ({ id: snapshot.id + ":change:" + index, text, sourceIds: snapshot.sources.map(source => source.id) })),
  sections: [{ id: "overview", title: "共享來源整理", entries: snapshot.sections.flatMap(section => section.items.map(item => ({
    id: section.id + ":" + item.id, title: section.title, text: item.text, status: "source_summary" as const,
    sourceIds: item.sourceIds, ...(section.domain ? { reportDomain: section.domain } : {}) }))) }],
  sources: snapshot.sources.map(source => ({ id: source.id, label: source.label, version: source.version, state: "available",
    kind: source.kind, ...(source.kind === "record" ? { recordId: source.resourceId } : {}), excerpt: source.text,
    timeLabel: source.at ?? "事件時間未提供" })),
});

/** One shared Server document projection for preparation, history and report consumers. */
export function useFamilyDocuments(env: TaskKnowledgeEnvironment) {
  const api = useMemo(() => createFamilyDocumentsApi(env.apiBaseUrl), [env.apiBaseUrl]);
  const runtime = useTaskKnowledgeRuntime(env, "documents");
  const [page, setPage] = useState<DocumentPage | null>(null), [load, setLoad] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false), [exportBusy, setExportBusy] = useState(false), [pending, setPending] = useState<Pending | null>(null);
  const [operation, setOperation] = useState<WriteOperationView>({ state: "none", message: "", reference: null });
  const [notice, setNotice] = useState(""), [dirty, setDirty] = useState(false), [epoch, setEpoch] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null), [justArchivedId, setJustArchivedId] = useState<string | null>(null);
  const [refreshQueued, setRefreshQueued] = useState(false);
  const original = useRef<Pending | null>(null), inFlight = useRef(false), latest = useRef({ page, load, dirty });
  latest.current = { page, load, dirty };
  const canManage = env.role === "owner" || env.role === "caregiver";
  useDomainWriteGuard(!runtime.lost && dirty, !runtime.lost && !!pending);
  useEffect(() => () => { api.reset(); inFlight.current = false; }, [api]);
  const clearAccess = (error: unknown) => {
    if (!runtime.accessError(error)) return false;
    api.reset(); original.current = null; setPending(null); setPage(null); setDirty(false); setSelectedId(null); setJustArchivedId(null);
    setOperation({ state: "none", message: "", reference: null }); setEpoch(value => value + 1); return true;
  };
  const read = (signal: AbortSignal) => runtime.read(["page"], next => api.getPage(env.childId!, next, env.userId!), signal);
  const refresh = (manual = true) => {
    if (!runtime.live() || !env.online) return;
    if (inFlight.current || !manual && (latest.current.dirty || original.current)) { setRefreshQueued(true); return; }
    inFlight.current = true; setBusy(true);
    const entry = original.current;
    void runtime.request(async (signal, current) => {
      try {
        let value = await read(signal);
        if (entry?.attempt.kind === "change" && !entry.reconfirm) {
          const id = entry.attempt.id;
          if (!value.items.some(item => item.id === id)) {
            const item = await runtime.read(["item", id], next => api.getItem(env.childId!, id, next, env.userId!), signal);
            value = { ...value, items: [...value.items, item] };
          }
        }
        if (!current()) return;
        setPage(value); setLoad("ready"); setRefreshQueued(false);
        if (entry?.reconfirm) {
          original.current = null; setPending(null);
          setOperation({ state: "conflict", reference: null, message: "原提交未獲接納；已讀取目前版本，請重新核對後明確提交。" });
        } else if (entry) {
          const next = { ...entry, checked: true }; original.current = next; setPending(next);
          setOperation({ state: "unknown", reference: api.pendingReference(), recovery: "retry",
            message: "已核對目前孩子及權限；結果仍未知。明確重試只沿原 opId、內容及版本。" });
        }
        setNotice(value.hasMore ? "已讀取目前取得的文件；清單並非完整歷史。" : "已重新讀取文件；沒有生成新版本。");
      } catch (error) {
        if (!current() || clearAccess(error)) return;
        setLoad("error"); setNotice("文件未能讀取；保留原草稿及操作，暫停新提交。");
        if (entry) { entry.checked = false; setPending({ ...entry }); setOperation({ state: "unknown", reference: api.pendingReference(), recovery: "check", message: "原操作仍待核對，沒有重送。" }); }
      } finally { if (current()) { inFlight.current = false; setBusy(false); } }
    });
  };
  useTaskKnowledgeRefresh(() => refresh(false), env.online && !!env.childId && !runtime.lost, busy || exportBusy || dirty || !!pending);
  const write = (attempt: Attempt, retry = false) => {
    const actual = latest.current.page;
    if (inFlight.current || !runtime.live() || !env.online || !canManage || !actual?.canManage || latest.current.load !== "ready"
      || !retry && (original.current || !env.canStartWrite())) return;
    const entry: Pending = { attempt, checked: false, reconfirm: false };
    inFlight.current = true; original.current = entry; setPending(entry); setBusy(true);
    setOperation({ state: "saving", reference: null, message: "正在保存家庭共享文件。" });
    void runtime.request(async (signal, current) => {
      try {
        const item = attempt.kind === "create" ? await api.create(env.childId!, attempt.input, signal, env.userId!)
          : await api.change(env.childId!, attempt.id, attempt.input, signal, env.userId!);
        if (!current()) return;
        original.current = null; setPending(null); setDirty(false); setEpoch(value => value + 1);
        setPage(before => before ? { ...before, items: before.items.some(old => old.id === item.id)
          ? before.items.map(old => old.id === item.id ? item : old) : [item, ...before.items] } : null);
        setOperation({ state: "saved", reference: null, message: "文件已獲 Server 確認保存。" });
        if (attempt.kind === "change" && attempt.input.action === "archive") { setSelectedId(null); setJustArchivedId(item.id); }
        else if (item.kind === "preparation") { setSelectedId(item.id); setJustArchivedId(null); }
        setNotice("已按家庭共享資料保存文件及版本；沒有把整理內容寫回成事實。");
        try {
          const next = await read(signal);
          if (current()) { setPage(next); setLoad("ready"); }
        } catch (error) {
          if (!current() || clearAccess(error)) return;
          setLoad("error"); setOperation({ state: "saved", reference: null, message: "原保存已確認，最新文件待讀回；請重新讀取，毋須再次提交。" });
        }
        if (current()) env.invalidate();
      } catch (error) {
        if (!current() || clearAccess(error)) return;
        const failure = error instanceof FamilyDocumentApiError ? error : new FamilyDocumentApiError();
        entry.reconfirm = requiresFreshDocumentConfirmation(failure) && !api.hasUnknownOriginal(); original.current = entry; setPending({ ...entry });
        setOperation({ state: entry.reconfirm ? failure.status === 409 ? "conflict" : "failed" : "unknown",
          reference: api.pendingReference(), recovery: "check", message: entry.reconfirm
            ? "這次提交未獲接納；請重新讀取並核對原版本，草稿保留。" : "結果未知；原操作識別、內容及版本保留，請先查核，不會自動重送。" });
      } finally { if (current()) { inFlight.current = false; setBusy(false); } }
    });
  };
  const visible = runtime.lost ? null : page;
  const locked = busy || exportBusy || !!pending || runtime.lost || !env.online || load !== "ready" || !canManage || !visible?.canManage;
  const change = (id: string, expectedVersion: number, action: DocumentChange["action"], extra = {}) => {
    const actual = latest.current.page?.items.find(item => item.id === id && item.childId === env.childId);
    if (locked || !runtime.live() || !actual || actual.version !== expectedVersion || action === "archive" && (actual.status !== "active" || actual.readState === "invalidated" || !actual.current)
      || action === "refresh" && actual.status !== "active"
      || action === "restore" && actual.status !== "archived" || action === "check_item" && (actual.readState !== "ready" || actual.status !== "active")) return;
    const parsed = documentChangeSchema.safeParse({ action, expectedVersion, authorityVersion: latest.current.page!.authorityVersion, ...extra });
    if (!parsed.success) return;
    const input = parsed.data;
    if (input.action === "check_item" && !actual.current?.sections.some(section => section.id === input.sectionId && section.kind === "checklist"
      && section.items.some(item => item.id === input.itemId && !!item.checked !== input.checked))) return;
    write({ kind: "change", id, input: structuredClone(parsed.data) });
  };
  const recovery: WriteRecoveryActions = { checkOriginalOperation: () => refresh(), reloadCurrent: () => refresh(),
    retryOriginalOperation() { const entry = original.current; if (entry?.checked && !entry.reconfirm && !inFlight.current) write(entry.attempt, true); } };
  const preparationDocuments = visible?.items.filter(item => item.kind === "preparation").map(preparationView) ?? [];
  const condition = runtime.lost ? "lost" : !visible ? busy ? "loading" : load === "error" ? "unavailable" : "empty"
    : pending ? "unknown" : !canManage || !visible.canManage ? "read_only" : "ready";
  const createDocument = (input: DocumentRequest) => {
    const parsed = documentRequestSchema.safeParse(input);
    if (parsed.success && parsed.data.kind === "growth_report" && parsed.data.purpose === "family"
      && latest.current.page?.items.some(item => item.kind === "growth_report" && item.purpose === "family" && item.status === "active"
        && item.current?.period.from === parsed.data.period.from && item.current.period.to === parsed.data.period.to)) {
      setNotice("這個期間已有標準成長報告；請閱讀現行報告，來源有更新時再整理新版本。"); return;
    }
    if (!locked && parsed.success) write({ kind: "create", input: structuredClone(parsed.data) });
  };
  const preparation: PreparationWorkspaceValue = { scopeKey: env.scopeKey, model: {
    child: { id: env.childId!, displayName: env.childName, accessRole: env.role ?? undefined, ageLabel: "詳見孩子檔案", regionLabel: "詳見孩子檔案", allergiesLabel: null, profileConfirmed: false },
    scope: { authorityKey: env.scopeKey, childId: env.childId!, role: env.role ?? undefined, online: env.online, condition },
    documents: preparationDocuments, selected: preparationDocuments.find(item => item.id === selectedId) ?? null, condition,
    online: env.online, notice, justArchivedId, dataLabel: "Server 家庭共享多用途文件；依據來源及版本整理。", archiveNotice: "只歸檔文件，原來源及任務保留。",
    operation: runtime.lost ? undefined : operation, capabilities: { archive: !locked, checkItem: !locked, restore: !locked, refresh: !locked, create: !locked },
    busy, locked, dirty, epoch, authorityVersion: visible?.authorityVersion ?? "" }, actions: {
    selectDocument(id) { if (runtime.live() && preparationDocuments.some(item => item.id === id)) { setSelectedId(id); setJustArchivedId(null); } },
    closeDocument() { if (runtime.live()) { setSelectedId(null); setJustArchivedId(null); } },
    archiveDocument(id, expectedVersion) { change(id, expectedVersion, "archive"); },
    restoreDocument(id, expectedVersion) { change(id, expectedVersion, "restore"); },
    refreshDocument(id, expectedVersion) { change(id, expectedVersion, "refresh"); },
    checkItem(id, expectedVersion, sectionId, itemId, checked) { change(id, expectedVersion, "check_item", { sectionId, itemId, checked }); },
    createDocument, refresh() { refresh(); }, markDraft() { if (!locked && runtime.live()) setDirty(true); },
    discardDraft() { if (!original.current && runtime.live()) { setDirty(false); setEpoch(value => value + 1); if (refreshQueued) refresh(); } },
  }, recovery };
  const reports = visible?.items.filter(item => item.kind === "growth_report") ?? [];
  const standard = reports.find(item => item.purpose === "family" && item.status === "active") ?? null;
  const readableReports = reports.filter(item => item.readState !== "invalidated");
  const snapshots = Array.from(new Map(readableReports.flatMap(item => [...(item.current ? [item.current] : []), ...item.history]).map(snapshot => [snapshotKey(snapshot), snapshot])).values());
  const projectedSnapshots = snapshots.map(reportSnapshot), currentSnapshot = standard?.readState !== "invalidated" && standard?.current ? reportSnapshot(standard.current) : null;
  const archive: GrowthArchiveProjection = { scopeKey: env.scopeKey, childId: env.childId!, authorityVersion: visible?.authorityVersion ?? "",
    state: runtime.lost ? "invalidated" : !visible ? load === "error" ? "error" : "loading" : standard?.readState === "invalidated" ? "invalidated"
      : standard?.readState === "stale" ? "needs_update" : currentSnapshot || projectedSnapshots.length ? "ready" : "not_generated",
    label: "Server 依家庭共享來源整理，並非模型生成或發展評估。", snapshot: currentSnapshot,
    history: projectedSnapshots.filter(snapshot => snapshot.id !== currentSnapshot?.id || snapshot.version !== currentSnapshot.version),
    periods: snapshots.map(snapshot => ({ id: snapshotKey(snapshot), kind: "range", year: Number(snapshot.period.from.slice(0, 4)),
      from: snapshot.period.from, to: snapshot.period.to, label: snapshot.title + " · " + snapshot.period.from + " 至 " + snapshot.period.to,
      snapshotId: snapshot.id, snapshotVersion: snapshot.version, currentAnnual: false, coverage: "partial", coverageLabel: snapshot.coverageNote })) };
  const exportReport = async (request: GrowthReportExportRequest) => {
    const actualPage = latest.current.page;
    const findSnapshot = (item: FamilyDocument) => item.readState !== "invalidated" && [item.current, ...item.history].some(snapshot => snapshot?.id === request.snapshotId && snapshot.version === request.snapshotVersion);
    const target = actualPage?.items.find(item => item.kind === "growth_report" && findSnapshot(item));
    if (inFlight.current || !runtime.live() || !env.online || typeof document === "undefined" || !actualPage || !target
      || request.scopeKey !== env.scopeKey || request.childId !== env.childId || request.authorityVersion !== actualPage.authorityVersion
      || request.periodId !== null && request.periodId !== request.snapshotId + ":" + request.snapshotVersion) return;
    inFlight.current = true; setExportBusy(true); setNotice("正在核對這個版本並準備 PDF。");
    await runtime.request(async (signal, current) => {
      let url: string | null = null;
      try {
        const blob = await api.exportPdf(env.childId!, target.id, { snapshotId: request.snapshotId, snapshotVersion: request.snapshotVersion,
          authorityVersion: request.authorityVersion, purpose: request.purpose === "care_handoff" ? "handoff" : request.purpose,
          includeSources: request.includeSources, includeRevision: request.includeRevision }, signal, env.userId!);
        if (!current() || latest.current.page?.authorityVersion !== request.authorityVersion
          || !latest.current.page.items.some(item => item.id === target.id && findSnapshot(item))) return;
        url = URL.createObjectURL(blob); const link = document.createElement("a");
        link.href = url; link.download = `growth-report-${request.snapshotId}-v${request.snapshotVersion}.pdf`;
        document.body.appendChild(link); try { link.click(); } finally { link.remove(); }
        setNotice("已準備所選版本的 PDF 並交給瀏覽器下載；Web 與 PDF 使用同一份正文。");
      } catch (error) {
        if (!current() || clearAccess(error)) return;
        setNotice("PDF 未能取得，沒有改用其他版本。請重新讀取並核對來源後再試。");
        if (error instanceof FamilyDocumentApiError && error.status === 409) {
          try { const next = await read(signal); if (current()) { setPage(next); setLoad("ready"); } }
          catch (readError) { if (current() && !clearAccess(readError)) setLoad("error"); }
        }
      } finally { if (url) URL.revokeObjectURL(url); if (current()) { inFlight.current = false; setExportBusy(false); } }
    });
  };
  return { preparation, archive, operation, recovery, busy, exportBusy, locked, dirty, epoch, notice, standard,
    authorityVersion: visible?.authorityVersion ?? "", createDocument, exportReport,
    refreshReport() { if (standard) change(standard.id, standard.version, "refresh"); },
    refresh() { refresh(); }, markDraft: preparation.actions.markDraft!, discardDraft: preparation.actions.discardDraft! };
}

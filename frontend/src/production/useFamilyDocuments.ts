import { exportBlob } from "../platform/file-export";
import { useEffect, useMemo, useRef, useState } from "react";
import { createFamilyDocumentsApi, parseFamilyDocumentSnapshot, FamilyDocumentApiError, requiresFreshDocumentConfirmation } from "../../../src/client/family-documents-api";
import { documentChangeSchema, documentRequestSchema, type DocumentChange, type DocumentPage, type DocumentRequest,
  type DocumentSnapshot, type DocumentVersionPage, type FamilyDocument } from "../../../src/shared/family-documents";
import type { GrowthArchiveProjection } from "../growth-view-model";
import type { GrowthReportExportRequest, GrowthReportExportResult } from "../components/growth/growth-archive-view";
import type { FamilyDocumentReadingPort, PreparationDocumentView, PreparationPurpose } from "../preparation-view-model";
import type { DocumentCreateDraft, PreparationWorkspaceValue } from "../workspaces/PreparationWorkspace";
import type { WriteOperationView, WriteRecoveryActions } from "../view-model";
import { useDomainWriteGuard } from "./useDomainEnvironment";
import { useTaskKnowledgeRefresh, useTaskKnowledgeRuntime, type TaskKnowledgeEnvironment } from "./task-knowledge-runtime";
import { projectFamilyDocumentArchive } from "./family-document-archive";
import { createPreparationCheckBuffer } from "./preparation-check-buffer";

type Attempt = { kind: "create"; input: DocumentRequest } | { kind: "change"; id: string; input: DocumentChange };
type Pending = { attempt: Attempt; checked: boolean; reconfirm: boolean; selectionGeneration: number; draftId?: string };
type VersionRead = { page: DocumentVersionPage | null; busy: boolean; error: boolean };
type ContentBuffer = { documentId: string; snapshotId: string; snapshotVersion: number; documentVersion: number; authorityVersion: string;
  text: string; totalCharacters: number; nextOffset: number | null; complete: boolean; busy: boolean; error: boolean; invalidated: boolean; snapshot: DocumentSnapshot | null };
const pageReadFailureNotice = "未能載入更多文件，已取得的內容保留。";
const savedAwaitingSelectionRead = "先前文件的保存已確認；目前選取的文件仍待重新讀取。";
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

/** One shared Server document projection for preparation, history and report consumers. */
export function useFamilyDocuments(env: TaskKnowledgeEnvironment) {
  const api = useMemo(() => createFamilyDocumentsApi(env.apiBaseUrl, env.owner.fetcher, env.sharing), [env.apiBaseUrl, env.owner.fetcher, env.sharing]);
  const checks = useMemo(createPreparationCheckBuffer, [api]);
  const publishingChecks = useRef(false);
  const [, updateChecks] = useState(0);
  const notifyChecks = () => updateChecks(value => value + 1);
  const flushChecks = () => { if (checks.dirty) { checks.flush(); notifyChecks(); } };
  const runtime = useTaskKnowledgeRuntime(env, "documents");
  const [page, setPage] = useState<DocumentPage | null>(null), [load, setLoad] = useState<"loading" | "ready" | "error">("loading");
  const [pageReadGeneration, setPageReadGeneration] = useState(-1);
  const [busy, setBusy] = useState(false), [exportBusy, setExportBusy] = useState(false), [pending, setPending] = useState<Pending | null>(null);
  const [operation, setOperation] = useState<WriteOperationView>({ state: "none", message: "", reference: null });
  const [createDraft, setCreateDraft] = useState<DocumentCreateDraft | null>(null);
  const [notice, setNotice] = useState(""), [dirty, setDirty] = useState(false), [epoch, setEpoch] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null), [justArchivedId, setJustArchivedId] = useState<string | null>(null);
  const [refreshQueued, setRefreshQueued] = useState(false);
  const original = useRef<Pending | null>(null), inFlight = useRef(false), latest = useRef({ page, load, dirty });
  const exporting = useRef<{ documentId: string; snapshotId: string; invalidated: boolean } | null>(null);
  const selection = useRef({ id: null as string | null, generation: 0 });
  const readingNeedsRecheck = useRef(false);
  const [listPages, setListPages] = useState({ active: { cursor: null as string | null, more: false, count: 0 }, archived: { started: false, ready: false, cursor: null as string | null, more: false, count: 0 } });
  const [pageError, setPageError] = useState(false);
  const [versionReads, setVersionReads] = useState<Record<string, VersionRead>>({});
  const [content, setContent] = useState<ContentBuffer | null>(null);
  const reads = useRef({ generation: 0, contentGeneration: 0, versions: versionReads, content });
  const listState = useRef(listPages); listState.current = listPages;
  reads.current.versions = versionReads; reads.current.content = content;
  const clearContent = () => { reads.current.contentGeneration++; reads.current.content = null; setContent(null); };
  // Reject pending PDF handoff synchronously, before React commits the invalidated projection.
  const clearReading = () => { if (exporting.current) exporting.current.invalidated = true; reads.current.generation++; reads.current.versions = {}; setVersionReads({}); clearContent(); };
  const applyFreshPage = (value: DocumentPage, preserveUnchangedReading = false, refreshedLists?: typeof listPages) => {
    const before = latest.current.page;
    if (!preserveUnchangedReading || before?.authorityVersion !== value.authorityVersion) clearReading();
    else {
      const unchanged = (id: string, version: number) => value.items.some(item => item.id === id && item.version === version && item.readState !== "invalidated");
      reads.current.versions = Object.fromEntries(Object.entries(reads.current.versions).filter(([id]) => {
        const item = before.items.find(item => item.id === id); return item && unchanged(id, item.version);
      }));
      setVersionReads(reads.current.versions);
      const selected = reads.current.content;
      if (selected && !unchanged(selected.documentId, selected.documentVersion)) clearContent();
    }
    latest.current.page = value;
    setPage(value); setPageReadGeneration(reads.current.generation); setLoad("ready"); setPageError(false);
    setListPages(refreshedLists ?? { active: { cursor: value.nextCursor ?? null, more: value.hasMore, count: 1 }, archived: { started: false, ready: false, cursor: null, more: false, count: 0 } });
  };
  latest.current = { page, load, dirty };
  const canManage = env.role === "owner" || env.role === "caregiver";
  // A definite rejection needs a fresh read before resubmission, not an unresolved-write exit lock.
  useDomainWriteGuard(!runtime.lost && (dirty || checks.dirty), !runtime.lost && !!pending && !pending.reconfirm, "child", true,
    operation.state === "saving" || checks.flight && !checks.paused ? "saving" : "unknown");
  useEffect(() => () => { api.reset(); checks.clear(); inFlight.current = false; exporting.current = null; }, [api, checks]);
  useEffect(() => {
    if (!env.online && checks.dirty && !checks.flight) {
      checks.failed(false); setLoad("error"); notifyChecks();
      setOperation({ state: "failed", reference: null, recovery: "check", message: "連線中斷；未送出的勾選已保留，重新核對後再保存。" });
    }
  }, [env.online, checks]);
  const clearAccess = (error: unknown) => {
    if (!runtime.accessError(error)) return false;
    api.reset(); checks.clear(); original.current = null; setPending(null); setPage(null); setDirty(false); setCreateDraft(null); setSelectedId(null); setJustArchivedId(null);
    clearReading(); setPageError(false); readingNeedsRecheck.current = false;
    selection.current = { id: null, generation: selection.current.generation + 1 };
    setOperation({ state: "none", message: "", reference: null }); setEpoch(value => value + 1); return true;
  };
  const read = (signal: AbortSignal) => runtime.read(["page", "active", null], next => api.getPage(env.childId!, next, env.userId!, { status: "active", limit: 20 }), signal);
  const refresh = (manual = true) => {
    if (!runtime.live() || !env.online) return;
    if (inFlight.current || !manual && (latest.current.dirty || original.current || checks.dirty)) { setRefreshQueued(true); return; }
    inFlight.current = true; setBusy(true);
    const entry = original.current;
    void runtime.request(async (signal, current) => {
      const authorityChanged = new Error("Document refresh authority changed");
      try {
        let value = await read(signal);
        if (!current()) return;
        let refreshedLists: typeof listPages | undefined;
        const before = latest.current.page, loaded = listState.current;
        if (!manual && before) {
          const checkAuthority = (next: DocumentPage) => {
            if (next.authorityVersion === before.authorityVersion && next.canManage === before.canManage) return;
            readingNeedsRecheck.current = true; clearReading(); setPage(null); setLoad("error");
            setNotice("來源或權限基準已有變更，請重新讀取文件。");
            throw authorityChanged;
          };
          checkAuthority(value);
          // Re-read only the loaded depth, using fresh cursors. Never publish a
          // new active head before the visible archived pages are verified.
          const reread = async (status: "active" | "archived", first: DocumentPage, depth: number) => {
            let next = first, count = 1;
            const items = [...next.items], seen = new Set<string>();
            checkAuthority(next);
            while (next.hasMore && count < depth) {
              const cursor = next.nextCursor;
              if (!cursor || seen.has(cursor)) throw new Error("Invalid document refresh cursor");
              seen.add(cursor);
              next = await runtime.read(["page", status, cursor], nextSignal => api.getPage(env.childId!, nextSignal, env.userId!, { status, limit: 20, cursor }), signal);
              if (!current()) return null;
              checkAuthority(next); items.push(...next.items); count++;
            }
            return { items, cursor: next.nextCursor ?? null, more: next.hasMore, count };
          };
          const active = await reread("active", value, Math.max(1, loaded.active.count));
          if (!active || !current()) return;
          let archived = { items: [] as FamilyDocument[], started: false, ready: false, cursor: null as string | null, more: false, count: 0 };
          if (loaded.archived.ready) {
            const first = await runtime.read(["page", "archived", null], nextSignal => api.getPage(env.childId!, nextSignal, env.userId!, { status: "archived", limit: 20 }), signal);
            if (!current()) return;
            const fresh = await reread("archived", first, loaded.archived.count);
            if (!fresh || !current()) return;
            archived = { ...fresh, started: true, ready: true };
          }
          const items = [...active.items, ...archived.items];
          if (new Set(items.map(item => item.id)).size !== items.length) throw new Error("Duplicate document in refreshed pages");
          value = { ...value, items, nextCursor: active.cursor, hasMore: active.more };
          refreshedLists = { active: { cursor: active.cursor, more: active.more, count: active.count },
            archived: { started: archived.started, ready: archived.ready, cursor: archived.cursor, more: archived.more, count: archived.count } };
        }
        if (entry?.attempt.kind === "change" && !entry.reconfirm) {
          const id = entry.attempt.id;
          if (!value.items.some(item => item.id === id)) {
            const item = await runtime.read(["item", id], next => api.getItem(env.childId!, id, next, env.userId!), signal);
            value = { ...value, items: [...value.items, item] };
          }
        }
        const selected = { ...selection.current };
        if (selected.id && !value.items.some(item => item.id === selected.id)) {
          const item = await runtime.read(["item", selected.id], next => api.getItem(env.childId!, selected.id!, next, env.userId!), signal);
          value = { ...value, items: [...value.items, item] };
        }
        if (!current()) return;
        // Automatic reads may still detect revocation, but only explicit recheck can reveal this selection again.
        if (!manual && readingNeedsRecheck.current) {
          clearReading(); setPage(null); setLoad("error"); return;
        }
        if (selection.current.generation !== selected.generation) {
          readingNeedsRecheck.current = true;
          clearReading(); setPage(null); setLoad("error"); setNotice("選取已改變，請重新讀取目前文件；未重新核對的內容暫不展示。"); return;
        }
        applyFreshPage(value, !manual, refreshedLists);
        if (manual && readingNeedsRecheck.current) setOperation(before => before.state === "saved" && before.message === savedAwaitingSelectionRead
          ? { ...before, message: "先前文件的保存已確認。" } : before);
        readingNeedsRecheck.current = false; setRefreshQueued(false);
        if (entry?.reconfirm && original.current === entry) {
          original.current = null; setPending(null);
          setOperation({ state: "conflict", reference: null, message: latest.current.dirty ? "已載入已儲存的內容，草稿仍然保留。" : "已載入已儲存的內容。" });
        } else if (entry && original.current === entry) {
          const next = { ...entry, checked: true }; original.current = next; setPending(next);
          setOperation({ state: "unknown", reference: api.pendingReference(), recovery: "retry",
            message: "暫時未能確認是否儲存成功。你的內容已保留，可再試一次。" });
        }
        setNotice(value.hasMore ? "已讀取目前取得的文件；清單並非完整歷史。" : "已重新讀取文件；沒有生成新版本。");
      } catch (error) {
        if (!current() || clearAccess(error) || error === authorityChanged) return;
        setLoad("error"); setNotice("未能載入已儲存的內容，請再試一次。");
        if (entry && original.current === entry) {
          entry.checked = false; setPending({ ...entry });
          setOperation(before => ({ state: entry.reconfirm ? before.state === "conflict" ? "conflict" : "failed" : "unknown",
            reference: api.pendingReference(), recovery: "check", message: entry.reconfirm
              ? latest.current.dirty ? "未能儲存，草稿已保留。" : "未能儲存，請重新載入。"
              : "暫時未能確認是否儲存成功，內容已保留。" }));
        }
      } finally { if (current()) { inFlight.current = false; setBusy(false); } }
    });
  };
  useTaskKnowledgeRefresh(() => refresh(false), env.online && !!env.childId && !runtime.lost, busy || exportBusy || dirty || !!pending || checks.dirty, () => publishingChecks.current);
  const write = (attempt: Attempt, retry = false, draftId?: string) => {
    const actual = latest.current.page;
    if (inFlight.current || !runtime.live() || !env.online || !canManage || !actual?.canManage || latest.current.load !== "ready"
      || !retry && (original.current || !env.canStartWrite())) return;
    const entry: Pending = { attempt, checked: false, reconfirm: false, draftId: retry ? original.current?.draftId : draftId,
      selectionGeneration: retry && original.current ? original.current.selectionGeneration : selection.current.generation };
    const checking = attempt.kind === "change" && attempt.input.action === "check_items";
    inFlight.current = true; original.current = entry; setPending(entry); if (!checking) { setBusy(true); setNotice(""); }
    if (attempt.kind === "create" && !retry && draftId) setCreateDraft({ id: draftId, request: structuredClone(attempt.input), authorityVersion: actual.authorityVersion });
    if (!checking) setOperation({ state: "saving", reference: null, message: "正在保存家庭共享文件。" });
    void runtime.request(async (signal, current) => {
      try {
        const item = attempt.kind === "create" ? await api.create(env.childId!, attempt.input, signal, env.userId!)
          : await api.change(env.childId!, attempt.id, attempt.input, signal, env.userId!);
        if (!current()) return;
        original.current = null; setPending(null);
        // Invalidate the changed document without dismissing a newer reader on another document.
        reads.current.versions = Object.fromEntries(Object.entries(reads.current.versions).filter(([id]) => id !== item.id));
        setVersionReads(reads.current.versions);
        if (reads.current.content?.documentId === item.id) clearContent();
        if (attempt.kind === "create") { setDirty(false); setCreateDraft(null); setEpoch(value => value + 1); }
        const before = latest.current.page;
        const updated = before ? { ...before, items: before.items.some(old => old.id === item.id)
          ? before.items.map(old => old.id === item.id && old.version <= item.version ? item : old) : [item, ...before.items] } : null;
        latest.current.page = updated; setPage(updated);
        if (checking) {
          checks.saved(item); notifyChecks();
          setOperation({ state: "none", message: "", reference: null });
          // The receipt includes the authoritative document. Do not block the next
          // click on another full-page read; shared invalidation can refresh later.
          publishingChecks.current = true;
          try { env.invalidate(); } finally { publishingChecks.current = false; }
          return;
        }
        setOperation({ state: "saved", reference: null, message: "文件已獲 Server 確認保存。" });
        if (selection.current.generation === entry.selectionGeneration) {
          if (attempt.kind === "change" && attempt.input.action === "archive" && selection.current.id === item.id) {
            selection.current.id = null; setSelectedId(null); setJustArchivedId(item.id);
          } else if (attempt.kind === "create" && item.kind === "preparation") {
            selection.current.id = item.id; setSelectedId(item.id); setJustArchivedId(null);
          }
        }
        setNotice("已按家庭共享資料保存文件及版本；沒有把整理內容寫回成事實。");
        try {
          const next = await read(signal);
          // Preserve the confirmed archive result for the immediate success/undo projection.
          if (item.status === "archived" && next.authorityVersion === actual.authorityVersion && !next.items.some(value => value.id === item.id)) next.items.push(item);
          const selected = { ...selection.current };
          if (selected.id && !next.items.some(value => value.id === selected.id)) {
            const selectedItem = await runtime.read(["item", selected.id], nextSignal => api.getItem(env.childId!, selected.id!, nextSignal, env.userId!), signal);
            next.items.push(selectedItem);
          }
          if (current()) {
            if (selection.current.generation === selected.generation) applyFreshPage(next, true);
            else {
              // Keep the newer selection intent, but do not expose an unverified page or snapshot.
              readingNeedsRecheck.current = true;
              clearReading(); setPage(null); setLoad("error");
              setOperation({ state: "saved", reference: null, message: savedAwaitingSelectionRead });
              setNotice("選取已改變；請重新讀取目前文件，毋須再次提交先前的保存。");
            }
          }
        } catch (error) {
          if (!current() || clearAccess(error)) return;
          setLoad("error"); setOperation({ state: "saved", reference: null, message: "原保存已確認，最新文件待讀回；請重新讀取，毋須再次提交。" });
        }
        if (current()) env.invalidate();
      } catch (error) {
        if (!current() || clearAccess(error)) return;
        const failure = error instanceof FamilyDocumentApiError ? error : new FamilyDocumentApiError();
        entry.reconfirm = requiresFreshDocumentConfirmation(failure) && !api.hasUnknownOriginal(); original.current = entry; setPending({ ...entry });
        if (checking) { checks.failed(!entry.reconfirm); notifyChecks(); }
        setOperation({ state: entry.reconfirm ? failure.status === 409 ? "conflict" : "failed" : "unknown",
          reference: api.pendingReference(), recovery: "check", message: entry.reconfirm
            ? latest.current.dirty ? "未能儲存，草稿已保留。" : "未能儲存，請重新載入。"
            : "暫時未能確認是否儲存成功，內容已保留。" });
      } finally { if (current()) { inFlight.current = false; setBusy(false); if (checking) notifyChecks(); } }
    });
  };
  // One timer and one original API operation for this scope. More clicks only
  // update intent; they never launch concurrent writes or implicit retries.
  useEffect(() => {
    if (!runtime.live() || !env.online || !canManage || !page?.canManage || load !== "ready" || inFlight.current
      || original.current || dirty || exportBusy || !env.canStartWrite()) return;
    const delay = checks.delay(Date.now());
    if (delay === null) return;
    const timer = setTimeout(() => {
      if (!runtime.live() || inFlight.current || original.current || !env.canStartWrite() || !latest.current.page) return;
      const batch = checks.take(latest.current.page, Date.now()); notifyChecks();
      if (batch) write({ kind: "change", ...batch });
    }, delay);
    return () => clearTimeout(timer);
  });
  const loadMoreDocuments = (status: "active" | "archived") => {
    const before = latest.current.page, state = listState.current[status], cursor = state.cursor;
    const first = status === "archived" && !listState.current.archived.started;
    if (!runtime.live() || !env.online || !before || inFlight.current || !first && !state.more || original.current) return;
    if (status === "archived") setListPages(value => ({ ...value, archived: { ...value.archived, started: true, more: true } }));
    inFlight.current = true; setBusy(true); setPageError(false);
    void runtime.request(async (signal, current) => {
      try {
        const next = await runtime.read(["page", status, cursor], nextSignal => api.getPage(env.childId!, nextSignal, env.userId!, { status, limit: 20, cursor }), signal);
        if (!current()) return;
        if (next.authorityVersion !== before.authorityVersion) { clearReading(); setPage(null); setLoad("error"); setPageError(true); setNotice("來源或權限基準已有變更，請重新讀取文件。"); return; }
        setPage(previous => previous && previous.authorityVersion === before.authorityVersion ? { ...previous,
          items: [...previous.items.filter(item => !next.items.some(value => value.id === item.id)), ...next.items] } : previous);
        setListPages(previous => ({ ...previous, [status]: { ...previous[status], cursor: next.nextCursor ?? null, more: next.hasMore, count: previous[status].count + 1, ...(status === "archived" ? { ready: true } : {}) } }));
        setNotice(previous => previous === pageReadFailureNotice ? "" : previous);
      } catch (error) { if (current() && !clearAccess(error)) { setPageError(true); setNotice(pageReadFailureNotice); } }
      finally { if (current()) { inFlight.current = false; setBusy(false); } }
    });
  };
  const loadVersions = (id: string) => {
    const item = latest.current.page?.items.find(item => item.id === id), previous = reads.current.versions[id];
    if (!runtime.live() || !env.online || !item || previous?.busy || previous?.page && !previous.page.nextCursor) return;
    const generation = reads.current.generation, authority = latest.current.page!.authorityVersion, cursor = previous?.page?.nextCursor ?? null;
    const update = (value: VersionRead) => { reads.current.versions = { ...reads.current.versions, [id]: value }; setVersionReads(reads.current.versions); };
    update({ page: previous?.page ?? null, busy: true, error: false });
    void runtime.request(async (signal, current) => {
      try {
        const value = await runtime.read(["versions", id, cursor], next => api.getVersions(env.childId!, id, next, env.userId!, cursor), signal);
        if (!current() || generation !== reads.current.generation || latest.current.page?.authorityVersion !== authority
          || latest.current.page.items.find(value => value.id === id)?.version !== item.version) return;
        if (value.authorityVersion !== authority) { clearReading(); setPage(null); setLoad("error"); setNotice("來源或權限基準已有變更，請重新讀取文件。"); return; }
        const versions = [...(previous?.page?.items ?? []).filter(old => !value.items.some(item => item.snapshotId === old.snapshotId)), ...value.items];
        update({ page: { ...value, items: versions }, busy: false, error: false });
      } catch (error) { if (current() && generation === reads.current.generation && !clearAccess(error)) update({ page: previous?.page ?? null, busy: false, error: true }); }
    });
  };
  const readVersionChunk = (target: ContentBuffer) => {
    const generation = reads.current.generation, contentGeneration = reads.current.contentGeneration, offset = target.text.length;
    const update = (value: ContentBuffer) => { reads.current.content = value; setContent(value); };
    update({ ...target, busy: true, error: false });
    void runtime.request(async (signal, current) => {
      const valid = () => current() && generation === reads.current.generation && contentGeneration === reads.current.contentGeneration
        && latest.current.page?.authorityVersion === target.authorityVersion
        && latest.current.page.items.find(item => item.id === target.documentId)?.version === target.documentVersion;
      try {
        const value = await runtime.read(["content", target.documentId, target.snapshotId, target.snapshotVersion, offset], next => api.readContent(env.childId!, target.documentId,
          { snapshotId: target.snapshotId, snapshotVersion: target.snapshotVersion, offset }, next, env.userId!), signal);
        if (!valid()) return;
        if (value.authorityVersion !== target.authorityVersion || value.documentVersion !== target.documentVersion) {
          clearReading(); setPage(null); setLoad("error"); setNotice("文件或來源基準已有變更，請重新讀取。"); return;
        }
        if (offset > 0 && value.totalCharacters !== target.totalCharacters) throw new FamilyDocumentApiError();
        if (value.invalidated) {
          if (exporting.current?.documentId === target.documentId && (exporting.current.snapshotId === target.snapshotId
            || latest.current.page?.items.find(item => item.id === target.documentId)?.current?.id === target.snapshotId)) exporting.current.invalidated = true;
          update({ ...target, text: "", busy: false, invalidated: true, complete: false, snapshot: null });
          setPage(before => before ? { ...before, items: before.items.map(item => item.id !== target.documentId ? item : {
            ...item, history: item.history.filter(snapshot => snapshot.id !== target.snapshotId),
            ...(item.current?.id === target.snapshotId ? { current: null, readState: "invalidated" as const } : {}) }) } : before); return;
        }
        const text = target.text + value.text;
        const snapshot = value.complete ? parseFamilyDocumentSnapshot(JSON.parse(text), target.snapshotId, target.snapshotVersion) : null;
        update({ ...target, text: snapshot ? "" : text, totalCharacters: value.totalCharacters, nextOffset: value.nextOffset,
          busy: false, complete: value.complete, snapshot });
        if (snapshot) setPage(before => before ? { ...before, items: before.items.map(item => item.id !== target.documentId
          || item.current?.id === snapshot.id || item.history.some(value => value.id === snapshot.id) ? item : { ...item, history: [...item.history, snapshot] }) } : before);
      } catch (error) { if (valid() && !clearAccess(error)) update({ ...target, busy: false, error: true }); }
    });
  };
  const readVersion = (id: string, snapshotId: string, snapshotVersion: number) => {
    const actual = latest.current.page, item = actual?.items.find(value => value.id === id);
    if (!runtime.live() || !item || item.readState === "invalidated") return;
    const snapshot = [item.current, ...item.history].find(value => value?.id === snapshotId && value.version === snapshotVersion) ?? null;
    const meta = reads.current.versions[id]?.page?.items.find(value => value.snapshotId === snapshotId && value.snapshotVersion === snapshotVersion);
    if (!snapshot && (!meta || meta.invalidated || !env.online)) return;
    clearContent();
    const target: ContentBuffer = { documentId: id, snapshotId, snapshotVersion, documentVersion: item.version, authorityVersion: actual!.authorityVersion,
      text: "", totalCharacters: 0, nextOffset: 0, complete: !!snapshot, busy: false, error: false, invalidated: false, snapshot };
    if (snapshot) { reads.current.content = target; setContent(target); } else readVersionChunk(target);
  };
  const visible = runtime.lost ? null : page;
  const checkSaving = pending?.attempt.kind === "change" && pending.attempt.input.action === "check_items" && !checks.paused;
  const checkLocked = busy || exportBusy || !!pending && !checkSaving || !!checks.paused || dirty || runtime.lost || !env.online || load !== "ready" || !canManage || !visible?.canManage;
  const locked = busy || exportBusy || !!pending || checks.dirty || runtime.lost || !env.online || load !== "ready" || !canManage || !visible?.canManage;
  const editingLocked = pending?.reconfirm
    ? busy || exportBusy || runtime.lost || !env.online || !canManage || !visible?.canManage : locked;
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
  const preparationDocuments = visible?.items.filter(item => item.kind === "preparation").map(item => preparationView(checks.project(item, visible.authorityVersion))) ?? [];
  const selectedPreparation = visible?.items.filter(item => item.kind === "preparation" && item.id === selectedId).map(item => {
    const historical = content?.documentId === item.id && content.snapshot && content.snapshot.id !== item.current?.id && item.readState !== "invalidated";
    if (historical) return { ...preparationView({ ...item, current: content.snapshot! }), historical: true };
    if (content?.documentId === item.id && !content.complete && content.snapshotId !== item.current?.id) return { ...preparationView(item), revision: null, sources: [], historical: true };
    return preparationView(checks.project(item, visible.authorityVersion));
  })[0] ?? null;
  const reading: FamilyDocumentReadingPort = { online: env.online && !runtime.lost, activeHasMore: listPages.active.more,
    archiveStarted: listPages.archived.started, archiveReady: listPages.archived.ready, archiveHasMore: listPages.archived.more, pageBusy: busy, pageError,
    indexes: visible?.items.map(item => { const value = versionReads[item.id]; return { documentId: item.id, title: item.current?.title ?? "文件",
      versions: value?.page?.items ?? [], started: !!value, busy: value?.busy ?? false, error: value?.error ?? false, hasMore: !!value?.page?.nextCursor }; }) ?? [],
    content: runtime.lost || !content ? null : { documentId: content.documentId, snapshotId: content.snapshotId, snapshotVersion: content.snapshotVersion,
      loadedCharacters: content.complete ? content.totalCharacters : content.text.length, totalCharacters: content.totalCharacters,
      busy: content.busy, error: content.error, invalidated: content.invalidated, complete: content.complete },
    ensureArchived() { if (!listState.current.archived.started) loadMoreDocuments("archived"); }, loadMoreDocuments, loadVersions, readVersion,
    continueVersion() { const value = reads.current.content; if (runtime.live() && env.online && value && !value.busy && !value.complete && !value.invalidated) readVersionChunk(value); },
    closeVersion: clearContent };
  const condition = runtime.lost ? "lost" : !visible ? busy ? "loading" : load === "error" ? "unavailable" : "empty"
    : load === "error" ? "refresh_failed" : pending && !checkSaving ? "unknown" : !canManage || !visible.canManage ? "read_only" : "ready";
  const createDocument = (input: DocumentRequest, draftId?: string) => {
    const parsed = documentRequestSchema.safeParse(input);
    if (parsed.success && parsed.data.kind === "growth_report" && parsed.data.purpose === "family"
      && latest.current.page?.items.some(item => item.kind === "growth_report" && item.purpose === "family" && item.status === "active"
        && ((item.report?.mode ?? "fixed") === (parsed.data.reportMode ?? "fixed"))
        && (parsed.data.reportMode === "living" || (item.report?.period ?? item.current?.period)?.from === parsed.data.period.from
          && (item.report?.period ?? item.current?.period)?.to === parsed.data.period.to))) {
      setNotice(parsed.data.reportMode === "living" ? "已有持續更新的日常檔案；請沿同一份檔案接續。" : "這個期間已有標準成長報告；請閱讀現行報告，來源有更新時再整理新版本。"); return;
    }
    if (!locked && parsed.success) write({ kind: "create", input: structuredClone(parsed.data) }, false, draftId);
  };
  const preparation: PreparationWorkspaceValue = { scopeKey: env.scopeKey, model: {
    child: { id: env.childId!, displayName: env.childName, accessRole: env.role ?? undefined, ageLabel: "詳見孩子檔案", regionLabel: "詳見孩子檔案", allergiesLabel: null, profileConfirmed: false },
    scope: { authorityKey: env.scopeKey, childId: env.childId!, role: env.role ?? undefined, online: env.online, condition },
    reading, documents: preparationDocuments, selected: selectedPreparation, condition,
    online: env.online, notice, justArchivedId, dataLabel: "Server 家庭共享多用途文件；依據來源及版本整理。", archiveNotice: "只歸檔文件，原來源及任務保留。",
    checkSave: runtime.lost || !checks.dirty ? undefined : checks.paused ?? (checkSaving ? "saving" : "queued"),
    canReapplyChecks: checks.paused === "conflict" && !pending && !busy && load === "ready" && env.online && !!visible?.canManage,
    operation: runtime.lost ? undefined : operation, capabilities: { archive: !locked, checkItem: !checkLocked, restore: !locked, refresh: !locked, create: !locked },
    busy, locked, editingLocked, createDraft: runtime.lost ? null : createDraft, dirty, epoch, retainedDraftId: pending?.attempt.kind === "create" && !pending.reconfirm ? pending.draftId ?? null : null, authorityVersion: visible?.authorityVersion ?? "" }, actions: {
    selectDocument(id) { if (runtime.live() && preparationDocuments.some(item => item.id === id)) {
      if (selection.current.id !== id) flushChecks();
      selection.current = { id, generation: selection.current.generation + 1 }; clearContent(); setSelectedId(id); setJustArchivedId(null);
    } },
    closeDocument() { if (runtime.live()) {
      flushChecks();
      selection.current = { id: null, generation: selection.current.generation + 1 }; clearContent(); setSelectedId(null); setJustArchivedId(null);
    } },
    archiveDocument(id, expectedVersion) { change(id, expectedVersion, "archive"); },
    restoreDocument(id, expectedVersion) { change(id, expectedVersion, "restore"); },
    refreshDocument(id, expectedVersion) { change(id, expectedVersion, "refresh"); },
    checkItem(id, expectedVersion, sectionId, itemId, checked) {
      const current = latest.current.page, doc = current?.items.find(item => item.id === id && item.childId === env.childId);
      if (checkLocked || !runtime.live() || !doc || doc.version !== expectedVersion || !current) return;
      const edited = checks.edit(doc, current.authorityVersion, { sectionId, itemId, checked }, Date.now());
      if (edited && checks.dirty && operation.state === "saved") {
        // The prior receipt does not confirm this new, unsynchronized checklist intent.
        setOperation({ state: "none", message: "", reference: null }); setNotice("");
      }
      notifyChecks();
    },
    reapplyChecks() {
      if (pending || busy || !runtime.live() || !env.online || load !== "ready" || !latest.current.page) return;
      if (checks.reapply(latest.current.page)) { setOperation({ state: "none", message: "", reference: null }); notifyChecks(); }
      else setNotice("清單項目已改變；請核對目前文件，或捨棄未保存的勾選。");
    },
    discardChecks() { if (!pending && runtime.live() && checks.discard()) { setOperation({ state: "none", message: "", reference: null }); notifyChecks(); } },
    createDocument, refresh() { refresh(); }, markDraft() { if (!editingLocked && runtime.live()) setDirty(true); },
    discardDraft() {
      const entry = original.current;
      if (!runtime.live() || entry?.attempt.kind === "create" && !entry.reconfirm) return;
      // Only a definitely rejected request may be forgotten. Unknown writes keep their exact original.
      if (entry?.reconfirm) {
        api.reset(); original.current = null; setPending(null);
        setOperation({ state: "none", message: "", reference: null }); setNotice("");
      }
      setDirty(false); setCreateDraft(null); setEpoch(value => value + 1); if (refreshQueued) refresh();
    },
  }, recovery };
  const { standard, reportDocumentIds, archive: projectedArchive } = projectFamilyDocumentArchive({ page, load, lost: runtime.lost, scopeKey: env.scopeKey, childId: env.childId! });
  const archive: GrowthArchiveProjection = { ...projectedArchive, reading: { ...reading,
    content: reading.content && reportDocumentIds.includes(reading.content.documentId) ? reading.content : null,
    indexes: reading.indexes.filter(index => reportDocumentIds.includes(index.documentId)) } };
  const exportReport = async (request: GrowthReportExportRequest, isCurrent: () => boolean = () => true): Promise<GrowthReportExportResult | undefined> => {
    const actualPage = latest.current.page;
    const findSnapshot = (item: FamilyDocument) => item.readState !== "invalidated" && [item.current, ...item.history].some(snapshot => snapshot?.id === request.snapshotId && snapshot.version === request.snapshotVersion);
    const target = actualPage?.items.find(item => item.kind === "growth_report" && findSnapshot(item));
    // Admit only the rendered page paired with its last successful authoritative read.
    if (pageReadGeneration !== reads.current.generation || inFlight.current || !runtime.live() || !isCurrent() || !env.online || !actualPage || !target
      || request.scopeKey !== env.scopeKey || request.childId !== env.childId || request.authorityVersion !== actualPage.authorityVersion
      || request.periodId !== null && request.periodId !== request.snapshotId + ":" + request.snapshotVersion) return;
    const token = { documentId: target.id, snapshotId: request.snapshotId, invalidated: false }; exporting.current = token;
    inFlight.current = true; setExportBusy(true);
    return await runtime.request(async (signal, current): Promise<GrowthReportExportResult | undefined> => {
      const valid = () => !token.invalidated && current() && isCurrent() && env.online && request.scopeKey === env.scopeKey && request.childId === env.childId
        && latest.current.page?.authorityVersion === request.authorityVersion
        && latest.current.page.items.some(item => item.id === target.id && findSnapshot(item));
      try {
        const blob = await api.exportPdf(env.childId!, target.id, { snapshotId: request.snapshotId, snapshotVersion: request.snapshotVersion,
          authorityVersion: request.authorityVersion, purpose: request.purpose === "care_handoff" ? "handoff" : request.purpose,
          includeSources: request.includeSources, includeRevision: request.includeRevision }, signal, env.userId!);
        if (!valid()) return;
        const message = await exportBlob(blob, `growth-report-${request.snapshotId}-v${request.snapshotVersion}.pdf`, valid);
        if (!valid()) return;
        setNotice(message); return { state: "ready", message };
      } catch (error) {
        // Revocation still clears this owner after the dialog is canceled.
        if (!current() || clearAccess(error) || !valid()) return;
        if (error instanceof FamilyDocumentApiError && error.status === 409) {
          try { const next = await read(signal); if (!valid()) return; applyFreshPage(next); }
          catch (readError) { if (!current() || clearAccess(readError) || !valid()) return; setLoad("error"); }
        }
        if (!current() || !isCurrent()) return;
        const message = "PDF 未能取得，沒有改用其他版本。請重新讀取並核對來源後再試。";
        setNotice(message); return { state: "error", message };
      } finally {
        // Only this request can release its lock, including after access loss.
        if (exporting.current === token) { exporting.current = null; inFlight.current = false; setExportBusy(false); }
      }
    });
  };
  return { readState: load, preparation, archive, operation, recovery, busy, exportBusy, locked, editingLocked, createDraft: runtime.lost ? null : createDraft, dirty, epoch, notice, standard, flushChecks,
    authorityVersion: visible?.authorityVersion ?? "", retainedDraftId: pending?.attempt.kind === "create" && !pending.reconfirm ? pending.draftId ?? null : null, createDocument, exportReport,
    refreshReport() { if (standard) change(standard.id, standard.version, "refresh"); },
    refresh() { refresh(); }, markDraft: preparation.actions.markDraft!, discardDraft: preparation.actions.discardDraft! };
}

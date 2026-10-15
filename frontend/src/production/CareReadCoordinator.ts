import type { QueryClient } from "@tanstack/react-query";
import { CareApiError, type CareApi } from "../../../src/client/care-api.ts";
import type { CareCursor, CarePage } from "../../../src/shared/care.ts";
import type { CareFilter, CareRecordsViewModel } from "../care-view-model.ts";
import type { CareSnapshot, careRecordView, careRevisionView, savedRecordReview } from "./CareProfileProjections.ts";

type Cell<T> = { current: T };

/** The mounted bridge owns these cells so reads, writes and scope cleanup share one lifetime. */
export interface CareReadState {
  careRef: Cell<CareRecordsViewModel>;
  writing: Cell<boolean>;
  attempt: Cell<unknown | null>;
  careRead: Cell<AbortController | null>;
  careGeneration: Cell<number>;
  recordReadGeneration: Cell<number>;
  recordRemovals: Cell<Map<string, number>>;
  historyGeneration: Cell<number>;
  openGeneration: Cell<number>;
  pageCursors: Cell<(CareCursor | null)[]>;
  pageIndex: Cell<number>;
  nextCursor: Cell<CareCursor | null>;
  careHistoryCursor: Cell<number | null>;
}

export interface CareReadPorts {
  queryClient: QueryClient;
  api: Pick<CareApi, "getSession" | "search" | "history">;
  careKey: readonly unknown[];
  childId: string;
  userId: string;
  scopeKey: string;
  state: CareReadState;
  current(): boolean;
  online(): boolean;
  controller(): AbortController;
  released(control: AbortController): unknown;
  onAccessError(error: { status: number; code: string | null }): unknown;
  setCare(update: (previous: CareRecordsViewModel) => CareRecordsViewModel): void;
  careRecordView: typeof careRecordView;
  careRevisionView: typeof careRevisionView;
  savedRecordReview: typeof savedRecordReview;
  careOperation(): CareRecordsViewModel["operation"];
}

/** Care reads coordinate the existing QueryClient; no second record store or React runtime is required. */
export function createCareReadCoordinator(ports: CareReadPorts) {
  const { queryClient, api, careKey, childId, userId, scopeKey, current, online, controller, released,
    onAccessError, setCare, careRecordView, careRevisionView, savedRecordReview, careOperation } = ports;
  const { careRef, writing, attempt, careRead, careGeneration, recordReadGeneration, recordRemovals,
    historyGeneration, openGeneration, pageCursors, pageIndex, nextCursor, careHistoryCursor } = ports.state;
  async function verify(signal: AbortSignal) {
    if (!current()) throw new CareApiError(401, "session_changed");
    if (await api.getSession(signal) !== userId) throw new CareApiError(401, "session_changed");
    if (!current()) throw new CareApiError(401, "session_changed");
  }
  function accessError(error: unknown, childRead = false) {
    if (!(error instanceof CareApiError)) return false;
    if (error.status === 401 || error.status === 403 || error.onlineCode === "session_changed") {
      onAccessError({ status: error.status, code: error.onlineCode }); return true;
    }
    // Only a child-scoped read's 404 proves loss of this child's access. A record's 404 does not.
    if (childRead && error.status === 404) { onAccessError({ status: 403, code: "access_denied" }); return true; }
    return false;
  }
  async function read<T>(key: readonly unknown[], control: AbortController, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return queryClient.fetchQuery({ queryKey: key, staleTime: 0, gcTime: Infinity, retry: false, queryFn: async ({ signal }) => {
      const abort = () => control.abort(); signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) control.abort();
      try { await verify(control.signal); const value = await action(control.signal); await verify(control.signal); return value; }
      finally { signal.removeEventListener("abort", abort); }
    } });
  }
  const rawRecord = (id: string) => queryClient.getQueryData<CareSnapshot>([...careKey, "record", id]) ?? null;
  function freshRecord(id: string) {
    const cached = queryClient.getQueryState<CareSnapshot>([...careKey, "record", id]);
    return cached?.status === "success" && !cached.isInvalidated ? cached.data ?? null : null;
  }
  function publishRecord(record: CareSnapshot, generation: number): CareSnapshot | null {
    if (record.childId !== childId || (recordRemovals.current.get(record.id) ?? 0) > generation) return null;
    const known = rawRecord(record.id);
    // Search and single-record reads can complete out of order within the same scope.
    if (known && known.version > record.version) return known;
    queryClient.setQueryData([...careKey, "record", record.id], record);
    return record;
  }
  function removeRecord(id: string) {
    recordRemovals.current.set(id, ++recordReadGeneration.current);
    queryClient.removeQueries({ queryKey: [...careKey, "record", id] });
    queryClient.removeQueries({ queryKey: [...careKey, "history", id] });
    queryClient.removeQueries({ queryKey: [...careKey, "latest", id] });
    historyGeneration.current++;
  }
  function publishPage(page: CarePage, query: string, kind: CareFilter, index: number, generation: number) {
    const records = page.records.flatMap(record => { const published = publishRecord(record, generation); return published ? [published] : []; });
    nextCursor.current = page.nextCursor; pageIndex.current = index;
    setCare(previous => {
      const selected = previous.detail && records.find(record => record.id === previous.detail!.record.id);
      return { ...previous, list: { state: "ready", hasSnapshot: true, records: records.map(record => careRecordView(record, userId)),
        activeQuery: query, activeKind: kind, scanned: page.scanned, hasMore: page.nextCursor !== null, page: index + 1, hasPrevious: index > 0, message: null },
        detail: previous.detail && !previous.draft && !previous.deletion && selected
          ? { ...previous.detail, record: careRecordView(selected, userId),
            ...(selected.version !== previous.detail.record.current.version
              ? { historyOpen: false, history: [], historyLoading: false, historyState: "unread", historyRetryMore: false, hasMoreHistory: false } : {}) } : previous.detail };
    });
  }
  async function loadCare(query = careRef.current.list.activeQuery, kind = careRef.current.list.activeKind, index = 0, recovery = false): Promise<boolean> {
    if (!current() || !online() || writing.current || attempt.current && !recovery) return false;
    careRead.current?.abort(); const control = controller(); careRead.current = control; const generation = ++careGeneration.current;
    const recordGeneration = ++recordReadGeneration.current;
    // Retain off-page snapshots, but a search refresh cannot verify records it did not return.
    void queryClient.invalidateQueries({ queryKey: [...careKey, "record"], refetchType: "none" });
    if (index === 0) { pageCursors.current = [null]; pageIndex.current = 0; nextCursor.current = null; }
    const cursor = pageCursors.current[index] ?? null;
    setCare(previous => {
      const hasSnapshot = !!previous.list.hasSnapshot && previous.list.activeQuery === query && previous.list.activeKind === kind && previous.list.page === index + 1;
      return { ...previous, list: { ...previous.list, state: index ? "loading_more" : "loading", message: null, hasSnapshot,
        ...(index === 0 ? { page: 1, hasPrevious: false, hasMore: hasSnapshot ? previous.list.hasMore : false, activeQuery: query, activeKind: kind } : {}) } };
    });
    try {
      await queryClient.cancelQueries({ queryKey: [...careKey, "search"] });
      if (!current() || generation !== careGeneration.current || control.signal.aborted) return false;
      const page = await read<CarePage>([...careKey, "search", query, kind, cursor], control, signal => api.search(childId,
        { query, ...(kind === "all" ? {} : { kind }), ...(cursor ? { cursor } : {}) }, signal, userId));
      if (!current() || generation !== careGeneration.current || control.signal.aborted) return false;
      const selected = careRef.current.detail, selectedInPage = selected ? page.records.find(record => record.id === selected.record.id) : null;
      if (selectedInPage && selectedInPage.version !== selected?.record.current.version) historyGeneration.current++;
      publishPage(page, query, kind, index, recordGeneration);
      if (selected && !selectedInPage && !careRef.current.draft && !careRef.current.deletion) {
        const selectedGeneration = openGeneration.current;
        const latest = await latestCare(selected.record.id);
        if (current() && generation === careGeneration.current && !control.signal.aborted && selectedGeneration === openGeneration.current
          && !careRef.current.draft && !careRef.current.deletion && latest && careRef.current.detail?.record.id === latest.id) {
          if (latest.version !== selected.record.current.version) historyGeneration.current++;
          setCare(previous => ({ ...previous, detail: previous.detail?.record.id === latest.id
            ? { record: careRecordView(latest, userId), historyOpen: false, history: [], historyLoading: false, historyState: "unread", historyRetryMore: false, hasMoreHistory: false } : previous.detail }));
        }
      }
      return current() && generation === careGeneration.current;
    } catch (error) {
      if (!current() || generation !== careGeneration.current || control.signal.aborted) return false;
      if (!accessError(error, true)) setCare(previous => ({ ...previous, list: { ...previous.list,
        state: previous.list.hasSnapshot || error instanceof CareApiError && error.onlineCode === "cursor_stale" ? "stale" : "error",
        message: error instanceof CareApiError && error.onlineCode === "cursor_stale" ? "記錄已變更，請重新搜尋；不會沿用舊分頁游標。" : previous.list.hasSnapshot ? "未能更新，仍顯示上次讀取的記錄。" : "未能讀取記錄，請重試。" } }));
      return false;
    } finally { released(control); }
  }
  async function latestCare(id: string, revalidate = true): Promise<CareSnapshot | null> {
    if (!current() || !online()) return null;
    const basis = rawRecord(id), generation = ++recordReadGeneration.current, refreshGeneration = careGeneration.current;
    const control = controller();
    try {
      const page = await read([...careKey, "latest", id], control, signal => api.history(childId, id, null, signal));
      if (!current() || control.signal.aborted) return null;
      const latest = [...page.revisions].sort((a, b) => b.version - a.version)[0];
      if (!latest) throw new Error("The current record revision was not returned");
      if (refreshGeneration !== careGeneration.current) {
        const known = freshRecord(id);
        // A later page can verify this id, but its absence cannot validate an earlier detail read.
        if (known && known.version >= latest.version) return known;
        return revalidate ? await latestCare(id, false) : null;
      }
      const result: CareSnapshot = { ...latest, id, childId, createdAt: rawRecord(id)?.createdAt ?? basis?.createdAt ?? null };
      return publishRecord(result, generation);
    } catch (error) {
      if (!current() || control.signal.aborted || accessError(error)) return null;
      if (refreshGeneration !== careGeneration.current) return freshRecord(id) ?? (revalidate ? await latestCare(id, false) : null);
      if (error instanceof CareApiError && error.status === 404) {
        removeRecord(id);
        setCare(previous => ({ ...previous, detail: previous.detail?.record.id === id ? null : previous.detail,
          list: { ...previous.list, records: previous.list.records.filter(record => record.id !== id), message: "所選記錄已刪除或目前不可讀；不再顯示舊記錄。" } }));
      } else {
        void queryClient.invalidateQueries({ queryKey: [...careKey, "record", id], exact: true, refetchType: "none" });
        setCare(previous => previous.detail?.record.id === id ? { ...previous,
          operation: { ...previous.operation, message: "未能核對所選記錄的目前版本；仍顯示上次讀取的內容，請稍後重試。" } } : previous);
      }
      return null;
    }
    finally { released(control); }
  }
  async function careHistory(more: boolean) {
    const detail = careRef.current.detail;
    if (!detail || !current() || !online() || detail.historyLoading || more && !detail.hasMoreHistory) return;
    const id = detail.record.id, before = more ? careHistoryCursor.current : detail.record.current.version;
    const generation = ++historyGeneration.current, control = controller();
    setCare(previous => ({ ...previous, detail: previous.detail ? { ...previous.detail, historyOpen: true, historyLoading: true, historyState: "unread", historyRetryMore: more } : null }));
    try {
      const page = await read([...careKey, "history", id, before], control, signal => api.history(childId, id, before, signal));
      if (!current() || generation !== historyGeneration.current || careRef.current.detail?.record.id !== id) return;
      careHistoryCursor.current = page.nextBeforeVersion;
      setCare(previous => ({ ...previous, detail: previous.detail ? { ...previous.detail, historyLoading: false, historyState: "ready", historyRetryMore: false,
        history: [...(more ? previous.detail.history : []), ...page.revisions.map(revision => careRevisionView(revision, userId))], hasMoreHistory: page.nextBeforeVersion !== null } : null }));
    } catch (error) {
      if (current() && generation === historyGeneration.current && !accessError(error)) setCare(previous => ({ ...previous,
        detail: previous.detail ? { ...previous.detail, historyLoading: false, historyState: "error", historyRetryMore: more } : null }));
    } finally { released(control); }
  }
  function openRecord(id: string) {
    if (!current() || attempt.current || careRef.current.draft || careRef.current.deletion) return;
    const record = freshRecord(id), generation = ++openGeneration.current;
    if (record && careRef.current.detail?.record.id === id && careRef.current.detail.record.current.version === record.version) return;
    historyGeneration.current++;
    if (!record) {
      if (!online()) { setCare(previous => ({ ...previous, detail: null, detailRead: { id, state: "error" }, list: { ...previous.list, message: "所指定記錄未載入或已過期；連線恢復後才可核對。" } })); return; }
      setCare(previous => ({ ...previous, detail: null, detailRead: { id, state: "loading" }, operation: { ...careOperation(), message: "正在核對所指定記錄的目前版本。" } }));
      void latestCare(id).then(latest => {
        if (!current() || generation !== openGeneration.current || attempt.current || careRef.current.draft || careRef.current.deletion) return;
        setCare(previous => ({ ...previous, detailRead: { id, state: latest ? "ready" : "error" }, detail: latest ? { record: careRecordView(latest, userId), historyOpen: false, history: [], historyLoading: false, historyState: "unread", historyRetryMore: false, hasMoreHistory: false } : null,
          operation: latest ? careOperation() : { ...careOperation(), message: "所指定記錄目前不可讀或未能核對；沒有顯示舊記錄或其他孩子資料。" } }));
      });
      return;
    }
    setCare(previous => ({ ...previous, detailRead: { id, state: "ready" }, detail: { record: careRecordView(record, userId), historyOpen: false, history: [], historyLoading: false, historyState: "unread", historyRetryMore: false, hasMoreHistory: false }, operation: careOperation() }));
  }
  function pauseReads() {
    careGeneration.current++; historyGeneration.current++;
    careRead.current?.abort();
    setCare(previous => ({ ...previous, list: { ...previous.list, state: "stale" },
      detail: previous.detail?.historyLoading ? { ...previous.detail, historyLoading: false, historyState: "unread" } : previous.detail }));
  }
  function reviewProjection(care: CareRecordsViewModel): CareRecordsViewModel["review"] {
    return { state: (care.list.state === "loading" || care.list.state === "loading_more") && !care.list.hasSnapshot ? "loading" : care.list.state === "error" ? "error" : care.list.state === "stale" && !care.list.hasSnapshot ? "unavailable" : "ready",
      scopeKey, label: "已保存照護記錄", hasMore: care.list.hasMore, capabilities: { create: false, update: false, skip: false, confirmImportant: false },
      items: care.list.records.flatMap(record => { const raw = rawRecord(record.id); return raw ? [savedRecordReview(raw, userId)] : []; }) };
  }
  return { verify, accessError, read, rawRecord, freshRecord, publishRecord, removeRecord, publishPage,
    loadCare, latestCare, careHistory, openRecord, pauseReads, reviewProjection };
}

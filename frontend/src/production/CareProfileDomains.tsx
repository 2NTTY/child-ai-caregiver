import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "expo-router";
import { CareApiError, createCareApi } from "../../../src/client/care-api";
import { ONLINE_REFRESH_EVENT } from "../../../src/client/use-online-updates";
import type { CareCursor, CarePage, CareRecord, CareValues, ChildProfile, ChildProfileData } from "../../../src/shared/care";
import type { OnlineReceipt } from "../../../src/shared/online";
import { emptyCareForm, type CareFilter, type CareRecordsActions, type CareRecordsViewModel } from "../care-view-model";
import { emptyProfileForm, profileDataFromForm, profileFormFromData, type ProfileActions, type ProfileViewModel } from "../profile-view-model";
import { careFormSchema } from "../components/care/care-form";
import { profileFormSchema } from "../components/profile/profile-form";
import { CareWorkspaceProvider, type CareWorkspaceValue } from "../workspaces/CareWorkspace";
import { ProfileWorkspaceProvider, type ProfileWorkspaceValue } from "../workspaces/ProfileWorkspace";
import { careRecordView, careRevisionView, careValuesFromForm, profileRevisionView, savedRecordReview, type CareSnapshot } from "./CareProfileProjections";
import { useDomainEnvironment, useDomainWriteGuard } from "./useDomainEnvironment";

type Environment = ReturnType<typeof useDomainEnvironment>;
type Attempt = ({ domain: "care"; kind: "create" | "revise" | "delete"; recordId: string | null; version: number; values: CareValues | null; reason: string }
  | { domain: "profile"; kind: "save" | "delete"; version: number; data: ChildProfileData | null; reason: string })
  & { confirmed: boolean; retry: boolean; receipt: OnlineReceipt | null };
type Recovery = { pending: boolean; profileRetryAvailable: boolean; checkProfile(): void; retryProfile(): void };
type DomainProjection = { scopeKey: string; care: CareWorkspaceValue; profile: ProfileWorkspaceValue; recovery: Recovery };
const RecoveryContext = createContext<Recovery | null>(null);
export const useProductionCareProfile = () => useContext(RecoveryContext);
const careOperation = (): CareRecordsViewModel["operation"] => ({ state: "none", message: "", reference: null, latest: null });
const profileOperation = (): ProfileViewModel["operation"] => ({ state: "none", message: "", reference: null });

/** Mounted once by the formal host; all pages consume the same canonical cache and write owner. */
export function ProductionCareProfileDomains({ children }: { children: ReactNode }) {
  const env = useDomainEnvironment();
  const [projection, publish] = useState<DomainProjection | null>(null);
  const scoped = projection?.scopeKey === env.scopeKey && !!env.scopeKey ? projection : null;
  useLayoutEffect(() => { publish(previous => previous?.scopeKey === env.scopeKey && !!env.scopeKey ? previous : null); }, [env.scopeKey]);
  return <RecoveryContext.Provider value={scoped?.recovery ?? null}>
    <CareWorkspaceProvider scopeKey={env.scopeKey} value={scoped?.care ?? null}>
      <ProfileWorkspaceProvider scopeKey={env.scopeKey} value={scoped?.profile ?? null}>
        {env.scopeKey && env.userId && env.childId ? <CareProfileOwner key={env.scopeKey} env={env} publish={publish} /> : null}
        {children}
      </ProfileWorkspaceProvider>
    </CareWorkspaceProvider>
  </RecoveryContext.Provider>;
}

// Only this nonvisual bridge resets on scope. Memo prevents a publish/parent-render loop.
const CareProfileOwner = memo(function CareProfileOwner({ env, publish }: { env: Environment; publish(value: DomainProjection): void }) {
  const childId = env.childId!, userId = env.userId!, pathname = usePathname();
  const api = useMemo(() => {
    // This mounted owner retains its cache across routes; the host's default gcTime is zero.
    env.queryClient.setQueryDefaults(["production", env.scopeKey, "care"], { gcTime: Infinity });
    env.queryClient.setQueryDefaults(["production", env.scopeKey, "profile"], { gcTime: Infinity });
    return createCareApi(env.apiBaseUrl);
  }, [env.apiBaseUrl, env.queryClient, env.scopeKey]);
  const editable = env.role === "owner" || env.role === "caregiver";
  const careKey = ["production", env.scopeKey, "care"] as const;
  const profileKey = ["production", env.scopeKey, "profile"] as const;
  const [care, setCare] = useState<CareRecordsViewModel>(() => ({ child: { id: childId, name: env.childName, summary: "" },
    scopeKey: env.scopeKey, access: editable ? "editable" : "read_only", online: env.online, dataLabel: "Server 已保存照護記錄",
    list: { state: "loading", records: [], activeQuery: "", activeKind: "all", scanned: 0, hasMore: false, page: 1, hasPrevious: false, message: null },
    detail: null, draft: null, deletion: null, operation: careOperation(), submitLabel: "我已核對，確認家庭共享", checkLabel: "查核原操作" }));
  const [profile, setProfile] = useState<ProfileViewModel>(() => ({ child: { id: childId, name: env.childName }, access: editable ? "editable" : "read_only",
    online: env.online, reading: true, needsRefresh: false, current: null, basis: null, latest: null, history: [], historyOpen: false,
    hasMoreHistory: false, initialValues: emptyProfileForm(), formKey: 0, reviewedValues: null, intent: null, operation: profileOperation(), notice: null }));
  const careRef = useRef(care), profileRef = useRef(profile), envRef = useRef(env);
  careRef.current = care; profileRef.current = profile; envRef.current = env;
  const attempt = useRef<Attempt | null>(null), writing = useRef(false), [pending, setPending] = useState(false);
  const refreshDeferred = useRef(false);
  const [profileDirty, setProfileDirty] = useState(false), dirtyRef = useRef(false);
  dirtyRef.current = profileDirty;
  const draftBasis = useRef<CareSnapshot | null>(null);
  const pageCursors = useRef<(CareCursor | null)[]>([null]), pageIndex = useRef(0), nextCursor = useRef<CareCursor | null>(null);
  const careHistoryCursor = useRef<number | null>(null), profileHistoryCursor = useRef<number | null>(null);
  const careGeneration = useRef(0), profileGeneration = useRef(0), historyGeneration = useRef(0);
  const openGeneration = useRef(0);
  const controllers = useRef(new Set<AbortController>()), careRead = useRef<AbortController | null>(null), profileRead = useRef<AbortController | null>(null);
  useDomainWriteGuard(!!care.draft || !!care.deletion || profileDirty, pending, "child");

  const current = () => envRef.current.current() && envRef.current.currentIdentity();
  const controller = () => { const value = new AbortController(); controllers.current.add(value); return value; };
  const released = (value: AbortController) => controllers.current.delete(value);
  async function verify(signal: AbortSignal) {
    if (!current()) throw new CareApiError(401, "session_changed");
    if (await api.getSession(signal) !== userId) throw new CareApiError(401, "session_changed");
    if (!current()) throw new CareApiError(401, "session_changed");
  }
  function accessError(error: unknown, childRead = false) {
    if (!(error instanceof CareApiError)) return false;
    if (error.status === 401 || error.status === 403 || error.onlineCode === "session_changed") {
      envRef.current.accessError({ status: error.status, code: error.onlineCode }); return true;
    }
    // Only a child-scoped read's 404 proves loss of this child's access. A record's 404 does not.
    if (childRead && error.status === 404) { envRef.current.accessError({ status: 403, code: "access_denied" }); return true; }
    return false;
  }
  async function read<T>(key: readonly unknown[], control: AbortController, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return env.queryClient.fetchQuery({ queryKey: key, staleTime: 0, gcTime: Infinity, retry: false, queryFn: async ({ signal }) => {
      const abort = () => control.abort(); signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) control.abort();
      try { await verify(control.signal); const value = await action(control.signal); await verify(control.signal); return value; }
      finally { signal.removeEventListener("abort", abort); }
    } });
  }
  const rawRecord = (id: string) => env.queryClient.getQueryData<CareSnapshot>([...careKey, "record", id]) ?? null;
  function publishPage(page: CarePage, query: string, kind: CareFilter, index: number) {
    page.records.forEach(record => env.queryClient.setQueryData([...careKey, "record", record.id], record));
    nextCursor.current = page.nextCursor; pageIndex.current = index;
    setCare(previous => ({ ...previous, list: { state: "ready", records: page.records.map(record => careRecordView(record, userId)),
      activeQuery: query, activeKind: kind, scanned: page.scanned, hasMore: page.nextCursor !== null, page: index + 1, hasPrevious: index > 0, message: null },
      detail: previous.detail && !previous.draft && !previous.deletion && page.records.some(record => record.id === previous.detail!.record.id)
        ? { ...previous.detail, record: careRecordView(page.records.find(record => record.id === previous.detail!.record.id)!, userId),
          ...(page.records.find(record => record.id === previous.detail!.record.id)!.version !== previous.detail.record.current.version
            ? { historyOpen: false, history: [], historyLoading: false, hasMoreHistory: false } : {}) } : previous.detail }));
  }
  async function loadCare(query = careRef.current.list.activeQuery, kind = careRef.current.list.activeKind, index = 0, recovery = false): Promise<boolean> {
    if (!current() || !envRef.current.online || writing.current || attempt.current && !recovery) return false;
    careRead.current?.abort(); const control = controller(); careRead.current = control; const generation = ++careGeneration.current;
    if (index === 0) { pageCursors.current = [null]; pageIndex.current = 0; nextCursor.current = null; }
    const cursor = pageCursors.current[index] ?? null;
    setCare(previous => ({ ...previous, list: { ...previous.list, state: index ? "loading_more" : "loading", message: null,
      ...(index === 0 ? { page: 1, hasPrevious: false, hasMore: false, activeQuery: query, activeKind: kind } : {}) } }));
    try {
      await env.queryClient.cancelQueries({ queryKey: [...careKey, "search"] });
      if (!current() || generation !== careGeneration.current || control.signal.aborted) return false;
      const page = await read<CarePage>([...careKey, "search", query, kind, cursor], control, signal => api.search(childId,
        { query, ...(kind === "all" ? {} : { kind }), ...(cursor ? { cursor } : {}) }, signal, userId));
      if (!current() || generation !== careGeneration.current || control.signal.aborted) return false;
      const selected = careRef.current.detail, selectedInPage = selected ? page.records.find(record => record.id === selected.record.id) : null;
      if (selectedInPage && selectedInPage.version !== selected?.record.current.version) historyGeneration.current++;
      publishPage(page, query, kind, index);
      if (selected && !selectedInPage && !careRef.current.draft && !careRef.current.deletion) {
        const latest = await latestCare(selected.record.id);
        if (current() && generation === careGeneration.current && latest && careRef.current.detail?.record.id === latest.id) {
          if (latest.version !== selected.record.current.version) historyGeneration.current++;
          setCare(previous => ({ ...previous, detail: previous.detail?.record.id === latest.id
            ? { record: careRecordView(latest, userId), historyOpen: false, history: [], historyLoading: false, hasMoreHistory: false } : previous.detail }));
        }
      }
      return current() && generation === careGeneration.current;
    } catch (error) {
      if (!current() || generation !== careGeneration.current || control.signal.aborted) return false;
      if (!accessError(error, true)) setCare(previous => ({ ...previous, list: { ...previous.list,
        state: error instanceof CareApiError && error.onlineCode === "cursor_stale" ? "stale" : "error",
        message: error instanceof CareApiError && error.onlineCode === "cursor_stale" ? "記錄已變更，請重新搜尋；不會沿用舊分頁游標。" : "未能讀取目前記錄；請重新搜尋。" } }));
      return false;
    } finally { released(control); }
  }
  function publishProfile(value: ChildProfile, reset: boolean) {
    env.queryClient.setQueryData([...profileKey, "current"], value);
    const revision = profileRevisionView(value, userId);
    setProfile(previous => ({ ...previous, current: revision, reading: false, needsRefresh: false, notice: null,
      ...(!reset && previous.operation.state === "conflict" ? { latest: revision } : {}),
      ...(reset ? { basis: revision, latest: null, initialValues: profileFormFromData(value.data), formKey: previous.formKey + 1,
        reviewedValues: null, intent: null, history: [], historyOpen: false, hasMoreHistory: false } : {}) }));
    if (reset) setProfileDirty(false);
  }
  async function loadProfile(recovery = false): Promise<boolean> {
    if (!current() || !envRef.current.online || writing.current || attempt.current && !recovery) return false;
    profileRead.current?.abort(); const control = controller(); profileRead.current = control; const generation = ++profileGeneration.current;
    setProfile(previous => ({ ...previous, reading: true, notice: null }));
    try {
      await env.queryClient.cancelQueries({ queryKey: [...profileKey, "current"] });
      if (!current() || generation !== profileGeneration.current || control.signal.aborted) return false;
      const value = await read([...profileKey, "current"], control, signal => api.getProfile(childId, signal));
      if (!current() || generation !== profileGeneration.current || control.signal.aborted) return false;
      publishProfile(value, recovery || !dirtyRef.current); return true;
    } catch (error) {
      if (!current() || generation !== profileGeneration.current || control.signal.aborted) return false;
      if (!accessError(error, true)) setProfile(previous => ({ ...previous, reading: false, needsRefresh: true, notice: "未能核對目前檔案，請重新讀取後才確認共享。" }));
      return false;
    } finally { released(control); }
  }

  const reloadRef = useRef({ loadCare, loadProfile }); reloadRef.current = { loadCare, loadProfile };
  useEffect(() => {
    if (env.online) {
      if (attempt.current || writing.current) refreshDeferred.current = true;
      else { refreshDeferred.current = false; void reloadRef.current.loadCare(); void reloadRef.current.loadProfile(); }
    } else {
      careGeneration.current++; profileGeneration.current++; historyGeneration.current++;
      careRead.current?.abort(); profileRead.current?.abort();
      setCare(previous => ({ ...previous, list: { ...previous.list, state: "stale" } })); setProfile(previous => ({ ...previous, reading: false, needsRefresh: true }));
    }
  }, [env.online]);
  useEffect(() => {
    const refresh = () => {
      if (!current()) return;
      if (attempt.current || writing.current) { refreshDeferred.current = true; setProfile(previous => ({ ...previous, needsRefresh: true })); return; }
      refreshDeferred.current = false;
      void reloadRef.current.loadCare(); void reloadRef.current.loadProfile();
    };
    if (typeof window !== "undefined") window.addEventListener(ONLINE_REFRESH_EVENT, refresh);
    return () => {
      if (typeof window !== "undefined") window.removeEventListener(ONLINE_REFRESH_EVENT, refresh);
      controllers.current.forEach(control => control.abort()); api.resetOnline?.();
      void env.queryClient.cancelQueries({ queryKey: careKey }); void env.queryClient.cancelQueries({ queryKey: profileKey });
      env.queryClient.removeQueries({ queryKey: careKey }); env.queryClient.removeQueries({ queryKey: profileKey });
    };
  }, [api, env.scopeKey]);
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current !== pathname && !attempt.current) {
      if (lastPath.current === "/care") { draftBasis.current = null; setCare(previous => ({ ...previous, draft: null, deletion: null, detail: null, operation: careOperation() })); }
      if (lastPath.current === "/profile") {
        setProfileDirty(false); setProfile(previous => ({ ...previous, basis: previous.current, latest: null,
          initialValues: profileFormFromData(previous.current?.data ?? null), formKey: previous.formKey + 1, reviewedValues: null, intent: null, operation: profileOperation() }));
      }
    }
    lastPath.current = pathname;
  }, [pathname]);

  const canWrite = () => current() && envRef.current.online && (envRef.current.role === "owner" || envRef.current.role === "caregiver")
    && !attempt.current && !writing.current && envRef.current.canStartWrite();
  function unknown(value: Attempt, message: string) {
    if (value.domain === "care") setCare(previous => ({ ...previous, operation: { ...previous.operation, state: "unknown", message,
      reference: value.receipt?.operation.opId ?? previous.operation.reference, retryAvailable: value.retry && !value.confirmed } }));
    else setProfile(previous => ({ ...previous, operation: { state: "unknown", message, reference: value.receipt?.operation.opId ?? previous.operation.reference, resultUnavailable: value.confirmed } }));
  }
  async function latestCare(id: string): Promise<CareSnapshot | null> {
    const basis = rawRecord(id);
    const control = controller();
    try {
      const page = await read([...careKey, "latest", id], control, signal => api.history(childId, id, null, signal));
      if (!current() || control.signal.aborted) return null;
      const latest = [...page.revisions].sort((a, b) => b.version - a.version)[0];
      if (!latest) return null;
      const result: CareSnapshot = { ...latest, id, childId, createdAt: basis?.createdAt ?? null };
      env.queryClient.setQueryData([...careKey, "record", id], result); return result;
    } catch (error) {
      if (current() && !accessError(error) && error instanceof CareApiError && error.status === 404) {
        env.queryClient.removeQueries({ queryKey: [...careKey, "record", id] });
        env.queryClient.removeQueries({ queryKey: [...careKey, "history", id] }); historyGeneration.current++;
        setCare(previous => ({ ...previous, detail: previous.detail?.record.id === id ? null : previous.detail,
          list: { ...previous.list, records: previous.list.records.filter(record => record.id !== id), message: "所選記錄已刪除或目前不可讀；不再顯示舊記錄。" } }));
      }
      return null;
    }
    finally { released(control); }
  }
  function finish(value: Attempt, record?: CareRecord, savedProfile?: ChildProfile) {
    attempt.current = null; setPending(false); draftBasis.current = null;
    if (value.domain === "care") {
      if (record) env.queryClient.setQueryData([...careKey, "record", record.id], record);
      if (value.kind === "delete" && value.recordId) {
        env.queryClient.removeQueries({ queryKey: [...careKey, "record", value.recordId] });
        env.queryClient.removeQueries({ queryKey: [...careKey, "history", value.recordId] });
        env.queryClient.removeQueries({ queryKey: [...careKey, "latest", value.recordId] });
        env.queryClient.removeQueries({ queryKey: [...careKey, "search"] });
      }
      setCare(previous => ({ ...previous, draft: null, deletion: null,
        ...(value.kind === "delete" ? { list: { ...previous.list, records: previous.list.records.filter(item => item.id !== value.recordId) } } : {}),
        detail: record ? { record: careRecordView(record, userId), historyOpen: false, history: [], historyLoading: false, hasMoreHistory: false } : null,
        operation: { state: "saved", kind: value.kind === "delete" ? "delete" : "review", message: value.kind === "delete" ? "Server 已確認永久刪除記錄及歷史。" : "Server 已確認家庭共享保存。",
          reference: value.receipt?.operation.opId ?? null, latest: null } }));
    } else {
      if (value.kind === "delete") env.queryClient.removeQueries({ queryKey: [...profileKey, "history"] });
      if (savedProfile) publishProfile(savedProfile, true);
      setProfileDirty(false); setProfile(previous => ({ ...previous, intent: null, reviewedValues: null,
        operation: { state: "saved", message: value.kind === "delete" ? "Server 已確認永久刪除檔案及全部歷史。" : "Server 已確認家庭共享檔案。", reference: value.receipt?.operation.opId ?? null } }));
    }
    envRef.current.invalidate();
  }
  async function submit(value: Attempt, retry = false) {
    if (!current() || !envRef.current.online || writing.current || !editable || (retry ? attempt.current !== value || value.confirmed || !value.retry : !canWrite())) return;
    attempt.current = value; writing.current = true; setPending(true); value.retry = false;
    historyGeneration.current++;
    careRead.current?.abort(); profileRead.current?.abort();
    if (value.domain === "care") setCare(previous => ({ ...previous, operation: { ...previous.operation, state: "saving", message: "正在確認同一操作。", retryAvailable: false } }));
    else setProfile(previous => ({ ...previous, operation: { state: "saving", message: "正在確認同一操作。", reference: previous.operation.reference } }));
    const control = controller();
    try {
      await verify(control.signal);
      if (value.domain === "care") {
        let record: CareRecord | undefined;
        if (value.kind === "create") record = await api.create(childId, value.values!, control.signal, userId);
        else if (value.kind === "revise") record = await api.revise(childId, value.recordId!, value.values!, value.version, value.reason, control.signal, userId);
        else await api.delete(childId, value.recordId!, value.version, control.signal, userId);
        value.confirmed = true; await verify(control.signal); if (current()) finish(value, record);
      } else {
        const result = value.kind === "save" ? await api.saveProfile(childId, value.data!, value.version, value.reason, control.signal, userId)
          : await api.deleteProfile(childId, value.version, control.signal, userId);
        value.confirmed = true; await verify(control.signal); if (current()) finish(value, undefined, result);
      }
    } catch (error) {
      if (!current() || control.signal.aborted || accessError(error)) return;
      if (value.confirmed || error instanceof CareApiError && (error.confirmed || error.status === 0 || error.status >= 500
        || error.status === 409 && error.onlineCode !== "version_conflict")) {
        value.confirmed ||= error instanceof CareApiError && error.confirmed;
        unknown(value, value.confirmed ? "Server 已確認原操作；請重新讀取結果，不能重送。" : "未能確認原操作結果；保留原內容，請先查核原操作。");
      } else {
        api.resetOnline?.();
        attempt.current = null; setPending(false);
        if (error instanceof CareApiError && error.status === 409 && error.onlineCode === "version_conflict") {
          if (value.domain === "care") {
            const latest = value.recordId ? await latestCare(value.recordId) : null;
            if (current()) setCare(previous => ({ ...previous, operation: { state: "conflict", message: "記錄版本已改變，原操作未保存；請比較最新基準。", reference: null, latest: latest ? careRecordView(latest, userId) : null } }));
          } else {
            try {
              const latest = await read([...profileKey, "current"], control, signal => api.getProfile(childId, signal));
              if (current()) setProfile(previous => ({ ...previous, current: profileRevisionView(latest, userId), latest: profileRevisionView(latest, userId),
                operation: { state: "conflict", message: "檔案版本已改變，原操作未保存；請比較最新基準。", reference: null } }));
            } catch (readError) { if (current() && !accessError(readError, true)) setProfile(previous => ({ ...previous, latest: null, needsRefresh: true,
              operation: { state: "conflict", message: "版本已改變；未能讀取最新基準，請重新讀取檔案。", reference: null } })); }
          }
        } else if (value.domain === "care") setCare(previous => ({ ...previous, operation: { ...previous.operation, state: "failed", message: "Server 未接納這次操作；請核對原內容及目前版本。", retryAvailable: false } }));
        else setProfile(previous => ({ ...previous, operation: { state: "failed", message: "Server 未接納這次操作；請核對原內容及目前版本。", reference: null } }));
      }
    } finally {
      writing.current = false; released(control);
      if (current() && !attempt.current) { refreshDeferred.current = false; setProfile(previous => ({ ...previous, reading: false })); void reloadRef.current.loadCare(); void reloadRef.current.loadProfile(); }
    }
  }
  async function checkOriginal(domain: "care" | "profile") {
    const value = attempt.current;
    if (!value || value.domain !== domain || !current() || !envRef.current.online || writing.current) return;
    const control = controller(); writing.current = true;
    try {
      await verify(control.signal);
      if (!value.confirmed) {
        const receipt = await api.reconcilePending?.(control.signal, userId); await verify(control.signal);
        if (!current()) return;
        if (!receipt || receipt.state === "unconfirmed") {
          value.retry = true; unknown(value, "尚無已確認收據；這不表示操作未發生。可保持原內容重試同一操作。"); return;
        }
        value.confirmed = true; value.receipt = receipt;
      }
      writing.current = false;
      const loaded = value.domain === "care" ? await loadCare(undefined, undefined, 0, true) : await loadProfile(true);
      if (!current()) return;
      if (loaded) finish(value);
      else unknown(value, "原操作已確認，但目前資料尚未讀回；請重讀結果，不能重送。");
    } catch (error) { if (current() && !accessError(error)) unknown(value, value.confirmed ? "原操作已確認，結果仍未讀回；不能重送。" : "仍未能查明原操作，請保留原內容後再查核。"); }
    finally {
      writing.current = false; released(control);
      if (current() && !attempt.current && refreshDeferred.current) {
        refreshDeferred.current = false; void reloadRef.current.loadCare(); void reloadRef.current.loadProfile();
      }
    }
  }

  async function careHistory(more: boolean) {
    const detail = careRef.current.detail;
    if (!detail || !current() || !envRef.current.online || detail.historyLoading || more && !detail.hasMoreHistory) return;
    const id = detail.record.id, before = more ? careHistoryCursor.current : detail.record.current.version;
    const generation = ++historyGeneration.current, control = controller();
    setCare(previous => ({ ...previous, detail: previous.detail ? { ...previous.detail, historyOpen: true, historyLoading: true } : null }));
    try {
      const page = await read([...careKey, "history", id, before], control, signal => api.history(childId, id, before, signal));
      if (!current() || generation !== historyGeneration.current || careRef.current.detail?.record.id !== id) return;
      careHistoryCursor.current = page.nextBeforeVersion;
      setCare(previous => ({ ...previous, detail: previous.detail ? { ...previous.detail, historyLoading: false,
        history: [...(more ? previous.detail.history : []), ...page.revisions.map(revision => careRevisionView(revision, userId))], hasMoreHistory: page.nextBeforeVersion !== null } : null }));
    } catch (error) {
      if (current() && generation === historyGeneration.current && !accessError(error)) setCare(previous => ({ ...previous,
        detail: previous.detail ? { ...previous.detail, historyLoading: false } : null, list: { ...previous.list, message: "未能讀取所選記錄的歷史，可能已更改或刪除。" } }));
    } finally { released(control); }
  }
  async function profileHistory(more: boolean) {
    if (!current() || !envRef.current.online || profileRef.current.reading || !profileRef.current.current || more && !profileRef.current.hasMoreHistory) return;
    const before = more ? profileHistoryCursor.current : profileRef.current.current.version;
    const generation = ++profileGeneration.current, control = controller();
    setProfile(previous => ({ ...previous, reading: true, historyOpen: true }));
    try {
      const page = await read([...profileKey, "history", before], control, signal => api.profileHistory(childId, before, signal));
      if (!current() || generation !== profileGeneration.current) return;
      profileHistoryCursor.current = page.nextBeforeVersion;
      setProfile(previous => ({ ...previous, reading: false, history: [...(more ? previous.history : []), ...page.revisions.map(value => profileRevisionView(value, userId))], hasMoreHistory: page.nextBeforeVersion !== null }));
    } catch (error) { if (current() && generation === profileGeneration.current && !accessError(error, true)) setProfile(previous => ({ ...previous, reading: false, notice: "未能讀取檔案歷史，請稍後重試。" })); }
    finally { released(control); }
  }

  const careActions: CareRecordsActions = {
    search(query, kind) { if (query.length <= 200 && !attempt.current && !careRef.current.draft && !careRef.current.deletion) void loadCare(query, kind); },
    loadMore() { if (nextCursor.current && !attempt.current) { const index = pageIndex.current + 1; pageCursors.current[index] = nextCursor.current; void loadCare(undefined, undefined, index); } },
    previousPage() { if (pageIndex.current > 0 && !attempt.current) void loadCare(undefined, undefined, pageIndex.current - 1); },
    openRecord(id) {
      if (!current() || attempt.current || careRef.current.draft || careRef.current.deletion) return;
      const record = rawRecord(id), generation = ++openGeneration.current; historyGeneration.current++;
      if (!record) {
        if (!envRef.current.online) { setCare(previous => ({ ...previous, list: { ...previous.list, message: "所指定記錄未載入；連線恢復後才可核對。" } })); return; }
        setCare(previous => ({ ...previous, detail: null, operation: { ...careOperation(), message: "正在核對所指定記錄的目前版本。" } }));
        void latestCare(id).then(latest => {
          if (!current() || generation !== openGeneration.current || attempt.current || careRef.current.draft || careRef.current.deletion) return;
          setCare(previous => ({ ...previous, detail: latest ? { record: careRecordView(latest, userId), historyOpen: false, history: [], historyLoading: false, hasMoreHistory: false } : null,
            operation: latest ? careOperation() : { ...careOperation(), message: "所指定記錄目前不可讀或未能核對；沒有顯示舊記錄或其他孩子資料。" } }));
        });
        return;
      }
      setCare(previous => ({ ...previous, detail: { record: careRecordView(record, userId), historyOpen: false, history: [], historyLoading: false, hasMoreHistory: false }, operation: careOperation() }));
    },
    closePanel() { if (attempt.current) return; draftBasis.current = null; historyGeneration.current++; openGeneration.current++; setCare(previous => ({ ...previous, detail: null, draft: null, deletion: null, operation: careOperation() })); },
    startCreate(kind = "note") { if (!canWrite()) return; draftBasis.current = null; setCare(previous => ({ ...previous, detail: null, deletion: null,
      draft: { key: crypto.randomUUID(), mode: "create", basis: null, initialValues: { ...emptyCareForm(), kind }, reviewedValues: null }, operation: careOperation() })); },
    startCorrection(id) {
      const record = rawRecord(id); if (!canWrite() || !record) return; draftBasis.current = record;
      const basis = careRecordView(record, userId); setCare(previous => ({ ...previous, deletion: null,
        draft: { key: crypto.randomUUID(), mode: "revise", basis, initialValues: { ...basis.current.values, reason: "" }, reviewedValues: null }, operation: careOperation() }));
    },
    startDeletion(id) { const record = rawRecord(id); if (canWrite() && record) setCare(previous => ({ ...previous, draft: null, deletion: { basis: careRecordView(record, userId), scopeConfirmed: false },
      operation: { ...careOperation(), kind: "delete", state: "needs_confirmation", message: "請再次核對永久刪除的記錄、版本及全部歷史。" } })); },
    confirmDeletionScope(checked) { if (!attempt.current) setCare(previous => ({ ...previous, deletion: previous.deletion ? { ...previous.deletion, scopeConfirmed: checked } : null })); },
    submitDeletion() { const deletion = careRef.current.deletion; if (canWrite() && deletion?.scopeConfirmed && careRef.current.operation.state === "needs_confirmation") void submit({ domain: "care", kind: "delete", recordId: deletion.basis.id,
      version: deletion.basis.current.version, values: null, reason: "", confirmed: false, retry: false, receipt: null }); },
    showHistory() { void careHistory(false); }, loadOlderHistory() { void careHistory(true); },
    reviewDraft(values) {
      const draft = careRef.current.draft; if (!draft || !current() || attempt.current || !editable || !careFormSchema(draft.mode).safeParse(values).success) return;
      setCare(previous => ({ ...previous, draft: previous.draft ? { ...previous.draft, reviewedValues: { ...values } } : null,
        operation: { ...careOperation(), state: "needs_confirmation", message: "請核對原值、來源及家庭共享範圍。" } }));
    },
    editDraft() { if (!attempt.current) setCare(previous => ({ ...previous, draft: previous.draft ? { ...previous.draft, reviewedValues: null } : null, operation: careOperation() })); },
    submitReviewed() { const draft = careRef.current.draft; if (!canWrite() || !draft?.reviewedValues || careRef.current.operation.state !== "needs_confirmation") return;
      void submit({ domain: "care", kind: draft.mode, recordId: draft.basis?.id ?? null, version: draft.basis?.current.version ?? 0,
        values: careValuesFromForm(draft.reviewedValues, draftBasis.current), reason: draft.reviewedValues.reason, confirmed: false, retry: false, receipt: null }); },
    checkOriginalOperation() { void checkOriginal("care"); },
    retryOriginalOperation() { const value = attempt.current; if (value?.domain === "care") void submit(value, true); },
    useLatestVersion() { const latest = careRef.current.operation.latest; if (!latest || !canWrite()) return; draftBasis.current = rawRecord(latest.id);
      setCare(previous => ({ ...previous, draft: previous.draft ? { ...previous.draft, basis: latest, reviewedValues: null } : null,
        deletion: previous.deletion ? { basis: latest, scopeConfirmed: false } : null,
        operation: previous.deletion ? { ...careOperation(), kind: "delete", state: "needs_confirmation", message: "刪除基準已更新，請重新確認範圍。" } : careOperation() })); },
  };
  const profileActions: ProfileActions = {
    reviewDraft(values) { if (!canWrite() || profileRef.current.reading || profileRef.current.needsRefresh || !profileFormSchema.safeParse(values).success) return;
      setProfileDirty(true); setProfile(previous => ({ ...previous, reviewedValues: { ...values }, intent: "save", operation: { state: "needs_confirmation", message: "請核對原值及家庭共享範圍。", reference: null } })); },
    editDraft() { if (attempt.current) return; setProfileDirty(true); setProfile(previous => ({ ...previous, reviewedValues: null, intent: null, operation: profileOperation() })); },
    cancelReview() { if (!attempt.current) setProfile(previous => ({ ...previous, reviewedValues: null, intent: null, operation: profileOperation() })); },
    submitReviewed() { const value = profileRef.current; if (!canWrite() || value.reading || value.needsRefresh || value.operation.state !== "needs_confirmation" || !value.intent || value.intent === "save" && !value.reviewedValues) return;
      void submit({ domain: "profile", kind: value.intent, version: value.basis?.version ?? 0,
        data: value.reviewedValues ? profileDataFromForm(value.reviewedValues) : null, reason: value.reviewedValues?.reason ?? "", confirmed: false, retry: false, receipt: null }); },
    reviewDeletion() { if (!canWrite() || !profileRef.current.current?.data || profileRef.current.needsRefresh) return;
      setProfileDirty(true); setProfile(previous => ({ ...previous, basis: previous.current, reviewedValues: null, intent: "delete",
        operation: { state: "needs_confirmation", message: "再次確認永久刪除檔案及全部歷史。", reference: null } })); },
    useLatestVersion() { if (!canWrite() || !profileRef.current.latest) return; setProfile(previous => ({ ...previous, basis: previous.latest, latest: null, needsRefresh: false,
      reviewedValues: null, intent: null, operation: profileOperation() })); },
    showHistory() { void profileHistory(false); }, loadOlderHistory() { void profileHistory(true); }, refresh() { void loadProfile(); },
  };
  const careModel: CareRecordsViewModel = { ...care, online: env.online, access: editable ? "editable" : "read_only",
    child: { ...care.child, name: env.childName }, checkLabel: attempt.current?.confirmed ? "重新讀取目前資料" : "查核原操作",
    review: { state: care.list.state === "loading" || care.list.state === "loading_more" ? "loading" : care.list.state === "error" ? "error" : "ready",
      scopeKey: env.scopeKey, label: "已保存照護記錄", hasMore: care.list.hasMore, capabilities: { create: false, update: false, skip: false, confirmImportant: false },
      notice: "待確認的健康事實及待辦提案在下方 Agent 待確認事項中處理。", items: care.list.records.flatMap(record => { const raw = rawRecord(record.id); return raw ? [savedRecordReview(raw, userId)] : []; }) } };
  const profileModel = { ...profile, online: env.online, child: { id: childId, name: env.childName }, access: editable ? "editable" as const : "read_only" as const,
    reading: profile.reading || pending && attempt.current?.domain === "care" };
  useLayoutEffect(() => { publish({ scopeKey: env.scopeKey,
    recovery: { pending, profileRetryAvailable: attempt.current?.domain === "profile" && attempt.current.retry && !attempt.current.confirmed,
      checkProfile: () => { void checkOriginal("profile"); }, retryProfile: () => { const value = attempt.current; if (value?.domain === "profile") void submit(value, true); } },
    care: { scopeKey: env.scopeKey, model: careModel, actions: careActions },
    profile: { scopeKey: env.scopeKey, model: profileModel, actions: profileActions, dataLabel: "Server 已確認孩子檔案",
      measurements: { scopeKey: env.scopeKey, childId, state: "unavailable", height: null, weight: null },
      profileSource: { scopeKey: env.scopeKey, childId, state: profile.current && !profile.needsRefresh ? "available" : "unavailable" } },
  }); });
  return null;
});

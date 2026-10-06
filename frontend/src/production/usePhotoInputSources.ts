import { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { createSharedInputApi, SharedInputApiError, type SharedInputWriteResult } from "../../../src/client/shared-input-api";
import { ONLINE_REFRESH_EVENT } from "../../../src/client/use-online-updates";
import type { SharedInput, SharedInputConfirmation, SharedInputCreate, PublicInputSource } from "../../../src/shared/shared-inputs";
import { sharedInputCreateSchema } from "../../../src/shared/shared-inputs";
import { sourceConfirmationProjection, sourceRecordSchema, validSourceExcerpt } from "../components/shared-inputs/source-form";
import { emptyPhotoDraft, type PhotoDraftFields } from "../photo-view-model";
import type { SourceInput, SourceOperation, SourcesActions, SourcesViewModel } from "../shared-input-view-model";
import { useDomainEnvironment, useDomainWriteGuard } from "./useDomainEnvironment";

type PendingSource = ({ kind: "create"; input: SharedInputCreate } | { kind: "confirm"; basis: SharedInput; input: SharedInputConfirmation } | { kind: "delete"; basis: SharedInput })
  & { checked: boolean; confirmed: boolean };
type DirectSource = { kind: "fetch" | "extract"; basis: SharedInput; excerpt: string; checked: boolean };
const noOperation = (): SourceOperation => ({ state: "none", phase: null, reference: null, message: "", checked: false });
const projectSource = (input: SharedInput): SourceInput => ({ ...input, extraction: { ...input.extraction, draft: input.extraction.draft ? {
  ...input.extraction.draft, rawValue: input.extraction.draft.rawValue ?? "", unit: input.extraction.draft.unit ?? "",
} : null } });
const initialExcerpt = (input: SharedInput) => input.text.length <= 10000 ? input.text : "";

/** Existing shared-input HTTP actions, projected into the approved manual source UI. */
export function usePhotoInputSources() {
  const env = useDomainEnvironment(), envRef = useRef(env); envRef.current = env;
  const api = useMemo(() => createSharedInputApi(env.apiBaseUrl), [env.apiBaseUrl]);
  const [state, setState] = useState(() => ({
    inputs: [] as SharedInput[], sources: [] as PublicInputSource[], canCreate: false, load: "loading" as SourcesViewModel["load"], lost: false,
    selected: null as SharedInput | null, latest: null as SharedInput | null, busy: false, operation: noOperation(), notice: "",
    pending: null as PendingSource | null, direct: null as DirectSource | null,
    draft: emptyPhotoDraft(), reviewed: null as PhotoDraftFields | null, uncertainties: [] as readonly string[], formKey: 0,
    confirmationKind: "reference" as SourcesViewModel["confirmationKind"], composerSeed: null as SharedInput | null, excerpt: "",
    fetchConsent: false, modelConsent: false, sharedConsent: false, childFactConsent: false, deleteOpen: false, deleteScope: false, deleteFinal: false,
  }));
  const ref = useRef(state), live = useRef(false), request = useRef<AbortController | null>(null);
  const refreshRequested = useRef(false);
  const update = (patch: Partial<typeof state>) => { ref.current = { ...ref.current, ...patch }; setState(ref.current); };
  const current = () => live.current && envRef.current.current();
  const available = () => current() && envRef.current.online && !!envRef.current.userId && !!envRef.current.childId && !ref.current.lost && Platform.OS === "web";
  const editable = () => envRef.current.role !== "viewer" && envRef.current.role !== null;
  const fresh = () => available() && ref.current.load === "ready" && !ref.current.busy && !ref.current.pending && !ref.current.latest && ref.current.operation.state !== "conflict";
  const consentReset = { fetchConsent: false, modelConsent: false, sharedConsent: false, childFactConsent: false, reviewed: null, deleteScope: false, deleteFinal: false };
  const clearEditor = () => update({ selected: null, latest: null, direct: null, composerSeed: null, draft: emptyPhotoDraft(), uncertainties: [], excerpt: "",
    confirmationKind: "reference", formKey: ref.current.formKey + 1, deleteOpen: false, ...consentReset });
  const put = (input: SharedInput) => update({ inputs: [input, ...ref.current.inputs.filter(item => item.id !== input.id)], selected: input });
  const op = (phase: SourceOperation["phase"], value: SourceOperation["state"], message: string, checked = false) => update({ notice: "", operation: { phase, state: value, message, reference: null, checked } });
  const manageable = () => !!ref.current.selected?.canManage && ref.current.selected.ownerUserId === envRef.current.userId && editable();
  const manualAllowed = () => !ref.current.direct || ref.current.direct.kind === "extract" && ref.current.direct.checked && ref.current.selected?.extraction.state !== "running";
  function deny(error: SharedInputApiError) {
    api.resetOnline(); clearEditor(); update({ inputs: [], sources: [], pending: null, canCreate: false, lost: true, load: "error", operation: noOperation(), notice: "登入或孩子權限已改變，私人原文、候選及草稿已清除。" });
    envRef.current.accessError({ status: error.status, code: error.onlineCode });
  }
  async function run(action: (signal: AbortSignal) => Promise<void>, phase: SourceOperation["phase"] = null) {
    if (!available() || ref.current.busy) return;
    const controller = new AbortController(); request.current = controller; update({ busy: true });
    if (phase) op(phase, "saving", "正在處理，尚未確認結果。");
    try { await action(controller.signal); }
    catch (error) {
      if (!current()) return;
      const failure = error instanceof SharedInputApiError ? error : new SharedInputApiError();
      if ([401, 403, 404].includes(failure.status) || failure.onlineCode === "session_changed") { deny(failure); return; }
      update(consentReset);
      const entry = ref.current.pending; if (entry && failure.confirmed) entry.confirmed = true;
      if (entry && (entry.confirmed || api.hasPendingOnline())) {
        update({ pending: { ...entry, checked: false } });
        op(entry.kind, entry.confirmed ? "confirmed_unavailable" : "unknown", entry.confirmed ? "原收據已確認，結果尚未能讀取；不會再次提交。請重新查核。" : "提交結果未知，原內容及操作識別已保留。請先查核原收據。");
      } else if (failure.onlineCode === "version_conflict") {
        update({ pending: null, direct: null, latest: null }); op(phase ?? ref.current.operation.phase, "conflict", "版本已改變。原文及人工草稿保留，重新讀取後明確使用目前版本。");
      } else if (ref.current.direct && failure.status !== 400 && failure.status !== 413 && failure.onlineCode !== "inputs_capacity") {
        update({ direct: { ...ref.current.direct, checked: false } }); op(ref.current.direct!.kind, "unknown", "原次取得／提取結果未查明。原版本與片段保留，先查核同一輸入。");
      } else {
        update({ pending: null, direct: null, ...(phase ? {} : { load: "error" as const }), ...(failure.onlineCode === "inputs_capacity" ? { canCreate: false } : {}) });
        if (phase) op(phase, "failed", failure.onlineCode === "inputs_capacity" || failure.status === 413 ? "輸入或儲存容量不足，原文及草稿保留。" : "操作未被確認，原文及草稿保留。先重新讀取並核對。");
        else update({ notice: "讀取未能確認，私人原文及草稿保留。請手動重新讀取。" });
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (current()) {
        update({ busy: false });
        if (refreshRequested.current && available()) refreshRef.current();
      }
    }
  }
  function finishWrite(entry: PendingSource, result: SharedInputWriteResult) {
    update({ pending: null, ...consentReset });
    if (result === null || "deleted" in result) {
      if (entry.kind !== "create") update({ inputs: ref.current.inputs.filter(item => item.id !== entry.basis.id) });
      clearEditor(); op(entry.kind, "saved", result === null ? "原收據已確認，結果已刪除或不可披露；不會重送。請重新讀取清單。" : "本人私人輸入及其連結家庭記錄已刪除。");
    } else {
      put(result.input); update({ latest: null, direct: null, load: "ready" });
      if (entry.kind === "create") update({ composerSeed: null, draft: emptyPhotoDraft(), uncertainties: [], excerpt: initialExcerpt(result.input), confirmationKind: "reference", formKey: ref.current.formKey + 1 });
      op(entry.kind, "saved", entry.kind === "create" ? result.input.text.trim() ? "原文及來源已私人保存。可直接人工核對，或另行同意提取。" : "來源連結已私人保存，尚未取得正文。只有明確同意才會取得公開網頁。" : "家庭確認記錄已建立；完整原文、網址、日期及備註仍只有本人可讀取。");
    }
    envRef.current.invalidate();
  }
  async function sendWrite(entry: PendingSource, signal: AbortSignal) {
    update({ pending: entry }); const e = envRef.current;
    const result = entry.kind === "create" ? await api.create(e.childId!, entry.input, signal, e.userId!)
      : entry.kind === "confirm" ? await api.confirm(entry.basis, entry.input, signal, e.userId!) : await api.delete(entry.basis, signal, e.userId!);
    if (current()) finishWrite(entry, result);
  }
  function finishDirect(attempt: DirectSource, next: SharedInput) {
    put(next); update({ latest: null, load: "ready", ...consentReset });
    if (attempt.kind === "fetch" && next.text && !attempt.basis.text) update({ excerpt: initialExcerpt(next) });
    const value = attempt.kind === "fetch" ? next.fetchState : next.extraction.state;
    if (!next.canManage || next.recordId || ["ready", "available", "failed"].includes(value)) {
      update({ direct: null }); op(attempt.kind, value === "failed" ? "failed" : "saved", value === "failed" ? "原次處理已失敗，原文及手動草稿保留；沒有自動重試。" : "原次狀態已查回；請核對保存原文或候選。");
    } else {
      update({ direct: { ...attempt, checked: true } }); op(attempt.kind, "unconfirmed", "原次結果仍未確認。可查核同一輸入；重新同意只查回原版本及原片段。", true);
    }
  }
  async function refreshInner(signal: AbortSignal) {
    const e = envRef.current, entry = ref.current.pending;
    if (entry && !entry.confirmed) {
      const receipt = await api.reconcilePending(signal, e.userId!); if (!current()) return;
      if (receipt?.state === "confirmed") finishWrite(entry, receipt.result);
      else if (receipt?.state === "unconfirmed") { update({ pending: { ...entry, checked: true } }); op(entry.kind, "unconfirmed", "原收據尚無確認結果，只可明確重試同一內容及原操作。", true); }
    }
    const attempt = ref.current.direct;
    if (attempt) {
      const next = await api.input(e.childId!, attempt.basis.id, signal, e.userId!); if (!current()) return;
      if (attempt.kind === "extract" && attempt.basis.extraction.runId && next.extraction.runId !== attempt.basis.extraction.runId && !next.recordId) throw new SharedInputApiError(409, "version_conflict");
      finishDirect(attempt, next);
    }
    const page = await e.queryClient.fetchQuery({ queryKey: ["production", e.scopeKey, "shared-inputs"], queryFn: () => api.inputs(e.childId!, signal, e.userId!), staleTime: 0, retry: false });
    if (!current()) return;
    update({ inputs: page.inputs, sources: page.sources, canCreate: page.canCreate, load: "ready" });
    const basis = ref.current.selected, unresolved = ref.current.pending;
    if (basis && !ref.current.direct && !(unresolved?.confirmed && unresolved.kind === "delete")) {
      const next = await api.input(e.childId!, basis.id, signal, e.userId!); if (!current()) return;
      if (unresolved?.confirmed && unresolved.kind === "confirm" && next.recordId && next.confirmationKind === unresolved.input.kind) finishWrite(unresolved, { input: next, recordId: next.recordId });
      else if (basis.version !== next.version || ref.current.operation.state === "conflict") {
        update({ selected: { ...basis, canManage: next.canManage }, latest: next, ...consentReset });
        if (!ref.current.pending) op(ref.current.operation.phase, "conflict", "目前版本已改變，手動草稿保留，請明確使用目前版本。");
      } else update({ selected: next });
    }
    if (ref.current.pending?.confirmed) {
      update({ pending: { ...ref.current.pending, checked: true } }); op(ref.current.pending!.kind, "confirmed_unavailable", "原收據已確認，但結果無法識別。清單已重讀；不能按原文或 hash 猜測，也不會再次建立。", true);
    }
  }
  const refresh = () => {
    if (ref.current.busy) { refreshRequested.current = true; return; }
    if (!available()) return;
    refreshRequested.current = false;
    void run(refreshInner);
  }, refreshRef = useRef(refresh); refreshRef.current = refresh;
  useEffect(() => { live.current = true; return () => { live.current = false; refreshRequested.current = false; request.current?.abort(); api.resetOnline(); }; }, [api]);
  useEffect(() => { if (!env.online) { request.current?.abort(); update(consentReset); return; } refreshRef.current(); }, [env.online]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const listener = () => refreshRef.current(); window.addEventListener(ONLINE_REFRESH_EVENT, listener);
    return () => window.removeEventListener(ONLINE_REFRESH_EVENT, listener);
  }, []);
  const pending = state.busy || !!state.pending || !!state.direct;
  useDomainWriteGuard(!!state.draft.text && !state.selected?.recordId, pending);
  const isFresh = fresh(), managed = manageable(), directManual = manualAllowed(), selected = state.selected;
  const unknownState = !!selected && (selected.fetchState === "unknown" || selected.extraction.state === "unknown" || selected.fetchState === "running" || selected.extraction.state === "running");
  const formLocked = state.busy || !!state.pending || !!state.latest || state.operation.state === "conflict" || !editable() || !!selected && !managed || !!state.direct && !directManual;
  const canConfirm = isFresh && managed && !selected?.recordId && !!selected?.text.trim() && directManual;
  const model: SourcesViewModel = {
    scopeKey: env.scopeKey, childName: env.childName, accountName: "你", online: env.online, access: state.lost ? "lost" : editable() ? "editable" : "read_only",
    load: state.load, canCreate: state.canCreate, items: state.inputs.map(projectSource), sources: state.sources,
    selected: selected ? projectSource(selected) : null, latest: state.latest ? projectSource(state.latest) : null,
    operation: state.operation, direct: state.direct ? { kind: state.direct.kind, basisVersion: state.direct.basis.version, excerpt: state.direct.excerpt, checked: state.direct.checked } : null,
    notice: state.notice, draft: state.draft, draftUncertainties: state.uncertainties, formKey: state.formKey, reviewed: state.reviewed, confirmationKind: state.confirmationKind,
    composerSeed: state.composerSeed ? projectSource(state.composerSeed) : null, excerpt: state.excerpt, fetchConsent: state.fetchConsent, modelConsent: state.modelConsent,
    sharedConsent: state.sharedConsent, childFactConsent: state.childFactConsent, deleteOpen: state.deleteOpen, deleteScope: state.deleteScope, deleteFinal: state.deleteFinal,
    busy: state.busy, fresh: isFresh, formLocked, canChoose: isFresh && !state.direct && editable(),
    canFetch: isFresh && managed && !selected?.recordId && !!selected?.sourceUrl && selected.kind !== "paste" && !state.direct && !unknownState && ["not_requested", "failed"].includes(selected.fetchState),
    canExtract: isFresh && managed && !selected?.recordId && !!selected?.text.trim() && !state.direct && !unknownState && ["not_requested", "failed"].includes(selected.extraction.state),
    canConfirm, canDelete: isFresh && managed && directManual,
  };
  function startDirect(kind: DirectSource["kind"]) {
    const s = ref.current, basis = s.selected;
    if (!basis || !(kind === "fetch" ? model.canFetch && s.fetchConsent : model.canExtract && s.modelConsent && validSourceExcerpt(basis.text, s.excerpt))) return;
    if (!envRef.current.canStartWrite()) return;
    const attempt: DirectSource = { kind, basis, excerpt: kind === "extract" ? s.excerpt : "", checked: false }; update({ direct: attempt });
    void run(async signal => {
      const next = kind === "fetch" ? await api.fetch(basis, signal, envRef.current.userId!) : await api.extract(basis, attempt.excerpt, signal, envRef.current.userId!);
      if (current()) { finishDirect(attempt, next); envRef.current.invalidate(); }
    }, kind);
  }
  const actions: SourcesActions = {
    refresh,
    create: input => { if (!model.fresh || !model.canChoose || !model.canCreate || state.selected || !sharedInputCreateSchema.safeParse(input).success || input.kind === "public_source" && !state.sources.some(source => source.id === input.sourceId) || !envRef.current.canStartWrite()) return;
      const entry: PendingSource = { kind: "create", input: { ...input }, checked: false, confirmed: false };
      void run(signal => sendWrite(entry, signal), "create"); },
    openInput: item => { if (pending) return; void run(async signal => {
      const next = await api.input(envRef.current.childId!, item.id, signal, envRef.current.userId!); if (!current()) return;
      clearEditor(); put(next); update({ excerpt: initialExcerpt(next), operation: noOperation(), load: "ready" });
      if (!next.recordId && (next.fetchState === "unknown" || next.fetchState === "running" || next.extraction.state === "unknown" || next.extraction.state === "running")) {
        const kind = next.fetchState === "unknown" || next.fetchState === "running" ? "fetch" : "extract";
        update({ direct: { kind, basis: next, excerpt: next.extraction.excerpt ?? "", checked: false } }); op(kind, "unknown", "這項輸入有未查明處理。先查核同一輸入，不會開始新的取得或提取。");
      }
    }); },
    newInput: () => { if (model.canChoose) { clearEditor(); update({ operation: noOperation(), notice: "" }); } },
    recreateWithText: () => { if (!model.canChoose || !state.canCreate || selected?.kind !== "personal_source") return; const seed = selected;
      clearEditor(); update({ composerSeed: seed, operation: noOperation(), notice: "原來源仍保留。請自行貼上正文，保存後會建立另一項私人來源。" }); },
    setFetchConsent: fetchConsent => { if (isFresh && managed && (!state.direct || state.direct.checked && state.direct.kind === "fetch")) update({ fetchConsent }); },
    fetchContent: () => startDirect("fetch"),
    setExcerpt: excerpt => { if (!formLocked && !state.direct) update({ excerpt, ...consentReset }); },
    setModelConsent: modelConsent => { if (isFresh && managed && (!state.direct || state.direct.checked && state.direct.kind === "extract")) update({ modelConsent }); },
    extract: () => startDirect("extract"),
    adoptCandidate: () => { const candidate = selected?.extraction.draft; if (!formLocked && candidate) update({ draft: { ...candidate, rawValue: candidate.rawValue ?? "", unit: candidate.unit ?? "" }, uncertainties: candidate.uncertainties, formKey: state.formKey + 1, ...consentReset }); },
    editDraft: draft => { if (!formLocked) update({ draft: { ...draft }, reviewed: null, sharedConsent: false, childFactConsent: false }); },
    reviewDraft: draft => { if (canConfirm && sourceRecordSchema(state.confirmationKind).safeParse(draft).success) update({ draft: { ...draft }, reviewed: { ...draft }, sharedConsent: false, childFactConsent: false }); },
    setConfirmationKind: confirmationKind => { if (!formLocked) update({ confirmationKind, formKey: state.formKey + 1, ...consentReset }); },
    setSharedConsent: sharedConsent => { if (canConfirm && state.reviewed && (state.confirmationKind === "reference" || state.childFactConsent)) update({ sharedConsent }); },
    setChildFactConsent: childFactConsent => { if (canConfirm && state.reviewed) update({ childFactConsent, sharedConsent: false }); },
    confirm: () => { const s = ref.current; if (!canConfirm || !s.selected || !s.reviewed || !s.sharedConsent || !sourceRecordSchema(s.confirmationKind).safeParse(s.reviewed).success || s.confirmationKind === "family_record" && !s.childFactConsent || !envRef.current.canStartWrite()) return;
      const input = sourceConfirmationProjection(s.reviewed, s.selected, s.confirmationKind, s.childFactConsent);
      void run(signal => sendWrite({ kind: "confirm", basis: s.selected!, input, checked: false, confirmed: false }, signal), "confirm"); },
    checkOriginal: refresh,
    retryOriginal: () => { const entry = ref.current.pending; if (entry?.checked && !entry.confirmed && api.hasPendingOnline() && available() && ref.current.load === "ready") void run(signal => sendWrite(entry, signal), entry.kind); },
    finishUnavailable: () => { const entry = ref.current.pending; if (entry?.confirmed && entry.checked && !state.busy && state.load === "ready") { update({ pending: null }); clearEditor(); op(entry.kind, "saved", "已結束已確認但不可讀的操作；不會重送。已保存清單仍保留供核對。"); } },
    retryDirect: () => { const attempt = ref.current.direct;
      if (!attempt?.checked || !isFresh || !managed || (attempt.kind === "fetch" ? !state.fetchConsent : !state.modelConsent)) return;
      update({ direct: { ...attempt, checked: false } });
      void run(async signal => {
        // The server resolves the original basis/version and excerpt; this is never a new model run.
        const next = attempt.kind === "fetch" ? await api.fetch(attempt.basis, signal, envRef.current.userId!) : await api.extract(attempt.basis, attempt.excerpt, signal, envRef.current.userId!);
        if (current()) finishDirect(attempt, next);
      }, attempt.kind);
    },
    endDirect: () => { const attempt = ref.current.direct; if (isFresh && attempt?.checked && selected && (attempt.kind === "fetch" ? selected.fetchState : selected.extraction.state) === "unknown") {
      update({ direct: null, ...consentReset }); op(attempt.kind, "none", ""); update({ notice: "已結束原次查核。未知不代表失敗；不會重發或開始新的取得／提取，保存輸入及人工草稿保留。" }); } },
    useLatest: () => { if (!state.latest || !available() || state.busy || state.pending) return; const next = state.latest;
      put(next); update({ latest: null, operation: noOperation(), excerpt: validSourceExcerpt(next.text, state.excerpt) ? state.excerpt : "", ...consentReset });
      if (!next.recordId && (next.fetchState === "unknown" || next.fetchState === "running" || next.extraction.state === "unknown" || next.extraction.state === "running")) {
        const kind = next.fetchState === "unknown" || next.fetchState === "running" ? "fetch" : "extract";
        update({ direct: { kind, basis: next, excerpt: next.extraction.excerpt ?? "", checked: false } }); op(kind, "unknown", "目前版本有未查明處理。先查核同一輸入，不開始新的取得或提取。");
      } },
    openDeletion: () => { if (model.canDelete) update({ deleteOpen: true, deleteScope: false, deleteFinal: false }); },
    closeDeletion: () => { if (!state.busy) update({ deleteOpen: false }); },
    setDeleteScope: deleteScope => update({ deleteScope, deleteFinal: false }), setDeleteFinal: deleteFinal => update({ deleteFinal }),
    remove: () => { if (model.canDelete && state.deleteScope && state.deleteFinal && selected && envRef.current.canStartWrite()) void run(signal => sendWrite({ kind: "delete", basis: selected, checked: false, confirmed: false }, signal), "delete"); },
  };
  return { model, actions, pending };
}

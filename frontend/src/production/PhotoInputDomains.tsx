import { readBlobBytes } from "../../../src/client/blob-bytes";
import { photoPreview, photoSha256 } from "../platform/photo-bytes";
import { copyPhotoOriginal } from "./photo-original";
import { createContext, memo, use, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { useGlobalSearchParams, usePathname, useRouter } from "expo-router";
import { Text } from "react-native-paper";
import { createPhotoApi, PhotoApiError, type PhotoWriteResult } from "../../../src/client/photo-api";
import { subscribeOnlineRefresh } from "../../../src/client/online-refresh-events";
import { photoMetadataSchema, type PhotoAttachment, type PhotoConfirmation, type PhotoMetadata } from "../../../src/shared/photos";
import { PhotosView } from "../components/photos/PhotosView";
import { photoConfirmationProjection, photoDraftSchema } from "../components/photos/photo-form";
import type { PhotoReaderNavigation } from "../navigation/usePhotoRouteSelection";
import type { SourceReaderNavigation } from "../navigation/useSourceRouteSelection";
import { SourcesView } from "../components/shared-inputs/SourcesView";
import { AppButton, SectionCard, SectionHeader } from "../components/ui";
import { photoTime, emptyPhotoDraft, samePhotoOriginal, type PhotoDraftFields, type PhotoItem, type PhotoOperation, type PhotoOriginal, type PhotoReplacement, type PhotoSelectionIntent, type PhotosActions, type PhotosViewModel } from "../photo-view-model";
import { useDomainEnvironment, useDomainWriteGuard } from "./useDomainEnvironment";
import { useProduction, useProductionIdentity } from "./ProductionProvider";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { usePhotoInputSources } from "./usePhotoInputSources";
import { useAttachmentReview } from "./useAttachmentReview";

type PendingPhoto = ({ kind: "reserve"; metadata: PhotoMetadata } | { kind: "confirm"; photo: PhotoAttachment; input: PhotoConfirmation } | { kind: "delete"; photo: PhotoAttachment })
  & { checked: boolean; confirmed: boolean };
type DirectPhoto = { kind: "upload" | "extract"; photo: PhotoAttachment; checked: boolean };
const noOperation = (): PhotoOperation => ({ state: "none", phase: null, reference: null, message: "", checked: false });
const readFailureNotice = "讀取未能確認，原檔及草稿保留。請手動重新讀取。";
const privatePhoto = (photo: PhotoAttachment | null, userId: string | null): photo is PhotoAttachment =>
  !!photo && photo.canManage && photo.ownerUserId === userId && photo.visibility === "private" && !photo.recordId;
const photoDraft = (photo: PhotoAttachment): PhotoDraftFields => photo.extraction.draft ? {
  ...photo.extraction.draft, rawValue: photo.extraction.draft.rawValue ?? "", unit: photo.extraction.draft.unit ?? "",
} : emptyPhotoDraft();

function useProductionPhotos() {
  const env = useDomainEnvironment();
  const envRef = useRef(env); envRef.current = env;
  const api = useMemo(() => createPhotoApi(env.apiBaseUrl, env.owner.fetcher, photoSha256), [env.apiBaseUrl, env.owner.fetcher]);
  const [state, setState] = useState(() => ({
    photos: [] as PhotoAttachment[], canCreate: false, load: "loading" as PhotosViewModel["load"], lost: false, resourceUnavailable: false,
    selected: null as PhotoAttachment | null, latest: null as PhotoAttachment | null,
    original: null as PhotoOriginal | null, preview: null as { uri: string; dispose: () => void } | null, source: "使用者上傳照片", sourceError: "",
    draft: emptyPhotoDraft(), reviewed: null as PhotoDraftFields | null, formKey: 0, modelConsent: false, sharedConsent: false,
    operation: noOperation(), pending: null as PendingPhoto | null, direct: null as DirectPhoto | null,
    replacement: null as PhotoReplacement | null, deletion: false, deleteScope: false, deleteFinal: false,
    busy: false, notice: "", reservationUnidentified: false,
  }));
  const ref = useRef(state);
  const selectionIntent = useRef<{ itemId: string; intent: PhotoSelectionIntent } | null>(null);
  const composerTransfer = useRef<{ source: PhotoOriginal; owned: PhotoOriginal } | null>(null);
  const update = (patch: Partial<typeof state>) => { ref.current = { ...ref.current, ...patch }; setState(ref.current); };
  const live = useRef(false), request = useRef<AbortController | null>(null);
  const refreshRequested = useRef(false);
  const current = () => live.current && envRef.current.current();
  const consentReset = { modelConsent: false, sharedConsent: false, reviewed: null, deleteScope: false, deleteFinal: false };
  const put = (photo: PhotoAttachment) => update({ resourceUnavailable: false, photos: [photo, ...ref.current.photos.filter(item => item.id !== photo.id)], selected: photo });
  const releaseEditor = () => {
    composerTransfer.current = null; selectionIntent.current = null;
    ref.current.original?.dispose?.(); ref.current.replacement?.kind === "original" && ref.current.replacement.original.dispose?.();
    ref.current.preview?.dispose();
    update({ resourceUnavailable: false, original: null, preview: null, selected: null, latest: null, replacement: null, source: "使用者上傳照片", sourceError: "",
      draft: emptyPhotoDraft(), formKey: ref.current.formKey + 1, ...consentReset, deletion: false, reservationUnidentified: false });
  };
  const op = (phase: PhotoOperation["phase"], value: PhotoOperation["state"], message: string, checked = false) =>
    update({ notice: "", operation: { phase, state: value, message, reference: null, checked } });
  const available = () => current() && envRef.current.online && !!envRef.current.userId && !!envRef.current.childId && !ref.current.lost;
  const editable = () => envRef.current.role !== "viewer" && envRef.current.role !== null;
  const fresh = () => available() && ref.current.load === "ready" && !ref.current.busy && !ref.current.pending && !ref.current.latest && ref.current.operation.state !== "conflict";
  const resetAccess = (error: PhotoApiError) => {
    releaseEditor(); api.resetOnline();
    update({ photos: [], canCreate: false, pending: null, direct: null, lost: true, load: "error", operation: noOperation(), notice: "登入或孩子權限已改變，照片、原檔及草稿已清除。" });
    envRef.current.accessError(error.status === 404 ? { status: 403, code: "access_denied" } : { status: error.status, code: error.onlineCode });
  };
  async function readResource<T>(id: string, signal: AbortSignal, action: () => Promise<T>): Promise<T | null> {
    try { return await action(); }
    catch (error) {
      if (!(error instanceof PhotoApiError) || error.status !== 404) throw error;
      if (!current() || signal.aborted) return null;
      const pending = ref.current.pending, direct = ref.current.direct;
      // Keep unresolved operation bytes internally, but never display an unreadable attachment.
      if (!pending && !direct) releaseEditor();
      else {
        ref.current.preview?.dispose();
        update({ selected: null, latest: null, preview: null, resourceUnavailable: true, ...consentReset });
      }
      update({ photos: [], canCreate: false, load: "error", notice: "所選照片已刪除或目前不可讀；正在重新核對孩子存取權限。" });
      const e = envRef.current;
      const page = await api.photos(e.childId!, signal, e.userId!);
      if (!current() || signal.aborted) return null;
      update({ photos: page.photos.filter(photo => photo.id !== id), canCreate: page.canCreate, load: "ready" });
      if (pending) {
        update({ pending: { ...pending, checked: pending.confirmed } });
        op(pending.kind, pending.confirmed ? "confirmed_unavailable" : "unknown", "原操作仍按同一收據查核；所選照片已刪除或目前不可讀，不會另行提交。", pending.confirmed);
      } else if (direct) {
        update({ direct: { ...direct, checked: false } });
        op(direct.kind, "unknown", "原次處理仍未查明，所選照片已刪除或目前不可讀；保留原操作，不能重送。");
      } else update({ resourceUnavailable: false, operation: noOperation(), notice: "所選照片已刪除或目前不可讀；清單已更新，可繼續查看其他照片。" });
      return null;
    }
  }
  async function run(action: (signal: AbortSignal) => Promise<void>, phase: PhotoOperation["phase"] = null) {
    if (!available() || ref.current.busy) return;
    const controller = new AbortController(); request.current = controller;
    update({ busy: true });
    if (phase) op(phase, "saving", "正在處理；尚未確認結果。");
    try { await action(controller.signal); }
    catch (error) {
      if (!current()) return;
      const failure = error instanceof PhotoApiError ? error : new PhotoApiError();
      if ([401, 403, 404].includes(failure.status) || failure.onlineCode === "session_changed") { resetAccess(failure); return; }
      update(consentReset);
      const entry = ref.current.pending;
      if (entry && failure.confirmed) entry.confirmed = true;
      if (entry && (entry.confirmed || api.hasPendingOnline())) {
        update({ pending: { ...entry, checked: false } });
        op(entry.kind, entry.confirmed ? "confirmed_unavailable" : "unknown", entry.confirmed ? "原操作已確認，結果尚未能讀取；不會重送。請重新查核。" : "結果未知，原內容及操作識別保留。請先查核原收據。");
      } else if (failure.onlineCode === "version_conflict") {
        update({ pending: null, direct: null, latest: null }); op(phase ?? ref.current.operation.phase, "conflict", "版本已改變，原檔及草稿保留。先重新讀取，再明確使用目前版本。");
      } else if (ref.current.direct && ![400, 413].includes(failure.status) && failure.onlineCode !== "photo_capacity") {
        update({ direct: { ...ref.current.direct, checked: false } });
        op(ref.current.direct!.kind, "unknown", "原次上傳／提取結果未知。請查核同一附件，不會自動重送。");
      } else {
        update({ pending: null, direct: null, ...(phase ? {} : { load: "error" as const }), ...(failure.onlineCode === "photo_capacity" ? { canCreate: false } : {}) });
        if (phase) op(phase, "failed", failure.onlineCode === "photo_capacity" || failure.status === 413 ? "容量不足或原檔超出限制；原檔及草稿保留。" : "提交未被確認，原檔及草稿保留。請重新讀取並核對。");
        else update({ notice: readFailureNotice });
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (current()) {
        update({ busy: false });
        if (refreshRequested.current && available()) refreshRef.current();
      }
    }
  }
  function finishWrite(entry: PendingPhoto, result: PhotoWriteResult) {
    if (result === null) {
      // A confirmed receipt can redact its result. Keep the local recovery gate even
      // though the transport has retired its opId; it must never be submitted again.
      if (entry.kind !== "reserve") {
        update({ photos: ref.current.photos.filter(item => item.id !== entry.photo.id) });
        releaseEditor();
      }
      update({ pending: { ...entry, confirmed: true, checked: false }, direct: null, ...consentReset });
      op(entry.kind, "confirmed_unavailable", "原收據已確認，結果已刪除或不可披露；不會重送。請先查核並重新讀取清單。");
      return;
    }
    update({ pending: null, ...consentReset });
    if ("deleted" in result) {
      if (entry.kind !== "reserve") update({ photos: ref.current.photos.filter(item => item.id !== entry.photo.id) });
      releaseEditor(); update({ direct: null });
      op(entry.kind, "saved", "照片及連結記錄已移除，原檔實體清理已排程。");
    } else {
      put(result.photo); update({ latest: null, source: result.photo.source, load: "ready" });
      if (entry.kind === "confirm") update({ direct: null });
      op(entry.kind, "saved", entry.kind === "reserve" ? "私人附件已建立，尚待原檔上傳。" : "照片及確認記錄已與家庭共享；不能再次確認。");
    }
    envRef.current.invalidate();
  }
  async function sendWrite(entry: PendingPhoto, signal: AbortSignal) {
    update({ pending: entry });
    const e = envRef.current;
    const result = entry.kind === "reserve" ? await api.reserve(e.childId!, entry.metadata, signal, e.userId!)
      : entry.kind === "confirm" ? await api.confirm(entry.photo, entry.input, signal, e.userId!) : await api.delete(entry.photo, signal, e.userId!);
    if (current()) finishWrite(entry, result);
    return result;
  }
  async function lookupDirect(signal: AbortSignal) {
    const attempt = ref.current.direct; if (!attempt) return;
    const e = envRef.current, next = await readResource(attempt.photo.id, signal, () => api.photo(e.childId!, attempt.photo.id, signal, e.userId!));
    if (!current() || !next) return false;
    if (next.mimeType !== attempt.photo.mimeType || next.bytes !== attempt.photo.bytes || next.sha256 !== attempt.photo.sha256) throw new PhotoApiError();
    if (attempt.kind === "extract" && attempt.photo.extraction.runId && next.extraction.runId !== attempt.photo.extraction.runId && next.visibility !== "shared") throw new PhotoApiError(409, "version_conflict");
    put(next); update({ latest: null, load: "ready", ...consentReset });
    if (attempt.kind === "upload" && next.state === "ready" || attempt.kind === "extract" && (next.visibility === "shared" || ["available", "failed"].includes(next.extraction.state))) {
      update({ direct: null }); op(attempt.kind, next.extraction.state === "failed" && attempt.kind === "extract" ? "failed" : "saved", attempt.kind === "upload" ? "同一原檔已保存，毋須再次上傳。" : next.extraction.state === "failed" ? "已查回原次提取失敗狀態，原檔及人工草稿保留。" : "原次提取狀態已查回，候選仍待人工核對。");
    } else {
      // Extraction reconciliation only reads this attachment; it never invokes the model again.
      update({ direct: { ...attempt, photo: next, checked: true } });
      op(attempt.kind, "unconfirmed", attempt.kind === "upload" ? "同一附件仍待上傳，可明確重試相同原檔。" : "提取仍未查明，不重送模型。查核後可手動核對記錄。", true);
    }
  }
  async function refreshInner(signal: AbortSignal) {
    const e = envRef.current, entry = ref.current.pending;
    if (entry && !entry.confirmed) {
      const receipt = await api.reconcilePending(signal, e.userId!); if (!current()) return;
      if (receipt?.state === "confirmed") finishWrite(entry, receipt.result);
      else if (receipt?.state === "unconfirmed") { update({ pending: { ...entry, checked: true } }); op(entry.kind, "unconfirmed", "原收據尚無確認結果，只可明確重試原內容及原操作。", true); }
    }
    if (ref.current.direct && await lookupDirect(signal) === false) return;
    const page = await e.queryClient.fetchQuery({ queryKey: ["production", e.scopeKey, "photos"], queryFn: () => api.photos(e.childId!, signal, e.userId!), staleTime: 0, retry: false });
    if (!current()) return;
    update({ photos: page.photos, canCreate: page.canCreate, load: "ready" });
    const unresolved = ref.current.pending, basis = ref.current.selected;
    if (unresolved?.confirmed && unresolved.kind === "reserve") {
      update({ reservationUnidentified: true, pending: { ...unresolved, checked: true } });
      op("reserve", "confirmed_unavailable", "原操作已確認，但附件結果未能識別。原檔保留，不會另建附件；可結束待查並逐項核對清單。", true);
    }
    if (basis && !ref.current.direct && !(unresolved?.confirmed && unresolved.kind === "delete")) {
      const next = await readResource(basis.id, signal, () => api.photo(e.childId!, basis.id, signal, e.userId!)); if (!current() || !next) return;
      if (unresolved?.confirmed && unresolved.kind === "confirm" && next.visibility === "shared" && next.recordId) finishWrite(unresolved, { photo: next, recordId: next.recordId });
      else if (basis.version !== next.version || ref.current.operation.state === "conflict") {
        update({ selected: { ...basis, canManage: next.canManage }, latest: next, ...consentReset });
        if (!ref.current.pending) op(ref.current.operation.phase, "conflict", "目前版本已更新；手動草稿保留，請明確使用目前版本。");
      } else update({ selected: next });
    }
    if (ref.current.pending?.confirmed && ref.current.pending.kind !== "reserve") {
      update({ pending: { ...ref.current.pending, checked: true } });
      op(ref.current.pending!.kind, "confirmed_unavailable", "原操作已確認，清單已重讀，結果仍不可讀。不會重送；可明確結束本次查核。", true);
    }
    // Only a complete refresh retires this read error, not newer draft or operation notices.
    if (ref.current.notice === readFailureNotice) update({ notice: "" });
  }
  const refresh = () => {
    if (ref.current.busy) { refreshRequested.current = true; return; }
    if (!available()) return;
    refreshRequested.current = false;
    void run(refreshInner);
  };
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  useEffect(() => {
    live.current = true;
    return () => {
      composerTransfer.current = null;
      live.current = false; refreshRequested.current = false; request.current?.abort(); api.resetOnline();
      ref.current.original?.dispose?.();
      if (ref.current.replacement?.kind === "original") ref.current.replacement.original.dispose?.();
      ref.current.preview?.dispose();
    };
  }, [api]);
  useEffect(() => {
    if (!env.online) { request.current?.abort(); update({ ...consentReset, load: ref.current.photos.length ? "ready" : "error" }); return; }
    refreshRef.current();
  }, [env.online]);
  useEffect(() => subscribeOnlineRefresh(() => refreshRef.current()), []);
  const pathname = usePathname(), { view } = useGlobalSearchParams<{ view?: string | string[] }>();
  const requestedView = typeof view === "string" ? view : undefined;
  const routeRef = useRef(pathname); routeRef.current = pathname;
  const composerOwns = (original: PhotoOriginal) => {
    const draft = envRef.current.owner.draftOwner.getSnapshot();
    return draft.scope === envRef.current.scopeKey && draft.attachments.some(item => item.photo === original);
  };
  const photoRoute = pathname === "/photos" || pathname === "/care" && requestedView === "photos";
  const routeKey = `${pathname}:${photoRoute}`, previousRoute = useRef(routeKey);
  const deferredRouteRelease = useRef<{ routeKey: string; editor: typeof state } | null>(null);
  useEffect(() => {
    const previous = previousRoute.current; previousRoute.current = routeKey;
    const s = ref.current;
    // Entering either photo route deliberately preserves a chat-to-Photos transfer.
    if (previous !== routeKey) deferredRouteRelease.current = photoRoute ? null : { routeKey, editor: s };
    const departure = deferredRouteRelease.current;
    if (!departure) return;
    const basis = departure.editor;
    // A read may finish after the approved departure. Retire only that editor,
    // never newer input, a returning photo route, or an unresolved write owner.
    if (photoRoute || departure.routeKey !== routeKey || s.pending || s.direct || s.operation.state === "saving"
      || basis.formKey !== s.formKey || basis.original !== s.original || basis.draft !== s.draft
      || basis.source !== s.source || basis.replacement !== s.replacement) {
      deferredRouteRelease.current = null; return;
    }
    if (s.busy) return;
    deferredRouteRelease.current = null;
    releaseEditor(); update({ operation: noOperation(), notice: "", resourceUnavailable: false });
  }, [routeKey, photoRoute, state.busy, state.pending, state.direct, state.operation.state, state.formKey, state.original, state.draft, state.source, state.replacement]);
  useEffect(() => {
    if (pathname !== "/chat") return;
    let active = true;
    const reconcile = () => {
      const transfer = composerTransfer.current, s = ref.current;
      if (!active || !current() || routeRef.current !== "/chat" || !transfer || composerOwns(transfer.source)
        || transfer.owned !== s.original || s.busy || s.pending || s.direct || s.selected) return;
      releaseEditor();
    };
    // Route commits clear the composer in a parent layout effect. Reconcile after
    // that commit so entry into Photos retains its independent recipient bytes.
    const unsubscribe = env.owner.draftOwner.subscribe(() => queueMicrotask(reconcile));
    reconcile();
    return () => { active = false; unsubscribe(); };
  }, [env.owner, pathname, state.busy, state.pending, state.direct, state.original, state.selected]);
  const pending = state.busy || !!state.pending || !!state.direct;
  // Keep busy guards for local resource changes; only writes block scope departure.
  const writePending = state.operation.state === "saving" || !!state.pending || !!state.direct;
  // Pending operations outlive workspace routes; ordinary drafts are released on departure.
  const leaveGuardId = useDomainWriteGuard(!!state.original && state.selected?.state !== "ready" || !!state.draft.text && !state.selected?.recordId || !!state.replacement, writePending, "child", writePending);

  async function sendContent(photo: PhotoAttachment, original: PhotoOriginal, signal: AbortSignal) {
    if (!original.readBase64 || !samePhotoOriginal(photo, original)) throw new PhotoApiError(400, "invalid_input");
    const base64 = await original.readBase64(); if (!current()) return;
    update({ direct: { kind: "upload", photo, checked: false } }); op("upload", "saving", "正在私人保存相同原檔。");
    const next = await api.upload(photo, base64, signal, envRef.current.userId!); if (!current()) return;
    put(next); update({ direct: null, load: "ready", ...consentReset });
    op("upload", "saved", "原照片已私人保存；可人工整理或另行同意提取，尚未與家庭共享。"); envRef.current.invalidate();
  }
  function upload() {
    const s = ref.current, original = s.original;
    if (!fresh() || !editable() || !original || !original.readBase64 || s.reservationUnidentified || s.direct && (s.direct.kind !== "upload" || !s.direct.checked)) return;
    const basis = s.selected;
    if (basis && (!privatePhoto(basis, envRef.current.userId) || basis.state !== "reserved" || !samePhotoOriginal(basis, original))) return;
    if (!basis && !s.canCreate) return;
    if (!s.direct && !envRef.current.canStartWrite()) return;
    const metadata = photoMetadataSchema.safeParse({ fileName: original.fileName, mimeType: original.mimeType, bytes: original.bytes, sha256: original.sha256, source: s.source });
    if (!metadata.success || !s.source.trim()) { update({ sourceError: "請核對來源及檔案資料，來源最多 200 字。" }); return; }
    void run(async signal => {
      if (basis) {
        const next = await readResource(basis.id, signal, () => api.photo(envRef.current.childId!, basis.id, signal, envRef.current.userId!)); if (!current() || !next) return;
        if (!samePhotoOriginal(next, original)) throw new PhotoApiError(400, "invalid_input");
        if (next.state === "ready") { put(next); update({ direct: null }); op("upload", "saved", "相同原檔已保存，不會再次上傳。"); return; }
        await sendContent(next, original, signal);
      } else {
        const result = await sendWrite({ kind: "reserve", metadata: { ...metadata.data }, checked: false, confirmed: false }, signal);
        if (current() && result && "photo" in result) await sendContent(result.photo, original, signal);
      }
    }, basis ? "upload" : "reserve");
  }
  function acceptOriginal(original: PhotoOriginal) {
    releaseEditor(); update({ original, operation: noOperation(), notice: "原檔只在本次記憶中，尚未上傳。" });
  }
  function chooseOriginal(original: PhotoOriginal) {
    if (!current()) { original.dispose?.(); return; }
    selectionIntent.current = null;
    if (!editable() || ref.current.busy || ref.current.pending || ref.current.direct || ref.current.reservationUnidentified) { original.dispose?.(); return; }
    const basis = ref.current.selected;
    if (basis?.state === "reserved" && samePhotoOriginal(basis, original)) {
      ref.current.original?.dispose?.(); update({ original, ...consentReset }); return;
    }
    if (basis || ref.current.original || ref.current.draft.text) update({ replacement: { kind: "original", original } });
    else acceptOriginal(original);
  }
  function openPhoto(item: PhotoItem, intent?: PhotoSelectionIntent) {
    if (!current() || intent && !intent.isCurrent()) return;
    if (intent && ref.current.selected?.id === item.id) { intent.onOpened(); return; }
    if (ref.current.busy || ref.current.pending || ref.current.direct) return;
    selectionIntent.current = intent ? { itemId: item.id, intent } : null;
    if (ref.current.original || ref.current.draft.text) { update({ replacement: { kind: "item", item } }); return; }
    void run(async signal => {
      async function readSelected<T>(read: () => Promise<T>) {
        return readResource(item.id, signal, async () => {
          try { return await read(); }
          catch (error) {
            if (intent && !intent.isCurrent() && !(error instanceof PhotoApiError && ([401, 403].includes(error.status) || error.onlineCode === "session_changed"))) return null;
            throw error;
          }
        });
      }
      const next = await readSelected(() => api.photo(envRef.current.childId!, item.id, signal, envRef.current.userId!));
      if (!current() || !next || intent && !intent.isCurrent()) return;
      // Bind the unresolved run to its own editor before a fallible content read.
      if (!next.recordId && ["running", "unknown"].includes(next.extraction.state)) {
        releaseEditor();
        update({ source: next.source, direct: { kind: "extract", photo: next, checked: false } });
      }
      const blob = next.state === "ready" ? await readSelected(() => api.content(next, signal, envRef.current.userId!)) : null;
      if (!current() || next.state === "ready" && !blob || intent && !intent.isCurrent() && !ref.current.direct) return;
      const preview = blob ? photoPreview(await readBlobBytes(blob), next.mimeType) : null;
      if (!current() || signal.aborted || intent && !intent.isCurrent() && !ref.current.direct) { preview?.dispose(); return; }
      releaseEditor(); put(next); update({ preview, source: next.source, load: "ready", operation: noOperation() });
      if (!next.recordId && ["running", "unknown"].includes(next.extraction.state)) {
        update({ direct: { kind: "extract", photo: next, checked: false } }); op("extract", "unknown", "原次提取尚未查明。先查核同一附件及原 run，不重送模型。");
      }
      intent?.onOpened();
    });
  }
  const item = (photo: PhotoAttachment): PhotoItem => ({ ...photo, isUploader: photo.ownerUserId === env.userId, ownerLabel: photo.ownerUserId === env.userId ? "本人" : "家庭成員",
    createdAtLabel: photoTime(photo.createdAt), imageSource: photo.id === state.selected?.id && state.preview?.uri ? { uri: state.preview?.uri } : null,
    extraction: { state: photo.extraction.state, candidate: photo.extraction.draft ? { ...photoDraft(photo), uncertainties: photo.extraction.draft.uncertainties } : null } });
  const isFresh = fresh(), managed = privatePhoto(state.selected, env.userId) && editable();
  const manual = !state.direct || state.direct.kind === "extract" && state.direct.checked && state.selected?.extraction.state !== "running";
  const formLocked = state.busy || !!state.pending || !!state.latest || state.operation.state === "conflict" || !editable() || !!state.direct && !manual;
  const model: PhotosViewModel = {
    childName: env.childName, online: env.online, access: state.lost ? "lost" : editable() ? "editable" : "read_only", load: state.load, canCreate: state.canCreate,
    capacityReached: state.load === "ready" && editable() && !state.canCreate, items: state.photos.map(item), selected: state.selected ? item(state.selected) : null, latest: state.latest ? item(state.latest) : null,
    original: state.resourceUnavailable ? null : state.original, source: state.resourceUnavailable ? "" : state.source, sourceError: state.resourceUnavailable ? "" : state.sourceError, draft: state.resourceUnavailable ? emptyPhotoDraft() : state.draft, formKey: state.formKey, reviewed: state.resourceUnavailable ? null : state.reviewed,
    modelConsent: state.modelConsent, sharedConsent: state.sharedConsent, operation: state.operation, notice: state.selected?.recoveryPending ? "這張照片的上載在還原時尚未結清，暫不可讀。可選回同一原圖核對原上載；不會重新建立附件。" : state.notice, reservationUnidentified: state.reservationUnidentified,
    recoveryPhotoId: state.pending && state.pending.kind !== "reserve" ? state.pending.photo.id : state.direct?.photo.id ?? null,
    replacement: state.resourceUnavailable ? null : state.replacement, deletion: state.resourceUnavailable ? false : state.deletion, deleteScope: state.deleteScope, deleteFinal: state.deleteFinal, busy: state.busy, fresh: isFresh, formLocked,
    canPick: isFresh && editable() && !state.direct && !state.reservationUnidentified && (state.canCreate || managed && state.selected?.state === "reserved"),
    canUpload: isFresh && editable() && !!state.original?.readBase64 && !state.reservationUnidentified && (!state.selected && state.canCreate || managed && state.selected?.state === "reserved" && samePhotoOriginal(state.selected, state.original!)) && (!state.direct || state.direct.kind === "upload" && state.direct.checked),
    canExtract: isFresh && managed && state.selected?.state === "ready" && !state.direct && ["not_requested", "failed"].includes(state.selected.extraction.state),
    canConfirm: isFresh && managed && state.selected?.state === "ready" && manual && !!state.reviewed && state.sharedConsent && photoDraftSchema.safeParse(state.reviewed).success,
    canDelete: isFresh && editable() && !!state.selected?.canManage && manual,
  };
  const actions: PhotosActions = {
    readThumbnail: async (photo, signal) => {
      const e = envRef.current;
      const readable = () => current() && envRef.current.scopeKey === e.scopeKey && envRef.current.userId === e.userId && !signal.aborted && available();
      if (!readable() || photo.state !== "ready" || photo.childId !== e.childId) return null;
      try {
        const next = await api.photo(e.childId!, photo.id, signal, e.userId!);
        if (!readable() || next.state !== "ready" || next.id !== photo.id || next.childId !== photo.childId || next.version !== photo.version || next.sha256 !== photo.sha256) return null;
        const blob = await api.content(next, signal, e.userId!);
        if (!readable()) return null;
        const bytes = await readBlobBytes(blob);
        if (!readable()) return null;
        const preview = photoPreview(bytes, next.mimeType);
        if (!readable()) { preview.dispose(); return null; }
        return preview;
      } catch (error) {
        if (readable() && error instanceof PhotoApiError && ([401, 403].includes(error.status) || error.onlineCode === "session_changed")) resetAccess(error);
        return null;
      }
    },
    pickOriginal: chooseOriginal, reportFileError: message => update({ notice: message }), openPhoto,
    discardRecordDraft: () => { const value = ref.current; if (current() && !value.pending && !value.direct && value.operation.state !== "saving") update({ draft: emptyPhotoDraft(), reviewed: null, sharedConsent: false, formKey: value.formKey + 1 }); },
    clearEditor: () => { if (!ref.current.busy && !ref.current.pending && !ref.current.direct) { releaseEditor(); update({ operation: noOperation() }); } },
    confirmReplacement: () => { const replacement = ref.current.replacement;
      if (!current() || !replacement || replacement !== state.replacement || ref.current.busy || ref.current.pending || ref.current.direct) return;
      const intent = replacement.kind === "item" && selectionIntent.current?.itemId === replacement.item.id ? selectionIntent.current.intent : undefined;
      if (intent && !intent.isCurrent()) { selectionIntent.current = null; update({ replacement: null }); return; }
      update({ replacement: null }); releaseEditor(); if (replacement.kind === "original") acceptOriginal(replacement.original); else if (replacement.kind === "item") openPhoto(replacement.item, intent); },
    cancelReplacement: () => { if (!current() || ref.current.replacement !== state.replacement) return;
      if (ref.current.replacement?.kind === "original") ref.current.replacement.original.dispose?.(); selectionIntent.current = null; update({ replacement: null }); },
    editSource: source => { if (!formLocked && !state.selected) update({ source, sourceError: "", ...consentReset }); }, upload, refresh,
    setModelConsent: modelConsent => { if (model.canExtract) update({ modelConsent }); },
    extract: () => { if (!model.canExtract || !ref.current.modelConsent || !ref.current.selected || !envRef.current.canStartWrite()) return;
      const photo = ref.current.selected; update({ direct: { kind: "extract", photo, checked: false } });
      void run(async signal => {
        const next = await api.extract(photo, signal, envRef.current.userId!); if (!current()) return;
        put(next); update({ direct: null, ...consentReset }); op("extract", "saved", "提取狀態已返回；候選尚未成為家庭記錄。");
        if (["running", "unknown"].includes(next.extraction.state)) { update({ direct: { kind: "extract", photo: next, checked: false } }); op("extract", "unknown", "提取結果仍未確認，先查核同一附件。模型不會重送。"); }
        envRef.current.invalidate();
      }, "extract");
    },
    adoptCandidate: () => { if (!formLocked && state.selected?.extraction.draft) update({ draft: photoDraft(state.selected), formKey: state.formKey + 1, ...consentReset }); },
    editDraft: draft => { if (!formLocked) update({ draft: { ...draft }, reviewed: null, sharedConsent: false }); },
    reviewDraft: draft => { if (!formLocked && isFresh && photoDraftSchema.safeParse(draft).success) update({ draft: { ...draft }, reviewed: { ...draft }, sharedConsent: false }); },
    setSharedConsent: sharedConsent => { if (!formLocked && state.reviewed) update({ sharedConsent }); },
    confirmShared: () => { if (!model.canConfirm || !ref.current.selected || !ref.current.reviewed || !envRef.current.canStartWrite()) return;
      const photo = ref.current.selected, input: PhotoConfirmation = { expectedVersion: photo.version, confirmShared: true, values: photoConfirmationProjection(ref.current.reviewed, photo.source) };
      void run(async signal => { await sendWrite({ kind: "confirm", photo, input, confirmed: false, checked: false }, signal); }, "confirm"); },
    checkOriginal: refresh,
    retryOriginal: () => { const entry = ref.current.pending;
      if (entry?.checked && !entry.confirmed && api.hasPendingOnline() && available() && editable() && ref.current.load === "ready" && ref.current.operation.state === "unconfirmed") void run(async signal => { await sendWrite(entry, signal); }, entry.kind);
      else if (ref.current.direct?.kind === "upload" && ref.current.direct.checked) upload(); },
    finishUnidentified: () => { const entry = ref.current.pending; if (available() && !ref.current.busy && entry?.confirmed && entry.checked && ref.current.load === "ready") {
      update({ pending: null, reservationUnidentified: entry.kind === "reserve" }); op(entry.kind, "saved", "已結束確認結果不可讀的操作。不會重送或按 hash 猜測附件；請逐項核對清單。");
      if (entry.kind !== "reserve") releaseEditor(); } },
    useLatest: () => { if (!state.latest || !available() || state.busy || state.pending) return; const next = state.latest;
      put(next); update({ latest: null, operation: noOperation(), ...consentReset });
      if (!next.recordId && ["running", "unknown"].includes(next.extraction.state)) { update({ direct: { kind: "extract", photo: next, checked: false } }); op("extract", "unknown", "目前版本有未查明提取。先查核同一附件，不重送模型。"); } },
    openDeletion: () => { if (model.canDelete) update({ deletion: true, deleteScope: false, deleteFinal: false }); },
    closeDeletion: () => { if (!ref.current.busy) update({ deletion: false }); },
    setDeleteScope: deleteScope => update({ deleteScope, deleteFinal: false }), setDeleteFinal: deleteFinal => update({ deleteFinal }),
    deletePhoto: () => { if (model.canDelete && state.deleteScope && state.deleteFinal && state.selected && envRef.current.canStartWrite()) void run(async signal => { await sendWrite({ kind: "delete", photo: state.selected!, checked: false, confirmed: false }, signal); }, "delete"); },
  };
  const canContinueComposerOriginal = (original: PhotoOriginal) => {
    const transfer = composerTransfer.current, s = ref.current;
    return available() && editable() && !!transfer && transfer.source === original && transfer.owned === s.original
      && !s.busy && !s.pending && !s.direct && !s.lost && !s.selected && !s.replacement && !s.latest;
  };
  async function receiveComposerOriginal(original: PhotoOriginal) {
    // Copy and verify bytes before the composer releases its independently owned resource.
    if (!model.canPick || state.original || state.selected || !original.readBase64 || !composerOwns(original)) return false;
    let owned: PhotoOriginal | null = null;
    let retained = false;
    await run(async () => {
      owned = await copyPhotoOriginal(original);
      const s = ref.current;
      if (!current() || !composerOwns(original) || !editable() || s.lost || s.pending || s.direct || s.selected || s.original || s.replacement || s.reservationUnidentified) {
        owned.dispose?.(); return;
      }
      // This operation owns the busy lock; public picker guards must not reject its internal transfer.
      update({ original: owned, source: "使用者上傳照片", sourceError: "", draft: emptyPhotoDraft(), formKey: s.formKey + 1,
        ...consentReset, operation: noOperation(), notice: "原檔只在本次記憶中，尚未上傳。" });
      retained = ref.current.original === owned;
      if (retained) composerTransfer.current = { source: original, owned };
      if (!retained) owned.dispose?.();
    });
    return retained && current() && ref.current.original === owned;
  }
  return { model, actions, scopeKey: env.scopeKey, receiveComposerOriginal, canContinueComposerOriginal, leaveGuardId, pending };
}

type Domains = { scopeKey: string; photos: ReturnType<typeof useProductionPhotos>; sources: ReturnType<typeof usePhotoInputSources> };
const PhotoInputContext = createContext<Domains | null>(null);
export const useProductionPhotoInputDomains = () => use(PhotoInputContext);
const ScopedPhotoInputBridge = memo(function ScopedPhotoInputBridge({ scopeKey, publish }: { scopeKey: string; publish: (value: Domains) => void }) {
  const photos = useProductionPhotos(), sources = usePhotoInputSources();
  useLayoutEffect(() => { publish({ scopeKey, photos, sources }); }, [scopeKey, photos, sources, publish]);
  return null;
});
export function ProductionPhotoInputDomains({ children }: { children: ReactNode }) {
  const env = useDomainEnvironment();
  const [published, setPublished] = useState<Domains | null>(null);
  useLayoutEffect(() => { if (!env.scopeKey) setPublished(null); }, [env.scopeKey]);
  const value = published?.scopeKey === env.scopeKey ? published : null;
  return <PhotoInputContext.Provider value={value}>{children}
    {env.scopeKey ? <ScopedPhotoInputBridge key={env.scopeKey} scopeKey={env.scopeKey} publish={setPublished} /> : null}
  </PhotoInputContext.Provider>;
}
export function ProductionPhotosWorkspace({ onCare, capturePreferred = false, reader }: { onCare: () => void; capturePreferred?: boolean; reader: PhotoReaderNavigation }) {
  const domain = use(PhotoInputContext)?.photos;
  const attachments = useAttachmentReview(), { actions, attachSavedPhoto } = useProduction();
  return domain ? <PhotosView mode="production" model={domain.model} actions={domain.actions} onCare={onCare} scopeKey={domain.scopeKey}
    read={{ navigation: reader, attachments, onChat: () => actions.open("chat"),
      onChatPhoto: photo => attachSavedPhoto({id:photo.id,version:photo.version,fileName:photo.fileName,mimeType:photo.mimeType,bytes:photo.bytes,sha256:photo.sha256,source:photo.source}) }}
    capture={{ capturePreferred }} /> : null;
}
export function ProductionSourcesWorkspace({ reader }: { reader: SourceReaderNavigation }) {
  const domain = use(PhotoInputContext)?.sources;
  return domain ? <SourcesView production reader={reader} model={domain.model} actions={domain.actions} previewControls={null} /> : null;
}
export function AgentPhotoInput({ original, composerGuardId }: { original: PhotoOriginal; composerGuardId: string }) {
  const domain = use(PhotoInputContext)?.photos;
  const navigate = usePreviewNavigation(), router = useRouter();
  const { owner, scopeKey } = useProductionIdentity();
  const [navigationRequested, setNavigationRequested] = useState(false);
  const continueTransfer = () => {
    if (!domain?.canContinueComposerOriginal(original)) return;
    const composer = owner.draftOwner.getSnapshot();
    const retainedComposer = composer.scope === scopeKey && composer.attachments.length === 1 && composer.attachments[0]?.photo === original;
    navigate(() => {
      // Revalidate after a guard dialog: changed identity, child or access cannot carry bytes.
      const latest = owner.draftOwner.getSnapshot();
      if (owner.getSnapshot().scopeKey === scopeKey && latest.scope === scopeKey
        && latest.attachments.some(item => item.photo === original)
        && (!retainedComposer || latest.attachments.length === 1)
        && domain.canContinueComposerOriginal(original)) router.push("/photos");
    }, "navigation", [...(retainedComposer ? [composerGuardId] : []), domain.leaveGuardId]);
  };
  useEffect(() => {
    if (!navigationRequested || !domain || domain.pending) return;
    setNavigationRequested(false);
    continueTransfer();
  }, [navigationRequested, domain]);
  if (!domain) return null;
  return <SectionCard><SectionHeader density="compact" title="照片輸入" subtitle="先私人保存原照片，再分別同意提取與核對共享。" />
    <Text>{original.fileName} · {(original.bytes / (1024 * 1024)).toFixed(2)} MiB</Text>
    <View><AppButton label="把原照片帶入核對" disabled={!domain.model.canPick || !!domain.model.selected || !!domain.model.original || domain.pending} onPress={() => {
      // Keep the composer resource until the router actually enters Photos. The provider
      // clears attachments on committed route changes; a blocked navigation loses nothing.
      void domain.receiveComposerOriginal(original).then(transferred => { if (transferred) setNavigationRequested(true); });
    }} /></View><Text>目前只在本次記憶中；帶入核對不代表已保存、已交模型或已發送聊天。</Text>
    {domain.model.operation.message || domain.model.notice ? <Text>{domain.model.operation.message || domain.model.notice}</Text> : null}
    {domain.model.original || domain.model.selected ? <AppButton label="繼續核對照片" variant="secondary" disabled={domain.pending} onPress={continueTransfer} /> : null}
  </SectionCard>;
}

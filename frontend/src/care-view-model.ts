// Presentation models only. The formal CareValues and transport remain authoritative.
export const careKindOptions = [
  { value: "note", label: "日常觀察", icon: "notebook-outline" },
  { value: "feeding", label: "飲食", icon: "silverware-fork-knife" },
  { value: "sleep", label: "睡眠", icon: "weather-night" },
  { value: "diaper", label: "如廁／尿片", icon: "baby-face-outline" },
  { value: "temperature", label: "體溫", icon: "thermometer" },
  { value: "measurement", label: "身高／體重", icon: "ruler" },
  { value: "appointment", label: "預約", icon: "calendar-outline" },
] as const;

export type CareKind = typeof careKindOptions[number]["value"];
export type CareFilter = CareKind | "all";
export type CareWriteState = "none" | "needs_confirmation" | "saving" | "saved" | "failed" | "unknown" | "conflict";
export type CareListState = "ready" | "loading" | "loading_more" | "error" | "stale";

export interface CareFormValues {
  kind: CareKind;
  text: string;
  source: string;
  quantityRaw: string;
  quantityUnit: string;
  quantityPrecision: "exact" | "approximate";
  eventTimeRaw: string;
  reason: string;
}

export interface CareRevisionView {
  version: number;
  values: CareFormValues;
  eventTimePrecision: "exact" | "approximate" | "unknown";
  timeZoneLabel: string;
  confirmedByLabel: string;
  confirmedAtLabel: string;
}

export interface CareRecordView {
  id: string;
  childId: string;
  title: string;
  createdAtLabel: string;
  current: CareRevisionView;
  history: CareRevisionView[];
}

// Private proposals are not CareRecords. Only the record owner may commit them.
export type CareProposalTarget =
  | { kind: "create"; scope: "family" | "private" }
  | { kind: "update"; scope: "family" | "private"; recordId: string; expectedVersion: number };
export type CareReviewDomain = "care_event" | "long_term_fact" | "task";
// Read-only source metadata, not a new conversation or persistence contract.
export type CareReviewSourceContext = {
  batchId: string; conversationLabel?: string; messageId: string; runId: string;
  occurredAt: string; dateLabel: string;
};
export type CareCaptureReview = {
  id: string; version: number;
  writeState: "not_saved" | "saved" | "failed" | "unknown";
  reviewRequirement: "optional" | "required" | "prewrite";
  reviewState: "not_required" | "pending" | "confirmed" | "skipped"; childId: string; title: string; createdAtLabel: string;
  originalText: string; sourceLabel: string; sourceId: string; sourceVersion: string;
  sourceScope: "private" | "family"; sourceState: "ready" | "changed" | "unavailable";
  proposedValues: CareFormValues; target: CareProposalTarget;
  purpose?: string; duplicateHint?: string;
  conversationId?: string; sourceContext?: CareReviewSourceContext;
  targetDomain?: CareReviewDomain;
  // Supplied by the owner; an expired operation does not resolve the review item.
  operationValidity?: { state: "active" | "expired" | "unavailable"; expiresAtLabel?: string };
  photo?: { id: string; label: string };
  confirmation?: { scopeKey: string; proposalVersion: number; sourceVersion: string; recordId: string; recordVersion: number; label: string };
  resolution?: { label: string; recordId?: string; recordVersion?: number };
  uncertainties: string[];
  // Read-only reference projected from the canonical owner, never separately saved.
  basis?: CareRecordView | null;
  savedRecord?: CareRecordView | null;
};
export type CareProposalCapabilities = { create: boolean; update: boolean; skip: boolean; confirmImportant?: boolean };
export type CareImportantReviewEvent = { scopeKey: string; conversationId: string; sourceId: string; sourceVersion: string; proposalId: string; proposalVersion: number; recordId: string; recordVersion: number };
export function careImportantEventMatches(capture: CareCaptureReview, event: CareImportantReviewEvent | undefined, scopeKey: string | undefined, currentConversationId: string | null | undefined) {
  return !!event && !!scopeKey && event.scopeKey === scopeKey && careReviewMatchesConversation(capture, currentConversationId)
    && event.conversationId === currentConversationId && event.proposalId === capture.id && event.proposalVersion === capture.version
    && event.sourceId === capture.sourceId && event.sourceVersion === capture.sourceVersion && capture.sourceState === "ready"
    && capture.reviewRequirement === "required" && capture.reviewState === "pending" && capture.writeState === "saved"
    && event.recordId === capture.savedRecord?.id && event.recordVersion === capture.savedRecord?.current.version;
}
export type CareReviewProjection = {
  state: "ready" | "loading" | "error" | "unavailable";
  scopeKey: string; items: CareCaptureReview[]; hasMore: boolean; label: string;
  capabilities?: CareProposalCapabilities; notice?: string; importantEvent?: CareImportantReviewEvent;
};
export type CareReviewFilter = "pending" | "all" | "corrected";
export function careRecordMatchesReview(record: CareRecordView, filter: CareReviewFilter) {
  return filter === "all" || filter === "corrected" && record.current.version > 1;
}
export function careCaptureMatchesSearch(item: CareCaptureReview, query: string, kind: CareFilter) {
  return (kind === "all" || item.proposedValues.kind === kind) && `${item.title} ${item.originalText} ${item.proposedValues.text} ${item.sourceLabel}`.toLocaleLowerCase("zh-HK").includes(query.trim().toLocaleLowerCase("zh-HK"));
}

export function authorizedCareCaptureReview(model: Pick<CareRecordsViewModel, "access" | "scopeKey" | "child" | "review">): CareReviewProjection {
  const unavailable: CareReviewProjection = { state: "unavailable", scopeKey: model.scopeKey ?? "", items: [], hasMore: false, label: "" };
  if (model.access === "lost" || !model.scopeKey || !model.review || model.review.scopeKey !== model.scopeKey) return unavailable;
  if (model.review.state !== "ready") return { ...model.review, items: [] };
  return { ...model.review, items: model.review.items.filter(item => item.childId === model.child.id) };
}

export function careCaptureReadiness(capture: CareCaptureReview, context: {
  childId: string; access: "editable" | "read_only" | "lost"; capabilities?: CareProposalCapabilities;
  expectedVersion?: number; expectedSourceVersion?: string;
}): { allowed: boolean; reason: string } {
  if (!careReviewUsesCareOwner(capture)) return { allowed: false, reason: "這類內容的所屬資料接口尚未接通，不能透過照顧記錄提交。" };
  if (capture.operationValidity && capture.operationValidity.state !== "active") return { allowed: false, reason: capture.operationValidity.state === "expired" ? "原操作已過期；待確認事項仍保留，須重新取得有效提案後再處理。" : "原操作目前不可用；待確認事項仍保留，不能提交舊提案。" };
  if (capture.reviewState !== "pending" || capture.writeState !== "not_saved") return { allowed: false, reason: "這筆提案已處理，不能重複確認寫入。" };
  if (context.access !== "editable" || capture.childId !== context.childId) return { allowed: false, reason: "目前權限不能確認寫入這筆提案。" };
  if (capture.sourceState !== "ready") return { allowed: false, reason: capture.sourceState === "changed" ? "原始來源已變更，請先重新取得並核對提案。" : "原始來源暫不可用，不能確認寫入。" };
  if (context.expectedVersion !== undefined && capture.version !== context.expectedVersion || context.expectedSourceVersion !== undefined && capture.sourceVersion !== context.expectedSourceVersion) return { allowed: false, reason: "提案或來源已更新，請重新核對，不能沿用之前的確認。" };
  if (capture.target.scope !== "family") return { allowed: false, reason: "這個記錄流程只支援家庭記錄，私人保存目的地尚未接通。" };
  if (!context.capabilities?.[capture.target.kind]) return { allowed: false, reason: capture.target.kind === "update" ? "更新既有記錄的提案確認接口尚未接通；不會改成新增一筆。" : "新增記錄的提案確認接口尚未接通。" };
  if (capture.target.kind === "update" && (!capture.basis || capture.basis.childId !== context.childId || capture.basis.id !== capture.target.recordId || capture.basis.current.version !== capture.target.expectedVersion)) return { allowed: false, reason: "原記錄未讀到或版本已改變，請重新核對更新基準。" };
  return { allowed: true, reason: "" };
}

export function careImportantReviewReadiness(capture: CareCaptureReview, context: { childId: string; scopeKey: string; access: "editable" | "read_only" | "lost"; capabilities?: CareProposalCapabilities; expectedVersion: number; expectedSourceVersion: string; recordId: string; recordVersion: number; expectedScopeKey: string }): { allowed: boolean; reason: string } {
  if (!careReviewUsesCareOwner(capture)) return { allowed: false, reason: "這類內容的所屬確認接口尚未接通，不能由照顧記錄代為確認。" };
  if (capture.operationValidity && capture.operationValidity.state !== "active") return { allowed: false, reason: "原操作已失效；重要待確認狀態保留，請先重新取得有效的確認操作。" };
  if (context.access !== "editable" || capture.childId !== context.childId || !context.scopeKey || context.scopeKey !== context.expectedScopeKey) return { allowed: false, reason: "作用域或權限已改變，不能沿用這次確認。" };
  if (!context.capabilities?.confirmImportant) return { allowed: false, reason: "重要記錄的明確確認接口尚未接通。" };
  if (capture.reviewRequirement !== "required" || capture.reviewState !== "pending" || capture.writeState !== "saved") return { allowed: false, reason: "目前沒有可確認的重要已保存記錄。" };
  if (capture.sourceState !== "ready" || capture.version !== context.expectedVersion || capture.sourceVersion !== context.expectedSourceVersion) return { allowed: false, reason: "提案或原始來源已變更，請重新核對，不能確認舊內容。" };
  if (!capture.savedRecord || capture.savedRecord.id !== context.recordId || capture.savedRecord.current.version !== context.recordVersion) return { allowed: false, reason: "記錄版本已改變或未讀到，請先取得目前內容再確認。" };
  return { allowed: true, reason: "" };
}

export function careReviewMatchesConversation(capture: CareCaptureReview, conversationId: string | null | undefined) {
  return !!conversationId && !!capture.conversationId && capture.conversationId === conversationId;
}

export function projectCareCaptures(captures: readonly CareCaptureReview[], records: readonly CareRecordView[], childId: string, scopeKey = ""): CareCaptureReview[] {
  return captures.filter(capture => capture.childId === childId).map(capture => {
    if (!careReviewUsesCareOwner(capture)) return { ...capture, basis: null, savedRecord: null };
    const savedRecord = careReviewUsesCareOwner(capture) && capture.writeState === "saved" && capture.resolution?.recordVersion !== undefined
      ? records.find(record => record.id === capture.resolution?.recordId && record.childId === childId && record.current.version >= (capture.resolution?.recordVersion ?? Infinity)) ?? null : null;
    const confirmation = capture.confirmation;
    const confirmationCurrent = !!savedRecord && capture.sourceState === "ready" && confirmation?.scopeKey === scopeKey && confirmation?.proposalVersion === capture.version && confirmation?.sourceVersion === capture.sourceVersion && confirmation?.recordId === savedRecord.id && confirmation?.recordVersion === savedRecord.current.version;
    return { ...capture, savedRecord,
      reviewState: capture.reviewRequirement === "required" ? confirmationCurrent ? "confirmed" : "pending" : capture.reviewState,
      basis: careReviewUsesCareOwner(capture) && capture.target.kind === "update" ? records.find(record => record.id === (capture.target as Extract<CareProposalTarget, { kind: "update" }>).recordId && record.childId === childId) ?? null : null,
    };
  });
}

export function careReviewUsesCareOwner(capture: CareCaptureReview) {
  return !capture.targetDomain || capture.targetDomain === "care_event";
}
export function careReviewDomainLabel(capture: CareCaptureReview) {
  return capture.targetDomain === "long_term_fact" ? "長期事實" : capture.targetDomain === "task" ? "待辦事項" : "照顧記錄";
}
export function careReviewSourceKey(capture: CareCaptureReview) {
  return capture.conversationId ? `conversation:${capture.conversationId}` : capture.sourceContext ? `batch:${capture.sourceContext.batchId}` : `source:${capture.id}`;
}
export type CareReviewTab = "pending" | "recorded";
export function careReviewNeedsConfirmation(capture: CareCaptureReview) {
  return capture.reviewState === "pending";
}
export function careReviewMatchesTab(capture: CareCaptureReview, tab: CareReviewTab) {
  return tab === "pending" ? careReviewNeedsConfirmation(capture) : capture.writeState === "saved" && !careReviewNeedsConfirmation(capture) && capture.reviewState !== "skipped";
}
export function careReviewContentSummary(capture: CareCaptureReview) {
  const values = capture.writeState === "saved" && capture.savedRecord ? capture.savedRecord.current.values : capture.proposedValues;
  const quantity = values.quantityRaw && !values.text.includes(values.quantityRaw) ? `${values.quantityRaw} ${values.quantityUnit}`.trim() : "";
  return `${values.text}${quantity ? ` · ${quantity}` : ""}`;
}
export function careReviewIsImportantPending(capture: CareCaptureReview) {
  return capture.reviewRequirement === "required" && capture.reviewState === "pending";
}
function careReviewTime(capture: CareCaptureReview) {
  const time = Date.parse(capture.sourceContext?.occurredAt ?? "");
  return Number.isFinite(time) ? time : -Infinity;
}
// Never infer chronology by parsing translated display labels.
export function careReviewChronological(items: readonly CareCaptureReview[]) {
  return [...items].sort((a, b) => careReviewTime(b) - careReviewTime(a));
}
export function careReviewPrioritize(items: readonly CareCaptureReview[]) {
  return careReviewChronological(items).sort((a, b) => Number(careReviewIsImportantPending(b)) - Number(careReviewIsImportantPending(a)));
}
export function careReviewSourceGroups(items: readonly CareCaptureReview[]) {
  const groups = new Map<string, { key: string; label: string; dateLabel: string; items: CareCaptureReview[] }>();
  for (const item of items) {
    const key = careReviewSourceKey(item), existing = groups.get(key);
    if (existing) existing.items.push(item);
    else groups.set(key, { key, label: item.sourceContext?.conversationLabel ?? "未提供對話名稱", dateLabel: item.sourceContext?.dateLabel ?? "未提供對話日期", items: [item] });
  }
  return [...groups.values()];
}
export function careReviewMatchesQuery(item: CareCaptureReview, query: string) {
  return `${item.title} ${item.originalText} ${item.proposedValues.text} ${item.sourceLabel} ${item.sourceContext?.conversationLabel ?? ""} ${item.sourceContext?.dateLabel ?? ""} ${careReviewDomainLabel(item)}`.toLocaleLowerCase("zh-HK").includes(query.trim().toLocaleLowerCase("zh-HK"));
}

export const careReviewPageSize = 10;
export const careReviewRecentLimit = careReviewPageSize * 10;
export function careReviewPage(items: readonly CareCaptureReview[], requestedPage: number) {
  const page = Math.min(Math.max(0, requestedPage), Math.max(0, Math.ceil(items.length / careReviewPageSize) - 1));
  return { page, items: items.slice(page * careReviewPageSize, (page + 1) * careReviewPageSize), hasPrevious: page > 0, hasNext: (page + 1) * careReviewPageSize < items.length };
}
export function careReviewWindow(items: readonly CareCaptureReview[]) {
  return { recent: items.slice(0, careReviewRecentLimit), older: items.slice(careReviewRecentLimit),
    pendingCount: items.filter(careReviewNeedsConfirmation).length,
    importantPendingCount: items.filter(item => item.reviewRequirement === "required" && item.reviewState === "pending").length,
    olderPendingCount: items.slice(careReviewRecentLimit).filter(careReviewNeedsConfirmation).length };
}

export interface CareDraftView {
  key: string;
  mode: "create" | "revise";
  basis: CareRecordView | null;
  initialValues: CareFormValues;
  reviewedValues: CareFormValues | null;
  captureId?: string;
  captureSnapshot?: CareCaptureReview;
}

export interface CareRecordsViewModel {
  child: { id: string; name: string; summary: string };
  access: "editable" | "read_only" | "lost";
  online: boolean;
  dataLabel: string;
  scopeKey?: string;
  detailRead?: { id: string; state: "loading" | "ready" | "error" } | null;
  review?: CareReviewProjection;
  list: {
    state: CareListState;
    hasSnapshot?: boolean;
    records: CareRecordView[];
    activeQuery: string;
    activeKind: CareFilter;
    scanned: number;
    hasMore: boolean;
    page?: number;
    hasPrevious?: boolean;
    message: string | null;
  };
  detail: {
    record: CareRecordView;
    historyOpen: boolean;
    history: CareRevisionView[];
    historyLoading: boolean;
    historyState?: "unread" | "ready" | "error";
    historyRetryMore?: boolean;
    hasMoreHistory: boolean;
  } | null;
  draft: CareDraftView | null;
  deletion: { basis: CareRecordView; scopeConfirmed: boolean } | null;
  operation: {
    kind?: "delete" | "review";
    state: CareWriteState;
    message: string;
    reference: string | null;
    referenceLabel?: string;
    latest: CareRecordView | null;
    retryAvailable?: boolean;
  };
  submitLabel: string;
  checkLabel: string;
}

export interface CareRecordsActions {
  search(query: string, kind: CareFilter): void;
  loadMore(): void;
  previousPage?(): void;
  openRecord(id: string): void;
  closePanel(): void;
  startCreate(kind?: CareKind): void;
  reviewCapture?(id: string, expectedVersion: number, expectedSourceVersion: string): void;
  confirmCapture?(id: string, expectedVersion: number, expectedSourceVersion: string): void;
  confirmImportantRecord?(id: string, expectedVersion: number, expectedSourceVersion: string, recordId: string, recordVersion: number, expectedScopeKey: string): void;
  skipCapture?(id: string, expectedVersion: number): void;
  startCorrection(id: string): void;
  startDeletion(id: string): void;
  confirmDeletionScope(checked: boolean): void;
  submitDeletion(): void;
  showHistory(): void;
  loadOlderHistory(): void;
  reviewDraft(values: CareFormValues): void;
  editDraft(): void;
  submitReviewed(): void;
  checkOriginalOperation(): void;
  retryOriginalOperation(): void;
  useLatestVersion(): void;
}

export const emptyCareForm = (): CareFormValues => ({
  kind: "note", text: "", source: "", quantityRaw: "", quantityUnit: "",
  quantityPrecision: "approximate", eventTimeRaw: "", reason: "",
});

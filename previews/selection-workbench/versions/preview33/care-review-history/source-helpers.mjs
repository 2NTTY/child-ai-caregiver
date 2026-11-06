// Source: 2NTTY/child-ai-caregiver at 2abe7aed60b192b253414f6464e3fd070cc377e7.
// https://github.com/2NTTY/child-ai-caregiver/blob/2abe7aed60b192b253414f6464e3fd070cc377e7/frontend/src/care-view-model.ts#L99-L104
// Same file L151-L159 and L160-L210; CareReviewPagination.tsx L10-L22.
// https://github.com/2NTTY/child-ai-caregiver/blob/2abe7aed60b192b253414f6464e3fd070cc377e7/frontend/src/components/care/CareReviewPagination.tsx#L10-L22
// Four complete source segments, TypeScript annotations/type alias removed. No owner or new wrappers.
export function authorizedCareCaptureReview(model) {
  const unavailable = { state: "unavailable", scopeKey: model.scopeKey ?? "", items: [], hasMore: false, label: "" };
  if (model.access === "lost" || !model.scopeKey || !model.review || model.review.scopeKey !== model.scopeKey) return unavailable;
  if (model.review.state !== "ready") return { ...model.review, items: [] };
  return { ...model.review, items: model.review.items.filter(item => item.childId === model.child.id) };
}

export function careReviewUsesCareOwner(capture) {
  return !capture.targetDomain || capture.targetDomain === "care_event";
}
export function careReviewDomainLabel(capture) {
  return capture.targetDomain === "long_term_fact" ? "長期事實" : capture.targetDomain === "task" ? "待辦事項" : "照顧記錄";
}
export function careReviewSourceKey(capture) {
  return capture.conversationId ? `conversation:${capture.conversationId}` : capture.sourceContext ? `batch:${capture.sourceContext.batchId}` : `source:${capture.id}`;
}

export function careReviewNeedsConfirmation(capture) {
  return capture.reviewState === "pending";
}
export function careReviewMatchesTab(capture, tab) {
  return tab === "pending" ? careReviewNeedsConfirmation(capture) : capture.writeState === "saved" && !careReviewNeedsConfirmation(capture) && capture.reviewState !== "skipped";
}
export function careReviewContentSummary(capture) {
  const values = capture.writeState === "saved" && capture.savedRecord ? capture.savedRecord.current.values : capture.proposedValues;
  const quantity = values.quantityRaw && !values.text.includes(values.quantityRaw) ? `${values.quantityRaw} ${values.quantityUnit}`.trim() : "";
  return `${values.text}${quantity ? ` · ${quantity}` : ""}`;
}
export function careReviewIsImportantPending(capture) {
  return capture.reviewRequirement === "required" && capture.reviewState === "pending";
}
function careReviewTime(capture) {
  const time = Date.parse(capture.sourceContext?.occurredAt ?? "");
  return Number.isFinite(time) ? time : -Infinity;
}
// Never infer chronology by parsing translated display labels.
export function careReviewChronological(items) {
  return [...items].sort((a, b) => careReviewTime(b) - careReviewTime(a));
}
export function careReviewPrioritize(items) {
  return careReviewChronological(items).sort((a, b) => Number(careReviewIsImportantPending(b)) - Number(careReviewIsImportantPending(a)));
}
export function careReviewSourceGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const key = careReviewSourceKey(item), existing = groups.get(key);
    if (existing) existing.items.push(item);
    else groups.set(key, { key, label: item.sourceContext?.conversationLabel ?? "未提供對話名稱", dateLabel: item.sourceContext?.dateLabel ?? "未提供對話日期", items: [item] });
  }
  return [...groups.values()];
}
export function careReviewMatchesQuery(item, query) {
  return `${item.title} ${item.originalText} ${item.proposedValues.text} ${item.sourceLabel} ${item.sourceContext?.conversationLabel ?? ""} ${item.sourceContext?.dateLabel ?? ""} ${careReviewDomainLabel(item)}`.toLocaleLowerCase("zh-HK").includes(query.trim().toLocaleLowerCase("zh-HK"));
}

export const careReviewPageSize = 10;
export const careReviewRecentLimit = careReviewPageSize * 10;
export function careReviewPage(items, requestedPage) {
  const page = Math.min(Math.max(0, requestedPage), Math.max(0, Math.ceil(items.length / careReviewPageSize) - 1));
  return { page, items: items.slice(page * careReviewPageSize, (page + 1) * careReviewPageSize), hasPrevious: page > 0, hasNext: (page + 1) * careReviewPageSize < items.length };
}
export function careReviewWindow(items) {
  return { recent: items.slice(0, careReviewRecentLimit), older: items.slice(careReviewRecentLimit),
    pendingCount: items.filter(careReviewNeedsConfirmation).length,
    importantPendingCount: items.filter(item => item.reviewRequirement === "required" && item.reviewState === "pending").length,
    olderPendingCount: items.slice(careReviewRecentLimit).filter(careReviewNeedsConfirmation).length };
}

// Only the loaded, filtered window is addressable; its last page is not a remote last page.
export function careReviewPageSlots(page, pageCount, compact) {
  const limit = compact ? 5 : 7;
  if (pageCount <= limit) return Array.from({ length: pageCount }, (_, index) => index);
  if (compact) {
    if (page < 2) return [0, 1, 2, "after", pageCount - 1];
    if (page >= pageCount - 2) return [0, "before", pageCount - 3, pageCount - 2, pageCount - 1];
    return [0, "before", page, "after", pageCount - 1];
  }
  if (page < 4) return [0, 1, 2, 3, 4, "after", pageCount - 1];
  if (page >= pageCount - 4) return [0, "before", pageCount - 5, pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1];
  return [0, "before", page - 1, page, page + 1, "after", pageCount - 1];
}

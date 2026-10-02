import type { SourceInput, PublicInputSource } from "../shared-input-view-model";
export const previewPublicSources: readonly PublicInputSource[] = [{ id: "preview-fhs-source", url: "https://www.fhs.gov.hk/", publisher: "衛生署家庭健康服務（合成清單）" }];
export function sourceFixture(childId: string, ownerUserId: string, accountName: string): SourceInput[] {
  const base: SourceInput = { id: `preview-source-${childId}-${ownerUserId}-link`, childId, ownerUserId, version: 2, createdAt: "2026-09-30T09:30:00Z", canManage: true,
    kind: "personal_source", sourceLabel: `${accountName}的私人來源`, sourceUrl: "https://example.com/family-notes", sourceDateText: "九月下旬，發布日期待核對", sourceNotes: "由我自行整理，正文尚待提供。",
    sourceId: null, text: "", sha256: null, retrievedAt: null, fetchState: "not_requested", extraction: { state: "not_requested", runId: null, excerpt: null, draft: null, stopReason: null, processedAt: null, model: null },
    recordId: null, confirmationKind: null };
  return [base, { ...base, id: `preview-source-${childId}-${ownerUserId}-text`, version: 1, kind: "paste", sourceLabel: `${accountName}貼上的觀察原文`, sourceUrl: null, sourceNotes: "", sourceDateText: null,
    text: "  大約九點多入睡，途中醒過一次。\n時間與原因仍須向照顧者核對。  ", sha256: "a".repeat(64), fetchState: "ready" },
    { ...base, id: `preview-source-${childId}-${ownerUserId}-long`, kind: "paste", sourceLabel: `${accountName}的長文合成示例`, sourceUrl: null, sourceNotes: "", sourceDateText: "原日期未確定",
      text: "這是私人長文的合成原文，只有明確選擇的連續片段才會交給提取流程。\n".repeat(330), sha256: "b".repeat(64), fetchState: "ready" }];
}

import type { MemoryFactView, MemoryPreviewData, MemorySourceChoice, MemoryTopicView } from "../memory-view-model";

export function createMemoryFixture(childId: string, sourceChanged = false, expired = false): { data: MemoryPreviewData; sources: MemorySourceChoice[] } {
  if (childId.startsWith("preview-new-child-")) return { sources: [{ id: "manual", label: "手動描述", kind: "manual", current: true }], data: { facts: [], topics: [], factVersions: {}, topicVersions: {}, summary: null } };
  const prefix = `${childId}-memory`;
  const recordId = `${prefix}-record`;
  const messageId = `${prefix}-message-3`;
  const sources: MemorySourceChoice[] = [
    { id: "manual", label: "手動描述", kind: "manual", current: true },
    { id: "record-v1", label: "照顧記錄 · 版本 1", kind: "care_record", recordId, version: 1, current: !sourceChanged },
    ...(sourceChanged ? [{ id: "record-v2", label: "照顧記錄 · 最新版本 2", kind: "care_record" as const, recordId, version: 2, current: true }] : []),
    { id: "private-message", label: "本人的私人聊天訊息", kind: "private_chat", messageId, current: true },
  ];
  const facts: MemoryFactView[] = [
    { id: `${prefix}-candidate`, childId, key: "週末照顧安排", content: "家長想先核對週末的照顧分工。", source: { kind: "private_chat", description: "本人提供的私人聊天示例", messageId },
      validUntil: null, visibility: "private", intendedVisibility: "family", status: "candidate", version: 1, authorSelf: true, reason: "建立私人候選", confirmedAt: null, sourceState: "current" },
    { id: `${prefix}-shared`, childId, key: "睡前觀察", content: "家人確認睡前會一起看圖畫書。", source: { kind: "care_record", description: "合成睡前觀察記錄", recordId, version: 1 },
      validUntil: null, visibility: "family", intendedVisibility: "family", status: "confirmed", version: 2, authorSelf: false, reason: "照顧者核對描述", confirmedAt: "2026-09-28T12:00:00+08:00", sourceState: sourceChanged ? "changed" : "current" },
    { id: `${prefix}-private`, childId, key: "本人觀察筆記", content: "想在下次對話補充孩子最近喜歡的活動。", source: { kind: "manual", description: "本人手動核對的合成描述" },
      validUntil: expired ? "2026-09-01T18:00:00+08:00" : "2099-12-31T23:59:00+08:00", visibility: "private", intendedVisibility: "private", status: "confirmed", version: 2, authorSelf: true, reason: "補充觀察描述", confirmedAt: "2026-09-28T13:00:00+08:00", sourceState: "current" },
    { id: `${prefix}-inactive`, childId, key: "舊接送安排", content: "這項舊安排已停止使用。", source: { kind: "manual", description: "本人提供的舊安排示例" },
      validUntil: null, visibility: "private", intendedVisibility: "private", status: "inactive", version: 3, authorSelf: true, reason: "照顧安排已改變", confirmedAt: "2026-09-20T12:00:00+08:00", sourceState: "current" },
  ];
  const topic = (suffix: string, title: string, status: MemoryTopicView["status"], visibility: MemoryTopicView["visibility"]): MemoryTopicView => ({
    id: `${prefix}-${suffix}`, childId, title, status, visibility, note: "合成話題示例；狀態不會更改任何任務。", version: status === "pending" ? 1 : 2,
    authorSelf: visibility === "private", updatedAt: "2026-09-28T15:00:00+08:00", resumeAfter: status === "snoozed" ? "2099-12-31T09:00:00+08:00" : null, reopenReason: null, reopenedFrom: null,
  });
  const topics = [topic("pending", "想整理睡前流程", "pending", "private"), topic("answered", "上次的記錄問題", "answered", "private"),
    topic("snoozed", "稍後再討論週末安排", "snoozed", "family"), topic("resolved", "圖畫書選擇已商量好", "resolved", "family")];
  const factVersions = Object.fromEntries(facts.map(item => [item.id, [item, ...(item.id.endsWith("-private") ? [{ ...item, version: 1, content: "想補充最近喜歡的活動。", reason: "初次確認" }] : [])]]));
  return { sources, data: { facts, topics, factVersions, topicVersions: Object.fromEntries(topics.map(item => [item.id, [item]])),
    summary: { id: `${prefix}-summary-2`, version: 2, text: "本人曾提到睡前閱讀及週末照顧安排。週末描述仍是私人候選，尚未成為家庭共享事實；摘要不改變話題或任務狀態。",
      createdAt: "2026-09-28T16:00:00+08:00", previousId: `${prefix}-summary-1`, coveredMessageIds: [`${prefix}-message-2`, messageId, `${prefix}-message-4`], lastCoveredMessageId: `${prefix}-message-4` } } };
}

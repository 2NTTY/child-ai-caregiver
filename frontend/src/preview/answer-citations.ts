import type { ChatCitationView } from "../chat-view-model";

// These are layout fixtures, not official knowledge evidence.
export const previewAnswerCitations: readonly ChatCitationView[] = [
  ["records", "記錄時間及原文（合成示例）", "先核對事件時間、原文及確認狀態的版式示例。"],
  ["questions", "睡前流程討論（合成示例）", "以原本的問題及觀察整理討論內容的版式示例。"],
  ["evidence", "來源日期及適用範圍（合成示例）", "正式引用須保留原片段、日期及適用範圍；這裡只有版式示例。"],
].map(([id, title, excerpt]): ChatCitationView => ({
  id: `preview-answer-${id}`, title, excerpt, section: "合成引用版式", publisher: "前端合成樣本", classification: "synthetic",
  versionId: `preview-${id}-v1`, versionHash: "preview-only-not-a-real-version-hash",
  checkedAt: "2026-09-26T02:24:00.000Z", fetchedAt: "2026-09-26T02:24:00.000Z", lastSuccessfulCheckAt: null,
  sourceDate: "合成時間，非官方發布日期", validUntil: null, applicabilityLabel: "只作介面示例，不適用於真實建議。",
  internalOnly: true, url: null,
}));

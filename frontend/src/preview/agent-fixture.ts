import type { AgentCitationView, AgentProposalView, AgentRunView } from "../agent-view-model";

export type AgentRunScenario = "standard" | "changes" | "empty" | "expired" | "running" | "stopped" | "unknown" | "degraded" | "many_sources";
export const conversationRunId = (childId: string) => `preview-conversation-${childId}`;
export const backgroundRunId = (childId: string) => `preview-background-${childId}`;
export function createAgentRun(childId: string, runId: string, scenario: AgentRunScenario, now: number): AgentRunView {
  const createdAt = new Date(now - 300_000).toISOString();
  const expiresAt = new Date(now + 3_600_000).toISOString();
  const proposals: AgentProposalView[] = [
    { id: `${runId}-task`, version: 1, status: "pending", kind: "task_create", title: "核對這一星期的作息記錄",
      content: "先閱讀已確認的記錄，再整理想在下一次討論釐清的問題。這只是合成候選，不是育兒建議。",
      scope: "family", createdAt, expiresAt, result: null,
      details: [{ label: "操作", value: "建立普通任務" }, { label: "負責人", value: "媽媽（合成成員）" },
        { label: "到期時間（原時差）", value: new Date(now + 86_400_000).toISOString() }, { label: "時區", value: "Asia/Hong_Kong" }] },
    { id: `${runId}-fact`, version: 1, status: "pending", kind: "memory_fact", title: "下次討論先核對原文",
      content: "我想先看清楚原本的照顧記錄，再整理問題。合成私人記憶示例，尚未確認成事實。",
      scope: "private", createdAt, expiresAt, result: null,
      details: [{ label: "記憶鍵", value: "preview-discussion-preference" }, { label: "來源", value: "這次示例問題的原文，須由本人核對" }, { label: "有效至", value: "未設定" }] },
  ];
  if (scenario === "changes") {
    proposals.splice(0, proposals.length,
      ...(["reschedule", "complete", "cancel", "resolve"] as const).map((action, index): AgentProposalView => ({
        id: `${runId}-${action}`, version: 1, status: "pending", kind: "task_change", scope: "family", createdAt, expiresAt, result: null,
        title: ({ reschedule: "改期／轉派作息核對任務", complete: "記錄任務完成", cancel: "取消原任務", resolve: "覆核任務終態" })[action],
        content: "由本人核對原任務及操作內容；合成候選保存不代表原任務已改動。",
        details: [{ label: "原任務", value: "核對作息記錄（合成任務）" }, { label: "原任務版本", value: "3" },
          { label: "操作", value: ({ reschedule: "改期／轉派", complete: "記錄完成", cancel: "取消", resolve: "覆核終態" })[action] },
          ...(action === "reschedule" ? [{ label: "新負責人", value: "爸爸（合成成員）" }, { label: "新到期時間（原時差）", value: new Date(now + 172_800_000).toISOString() }, { label: "時區", value: "Asia/Hong_Kong" }] : []),
          ...(action === "resolve" ? [{ label: "覆核為", value: "已取消" }] : []),
          { label: "原因／備註", value: `第 ${index + 1} 個操作版式示例；沒有修改正式任務` }],
      })),
      { ...proposals[1], id: `${runId}-shared-fact`, scope: "family", title: "家庭共享記憶候選", details: [...proposals[1].details] });
  }
  if (scenario === "expired") proposals.forEach(item => { item.expiresAt = new Date(now - 60_000).toISOString(); });
  const empty = scenario === "empty" || scenario === "running" || scenario === "stopped" || scenario === "unknown";
  return {
    id: runId, childId, createdAt, status: ["running", "stopped", "unknown"].includes(scenario) ? scenario as "running" | "stopped" | "unknown" : "completed",
    text: empty ? "" : "示例回覆：先核對已有記錄，再逐項決定是否接受下方候選。【1】此段只示範結果版式，沒有呼叫模型，亦沒有提供健康建議。" + (scenario === "many_sources" ? "多來源定位版式示例。【12】" : ""),
    stopReasonLabel: scenario === "stopped" ? "處理中斷，沒有自動重新執行" : null,
    stopReasonDetail: null,
    counts: scenario === "unknown" ? null : { modelCalls: 1, toolCalls: empty ? 1 : 3, queryEmbeddings: empty ? 0 : 1 },
    retrievalMode: empty ? "not_used" : scenario === "degraded" ? "keyword_degraded" : "vector_keyword",
    tools: empty ? [{ id: "preview-tool", nameLabel: "整理回覆及引用", status: scenario === "stopped" ? "failed" : scenario === "unknown" ? "unknown" : "succeeded", savesCandidate: false }]
      : [{ id: "preview-read", nameLabel: "讀取已確認記憶及任務", status: "succeeded", savesCandidate: false },
        { id: "preview-propose", nameLabel: "保存任務／記憶候選", status: "succeeded", savesCandidate: true },
        { id: "preview-present", nameLabel: "整理回覆及引用", status: "succeeded", savesCandidate: false }],
    proposals: empty ? [] : proposals,
    citations: empty ? [] : Array.from({ length: scenario === "many_sources" ? 12 : 1 }, (_, index): AgentCitationView => ({
      id: scenario === "many_sources" ? `preview-source-${index + 1}` : "preview-source",
      title: scenario === "many_sources" ? `來源片段與版本的版式示例 ${index + 1}` : "來源片段與版本的版式示例",
      section: "合成引用 · 沒有真資料來源", publisher: "前端合成樣本", classification: "synthetic",
      excerpt: "這個位置會顯示原回答實際引用的片段。此處只有版式文字，不能作為任何育兒或健康說法的依據。",
      versionId: "preview-version-1", versionHash: "preview-only-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      checkedAt: createdAt, fetchedAt: createdAt, lastSuccessfulCheckAt: createdAt, sourceDate: "合成時間，非官方發布日期",
      validUntil: null, applicabilityLabel: "香港；年齡及條件限制由正式引用提供。本樣本並不適用於真實建議。", internalOnly: true, url: null })),
  };
}

import type { AgentProposal, ProductAgentResult } from "../../../src/shared/product-agent.ts";
import type { KnowledgeEvidence } from "../../../src/shared/knowledge.ts";
import type { AgentProposalView, AgentRunView } from "../agent-view-model.ts";
import type { ChatCitationView } from "../chat-view-model.ts";

const stopReasons: Record<string, string> = {
  cancelled: "已取消", deadline: "處理時間已到上限", model_limit: "AI 調用次數已到上限", tool_limit: "工具調用次數已到上限",
  embedding_limit: "知識查詢次數已到上限", input_limit: "輸入長度已到上限", unauthorized: "存取權已改變",
  quota_exceeded: "用量已到上限", unavailable: "服務暫時未能使用", invalid_response: "未能確認 AI 回覆",
  invalid_tool: "工具要求未能通過核對", tool_unknown: "工具結果未能確認", interrupted: "處理中斷，沒有自動重新執行",
};
const toolNames: Record<string, string> = {
  stage_private_summary: "整理私有輔助摘要", read_context: "讀取已確認記憶及任務", search_knowledge: "檢索知識來源",
  propose_task: "保存建立任務候選", propose_task_change: "保存任務變更候選", propose_fact: "保存記憶候選", present_answer: "整理回覆及引用",
  read_private_instructions: "讀取本人普通交代", execute_ordinary_instruction: "執行已授權的本人普通交代",
  save_ordinary_record: "保存普通照護記錄", save_private_instruction: "保存本人私人備註", revise_private_instruction: "更正本人私人備註",
  create_ordinary_reminder: "安排本人普通提醒", change_ordinary_reminder: "更新本人普通提醒",
  read_contact_options: "讀取已授權聯絡選項", contact_caregiver: "記錄已授權聯絡請求", read_growth_concerns: "讀取成長關注",
};
const taskActions = { reschedule: "改期／轉派", complete: "記錄完成", cancel: "取消", resolve: "覆核終態" };
export function projectAgentCitation(source: KnowledgeEvidence): ChatCitationView {
  const age = source.applicability;
  return {
    id: source.chunkId, title: source.title, section: source.section, publisher: source.publisher, excerpt: source.sourceExcerpt,
    classification: source.classification, versionId: source.versionId, versionHash: source.versionHash,
    checkedAt: source.checkedAt, fetchedAt: source.fetchedAt, lastSuccessfulCheckAt: source.lastSuccessfulCheckAt ?? null,
    sourceDate: [source.sourceDateText, source.sourcePublishedAt ? `發布：${source.sourcePublishedAt}` : null,
      source.sourceUpdatedAt ? `更新：${source.sourceUpdatedAt}` : null].filter(Boolean).join("；") || null,
    validUntil: source.validUntil ?? null, internalOnly: source.usageScope === "internal_noncommercial", url: source.url,
    applicabilityLabel: [age.region, age.ageBasis === "any" ? "不限年齡基準" : age.ageBasis === "corrected" ? "矯正月齡" : "實際月齡",
      age.minAgeMonths === null ? "沒有最低月齡" : `最低 ${age.minAgeMonths} 個月`,
      age.maxAgeMonths === null ? "沒有最高月齡" : `${age.maxAgeMonthsExclusive ? "少於" : "最高"} ${age.maxAgeMonths} 個月`,
      ...age.topics, ...age.conditions].join(" · "),
  };
}
export function projectAgentProposal(proposal: AgentProposal): AgentProposalView {
  const value = proposal.value;
  const common = { id: proposal.id, version: proposal.version, status: proposal.status, kind: value.kind,
    createdAt: proposal.createdAt, expiresAt: proposal.expiresAt,
    result: proposal.result ? { kind: proposal.result.kind, version: proposal.result.version,
      label: `${proposal.result.kind === "task" ? "任務" : "確認記憶"} · ${proposal.result.id}` } : null };
  if (value.kind === "task_create") return { ...common, scope: "family", title: value.values.title, content: value.values.details || "沒有詳細內容",
    details: [{ label: "種類", value: value.values.kind === "ordinary" ? "普通任務" : "預約" },
      { label: "負責人", value: proposal.targetLabel ?? "未能確認對象" }, { label: "負責人識別", value: value.values.assigneeUserId },
      { label: "到期時間", value: value.values.dueAt }, { label: "時區", value: value.values.timeZone }] };
  if (value.kind === "task_change") {
    const change = value.change;
    return { ...common, scope: "family", title: proposal.targetLabel ?? "未能確認任務及對象", content: change.note || "沒有備註",
      details: [{ label: "操作", value: taskActions[change.action] }, { label: "原任務", value: value.taskId },
        { label: "原任務版本", value: String(change.expectedVersion) },
        ...(change.action === "reschedule" ? [{ label: "新到期時間", value: change.dueAt }, { label: "時區", value: change.timeZone },
          { label: "新負責人識別", value: change.assigneeUserId }] : []),
        ...(change.action === "resolve" ? [{ label: "覆核為", value: change.outcome === "completed" ? "已完成" : "已取消" }] : [])] };
  }
  return { ...common, scope: value.intendedVisibility, title: value.key, content: value.content,
    details: [{ label: "來源", value: "你在這次聊天提供的內容，需由你核對" },
      { label: "接受後可見範圍", value: value.intendedVisibility === "family" ? "家庭共享" : "只限你本人" },
      { label: "有效至", value: value.validUntil ?? "未設定" }] };
}
export function projectAgentRun(result: ProductAgentResult, childId: string, createdAt: string | null): AgentRunView {
  return { id: result.runId, childId, status: result.status, createdAt, text: result.text,
    stopReasonLabel: result.stopReason ? stopReasons[result.stopReason] ?? "未能確認停止原因" : null,
    counts: result.countsKnown === false ? null : result.counts, retrievalMode: result.retrievalMode,
    tools: result.tools.map((tool, index) => ({ id: `${result.runId}:${index}`, nameLabel: toolNames[tool.name] ?? "其他工具",
      status: tool.status, savesCandidate: ["propose_task", "propose_task_change", "propose_fact"].includes(tool.name) })),
    proposals: result.proposals.map(projectAgentProposal), citations: result.citations.map(projectAgentCitation) };
}

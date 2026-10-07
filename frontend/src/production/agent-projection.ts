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
  load_capabilities: "載入相關能力", read_work: "讀取未完成工作", save_work: "保存工作進度",
  search_history: "搜尋已授權歷史", read_history: "閱讀歷史原文", read_memory_facts: "讀取記憶事實及版本",
  propose_fact_revision: "提出事實更正", propose_fact_deactivation: "提出事實停用", request_confirmation: "準備具體確認", confirmed_proposal: "已按本人確認保存",
  read_concerns:"讀取持續關注",propose_concern:"保存持續關注候選",propose_concern_change:"保存關注變更候選",
  list_private_sources:"讀取本人來源清單",read_private_source:"讀取獲授權的私人原文",propose_private_source:"保存私人來源候選",propose_private_source_change:"保存來源修改候選",
  stage_private_summary: "整理私有輔助摘要", read_context: "讀取已確認記憶及任務", search_knowledge: "檢索知識來源",
  propose_task: "保存建立任務候選", propose_task_change: "保存任務變更候選", propose_fact: "保存記憶候選", present_answer: "整理回覆及引用",
  read_family_documents: "讀取家庭文件", generate_family_document: "整理及保存家庭文件", change_family_document: "更新家庭文件",
  read_private_instructions: "讀取本人普通交代", execute_ordinary_instruction: "執行已授權的本人普通交代",
  save_ordinary_record: "保存普通照護記錄", revise_ordinary_record: "更正普通照護記錄", read_care_records: "讀取照護記錄及原版本", save_private_instruction: "保存本人私人備註", revise_private_instruction: "更正本人私人備註",
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
      label: `${proposal.result.kind === "task" ? "任務" : proposal.result.kind==="concern"?"持續關注":proposal.result.kind==="private_source"?"私人來源":"確認記憶"} · ${proposal.result.id}` } : null };
  if (value.kind === "memory_fact_revise" || value.kind === "memory_fact_deactivate") {
    if (!proposal.targetVisibility) throw new Error("Missing fact proposal visibility");
    return { ...common, scope: proposal.targetVisibility, title: proposal.targetLabel ?? "原記憶事實",
      content: value.kind === "memory_fact_revise" ? value.content : "停用這項事實；保留更正歷史，不代表永久刪除。",
      details: [{ label: "操作", value: value.kind === "memory_fact_revise" ? "更正原事實" : "停用原事實" },
        { label: "原事實與版本", value: value.factId + " · " + value.expectedVersion },
        ...(value.kind === "memory_fact_revise" ? [{ label: "更新後名稱", value: value.key },
          { label: "有效至", value: value.validUntil ?? "未設期限" },
          { label: "本人原話參照", value: value.sourceMessageId }] : []),
        { label: "原因", value: value.reason },
        { label: "範圍", value: proposal.targetVisibility === "family" ? "更新原孩子共用事實，不分享私人聊天原文" : "只更新本人可見事實" }] };
  }
  if(value.kind==="concern_create") return {...common,scope:"family",title:value.values.title,content:value.values.reason,
    details:[{label:"將共享的觀察",value:value.values.observation},{label:"觀察時間",value:value.values.observedAt},
      {label:"一次站內跟進",value:value.values.followUpAt??"未安排；不自動發通知"},
      {label:"關聯",value:Object.entries(value.values.links).filter(([,id])=>id).map(([kind,id])=>kind+": "+id).join(" · ")||"沒有關聯記錄"},
      {label:"邊界",value:"接受後加入家庭共享持續關注；觀察不是診斷或已確認健康事實。跟進只回站內，不自動外發。"}]};
  if(value.kind==="concern_change") {
    const change=value.change, label={append:"追加共享觀察",archive:"結束關注",restore:"恢復關注",schedule_followup:"調整站內跟進"}[change.action];
    return {...common,scope:"family",title:proposal.targetLabel??"持續關注",content:label,details:[
      {label:"原關注與版本",value:value.concernId+" · "+change.expectedVersion},
      ...(change.action==="append"?[{label:"將共享的觀察",value:change.text},{label:"觀察時間",value:change.observedAt},
        {label:"關聯",value:Object.entries(change.links).filter(([,id])=>id).map(([kind,id])=>kind+": "+id).join(" · ")||"沒有關聯記錄"}]:[]),
      ...(change.action==="schedule_followup"?[{label:"一次站內跟進",value:change.followUpAt??"取消尚未觸發的跟進"}]:[]),
      {label:"邊界",value:"結束關注不代表照護完成，也不取消相關任務；恢復不重新啟動舊跟進。不會自動外發通知。"}]};
  }
  if(value.kind==="private_source_create"||value.kind==="private_source_change") {
    const management=value.kind==="private_source_create"?value.management:value.change.management;
    const content=value.kind==="private_source_create"?value.input:value.change.content;
    return {...common,scope:"private",title:proposal.targetLabel??"私人來源設定",content:management.intention||"核對私人來源用途與讀取範圍",
      details:[{label:"操作",value:value.kind==="private_source_create"?"保存新的私人來源":management.enabled?"更新原來源":"停用原來源"},
        ...(value.kind==="private_source_change"?[{label:"來源及原版本",value:`${value.inputId} · ${value.change.expectedVersion}`}]:[]),
        {label:"用途",value:({answer_reference:"回答參考",record_candidate:"待核對記錄",track_topic:"關注話題意向（不自動建立跟進）"})[management.purpose]},
        {label:"適用性聲稱",value:`${management.nature} · ${management.timeScope} · ${management.validityText||"未指定條件"}；不是已核實官方資料`},
        ...(content?[{label:"來源連結",value:content.sourceUrl??"未提供"},{label:"將保存的原文",value:content.text||"只有連結，正文尚未取得"}]:[]),
        {label:"明確授權交模型的片段",value:management.enabled&&management.modelExcerpt?management.modelExcerpt:"未授權；不讀來源正文"},
        {label:"邊界",value:"只供本人，不建立家庭事實、訂閱或外發。修改正文會撤回原模型授權，之後須再次核對。"}]};
  }
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
      status: tool.status, savesCandidate: ["propose_task", "propose_task_change", "propose_fact","propose_private_source","propose_private_source_change","propose_concern","propose_concern_change"].includes(tool.name) })),
    proposals: result.proposals.map(projectAgentProposal), citations: result.citations.map(projectAgentCitation),privateSourceCitations:result.privateSourceCitations };
}

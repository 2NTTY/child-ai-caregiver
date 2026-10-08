export const AGENT_CONFIRMATION_PENDING_TEXT = "已準備待確認事項，所列操作尚未執行。請核對下方確認問題；如仍有其他問題，本輪尚未完成回答。";
export const AGENT_CONFIRMATION_SAVED_TEXT = "已按你確認的事項保存操作結果；本輪後續文字整理未完成。請查看下方實際收據，不需重做已成功的操作。";

/* Trusted product tool instructions, maintained by the primary model. */
export const AGENT_WORK_TOOL_DESCRIPTIONS = {
  "read_work": "讀取本人／目前孩子的持久工作，可按工作 ID 或游標續讀。這是未完成目標、焦點、問題及引用，不是已確認事實或新的任務副本。狀態與資源版本要核對；未讀完須沿 cursor 續讀。",
  "read_background_result": "按 read_work.latestFollowUp 或已知本人 runId 分段讀回既有 Agent 結果、真實工具狀態及當時引用參照；這是歷史回報，不是新同意或目前仍適用的知識證據。需要新建議必須重新核對来源；若 running／unknown 只核對原 run，不另建執行。nextOffset 仍有未讀，budgetLimited 時保存限制，不空轉。",
  "save_work": "保存或更新本人／目前孩子的一項工作目標、目前焦點、待答問題及來源引用；提問前先保存等待內容。使用既有 workId／expectedVersion 更新同一工作，不每輪新建。工作 completed 只表示這段整理結束，不代表照護任務完成；實際成果須核對原收據。取消或改口時更新原工作，勿讓舊理解繼續執行。有實際接續價值才設 followUp：watchResources 只看本工作引用，knowledgeSourceIds 只用已讀適用官方來源，dueAt 只用有依據時間、不捏造日期。只產生本人站內回饋，沒有外部提醒或寫入授權。followUp 省略／null 或工作結束會停止新跟進；需要保留時明確帶回已讀條件。",
  "search_history": "在本人／孩子授權範圍搜尋歷史原訊息、普通交代或事實。加密正文採有界掃描，結果標明完整度及續讀位置；一頁未命中不代表不存在。命中僅為歷史定位，不表示事實目前有效；memory_fact 命中須再用 read_memory_facts 核對 status／applicable／來源。保留 role、版本與精度，AI 原文不是使用者事實。公共 RAG 與私人歷史分開。",
  "read_history": "按歷史搜尋回傳的訊息 ID、offset 及範圍讀取原文，可續讀長訊息。只引用實際已讀字句；使用者原話可以作來源，模型回覆及摘要不能作同意或確定事實。",
  "read_memory_facts": "分頁讀取可見的孩子記憶事實及目前 version、有效性與來源；更正或停用前讀回原項，不能只憑摘要猜 ID。私人資料不因讀取而得到共享授權。",
  "propose_fact_revision": "就已讀回的事實提出更正候選，指定 factId／expectedVersion、原文來源及理由。沿原記憶保留歷史，重要健康事實仍待本人明確確認，不自行升格推測或扩大可見範圍。",
  "propose_fact_deactivation": "提出停用某項已讀回事實的候選，指定 factId／expectedVersion 及原因。停用保留歷史，仍待本人明確確認；不是永久刪除或停用其他相似事實。",
  "request_confirmation": "為一項現有候選請求具體對話確認。指定原 runId、proposalId 及 version，Server 綁定操作、目標、授權與期限並提供完整問題；你不能把 confirmed:true 當成同意。不要一次請家長用一句好確認多個候選。用具名入口或重新列明處理歧義／失效；外發與永久刪除不可藉此擴權。"
} as const;

/** Full-message consent is a safety precondition, never a tool capability router. */
export const AGENT_EXPLICIT_CONSENT_TEXTS = ["好", "好的", "確認", "確認執行", "同意", "是", "可以", "確認上述事項", "confirm", "yes"] as const;
export function isExplicitAgentConsent(text: string): boolean {
  const normalized = text.normalize("NFKC").trim().toLowerCase().replace(/[。.!！]$/u, "");
  return (AGENT_EXPLICIT_CONSENT_TEXTS as readonly string[]).includes(normalized);
}

const operationNames: Record<string, string> = {
  task_create: "建立待辦", task_change: "更改待辦", memory_fact: "保存已確認事實",
  memory_fact_revise: "更正已有事實", memory_fact_deactivate: "停用已有事實",
  concern_create: "建立持續關注", concern_change: "更改持續關注",
  family_document_change: "修改同一份文件", private_source_create: "建立私人來源", private_source_change: "更改私人來源",
};
const fieldNames: Record<string, string> = {
  title: "標題", details: "內容", kind: "種類", dueAt: "時間", timeZone: "時區", note: "備註",
  action: "動作", outcome: "處理結果", key: "事實名稱", content: "內容", reason: "原因",
  validUntil: "有效至", intendedVisibility: "保存範圍", text: "正文", values: "資料",
  change: "更改", input: "來源", management: "使用設定", source: "依據", description: "說明",
  sourceLabel: "來源名稱", sourceUrl: "來源連結", sourceDateText: "原標示日期", sourceNotes: "來源備註",
  intention: "使用意向", purpose: "用途", nature: "資料性質", timeScope: "時間範圍",
  validityText: "適用條件", enabled: "啟用", modelExcerpt: "允許交給模型的片段",
  observation: "觀察內容", observedAt: "觀察時間", links: "相關資料", followUpAt: "跟進時間",
  factId: "原事實參照", taskId: "原待辦參照", concernId: "原關注參照", inputId: "原来源參照",
  documentId: "原文件參照", edits: "逐項修改", sectionId: "章節參照", itemId: "項目參照", beforeId: "放在此項之前", summary: "摘要", eventDate: "事情日期", sourceIds: "共享來源參照", recordId: "記錄參照", attentionId: "成長關注參照", sourceMessageId: "本人原話參照",
  messageId: "原話參照", sourceQuote: "本人原話", expectedVersion: "核對版本",
  authorityVersion: "資料版本", assigneeUserId: "負責人參照",
};
const valueNames: Record<string, string> = {
  ordinary: "普通事項", appointment: "預約", private: "只供本人", family: "孩子共用資料",
  reschedule: "改期", complete: "標記已完成", cancel: "取消", resolve: "處理衝突",
  completed: "已完成", cancelled: "已取消", append: "追加觀察", archive: "結束並歸檔",
  patch: "局部修改", upsert_section: "新增／修改章節", remove_section: "移除章節", move_section: "移動章節", upsert_item: "新增／修改項目", remove_item: "移除項目", move_item: "移動項目", set_metadata: "修改文件資料", restore: "恢復", schedule_followup: "更改跟進時間", personal_source: "私人來源",
  private_chat: "本人對話", care_record: "照護記錄", manual: "本人核對",
  answer_reference: "回答參考", record_candidate: "記錄候選", track_topic: "持續關注",
  unspecified: "未指定", external_material: "外部材料", claimed_official: "自稱官方材料（未核實）",
  personal_observation: "個人觀察", long_reference: "長期參考", recent: "近期", specific_period: "指定期間",
};
/** Render every proposal value without asking the model to restate the operation. */
export function buildAgentConfirmationQuestion(
  proposal: { value: unknown; targetLabel: string | null },
  shared: boolean,
  childLabel?: string,
): string {
  if (!proposal.value || typeof proposal.value !== "object" || Array.isArray(proposal.value)) throw new Error("Invalid confirmation value");
  const value = proposal.value as Record<string, unknown>;
  const operation = operationNames[String(value.kind)];
  if (!operation) throw new Error("Unsupported confirmation kind");
  const lines: string[] = [];
  const walk = (item: unknown, prefix: string) => {
    if (item && typeof item === "object") {
      for (const [key, child] of Object.entries(item)) {
        if (key === "confirm" || key === "confirmShared" || key === "kind" && !prefix) continue;
        walk(child, prefix ? prefix + "／" + (fieldNames[key] ?? key) : fieldNames[key] ?? key);
      }
    } else {
      const shown = item === null ? "未指定／保持空白" : item === true ? "是" : item === false ? "否" :
        typeof item === "string" ? valueNames[item] ?? item : String(item);
      lines.push(prefix + "：「" + shown + "」");
    }
  };
  walk(value, "");
  return "目前孩子：" + (childLabel ?? "本次選取的孩子") + "。\n請確認這一項操作：" + operation + (proposal.targetLabel ? "（" + proposal.targetLabel + "）" : "") + "。\n"
    + lines.join("\n") + "\n保存範圍：" + (shared ? "目前孩子的共用資料；其他有權照顧者可查看這份整理，私人聊天原文不會分享。" : "只供本人，不新增分享授權。")
    + "\n以上只確認所列操作，不代表授權額外通知或其他變更。若全部正確，請在下一則訊息只回覆「確認」；需要修改或不確定請直接說明，尚未執行。";
}

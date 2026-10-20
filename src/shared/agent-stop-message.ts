const modelProviderReasons = {
  model_http_400: "模型服務拒絕請求格式（400）",
  model_http_401: "模型服務認證失敗（401）",
  model_http_403: "模型服務拒絕存取（403）",
  model_http_404: "模型服務找不到所需模型或資源（404）",
  model_http_408: "模型服務回覆逾時（408）",
  model_http_429: "模型供應商限制請求（429）",
  model_http_500: "模型服務發生內部錯誤（500）",
  model_http_502: "模型服務閘道異常（502）",
  model_http_503: "模型服務暫時無法提供（503）",
  model_http_504: "模型服務回覆逾時（504）",
} as const;
export type ModelProviderStopReason = keyof typeof modelProviderReasons;
/** Call only with a trusted SDK status; never accept provider text or arbitrary exception properties. */
export function modelProviderStopReason(status: number): ModelProviderStopReason | "unavailable" {
  const reason = `model_http_${status}`;
  return Object.hasOwn(modelProviderReasons, reason) ? reason as ModelProviderStopReason : "unavailable";
}

const stopReasons: Record<string, string> = {
  ...modelProviderReasons,
  cancelled: "已取消", deadline: "處理時間已到上限", model_limit: "這次處理的 AI 調用次數已達上限", tool_limit: "工具調用次數已到上限",
  embedding_limit: "知識查詢次數已到上限", input_limit: "輸入長度已到上限", unauthorized: "存取權已改變",
  quota_exceeded: "今日 AI 用量已達上限", unavailable: "服務暫時未能使用", invalid_response: "未能確認 AI 回覆",
  delivery_review_incomplete: "尚未通過獨立核對，未成為正式回覆",
  invalid_tool: "工具要求未能通過核對", tool_unknown: "工具結果未能確認", interrupted: "處理中斷，沒有自動重新執行",
};
/** Product copy only: never expose raw provider errors, arguments or private diagnostic text. */
export function agentStopMessage(reason: string | null): string | null {
  return reason ? Object.hasOwn(stopReasons, reason) ? stopReasons[reason] : "未能確認停止原因" : null;
}

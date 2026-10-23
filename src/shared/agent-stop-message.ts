const modelProviderReasons = {
  model_endpoint_invalid: "API 地址未能通過公開 HTTPS 檢查，請核對供應商地址",
  model_endpoint_redirected: "API 地址要求重新導向；為免把密鑰送往其他地址，請填寫供應商的最終 API 地址",
  model_network_error: "未能連接所填的模型 API 地址，請核對地址、DNS 及連線",
  model_provider_quota: "模型供應商回報額度或餘額不足，請查看該服務的用量及付款設定",
  model_provider_rate_limit: "模型供應商回報請求過密（429），請稍後再試",
  model_tools_unsupported: "模型供應商不接受工具呼叫；請選擇支援工具的模型",
  model_input_unsupported: "目前模型接口不支援這種圖片或音訊輸入，請改用文字或另一模型",
  model_context_exceeded: "模型供應商回報內容超出該模型的上下文容量",
  model_output_limit: "模型回覆達到本次輸出長度上限，未取得完整結果",
  model_provider_rejected: "模型供應商拒絕請求，未取得可用回覆",
  model_response_invalid: "模型 API 回傳的內容不符合 Chat Completions 協定，請核對 API 地址及模型",
  embedding_not_configured: "尚未設定相容的本人向量 key；請另填 Gemini 向量 key，以查詢現有知識索引",
  embedding_key_invalid: "向量服務的 key 無效或已撤銷，請更新本人向量設定",
  embedding_model_unavailable: "向量服務找不到模型或這份憑證不能使用該模型",
  embedding_provider_quota: "向量供應商回報額度或餘額不足",
  embedding_provider_rate_limit: "向量供應商回報請求過密，請稍後再試",
  embedding_region_unavailable: "向量供應商回報目前地區不可用",
  embedding_permission_denied: "向量供應商拒絕這份憑證的存取權限（403）",
  embedding_provider_failed: "向量服務請求失敗，尚未取得可用查詢向量",
  model_key_invalid: "本人模型密鑰無效或已被撤銷，請到模型設定更新",
  model_region_unavailable: "所選模型服務不支援目前地區",
  model_not_available: "模型或 API 路徑不存在，或本人憑證不能使用；請核對模型 ID 及 API 地址",
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
  compose_review_incomplete: "這份編製草稿尚未通過獨立核對，未成為正式保存",
  invalid_tool: "工具要求未能通過核對", tool_unknown: "工具結果未能確認", interrupted: "處理中斷，沒有自動重新執行",
};
/** Product copy only: never expose raw provider errors, arguments or private diagnostic text. */
export function agentStopMessage(reason: string | null): string | null {
  return reason ? Object.hasOwn(stopReasons, reason) ? stopReasons[reason] : "未能確認停止原因" : null;
}

const stopReasons: Record<string, string> = {
  cancelled: "已取消", deadline: "處理時間已到上限", model_limit: "這次處理的 AI 調用次數已達上限", tool_limit: "工具調用次數已到上限",
  embedding_limit: "知識查詢次數已到上限", input_limit: "輸入長度已到上限", unauthorized: "存取權已改變",
  quota_exceeded: "今日 AI 用量已達上限", unavailable: "服務暫時未能使用", invalid_response: "未能確認 AI 回覆",
  invalid_tool: "工具要求未能通過核對", tool_unknown: "工具結果未能確認", interrupted: "處理中斷，沒有自動重新執行",
};
/** Product copy only: never expose provider errors, arguments or private diagnostic text. */
export function agentStopMessage(reason: string | null): string | null {
  return reason ? Object.hasOwn(stopReasons, reason) ? stopReasons[reason] : "未能確認停止原因" : null;
}

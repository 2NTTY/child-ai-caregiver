import { calendarDate } from "../date-time.ts";

export const historyCategories = [
  { key: "tasks", label: "待辦與預約", description: "已完成及已取消的安排", sourceLabel: "待辦與預約", sourcePath: "/tasks", sourceAction: "開啟待辦", unavailable: "" },
  { key: "preparations", label: "準備單", description: "使用後歸檔的文件與當時版本", sourceLabel: "準備單", sourcePath: "/growth?tab=preparation", sourceAction: "開啟準備單", unavailable: "" },
  { key: "review", label: "核對記錄", description: "寫入結果與家長確認分開查看", sourceLabel: "核對", sourcePath: "/care", sourceAction: "開啟核對", unavailable: "" },
  { key: "care", label: "照顧記錄", description: "已保存記錄、更正與原始來源", sourceLabel: "核對", sourcePath: "/care", sourceAction: "開啟核對", unavailable: "" },
  { key: "profile", label: "檔案修改", description: "孩子檔案的確認及更正版本", sourceLabel: "孩子檔案", sourcePath: "/profile", sourceAction: "查看檔案", unavailable: "" },
  { key: "conversations", label: "助手對話", description: "本人與這位孩子相關的對話", sourceLabel: "助手", sourcePath: "/chat", sourceAction: "開啟助手", unavailable: "請到助手查看已載入的對話。" },
  { key: "growth", label: "關注與成長", description: "查看已結束的關注與跟進記錄", sourceLabel: "關注鏈", sourcePath: "/growth", sourceAction: "開啟關注鏈", unavailable: "" },
  { key: "notifications", label: "消息歷史", description: "已保存的本人消息內容", sourceLabel: "本人消息", sourcePath: "/history?category=notifications", sourceAction: "查看消息歷史", unavailable: "消息內容暫未提供。" },
] as const;

export type HistoryCategory = typeof historyCategories[number]["key"];
export type HistoryFilters = { scope: string; category: HistoryCategory; searchText: string; from: string; to: string };
export type HistoryFilterAction =
  | { type: "category"; value: HistoryCategory }
  | { type: "search" | "from" | "to"; value: string }
  | { type: "dates"; from: string; to: string }
  | { type: "reset" }
  | { type: "scope"; scope: string; category: HistoryCategory };

export function normalizeHistoryCategory(value: string | string[] | undefined): HistoryCategory {
  const candidate = typeof value === "string" ? value : undefined;
  return historyCategories.find(item => item.key === candidate)?.key ?? "tasks";
}

export function normalizeReviewHistoryStatus(value: string | string[] | undefined): "all" | "pending" | "written" | "confirmed" | "skipped" {
  const candidate = typeof value === "string" ? value : undefined;
  return candidate === "pending" || candidate === "written" || candidate === "confirmed" || candidate === "skipped" ? candidate : "all";
}

export function normalizeHistoryOlderOnly(value: string | string[] | undefined): boolean {
  return (typeof value === "string" ? value : undefined) === "1";
}

export function createHistoryFilters(scope: string, category: HistoryCategory): HistoryFilters {
  return { scope, category, searchText: "", from: "", to: "" };
}

// Filters are transient presentation state. No history entries or source copies are stored here.
export function historyFilterReducer(state: HistoryFilters, action: HistoryFilterAction): HistoryFilters {
  if (action.type === "scope") return action.scope === state.scope ? state : createHistoryFilters(action.scope, action.category);
  if (action.type === "reset") return createHistoryFilters(state.scope, state.category);
  if (action.type === "category") return { ...state, category: action.value };
  if (action.type === "search") return { ...state, searchText: action.value };
  if (action.type === "dates") return historyDateRange(action.from, action.to) ? { ...state, from: action.from, to: action.to } : state;
  return { ...state, [action.type]: action.value };
}

export function historyDateErrors(from: string, to: string): { from?: string; to?: string } {
  const errors: { from?: string; to?: string } = {};
  if (from && !calendarDate(from)) errors.from = "請填寫有效日期（YYYY-MM-DD）。";
  if (to && !calendarDate(to)) errors.to = "請填寫有效日期（YYYY-MM-DD）。";
  if (!errors.from && !errors.to && from && to && from > to) errors.to = "結束日期不能早於開始日期。";
  return errors;
}

export function historyDateRange(from: string, to: string): { from: string | null; to: string | null } | null {
  if (Object.keys(historyDateErrors(from, to)).length) return null;
  return { from: from || null, to: to || null };
}

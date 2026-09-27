import type { HomeChild, HomeOperation, HomeRecord, HomeViewModel, OperationState } from "../view-model";

export type PreviewScenario = "normal" | "empty" | "loading" | "offline" | "needs_confirmation" | "saving" | "saved" | "failed" | "unknown";

export const scenarioLabels: Record<PreviewScenario, string> = {
  normal: "一般", empty: "尚無孩子", loading: "讀取中", offline: "離線",
  needs_confirmation: "待確認", saving: "處理中", saved: "已保存", failed: "失敗", unknown: "結果未知",
};

const children: HomeChild[] = [
  { id: "preview-child-1", displayName: "小昕", ageLabel: "約 3 歲 2 個月 · 截至 2026 年 9 月", regionLabel: "香港", profileConfirmed: true },
  { id: "preview-child-2", displayName: "阿樂", ageLabel: "約 8 歲 · 截至 2026 年 9 月", regionLabel: "未提供", profileConfirmed: false },
];

const records: HomeRecord[] = [
  { id: "preview-record-1", childId: "preview-child-1", kind: "sleep", title: "睡眠記錄", detail: "昨晚約 9:20 入睡；早上約 7:00 醒來。", eventTimeLabel: "9 月 25 日晚", confirmedAtLabel: "9 月 26 日" },
  { id: "preview-record-2", childId: "preview-child-1", kind: "measurement", title: "身高記錄", detail: "身高約 95.2 cm；數值由照顧者提供。", eventTimeLabel: "9 月 23 日", confirmedAtLabel: "9 月 24 日" },
  { id: "preview-record-3", childId: "preview-child-1", kind: "note", title: "日常觀察", detail: "下午到公園玩耍後，回家主動分享見聞。", eventTimeLabel: "9 月 22 日", confirmedAtLabel: "9 月 22 日" },
  { id: "preview-record-4", childId: "preview-child-2", kind: "note", title: "課後記錄", detail: "完成畫作後，和家人分享今天的想法。", eventTimeLabel: "9 月 25 日", confirmedAtLabel: "9 月 25 日" },
];

const operationCopy: Record<OperationState, HomeOperation> = {
  none: { state: "none", title: "把值得記下的日常留在一個地方", detail: "你可以先看看最近已確認的記錄，再決定有沒有新事情需要補充。" },
  needs_confirmation: { state: "needs_confirmation", title: "有一項內容等你確認", detail: "候選內容還未保存為共享記錄。請核對原文、數值和時間後，再決定是否確認。" },
  saving: { state: "saving", title: "正在提交原操作", detail: "請稍候；這個畫面不能因網絡可用，就自行宣稱資料已保存。" },
  saved: { state: "saved", title: "原操作已確認保存", detail: "Server 收據已確認後才可以顯示此狀態；預覽只示意相應版式。" },
  failed: { state: "failed", title: "原操作確定未成功", detail: "保留輸入，返回原操作核對原因後，再由照顧者決定是否重試。" },
  unknown: { state: "unknown", title: "提交結果尚未確認", detail: "先按原操作 ID 查核結果，不要因為等候逾時，就重新建立同一筆記錄。" },
};

export function createPreviewModel(scenario: PreviewScenario, selectedChildId: string): HomeViewModel {
  const isEmpty = scenario === "empty";
  return {
    caregiverName: "媽媽",
    children: isEmpty ? [] : children,
    selectedChildId: isEmpty ? null : selectedChildId,
    connection: scenario === "offline" ? "offline" : "online",
    recordsLoad: scenario === "loading" ? "loading" : "ready",
    records: scenario === "loading" ? [] : records,
    lastReadLabel: scenario === "loading" ? null : "2026 年 9 月 26 日 10:24",
    operation: operationCopy[scenario in operationCopy ? scenario as OperationState : "none"],
  };
}

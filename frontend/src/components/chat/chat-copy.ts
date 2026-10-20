/** Product copy for chat sources, phases, and empty / degraded states. */
export const CHAT_SOURCE_COPY = {
  footerTitle: "參考來源",
  degradedWarning: "檢索已降級；請核對原來源及適用範圍。",
  emptySources: "本次沒有可核對的來源片段。",
  returnToCitation: "返回引用句",
  hintMoreSources: "查看更多來源",
  tabAccessibilityLabel: "回答參考來源",
  quoteGroupTitle: "引用內容",
  datesGroupTitle: "日期與適用範圍",
  sourceDate: "來源日期",
  validUntil: "有效至",
  applicability: "原適用範圍",
  internalOnly: "內部限定",
  internalYes: "是",
  internalNo: "否",
  snapshotDisclaimer: "引用沿用回答當時的來源快照；請核對日期及適用範圍。",
  openSource: "開啟原來源",
  noOpenableUrl: "沒有可開啟的真實來源連結。",
  technicalToggle: "版本與核對資料",
  technicalOpenPrefix: "查看",
  technicalClosePrefix: "收起",
  versionId: "原來源版本",
  versionHash: "原來源版本校驗",
  checkedAt: "核對時間",
  fetchedAt: "擷取時間",
  lastSuccessfulCheckAt: "最後成功核對",
  missingTime: "未提供",
  invalidTime: "時間資料無效，請重新讀取",
  hongKongTimeSuffix: "（香港時間）",
  syntheticNotice: "此來源只展示引用版式，沒有真實來源證據。",
  section: "章節",
} as const;

export const CHAT_CLASSIFICATION_LABELS = {
  official_guidance: "官方指引",
  recent_information: "近期資訊",
  synthetic: "合成來源示例",
} as const;

export const CHAT_PHASE_LABELS = {
  thinking: "思考中",
  streaming: "正在回覆",
  complete: "回覆已結束",
  stopped: "已停止 · 回覆未完成",
  failed: "回覆失敗",
  unknown: "結果未知 · 待查核",
  awaiting_confirmation: "等候你的確認",
} as const;

export const CHAT_ACTIVITY_LABELS = {
  running: "處理中",
  succeeded: "已回報",
  failed: "失敗",
  unknown: "未知",
  pending: "待確認",
} as const;

export const CHAT_MESSAGE_COPY = {
  stopReply: "停止回覆",
  checkOriginal: "查核原回覆",
  processToggle: "執行過程",
  processPendingNote: " · 有結果待核對",
  runningPhaseOverride: "運行仍在處理",
} as const;

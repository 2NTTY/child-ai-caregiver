/** Product copy for chat sources, phases, and empty / degraded states. */
export const CHAT_SOURCE_COPY = {
  footerTitle: "參考來源",
  degradedWarning: "檢索已降級；請核對原來源及適用範圍。",
  emptySources: "這則回覆沒有引用知識庫資料。",
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

export const CHAT_LIVE_ACQUISITION_BADGE = "即時搜尋";

export const CHAT_LIVE_SOURCE_KIND_LABELS = {
  official_page: "官方頁面",
  community_discussion: "社群經驗",
  product_spec: "商品資料",
  service_info: "服務資訊",
  public_news: "近期事件",
} as const;

export const CHAT_LIVE_CAUTION_LABELS = {
  self_reported_unverified: "論壇／社群發言屬使用者自述，未經獨立核實，不代表整體意見或已驗證購買經驗。",
  suspected_promotional: "原文含疑似廣告、贊助或推廣線索，請審慎評估。",
  stale_source: "來源日期較舊，請配合近期官方及商品資訊核對。",
  conflicting_claims: "本次檢索到的不同來源在經驗、型號版本或價格上存在差異或矛盾。",
  partial_read: "僅讀取到頁面部分相關段落；如需完整條件或最新資訊，請點擊開啟原網站核對。",
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

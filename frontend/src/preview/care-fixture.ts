import { emptyCareForm, type CareCaptureReview, type CareFormValues, type CareRecordView, type CareRevisionView, type CareReviewSourceContext } from "../care-view-model.ts";

function revision(version: number, values: Partial<CareFormValues>, confirmedAtLabel: string): CareRevisionView {
  return {
    version, values: { ...emptyCareForm(), ...values },
    eventTimePrecision: values.eventTimeRaw ? "approximate" : "unknown",
    timeZoneLabel: "Asia/Hong_Kong", confirmedByLabel: "媽媽（合成）", confirmedAtLabel,
  };
}

function createPriorConsentRecords(childId: string): CareRecordView[] {
  if (!["preview-child-1", "preview-child-2"].includes(childId)) return [];
  if (childId === "preview-child-2") return [{
    id: "preview-care-school", childId, title: "課後觀察", createdAtLabel: "2026 年 9 月 25 日 下午 5:10",
    current: revision(1, { text: "完成畫作後，和家人分享今天的想法。", source: "爸爸放學後的觀察（合成）", eventTimeRaw: "9 月 25 日放學後" }, "2026 年 9 月 25 日 下午 5:10"), history: [],
  }];

  return [
    {
      id: "preview-care-sleep", childId, title: "睡眠記錄", createdAtLabel: "2026 年 9 月 26 日 上午 8:15",
      current: revision(3, { kind: "sleep", text: "昨晚約 9:20 入睡，早上約 7:00 醒來。中途短暫醒過一次。", source: "媽媽的睡眠觀察（合成）", eventTimeRaw: "9 月 25 日晚至 26 日早上", reason: "補充夜間醒來的觀察，保留時間約數。" }, "2026 年 9 月 28 日 上午 9:10"),
      history: [
        revision(2, { kind: "sleep", text: "昨晚約 9:20 入睡，早上約 7:00 醒來。", source: "媽媽的睡眠觀察（合成）", eventTimeRaw: "9 月 25 日晚至 26 日早上", reason: "核對早上醒來時間。" }, "2026 年 9 月 27 日 上午 9:00"),
        revision(1, { kind: "sleep", text: "昨晚大約九點多入睡，早上七點左右醒來。", source: "媽媽的睡眠觀察（合成）", eventTimeRaw: "昨晚至今早", reason: "首次確認" }, "2026 年 9 月 26 日 上午 8:15"),
      ],
    },
    {
      id: "preview-care-temperature", childId, title: "體溫記錄", createdAtLabel: "2026 年 9 月 25 日 下午 6:05",
      current: revision(1, { kind: "temperature", text: "晚飯前量度體溫。", source: "爸爸用探熱器量度（合成）", quantityRaw: "36.7", quantityUnit: "°C", quantityPrecision: "exact", eventTimeRaw: "9 月 25 日晚飯前", reason: "首次確認" }, "2026 年 9 月 25 日 下午 6:05"), history: [],
    },
    {
      id: "preview-care-height", childId, title: "身高記錄", createdAtLabel: "2026 年 9 月 24 日 上午 10:30",
      current: revision(1, { kind: "measurement", text: "在家量度身高，孩子站立時仍有少許移動。", source: "照顧者在家量度（合成）", quantityRaw: "95.2 左右", quantityUnit: "cm", eventTimeRaw: "9 月 23 日上午", reason: "首次確認" }, "2026 年 9 月 24 日 上午 10:30"), history: [],
    },
    {
      id: "preview-care-park", childId, title: "公園觀察", createdAtLabel: "2026 年 9 月 22 日 下午 5:20",
      current: revision(1, { text: "下午到公園玩耍後，回家主動分享見聞。", source: "媽媽陪伴時的觀察（合成）", eventTimeRaw: "9 月 22 日下午", reason: "首次確認" }, "2026 年 9 月 22 日 下午 5:20"), history: [],
    },
    {
      id: "preview-care-food", childId, title: "飲食記錄", createdAtLabel: "2026 年 9 月 21 日 下午 7:10",
      current: revision(1, { kind: "feeding", text: "晚飯吃了飯、菜及魚，份量由照顧者描述。", source: "爸爸晚飯時的觀察（合成）", quantityRaw: "約半碗", quantityUnit: "飯", eventTimeRaw: "9 月 21 日晚飯", reason: "首次確認" }, "2026 年 9 月 21 日 下午 7:10"), history: [],
    },
    {
      id: "preview-care-appointment", childId, title: "預約資料", createdAtLabel: "2026 年 9 月 20 日 上午 11:00",
      current: revision(1, { kind: "appointment", text: "家人記下下次例行檢查的安排；這筆記錄不代表機構已確認預約。", source: "家人的行程筆記（合成）", eventTimeRaw: "下個月，具體日期待核對", reason: "首次確認" }, "2026 年 9 月 20 日 上午 11:00"), history: [],
    },
  ];
}

// Explicit synthetic chat batches. These IDs are not formal conversation IDs.
function reviewSource(batchId: string, conversationLabel: string, date: string, dateLabel: string, message: string): CareReviewSourceContext {
  return { batchId: `preview-batch:${batchId}`, conversationLabel, occurredAt: date, dateLabel,
    messageId: `preview-message:${message}`, runId: `preview-run:${message}` };
}

// Deliberately selected, synthetic lasting observations; not a queue of every chat message.
function createPriorConsentCaptures(childId: string): CareCaptureReview[] {
  if (!["preview-child-1", "preview-child-2"].includes(childId)) return [];
  if (childId === "preview-child-2") return [{
    id: `preview-capture:${childId}:routine`, version: 1, writeState: "not_saved", reviewRequirement: "prewrite", reviewState: "pending", childId, title: "放學後的休息安排", createdAtLabel: "2026 年 10 月 5 日 下午 4:10（合成）",
    sourceContext: reviewSource("after-school", "放學後的安排", "2026-10-05T08:10:00Z", "2026 年 10 月 5 日 下午 4:10", "after-school"),
    originalText: "呢個星期放學之後，先休息二十分鐘再做功課會順啲。幫我留返呢個安排。",
    sourceLabel: "家長在對話中提出的安排（合成）", sourceId: "preview-source:after-school", sourceVersion: "source-v1", sourceScope: "private", sourceState: "ready",
    proposedValues: { ...emptyCareForm(), text: "本週放學後先休息約二十分鐘，再開始功課。", source: "家長提供的照顧安排（合成）", eventTimeRaw: "本週放學後" },
    target: { kind: "create", scope: "family" }, purpose: "家長明確要求留下的照顧安排。", uncertainties: ["「本週」仍保留原時間說法，未推算確實日期。"],
  }];
  return [
    {
      id: `preview-capture:${childId}:important-appointment`, version: 1, writeState: "saved", reviewRequirement: "required", reviewState: "pending", childId, title: "例行檢查安排是否已確認", createdAtLabel: "2026 年 10 月 4 日 晚上 9:15（合成）",
      sourceContext: reviewSource("checkup-plan", "例行檢查的安排", "2026-10-04T13:15:00Z", "2026 年 10 月 4 日 晚上 9:15", "checkup-plan"),
      originalText: "下個月例行檢查，具體日期我未核實。先記低，但唔好當成已經預約咗。", sourceLabel: "家長交代的預約狀態（合成）", sourceId: "preview-source:appointment-status", sourceVersion: "source-v1", sourceScope: "private", sourceState: "ready",
      proposedValues: { ...emptyCareForm(), kind: "appointment", text: "家人記下下次例行檢查的安排；這筆記錄不代表機構已確認預約。", source: "家人的行程筆記（合成）", eventTimeRaw: "下個月，具體日期待核對", reason: "首次確認" },
      target: { kind: "create", scope: "family" }, purpose: "預約是否成立會影響後續安排，Agent 指定需要家長明確核對（合成分類）。", uncertainties: ["只確認記錄有沒有理解錯，不代表機構已接受預約，也不會發送訊息或執行醫療行動。"],
      resolution: { label: "已有合成保存結果；家長尚未明確核對此重要記錄。", recordId: "preview-care-appointment", recordVersion: 1 },
    },
    {
      id: `preview-capture:${childId}:temperature-written`, version: 1, writeState: "saved", reviewRequirement: "optional", reviewState: "not_required", childId, title: "已整理的體溫記錄", createdAtLabel: "2026 年 10 月 5 日 上午 8:14（合成）",
      sourceContext: reviewSource("sleep-temperature", "補充睡眠與體溫", "2026-10-05T00:14:00Z", "2026 年 10 月 5 日 上午 8:14", "temperature"),
      originalText: "9 月 25 號晚飯前，爸爸用探熱器量到 36.7 度。", sourceLabel: "家長提供的體溫資料（合成）", sourceId: "preview-source:temperature", sourceVersion: "source-v1", sourceScope: "private", sourceState: "ready",
      proposedValues: { ...emptyCareForm(), kind: "temperature", text: "晚飯前量度體溫。", source: "爸爸用探熱器量度（合成）", quantityRaw: "36.7", quantityUnit: "°C", quantityPrecision: "exact", eventTimeRaw: "9 月 25 日晚飯前", reason: "首次確認" },
      target: { kind: "create", scope: "family" }, uncertainties: [], resolution: { label: "已有合成保存結果；不表示家長已核對理解是否正確。", recordId: "preview-care-temperature", recordVersion: 1 },
    },
    {
      id: `preview-capture:${childId}:sleep-update`, version: 1, writeState: "not_saved", reviewRequirement: "prewrite", reviewState: "pending", childId, title: "補充睡眠記錄", createdAtLabel: "2026 年 10 月 5 日 上午 8:12（合成）",
      sourceContext: reviewSource("sleep-temperature", "補充睡眠與體溫", "2026-10-05T00:12:00Z", "2026 年 10 月 5 日 上午 8:12", "sleep-supplement"),
      originalText: "之前嗰晚中間醒過一次嘅記錄，補返係安撫幾分鐘之後再瞓。時間都係大約。呢段先俾我核對，確認後先更新。",
      sourceLabel: "家長對已有睡眠觀察的補充（合成）", sourceId: "preview-source:sleep-supplement", sourceVersion: "source-v1", sourceScope: "private", sourceState: "ready",
      proposedValues: { ...emptyCareForm(), kind: "sleep", text: "昨晚約 9:20 入睡，早上約 7:00 醒來。中途短暫醒過一次，安撫幾分鐘後再次入睡。", source: "媽媽的睡眠觀察（合成）", eventTimeRaw: "9 月 25 日晚至 26 日早上", reason: "補充夜間醒來後的安撫情況，保留時間約數。" },
      target: { kind: "update", scope: "family", recordId: "preview-care-sleep", expectedVersion: 3 }, purpose: "補全已有觀察，不另建重複的睡眠記錄。",
      duplicateHint: "Agent 已明確關聯到同一晚的睡眠記錄（合成關聯）。", uncertainties: [],
    },
    {
      id: `preview-capture:${childId}:routine`, version: 1, writeState: "not_saved", reviewRequirement: "prewrite", reviewState: "pending", childId, title: "午睡前的固定安排", createdAtLabel: "2026 年 10 月 3 日 下午 1:13（合成）",
      sourceContext: reviewSource("nap-routine", "午睡前的安排", "2026-10-03T05:13:00Z", "2026 年 10 月 3 日 下午 1:13", "nap-routine"),
      originalText: "最近午睡前先睇一本書再拉窗簾，佢會容易安定啲。先幫我整理，我確認之後先加入家庭記錄。",
      sourceLabel: "家長希望保留給照顧者的安排（合成）", sourceId: "preview-source:nap-routine", sourceVersion: "source-v1", sourceScope: "private", sourceState: "ready",
      proposedValues: { ...emptyCareForm(), kind: "note", text: "午睡前先看一本書，再拉上窗簾；家長觀察到孩子較容易安定。", source: "家長提供的午睡安排（合成）", eventTimeRaw: "最近午睡前" },
      target: { kind: "create", scope: "family" }, purpose: "家長明確要求保留，讓家庭照顧安排一致。", uncertainties: ["這是家長的觀察，不能當成必定有效的結論。"],
    },
    {
      id: `preview-capture:${childId}:sleep-written`, version: 1, writeState: "saved", reviewRequirement: "optional", reviewState: "not_required", childId, title: "睡眠記錄的補充", createdAtLabel: "2026 年 9 月 28 日 上午 9:10（合成）",
      sourceContext: reviewSource("earlier-sleep", "補充夜間醒來的觀察", "2026-09-28T01:10:00Z", "2026 年 9 月 28 日 上午 9:10", "sleep-written"),
      originalText: "之前嗰晚大約九點二十分瞓、朝早七點醒嘅記錄，補返中間短暫醒過一次。時間都係大約。",
      sourceLabel: "家長在較早對話中的補充（合成）", sourceId: "preview-source:sleep-written", sourceVersion: "source-v1", sourceScope: "private", sourceState: "ready",
      proposedValues: { ...emptyCareForm(), kind: "sleep", text: "昨晚約 9:20 入睡，早上約 7:00 醒來。中途短暫醒過一次。", source: "媽媽的睡眠觀察（合成）", eventTimeRaw: "9 月 25 日晚至 26 日早上", reason: "補充夜間醒來的觀察，保留時間約數。" },
      target: { kind: "update", scope: "family", recordId: "preview-care-sleep", expectedVersion: 2 }, uncertainties: [],
      resolution: { label: "已有合成保存結果；如有誤解可更正，毋須逐筆確認普通記錄。", recordId: "preview-care-sleep", recordVersion: 3 },
    },
    {
      id: `preview-capture:${childId}:expired-pickup`, version: 1, writeState: "not_saved", reviewRequirement: "required", reviewState: "pending", childId, title: "接送人安排待核實", createdAtLabel: "2026 年 10 月 2 日 晚上 8:00（合成）",
      sourceContext: reviewSource("pickup-plan", "下週的接送安排", "2026-10-02T12:00:00Z", "2026 年 10 月 2 日 晚上 8:00", "pickup-plan"),
      originalText: "下星期可能由婆婆接放學，但未落實。呢個安排先俾我核實，唔好當佢已經可以接。",
      sourceLabel: "家長提及尚待落實的接送安排（合成）", sourceId: "preview-source:pickup-plan", sourceVersion: "source-v1", sourceScope: "private", sourceState: "ready",
      proposedValues: { ...emptyCareForm(), text: "下週可能由婆婆接放學，安排尚未落實；不能視為已確認的接送授權。", source: "家長提供的待核實安排（合成）", eventTimeRaw: "下星期，日期未核實" },
      target: { kind: "create", scope: "family" }, operationValidity: { state: "expired", expiresAtLabel: "2026 年 10 月 3 日 晚上 8:00（合成）" },
      purpose: "接送安排需要家長明確確認；原操作期限已過，但未處理事項仍保留。", uncertainties: ["重新取得有效提案的正式接口未接通；不能提交這個舊操作。"],
    },
  ];
}

// The normal scenario projects approved automatic writes. Prior-consent proposals stay
// available only in an explicitly selected scenario, using the same canonical owner.
export type CareFixtureScenario = "normal" | "prior_consent";
export function createCareFixtures(childId: string, scenario: CareFixtureScenario = "normal"): CareRecordView[] {
  const records = createPriorConsentRecords(childId);
  if (scenario === "prior_consent") return records;
  const captures = createPriorConsentCaptures(childId);
  for (const capture of captures.filter(item => item.reviewRequirement === "prewrite")) {
    if (capture.target.kind === "update") {
      const record = records.find(item => item.id === (capture.target as { recordId: string }).recordId);
      if (record) {
        const previous = record.current;
        record.current = { ...revision(previous.version + 1, capture.proposedValues, "Agent 已按授權記錄（合成）"), confirmedByLabel: "Agent 按既有授權記錄（合成）" };
        record.history = [previous, ...record.history];
      }
    } else records.push({ id: `preview-care-routine:${childId}`, childId, title: capture.title, createdAtLabel: capture.createdAtLabel,
      current: { ...revision(1, capture.proposedValues, "Agent 已按授權記錄（合成）"), confirmedByLabel: "Agent 按既有授權記錄（合成）" }, history: [] });
  }
  return records;
}
export function createCareCaptureFixtures(childId: string, scenario: CareFixtureScenario = "normal"): CareCaptureReview[] {
  const captures = createPriorConsentCaptures(childId);
  if (scenario === "prior_consent") return captures;
  return captures.map(capture => capture.reviewRequirement !== "prewrite" ? capture : {
    ...capture, writeState: "saved", reviewRequirement: "optional", reviewState: "not_required",
    originalText: capture.originalText.replace("呢段先俾我核對，確認後先更新。", "幫我補返落記錄。").replace("先幫我整理，我確認之後先加入家庭記錄。", "幫我留返呢個安排。"),
    resolution: { label: "Agent 已按既有授權記錄；有誤時可更正，毋須逐筆確認。", recordId: capture.target.kind === "update" ? capture.target.recordId : `preview-care-routine:${childId}`,
      recordVersion: capture.target.kind === "update" ? capture.target.expectedVersion + 1 : 1 },
  });
}

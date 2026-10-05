import { emptyCareForm, type CareCaptureReview, type CareFormValues, type CareRecordView, type CareRevisionView } from "../care-view-model";

function revision(version: number, values: Partial<CareFormValues>, confirmedAtLabel: string): CareRevisionView {
  return {
    version, values: { ...emptyCareForm(), ...values },
    eventTimePrecision: values.eventTimeRaw ? "approximate" : "unknown",
    timeZoneLabel: "Asia/Hong_Kong", confirmedByLabel: "媽媽（合成）", confirmedAtLabel,
  };
}

export function createCareFixtures(childId: string): CareRecordView[] {
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

// Isolated capture review examples, not actual Agent output or a server queue.
export function createCareCaptureFixtures(childId: string): CareCaptureReview[] {
  if (!["preview-child-1", "preview-child-2"].includes(childId)) return [];
  const older = childId === "preview-child-2";
  return [{id:`preview-capture:${childId}:daily`,childId,title:older?"課後分享的片段":"昨晚的睡眠片段",createdAtLabel:"2026 年 10 月 4 日 上午 7:12（合成）",
    originalText:older?"今日畫完幅畫，佢走過嚟同我講學校發生咩事。":"昨晚大概九點半睡，中間醒過一次，安撫後再睡。朝早七點左右起身。",
    sourceLabel:"家長私人文字 · 合成原始輸入",
    proposedValues:{...emptyCareForm(),kind:older?"note":"sleep",text:older?"完成畫作後，主動與家人分享學校的事情。":"昨晚約 21:30 入睡，中途醒過一次，安撫後繼續睡。早上約 07:00 起床。",source:"家長提供的生活觀察（合成）",eventTimeRaw:older?"今天放學後":"昨晚至今早",reason:"家長核對助手整理候選"},
    uncertainties:["相對日期未轉成確實時間，請核對發生日期。","候選尚未家庭共享；原始私人文字不會隨採用自動分享。"],
  }];
}

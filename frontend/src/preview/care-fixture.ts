import { emptyCareForm, type CareFormValues, type CareRecordView, type CareRevisionView } from "../care-view-model";

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

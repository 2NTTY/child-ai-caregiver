import type { ProfileRevisionView } from "../profile-view-model";

// Explicit synthetic values; never derive structured ages from the home summary.
export function createProfileFixture(childId: string): { current: ProfileRevisionView; history: ProfileRevisionView[] } {
  const empty: ProfileRevisionView = { version: 0, data: null, confirmedByLabel: null, confirmedAtLabel: null, reason: null };
  if (childId !== "preview-child-1") return { current: empty, history: [] };
  const first: ProfileRevisionView = {
    version: 1, data: {
      age: { kind: "unknown" }, dueDate: null, gestationalWeeksRaw: null, region: "香港", language: "廣東話",
      allergies: null, specialNeeds: null, preferences: null, source: "媽媽提供的合成示例", validUntil: null,
    }, confirmedByLabel: "媽媽（合成）", confirmedAtLabel: "2026-08-01 10:00（合成）", reason: "首次確認合成資料",
  };
  const current: ProfileRevisionView = {
    version: 3, data: {
      ...first.data!, age: { kind: "approximate", rawValue: "38", unit: "months", asOf: "2026-09-01" },
      preferences: "午睡前先讀一本繪本", validUntil: "2026-12-31",
    }, confirmedByLabel: "媽媽（合成）", confirmedAtLabel: "2026-09-26 10:24（合成）", reason: "補充照顧偏好",
  };
  const previous: ProfileRevisionView = {
    ...current, version: 2, data: { ...current.data!, preferences: null },
    confirmedAtLabel: "2026-09-01 09:00（合成）", reason: "核對約數年齡和日期基準",
  };
  return { current, history: [previous, first] };
}

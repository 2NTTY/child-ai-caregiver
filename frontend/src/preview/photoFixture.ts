import type { PhotoCandidate, PhotoItem, PhotoOriginal } from "../photo-view-model";

const illustration = require("../../assets/images/harbour-family-hero.png");
export const photoPreviewOriginal: PhotoOriginal = {
  fileName: "育伴港美術示例.png", mimeType: "image/png", bytes: 2335736,
  sha256: "d2a072b0e68f4e825b50ab95b6074072b3cc847e40b9a08d113a4fd3c8316a9c", imageSource: illustration,
};
export const photoPreviewCandidate: PhotoCandidate = {
  text: "昨日下午休息了約一小時；記錄時間仍需與照顧者核對。", kind: "sleep", rawValue: "約 1", unit: "小時", approximate: true,
  timeRaw: "昨日下午", uncertainties: ["示例候選只供操作比較，不是對這張品牌美術的真實提取。", "未能確定實際日期及入睡時間。"],
};
export function photoFixture(childId: string, readOnly = false): PhotoItem[] {
  const common = { ...photoPreviewOriginal, childId, source: "育伴港原有美術 · 合成預覽", ownerLabel: "媽媽（合成）", isUploader: true, createdAtLabel: "2026年9月30日 10:24", version: 1 };
  const shared: PhotoItem = { ...common, id: `${childId}-photo-shared`, isUploader: !readOnly, canManage: !readOnly, state: "ready", visibility: "shared", recordId: `${childId}-photo-record`, extraction: readOnly ? { state: "not_requested", candidate: null } : { state: "available", candidate: photoPreviewCandidate } };
  return readOnly ? [shared] : [
    { ...common, id: `${childId}-photo-private`, canManage: true, state: "ready", visibility: "private", recordId: null, extraction: { state: "not_requested", candidate: null } }, shared,
  ];
}

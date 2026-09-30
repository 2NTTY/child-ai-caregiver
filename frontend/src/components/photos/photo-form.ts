import { z } from "zod";
import type { PhotoDraftFields } from "../../photo-view-model";

export const photoDraftSchema = z.object({
  text: z.string().max(5000, "照片記錄最多 5,000 字。").refine(value => !!value.trim(), "請填寫記錄原文。"),
  kind: z.enum(["note", "feeding", "sleep", "diaper", "temperature", "measurement", "appointment"]),
  rawValue: z.string().max(100, "數值原文最多 100 字。"), unit: z.string().max(50, "單位最多 50 字。"),
  approximate: z.boolean(), timeRaw: z.string().max(300, "時間原文最多 300 字。"),
}).superRefine((value, context) => {
  if ((value.rawValue !== "" || value.unit !== "") && (!value.rawValue.trim() || !value.unit.trim()))
    context.addIssue({ code: "custom", path: [!value.rawValue.trim() ? "rawValue" : "unit"], message: "數值與單位須一起填寫，或同時留空。" });
});
export function photoConfirmationProjection(draft: PhotoDraftFields, source: string) {
  return { text: draft.text, source, details: { kind: draft.kind,
    quantity: draft.rawValue !== "" && draft.unit !== "" ? { rawValue: draft.rawValue, unit: draft.unit, precision: draft.approximate ? "approximate" as const : "exact" as const } : null,
    eventTime: { rawText: draft.timeRaw, at: null, timeZone: "Asia/Hong_Kong", precision: draft.approximate && draft.timeRaw.length > 0 ? "approximate" as const : "unknown" as const },
  } };
}

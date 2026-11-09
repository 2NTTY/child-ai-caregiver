import { z } from "zod";
import { careKindOptions } from "../../care-view-model.ts";

// Client hints only; Server validation and authorization are not delegated to this schema.
const requiredText = (max: number, label: string) => z.string().max(max, `${label}最多 ${max} 個字元。`)
  .refine(value => value.trim().length > 0, `請填寫${label}。`);

export function careFormSchema(mode: "create" | "revise") {
  return z.object({
    kind: z.enum(careKindOptions.map(item => item.value)),
    text: requiredText(10000, "記錄原文"),
    source: requiredText(500, "資料來源"),
    quantityRaw: z.string().max(100, "數量原文最多 100 個字元。"),
    quantityUnit: z.string().max(50, "單位最多 50 個字元。"),
    quantityPrecision: z.enum(["exact", "approximate"]),
    eventTimeRaw: z.string().max(300, "事件時間原文最多 300 個字元。"),
    reason: z.string().max(500, "更正原因最多 500 個字元。"),
  }).superRefine((values, context) => {
    if (!!values.quantityRaw.trim() !== !!values.quantityUnit.trim()) {
      const missing = values.quantityRaw.trim() ? "quantityUnit" : "quantityRaw";
      context.addIssue({ code: "custom", path: [missing], message: "數量原文與單位須一起填寫，或一起留空。" });
    }
    if (mode === "revise" && !values.reason.trim()) {
      context.addIssue({ code: "custom", path: ["reason"], message: "請說明這次更正的原因。" });
    }
  });
}

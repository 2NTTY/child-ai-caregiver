import { z } from "zod";

// Match the existing profile input limits without trimming or numeric coercion.
const text = (max: number) => z.string().max(max, `最多 ${max} 個字元`).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value), "請移除不支援的字元");
const required = (max: number) => text(max).refine(value => value.trim().length > 0, "請填寫此欄位");
const optional = (max: number) => text(max).refine(value => value === "" || value.trim().length > 0, "未知請留空，或填寫已知資料");
const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const optionalDate = z.string().refine(value => value === "" || validDate(value), "請填寫有效日期 YYYY-MM-DD");

export const profileFormSchema = z.object({
  ageKind: z.enum(["unknown", "birth_date", "approximate"]),
  birthDate: z.string(), ageRaw: z.string(), ageUnit: z.enum(["days", "weeks", "months", "years"]), ageAsOf: z.string(),
  dueDate: optionalDate, gestationalWeeksRaw: optional(100), region: optional(200), language: optional(200),
  allergies: optional(2000), specialNeeds: optional(2000), preferences: optional(2000),
  source: required(500), validUntil: optionalDate, reason: required(500),
}).superRefine((values, context) => {
  if (values.ageKind === "birth_date" && !validDate(values.birthDate))
    context.addIssue({ code: "custom", path: ["birthDate"], message: "請填寫有效出生日期 YYYY-MM-DD" });
  if (values.ageKind === "approximate") {
    const raw = required(100).safeParse(values.ageRaw);
    if (!raw.success) raw.error.issues.forEach(issue => context.addIssue({ ...issue, path: ["ageRaw", ...issue.path] }));
    if (!validDate(values.ageAsOf)) context.addIssue({ code: "custom", path: ["ageAsOf"], message: "請填寫約數年齡的截至日期 YYYY-MM-DD" });
  }
});

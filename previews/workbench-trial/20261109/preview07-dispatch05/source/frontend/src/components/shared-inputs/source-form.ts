import { z } from "zod";
import type { PhotoDraftFields } from "../../photo-view-model.ts";
import type { PublicInputSource, SourceConfirmationKind, SourceCreate, SourceInput } from "../../shared-input-view-model.ts";
import { photoDraftSchema, photoConfirmationProjection } from "../photos/photo-form.ts";

const safe = (max: number, message: string) => z.string().max(max, message).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value), "請移除無效字元。");
export const sourceComposerDefaults = { kind: "personal_source" as "personal_source" | "paste" | "public_source", sourceLabel: "我的私人來源", sourceUrl: "", sourceDateText: "", sourceNotes: "", text: "", sourceId: "" };
export type SourceComposerDraft = typeof sourceComposerDefaults;
export function sourceComposerSchema(sources: readonly PublicInputSource[]) {
  return z.object({ kind: z.enum(["personal_source", "paste", "public_source"]), sourceLabel: z.string(), sourceUrl: z.string(),
    sourceDateText: z.string(), sourceNotes: z.string(), text: z.string(), sourceId: z.string(),
  }).superRefine((draft, context) => {
    if (draft.kind === "public_source") {
      if (!sources.some(source => source.id === draft.sourceId)) context.addIssue({ code: "custom", path: ["sourceId"], message: "請選擇清單中的公開來源。" });
      return;
    }
    const limits = { sourceLabel: [200, "來源名稱最多 200 字。"], sourceUrl: [1000, "網址最多 1,000 字。"], sourceDateText: [200, "來源日期原文最多 200 字。"],
      text: [10000, "原文最多 10,000 字，請自行選擇內容；不會截短原文。"], ...(draft.kind === "personal_source" ? { sourceNotes: [1000, "備註最多 1,000 字。"] } : {}) };
    for (const [field, [max, message]] of Object.entries(limits)) {
      const result = safe(max as number, message as string).safeParse(draft[field as keyof SourceComposerDraft]);
      if (!result.success) for (const issue of result.error.issues) context.addIssue({ code: "custom", path: [field], message: issue.message });
    }
    if (!draft.sourceLabel.trim()) context.addIssue({ code: "custom", path: ["sourceLabel"], message: "請填寫來源名稱。" });
    if (draft.sourceUrl.length) {
      let valid = false; try { const url = new URL(draft.sourceUrl); valid = url.protocol === "https:" && !url.username && !url.password; } catch { /* Invalid input stays in the draft. */ }
      if (!valid) context.addIssue({ code: "custom", path: ["sourceUrl"], message: "請填寫不含帳密的 HTTPS 網址。" });
    }
    if (!draft.text.trim() && (draft.kind === "paste" || !draft.sourceUrl.length)) context.addIssue({ code: "custom", path: ["text"], message: draft.kind === "paste" ? "請貼上原文。" : "請提供網址或原文至少一項。" });
  });
}
export function sourceCreateProjection(draft: SourceComposerDraft): SourceCreate {
  if (draft.kind === "public_source") return { kind: draft.kind, sourceId: draft.sourceId };
  const common = { kind: draft.kind, sourceLabel: draft.sourceLabel, sourceUrl: draft.sourceUrl.length ? draft.sourceUrl : null,
    sourceDateText: draft.sourceDateText.length ? draft.sourceDateText : null, text: draft.text };
  return draft.kind === "personal_source" ? { ...common, kind: "personal_source", sourceNotes: draft.sourceNotes } : { ...common, kind: "paste" };
}
export function sourceRecordSchema(kind: SourceConfirmationKind) {
  // Reference notes use the same field limits but ignore the hidden quantity-pair requirement.
  return kind === "family_record" ? photoDraftSchema : z.object(photoDraftSchema.shape);
}
export function validSourceExcerpt(text: string, excerpt: string) { return !!excerpt.trim() && excerpt.length <= 10000 && text.includes(excerpt); }
export function sourceConfirmationProjection(draft: PhotoDraftFields, input: Pick<SourceInput, "version" | "sourceLabel">, kind: SourceConfirmationKind, confirmChildFact: boolean) {
  if (kind === "family_record" && !confirmChildFact) throw new Error("Child relationship must be explicitly confirmed");
  const values = kind === "family_record" ? photoConfirmationProjection(draft, input.sourceLabel) : { text: draft.text, source: input.sourceLabel,
    details: { kind: "note" as const, quantity: null, eventTime: { rawText: "", at: null, timeZone: "Asia/Hong_Kong", precision: "unknown" as const } } };
  return { expectedVersion: input.version, confirmShared: true as const, kind, confirmChildFact: kind === "family_record" && confirmChildFact, values };
}

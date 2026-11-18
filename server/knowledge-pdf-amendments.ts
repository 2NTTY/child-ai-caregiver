import { z } from "zod";
import { knowledgeChunkInputSchema } from "./knowledge-inputs.ts";
import type { KnowledgeSourceInput } from "../src/shared/knowledge.ts";

const fields = knowledgeChunkInputSchema.shape;
export const pdfAmendmentSchema = z.strictObject({
  key: fields.key, text: fields.text, applicability: fields.applicability,
  evidence: z.array(z.strictObject({
    page: z.number().int().positive(), quote: z.string().trim().min(8).max(1000),
  })).min(1).max(12),
});
export type PdfAmendment = z.infer<typeof pdfAmendmentSchema>;

/** Editorial changes can only address a sealed range. Original text, location and identifiers remain bound to the observation. */
export function amendedPdfChunks(
  units: readonly { id: string; page: number | null; pageEnd: number | null }[],
  chunks: KnowledgeSourceInput["chunks"],
  pages: readonly { page: number; text: string }[],
  proposals: PdfAmendment[],
) {
  const edits = z.array(pdfAmendmentSchema).min(1).max(32).parse(proposals);
  const changes = new Map(edits.map(edit => [edit.key, edit]));
  if (changes.size !== edits.length || units.length !== chunks.length)
    throw Error("knowledge_pdf_amendment_range_mismatch");
  const result = new Map<string, KnowledgeSourceInput["chunks"][number]>();
  for (const unit of units) {
    const chunk = chunks.find(candidate => candidate.key === unit.id);
    if (!chunk || chunk.pageStart !== unit.page || chunk.pageEnd !== unit.pageEnd)
      throw Error("knowledge_pdf_amendment_range_mismatch");
    const edit = changes.get(unit.id);
    if (edit) {
      if (edit.applicability.region !== chunk.applicability.region || edit.evidence.some(ref =>
        ref.page < chunk.pageStart! || ref.page > chunk.pageEnd! ||
        !pages.find(page => page.page === ref.page)?.text.includes(ref.quote)))
        throw Error("knowledge_pdf_amendment_evidence_mismatch");
      changes.delete(unit.id);
    }
    result.set(unit.id, edit ? { ...chunk, text: edit.text, applicability: edit.applicability } : chunk);
  }
  if (changes.size) throw Error("knowledge_pdf_amendment_range_mismatch");
  return result;
}

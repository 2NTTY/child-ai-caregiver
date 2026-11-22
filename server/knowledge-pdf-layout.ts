import { z } from "zod";

export const layoutFactValue = z.string().trim().min(1).max(80);
const layoutFactKey = z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/u);
export const layoutFactsSchema = z.record(layoutFactKey, layoutFactValue);
export type LayoutFacts = z.infer<typeof layoutFactsSchema>;

export interface KnowledgePdfQuestion {
  contentHash: string;
  question: string;
  physicalPage?: number;
  factKeys?: readonly string[];
}

export function layoutFactContract(keys: readonly string[]) {
  z.array(layoutFactKey).min(1).max(12).parse(keys);
  if (new Set(keys).size !== keys.length) throw Error("knowledge_layout_field_conflict");
  return z.strictObject(Object.fromEntries(keys.map(key => [key,layoutFactValue])));
}

export const printPageScopeSchema = z.strictObject({
  physicalPage: z.int().positive(),
  question: z.string().trim().min(1).max(80),
  fields: z.array(z.strictObject({ key: layoutFactKey, label: z.string().trim().min(1).max(80) })).min(1).max(12)
    .refine(fields => new Set(fields.map(f => f.key)).size === fields.length
      && new Set(fields.map(f => f.label)).size === fields.length),
});
export type PrintPageScope = z.infer<typeof printPageScopeSchema>;

export function selectedPrintWindow(scope: PrintPageScope, totalPages: number) {
  const { physicalPage: page } = printPageScopeSchema.parse(scope);
  if (!Number.isSafeInteger(totalPages) || page > totalPages) throw Error('knowledge_window_range_invalid');
  return { first: page, last: page, firstRead: page, lastRead: page, ranges: [{ first: page, last: page }] };
}

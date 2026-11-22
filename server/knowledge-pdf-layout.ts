import { z } from "zod";
import type { KnowledgeEvidence } from '../src/shared/knowledge.ts';

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

const chartFieldsSchema = z.array(z.strictObject({label:z.string().min(1).max(80),value:layoutFactValue})).min(1).max(12);
const fieldLength = z.int().min(1).max(80);
export const chartFieldBoundsSchema = z.array(z.strictObject({label:fieldLength,value:fieldLength})).min(1).max(12);

/** Decode exact field boundaries, including values containing newlines or full-width colons. */
export function readChartFields(section: string, text: string, bounds: z.infer<typeof chartFieldBoundsSchema>) {
  let offset=section.length;
  if (!text.startsWith(section)) return;
  const fields=[];
  for (const size of bounds) {
    if (text[offset++] !== '\n') return;
    const label=text.slice(offset,offset+size.label);
    offset+=size.label;
    if (text[offset++] !== '：') return;
    const value=text.slice(offset,offset+size.value);
    offset+=size.value;
    fields.push({label,value});
  }
  return offset === text.length ? fields : undefined;
}

/** Recover older commissioned rows only when every label matches its declared position. */
export function legacyChartFields(section: string, text: string, page: number | undefined, scope?: PrintPageScope) {
  if (!scope || page !== scope.physicalPage || section !== scope.question) return;
  const [question,...rows] = text.split('\n');
  if (question !== section || rows.length !== scope.fields.length) return;
  const fields = scope.fields.map(({label},index) => {
    const prefix=label+'：', row=rows[index]!;
    return {label,value:row.startsWith(prefix) ? row.slice(prefix.length) : ''};
  });
  const result=chartFieldsSchema.safeParse(fields);
  return result.success ? result.data : undefined;
}

export function isReviewedChartPage(chunk: KnowledgeEvidence): boolean {
  const page = chunk.excerptPage, pdf = chunk.extraction;
  return Boolean(page && chunk.originalKind === 'visual_page' && !chunk.sourceExcerpt && !chunk.originalText
    && chunk.classification === 'official_guidance' && chunk.reviewState === 'reviewed'
    && chunk.applicability.use === 'original_lookup' && chunk.treatment?.kind === 'overview'
    && pdf?.format === 'text_pdf' && !pdf.complete && pdf.pageStart === page && pdf.pageEnd === page
    && chunk.pageStart === page && chunk.pageEnd === page && chunk.key === `pages-${page}-${page}`
    && chunk.text.startsWith(chunk.section+'\n'));
}

export function readReviewedChart(chunk: KnowledgeEvidence) {
  if (!isReviewedChartPage(chunk)) return;
  const fields = chunk.chartFields ?? [];
  if (fields.length && [chunk.section,...fields.map(({label,value})=>label+'：'+value)].join('\n') !== chunk.text) return;
  return {reading:chunk.text,fields};
}

export function selectedPrintWindow(scope: PrintPageScope, totalPages: number) {
  const { physicalPage: page } = printPageScopeSchema.parse(scope);
  if (!Number.isSafeInteger(totalPages) || page > totalPages) throw Error('knowledge_window_range_invalid');
  return { first: page, last: page, firstRead: page, lastRead: page, ranges: [{ first: page, last: page }] };
}

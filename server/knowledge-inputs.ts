import { createHash } from "node:crypto";
import { mediaClip } from '../src/shared/platform-media.ts';
import { z } from "zod";
import { platformPublisherHosts } from '../src/shared/platform-material.ts';
import type { KnowledgeFilter, KnowledgeSourceInput } from "../src/shared/knowledge.ts";

import { chunkTreatmentSchema, sourceSeriesSchema } from '../src/shared/source-series.ts';
import { timelyEventLifecycleSchema } from "../src/shared/knowledge-timely.ts";

const text = (max: number) => z.string().min(1).max(max).refine(value => Boolean(value.trim()) && !/[\u0000\uD800-\uDFFF]/u.test(value));
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const region = z.string().regex(/^[A-Z]{2}$/);
const date = z.iso.datetime({ offset: true });
const topicList = z.array(id).max(12).refine(values => new Set(values).size === values.length);
export const originalOrganizerApplicability = z.strictObject({
  region, ageBasis: z.enum(["actual", "corrected", "any"]),
  minAgeMonths: z.number().min(0).max(120).nullable(), maxAgeMonths: z.number().min(0).max(120).nullable(),
  maxAgeMonthsExclusive: z.boolean().optional(),
  topics: topicList.min(1), conditions: z.array(text(600)).max(8),
}).superRefine((value, ctx) => {
  if (value.ageBasis === "any" ? value.minAgeMonths !== null || value.maxAgeMonths !== null
    : value.minAgeMonths === null || value.maxAgeMonths === null || value.minAgeMonths > value.maxAgeMonths) {
    ctx.addIssue({ code: "custom", message: "Invalid age applicability" });
  }
});
// An official source can extend beyond the families' 0–10 query range, e.g. a 0–18 growth chart.
// Keep the historical organizer grammar stable so its sealed requests can be resumed.
const applicability = originalOrganizerApplicability.safeExtend({ maxAgeMonths: z.number().min(0).max(216).nullable() });
const publicSourceUrl = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.port
    && (platformPublisherHosts.has(url.hostname) || ["news.rthk.hk", "rthk.hk", "www.rthk.hk"].includes(url.hostname));
});
export const knowledgeExtractionSchema = z.strictObject({
  format: z.enum(["html", "text_pdf"]), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  extractionQuality: z.literal("requires_review").optional(),
  totalPages: z.number().int().min(1).optional(), pageStart: z.number().int().min(1).optional(),
  pageEnd: z.number().int().min(1).optional(), complete: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.format === "text_pdf" && (!value.pageStart || !value.pageEnd || value.pageStart > value.pageEnd
    || value.totalPages !== undefined && value.pageEnd > value.totalPages
    || value.complete && (value.pageStart !== 1 || value.pageEnd !== value.totalPages)))
    ctx.addIssue({ code: "custom", message: "Invalid extraction coverage" });
});
export const knowledgeQueryAgeSchema = z.strictObject({
  basis: z.enum(["actual", "corrected"]), minMonths: z.number().min(0).max(120), maxMonths: z.number().min(0).max(120),
  source: z.enum(["message", "profile"]), quote: text(600), messageId: z.uuid().optional(),
  offset: z.number().int().min(0).max(1000000).optional(), profileVersion: z.number().int().min(1).optional(),
}).refine(value => value.minMonths <= value.maxMonths && (value.source === "message"
  ? Boolean(value.messageId) && value.profileVersion === undefined
  : value.profileVersion !== undefined && value.messageId === undefined && value.offset === undefined));
const sourceSchema = z.strictObject({
  series: sourceSeriesSchema.optional(), sourceId: id, url: publicSourceUrl, title: text(300), publisher: text(160),
  classification: z.enum(["official_guidance", "recent_information"]),
  sourcePublishedAt: date.nullable(), sourceUpdatedAt: date.nullable(), sourceDateText: text(200).nullable().optional(),
  validUntil: date.nullable().optional(), timelyEvent: timelyEventLifecycleSchema.optional(), fetchedAt: date, termsUrl: publicSourceUrl, extraction: knowledgeExtractionSchema.optional(),
  chunks: z.array(z.strictObject({ key: id, treatment: chunkTreatmentSchema.optional(), section: text(240), sourceExcerpt: z.union([text(300), z.literal("")]),
    mediaClip: mediaClip.optional(), originalKind: z.enum(["page_excerpt","page_transcription","visual_page"]).optional(), excerptPage: z.int().positive().optional(), text: text(4000),
    originalText: text(4000).optional(), pageStart: z.number().int().min(1).optional(), pageEnd: z.number().int().min(1).optional(),
    keywords: z.array(text(80)).min(1).max(24), applicability }).refine(chunk => chunk.originalKind === "visual_page"
      ? !chunk.sourceExcerpt && !chunk.originalText : Boolean(chunk.sourceExcerpt.trim()))).min(1).max(32),
}).superRefine((value, ctx) => {
  if (new Set(value.chunks.map(chunk => chunk.key)).size !== value.chunks.length) ctx.addIssue({ code: "custom", message: "Duplicate section key" });
  if (value.series && value.series.institutionId !== new URL(value.url).hostname)
    ctx.addIssue({ code: 'custom', message: 'Series institution must match its registered source' });
  for (const chunk of value.chunks) {
    if ((chunk.applicability.maxAgeMonths ?? 0) > 120 && value.classification !== 'official_guidance') {
      ctx.addIssue({ code: 'custom', message: 'Only official guidance may retain an upper age beyond the family query range' });
    }
    if (chunk.treatment?.kind === 'structured' && chunk.treatment.fields.some(field => !(chunk.originalText ?? chunk.sourceExcerpt).includes(field.value)))
      ctx.addIssue({ code: 'custom', message: 'Structured values require exact source text' });
    if (chunk.mediaClip) {
      if (chunk.pageStart || chunk.pageEnd || chunk.originalKind || chunk.excerptPage || !chunk.mediaClip.text.includes(chunk.sourceExcerpt))
        ctx.addIssue({ code: 'custom', message: 'Invalid media evidence' });
      continue;
    }
    if (chunk.originalKind && value.extraction?.format !== "text_pdf")
      ctx.addIssue({ code: "custom", message: "Invalid original representation" });
    if (chunk.excerptPage !== undefined && (value.extraction?.format !== 'text_pdf' || !chunk.pageStart || !chunk.pageEnd ||
      chunk.excerptPage < chunk.pageStart || chunk.excerptPage > chunk.pageEnd))
      ctx.addIssue({ code: "custom", message: "The physical evidence page must belong to the reviewed PDF section" });
    if (value.extraction?.format === "text_pdf" && ((!chunk.originalText && chunk.originalKind !== "visual_page") || !chunk.pageStart || !chunk.pageEnd))
      ctx.addIssue({ code: "custom", message: "PDF chunks require original text and page coverage" });
    if ((chunk.pageStart === undefined) !== (chunk.pageEnd === undefined)
      || chunk.pageStart !== undefined && (chunk.pageStart > chunk.pageEnd! || value.extraction?.format !== "text_pdf"
      || chunk.pageStart < value.extraction.pageStart! || chunk.pageEnd! > value.extraction.pageEnd!))
      ctx.addIssue({ code: "custom", message: "Invalid chunk page coverage" });
  }
  // Unknown publication dates stay unknown and are excluded from recent retrieval, not fabricated at import.
  if (value.classification === "official_guidance" && /(^|\.)rthk\.hk$/.test(new URL(value.url).hostname)) ctx.addIssue({ code: "custom", message: "Media cannot be official care guidance" });
  if (value.timelyEvent && value.classification !== "recent_information") ctx.addIssue({ code: "custom", message: "Timely event lifecycle requires recent_information classification" });
  if (value.timelyEvent?.statusUpdatedAt && Date.parse(value.timelyEvent.statusUpdatedAt) > Date.now()) ctx.addIssue({ code: "custom", message: "Future timely event status date" });
  if ([value.sourcePublishedAt, value.sourceUpdatedAt].some(value => value !== null && Date.parse(value) > Date.now())
    || Date.parse(value.fetchedAt) > Date.now()) ctx.addIssue({ code: "custom", message: "Future source date" });
});
const filterSchema = z.strictObject({ region, classification: z.enum(["official_guidance", "recent_information"]).default("official_guidance"),
  age: z.strictObject({ basis: z.enum(["actual", "corrected"]), minMonths: z.number().min(0).max(120), maxMonths: z.number().min(0).max(120) })
    .refine(value => value.minMonths <= value.maxMonths).nullable(), topics: topicList,
  ageMatch: z.enum(["contained", "overlap", "unknown"]).default("contained") });
export function parseKnowledgeSource(input: unknown): KnowledgeSourceInput { return sourceSchema.parse(input); }
export function parseKnowledgeFilter(input: unknown): KnowledgeFilter { return filterSchema.parse(input); }
export function parseKnowledgeQuery(input: unknown): string { return text(2000).parse(input); }
export function internalKnowledgeSource(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "www.chp.gov.hk" || /(^|\.)rthk\.hk$/.test(host);
}
export function knowledgeHash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function sourceVersionHash(source: KnowledgeSourceInput): string {
  // Fetch/check timestamps do not turn unchanged public content into a new edition.
  const { fetchedAt: _fetchedAt, ...content } = source;
  return knowledgeHash(content);
}
/** Treatment-only versions may reuse the reviewed original only if all its content is identical. */
export function treatmentContentHash(source: KnowledgeSourceInput): string {
  return sourceVersionHash({ ...source, chunks: source.chunks.map(({ treatment: _, ...content }) => content) });
}
export function embeddingDocument(title: string, section: string, body: string): { title: string; text: string; hash: string } {
  const documentTitle = `${title} — ${section}`;
  return { title: documentTitle, text: body, hash: knowledgeHash([documentTitle, body]) };
}

export const knowledgeChunkInputSchema = sourceSchema.shape.chunks.element;

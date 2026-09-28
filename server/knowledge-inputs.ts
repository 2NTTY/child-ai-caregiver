import { createHash } from "node:crypto";
import { z } from "zod";
import type { KnowledgeFilter, KnowledgeSourceInput } from "../src/shared/knowledge.ts";

const text = (max: number) => z.string().min(1).max(max).refine(value => Boolean(value.trim()) && !/[\u0000\uD800-\uDFFF]/u.test(value));
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const region = z.string().regex(/^[A-Z]{2}$/);
const date = z.iso.datetime({ offset: true });
const topicList = z.array(id).max(12).refine(values => new Set(values).size === values.length);
const applicability = z.strictObject({
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
const publicSourceUrl = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.port
    && ["www.fhs.gov.hk", "www.studenthealth.gov.hk", "www.chp.gov.hk", "www.dh.gov.hk", "news.rthk.hk", "rthk.hk", "www.rthk.hk"].includes(url.hostname);
});
const sourceSchema = z.strictObject({
  sourceId: id, url: publicSourceUrl, title: text(300), publisher: text(160),
  classification: z.enum(["official_guidance", "recent_information"]),
  sourcePublishedAt: date.nullable(), sourceUpdatedAt: date.nullable(), sourceDateText: text(200).nullable().optional(),
  validUntil: date.nullable().optional(), fetchedAt: date, termsUrl: publicSourceUrl,
  chunks: z.array(z.strictObject({ key: id, section: text(240), sourceExcerpt: text(300), text: text(4000),
    keywords: z.array(text(80)).min(1).max(24), applicability })).min(1).max(32),
}).superRefine((value, ctx) => {
  if (new Set(value.chunks.map(chunk => chunk.key)).size !== value.chunks.length) ctx.addIssue({ code: "custom", message: "Duplicate section key" });
  // Unknown publication dates stay unknown and are excluded from recent retrieval, not fabricated at import.
  if (value.classification === "official_guidance" && /(^|\.)rthk\.hk$/.test(new URL(value.url).hostname)) ctx.addIssue({ code: "custom", message: "Media cannot be official care guidance" });
  if ([value.sourcePublishedAt, value.sourceUpdatedAt].some(value => value !== null && Date.parse(value) > Date.now())
    || Date.parse(value.fetchedAt) > Date.now()) ctx.addIssue({ code: "custom", message: "Future source date" });
});
const filterSchema = z.strictObject({ region, classification: z.enum(["official_guidance", "recent_information"]).default("official_guidance"),
  age: z.strictObject({ basis: z.enum(["actual", "corrected"]), minMonths: z.number().min(0).max(120), maxMonths: z.number().min(0).max(120) })
    .refine(value => value.minMonths <= value.maxMonths).nullable(), topics: topicList });
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
export function embeddingDocument(title: string, section: string, body: string): { title: string; text: string; hash: string } {
  const documentTitle = `${title} — ${section}`;
  return { title: documentTitle, text: body, hash: knowledgeHash([documentTitle, body]) };
}

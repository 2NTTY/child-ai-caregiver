import { z } from 'zod';
import { KNOWLEDGE_PDF_MAX_BYTES } from './knowledge-pdf.ts';
import { chatFileMimeSchema } from '../src/shared/chat-files.ts';
import { registeredSourceUrlSchema, sourceCardAllowsUrl, type RegisteredSourceSettings } from '../src/shared/registered-source-card.ts';
import { domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';

export const SOURCE_CARD_PART_BYTES = 96 * 1024;
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const base = { cardId: z.uuid(), grant: digest };
const item = { ...base, documentId: digest, version: digest };
export const scanItemIssue = z.enum(['file_too_large', 'listing_changed']);
const scan = { ...base, checkId: z.uuid(), revision: z.int().positive() };
export const sourceIndexCoverage = z.enum(['full_text', 'text_excerpt', 'page_one_excerpt', 'original_only']);
const itemFields = {
  indexCoverage: sourceIndexCoverage, indexText: z.string().max(12000), indexTerms: z.array(z.string().min(1).max(64)).max(512),
  ...item, url: z.url().max(4096), mimeType: chatFileMimeSchema, originalHash: digest,
  bytes: z.int().positive().max(KNOWLEDGE_PDF_MAX_BYTES), storedHash: digest,
  preview: z.string().max(2400), title: z.string().min(1).max(300), capturedAt: z.iso.datetime(),
};
export const scanItemSchema = z.strictObject({
  url: z.url().max(4096), offset: z.int().positive().optional(), listingHash: digest.optional()
}).refine(item => (item.offset === undefined) === (item.listingHash === undefined));
export type SourceScanItem = z.infer<typeof scanItemSchema>;
export const sourceCardDocumentRecord = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('head'), ...itemFields,
    rag: z.strictObject({ accessRevision: z.int().positive().max(2147483647), incarnation: z.uuid(), authorityTag: digest.optional() }).optional() }),
  z.strictObject({ kind: z.literal('edition'), ...itemFields }),
  z.strictObject({
    kind: z.literal('staging'), ...item, cleanupAt: z.iso.datetime(), next: z.int().nonnegative(),
    count: z.int().positive().max(Math.ceil(KNOWLEDGE_PDF_MAX_BYTES / SOURCE_CARD_PART_BYTES))
  }),
  z.strictObject({
    kind: z.literal('part'), ...item, part: z.int().nonnegative().lt(Math.ceil(KNOWLEDGE_PDF_MAX_BYTES / SOURCE_CARD_PART_BYTES)),
    base64: z.base64().min(4).max(Math.ceil(SOURCE_CARD_PART_BYTES / 3) * 4)
  }),
  z.strictObject({ kind: z.literal('frontier'), ...scan, item: scanItemSchema, ordinal: z.int().nonnegative(), pending: z.boolean(), issue: scanItemIssue.optional() }),
  z.strictObject({ kind: z.literal('scan-document'), ...scan, documentId: digest, indexed: z.boolean() }),
  z.strictObject({ kind: z.literal('scan-cleanup'), ...scan, cleanupAt: z.iso.datetime() }),
  z.strictObject({
    kind: z.literal('receipt'), ...scan, status: z.enum(['changed', 'unchanged', 'failed']), sequence: z.int().positive(),
    transientFailures: z.int().min(1).max(2).optional(), pending: z.int().nonnegative(), discovered: z.int().positive(),
    issueCount: z.int().nonnegative(), issueExamples: z.array(z.strictObject({ url: z.url().max(4096), reason: scanItemIssue })).max(8),
    savedDocumentCount: z.int().nonnegative(), oversizedCount: z.int().nonnegative(), indexedDocumentCount: z.int().nonnegative()
  }),
]);
export type SourceCardDocumentRecord = z.infer<typeof sourceCardDocumentRecord>;
export type SourceCardEdition = Extract<SourceCardDocumentRecord, { kind: 'edition' }>;
export type SourceCardHead = Extract<SourceCardDocumentRecord, { kind: 'head' }>;

export function sourceDocumentUrl(card: Pick<RegisteredSourceSettings, 'url' | 'kind' | 'allowedPath'>, value: string) {
  const parsed = registeredSourceUrlSchema.safeParse(value);
  if (!parsed.success || !sourceCardAllowsUrl(card, parsed.data)) return domainReject('source_document_invalid', 400);
  const url = new URL(parsed.data);
  if ([...url.searchParams.keys()].some(key => /^x-(?:amz|goog)-|^hdnea$|^hdnts$|^jwt$/iu.test(key)))
    return domainReject('source_document_invalid', 400);
  return url;
}

export function sourceDocumentKey(owner: string, cardId: string, grant: string, ...path: (string | number)[]) {
  return firestoreDomainHash(['registered-source-documents/1', owner, cardId, grant, ...path]);
}
export function sourceDocumentRecordId(scope: WorkRecoveryScope, row: SourceCardDocumentRecord) {
  const key = (...tail: (string | number)[]) => sourceDocumentKey(scope.ownerUserId, row.cardId, row.grant, row.kind, ...tail);
  if (row.kind === 'receipt') return key();
  if (row.kind === 'frontier') return key(row.revision, row.checkId, firestoreDomainHash(row.item));
  if (row.kind === 'scan-document') return key(row.revision, row.checkId, row.documentId);
  if (row.kind === 'scan-cleanup') return key(row.revision, row.checkId);
  if (row.kind === 'head') return key(row.documentId);
  return row.kind !== 'part' ? key(row.documentId, row.version) : key(row.documentId, row.version, row.part);
}
export function sourceDocumentMetadata(scope: WorkRecoveryScope, row: SourceCardDocumentRecord) {
  if (row.kind === 'staging' || row.kind === 'scan-cleanup') return { cleanupAt: row.cleanupAt };
  if (row.kind === 'frontier' || row.kind === 'scan-document') {
    const scanTag = sourceDocumentKey(scope.ownerUserId, row.cardId, row.grant, 'scan', row.revision, row.checkId);
    return { id: sourceDocumentRecordId(scope, row), targetTag: scanTag, ...(row.kind === 'frontier' && row.pending ? { sortKey: scanTag + '-' + String(row.ordinal).padStart(16, '0') } : {}) };
  }
  return row.kind === 'head' ? { targetTag: sourceDocumentKey(scope.ownerUserId, row.cardId, row.grant, 'list'), id: sourceDocumentRecordId(scope, row) } : {};
}

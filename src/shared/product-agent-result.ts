import { z } from 'zod';
import { discussionTranscriptSchema } from './chat-discussion.ts';
import { mediaClip, scriptPassage } from './platform-media.ts';
import { sourceReadingSchema } from './source-card-reading.ts';
import { agentProposalSchema, privateSourceCitationSchema, proactiveNextCheckSchema } from './product-agent.ts';
import { chatDeliveryReviewBindingSchema } from './chat-delivery-review.ts';
import { liveSourceCitationSchema } from './live-source-citation.ts';
import { chunkTreatmentSchema, sourceSeriesSchema } from './source-series.ts';
import { timelyEventLifecycleSchema } from './knowledge-timely.ts';

const uuid = z.uuid(), identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const timestamp = z.iso.datetime({ offset: true }), version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const agentSavedProposalSchema = z.object({
  id: uuid, runId: uuid, childId: uuid, version, status: z.enum(['pending', 'accepted', 'dismissed', 'expired']),
  createdAt: timestamp, expiresAt: timestamp, value: agentProposalSchema, targetLabel: z.string().nullable(),
  targetVisibility: z.enum(['private', 'family']).optional(), contentState: z.enum(['ready', 'invalidated']).optional(),
  result: z.object({ kind: z.enum(['task', 'memory_fact', 'private_source', 'concern', 'family_document']), id: uuid, version }).nullable(),
}).refine(value => value.status === 'accepted'
  ? value.result !== null && value.result.kind === (value.value.kind === 'family_document_change' ? 'family_document'
    : value.value.kind.startsWith('concern_') ? 'concern' : value.value.kind.startsWith('private_source_') ? 'private_source'
      : value.value.kind.startsWith('memory_fact') ? 'memory_fact' : 'task') : value.result === null);

const range = z.object({ start: count, end: count });
export const agentCitationSchema = z.object({
  termsUrl: z.url().optional(), citedExcerpt: z.string().min(1).max(300).optional(), series: sourceSeriesSchema.optional(), treatment: chunkTreatmentSchema.optional(),
  mediaClip: mediaClip.optional(), scriptPassage: scriptPassage.optional(), key: z.string(), section: z.string(), sourceExcerpt: z.string(), text: z.string(), keywords: z.array(z.string()),
  originalText: z.string().optional(), originalKind: z.enum(['page_excerpt','page_transcription','visual_page']).optional(), excerptPage: version.optional(), pageStart: count.optional(), pageEnd: count.optional(),
  applicability: z.object({ region: z.string(), ageBasis: z.enum(['actual', 'corrected', 'any']),
    minAgeMonths: z.number().nullable(), maxAgeMonths: z.number().nullable(), maxAgeMonthsExclusive: z.boolean().optional(),
    topics: z.array(z.string()), conditions: z.array(z.string()) }),
  chunkId: uuid, sourceId: identifier, versionId: uuid, versionHash: z.string(), contentHash: z.string(),
  url: z.string(), title: z.string(), publisher: z.string(), classification: z.enum(['official_guidance', 'recent_information']),
  sourcePublishedAt: timestamp.nullable(), sourceUpdatedAt: timestamp.nullable(), sourceDateText: z.string().nullable().optional(),
  validUntil: timestamp.nullable().optional(), timelyEvent: timelyEventLifecycleSchema.optional(), fetchedAt: timestamp, checkedAt: timestamp,
  lastSuccessfulCheckAt: timestamp.nullable().optional(), usageScope: z.enum(['public_noncommercial', 'internal_noncommercial']).optional(),
  reviewState: z.literal('reviewed'), applicabilityStatus: z.enum(['applicable', 'conditional', 'requires_clarification']).optional(),
  originalCoverage: z.enum(['chunk_original', 'excerpt_only']).optional(),
  extraction: z.object({ format: z.enum(['html', 'text_pdf']), contentHash: z.string(),
    extractionQuality: z.literal('requires_review').optional(), totalPages: count.optional(), pageStart: count.optional(),
    pageEnd: count.optional(), complete: z.boolean() }).optional(),
  readCoverage: z.object({ kind: z.enum(['reviewed_text_and_excerpt', 'original_segment']), complete: z.boolean(),
    offset: count.optional(), nextOffset: count.nullable().optional(), totalCharacters: count.optional(),
    ranges: z.array(range).optional() }).optional(),
});
/** Shared wire and durable-result validation; preserve citation position/coverage during persistence. */
export const productAgentResultSchema = z.object({
  discussion: discussionTranscriptSchema.optional(),
  provenance: z.object({ packVersion: z.string(), recipeId: z.string(), model: z.string() }).nullable(),
  runId: uuid, status: z.enum(['running', 'completed', 'stopped', 'unknown']), stopReason: z.string().nullable(),
  outcome: z.literal('no_action').optional(),
  nextCheck: proactiveNextCheckSchema.optional(),
  text: z.string(), citations: z.array(agentCitationSchema), retrievalMode: z.enum(['vector_keyword', 'keyword_degraded', 'not_used']),
  liveCitations: z.array(liveSourceCitationSchema).max(6).optional(),
  sourceCardReadings: z.array(sourceReadingSchema).max(6).optional(),
  privateSourceCitations: z.array(privateSourceCitationSchema).max(6).optional(),
  tools: z.array(z.object({ name: z.string().min(1), status: z.enum(['succeeded', 'rejected', 'conflict', 'failed', 'unknown']), reference: z.string().optional() })),
  countsKnown: z.boolean().optional(), counts: z.object({ modelCalls: count, toolCalls: count, queryEmbeddings: count }),
  proposals: z.array(agentSavedProposalSchema),
  deliveryReview: chatDeliveryReviewBindingSchema.optional(),
}).refine(value => !value.discussion?.length || value.status === 'completed' && !value.outcome && value.deliveryReview?.decision === 'pass',
  'Visible discussion requires a reviewed, completed answer')
  .refine(value => value.outcome !== 'no_action' || value.status === 'completed' && value.text === ''
  && value.citations.length === 0 && !value.liveCitations?.length && !value.privateSourceCitations?.length && !value.sourceCardReadings?.length && value.proposals.length === 0, 'No-action cannot carry user content');

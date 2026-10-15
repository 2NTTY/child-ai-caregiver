import { z } from 'zod';
import { agentProposalSchema, privateSourceCitationSchema } from './product-agent.ts';

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
  key: z.string(), section: z.string(), sourceExcerpt: z.string(), text: z.string(), keywords: z.array(z.string()),
  originalText: z.string().optional(), pageStart: count.optional(), pageEnd: count.optional(),
  applicability: z.object({ region: z.string(), ageBasis: z.enum(['actual', 'corrected', 'any']),
    minAgeMonths: z.number().nullable(), maxAgeMonths: z.number().nullable(), maxAgeMonthsExclusive: z.boolean().optional(),
    topics: z.array(z.string()), conditions: z.array(z.string()) }),
  chunkId: uuid, sourceId: identifier, versionId: uuid, versionHash: z.string(), contentHash: z.string(),
  url: z.string(), title: z.string(), publisher: z.string(), classification: z.enum(['official_guidance', 'recent_information']),
  sourcePublishedAt: timestamp.nullable(), sourceUpdatedAt: timestamp.nullable(), sourceDateText: z.string().nullable().optional(),
  validUntil: timestamp.nullable().optional(), fetchedAt: timestamp, checkedAt: timestamp,
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
  provenance: z.object({ packVersion: z.string(), recipeId: z.string(), model: z.string() }).nullable(),
  runId: uuid, status: z.enum(['running', 'completed', 'stopped', 'unknown']), stopReason: z.string().nullable(),
  outcome: z.literal('no_action').optional(),
  text: z.string(), citations: z.array(agentCitationSchema), retrievalMode: z.enum(['vector_keyword', 'keyword_degraded', 'not_used']),
  privateSourceCitations: z.array(privateSourceCitationSchema).max(6).optional(),
  tools: z.array(z.object({ name: z.string().min(1), status: z.enum(['succeeded', 'rejected', 'conflict', 'failed', 'unknown']), reference: z.string().optional() })),
  countsKnown: z.boolean().optional(), counts: z.object({ modelCalls: count, toolCalls: count, queryEmbeddings: count }),
  proposals: z.array(agentSavedProposalSchema),
}).refine(value => value.outcome !== 'no_action' || value.status === 'completed' && value.text === ''
  && value.citations.length === 0 && !value.privateSourceCitations?.length && value.proposals.length === 0, 'No-action cannot carry user content');

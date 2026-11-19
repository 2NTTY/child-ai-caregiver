import { z } from 'zod';
import { KNOWLEDGE_EMBEDDING } from '../src/shared/knowledge.ts';
import { firestoreDomainHash } from './firestore-domain-data.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';

export const PRIVATE_INDEX_FAMILY = 'private-source-index';
export const PRIVATE_INDEX_COLLECTION = 'source_card_documents';
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const privateIndexBasis = z.tuple([digest, digest, z.uuid(), z.int().positive()]);
export const privateFact = z.strictObject({ type: z.enum(['quotation', 'visual_description']), text: z.string().trim().min(1).max(440) });
export const privateFacts = z.array(privateFact).max(8);
const cursor = z.strictObject({ page: z.int().positive().nullable(), offset: z.int().nonnegative() });
export type PrivateCursor = z.infer<typeof cursor>;
const binding = { cardId: z.uuid(), documentId: digest, version: digest, incarnation: z.uuid(), accessRevision: z.int().positive(),
  grant: digest, generation: z.uuid(), authorizationVersion: z.string().min(1).max(256) };
const receipt = z.strictObject({ rootRunId: z.uuid(), model: z.string().min(1).max(256),
  billingSource: z.enum(['personal','platform']), settingsVersion: z.string().min(1).max(256) });
export type PrivateStageReceipt = z.infer<typeof receipt>;
const proof = z.strictObject({ organize: receipt.nullable(), review: receipt.nullable(), embed: receipt.nullable() });
const location = { ordinal: z.int().positive(), ...cursor.shape };
export const privateIndexRecord = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('progress'), ...binding, ...location,
    stage: z.enum(['organize','review','embed','complete','unreadable','unknown']),
    next: cursor.nullable(), facts: privateFacts, proof, ready: z.int().nonnegative(), held: z.int().nonnegative(),
    attempt: z.strictObject({ rootRunId: z.uuid(), deadlineAtMs: z.int().positive(), lease: z.uuid(),
      stage: z.enum(['organize','review','embed']).optional(), model:receipt.shape.model.optional(),
      billingSource:receipt.shape.billingSource.optional(), settingsVersion:receipt.shape.settingsVersion.optional() }).nullable(),
    issue: z.string().max(80).nullable() }),
  z.strictObject({ kind: z.literal('unit'), ...binding, ...location, facts: privateFacts.min(1),
    proof: z.strictObject({ organize: receipt, review: receipt, embed: receipt })
      .refine(p => new Set([p.organize.rootRunId,p.review.rootRunId,p.embed.rootRunId]).size === 3 && p.embed.model === KNOWLEDGE_EMBEDDING.model),
    vector: z.array(z.number().finite()).length(KNOWLEDGE_EMBEDDING.dimensions), embeddingModel: z.literal(KNOWLEDGE_EMBEDDING.model) }),
  z.strictObject({ kind: z.literal('held'), ...binding, ...location, proof, issue: z.string().min(1).max(80) }),
]);
export type PrivateIndexRecord = z.infer<typeof privateIndexRecord>;
export type PrivateProgress = Extract<PrivateIndexRecord, {kind:'progress'}>;
export function privateIndexTag(scope: WorkRecoveryScope, generation: string, authorizationVersion: string, cardId: string, grant: string, accessRevision: number) {
  return firestoreDomainHash([PRIVATE_INDEX_FAMILY, scope, generation, authorizationVersion, cardId, grant, accessRevision]);
}
export function privateIndexId(scope: WorkRecoveryScope, row: Pick<PrivateIndexRecord, keyof typeof binding | 'kind' | 'page' | 'offset'>) {
  return firestoreDomainHash([privateIndexTag(scope,row.generation,row.authorizationVersion,row.cardId,row.grant,row.accessRevision),
    row.documentId,row.version,row.incarnation,row.kind,row.kind === 'progress' ? null : [row.page,row.offset]]);
}
export function privateIndexMetadata(scope: WorkRecoveryScope, row: PrivateIndexRecord) {
  return row.kind === 'unit' ? { id: privateIndexId(scope,row),
    targetTag: privateIndexTag(scope,row.generation,row.authorizationVersion,row.cardId,row.grant,row.accessRevision) } : {};
}

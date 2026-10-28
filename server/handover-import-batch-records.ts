import { z } from 'zod';
import { workRecoveryScopeSchema } from './firestore-work-continuation-recovery.ts';
import { handoverImportResolutionSchema } from './handover-import-records.ts';
import { firestoreDomainHash } from './firestore-domain-data.ts';
import { handoverImportSectionSchema, handoverImportTargetSchema } from '../src/shared/handover-imports.ts';

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/u), time = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative().max(2147483646), text = z.string().min(1).max(256);
export const importBatchSectionSchema = handoverImportSectionSchema;
export const importBatchTargetSchema = handoverImportTargetSchema;
export const importBatchRequestSchema = z.object({ opId: uuid, uploadId: uuid,
  uploadVersion: count.min(1).optional(), inputFingerprint: hash.optional(),
  source: z.object({ serverId: text, accountId: text, packageId: uuid, packageVersion: count.min(1), manifestSha256: hash }).strict(),
  integrity: z.enum(['trusted', 'untrusted_signer', 'missing_proof']), acceptedManifestSha256: hash.nullable(),
  targets: z.array(importBatchTargetSchema).min(1).max(10000), totalItems: count,
  resolutions: z.array(z.object({ sourceChildId: uuid, section: importBatchSectionSchema, resourceId: uuid,
    resolution: handoverImportResolutionSchema }).strict()).max(10000),
}).strict().refine(value => new Set(value.targets.map(row => row.sourceChildId)).size === value.targets.length
  && new Set(value.resolutions.map(row => JSON.stringify([row.sourceChildId, row.section, row.resourceId]))).size === value.resolutions.length
  && value.resolutions.every(row => value.targets.some(target => target.sourceChildId === row.sourceChildId && target.sections.includes(row.section)))
  && (value.integrity === 'trusted' || value.acceptedManifestSha256 === value.source.manifestSha256));
export const importBatchCountsSchema = z.object({ created: count, updated: count, skipped: count, conflict: count }).strict();
export const importBatchStateSchema = z.enum(['queued', 'running', 'completed', 'cancelled', 'failed', 'interrupted']);
export const importBatchSchema = z.object({ id: uuid, version: count.min(1), scope: workRecoveryScopeSchema,
  request: importBatchRequestSchema, fingerprint: hash, createdAt: time, updatedAt: time, state: importBatchStateSchema,
  targetScopes: z.array(workRecoveryScopeSchema).min(1).max(10000), authorizationVersion: text, generation: uuid, execution: count.min(1),
  position: count, cursor: z.string().min(1).max(16384).nullable(), counts: importBatchCountsSchema,
  claim: z.object({ workId: hash, token: uuid, until: time }).strict().nullable(), error: z.string().max(100).nullable(),
}).strict();
export type HandoverImportBatch = z.infer<typeof importBatchSchema>;
export type HandoverImportBatchRequest = z.infer<typeof importBatchRequestSchema>;
export const importBatchControlSchema = z.object({ opId: uuid, batchId: uuid, actorUserId: text, action: z.enum(['cancel', 'resume', 'fail']),
  fingerprint: hash, at: time, version: count.min(1), position: count, state: importBatchStateSchema,
  counts: importBatchCountsSchema, error: z.string().max(100).nullable() }).strict();
export type HandoverImportBatchControl = z.infer<typeof importBatchControlSchema>;
export const importBatchId = (owner: string, id: string) => JSON.stringify([owner, id]);
export const importBatchControlId = (owner: string, opId: string) => JSON.stringify([owner, opId]);
export const importBatchMetadata = (job: HandoverImportBatch) => ({ createdAt: job.createdAt, state: job.state });
export const importBatchControlMetadata = (event: HandoverImportBatchControl) => ({ batchId: event.batchId, createdAt: event.at });
export function validImportBatch(job: HandoverImportBatch) {
  return job.id === job.request.opId && job.fingerprint === firestoreDomainHash(job.request) && job.scope.childId === '00000000-0000-0000-0000-000000000000'
    && job.targetScopes.length === job.request.targets.length && job.targetScopes.every((scope, i) => scope.childId === job.request.targets[i].target.childId)
    && Object.values(job.counts).reduce((sum, value) => sum + value, 0) === job.position && job.position <= job.request.totalItems
    && (job.state !== 'completed' || job.position === job.request.totalItems && job.cursor === null)
    && (job.position !== 0 || job.cursor === null)
    && (job.position === 0 || job.position === job.request.totalItems || job.cursor !== null)
    && (job.state === 'running' ? job.claim !== null : job.claim === null);
}

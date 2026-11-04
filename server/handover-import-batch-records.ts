import { z } from 'zod';
import { workRecoveryScopeSchema } from './firestore-work-continuation-recovery.ts';
import { handoverImportResolutionSchema } from './handover-import-records.ts';
import { firestoreDomainHash } from './firestore-domain-data.ts';
import { classImportChildId } from './firestore-sharing-records.ts';
import { selfAvatarRestoreSchema, selfAvatarRestoreResultSchema } from '../src/shared/handover-imports.ts';
import { handoverImportSectionSchema, handoverImportTargetSchema, handoverImportResourceSectionSchema, handoverImportModuleOf, handoverImportModuleOutcomeSchema, originalBackupModuleSchema } from '../src/shared/handover-imports.ts';

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/u), time = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative().max(2147483646), text = z.string().min(1).max(256);
export const importBatchSectionSchema = handoverImportSectionSchema;
export const importBatchTargetSchema = handoverImportTargetSchema;
export const classImportSourceHash = (source: { serverId: string; accountId: string }, sourceChildId: string) =>
  firestoreDomainHash([source.serverId, source.accountId, sourceChildId]);
export const importBatchRequestSchema = z.object({ opId: uuid, uploadId: uuid,
  uploadVersion: count.min(1).optional(), inputFingerprint: hash.optional(),
  resolutionOnly: z.boolean().optional(), restoreOriginal: z.literal(true).optional(),
  accountAvatar: selfAvatarRestoreSchema.optional(),
  enrolSourceIds: z.array(uuid).min(1).max(100).optional(),
  source: z.object({ serverId: text, accountId: text, packageId: uuid, packageVersion: count.min(1), manifestSha256: hash }).strict(),
  integrity: z.enum(['trusted', 'untrusted_signer', 'missing_proof']), acceptedManifestSha256: hash.nullable(),
  targets: z.array(importBatchTargetSchema).max(10000), totalItems: count,
  resolutions: z.array(z.object({ sourceChildId: uuid, section: handoverImportResourceSectionSchema, resourceId: uuid,
    resolution: handoverImportResolutionSchema }).strict()).max(10000),
}).strict().refine(value => (value.targets.length > 0 || !!value.accountAvatar)
  && (!value.accountAvatar || value.restoreOriginal === true && value.resolutionOnly === true)
  && new Set(value.targets.map(row => row.sourceChildId)).size === value.targets.length
  && new Set(value.resolutions.map(row => JSON.stringify([row.sourceChildId, row.section, row.resourceId]))).size === value.resolutions.length
  && value.resolutions.every(row => value.targets.some(target => target.sourceChildId === row.sourceChildId && target.sections.includes(handoverImportModuleOf(row.section))))
  && (!value.restoreOriginal || value.resolutionOnly && value.acceptedManifestSha256 === value.source.manifestSha256
    && value.targets.every(row => row.target.spaceId === null && row.target.childId === row.sourceChildId
      && row.sections.every(module => originalBackupModuleSchema.safeParse(module).success)))
  && (!value.resolutionOnly || (value.resolutions.length > 0 || !!value.accountAvatar) && value.resolutions.every(row => row.resolution.mode !== 'preserve')
    && value.totalItems === value.resolutions.length + (value.accountAvatar ? 1 : 0))
  && (!value.enrolSourceIds || !value.resolutionOnly && new Set(value.enrolSourceIds).size === value.enrolSourceIds.length
    && value.enrolSourceIds.every(id => value.targets.some(row => row.sourceChildId === id && row.target.spaceId
      && row.target.childId === classImportChildId(row.target.spaceId, classImportSourceHash(value.source, id)))))
  && (value.integrity === 'trusted' || value.acceptedManifestSha256 === value.source.manifestSha256));
export const importBatchCountsSchema = z.object({ created: count, updated: count, skipped: count, conflict: count }).strict();
export const importBatchStateSchema = z.enum(['queued', 'running', 'completed', 'cancelled', 'failed', 'interrupted']);
export const importBatchSchema = z.object({ id: uuid, version: count.min(1), scope: workRecoveryScopeSchema,
  request: importBatchRequestSchema, fingerprint: hash, createdAt: time, updatedAt: time, state: importBatchStateSchema,
  targetScopes: z.array(workRecoveryScopeSchema).max(10000), authorizationVersion: text, generation: uuid, execution: count.min(1),
  accountAvatarResult: selfAvatarRestoreResultSchema.optional(),
  position: count, cursor: z.string().min(1).max(16384).nullable(), counts: importBatchCountsSchema,
  moduleCounts: z.array(handoverImportModuleOutcomeSchema).max(10).nullable().optional(),
  enrolments: z.array(z.object({ sourceChildId: uuid, outcome: z.enum(['created', 'skipped']), at: time }).strict()).max(100).optional(),
  failedEnrolment: z.object({ sourceChildId: uuid, error: z.string().min(1).max(100) }).strict().optional(),
  claim: z.object({ workId: hash, token: uuid, until: time }).strict().nullable(), error: z.string().max(100).nullable(),
}).strict();
export type HandoverImportBatch = z.infer<typeof importBatchSchema>;
export type HandoverImportBatchRequest = z.infer<typeof importBatchRequestSchema>;
export const importBatchControlSchema = z.object({ opId: uuid, batchId: uuid, actorUserId: text, action: z.enum(['cancel', 'resume', 'fail']),
  fingerprint: hash, at: time, version: count.min(1), position: count, state: importBatchStateSchema,
  failedEnrolment: uuid.optional(),
  counts: importBatchCountsSchema, error: z.string().max(100).nullable() }).strict();
export type HandoverImportBatchControl = z.infer<typeof importBatchControlSchema>;
export const importBatchId = (owner: string, id: string) => JSON.stringify([owner, id]);
export const importBatchControlId = (owner: string, opId: string) => JSON.stringify([owner, opId]);
export const growthImportScopes = (job: HandoverImportBatch) => ['queued', 'running'].includes(job.state)
  ? job.targetScopes.filter((_, i) => job.request.targets[i].sections.includes('growth')).map(scope => firestoreDomainHash(scope)) : [];
export const importBatchMetadata = (job: HandoverImportBatch) => ({ createdAt: job.createdAt, state: job.state,
  ...(growthImportScopes(job).length ? { growthImportScopes: growthImportScopes(job), batchId: job.id } : {}) });
export const importBatchControlMetadata = (event: HandoverImportBatchControl) => ({ batchId: event.batchId, createdAt: event.at });
export function initialImportModuleCounts(request: HandoverImportBatchRequest) {
  return handoverImportSectionSchema.options.filter(module => request.targets.some(target => target.sections.includes(module)))
    .map(module => ({ module, created: 0, updated: 0, skipped: 0, conflict: 0 }));
}
export function importModuleCounts(job: HandoverImportBatch) {
  return job.moduleCounts === undefined ? job.position === 0 ? initialImportModuleCounts(job.request) : null : job.moduleCounts;
}
export function validImportBatch(job: HandoverImportBatch) {
  const ids = job.request.enrolSourceIds ?? [], done = job.enrolments ?? [];
  const modules = job.moduleCounts, selected = initialImportModuleCounts(job.request);
  const validModules = modules == null || modules.length === selected.length
    && modules.every((row, i) => row.module === selected[i].module)
    && (['created', 'updated', 'skipped', 'conflict'] as const).every(outcome => modules.reduce((sum, row) => sum + row[outcome], 0) <= job.counts[outcome]);
  return job.id === job.request.opId && job.fingerprint === firestoreDomainHash(job.request) && job.scope.childId === '00000000-0000-0000-0000-000000000000'
    && (!job.request.restoreOriginal || job.request.source.accountId === job.scope.ownerUserId)
    && (job.request.accountAvatar ? (job.position > 0) === !!job.accountAvatarResult : !job.accountAvatarResult)
    && validModules
    && done.every((row, i) => row.sourceChildId === ids[i]) && (job.position === 0 && job.state !== 'completed' || done.length === ids.length)
    && (!job.failedEnrolment || job.failedEnrolment.sourceChildId === ids[done.length] && ['failed', 'interrupted'].includes(job.state))
    && job.targetScopes.length === job.request.targets.length && job.targetScopes.every((scope, i) => scope.childId === job.request.targets[i].target.childId)
    && Object.values(job.counts).reduce((sum, value) => sum + value, 0) === job.position && job.position <= job.request.totalItems
    && (job.state !== 'completed' || job.position === job.request.totalItems && job.cursor === null)
    && (job.position !== 0 || job.cursor === null)
    && (job.position === 0 || job.position === job.request.totalItems || job.cursor !== null)
    && (job.state === 'running' ? job.claim !== null : job.claim === null);
}

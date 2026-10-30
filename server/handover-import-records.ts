import { z } from 'zod';
import { importProvenanceLinkSchema } from '../src/shared/import-provenance.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { handoverImportResolutionSchema, handoverHistorySectionSchema } from '../src/shared/handover-imports.ts';
export { handoverImportResolutionSchema } from '../src/shared/handover-imports.ts';

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/u), time = z.iso.datetime({ offset: true });
const version = z.number().int().nonnegative().max(2147483647);
export const handoverSourceIdentitySchema = importProvenanceLinkSchema.shape.source.pick({
  serverId: true, accountId: true, childId: true, section: true, resourceId: true,
});
export type HandoverSourceIdentity = z.infer<typeof handoverSourceIdentitySchema>;
export const handoverImportResourceSchema = z.object({ id: uuid, version }).strict();
export type HandoverImportResolution = z.infer<typeof handoverImportResolutionSchema>;
export const handoverImportItemSchema = z.object({ opId: uuid, batchId: uuid, fingerprint: hash,
  sourceSection: handoverHistorySectionSchema.optional(),
  actorUserId: z.string().min(1).max(256), at: time, source: importProvenanceLinkSchema,
  outcome: z.enum(['created', 'updated', 'skipped', 'conflict']), reason: z.string().max(100).nullable(),
  resource: handoverImportResourceSchema.nullable(), changeSeq: z.string().regex(/^(0|[1-9][0-9]*)$/u).nullable(),
}).strict();
export type HandoverImportItem = z.infer<typeof handoverImportItemSchema>;
export const handoverImportMappingSchema = z.object({ source: handoverSourceIdentitySchema,
  sourceVersion: version, sourceHash: hash, target: handoverImportResourceSchema,
  revision: version.min(1), operationId: uuid, importedAt: time,
}).strict();
export type HandoverImportMapping = z.infer<typeof handoverImportMappingSchema>;
export function handoverImportItemId(scope: WorkRecoveryScope, opId: string) {
  return JSON.stringify([scope.ownerUserId, scope.workspaceId, scope.childId, opId]);
}
export function handoverImportMappingId(scope: WorkRecoveryScope, source: HandoverSourceIdentity) {
  return JSON.stringify([scope.ownerUserId, scope.workspaceId, scope.childId,
    source.serverId, source.accountId, source.childId, source.section, source.resourceId]);
}
export function handoverImportItemMetadata(value: HandoverImportItem) {
  return { opId: value.opId, batchId: value.batchId, section: handoverImportItemSection(value), createdAt: value.at, outcome: value.outcome };
}
export function handoverImportItemSection(value: HandoverImportItem) {
  return value.source.source.section === 'concern_events' ? 'concerns' : value.source.source.section;
}
export function handoverImportMappingMetadata(value: HandoverImportMapping) {
  return { section: value.source.section, targetId: value.target.id, targetVersion: value.target.version };
}

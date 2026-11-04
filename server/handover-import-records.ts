import { FirestoreDomainData, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { z } from 'zod';
import { readPrivateInstructionDeletion } from './firestore-content-erasure.ts';
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
  sourceSection: handoverHistorySectionSchema.optional(), documentRevisionHash: hash.optional(),
  actorUserId: z.string().min(1).max(256), at: time, source: importProvenanceLinkSchema,
  outcome: z.enum(['created', 'updated', 'skipped', 'conflict']), reason: z.string().max(100).nullable(),
  resource: handoverImportResourceSchema.nullable(), changeSeq: z.string().regex(/^(0|[1-9][0-9]*)$/u).nullable(),
}).strict();
export type HandoverImportItem = z.infer<typeof handoverImportItemSchema>;
export const handoverImportMappingSchema = z.object({ source: handoverSourceIdentitySchema, restoreOriginal: z.literal(true).optional(), documentRevisionHash: hash.optional(),
  retiredInstructionOpId: uuid.optional(), sourceVersion: version, sourceHash: hash, target: handoverImportResourceSchema,
  revision: version.min(1), operationId: uuid, importedAt: time,
}).strict().refine(value => !value.retiredInstructionOpId || value.restoreOriginal === true
  && value.source.section === 'instructions' && value.target.id !== value.source.resourceId);
export type HandoverImportMapping = z.infer<typeof handoverImportMappingSchema>;
const originalSections = new Set<HandoverSourceIdentity['section']>(['care', 'profile', 'tasks', 'private_sources',
  'documents', 'visit_preparation', 'child_avatar', 'concerns', 'instructions']);
export function supportsOriginalSection(section: HandoverSourceIdentity['section']) { return originalSections.has(section); }
export function validOriginalMapping(scope: WorkRecoveryScope, { source, target, retiredInstructionOpId }: HandoverImportMapping): boolean {
  if (source.accountId !== scope.ownerUserId || source.childId !== scope.childId || !supportsOriginalSection(source.section)) return false;
  if (retiredInstructionOpId) return source.section === 'instructions' && target.id !== source.resourceId;
  if (source.section === 'profile' || source.section === 'child_avatar' || source.section === 'visit_preparation')
    return source.resourceId === scope.childId && target.id === scope.childId;
  // A deleted record/source can have a new ID. A bounded concern slice points back to its original timeline.
  return source.section === 'care' || source.section === 'private_sources' || source.section === 'concerns' || target.id === source.resourceId;
}
export function handoverImportItemId(scope: WorkRecoveryScope, opId: string) {
  return JSON.stringify([scope.ownerUserId, scope.workspaceId, scope.childId, opId]);
}
export function handoverImportMappingId(scope: WorkRecoveryScope, source: HandoverSourceIdentity, restoreOriginal?: true) {
  return JSON.stringify([scope.ownerUserId, scope.workspaceId, scope.childId,
    source.serverId, source.accountId, source.childId, source.section, source.resourceId, ...(restoreOriginal ? ['original-backup'] : [])]);
}
export async function readImportMapping(data: FirestoreDomainData, binding: FirestoreAuthorityTransaction, source: HandoverSourceIdentity, restoreOriginal?: true) {
  const mappingId = handoverImportMappingId(binding.scope, source, restoreOriginal);
  const mappingRef = data.ref('handover_import_mappings', 'handover-import-mapping', mappingId);
  const snapshot = await binding.transaction.get(mappingRef);
  const mapping = snapshot.exists ? data.open('handover-import-mapping', mappingId, binding.scope, handoverImportMappingSchema, snapshot) : null;
  if (mapping && (mapping.restoreOriginal !== restoreOriginal || mapping.restoreOriginal && !validOriginalMapping(binding.scope, mapping)
    || firestoreDomainHash(mapping.source) !== firestoreDomainHash(source)
    || mapping.revision !== snapshot.get('recordVersion'))) domainReject('import_mapping_binding', 500);
  if (mapping?.retiredInstructionOpId) {
    const proof = mapping.restoreOriginal && await readPrivateInstructionDeletion(data, binding, source.resourceId);
    if (!proof || proof.operationId !== mapping.retiredInstructionOpId) domainReject('import_mapping_binding', 500);
  }
  return { mappingId, mappingRef, mapping };
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

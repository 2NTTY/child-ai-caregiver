import { z } from 'zod';
import type { CareRecord, ChildProfile } from '../src/shared/care.ts';
import type { CareTask } from '../src/shared/tasks.ts';
import type { HandoverIntegrity } from '../src/shared/handover.ts';
import type { HandoverImportRow } from './handover-import.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { createFirestoreSharingStore } from './firestore-sharing.ts';
import { createFirestoreCareStore, firestoreCareSchema, firestoreProfileSchema } from './firestore-care.ts';
import { createFirestoreOnlineStore } from './firestore-online.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, firestoreTaskSchema, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { makeImportProvenance } from './handover-provenance.ts';
import { handoverSourceIdentitySchema, handoverImportItemSchema, handoverImportMappingSchema,
  handoverImportResolutionSchema, handoverImportItemId, handoverImportMappingId,
  handoverImportItemMetadata, handoverImportMappingMetadata,
  type HandoverImportItem, type HandoverImportMapping, type HandoverImportResolution } from './handover-import-records.ts';

const targetSchema = z.object({ childId: z.uuid(), spaceId: z.uuid().nullable() }).strict();
type Target = z.infer<typeof targetSchema>;
type Section = 'care' | 'profile' | 'tasks';
export interface HandoverImportItemCommand {
  opId: string; batchId: string; target: Target; row: HandoverImportRow; integrity: HandoverIntegrity; resolution: HandoverImportResolution;
}

/** Internal coordinator: the package worker supplies verified rows and a fixed, authorized batch selection. */
export function createFirestoreHandoverImportItems(options: FirestoreDomainOptions) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options), sharing = createFirestoreSharingStore(options);
  const care = createFirestoreCareStore(options), online = createFirestoreOnlineStore(options);
  const sectionSchema = z.enum(['care', 'profile', 'tasks']);
  const schemas = { care: firestoreCareSchema, profile: firestoreProfileSchema, tasks: firestoreTaskSchema };
  const access = <T>(userId: string, target: Target, section: Section, mode: 'read' | 'write', use: (b: Binding) => Promise<T>) => target.spaceId
    ? sharing.withResource(userId, { spaceId: target.spaceId, childId: target.childId, module: section, mode }, value => use(value.binding))
    : authority.runTransaction(userId, target.childId, use);
  async function receipt(b: Binding, opId: string, section: Section) {
    const id = handoverImportItemId(b.scope, opId), row = await b.transaction.get(data.ref('handover_import_items', 'handover-import-item', id));
    if (!row.exists) return null;
    const value = data.open('handover-import-item', id, b.scope, handoverImportItemSchema, row);
    if (value.opId !== opId || value.source.source.section !== section || value.actorUserId !== b.actorUserId || row.get('recordVersion') !== 1)
      domainReject('import_item_binding', 403);
    return value;
  }
  async function apply(userId: string, raw: HandoverImportItemCommand) {
    const target = domainParse(targetSchema, raw.target), section = domainParse(sectionSchema, raw.row.section);
    const opId = domainParse(z.uuid(), raw.opId), batchId = domainParse(z.uuid(), raw.batchId);
    const resolution = domainParse(handoverImportResolutionSchema, raw.resolution);
    const sourceValue = domainParse(schemas[section] as z.ZodType<CareRecord | ChildProfile | CareTask>, raw.row.value, 'invalid_package_data');
    const fingerprint = firestoreDomainHash({ ...raw, userId });
    return access(userId, target, section, 'write', async b => {
      const prior = await receipt(b, opId, section);
      if (prior) {
        if (prior.fingerprint !== fingerprint) domainReject('operation_conflict');
        return prior;
      }
      const provenance = makeImportProvenance(raw.row, raw.integrity, b.actorUserId, new Date().toISOString());
      const { serverId, accountId, childId, resourceId } = provenance.current.source;
      const source = handoverSourceIdentitySchema.parse({ serverId, accountId, childId, section, resourceId });
      const mappingId = handoverImportMappingId(b.scope, source), mappingRef = data.ref('handover_import_mappings', 'handover-import-mapping', mappingId);
      const snapshot = await b.transaction.get(mappingRef);
      const mapping = snapshot.exists ? data.open('handover-import-mapping', mappingId, b.scope, handoverImportMappingSchema, snapshot) : null;
      if (mapping && (firestoreDomainHash(mapping.source) !== firestoreDomainHash(source) || mapping.revision !== snapshot.get('recordVersion')))
        domainReject('import_mapping_binding', 500);
      const careState = section === 'care' && mapping ? await care.readImportRecordState(b, mapping.target.id) : null;
      const current = section === 'profile' ? await care.readProfile(b)
        : mapping ? section === 'care' ? careState!.value
          : await online.readImportTask(b, target.childId, mapping.target.id) : null;
      const currentVersion = current?.version ?? careState?.version ?? 0;
      const currentId = current ? 'id' in current ? current.id : current.childId : mapping?.target.id ?? (section === 'profile' ? target.childId : null);
      const deleted = mapping !== null && (current === null || section === 'profile' && (current as ChildProfile).data === null)
        || section === 'profile' && currentVersion > 0 && (current as ChildProfile).data === null;
      const resultResource = currentId ? { id: currentId, version: currentVersion } : null;
      async function finish(outcome: HandoverImportItem['outcome'], reason: string | null, resource = resultResource, prepared?: { changeSeq: string; commit(): void }) {
        const auditChange = prepared ? null : await b.prepareChange(opId, section, false);
        const item = handoverImportItemSchema.parse({ opId, batchId, fingerprint, actorUserId: b.actorUserId, at: provenance.current.importedAt,
          source: provenance.current, outcome, reason, resource, changeSeq: prepared?.changeSeq ?? auditChange!.changeSeq });
        const id = handoverImportItemId(b.scope, opId), envelope = data.seal('handover-import-item', id, b.scope, handoverImportItemSchema, item);
        let next: HandoverImportMapping | null = null;
        if (prepared && resource) next = handoverImportMappingSchema.parse({ source, sourceVersion: sourceValue.version,
          sourceHash: provenance.current.sourceHash, target: resource, revision: (mapping?.revision ?? 0) + 1,
          operationId: opId, importedAt: provenance.current.importedAt });
        // Seal all records before the first write. Model/storage/network calls never occur in the callback.
        const mappingEnvelope = next ? data.seal('handover-import-mapping', mappingId, b.scope, handoverImportMappingSchema, next, next.revision) : null;
        prepared?.commit(); auditChange?.commit();
        if (next) b.transaction.set(mappingRef, { ...data.tags(b.scope), ...handoverImportMappingMetadata(next), ...mappingEnvelope });
        b.transaction.create(data.ref('handover_import_items', 'handover-import-item', id), { ...data.tags(b.scope), ...handoverImportItemMetadata(item), ...envelope });
        return item;
      }
      if (section === 'profile' && (sourceValue as ChildProfile).data === null) return finish('skipped', 'empty_profile');
      if (mapping && sourceValue.version === mapping.sourceVersion && provenance.current.sourceHash !== mapping.sourceHash)
        return finish('conflict', 'source_version_conflict');
      if (resolution.mode !== 'preserve' && (resolution.targetId !== currentId || resolution.expectedVersion !== currentVersion))
        return finish('conflict', 'target_version_conflict');
      if (deleted && resolution.mode !== 'restore_deleted') return finish('conflict', 'target_deleted');
      if (!deleted && resolution.mode === 'restore_deleted') return finish('conflict', 'target_not_deleted');
      if (mapping && sourceValue.version < mapping.sourceVersion) return finish('skipped', 'older_source');
      const locallyChanged = mapping ? currentVersion !== mapping.target.version : section === 'profile' && (current as ChildProfile).data !== null;
      if (!deleted && locallyChanged && resolution.mode !== 'replace_current') return finish('conflict', 'target_changed');
      if (!deleted && !locallyChanged && mapping && sourceValue.version === mapping.sourceVersion) return finish('skipped', 'already_imported');
      if (section === 'care') {
        const prepared = await care.prepareImportedRecord(b, opId, raw.row, raw.integrity,
          current ? { id: (current as CareRecord).id, expectedVersion: current.version } : undefined);
        return finish(current ? 'updated' : 'created', null, { id: prepared.value.id, version: prepared.value.version }, prepared);
      }
      if (section === 'profile') {
        const prepared = await care.prepareImportedProfile(b, opId, raw.row, raw.integrity, currentVersion);
        return finish(currentVersion > 0 ? 'updated' : 'created', null, { id: prepared.value.childId, version: prepared.value.version }, prepared);
      }
      const prepared = await online.prepareImportedTask(b, target.childId, opId, raw.row, raw.integrity,
        current ? { id: (current as CareTask).id, expectedVersion: current.version } : undefined);
      return finish(current ? 'updated' : 'created', null, { id: prepared.task.id, version: prepared.task.version }, prepared);
    });
  }
  return { apply, get(userId: string, raw: Target, opId: string, section: Section) {
    const target = domainParse(targetSchema, raw); domainParse(z.uuid(), opId); domainParse(sectionSchema, section);
    return access(userId, target, section, 'read', b => receipt(b, opId, section));
  } };
}

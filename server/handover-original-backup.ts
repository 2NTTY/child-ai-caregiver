import { z } from 'zod';
import type { CareRecord, ChildProfile } from '../src/shared/care.ts';
import type { CareTask } from '../src/shared/tasks.ts';
import { readImportMapping } from './handover-import-records.ts';
import { canonicalJson } from './online-routing.ts';
import { accountBackupComparisonQuerySchema, accountPreferencesComparisonSchema, originalBackupComparisonQuerySchema, originalBackupComparisonSchema,
  originalMemorySectionSchema, originalAttachmentSectionSchema, isOriginalAttachment, selfAvatarComparisonSchema,
  type OriginalBackupComparison } from '../src/shared/handover-imports.ts';
import { readOriginalAttachment } from './handover-original-attachments.ts';
import { createNotificationPreferencesData, sameNotificationPreferences } from './firestore-notification-preferences.ts';
import type { AvatarState } from '../src/shared/avatars.ts';
import { avatarBinding } from './avatar-data.ts';
import { avatarPublicState } from './avatar-policy.ts';
import { createFirestoreAvatarData } from './firestore-avatar-data.ts';
import { createFirestoreAuthority } from './firestore-authority.ts';
import { createFirestoreCareStore, firestoreCareSchema, firestoreProfileSchema } from './firestore-care.ts';
import { createFirestoreConcernStore, concernTransferSchema } from './firestore-concerns.ts';
import { createFirestorePrivateInstructions, firestorePrivateInstructionSchema } from './firestore-private-instructions.ts';
import { createFirestoreMemoryStore, firestoreFactSchema, firestoreTopicSchema } from './firestore-memory.ts';
import { createFirestoreChatStore } from './firestore-chat.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, firestoreTaskSchema, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { createFirestoreFamilyDocumentStore } from './firestore-family-documents.ts';
import { familyDocumentTransferSchema } from './family-document-transfer.ts';
import { createFirestoreCareSummary, firestorePreparationSchema } from './firestore-care-summary.ts';
import { createFirestoreOnlineStore } from './firestore-online.ts';
import { createFirestoreSharedInputStore, sharedInputImportSchema } from './firestore-shared-inputs.ts';
import type { createHandoverUploadService } from './handover-upload-service.ts';
import { avatarTransferSchema, fileTransferSchema, photoTransferSchema, voiceTransferSchema, type HandoverImportCursor } from './handover-import.ts';

type Uploads = ReturnType<typeof createHandoverUploadService>;
export interface OriginalBackupIssuer {
  serverId: string;
  matchesIssuedBackup(owner: string, id: string, manifestSha256: string, archiveSha256: string): Promise<boolean>;
}
export async function verifyOriginalBackup(owner: string, opened: Awaited<ReturnType<Uploads['open']>>, issuer?: OriginalBackupIssuer) {
  if (!issuer) domainReject('package_original_unavailable', 503);
  const { reader, job } = opened, manifest = reader.manifest;
  if (manifest.purpose !== 'backup' || manifest.source.serverId !== issuer.serverId || manifest.source.accountId !== owner)
    domainReject('package_original_unverified', 403);
  if (reader.integrity !== 'trusted' && !(reader.integrity === 'missing_proof' &&
    await issuer.matchesIssuedBackup(owner, manifest.packageId, reader.manifestSha256, job.request.sha256)))
    domainReject('package_original_unverified', 403);
}
const cursorSchema = z.object({ scope: z.string(), page: z.object({ manifestSha256: z.string(), selectionHash: z.string(),
  pageIndex: z.number().int().nonnegative(), rowIndex: z.number().int().nonnegative() }).strict() }).strict();

export function selfAvatarDifference(backup: Pick<AvatarState, 'asset'>, live: AvatarState) {
  if (!backup.asset) return 'empty_backup' as const;
  if (!live.asset) return live.version === 0 ? 'missing' as const : 'deleted' as const;
  return live.asset.sha256 === backup.asset.sha256 ? 'unchanged' as const : 'different' as const;
}

export function createAccountPreferencesComparison(options: FirestoreDomainOptions & { uploads: Uploads; originalBackup?: OriginalBackupIssuer }) {
  const authority = createFirestoreAuthority(options), preferences = createNotificationPreferencesData(new FirestoreDomainData(options));
  return async (owner: string, raw: unknown, signal: AbortSignal) => {
    const { uploadId, expectedUploadVersion } = domainParse(accountBackupComparisonQuerySchema, raw);
    const opened = await options.uploads.open(owner, uploadId, signal);
    try {
      if (expectedUploadVersion !== opened.job.version) domainReject('version_conflict');
      await verifyOriginalBackup(owner, opened, options.originalBackup);
      const { manifestSha256 } = opened.reader;
      const backup = await opened.reader.readNotificationPreferences(manifestSha256);
      return await authority.runTransaction(owner, null, async b => {
        const checkSource = await options.uploads.assertImportableIn(b, uploadId, expectedUploadVersion);
        const current = await preferences.read(b);
        checkSource(); signal.throwIfAborted();
        return accountPreferencesComparisonSchema.parse({ uploadId, manifestSha256, backupVersion: backup.version,
          localVersion: current.version, backup, current, state: sameNotificationPreferences(backup, current) ? 'unchanged' : 'different' });
      });
    } finally { await opened.dispose(); }
  };
}

export function createSelfAvatarComparison(options: FirestoreDomainOptions & { uploads: Uploads; originalBackup?: OriginalBackupIssuer }) {
  const authority = createFirestoreAuthority(options), data = createFirestoreAvatarData(options);
  return async (owner: string, raw: unknown, signal: AbortSignal) => {
    const { uploadId, expectedUploadVersion } = domainParse(accountBackupComparisonQuerySchema, raw);
    const opened = await options.uploads.open(owner, uploadId, signal);
    try {
      await verifyOriginalBackup(owner, opened, options.originalBackup);
      if (opened.job.version !== expectedUploadVersion) domainReject('version_conflict');
      const manifestSha256 = opened.reader.manifestSha256;
      const { head } = await opened.reader.readAccountAvatar(manifestSha256);
      return await authority.runTransaction(owner, null, async b => {
        const checked = await options.uploads.assertImportableIn(b, uploadId, expectedUploadVersion);
        const live = avatarPublicState(await data.head(b, avatarBinding(b.scope, { kind: 'self' })), false);
        checked();
        return selfAvatarComparisonSchema.parse({ uploadId, manifestSha256, backupVersion: head.version,
          localVersion: live.version, state: selfAvatarDifference(head, live) });
      });
    } finally { await opened.dispose(); }
  };
}

function comparisonValues(row: CareRecord | ChildProfile | CareTask | z.infer<typeof sharedInputImportSchema>) {
  if (!('sourceNotes' in row)) return row;
  // Compare restorable source content, excluding execution state and the permission to send excerpts to a model.
  const { kind, sourceId, sourceLabel, sourceUrl, sourceDateText, sourceNotes, text, management } = row;
  return { kind, sourceId, sourceLabel, sourceUrl, sourceDateText, sourceNotes, text,
    management: management ? { ...management, modelExcerpt: null } : null };
}

export function createOriginalBackupComparison(options: FirestoreDomainOptions & { uploads: Uploads; originalBackup?: OriginalBackupIssuer }) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options), care = createFirestoreCareStore(options), online = createFirestoreOnlineStore(options);
  const sources = createFirestoreSharedInputStore(options);
  const documents = createFirestoreFamilyDocumentStore(options), preparations = createFirestoreCareSummary(options, care);
  const avatars = createFirestoreAvatarData(options);
  const concerns = createFirestoreConcernStore(options);
  const instructions = createFirestorePrivateInstructions(data);
  const memory = createFirestoreMemoryStore({ ...options, care, chat: createFirestoreChatStore(options) });
  return async function compare(owner: string, raw: unknown, signal: AbortSignal): Promise<OriginalBackupComparison> {
    const input = domainParse(originalBackupComparisonQuerySchema, raw);
    if (!options.originalBackup) domainReject('package_original_unavailable', 503);
    const opened = await options.uploads.open(owner, input.uploadId, signal);
    try {
      const { reader, job } = opened, { manifest } = reader;
      if (job.version !== input.expectedUploadVersion) domainReject('version_conflict');
      await verifyOriginalBackup(owner, opened, options.originalBackup);
      if (!manifest.selection.childIds.includes(input.childId) || !manifest.selection.modules.includes(input.module))
        domainReject('package_scope_unavailable', 403);
      const aad = JSON.stringify(['original-backup-comparison:1', owner, input.uploadId, job.version, input.childId, input.module,
        ...(input.includeMemoryResources ? ['memory-resources'] : []), ...(input.includeAttachmentResources ? ['attachment-resources'] : [])]);
      let cursor: { scope: string; page: HandoverImportCursor } | null = null;
      if (input.cursor) {
        try { cursor = cursorSchema.parse(JSON.parse(options.cipher.decrypt(Buffer.from(input.cursor, 'base64url').toString(), aad))); }
        catch { domainReject('invalid_package_cursor', 400); }
      }
      const section = input.module === 'sources' ? 'private_sources' : input.module === 'attachments' ? 'child_avatar'
        : input.module === 'memory' ? 'instructions' : input.module;
      const page = await reader.readPage({ selection: { childIds: [input.childId], modules: [input.module] },
        sections: input.includeMemoryResources ? [...originalMemorySectionSchema.options]
          : input.includeAttachmentResources ? ['child_avatar', ...originalAttachmentSectionSchema.options]
          : section === 'documents' ? ['documents', 'visit_preparation'] : [section], acknowledgedManifestSha256: reader.manifestSha256,
        cursor: cursor?.page, limit: section === 'documents' ? 3 : section === 'concerns' ? 2 : 20 });
      // Package reads are ordered and outside Firestore's retryable transaction callback.
      const concernEvents: Awaited<ReturnType<typeof reader.readConcernEvents>>[] = [];
      if (section === 'concerns') for (const row of page.rows) {
        signal.throwIfAborted();
        concernEvents.push(await reader.readConcernEvents(row, reader.manifestSha256));
      }
      return await authority.runTransaction(owner, input.childId, async binding => {
        if (!await binding.readChild(input.childId)) domainReject('forbidden', 403);
        const checkUpload = await options.uploads.assertImportableIn(binding, input.uploadId, job.version);
        const scope = firestoreDomainHash([reader.manifestSha256, binding.scope, binding.authorizationVersion, binding.childAccessVersion, binding.changeSeq]);
        if (cursor && cursor.scope !== scope) domainReject('import_results_changed');
        const items: OriginalBackupComparison['items'] = [];
        for (const [rowIndex, row] of page.rows.entries()) {
          if (row.childId !== input.childId) domainReject('invalid_package_scope', 400);
          if (input.includeAttachmentResources && isOriginalAttachment(row.section)) {
            const kind = row.section;
            const backup = kind === 'photos' ? photoTransferSchema.parse(row.value)
              : kind === 'files' ? fileTransferSchema.parse(row.value) : voiceTransferSchema.parse(row.value);
            if (backup.childId !== binding.scope.childId) domainReject('invalid_package_scope', 400);
            const { mapping } = await readImportMapping(data, binding,
              { ...manifest.source, childId: backup.childId, section: kind, resourceId: backup.id }, true);
            const targetId = mapping?.target.id ?? backup.id, local = await readOriginalAttachment(data, binding, kind, targetId);
            const metadata = 'metadata' in backup ? backup.metadata : backup;
            const same = local.value && local.value.sha256 === metadata.sha256 && local.value.bytes === metadata.bytes && local.value.mimeType === metadata.mimeType;
            const state = backup.state !== 'ready' ? 'unavailable' : same ? 'unchanged' : local.deleted ? 'deleted' : 'unavailable';
            items.push({ id: backup.id, resourceSection: kind, ...(input.includeRestoreTarget && state !== 'unavailable' ? { targetId } : {}),
              backupVersion: backup.version, localVersion: local.version || null, state, changedFields: state === 'deleted' ? ['asset'] : [] });
            continue;
          }
          if (section === 'child_avatar') {
            const backup = domainParse(avatarTransferSchema, row.value);
            if (row.section !== section || backup.target.kind !== 'child' || backup.target.childId !== input.childId)
              domainReject('invalid_package_scope', 400);
            const head = await avatars.head(binding, avatarBinding(binding.scope, backup.target));
            const difference = head.removal?.state === 'pending' ? 'unavailable' : selfAvatarDifference(backup, avatarPublicState(head, false));
            const state = difference === 'empty_backup' ? 'unchanged' : difference === 'missing' ? 'unavailable' : difference;
            items.push({ id: input.childId, resourceSection: section, ...(input.includeRestoreTarget ? { targetId: input.childId } : {}),
              backupVersion: backup.version, localVersion: head.version, state, changedFields: state === 'different' || state === 'deleted' ? ['asset'] : [] });
            continue;
          }
          if (section === 'documents') {
            const kind = row.section;
            if (kind !== 'documents' && kind !== 'visit_preparation') domainReject('invalid_package_scope', 400);
            const backup = kind === 'documents' ? familyDocumentTransferSchema.parse(row.value) : firestorePreparationSchema.parse(row.value);
            if (backup.childId !== input.childId) domainReject('invalid_package_scope', 400);
            const id = 'id' in backup ? backup.id : backup.childId;
            const { mapping } = await readImportMapping(data, binding, { ...manifest.source, childId: input.childId, section: kind, resourceId: id }, true);
            const { value: live } = kind === 'documents' ? await documents.readImportState(binding, id) : await preparations.readImportState(binding);
            const fields = kind === 'documents' ? ['request','status','archivedAt','currentSnapshot'] : ['questions','checklist','appointmentTaskId','period'];
            const changedFields = live ? fields.filter(field => canonicalJson(Reflect.get(backup, field)) !== canonicalJson(Reflect.get(live, field))) : [];
            const unavailable = !live || mapping && mapping.target.id !== id || 'currentSnapshot' in backup && !backup.currentSnapshot?.readable
              || live && 'currentSnapshot' in live && !live.currentSnapshot?.readable;
            const restored = live && mapping?.target.version === live.version && mapping.sourceVersion === backup.version;
            items.push({ id, resourceSection: kind, ...(input.includeRestoreTarget ? { targetId: id } : {}), backupVersion: backup.version,
              localVersion: live?.version ?? null, changedFields: unavailable || restored ? [] : changedFields,
              state: unavailable || !live ? 'unavailable' : restored ? 'unchanged' : live.version > backup.version ? 'local_newer'
                : live.version < backup.version ? 'backup_newer' : changedFields.length ? 'different' : 'unchanged' });
            continue;
          }
          if (input.includeMemoryResources && (row.section === 'memory_facts' || row.section === 'memory_topics')) {
            const kind = row.section === 'memory_facts' ? 'facts' : 'topics';
            const backup = kind === 'facts' ? domainParse(firestoreFactSchema, row.value, 'invalid_package_data', 400)
              : domainParse(firestoreTopicSchema, row.value, 'invalid_package_data', 400);
            if (backup.childId !== input.childId) domainReject('invalid_package_scope', 400);
            const { mapping } = await readImportMapping(data, binding,
              { ...manifest.source, childId: input.childId, section: row.section, resourceId: backup.id }, true);
            const targetId = mapping?.target.id ?? backup.id;
            const local = await memory.readImportState(binding, kind, targetId), live = local.value;
            const restored = live && mapping?.target.version === live.version && mapping.sourceVersion === backup.version
              && mapping.sourceHash === firestoreDomainHash(row.value);
            const fields = kind === 'facts' ? ['key', 'content', 'source', 'status', 'visibility', 'intendedVisibility', 'validUntil', 'reason', 'confirmedAt', 'confirmedBy']
              : ['title', 'note', 'status', 'visibility', 'resumeAfter', 'reopenReason', 'reopenedFrom'];
            const changedFields = live && !restored ? fields.filter(key => canonicalJson(Reflect.get(live, key)) !== canonicalJson(Reflect.get(backup, key))) : [];
            const state = !live ? local.version > 0 ? 'deleted' : 'unavailable' : restored ? 'unchanged' : live.version > backup.version ? 'local_newer'
              : live.version < backup.version ? 'backup_newer' : changedFields.length ? 'different' : 'unchanged';
            items.push({ id: backup.id, resourceSection: row.section, ...(input.includeRestoreTarget && local.version > 0 ? { targetId } : {}),
              backupVersion: backup.version, localVersion: local.version || null, state, changedFields });
            continue;
          }
          if (row.section !== section) domainReject('invalid_package_scope', 400);
          if (section === 'instructions') {
            const backup = domainParse(firestorePrivateInstructionSchema, row.value, 'invalid_package_data', 400);
            if (backup.childId !== input.childId) domainReject('invalid_package_scope', 400);
            const id = backup.id;
            const { mapping } = await readImportMapping(data, binding, { ...manifest.source, childId: input.childId, section, resourceId: id }, true);
            const targetId = mapping?.target.id ?? id, local = await instructions.readImportState(binding, targetId), live = local.value;
            const restored = live && mapping?.target.version === live.version && mapping.sourceVersion === backup.version
              && mapping.sourceHash === firestoreDomainHash(row.value);
            const changedFields = live && !restored ? (['title', 'text', 'memoryKey', 'provenance', 'sourceMessageId', 'importedFrom'] as const)
              .filter(key => canonicalJson(live[key]) !== canonicalJson(backup[key])) : [];
            const state = !live ? local.version > 0 ? 'deleted' : 'unavailable' : restored ? 'unchanged' : live.version > backup.version ? 'local_newer'
              : live.version < backup.version ? 'backup_newer' : changedFields.length ? 'different' : 'unchanged';
            items.push({ id, resourceSection: section, ...(input.includeRestoreTarget && local.version > 0 ? { targetId } : {}),
              backupVersion: backup.version, localVersion: local.version || null, state, changedFields });
            continue;
          }
          if (section === 'concerns') {
            const backup = concernTransferSchema.parse(row.value), events = concernEvents[rowIndex]!;
            if (backup.childId !== input.childId) domainReject('invalid_package_scope', 400);
            const compared = await concerns.compareOriginal(binding, row, events);
            const { mapping } = await readImportMapping(data, binding,
              { ...manifest.source, childId: input.childId, section, resourceId: backup.id }, true);
            const restored = compared.state !== 'unavailable' && mapping?.target.id === compared.targetId && mapping.target.version === compared.localVersion
              && mapping.sourceVersion === backup.version && mapping.sourceHash === firestoreDomainHash({ value: row.value, events });
            items.push({ id: backup.id, ...(input.includeRestoreTarget ? { targetId: compared.targetId } : {}),
              backupVersion: backup.version, localVersion: compared.localVersion,
              state: restored ? 'unchanged' : compared.state, changedFields: restored ? [] : compared.changedFields });
            continue;
          }
          const original = section === 'private_sources' ? sharedInputImportSchema.parse(row.value)
            : input.module === 'care' ? firestoreCareSchema.parse(row.value) : input.module === 'profile'
            ? firestoreProfileSchema.parse(row.value) : firestoreTaskSchema.parse(row.value);
          if (original.childId !== input.childId || section === 'private_sources' && row.value.ownerUserId !== owner)
            domainReject('invalid_package_scope', 400);
          const id = 'id' in original ? original.id : original.childId;
          const { mapping } = await readImportMapping(data, binding, { ...manifest.source, childId: input.childId, section, resourceId: id }, true);
          const targetId = mapping?.target.id ?? id;
          const record = section === 'private_sources' ? await sources.readImportState(binding, targetId)
            : section === 'care' ? await care.readImportRecordState(binding, targetId) : null;
          const current = record ? record.value : input.module === 'profile' ? await care.readProfile(binding)
            : await online.readImportTask(binding, input.childId, targetId);
          const deleted = record ? !current && record.version > 0 :
            current && 'data' in current && current.data === null && current.version > 0 && 'data' in original && original.data !== null;
          const localVersion = current?.version ?? (record && record.version > 0 ? record.version : null);
          const alreadyRestored = !!current && mapping?.sourceHash === firestoreDomainHash(row.value) && mapping.target.version === current.version;
          const oldValues = comparisonValues(original), liveValues = current && comparisonValues(current);
          const changedFields = liveValues && !alreadyRestored ? Object.keys({ ...oldValues, ...liveValues }).filter(field => field !== 'version'
            && canonicalJson(Reflect.get(liveValues, field)) !== canonicalJson(Reflect.get(oldValues, field))).sort() : [];
          const state = deleted ? 'deleted' : !current || (input.module === 'profile' && localVersion === 0 && original.version > 0) ? 'unavailable' : alreadyRestored ? 'unchanged' : current.version > original.version ? 'local_newer'
            : current.version < original.version ? 'backup_newer' : changedFields.length ? 'different' : 'unchanged';
          items.push({ id, ...(input.includeRestoreTarget ? { targetId } : {}), backupVersion: original.version, localVersion, state, changedFields });
        }
        checkUpload(); signal.throwIfAborted();
        const nextCursor = page.nextCursor ? Buffer.from(options.cipher.encrypt(JSON.stringify({ scope, page: page.nextCursor }), aad)).toString('base64url') : null;
        return originalBackupComparisonSchema.parse({ uploadId: input.uploadId, childId: input.childId, module: input.module,
          manifestSha256: reader.manifestSha256, items, nextCursor });
      });
    } finally { await opened.dispose(); }
  };
}

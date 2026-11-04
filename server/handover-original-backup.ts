import { z } from 'zod';
import type { CareRecord, ChildProfile } from '../src/shared/care.ts';
import type { CareTask } from '../src/shared/tasks.ts';
import { readImportMapping } from './handover-import-records.ts';
import { canonicalJson } from './online-routing.ts';
import { originalBackupComparisonQuerySchema, originalBackupComparisonSchema, selfAvatarComparisonQuerySchema, selfAvatarComparisonSchema, type OriginalBackupComparison } from '../src/shared/handover-imports.ts';
import type { AvatarState } from '../src/shared/avatars.ts';
import { avatarBinding } from './avatar-data.ts';
import { avatarPublicState } from './avatar-policy.ts';
import { createFirestoreAvatarData } from './firestore-avatar-data.ts';
import { createFirestoreAuthority } from './firestore-authority.ts';
import { createFirestoreCareStore, firestoreCareSchema, firestoreProfileSchema } from './firestore-care.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, firestoreTaskSchema, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { createFirestoreOnlineStore } from './firestore-online.ts';
import { createFirestoreSharedInputStore, sharedInputImportSchema } from './firestore-shared-inputs.ts';
import type { createHandoverUploadService } from './handover-upload-service.ts';
import type { HandoverImportCursor } from './handover-import.ts';

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

export function createSelfAvatarComparison(options: FirestoreDomainOptions & { uploads: Uploads; originalBackup?: OriginalBackupIssuer }) {
  const authority = createFirestoreAuthority(options), data = createFirestoreAvatarData(options);
  return async (owner: string, raw: unknown, signal: AbortSignal) => {
    const { uploadId, expectedUploadVersion } = domainParse(selfAvatarComparisonQuerySchema, raw);
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
      const aad = JSON.stringify(['original-backup-comparison:1', owner, input.uploadId, job.version, input.childId, input.module]);
      let cursor: { scope: string; page: HandoverImportCursor } | null = null;
      if (input.cursor) {
        try { cursor = cursorSchema.parse(JSON.parse(options.cipher.decrypt(Buffer.from(input.cursor, 'base64url').toString(), aad))); }
        catch { domainReject('invalid_package_cursor', 400); }
      }
      const section = input.module === 'sources' ? 'private_sources' : input.module;
      const page = await reader.readPage({ selection: { childIds: [input.childId], modules: [input.module] },
        sections: [section], acknowledgedManifestSha256: reader.manifestSha256, cursor: cursor?.page, limit: 20 });
      return await authority.runTransaction(owner, input.childId, async binding => {
        if (!await binding.readChild(input.childId)) domainReject('forbidden', 403);
        const checkUpload = await options.uploads.assertImportableIn(binding, input.uploadId, job.version);
        const scope = firestoreDomainHash([reader.manifestSha256, binding.scope, binding.authorizationVersion, binding.childAccessVersion, binding.changeSeq]);
        if (cursor && cursor.scope !== scope) domainReject('import_results_changed');
        const items: OriginalBackupComparison['items'] = [];
        for (const row of page.rows) {
          if (row.childId !== input.childId || row.section !== section) domainReject('invalid_package_scope', 400);
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

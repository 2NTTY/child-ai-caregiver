import { z } from 'zod';
import { canonicalJson } from './online-routing.ts';
import { originalBackupComparisonQuerySchema, originalBackupComparisonSchema, type OriginalBackupComparison } from '../src/shared/handover-imports.ts';
import { createFirestoreAuthority } from './firestore-authority.ts';
import { createFirestoreCareStore, firestoreCareSchema, firestoreProfileSchema } from './firestore-care.ts';
import { domainParse, domainReject, firestoreDomainHash, firestoreTaskSchema, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { createFirestoreOnlineStore } from './firestore-online.ts';
import type { createHandoverUploadService } from './handover-upload-service.ts';
import type { HandoverImportCursor } from './handover-import.ts';

type Uploads = ReturnType<typeof createHandoverUploadService>;
export interface OriginalBackupIssuer {
  serverId: string;
  matchesIssuedBackup(owner: string, id: string, manifestSha256: string, archiveSha256: string): Promise<boolean>;
}
const cursorSchema = z.object({ scope: z.string(), page: z.object({ manifestSha256: z.string(), selectionHash: z.string(),
  pageIndex: z.number().int().nonnegative(), rowIndex: z.number().int().nonnegative() }).strict() }).strict();

export function createOriginalBackupComparison(options: FirestoreDomainOptions & { uploads: Uploads; originalBackup?: OriginalBackupIssuer }) {
  const authority = createFirestoreAuthority(options), care = createFirestoreCareStore(options), online = createFirestoreOnlineStore(options);
  return async function compare(owner: string, raw: unknown, signal: AbortSignal): Promise<OriginalBackupComparison> {
    const input = domainParse(originalBackupComparisonQuerySchema, raw);
    if (!options.originalBackup) domainReject('package_original_unavailable', 503);
    const opened = await options.uploads.open(owner, input.uploadId, signal);
    try {
      const { reader, job } = opened, { manifest } = reader;
      if (job.version !== input.expectedUploadVersion) domainReject('version_conflict');
      if (manifest.purpose !== 'backup' || manifest.source.serverId !== options.originalBackup.serverId || manifest.source.accountId !== owner)
        domainReject('package_original_unverified', 403);
      if (reader.integrity !== 'trusted' && !(reader.integrity === 'missing_proof' &&
        await options.originalBackup.matchesIssuedBackup(owner, manifest.packageId, reader.manifestSha256, job.request.sha256)))
        domainReject('package_original_unverified', 403);
      if (!manifest.selection.childIds.includes(input.childId) || !manifest.selection.modules.includes(input.module))
        domainReject('package_scope_unavailable', 403);
      const aad = JSON.stringify(['original-backup-comparison:1', owner, input.uploadId, job.version, input.childId, input.module]);
      let cursor: { scope: string; page: HandoverImportCursor } | null = null;
      if (input.cursor) {
        try { cursor = cursorSchema.parse(JSON.parse(options.cipher.decrypt(Buffer.from(input.cursor, 'base64url').toString(), aad))); }
        catch { domainReject('invalid_package_cursor', 400); }
      }
      const page = await reader.readPage({ selection: { childIds: [input.childId], modules: [input.module] },
        sections: [input.module], acknowledgedManifestSha256: reader.manifestSha256, cursor: cursor?.page, limit: 20 });
      return await authority.runTransaction(owner, input.childId, async binding => {
        if (!await binding.readChild(input.childId)) domainReject('forbidden', 403);
        const checkUpload = await options.uploads.assertImportableIn(binding, input.uploadId, job.version);
        const scope = firestoreDomainHash([reader.manifestSha256, binding.scope, binding.authorizationVersion, binding.childAccessVersion, binding.changeSeq]);
        if (cursor && cursor.scope !== scope) domainReject('import_results_changed');
        const items: OriginalBackupComparison['items'] = [];
        for (const row of page.rows) {
          if (row.childId !== input.childId || row.section !== input.module) domainReject('invalid_package_scope', 400);
          const original = input.module === 'care' ? firestoreCareSchema.parse(row.value) : input.module === 'profile'
            ? firestoreProfileSchema.parse(row.value) : firestoreTaskSchema.parse(row.value);
          if (original.childId !== input.childId) domainReject('invalid_package_scope', 400);
          const id = 'id' in original ? original.id : original.childId;
          const careState = input.module === 'care' ? await care.readImportRecordState(binding, id) : null;
          const current = careState ? careState.value : input.module === 'profile' ? await care.readProfile(binding)
            : await online.readImportTask(binding, input.childId, id);
          const deleted = careState ? !current && careState.version > 0 :
            current && 'data' in current && current.data === null && current.version > 0 && 'data' in original && original.data !== null;
          const localVersion = current?.version ?? (careState && careState.version > 0 ? careState.version : null);
          const changedFields = current ? Object.keys({ ...original, ...current }).filter(field => field !== 'version'
            && canonicalJson(Reflect.get(current, field)) !== canonicalJson(Reflect.get(original, field))).sort() : [];
          const state = deleted ? 'deleted' : !current ? 'unavailable' : current.version > original.version ? 'local_newer'
            : current.version < original.version ? 'backup_newer' : changedFields.length ? 'different' : 'unchanged';
          items.push({ id, backupVersion: original.version, localVersion, state, changedFields });
        }
        checkUpload(); signal.throwIfAborted();
        const nextCursor = page.nextCursor ? Buffer.from(options.cipher.encrypt(JSON.stringify({ scope, page: page.nextCursor }), aad)).toString('base64url') : null;
        return originalBackupComparisonSchema.parse({ uploadId: input.uploadId, childId: input.childId, module: input.module,
          manifestSha256: reader.manifestSha256, items, nextCursor });
      });
    } finally { await opened.dispose(); }
  };
}

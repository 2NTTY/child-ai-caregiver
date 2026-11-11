import { z } from 'zod';
import type { originalAttachmentSectionSchema } from '../src/shared/handover-imports.ts';
import { firebaseErasureIntentHash } from './firebase-erasure-journal.ts';
import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { firestoreChatFileRowSchema } from './firestore-chat-files.ts';
import { FirestoreDomainData, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import { firestorePhotoSchemas, photoObjectScope } from './firestore-photos.ts';
import { firestoreVoiceRowSchema } from './firestore-voice.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';

type Section = z.infer<typeof originalAttachmentSectionSchema>;
export const originalAttachmentKinds = { files: 'chat-file-asset', voices: 'voice-asset', photos: 'photo' } as const;
const collections = { files: 'chat_file_assets', voices: 'voice_assets', photos: 'photos' } as const;
const deletionTypes = { files: 'file-delete', voices: 'voice-delete', photos: 'photo-delete' } as const;
type Asset = z.infer<typeof firestoreChatFileRowSchema | typeof firestoreVoiceRowSchema | typeof firestorePhotoSchemas.photo>;

// Cleanup keeps the erasure journal and object address in their original epoch after disaster recovery.
export function originalAttachmentRetired(section: Section, row: Asset, scope: WorkRecoveryScope, id: string) {
  const deletion = row.deletion;
  if (row.id !== id || row.state !== 'deleted' || !deletion || row.scope.ownerUserId !== scope.ownerUserId
    || row.scope.workspaceId !== scope.workspaceId || row.scope.childId !== scope.childId) return false;
  const proof = 'journal' in deletion ? deletion.journal : deletion.proof;
  const intent = deletion.intent;
  return !!proof && (!('cleanup' in deletion) || deletion.cleanup === 'complete') && intent.type === deletionTypes[section]
    && intent.assetId === id && intent.scope.ownerUserId === scope.ownerUserId && intent.scope.workspaceId === scope.workspaceId
    && intent.scope.childId === scope.childId && proof.intentSha256 === firebaseErasureIntentHash(intent);
}

/** Owner-only comparison reads the typed asset in the same transaction as the import fence. */
export async function readOriginalAttachment(data: FirestoreDomainData, b: FirestoreAuthorityTransaction, section: Section, id: string) {
  if (b.sharedAccess || b.actorUserId !== b.scope.ownerUserId) domainReject('invalid_import_target', 403);
  const kind = originalAttachmentKinds[section], snapshot = await b.transaction.get(data.ref(collections[section], kind, id));
  if (!snapshot.exists) return { value: null, version: 0, deleted: false };
  const hint = snapshot.get('retiredStorageEpoch');
  const scope = hint === undefined ? b.scope : { ...b.scope, storageEpoch: z.uuid().parse(hint) };
  const tag = section === 'photos' ? [data.options.projectId, data.options.namespace, 'photo-scope', scope]
    : [section === 'voices' ? 'voice-scope' : 'chat-file-scope', scope];
  if (snapshot.get('scopeTag') !== firestoreDomainHash(tag)) return { value: null, version: 0, deleted: false };
  const row: Asset = section === 'photos' ? data.open(kind, id, scope, firestorePhotoSchemas.photo, snapshot)
    : section === 'voices' ? data.open(kind, id, scope, firestoreVoiceRowSchema, snapshot)
    : data.open(kind, id, scope, firestoreChatFileRowSchema, snapshot);
  if (row.id !== id || row.version !== snapshot.get('recordVersion') || firestoreDomainHash(row.scope) !== firestoreDomainHash(scope)
    || hint !== undefined && row.state !== 'deleted') domainReject('import_target_binding', 500);
  photoObjectScope(row);
  const value = row.state === 'ready' && row.descriptor ? { id, version: row.version, sha256: row.descriptor.sha256,
    bytes: row.descriptor.bytes, mimeType: row.descriptor.mimeType, importSourceHash: row.importedFrom?.current.sourceHash } : null;
  const retired = originalAttachmentRetired(section, row, scope, id);
  const deleted = retired && (section !== 'photos' || !(await b.transaction.get(data.ref('photo_cleanup', 'photo-cleanup', id))).exists);
  return { value, version: row.version, deleted };
}

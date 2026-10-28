import { domainReject } from './firestore-domain-data.ts';
import { isSharingKind, sharedSpaceSchema, sharedMembershipSchema, sharedOperationSchema } from './firestore-sharing-records.ts';
import { firestoreAuthoritySchemas as authority } from './firestore-authority.ts';
import type { FirestoreRestoreCodec, FirestoreRestoreDecoded } from './firestore-restore-codec.ts';
import type { FirebaseBackupDocument } from './firestore-backup.ts';
import { firestoreScopeErasureSchema } from './firestore-erasure.ts';
import { firebaseErasureIntentHash } from './firebase-erasure-journal.ts';

/** Preserve current ACLs, including a manager who joined after the data snapshot. No private business data is copied. */
export function replaySharingAuthority(codec: FirestoreRestoreCodec, restored: FirestoreRestoreDecoded[],
  live: readonly FirestoreRestoreDecoded[], documents: readonly FirebaseBackupDocument[]) {
  const byPath = new Map(documents.map(row => [row.path, row]));
  const liveById = new Map(live.map(row => [row.context.kind + ':' + row.context.id, row]));
  const append = (record: FirestoreRestoreDecoded) => {
    const document = byPath.get(record.path); if (!document) domainReject('restore_sharing_identity_missing');
    restored.push(codec.decode(document));
  };
  for (let index = restored.length - 1; index >= 0; index--) {
    const { kind, id } = restored[index]!.context;
    if(kind==='scope-erasure') {
      const current=liveById.get(kind+':'+id);
      if(current && firestoreScopeErasureSchema.parse(current.value).intent.type==='class-delete') {
        const before=firestoreScopeErasureSchema.parse(restored[index]!.value),after=firestoreScopeErasureSchema.parse(current.value);
        if(firebaseErasureIntentHash(before.intent)!==firebaseErasureIntentHash(after.intent))domainReject('restore_erasure_binding');
        // Replayed class control and its cleanup receipt must describe the same current lifecycle.
        restored.splice(index,1);continue;
      }
    }
    if (isSharingKind(kind) && (kind !== 'shared-operation' || liveById.has(kind + ':' + id))) restored.splice(index, 1);
  }
  for (const row of live) if (isSharingKind(row.context.kind)) append(row);
  const present = new Map(restored.map(row => [row.context.kind + ':' + row.context.id, row]));
  const add = (kind: string, id: string) => {
    const key = kind + ':' + id, record = liveById.get(key);
    if (!record) domainReject('restore_sharing_identity_missing');
    if (!present.has(key)) { append(record); present.set(key, record); }
    return record;
  };
  const spaces = live.filter(row => row.context.kind === 'shared-space').map(row => sharedSpaceSchema.parse(row.value)).filter(row => row.state === 'active');
  // Post-snapshot class control must retain its storage identity even when the snapshot has no class data yet.
  for(const row of live) if(row.context.kind==='shared-space') {
    const space=sharedSpaceSchema.parse(row.value);
    if(space.kind==='class') {
      add('workspace',space.id);
      if(space.erasureOperationId)add('scope-erasure',JSON.stringify([space.storageIdentity.ownerUserId,space.erasureOperationId]));
    }
  }
  const activeSpaces = new Map(spaces.map(row => [row.id,row])), users = new Set(spaces.filter(row=>!row.teacherSpaceId).map(row => row.managerUserId));
  for (const row of live) if (row.context.kind === 'shared-membership') {
    const member = sharedMembershipSchema.parse(row.value), account = liveById.get('account:' + member.userId);
    const space=activeSpaces.get(member.spaceId);
    if(space?.kind==='class'&&(space.teacherSpaceId||(space.directMembershipGeneration??null)!==(member.spaceGeneration??null)))continue;
    if (member.state === 'active' && space && account && authority.account.parse(account.value).status === 'active') users.add(member.userId);
  }
  for (const row of live) if (row.context.kind === 'shared-operation') {
    const actor = sharedOperationSchema.parse(row.value).actorUserId, account = liveById.get('account:' + actor);
    if (account && authority.account.parse(account.value).status === 'active') users.add(actor);
  }
  for (const id of users) {
    if (present.has('account:' + id)) continue;
    const identity = authority.identity.parse(add('authority-identity', id).value);
    const owner = authority.owner.parse(add('authority-owner', id).value);
    const existingInvite = present.get('authority-invitation:' + identity.email);
    if (existingInvite && authority.invitation.parse(existingInvite.value).consumedBy !== id) domainReject('restore_invitation_changed');
    add('account', id); add('workspace', owner.workspaceId); add('authority-invitation', identity.email);
  }
}

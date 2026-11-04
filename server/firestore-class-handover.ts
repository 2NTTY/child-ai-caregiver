import type { HandoverClassExportCommand } from '../src/shared/handover-jobs.ts';
import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import type { createFirestoreSharingStore, SharedResourceAccess } from './firestore-sharing.ts';

type Module = HandoverClassExportCommand['selection']['modules'][number];
type Sharing = Pick<ReturnType<typeof createFirestoreSharingStore>, 'inResourceTransaction'>;

/** The personal importer also serves classes. A family grant does not confer a class import role. */
export function assertClassImportAccess(binding: FirestoreAuthorityTransaction, module: 'growth' | 'concerns', mode: 'read' | 'write') {
  const grant = binding.sharedAccess;
  if (!grant) return;
  if (!grant.classMember || grant.classMember.userId !== binding.actorUserId || grant.classMember.spaceId !== grant.spaceId
    || binding.scope.workspaceId !== grant.spaceId || binding.scope.ownerUserId !== 'space:' + grant.spaceId
    || grant.module !== module || mode === 'write' && (grant.mode !== 'write' || grant.role === 'viewer'))
    domainReject('shared_domain_read_only', 403);
}

export function withClassExportChild<T>(sharing: Sharing, actor: FirestoreAuthorityTransaction,
  command: HandoverClassExportCommand, childId: string, module: Module,
  read: (access: SharedResourceAccess, sourceVersion: string) => Promise<T>) {
  const { spaceId } = command.source;
  if (!command.selection.childIds.includes(childId) || !command.selection.modules.includes(module))
    domainReject('invalid_export_scope', 400);
  return sharing.inResourceTransaction(actor, { spaceId, childId, module, mode: 'read' }, async access => {
    const shared = access.binding.sharedAccess;
    if (!shared?.classMember || access.scope.workspaceId !== spaceId || access.scope.ownerUserId !== 'space:' + spaceId
      || !command.selection.modules.every(value => shared.modules?.includes(value))) domainReject('module_not_shared', 403);
    // Roster/grant edits increment the class version. Domain writes advance the class workspace sequence.
    // The basis is common to selected pupils, but scoped to this actor, class membership and exact request.
    const basis = access.basis;
    const sourceVersion = firestoreDomainHash(['class-handover:1', command.opId, actor.actorUserId, actor.scope.storageEpoch,
      basis.actorAuthorizationVersion, spaceId, basis.spaceVersion, basis.teacherSpaceId ?? null, basis.teacherSpaceVersion ?? null,
      shared.classMember.membershipId, basis.membershipVersion, access.scope.storageEpoch,
      access.binding.authorizationVersion, access.binding.childAccessVersion, access.binding.changeSeq]);
    return read(access, sourceVersion);
  });
}

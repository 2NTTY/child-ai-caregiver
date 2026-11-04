import type { HandoverClassExportCommand } from '../src/shared/handover-jobs.ts';
import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import type { createFirestoreSharingStore, SharedResourceAccess } from './firestore-sharing.ts';

type Module = HandoverClassExportCommand['selection']['modules'][number];
type Sharing = Pick<ReturnType<typeof createFirestoreSharingStore>, 'inResourceTransaction'>;

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

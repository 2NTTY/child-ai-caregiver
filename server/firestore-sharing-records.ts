import { z } from 'zod';
import type { Transaction } from '@google-cloud/firestore';
import { FirestoreDomainData, firestoreDomainHash, domainReject } from './firestore-domain-data.ts';
import { workRecoveryScopeSchema, type WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import type { FirestoreRecoveryContext } from './firestore-recovery-envelope.ts';
export { sharedAccessBasisSchema } from '../src/shared/sharing.ts';
import { sharedModuleSchema } from '../src/shared/sharing.ts';
export { sharedModuleSchema, type SharedModule } from '../src/shared/sharing.ts';

const nil = '00000000-0000-0000-0000-000000000000';
const user = z.string().min(1).max(256), version = z.number().int().positive().max(2147483647);
const at = z.iso.datetime({ offset: true });
export const SHARING_SCOPE: WorkRecoveryScope = Object.freeze({ ownerUserId: 'system:sharing', workspaceId: nil, childId: nil, storageEpoch: nil });
export const sharedSpaceSchema = z.object({ id: z.uuid(), kind: z.enum(['family', 'teachers']), name: z.string().trim().min(1).max(160),
  version, state: z.enum(['active', 'dissolved']), managerUserId: user, managerGeneration: z.uuid(),
  storageIdentity: z.object({ ownerUserId: user, workspaceId: z.uuid() }).strict(),
  transferTargetUserId: user.nullable(), createdAt: at, updatedAt: at }).strict();
export const sharedMembershipSchema = z.object({ spaceId: z.uuid(), userId: user, label:z.string().min(1).max(320).optional(), membershipId: z.uuid(), version, stateVersion: version,
  role: z.enum(['owner', 'caregiver', 'viewer']), state: z.enum(['active', 'revoked']), joinedAt: at }).strict();
export const resourceShareSchema = z.object({ spaceId: z.uuid(), childId: z.uuid(), source: workRecoveryScopeSchema,
  modules: z.array(sharedModuleSchema).min(1).max(8), version, state: z.enum(['active', 'revoked']), sharedBy: user,
  sourceMembershipId: z.uuid() }).strict();
export const sharedInvitationSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/u), spaceId: z.uuid(), email: z.email().max(320),
  role: z.enum(['caregiver', 'viewer']), issuedVersion: version, managerGeneration: z.uuid(), expiresAt: at,
  state: z.enum(['issued', 'consumed', 'revoked']), consumedBy: user.nullable(), issuedBy: user }).strict();
export const sharedOperationSchema = z.object({ actorUserId: user, operationId: z.uuid(), action: z.string().min(1).max(64),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u), result: z.unknown(), at }).strict();
export const sharingRestoreSchemas = {
  'shared-space': { suffix: 'shared_spaces', schema: sharedSpaceSchema },
  'shared-membership': { suffix: 'shared_memberships', schema: sharedMembershipSchema },
  'resource-share': { suffix: 'resource_shares', schema: resourceShareSchema },
  'shared-invitation': { suffix: 'shared_invitations', schema: sharedInvitationSchema },
  'shared-operation': { suffix: 'shared_operations', schema: sharedOperationSchema },
} as const;
export type SharingKind = keyof typeof sharingRestoreSchemas;
export const isSharingKind = (kind: string): kind is SharingKind => Object.hasOwn(sharingRestoreSchemas, kind);
export function isSharingAuthorityPath(namespace: string, path: string) {
  return Object.values(sharingRestoreSchemas).some(record => path.startsWith(namespace + '_' + record.suffix + '/'));
}
export function sharingUserTag(userId: string) { return firestoreDomainHash(['sharing-user', userId]); }

/** Only routing metadata; resource bodies remain under their original owner-bound encryption. */
export function sharingMetadata(kind: SharingKind, value: any): Record<string, unknown> {
  if (kind === 'shared-space') return { entryId: value.id, managerTag: sharingUserTag(value.managerUserId), active: value.state === 'active' };
  if (kind === 'shared-membership') return { entryId: value.userId, spaceId: value.spaceId, memberTag: sharingUserTag(value.userId), active: value.state === 'active' };
  if (kind === 'resource-share') return { entryId: value.childId, spaceId: value.spaceId, sourceUserTag: sharingUserTag(value.source.ownerUserId), active: value.state === 'active' };
  if (kind === 'shared-invitation') return { entryId: value.id, spaceId: value.spaceId, active: value.state === 'issued' };
  return {};
}

export function sharingRestoreMetadata(context: FirestoreRecoveryContext & { kind: SharingKind }, raw: unknown) {
  const value = sharingRestoreSchemas[context.kind].schema.parse(raw);
  const check = (ok: boolean) => { if (!ok) domainReject('restore_sharing_binding'); };
  const { kind, id, scope } = context;
  check(context.family === 'domain' && context.envelopeVersion === 1);
  if (kind === 'shared-operation') {
    const row = sharedOperationSchema.parse(value);
    check(scope.childId === nil && scope.ownerUserId === row.actorUserId && scope.workspaceId !== nil
      && id === JSON.stringify([row.actorUserId, row.operationId]) && context.recordVersion === 1);
    return {};
  }
  check(firestoreDomainHash(scope) === firestoreDomainHash(SHARING_SCOPE));
  if (kind === 'shared-space') {
    const row = sharedSpaceSchema.parse(value);
    check(row.id === id && row.storageIdentity.workspaceId === row.id && row.storageIdentity.ownerUserId === 'space:' + row.id && row.version === context.recordVersion);
  } else if (kind === 'shared-membership') {
    const row = sharedMembershipSchema.parse(value);
    check(id === JSON.stringify([row.spaceId, row.userId]) && row.version === context.recordVersion);
  } else if (kind === 'resource-share') {
    const row = resourceShareSchema.parse(value);
    check(id === JSON.stringify([row.spaceId, row.childId]) && row.childId === row.source.childId && row.sharedBy === row.source.ownerUserId
      && row.version === context.recordVersion && new Set(row.modules).size === row.modules.length);
  } else {
    check(sharedInvitationSchema.parse(value).id === id && context.recordVersion === 1);
  }
  return sharingMetadata(kind, value);
}

/** Shared routing is not owned by an administrator; erasure targets the referenced personal identity/resource. */
export function sharingErasedBy(kind: string, raw: unknown, removed: WorkRecoveryScope, account: boolean): boolean {
  if (kind === 'shared-membership') return account && sharedMembershipSchema.parse(raw).userId === removed.ownerUserId;
  if (kind === 'shared-invitation') {
    const row = sharedInvitationSchema.parse(raw);
    return account && (row.issuedBy === removed.ownerUserId || row.consumedBy === removed.ownerUserId);
  }
  if (kind === 'resource-share') {
    const row = resourceShareSchema.parse(raw), source = row.source;
    return source.ownerUserId === removed.ownerUserId && (account || source.workspaceId === removed.workspaceId && source.childId === removed.childId);
  }
  return false;
}

export function transformSharingRecord(kind: SharingKind, raw: unknown, epochs: ReadonlyMap<string, string>) {
  const parsed = sharingRestoreSchemas[kind].schema.parse(raw);
  if (kind !== 'resource-share') return parsed;
  const row = resourceShareSchema.parse(parsed), epoch = epochs.get(row.source.workspaceId);
  return epoch ? { ...row, source: { ...row.source, storageEpoch: epoch } } : { ...row, state: 'revoked' as const };
}

/** A manager resolves ownership in the same product flow before account deletion. */
export async function assertNoManagedSharedSpaces(data: FirestoreDomainData, tx: Transaction, userId: string) {
  const page = await tx.get(data.collection('shared_spaces').where('managerTag', '==', sharingUserTag(userId)).where('active', '==', true).limit(1));
  for (const snapshot of page.docs) {
    const id = z.uuid().parse(snapshot.get('entryId'));
    const space = data.open('shared-space', id, SHARING_SCOPE, sharedSpaceSchema, snapshot);
    if (space.id !== id || space.managerUserId !== userId || space.state !== 'active') domainReject('sharing_binding', 500);
    domainReject('space_transfer_or_dissolve_required');
  }
}

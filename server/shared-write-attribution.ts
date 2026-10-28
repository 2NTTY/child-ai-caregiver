import { z } from 'zod';
import { sharedAccessBasisSchema } from '../src/shared/sharing.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';

/** Encrypted alongside the domain body; never supplied by a domain command or exposed in its public view. */
export const sharedWriteAttributionSchema = z.object({ actorUserId: z.string().min(1).max(256),
  sourceUserId: z.string().min(1).max(256), childId: z.uuid(), resourceId: z.uuid(),
  resourceVersion: z.number().int().positive(), spaceId: z.uuid(), basis: sharedAccessBasisSchema }).strict();
export type SharedWriteAttribution = z.infer<typeof sharedWriteAttributionSchema>;
/** A class task names a real member; the class storage identity cannot receive reminders. */
export const classTaskAssignmentSchema = z.object({ userId: z.string().min(1).max(128), spaceId: z.uuid(),
  membershipId: z.uuid(), membershipScopeId: z.uuid() }).strict();
export type ClassTaskAssignment = z.infer<typeof classTaskAssignmentSchema>;
export function sharedWriteAttribution(binding: FirestoreAuthorityTransaction, id: string, version: number): SharedWriteAttribution | undefined {
  const access = binding.sharedAccess;
  if (!access || binding.actorUserId === binding.scope.ownerUserId) return undefined;
  if (access.mode !== 'write' || access.role === 'viewer') throw Object.assign(new Error('Read-only shared binding'), { code: 'read_only', status: 403 });
  return sharedWriteAttributionSchema.parse({ actorUserId: binding.actorUserId, sourceUserId: binding.scope.ownerUserId,
    childId: binding.scope.childId, resourceId: id, resourceVersion: version, spaceId: access.spaceId, basis: access.basis });
}
export function validSharedAttribution(proof: SharedWriteAttribution | undefined, scope: WorkRecoveryScope,
  id: string, version: number, actor: string, creator = false): boolean {
  if (actor === scope.ownerUserId) return proof === undefined;
  return !!proof && proof.actorUserId === actor && proof.sourceUserId === scope.ownerUserId && proof.childId === scope.childId
    && proof.resourceId === id && (creator ? proof.resourceVersion === 1 : proof.resourceVersion === version);
}

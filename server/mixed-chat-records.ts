import { z } from 'zod';
import { mixedChatRoomSchema, mixedChatMessageSchema, mixedChildIdsSchema, mixedChatScopeSchema } from '../src/shared/mixed-chat.ts';
import { firestoreDomainUuid } from './firestore-domain-data.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';

const id = z.uuid(), fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
const membership = z.strictObject({membershipId:id, membershipScopeId:id}).nullable();
export const mixedRoomRecordSchema = mixedChatRoomSchema.extend({
  operationId:id, fingerprint, membership, latestMessageId:id.nullable(),
});
export const mixedMessageRecordSchema = mixedChatMessageSchema.extend({
  operationId:id, fingerprint, previousMessageId:id.nullable(), scope:mixedChatScopeSchema, childIds:mixedChildIdsSchema,
});
export type MixedRoomRecord = z.infer<typeof mixedRoomRecordSchema>;
export type MixedMessageRecord = z.infer<typeof mixedMessageRecordSchema>;
export type MixedKind = 'mixed-room' | 'mixed-message';

export function mixedRecordId(kind:MixedKind, ownerUserId:string, operationId:string) {
  return firestoreDomainUuid([kind, ownerUserId, operationId]);
}
export function validMixedRecord(kind:MixedKind, id:string, scope:WorkRecoveryScope, version:number, raw:unknown): boolean {
  const nil='00000000-0000-0000-0000-000000000000';
  if (scope.childId !== nil || scope.workspaceId === nil || scope.storageEpoch === nil) return false;
  if (kind === 'mixed-room') {
    const parsed=mixedRoomRecordSchema.safeParse(raw);
    if (!parsed.success) return false;
    const room=parsed.data;
    return room.id === id && mixedRecordId(kind,scope.ownerUserId,room.operationId) === id && version === room.version
      && (room.latestMessageId === null) === (room.version === 1)
      && (room.scope.kind === 'class') === (room.membership !== null);
  }
  const parsed=mixedMessageRecordSchema.safeParse(raw);
  return parsed.success && parsed.data.id === id && mixedRecordId(kind,scope.ownerUserId,parsed.data.operationId) === id
    && version === parsed.data.version && (parsed.data.previousMessageId === null) === (version === 2);
}

// Both live erasure and isolated restore apply this to each row, including messages whose room has been removed.
export function mixedChatErasedBy(kind:string, raw:unknown, ownerUserId:string,
  erasedScope:Pick<WorkRecoveryScope,'ownerUserId'|'workspaceId'|'childId'>, wholeOwner:boolean): boolean {
  if (kind !== 'mixed-room' && kind !== 'mixed-message') return false;
  if (wholeOwner && erasedScope.ownerUserId === ownerUserId) return true;
  const record=kind === 'mixed-room' ? mixedRoomRecordSchema.parse(raw) : mixedMessageRecordSchema.parse(raw);
  if (record.scope.kind === 'class') {
    return erasedScope.ownerUserId === 'space:'+record.scope.spaceId && erasedScope.workspaceId === record.scope.spaceId
      && (wholeOwner || record.childIds.includes(erasedScope.childId));
  }
  return erasedScope.ownerUserId === ownerUserId && record.childIds.includes(erasedScope.childId);
}

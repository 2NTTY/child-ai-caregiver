import { z } from 'zod';
import { mixedTaskBatchSchema } from '../src/shared/mixed-task-batch.ts';
import { mixedChatRoomSchema, mixedChatMessageSchema, mixedChildIdsSchema, mixedChatScopeSchema } from '../src/shared/mixed-chat.ts';
import { firestoreDomainHash, firestoreDomainUuid } from './firestore-domain-data.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';

const id = z.uuid(), fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
const membership = z.strictObject({membershipId:id, membershipScopeId:id}).nullable();
export const mixedRunScopeSchema=z.strictObject({roomId:id,scope:mixedChatScopeSchema,childIds:mixedChildIdsSchema,basis:fingerprint});
export const mixedRoomRecordSchema = mixedChatRoomSchema.extend({
  operationId:id, fingerprint, membership, latestMessageId:id.nullable(),
});
export const mixedMessageRecordSchema = mixedChatMessageSchema.extend({
  operationId:id, fingerprint, previousMessageId:id.nullable(), scope:mixedChatScopeSchema, childIds:mixedChildIdsSchema,
  taskBatch:mixedTaskBatchSchema.extend({epoch:id,authorizationVersion:z.string(),targetBasis:z.array(fingerprint).min(1).max(100),
    confirmed:z.boolean()}).optional(),
});
export type MixedRoomRecord = z.infer<typeof mixedRoomRecordSchema>;
export type MixedMessageRecord = z.infer<typeof mixedMessageRecordSchema>;
export type MixedKind = 'mixed-room' | 'mixed-message';

function validBatch(message:MixedMessageRecord,owner:string) {
  const batch=message.taskBatch;
  if (!batch) return true;
  if (batch.id!==firestoreDomainUuid(['mixed-task-batch',owner,message.roomId,message.id])
    || batch.items.length!==batch.targetBasis.length) return false;
  const targets=batch.action.kind==='create' ? (batch.action.childIds??message.childIds).map(childId=>({childId,taskId:null,expectedVersion:null}))
    : batch.action.targets;
  if (targets.length!==batch.items.length) return false;
  const initial=batch.items.map((item,i)=>({...item,taskId:targets[i].taskId,status:'pending',reason:null,version:null}));
  if (!initial.every((item,i)=>message.childIds.includes(item.childId) && item.childId===targets[i].childId
    && item.expectedVersion===targets[i].expectedVersion && item.operationId===firestoreDomainUuid(['mixed-task-item',batch.id,item.childId,item.taskId])
    && (batch.action.kind==='create' || batch.items[i].taskId===item.taskId))) return false;
  if (firestoreDomainHash([batch.id,batch.runId,batch.action,initial,batch.targetBasis,batch.authorizationVersion,batch.epoch])!==batch.digest) return false;
  const pending=batch.items.some(item=>item.status==='pending'), failed=batch.items.some(item=>item.status==='failed'||item.status==='conflict');
  if (!batch.items.every(item=>item.status!=='completed'||item.taskId!==null&&item.version!==null)) return false;
  if (batch.state==='awaiting_confirmation') return !batch.confirmed && batch.items.every(item=>item.status==='pending');
  if (batch.state==='cancelled') return !pending;
  return batch.confirmed && (batch.state==='running'?pending:!pending && (batch.state==='partial')===failed);
}

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
  return parsed.success && validBatch(parsed.data,scope.ownerUserId) && parsed.data.id === id && mixedRecordId(kind,scope.ownerUserId,parsed.data.operationId) === id
    && version === parsed.data.version && (parsed.data.previousMessageId === null) === (version === 2);
}

// Both live erasure and isolated restore apply this to each row, including messages whose room has been removed.
export function mixedChatErasedBy(kind:string, raw:unknown, ownerUserId:string,
  erasedScope:Pick<WorkRecoveryScope,'ownerUserId'|'workspaceId'|'childId'>, wholeOwner:boolean): boolean {
  const runScope=(kind === 'agent-run' || kind === 'agent-claim') && raw && typeof raw === 'object'
    && 'mixedChat' in raw ? mixedRunScopeSchema.parse(raw.mixedChat) : null;
  if (!runScope && kind !== 'mixed-room' && kind !== 'mixed-message') return false;
  if (wholeOwner && erasedScope.ownerUserId === ownerUserId) return true;
  const record=runScope ?? (kind === 'mixed-room' ? mixedRoomRecordSchema.parse(raw) : mixedMessageRecordSchema.parse(raw));
  if (record.scope.kind === 'class') {
    return erasedScope.ownerUserId === 'space:'+record.scope.spaceId && erasedScope.workspaceId === record.scope.spaceId
      && (wholeOwner || record.childIds.includes(erasedScope.childId));
  }
  return erasedScope.ownerUserId === ownerUserId && record.childIds.includes(erasedScope.childId);
}

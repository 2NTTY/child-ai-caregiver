import { z } from 'zod';
import { domainReject, firestoreTaskStorageSchema, firestoreTaskRevisionStorageSchema, firestoreTaskSchema,
  type FirestoreDomainData } from './firestore-domain-data.ts';
import { validSharedAttribution } from './shared-write-attribution.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';

export function validTaskAttribution(task: z.infer<typeof firestoreTaskStorageSchema>, scope: WorkRecoveryScope): boolean {
  const assignment = task.classAssignment;
  const validAssignee = scope.ownerUserId === 'space:' + scope.workspaceId
    ? assignment ? assignment.spaceId === scope.workspaceId && assignment.userId === task.assigneeUserId
      && !assignment.userId.startsWith('space:') : task.assigneeUserId === scope.ownerUserId
    : !assignment && task.assigneeUserId === scope.ownerUserId;
  return task.childId === scope.childId && validAssignee
    && validSharedAttribution(task.createdViaShare, scope, task.id, task.version, task.createdBy, true);
}
export function validTaskRevisionAttribution(revision: z.infer<typeof firestoreTaskRevisionStorageSchema>, scope: WorkRecoveryScope): boolean {
  return validTaskAttribution(revision.task, scope)
    && validSharedAttribution(revision.changedViaShare, scope, revision.task.id, revision.task.version, revision.actorUserId);
}

/** The actor's receipt contains only this version pointer, never a second copy of task content. */
export const sharedTaskPointerSchema = z.object({ format: z.literal('shared-task-result:1'), id: z.uuid(), version: z.number().int().positive() }).strict();
export async function readSharedTaskResult(data: FirestoreDomainData, binding: FirestoreAuthorityTransaction,
  pointer: z.infer<typeof sharedTaskPointerSchema>) {
  if (binding.sharedAccess?.module !== 'tasks') domainReject('shared_module_scope', 403);
  const id = JSON.stringify([pointer.id, pointer.version]);
  const row = await binding.transaction.get(data.ref('task_revisions', 'task-revision', id));
  if (!row.exists) return null;
  if (Object.entries(data.tags(binding.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('revision_binding', 500);
  const revision = data.open('task-revision', id, binding.scope, firestoreTaskRevisionStorageSchema, row);
  if (revision.task.id !== pointer.id || revision.task.version !== pointer.version || row.get('recordVersion') !== pointer.version
    || !validTaskRevisionAttribution(revision, binding.scope)) domainReject('revision_binding', 500);
  return { task: firestoreTaskSchema.parse(revision.task) };
}

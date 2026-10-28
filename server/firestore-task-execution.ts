import { createFirestoreAuthority, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { createFirestoreSharingStore } from './firestore-sharing.ts';
import { FirestoreDomainData, domainReject, firestoreDomainHash, firestoreTaskStorageSchema } from './firestore-domain-data.ts';
import { validTaskAttribution } from './firestore-task-records.ts';
import type { FirestoreTaskDelivery, FirestoreTaskWorkerOptions } from './firestore-task-worker.ts';

/** Resolve the saved assignee, then use the normal current account and shared-resource authority. */
export function createFirestoreTaskExecution(options: FirestoreTaskWorkerOptions,
  currentAuth: (userId:string)=>Promise<string>) {
  const data=new FirestoreDomainData(options), authority=createFirestoreAuthority(options), sharing=createFirestoreSharingStore(options);
  return async function execute<T>(job:FirestoreTaskDelivery,
    visit:(binding:FirestoreAuthorityTransaction,recipient:FirestoreAuthorityTransaction)=>Promise<T>):Promise<T> {
    if(!job.scope.ownerUserId.startsWith('space:')) {
      const email=await currentAuth(job.scope.ownerUserId);
      return authority.runTransaction(job.scope.ownerUserId,job.scope.childId,async b=>{
        if(b.identityEmail!==email)domainReject('task_auth_denied',403);
        return visit(b,b);
      });
    }
    if(job.scope.ownerUserId!=='space:'+job.scope.workspaceId)domainReject('task_binding',403);
    const read = async (tx:FirestoreAuthorityTransaction['transaction']) => {
      const row=await tx.get(data.ref('tasks','task',job.taskId));
      if(!row.exists)domainReject('not_found',404);
      if(Object.entries(data.tags(job.scope)).some(([key,value])=>row.get(key)!==value))domainReject('task_binding',403);
      const task=data.open('task',job.taskId,job.scope,firestoreTaskStorageSchema,row);
      if(task.id!==job.taskId||!validTaskAttribution(task,job.scope)||task.version!==row.get('recordVersion'))domainReject('task_binding',500);
      if(task.version!==job.taskVersion||task.occurrence.id!==job.occurrenceId)domainReject('task_scope_changed');
      if(!task.classAssignment)domainReject('task_assignee_unavailable');
      return task.classAssignment;
    };
    const assignment=await options.database.runTransaction(read,{readOnly:true});
    const email=await currentAuth(assignment.userId);
    return authority.runTransaction(assignment.userId,null,recipient=>{
      if(recipient.identityEmail!==email)domainReject('task_auth_denied',403);
      return sharing.inResourceTransaction(recipient,{spaceId:job.scope.workspaceId,childId:job.scope.childId,module:'tasks',mode:'write'},async access=>{
        const current=await read(access.transaction);
        if(firestoreDomainHash(current)!==firestoreDomainHash(assignment)
          ||firestoreDomainHash(current)!==firestoreDomainHash(access.binding.sharedAccess?.classMember))domainReject('task_assignee_changed',403);
        return visit(access.binding,recipient);
      });
    });
  };
}

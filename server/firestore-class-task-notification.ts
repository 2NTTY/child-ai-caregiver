import { z } from 'zod';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, domainReject, firestoreDomainHash, firestoreTaskStorageSchema, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { createFirestoreSharingStore } from './firestore-sharing.ts';
import { validTaskAttribution } from './firestore-task-records.ts';
import { firestoreTaskReminderId, firestoreTaskReminderSchema } from './firestore-task-worker.ts';
import { createNotificationPreferencesData } from './firestore-notification-preferences.ts';
import { nextReminderCheck, reminderDecision } from './task-policy.ts';

export const classReminderTargetSchema = z.object({
  spaceId: z.uuid(), childId: z.uuid(), taskId: z.uuid(), occurrenceId: z.uuid(),
  taskVersion: z.number().int().positive(), reminderId: z.uuid(),
}).strict();
export type ClassReminderTarget = z.infer<typeof classReminderTargetSchema>;
export const classDeviceTargetSchema = classReminderTargetSchema.extend({ consent: z.uuid() });
type Decision = {reason: null | 'task_unavailable' | 'quiet_hours'; nextAt?: string; previewText?: string};

export function createClassReminderPolicy(options: FirestoreDomainOptions, data: FirestoreDomainData) {
  const sharing = createFirestoreSharingStore(options), preferences = createNotificationPreferencesData(data);
  return async function validate(recipient: Binding, target: z.infer<typeof classDeviceTargetSchema>,
    currentConsent: string | undefined, purpose: 'send' | 'open' = 'send'): Promise<Decision> {
    const unavailable = {reason:'task_unavailable'} as const;
    if (target.consent !== currentConsent || recipient.actorUserId !== recipient.scope.ownerUserId || recipient.sharedAccess) return unavailable;
    try {
      return await sharing.inResourceTransaction(recipient, {spaceId:target.spaceId, childId:target.childId, module:'tasks',mode:'write'}, async ({binding:b}) => {
        if (!b.sharedAccess?.classMember) return unavailable;
        const row = await b.transaction.get(data.ref('tasks','task',target.taskId));
        if (!row.exists || Object.entries(data.tags(b.scope)).some(([key,value])=>row.get(key)!==value)) return unavailable;
        const task = data.open('task',target.taskId,b.scope,firestoreTaskStorageSchema,row);
        if (!validTaskAttribution(task,b.scope) || task.id !== target.taskId || task.childId !== target.childId || task.version !== row.get('recordVersion'))
          domainReject('task_binding',500);
        if (!task.classAssignment || firestoreDomainHash(task.classAssignment)!==firestoreDomainHash(b.sharedAccess.classMember)
          || task.assigneeUserId!==recipient.actorUserId || task.occurrence.id!==target.occurrenceId) return unavailable;
        const saved = await b.transaction.get(data.ref('task_reminders','task-reminder',target.reminderId));
        if (!saved.exists || Object.entries(data.tags(b.scope)).some(([key,value])=>saved.get(key)!==value)) return unavailable;
        const reminder = data.open('task-reminder',target.reminderId,b.scope,firestoreTaskReminderSchema,saved);
        if (reminder.id!==target.reminderId || reminder.id!==firestoreTaskReminderId(b.scope,target.occurrenceId,reminder.phase)
          || reminder.taskId!==task.id || reminder.taskVersion!==target.taskVersion || reminder.occurrenceId!==target.occurrenceId) return unavailable;
        if (purpose==='open') return {reason:null};
        if (task.version!==target.taskVersion || task.occurrence.state!=='scheduled') return unavailable;
        const prefs = await preferences.read(recipient), now = new Date(Date.now()).toISOString();
        const evidence = {authorized:true,assigneeEligible:true,deliveryUnknown:false,initialAt:null,followUpAt:null,lastOrdinaryBatchAt:null};
        const decision = reminderDecision(task,prefs,evidence,now);
        if (decision==='quiet') {
          const nextAt = nextReminderCheck(task,prefs,evidence,now);
          return nextAt ? {reason:'quiet_hours',nextAt} : unavailable;
        }
        return decision==='initial' ? {reason:null} : unavailable;
      });
    } catch (error) {
      if (error && typeof error==='object' && 'status' in error && [403,404,409].includes(Number(error.status))) return unavailable;
      throw error;
    }
  };
}

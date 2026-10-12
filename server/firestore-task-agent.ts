import { z } from 'zod';
import { FirestoreDomainData, domainReject, firestoreDomainHash, firestoreTaskSchema, firestoreReminderOutboxSchema, firestoreReminderOutboxId, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { firestoreTaskReminderSchema, firestoreTaskReminderId } from './firestore-task-worker.ts';
import type { FirestoreBackgroundWork } from './firestore-background-work.ts';

/** The event is a current Server reminder, never a model-created or caller-selected trigger. */
export function createFirestoreTaskAgentEvents(options: FirestoreDomainOptions) {
  const data = new FirestoreDomainData(options);
  async function current(b: Binding, taskId: string) {
    const row = await b.transaction.get(data.ref('tasks', 'task', taskId)); if (!row.exists) return null;
    if (Object.entries(data.tags(b.scope)).some(([k, v]) => row.get(k) !== v)) domainReject('not_found', 404);
    const task = data.open('task', taskId, b.scope, firestoreTaskSchema, row);
    if (task.id !== taskId || task.childId !== b.scope.childId || task.version !== row.get('recordVersion')) domainReject('task_binding', 500);
    if (task.occurrence.state !== 'scheduled' || task.assigneeUserId !== b.scope.ownerUserId || Date.parse(task.occurrence.dueAt) > Date.now()) return null;
    const key = firestoreReminderOutboxId(taskId, task.version), workRow = await b.transaction.get(data.ref('task_outbox', 'task-reminder-outbox', key));
    if (!workRow.exists) return null;
    const work = data.open('task-reminder-outbox', key, b.scope, firestoreReminderOutboxSchema, workRow);
    if (work.taskId !== task.id || work.taskVersion !== task.version || work.occurrenceId !== task.occurrence.id || work.generation !== b.generation
      || work.authorizationVersion !== b.authorizationVersion || !['pending', 'processed'].includes(work.state)) return null;
    const reminders = [];
    for (const phase of ['follow_up', 'initial'] as const) {
      const id = firestoreTaskReminderId(b.scope, task.occurrence.id, phase), row = await b.transaction.get(data.ref('task_reminders', 'task-reminder', id));
      if (!row.exists) continue;
      const reminder = data.open('task-reminder', id, b.scope, firestoreTaskReminderSchema, row);
      if (reminder.id !== id || reminder.taskId !== taskId || reminder.occurrenceId !== task.occurrence.id || reminder.phase !== phase) domainReject('reminder_binding', 500);
      if (reminder.taskVersion === task.version) reminders.push(reminder);
    }
    return reminders.length ? { task, reminder: reminders[0] } : null;
  }
  async function input(b: Binding, job: FirestoreBackgroundWork) {
    if (job.kind !== 'task-agent' || job.generation !== b.generation || job.authorizationVersion !== b.authorizationVersion
      || firestoreDomainHash(job.scope) !== firestoreDomainHash(b.scope)) return null;
    const reminderId = job.basis.split(':')[0]; if (!z.uuid().safeParse(reminderId).success) return null;
    const value = await current(b, job.resourceId); if (!value || value.reminder.id !== reminderId) return null;
    return { eventType: 'task_due', task: value.task, reminder: value.reminder };
  }
  return { current, input };
}

import { z } from 'zod';
import type { DocumentSnapshot } from '@google-cloud/firestore';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, domainReject, firestoreTaskSchema } from './firestore-domain-data.ts';
import { firestoreChatMessageSchema } from './chat-message-schema.ts';
import { createNotificationPreferencesData } from './firestore-notification-preferences.ts';
import { reminderLocalTime } from './task-policy.ts';
import { proactiveReceiptSchema, proactiveMessageId } from './proactive-chat.ts';
import { readProactivePolicy } from './firestore-proactive-wakes.ts';
import { firestoreTaskReminderSchema } from './firestore-task-worker.ts';

const uuid = z.uuid();
export const chatStateSchema = z.object({ notificationsEnabled: z.boolean(), previewEnabled: z.boolean().optional(), brandedCard: z.literal(true).optional(), presenceVersion: z.number().int().nonnegative(),
  childId: uuid.nullable(), expiresAt: z.iso.datetime().nullable() }).strict();
export const chatTargetSchema = z.object({ childId: uuid, messageId: uuid }).strict();
export const presenceLifetimeMs = 60_000;
export const chatReasonSchema = z.enum(['foreground_chat', 'awaiting_presence', 'chat_consent_disabled', 'quiet_hours', 'message_unavailable', 'proactive_disabled', 'task_unavailable']);

type ChatState = z.infer<typeof chatStateSchema>;
type ChatDelivery = {chatTarget?: z.infer<typeof chatTargetSchema>; delivery: {createdAt: string}};

export function createChatNotificationPolicy(data: FirestoreDomainData) {
  const preferences = createNotificationPreferencesData(data);
  function decode<T>(b: Pick<Binding, 'scope'>, row: DocumentSnapshot, kind: string, id: string, schema: z.ZodType<T>): T {
    if (!row.exists || Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
    return data.open(kind, id, b.scope, schema, row);
  }
  async function chatMessageAvailable(b: Binding, target: z.infer<typeof chatTargetSchema>) {
    if (!await b.readChild(target.childId)) return false;
    const child = { ...b, scope: { ...b.scope, childId: target.childId } };
    const row = await b.transaction.get(data.ref('chat_messages', 'chat-message', target.messageId));
    if (!row.exists || Object.entries(data.tags(child.scope)).some(([key, value]) => row.get(key) !== value)) return false;
    const message = decode(child, row, 'chat-message', target.messageId, firestoreChatMessageSchema);
    if (message.id !== target.messageId || message.childId !== target.childId || message.role !== 'model' || message.authorUserId !== null
      || row.get('messageId') !== target.messageId || row.get('createdAt') !== message.createdAt || row.get('recordVersion') !== 1) return false;
    return message;
  }
  async function chatEligibility(b: Binding, saved: ChatDelivery, subscribed: {chat?: ChatState}): Promise<{
    reason: z.infer<typeof chatReasonSchema> | null; nextAt?: string; previewText?: string | null;
  }> {
    if (!saved.chatTarget) return { reason: null };
    if (!subscribed.chat?.notificationsEnabled) return { reason: 'chat_consent_disabled' };
    const target = saved.chatTarget;
    const message = await chatMessageAvailable(b, target);
    if (!message) return { reason: 'message_unavailable' };
    if (message.proactive) {
      const child = { ...b, scope: { ...b.scope, childId: target.childId } },
        key = JSON.stringify([b.scope.ownerUserId, target.childId, 'proactive', target.messageId]);
      const row = await b.transaction.get(data.ref('chat_replies', 'chat-reply', key));
      if (!row.exists) return { reason: 'message_unavailable' };
      const receipt = decode(child, row, 'chat-reply', key, proactiveReceiptSchema);
      if (receipt.messageId !== target.messageId || proactiveMessageId(b.scope.ownerUserId, target.childId, receipt.origin, receipt.opId) !== target.messageId)
        domainReject('push_binding', 500);
      if (receipt.origin !== 'demo' && !(await readProactivePolicy(data, child)).enabled) return { reason: 'proactive_disabled' };
      if (receipt.origin === 'task') {
        const reminderRow = await b.transaction.get(data.ref('task_reminders', 'task-reminder', receipt.opId));
        if (!reminderRow.exists) return { reason: 'task_unavailable' };
        const reminder = decode(child, reminderRow, 'task-reminder', receipt.opId, firestoreTaskReminderSchema);
        if (reminder.id !== receipt.opId || reminder.taskVersion !== reminderRow.get('recordVersion')) domainReject('push_binding', 500);
        const taskRow = await b.transaction.get(data.ref('tasks', 'task', reminder.taskId));
        if (!taskRow.exists) return { reason: 'task_unavailable' };
        const task = decode(child, taskRow, 'task', reminder.taskId, firestoreTaskSchema);
        if (task.id !== reminder.taskId || task.childId !== target.childId || task.version !== taskRow.get('recordVersion')) domainReject('push_binding', 500);
        if (task.version !== reminder.taskVersion || task.occurrence.id !== reminder.occurrenceId || task.occurrence.state !== 'scheduled'
          || task.assigneeUserId !== b.scope.ownerUserId || Date.parse(task.occurrence.dueAt) > Date.now()) return { reason: 'task_unavailable' };
      }
    }
    if (subscribed.chat.childId === target.childId && subscribed.chat.expiresAt && Date.parse(subscribed.chat.expiresAt) > Date.now()) {
      // A handset killed after its last heartbeat cannot acknowledge a newer message.
      const observedAt = Date.parse(subscribed.chat.expiresAt) - presenceLifetimeMs;
      if (observedAt < Date.parse(saved.delivery.createdAt))
        return { reason: 'awaiting_presence', nextAt: subscribed.chat.expiresAt };
      return { reason: 'foreground_chat' };
    }
    const prefs = await preferences.read(b), start = Number(prefs.quietStart.slice(0, 2)) * 60 + Number(prefs.quietStart.slice(3)),
      end = Number(prefs.quietEnd.slice(0, 2)) * 60 + Number(prefs.quietEnd.slice(3));
    const quiet = (at: number) => {
      const minutes = reminderLocalTime(new Date(at).toISOString(), prefs.timeZone).minutes;
      return start !== end && (start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end);
    };
    if (!quiet(Date.now())) return { reason: null,
      ...(subscribed.chat.brandedCard ? { previewText: subscribed.chat.previewEnabled ? message.text : null } : {}) };
    // Scan real instants so a DST change cannot cause a guessed offset or premature retry.
    const from = (Math.floor(Date.now() / 60_000) + 1) * 60_000;
    for (let minute = 0; minute < 48 * 60; minute++) {
      const at = from + minute * 60_000;
      if (!quiet(at)) return { reason: 'quiet_hours', nextAt: new Date(at).toISOString() };
    }
    return { reason: 'quiet_hours', nextAt: new Date(Date.now() + 3_600_000).toISOString() };
  }
  return {chatMessageAvailable, chatEligibility};
}

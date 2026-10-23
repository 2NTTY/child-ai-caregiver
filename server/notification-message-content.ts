import { z } from 'zod';
import { notificationMessageContentSchema, type NotificationMessageContent } from '../src/shared/notification-messages.ts';
import { domainParse, domainReject } from './firestore-domain-data.ts';

export const contactMessageEvidenceSchema = z.object({
  attemptId: z.uuid(), recipientUserId: z.string().min(1).max(256),
  content: notificationMessageContentSchema,
}).strict();

/** Only a successful gateway's exact request content is eligible. Never reconstruct a legacy body. */
export function acceptedMessage(result: { status: string; message?: NotificationMessageContent }, channel: NotificationMessageContent['channel']) {
  if (result.status !== 'accepted' || !result.message) return undefined;
  const message = domainParse(notificationMessageContentSchema, result.message, 'message_content_binding', 500);
  if (message.channel !== channel) domainReject('message_content_binding', 500);
  return message;
}
export function messageSortMetadata(messages: readonly NotificationMessageContent[]) {
  const sentAt = messages.map(message => message.sentAt).sort()[0];
  return sentAt ? { messageSentAt: sentAt } : {};
}

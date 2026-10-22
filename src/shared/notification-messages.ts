import { z } from 'zod';

const instant = z.iso.datetime();
export const notificationMessageContentSchema = z.object({
  channel: z.enum(['web_push', 'native_push', 'telegram']),
  contentVersion: z.string().min(1).max(80),
  title: z.string().min(1).max(200).nullable(),
  body: z.string().min(1).max(4000),
  // The single provider request was issued at this time. Not device receipt/read time.
  sentAt: instant,
}).strict();
export type NotificationMessageContent = z.infer<typeof notificationMessageContentSchema>;

export const notificationMessageSchema = z.object({
  messageId: z.string().regex(/^(web_push|native_push|telegram|contact):[0-9a-f-]{36}$/u).refine(value => z.uuid().safeParse(value.split(':')[1]).success),
  contentVersion: z.literal(1),
  scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('account') }).strict(),
    z.object({ kind: z.literal('child'), childId: z.uuid(), childName: z.string().min(1).max(160) }).strict(),
  ]),
  sentAt: instant,
  contents: z.array(notificationMessageContentSchema).min(1).max(3).refine(contents => new Set(contents.map(content => content.channel)).size === contents.length),
}).strict();
export type NotificationMessage = z.infer<typeof notificationMessageSchema>;

export const notificationMessageCoverageSchema = z.object({
  kind: z.literal('recorded_provider_acceptances'),
  historical: z.literal('unknown'),
  excluded: z.tuple([z.literal('authentication_email'), z.literal('unconfirmed_or_unsaved_sends')]),
  pagination: z.literal('live'),
}).strict();
export const notificationMessagesPageSchema = z.object({
  schemaVersion: z.literal(1), userId: z.string().min(1).max(256),
  // Authority only: ordinary new messages do not change this scope version.
  scopeVersion: z.string().regex(/^[a-f0-9]{64}$/u),
  // First-page observation bound, not an isolated database snapshot.
  asOf: instant, items: z.array(notificationMessageSchema).max(20),
  nextCursor: z.string().min(1).max(16000).nullable(), complete: z.boolean(),
  coverage: notificationMessageCoverageSchema,
}).strict().refine(page => page.complete === (page.nextCursor === null));
export type NotificationMessagesPage = z.infer<typeof notificationMessagesPageSchema>;

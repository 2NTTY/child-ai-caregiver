import { z } from 'zod';
import { chatModes } from '../src/shared/chat.ts';
import { chatFileMessageReferenceSchema } from '../src/shared/chat-files.ts';
import { voiceMessageReferenceSchema } from '../src/shared/voice.ts';
import { photoMessageReferenceSchema } from '../src/shared/photos.ts';
import { officialHelpIdSchema } from '../src/shared/agent-feedback.ts';
import { chatDeliverySourceVersionSchema } from '../src/shared/chat-delivery-review.ts';

const uuid = z.uuid(), datetime = z.iso.datetime({ offset: true });
export const chatModeSchema = z.enum(chatModes);
export const messageText = z.string().refine(value => value.isWellFormed()
  && !value.includes('\0') && [...value].length <= 10_000);
export const originalChatMessageSchema = z.object({
  id: uuid, childId: uuid, authorUserId: z.string().min(1).max(256).nullable(),
  role: z.enum(['user', 'model']), text: messageText, inReplyTo: uuid.nullable(), createdAt: datetime,
  chatMode: chatModeSchema.optional(),
  proactive: z.literal(true).optional(), agentRunId: uuid.optional(), officialHelp: z.array(officialHelpIdSchema).max(2).optional(),
  voice: voiceMessageReferenceSchema.optional(), file: chatFileMessageReferenceSchema.optional(), photo: photoMessageReferenceSchema.optional(),
}).strict().refine(v => (!v.proactive || (v.role === 'model' && v.authorUserId === null && v.inReplyTo === null))
  && (!(v.voice || v.file || v.photo) || v.role === 'user') && [v.voice, v.file, v.photo].filter(Boolean).length <= 1
  && (v.text.trim().length > 0 || v.voice !== undefined || v.file !== undefined || v.photo !== undefined));

// Only the storage representation carries a derived-memory restriction. The original remains readable.
export const firestoreChatMessageStorageSchema = originalChatMessageSchema.safeExtend({
  memorySummaryUntil: datetime.optional(),
  memorySources: z.array(chatDeliverySourceVersionSchema).max(12).optional(),
});
export type StoredChatMessage = z.infer<typeof firestoreChatMessageStorageSchema>;
export const firestoreChatMessageSchema = firestoreChatMessageStorageSchema.transform(({ memorySummaryUntil, memorySources, ...message }) => message);

import { z } from 'zod';
import { chatFileMessageReferenceSchema } from '../src/shared/chat-files.ts';
import { voiceMessageReferenceSchema } from '../src/shared/voice.ts';
import { photoMessageReferenceSchema } from '../src/shared/photos.ts';
import { officialHelpIdSchema } from '../src/shared/agent-feedback.ts';

const uuid = z.uuid(), datetime = z.iso.datetime({ offset: true });
export const messageText = z.string().refine(value => value.isWellFormed()
  && !value.includes('\0') && [...value].length <= 10_000);
export const firestoreChatMessageSchema = z.object({
  id: uuid, childId: uuid, authorUserId: z.string().min(1).max(256).nullable(),
  role: z.enum(['user', 'model']), text: messageText, inReplyTo: uuid.nullable(), createdAt: datetime,
  proactive: z.literal(true).optional(), agentRunId: uuid.optional(), officialHelp: z.array(officialHelpIdSchema).max(2).optional(),
  voice: voiceMessageReferenceSchema.optional(), file: chatFileMessageReferenceSchema.optional(), photo: photoMessageReferenceSchema.optional(),
}).strict().refine(v => (!v.proactive || (v.role === 'model' && v.authorUserId === null && v.inReplyTo === null))
  && (!(v.voice || v.file || v.photo) || v.role === 'user') && [v.voice, v.file, v.photo].filter(Boolean).length <= 1
  && (v.text.trim().length > 0 || v.voice !== undefined || v.file !== undefined || v.photo !== undefined));

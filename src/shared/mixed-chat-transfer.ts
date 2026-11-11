import { z } from 'zod';
import { mixedChatMessageSchema, mixedChatScopeSchema, mixedChildIdsSchema } from './mixed-chat.ts';

export const mixedRoomPinSchema = z.strictObject({
  id: z.uuid(), version: z.int().positive(), childIds: mixedChildIdsSchema,
});
export type MixedRoomPin = z.infer<typeof mixedRoomPinSchema>;
export type MixedTransferScope = z.infer<typeof mixedChatScopeSchema>;

const citation = z.strictObject({
  sourceId: z.string().min(1), versionId: z.string().min(1), chunkId: z.string().min(1),
  title: z.string(), url: z.string(), section: z.string(),
  pageStart: z.int().optional(), pageEnd: z.int().optional(),
});
export const mixedTranscriptRowSchema = z.strictObject({
  message: mixedChatMessageSchema,
  reply: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('completed'), text: z.string(), citations: z.array(citation) }),
    z.strictObject({ status: z.enum(['not_started', 'running', 'unknown', 'stopped']) }),
  ]),
});
export type MixedTranscriptRow = z.infer<typeof mixedTranscriptRowSchema>;
export interface MixedTranscriptPage {
  items: MixedTranscriptRow[];
  nextCursor: string | null;
  from: string;
  to: string;
}

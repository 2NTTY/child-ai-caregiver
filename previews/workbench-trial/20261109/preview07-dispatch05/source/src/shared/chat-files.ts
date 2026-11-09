import { ATTACHMENT_LIST_BOUNDS, attachmentListPageFields, consistentAttachmentPage } from './attachment-list.ts';
import { z } from 'zod';

export const CHAT_FILE_LIMITS = Object.freeze({ bytes: 20 * 1024 * 1024, filesPerMessage: 1 });
export const chatFileMimeSchema = z.string().min(3).max(160).regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u);
export function normalizeChatFileMime(value: string): string {
  const parsed = chatFileMimeSchema.safeParse(value.toLowerCase().split(';', 1)[0]?.trim());
  return parsed.success ? parsed.data : 'application/octet-stream';
}
export const chatFileMetadataSchema = z.object({
  mimeType: chatFileMimeSchema, bytes: z.number().int().min(1).max(CHAT_FILE_LIMITS.bytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type ChatFileMetadata = z.infer<typeof chatFileMetadataSchema>;
export const chatFileReservationSchema = chatFileMetadataSchema.extend({
  opId: z.uuid(), fileName: z.string().min(1).max(200).refine(v => !/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(v)),
}).strict();
export type ChatFileReservation = z.infer<typeof chatFileReservationSchema>;
export const chatFileAttachmentSchema = z.object({
  id: z.uuid(), childId: z.uuid(), version: z.number().int().positive(), createdAt: z.iso.datetime({ offset: true }),
  state: z.enum(['reserved', 'uploading', 'unknown', 'ready', 'deleting', 'deleted']),
  fileName: z.string().min(1).max(200).nullable(), mimeType: chatFileMimeSchema.nullable(),
  bytes: z.number().int().min(1).max(CHAT_FILE_LIMITS.bytes).nullable(), sha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  messageId: z.uuid().nullable(),
}).strict();
export type ChatFileAttachment = z.infer<typeof chatFileAttachmentSchema>;
/** The message points to its private immutable original; it does not copy file contents. */
export const chatFileMessageReferenceSchema = chatFileMetadataSchema.extend({ id: z.uuid(), version: z.number().int().positive() }).strict();
export type ChatFileMessageReference = z.infer<typeof chatFileMessageReferenceSchema>;
export const chatFileLinkInputSchema = z.object({ id: z.uuid(), expectedVersion: z.number().int().positive() }).strict();

/** Metadata only; opaque videos remain files, not a new media capability. */
export const chatFileAttachmentPageSchema = z.object({
  items: z.array(chatFileAttachmentSchema.refine(value => value.state === 'ready' && value.messageId !== null
    && value.fileName !== null && value.mimeType !== null && value.bytes !== null && value.sha256 !== null))
    .max(ATTACHMENT_LIST_BOUNDS.maxLimit), ...attachmentListPageFields,
}).strict().refine(consistentAttachmentPage);
export type ChatFileAttachmentPage = z.infer<typeof chatFileAttachmentPageSchema>;

import { ATTACHMENT_LIST_BOUNDS, attachmentListPageFields, consistentAttachmentPage } from './attachment-list.ts';
import { z } from "zod";

export const VOICE_LIMITS = Object.freeze({ bytes: 5 * 1024 * 1024, durationMs: 120_000, filesPerMessage: 1 });
export const voiceMimeTypeSchema = z.enum(["audio/mp4", "audio/webm", "audio/ogg", "audio/wav", "audio/mpeg"]);
export type VoiceMimeType = z.infer<typeof voiceMimeTypeSchema>;
export function normalizeVoiceMimeType(value: string): VoiceMimeType | null {
  const mime = value.toLowerCase().split(";", 1)[0]!.trim();
  const aliases: Record<string, VoiceMimeType> = { "audio/m4a": "audio/mp4", "audio/x-m4a": "audio/mp4",
    "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/mp3": "audio/mpeg" };
  const parsed = voiceMimeTypeSchema.safeParse(aliases[mime] ?? mime);
  return parsed.success ? parsed.data : null;
}
export const voiceFileMetadataSchema = z.object({
  mimeType: voiceMimeTypeSchema, bytes: z.number().int().min(1).max(VOICE_LIMITS.bytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  durationMs: z.number().int().min(1).max(VOICE_LIMITS.durationMs),
}).strict();
export type VoiceFileMetadata = z.infer<typeof voiceFileMetadataSchema>;

export const voiceReservationSchema = z.object({
  opId: z.uuid(), fileName: z.string().min(1).max(200).refine(v => v.isWellFormed() && !/[\u0000-\u001f]/u.test(v)),
  mimeType: voiceMimeTypeSchema, bytes: z.number().int().min(1).max(VOICE_LIMITS.bytes), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type VoiceReservation = z.infer<typeof voiceReservationSchema>;
export const voiceAttachmentSchema = z.object({
  id: z.uuid(), childId: z.uuid(), version: z.number().int().positive(), createdAt: z.iso.datetime({ offset: true }),
  state: z.enum(['reserved', 'uploading', 'unknown', 'ready', 'deleting', 'deleted']),
  fileName: z.string().min(1).max(200).nullable(), mimeType: voiceMimeTypeSchema.nullable(),
  bytes: z.number().int().min(1).max(VOICE_LIMITS.bytes).nullable(), durationMs: z.number().int().min(1).max(VOICE_LIMITS.durationMs).nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(), messageId: z.uuid().nullable(), sharedSpaceId: z.uuid().optional(),
}).strict();
export type VoiceAttachment = z.infer<typeof voiceAttachmentSchema>;

/** Immutable audio identity stored on the original message; no audio bytes or transcript copy. */
export const voiceMessageReferenceSchema = voiceFileMetadataSchema.extend({ id: z.uuid(), version: z.number().int().positive() }).strict();
export type VoiceMessageReference = z.infer<typeof voiceMessageReferenceSchema>;
export const voiceLinkInputSchema = z.object({ id: z.uuid(), expectedVersion: z.number().int().positive() }).strict();

/** Metadata only; servers include unlinked published imports only when explicitly requested. */
export const voiceAttachmentPageSchema = z.object({
  items: z.array(voiceAttachmentSchema.refine(value => value.state === 'ready' && (!value.sharedSpaceId || value.messageId === null)
    && value.fileName !== null && value.mimeType !== null && value.bytes !== null && value.sha256 !== null && value.durationMs !== null))
    .max(ATTACHMENT_LIST_BOUNDS.maxLimit), ...attachmentListPageFields,
}).strict().refine(consistentAttachmentPage);
export type VoiceAttachmentPage = z.infer<typeof voiceAttachmentPageSchema>;

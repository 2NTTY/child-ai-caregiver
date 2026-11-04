import { z } from 'zod';
import { VOICE_LIMITS, voiceMessageReferenceSchema } from './voice.ts';
import { importProvenanceSchema, importProvenanceLinkSchema } from './import-provenance.ts';
export const voiceTranscriptDraftSchema = z.object({
  complete: z.boolean(),
  segments: z.array(z.object({ text: z.string().trim().min(1).max(2000),
    startMs: z.number().int().min(0).max(VOICE_LIMITS.durationMs).nullable(),
    endMs: z.number().int().min(0).max(VOICE_LIMITS.durationMs).nullable(),
    unclear: z.boolean(),
  }).strict().refine(v => v.startMs === null ? v.endMs === null : v.endMs !== null && v.endMs > v.startMs)).min(1).max(40),
}).strict().refine(v => v.segments.reduce((sum, item) => sum + item.text.length, 0) <= 6000);
export type VoiceTranscriptDraft = z.infer<typeof voiceTranscriptDraftSchema>;
export const voiceTranscriptSchema = z.object({ voice: voiceMessageReferenceSchema, messageId: z.uuid(),
  version: z.number().int().positive(), state: z.enum(['pending','running','available','unknown','stopped']),
  automatic: z.literal(true), updatedAt: z.iso.datetime({ offset: true }),
  reason: z.string().max(128).nullable(), retryAt: z.iso.datetime({ offset: true }).nullable(),
  content: voiceTranscriptDraftSchema.nullable(),
}).strict();
export type VoiceTranscript = z.infer<typeof voiceTranscriptSchema>;
/** Retained text belongs to an imported original, not to a replayable transcription attempt. */
export const importedVoiceTranscriptSchema = voiceTranscriptSchema.extend({ messageId: z.uuid().nullable(),
  importedFrom: importProvenanceSchema,
  origin: voiceTranscriptSchema.pick({ messageId: true, version: true, state: true, reason: true }).extend({ messageId: z.uuid().nullable() }),
}).strict();
export const storedVoiceTranscriptSchema = z.union([voiceTranscriptSchema, importedVoiceTranscriptSchema]);

const identityLinkSchema = importProvenanceLinkSchema.extend({ source: importProvenanceLinkSchema.shape.source.pick({
  serverId: true, accountId: true, childId: true, section: true, resourceId: true, resourceVersion: true,
  authorUserId: true, createdAt: true, confirmedBy: true, confirmedAt: true, confirmationBasis: true,
  assigneeUserId: true, concernReference: true,
}).strict() }).strict();
const identityProvenanceSchema = z.object({ current: identityLinkSchema, previous: z.array(identityLinkSchema).max(10000) }).strict();
const sharedOriginSchema = importedVoiceTranscriptSchema.shape.origin.extend({ messageId: z.null() });
/** An explicit attachment-only transfer retains text and original status without private chat links. */
export const sharedAttachmentVoiceTranscriptTransferSchema = voiceTranscriptSchema.extend({
  transferKind: z.literal('shared-attachment-transcript'), messageId: z.null(), sharedSpaceId: z.uuid(),
  origin: sharedOriginSchema, importedFrom: identityProvenanceSchema.optional(),
}).strict();
export const voiceTranscriptTransferSchema = z.union([storedVoiceTranscriptSchema, sharedAttachmentVoiceTranscriptTransferSchema]);

/** Shared wire views omit both local and imported private chat identities. */
export const voiceTranscriptViewSchema = z.union([voiceTranscriptSchema, importedVoiceTranscriptSchema, voiceTranscriptSchema.extend({
  messageId: z.null(), sharedSpaceId: z.uuid(),
}), importedVoiceTranscriptSchema.extend({ messageId: z.null(), sharedSpaceId: z.uuid(), origin: sharedOriginSchema,
  importedFrom: identityProvenanceSchema })]);
export type VoiceTranscriptView = z.infer<typeof voiceTranscriptViewSchema>;

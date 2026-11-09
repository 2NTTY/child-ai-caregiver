import { z } from 'zod';
import { VOICE_LIMITS, voiceMessageReferenceSchema } from './voice.ts';
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

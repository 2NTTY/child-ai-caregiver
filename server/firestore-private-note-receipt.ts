import { z } from 'zod';

const uuid = z.uuid(), time = z.iso.datetime({ offset: true }), version = z.number().int().min(0).max(2147483646);
export const firestoreAgentActionReceiptSchema = z.object({
  id: uuid, runId: uuid, kind: z.enum(['save_record', 'revise_record', 'save_private_note', 'revise_private_note', 'create_self_task', 'change_self_task']),
  resource: z.object({ kind: z.enum(['care_record', 'private_note', 'task']), id: uuid, version: version.min(1) }).strict(),
  state: z.enum(['saved', 'updated', 'scheduled', 'completed', 'cancelled']),
  notification: z.enum(['not_authorized', 'authorized_for_due_event']), channels: z.array(z.enum(['telegram', 'web_push', 'native_push'])).max(3),
  memoryOutcome: z.enum(['created', 'updated', 'duplicate']).optional(),
  sourceBasis: z.literal("voice_interpretation").optional(),
  createdAt: time, quantityGrounding: z.object({ status: z.enum(['source_supported', 'removed', 'absent', 'unchanged']) }).optional(),
}).strict();
export const firestoreAgentActionSavedSchema = z.object({
  receipt: firestoreAgentActionReceiptSchema, hash: z.string().regex(/^[a-f0-9]{64}$/u), sourceMessageId: uuid,
  sourceMessageIds: z.array(uuid).max(6), policyVersion: version,
  voiceEvidence: z.object({ kind: z.literal('voice_interpretation'), voiceId: uuid, voiceVersion: version.min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u), sourceMessageId: uuid, interpretedQuote: z.string().min(1).max(2000) }).strict().optional(),
}).strict();

export type FirestoreAgentActionSaved = z.infer<typeof firestoreAgentActionSavedSchema>;

/** Versions can rewind on disaster recovery. Permanent erasure retires the ID in every epoch. */
export function redactErasedNoteEvidence(saved: FirestoreAgentActionSaved, noteId: string): FirestoreAgentActionSaved {
  const resource = saved.receipt.resource;
  if (!saved.voiceEvidence || resource.kind !== 'private_note' || resource.id !== noteId) return saved;
  const { voiceEvidence: _evidence, ...redacted } = saved;
  return redacted;
}

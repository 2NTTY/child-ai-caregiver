import { z } from 'zod';

const text = z.string().min(1).max(256), time = z.iso.datetime({ offset: true });
const sourceSchema = z.object({ serverId: text, accountId: text, childId: z.uuid(), section: z.enum(['care', 'profile', 'tasks', 'memory_facts', 'memory_topics', 'instructions', 'summary_history', 'private_sources', 'documents', 'visit_preparation', 'files', 'voices', 'photos', 'child_avatar', 'chat', 'chat_imports', 'concerns', 'concern_events', 'growth_attention', 'growth_topics']),
  resourceId: z.uuid(), resourceVersion: z.number().int().nonnegative().max(2147483647),
  authorUserId: text.nullable(), createdAt: time.nullable(), confirmedBy: text.nullable(), confirmedAt: time.nullable(),
  confirmationBasis: z.enum(['explicit', 'preauthorized_user_statement', 'imported_source']).nullable(),
  assigneeUserId: text.nullable(),
  reopenedFrom: z.uuid().nullable().optional(),
  sourceMessageId: z.uuid().nullable().optional(),
  statementProvenance: z.enum(['user_statement', 'imported_source']).optional(),
  previousSummaryId: z.uuid().nullable().optional(),
  snapshotId: z.uuid().optional(),
  preparation: z.object({ appointmentTaskId: z.uuid().nullable(), reviewed: z.boolean(),
    reviewedBasis: z.string().min(3).max(128).nullable() }).strict().optional(),
  concern: z.object({ timelineId: z.uuid().nullable(), attentionIds: z.array(z.uuid()).max(202), updatedAt: time,
    followUp: z.object({ id: z.uuid(), at: time, state: z.enum(['pending', 'queued', 'completed', 'stopped', 'unknown', 'cancelled']),
      runId: z.uuid().nullable() }).strict().nullable() }).strict().optional(),
  concernEvent: z.object({ concernId: z.uuid(), sequence: z.number().int().positive(), timelineId: z.uuid().nullable(), sourceLabel: z.string().max(256),
    recordId: z.uuid().nullable(), taskId: z.uuid().nullable(), attentionId: z.uuid().nullable(),
    attentionVersion: z.number().int().positive().nullable(), runId: z.uuid().nullable() }).strict().optional(),
  growth: z.object({ evidence: z.object({ profileVersion: z.number().int().nonnegative(), facts: z.array(z.object({ id: z.uuid(), version: z.number().int().positive() }).strict()).max(8) }).strict(),
    previousId: z.uuid().nullable(), taskId: z.uuid().nullable(), taskState: z.string().max(80).nullable(), lastAction: z.string().max(80),
    sourceVersionId: z.uuid(), sourceChunkId: z.uuid(), sourceAvailable: z.boolean(), state: z.string().max(80) }).strict().optional(),
  growthTopic: z.enum(['solid_food', 'toddler_play', 'preschool_development', 'school_vision']).optional(),
}).strict();
export const importProvenanceLinkSchema = z.object({ source: sourceSchema, sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  packageId: z.uuid(), packageVersion: z.number().int().positive(), manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  integrity: z.enum(['trusted', 'untrusted_signer', 'missing_proof']), importedBy: text, importedAt: time,
}).strict();
/** Source identities are provenance, never local membership or execution authority. */
export const importProvenanceSchema = z.object({ current: importProvenanceLinkSchema,
  previous: z.array(importProvenanceLinkSchema).max(10000) }).strict();
export type ImportProvenance = z.infer<typeof importProvenanceSchema>;

import { z } from 'zod';

/** This format carries product data, never live execution or credential state. */
export const HANDOVER_MODULES = ['profile', 'care', 'chat', 'memory', 'tasks', 'documents', 'attachments', 'sources', 'concerns', 'growth'] as const;
/** Version-one product sections, shared by export and import; execution tables are deliberately absent. */
export const HANDOVER_SECTIONS = {
  profile: ['profile', 'profile_history'], care: ['care', 'care_history'], chat: ['chat'],
  memory: ['instructions', 'memory_facts', 'memory_fact_history', 'memory_topics', 'memory_topic_history', 'summary_history'],
  tasks: ['tasks', 'task_history'], documents: ['documents', 'document_versions', 'document_content', 'visit_preparation', 'visit_preparation_history'],
  attachments: ['photos', 'photo_content', 'voices', 'voice_content', 'voice_transcripts', 'files', 'file_content', 'child_avatar', 'child_avatar_content'],
  sources: ['private_sources', 'private_source_history'], concerns: ['concerns', 'concern_events', 'concern_history'],
  growth: ['growth_attention', 'growth_topics'],
} as const;
const text = (max: number) => z.string().min(1).max(max);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const handoverPathSchema = z.string().max(200).regex(/^(?:summary\.md|(?:data|attachments)\/[a-zA-Z0-9_-]+\.(?:json|bin))$/u);
export const handoverSelectionSchema = z.object({
  childIds: z.array(z.uuid()).min(1).max(10000), modules: z.array(z.enum(HANDOVER_MODULES)).min(1).max(HANDOVER_MODULES.length),
  period: z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }).strict().nullable(),
}).strict().refine(value => new Set(value.childIds).size === value.childIds.length && new Set(value.modules).size === value.modules.length
  && (!value.period || Date.parse(value.period.from) <= Date.parse(value.period.to)));
export const handoverHeaderSchema = z.object({
  format: z.literal('yuyoufang-data'), version: z.literal(1), packageId: z.uuid(), packageVersion: z.number().int().positive(),
  createdAt: z.iso.datetime({ offset: true }), purpose: z.enum(['handover', 'backup']),
  source: z.object({ serverId: text(256), accountId: text(256) }).strict(), selection: handoverSelectionSchema,
}).strict();
export const handoverCoverageSchema = z.object({ section: text(80), childId: z.uuid().nullable(), scopeVersion: hash,
  items: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), complete: z.literal(true) }).strict();
export const handoverEntrySchema = z.object({ path: handoverPathSchema, bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: hash, mediaType: text(200) }).strict();
export const handoverManifestSchema = handoverHeaderSchema.extend({ coverage: z.array(handoverCoverageSchema).max(10000),
  entries: z.array(handoverEntrySchema).min(1).max(10000) }).strict().refine(value =>
    new Set(value.entries.map(entry => entry.path)).size === value.entries.length
    && value.entries.some(entry => entry.path === 'summary.md')
    && value.coverage.every(entry => entry.childId === null || value.selection.childIds.includes(entry.childId))
    && new Set(value.coverage.map(entry => `${entry.childId}:${entry.section}`)).size === value.coverage.length);
export const handoverProofSchema = z.object({ algorithm: z.literal('Ed25519'), keyId: hash,
  publicKey: z.string().max(256), signature: z.string().max(128) }).strict();
export type HandoverHeader = z.infer<typeof handoverHeaderSchema>;
export type HandoverCoverage = z.infer<typeof handoverCoverageSchema>;
export type HandoverEntry = z.infer<typeof handoverEntrySchema>;
export type HandoverManifest = z.infer<typeof handoverManifestSchema>;
export type HandoverIntegrity = 'trusted' | 'untrusted_signer' | 'missing_proof';

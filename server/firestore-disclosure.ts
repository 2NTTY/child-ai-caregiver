import { z } from 'zod';
import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainReject } from './firestore-domain-data.ts';

export type ContentKind = 'care' | 'profile' | 'fact' | 'topic';
export const contentPointerSchema = z.object({ format: z.literal('content-receipt:1'), kind: z.enum(['care', 'profile', 'fact', 'topic']),
  id: z.uuid(), version: z.number().int().positive(), key: z.enum(['record', 'profile', 'fact', 'topic']) }).strict();
const parents = { care: ['care_records', 'care-record'], profile: ['child_profiles', 'child-profile'],
  fact: ['memory_facts', 'memory-fact'], topic: ['memory_topics', 'memory-topic'] } as const;

/** One current-resource gate for history, exports and original-operation disclosure. */
export async function contentVisible(data: FirestoreDomainData, binding: FirestoreAuthorityTransaction,
  kind: ContentKind, id: string, version: number, exact = false): Promise<boolean> {
  const [suffix, storageKind] = parents[kind], row = await binding.transaction.get(data.ref(suffix, storageKind, id));
  if (!row.exists) return false;
  if (Object.entries(data.tags(binding.scope)).some(([key, tag]) => row.get(key) !== tag)) domainReject('disclosure_binding', 500);
  if (kind !== 'profile' && row.get('live') !== true) return false;
  const current = data.open(storageKind, id, binding.scope, z.object({ version: z.number().int().nonnegative() }).passthrough(), row);
  if (current.version !== row.get('recordVersion')) domainReject('disclosure_binding', 500);
  return version <= current.version && (!exact || version === current.version)
    && (kind !== 'profile' || version >= (row.get('historyFloor') ?? 1));
}
export function contentResult(path: string, raw: unknown): z.infer<typeof contentPointerSchema> | null {
  if (!raw || typeof raw !== 'object') return null;
  const match = /^\/api\/children\/[^/]+\/(records|care(?:\/|$)|profile(?:\/|$)|memory\/(facts|topics)(?:\/|$))/u.exec(path);
  if (!match) return null;
  const kind: ContentKind = match[1].startsWith('profile') ? 'profile' : match[2] === 'facts' ? 'fact' : match[2] === 'topics' ? 'topic' : 'care';
  const key = kind === 'care' ? 'record' : kind, body = (raw as Record<string, unknown>)[key];
  if (!body || typeof body !== 'object') return null;
  const item = body as Record<string, unknown>;
  return contentPointerSchema.parse({ format: 'content-receipt:1', kind, key, id: kind === 'profile' ? item.childId : item.id, version: item.version });
}
export async function readContentPointer(data: FirestoreDomainData, binding: FirestoreAuthorityTransaction,
  pointer: z.infer<typeof contentPointerSchema>): Promise<unknown> {
  if (!await contentVisible(data, binding, pointer.kind, pointer.id, pointer.version, true)) return null;
  const [suffix, kind] = parents[pointer.kind], row = await binding.transaction.get(data.ref(suffix, kind, pointer.id));
  const raw = data.open(kind, pointer.id, binding.scope, z.record(z.string(), z.unknown()), row);
  const { createdViaShare, confirmedViaShare, changedViaShare, ...value } = raw;
  return { [pointer.key]: value };
}

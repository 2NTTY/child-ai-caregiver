import { z } from 'zod';
import { registeredSourceCardSchema, registeredSourceResultSchema, registeredSourceUrlSchema } from '../src/shared/registered-source-card.ts';
import { firestoreDomainHash } from './firestore-domain-data.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';

const timestamp = z.iso.datetime({ offset: true });
const credentialInput = { operationId: z.uuid(), expectedRevision: z.int().positive() };
const loginFields = { username: z.string().trim().min(1).max(512), password: z.string().min(1).max(4096) };
export const sourceCredentialCommand = z.discriminatedUnion('action', [
  z.strictObject({ ...credentialInput, action: z.literal('replace'), ...loginFields, loginUrl: registeredSourceUrlSchema.optional() }),
  z.strictObject({ ...credentialInput, action: z.literal('clear') }),
]);
export const sourceCredentialRecord = z.strictObject({ ...loginFields, credentialRef: z.uuid(), cardId: z.uuid(), origin: z.url(), loginUrl: registeredSourceUrlSchema });
export const sourceOperationRecord = z.strictObject({ operationId: z.uuid(), cardId: z.uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/u) });
const lease = z.strictObject({ checkId: z.uuid(), token: z.uuid(), until: timestamp, generation: z.uuid(), authorizationVersion: z.string() });
const finished = z.strictObject({ checkId: z.uuid(), token: z.uuid(), result: registeredSourceResultSchema });
export const sourceCardRecord = z.discriminatedUnion('removed', [
  z.strictObject({ removed: z.literal(false), accessRevision: z.int().positive().max(2147483647).optional(), card: registeredSourceCardSchema.omit({ checking: true }), lease: lease.nullable(), finished: finished.nullable() }),
  z.strictObject({ removed: z.literal(true), cardId: z.uuid(), revision: z.int().positive() }),
]);
export type SourceRecord = z.infer<typeof sourceCardRecord>;
export type LiveSource = Extract<SourceRecord, { removed: false }>;
export const sourceRecordId = (owner: string, id: string) => JSON.stringify([owner, id]);
export const sourceCardId = (row: SourceRecord) => row.removed ? row.cardId : row.card.cardId;
export const sourceRevision = (row: SourceRecord) => row.removed ? row.revision : row.card.revision;
export const sourceListTag = (scope: WorkRecoveryScope) => firestoreDomainHash(['registered-source-list/v1', scope]);
export function sourceCardMetadata(scope: WorkRecoveryScope, row: SourceRecord) {
  if (row.removed) return {};
  const dueAt = row.lease?.until ?? row.card.nextCheckAt;
  return { targetTag: sourceListTag(scope), ...(row.card.enabled && dueAt ? { dueAt } : {}) };
}

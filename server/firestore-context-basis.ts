import { z } from 'zod';
import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';

const schema = z.object({ revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  summaryRequest: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(), summaryPending: z.boolean().optional(),
  summaryAfter: z.iso.datetime({ offset: true }).nullable().optional(), summaryBlocked: z.boolean().optional(), summaryBlockedReference: z.uuid().nullable().optional() }).strict();
const idFor = (binding: FirestoreAuthorityTransaction) => JSON.stringify([binding.scope.ownerUserId, binding.scope.childId]);

/** Derived private summaries depend on care/memory versions, not on unrelated chat appends. */
export async function readContextBasis(data: FirestoreDomainData, binding: FirestoreAuthorityTransaction) {
  const id = idFor(binding), ref = data.ref('context_versions', 'context-version', id);
  const row = await binding.transaction.get(ref);
  const value = row.exists ? data.open('context-version', id, binding.scope, schema, row) : { revision: 0 };
  const revision = value.revision;
  const basis = firestoreDomainHash([binding.scope, binding.authorizationVersion, revision]);
  return { id, ref, revision, basis, value };
}
export async function prepareContextChange(data: FirestoreDomainData, binding: FirestoreAuthorityTransaction, chatOnly = false) {
  const current = await readContextBasis(data, binding);
  if (current.revision >= Number.MAX_SAFE_INTEGER) domainReject('version_exhausted');
  const value = { ...current.value, revision: current.revision + (chatOnly ? 0 : 1), summaryRequest: (current.value.summaryRequest ?? 0) + 1,
    summaryPending: true, summaryAfter: new Date(Date.now() + 120000).toISOString() };
  if (!Number.isSafeInteger(value.summaryRequest)) domainReject('version_exhausted');
  const envelope = { ...data.tags(binding.scope), summaryPending: true, ...data.seal('context-version', current.id, binding.scope, schema, value) };
  return () => binding.transaction.set(current.ref, envelope);
}

/** Persisted schemas reused by isolated recovery; not a second domain model. */
export const firestoreContextRecoverySchema = schema;

/** Acknowledges the exact coalesced source revision; new writes keep their own pending marker. */
export async function settleSummaryRequest(data: FirestoreDomainData, binding: FirestoreAuthorityTransaction, request: number,
  outcome: 'complete' | 'more' | 'deferred' | 'unknown', reference?: string) {
  const current = await readContextBasis(data, binding);
  if (current.value.summaryRequest !== request && outcome !== 'unknown') return;
  request = current.value.summaryRequest ?? request;
  const tomorrow = new Date(); tomorrow.setUTCHours(24, 0, 0, 0);
  const pending = outcome !== 'complete';
  const value = { ...current.value, summaryPending: pending, summaryBlocked: outcome === 'unknown',
    summaryBlockedReference: outcome === 'unknown' ? reference ?? current.value.summaryBlockedReference ?? null : null,
    summaryRequest: request + (outcome === 'more' || outcome === 'deferred' ? 1 : 0),
    summaryAfter: outcome === 'deferred' ? tomorrow.toISOString() : new Date(Date.now() + 300000).toISOString() };
  binding.transaction.set(current.ref, { ...data.tags(binding.scope), summaryPending: pending,
    ...data.seal('context-version', current.id, binding.scope, schema, value) });
}

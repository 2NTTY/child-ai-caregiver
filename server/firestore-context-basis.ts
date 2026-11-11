import { z } from 'zod';
import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';

export const householdChangeSchema = z.object({ revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  domain: z.enum(['care_record', 'profile', 'memory_fact', 'memory_topic', 'private_note', 'concern']), id: z.uuid() }).strict();
export type HouseholdChange = z.infer<typeof householdChangeSchema>;
const schema = z.object({ revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  proactiveRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  proactiveChanges: z.array(householdChangeSchema).max(8).optional(),
  proactiveChangesFloor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  lastUserMessageId: z.uuid().optional(),
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
  return { id, ref, revision, proactiveRevision: value.proactiveRevision ?? revision, basis, value };
}
export async function prepareContextChange(data: FirestoreDomainData, binding: FirestoreAuthorityTransaction,
  { chatOnly = false, userMessageId, proactive = !chatOnly, resource }: { chatOnly?: boolean; userMessageId?: string; proactive?: boolean;
    resource?: Omit<HouseholdChange, 'revision'> } = {}) {
  const current = await readContextBasis(data, binding);
  if (current.revision >= Number.MAX_SAFE_INTEGER) domainReject('version_exhausted');
  const nextRevision = current.proactiveRevision + Number(proactive);
  if (!Number.isSafeInteger(nextRevision)) domainReject('version_exhausted');
  const previousChanges = current.value.proactiveChanges ?? [];
  const entries = proactive && resource ? [...previousChanges, householdChangeSchema.parse({ ...resource, revision: nextRevision })] : previousChanges;
  const dropped = entries.length > 8 ? entries[entries.length - 9]!.revision : 0;
  const floor = Math.max(current.value.proactiveChangesFloor ?? current.proactiveRevision, dropped, proactive && !resource ? nextRevision : 0);
  const value = { ...current.value, ...(userMessageId ? {lastUserMessageId:z.uuid().parse(userMessageId)} : {}),
    revision: current.revision + (chatOnly ? 0 : 1), proactiveRevision: current.proactiveRevision + Number(proactive),
    proactiveChanges: entries.slice(-8), proactiveChangesFloor: floor,
    summaryRequest: (current.value.summaryRequest ?? 0) + 1,
    summaryPending: true, summaryAfter: new Date(Date.now() + 120000).toISOString() };
  if (!Number.isSafeInteger(value.summaryRequest)) domainReject('version_exhausted');
  const envelope = { ...data.tags(binding.scope), summaryPending: true, ...data.seal('context-version', current.id, binding.scope, schema, value) };
  return () => binding.transaction.set(current.ref, envelope);
}

/** The retained ring never implies that older or legacy changes were fully enumerated. */
export function selectHouseholdChanges(context: Awaited<ReturnType<typeof readContextBasis>>, sinceRevision: number, throughRevision = context.proactiveRevision) {
  if (!Number.isSafeInteger(sinceRevision) || sinceRevision < 0 || throughRevision > context.proactiveRevision || sinceRevision > throughRevision)
    domainReject('proactive_change_range_invalid', 500);
  const changes = (context.value.proactiveChanges ?? []).filter(row => row.revision > sinceRevision && row.revision <= throughRevision);
  const unique = [...new Map(changes.map(row => [row.domain + ':' + row.id, row])).values()];
  return { changes: unique, complete: sinceRevision >= (context.value.proactiveChangesFloor ?? context.proactiveRevision) };
}

/** T0 and pending-clear both read/write this original document, so they conflict even
 * when an empty work query cannot supply a phantom-range concurrency guarantee. */
export async function prepareSummaryWorkPending(data: FirestoreDomainData, binding: FirestoreAuthorityTransaction) {
  const current = await readContextBasis(data, binding);
  if (!Number.isSafeInteger(current.value.summaryRequest) || !current.value.summaryRequest) domainReject('summary_pending_binding', 500);
  const value = { ...current.value, summaryPending: true };
  const envelope = { ...data.tags(binding.scope), summaryPending: true,
    ...data.seal('context-version', current.id, binding.scope, schema, value) };
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

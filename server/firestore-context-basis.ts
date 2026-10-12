import { z } from 'zod';
import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';

const schema = z.object({ revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
const idFor = (binding: FirestoreAuthorityTransaction) => JSON.stringify([binding.scope.ownerUserId, binding.scope.childId]);

/** Derived private summaries depend on care/memory versions, not on unrelated chat appends. */
export async function readContextBasis(data: FirestoreDomainData, binding: FirestoreAuthorityTransaction) {
  const id = idFor(binding), ref = data.ref('context_versions', 'context-version', id);
  const row = await binding.transaction.get(ref);
  const revision = row.exists ? data.open('context-version', id, binding.scope, schema, row).revision : 0;
  const basis = firestoreDomainHash([binding.scope, binding.authorizationVersion, revision]);
  return { id, ref, revision, basis };
}
export async function prepareContextChange(data: FirestoreDomainData, binding: FirestoreAuthorityTransaction) {
  const current = await readContextBasis(data, binding);
  if (current.revision >= Number.MAX_SAFE_INTEGER) domainReject('version_exhausted');
  const value = { revision: current.revision + 1 };
  const envelope = { ...data.tags(binding.scope), ...data.seal('context-version', current.id, binding.scope, schema, value) };
  return () => binding.transaction.set(current.ref, envelope);
}

/** Persisted schemas reused by isolated recovery; not a second domain model. */
export const firestoreContextRecoverySchema = schema;

import { z } from 'zod';
import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import { growthImportScopes, importBatchId, importBatchSchema, validImportBatch } from './handover-import-batch-records.ts';
import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';

/** Existing batch authority fences evaluation while a selected growth snapshot is only partly committed. */
export async function growthImportPending(data: FirestoreDomainData, binding: FirestoreAuthorityTransaction) {
  const scopeHash = firestoreDomainHash(binding.scope);
  const page = await binding.transaction.get(data.collection('handover_import_batches').where('growthImportScopes', 'array-contains', scopeHash).limit(1));
  if (!page.size) return false;
  const row = page.docs[0], batchId = domainParse(z.uuid(), row.get('batchId'), 'import_batch_binding', 500);
  let scope = { ...binding.scope, childId: '00000000-0000-0000-0000-000000000000' };
  // A teacher owns the batch receipt, while its target is the class-owned child.
  if (binding.scope.ownerUserId === 'space:' + binding.scope.workspaceId) {
    const raw = row.data(), { context } = openRecoveryEnvelope({ ...data.options, locator: raw.recovery,
      envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } });
    if (context.family !== 'domain' || context.kind !== 'handover-import-batch'
      || context.id !== importBatchId(context.scope.ownerUserId, batchId)) domainReject('import_batch_binding', 500);
    scope = context.scope;
  }
  const id = importBatchId(scope.ownerUserId, batchId), job = data.open('handover-import-batch', id, scope, importBatchSchema, row);
  if (row.ref.path !== data.ref('handover_import_batches', 'handover-import-batch', id).path || job.id !== batchId
    || !validImportBatch(job) || job.version !== row.get('recordVersion') || firestoreDomainHash(job.scope) !== firestoreDomainHash(scope)
    || !growthImportScopes(job).includes(scopeHash)) domainReject('import_batch_binding', 500);
  return true;
}

import { z } from 'zod';
import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import { growthImportScopes, importBatchId, importBatchSchema, validImportBatch } from './handover-import-batch-records.ts';

/** Existing batch authority fences evaluation while a selected growth snapshot is only partly committed. */
export async function growthImportPending(data: FirestoreDomainData, binding: FirestoreAuthorityTransaction) {
  const scopeHash = firestoreDomainHash(binding.scope);
  const page = await binding.transaction.get(data.collection('handover_import_batches').where('growthImportScopes', 'array-contains', scopeHash).limit(1));
  if (!page.size) return false;
  const row = page.docs[0], batchId = domainParse(z.uuid(), row.get('batchId'), 'import_batch_binding', 500);
  const scope = { ...binding.scope, childId: '00000000-0000-0000-0000-000000000000' };
  const id = importBatchId(scope.ownerUserId, batchId), job = data.open('handover-import-batch', id, scope, importBatchSchema, row);
  if (row.ref.path !== data.ref('handover_import_batches', 'handover-import-batch', id).path || job.id !== batchId
    || !validImportBatch(job) || job.version !== row.get('recordVersion') || firestoreDomainHash(job.scope) !== firestoreDomainHash(scope)
    || !growthImportScopes(job).includes(scopeHash)) domainReject('import_batch_binding', 500);
  return true;
}

import { workRecoveryAad, workRecoveryDocumentId, workRecoverySchemas } from '../../server/firestore-work-continuation-recovery.ts';
import { sealRecoveryLocator } from '../../server/firestore-recovery-envelope.ts';
import type { privateSummaryRootFixture } from './private-summary-root.ts';

/** Valid encrypted synthetic authority state, without billions of unrelated changes. */
export function setPrivateSummarySequence(f: Awaited<ReturnType<typeof privateSummaryRootFixture>>, workspaceId: string, sequence: string) {
  const nil = '00000000-0000-0000-0000-000000000000';
  const scope = { ownerUserId: 'owner', workspaceId, storageEpoch: nil, childId: nil };
  const id = scope.workspaceId, path = f.options.database.collection(f.options.namespace).doc(workRecoveryDocumentId('workspace', id)).path;
  const row = f.fake.records.get(path)!;
  const aad = workRecoveryAad(f.options.projectId, f.options.namespace, 'workspace', id, scope);
  const value = workRecoverySchemas.workspace.parse({ ...JSON.parse(f.options.cipher.decrypt(row.ciphertext, aad)), changeSeq: sequence });
  const ciphertext = f.options.cipher.encrypt(JSON.stringify(value), aad);
  f.fake.records.set(path, { ...row, ciphertext, recovery: sealRecoveryLocator({ ...f.options, ciphertext,
    context: { family: 'authority', kind: 'workspace', id, scope, envelopeVersion: 1, aad } }) });
}

import { randomUUID } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { SERVICE_POLICY_VERSION } from '../../src/shared/account-service.ts';
import { createStorageCipher } from '../../server/storage-crypto.ts';
import { FirestoreWorkContinuationRecovery, workRecoveryAad, workRecoveryDocumentId, workRecoveryClaimId,
  type WorkRecoveryKind } from '../../server/firestore-work-continuation-recovery.ts';

/** Synthetic seeding only. There is deliberately no production authority creation API. */
export function workRecoveryFixture(database: Firestore, projectId = 'synthetic-project', namespace = 'synthetic_work_recovery') {
  const scope = { ownerUserId: 'synthetic-owner', workspaceId: randomUUID(), childId: randomUUID(), storageEpoch: randomUUID() };
  const eventId = randomUUID(), runId = randomUUID(), workId = randomUUID(), jobId = randomUUID(), generation = randomUUID();
  let now = Date.parse('2026-10-10T10:00:00Z');
  const cipher = createStorageCipher(Buffer.alloc(32, 83));
  const options = { database, cipher, projectId, namespace, scope, serverClock: () => now };
  const job = { eventId, jobId, workerGeneration: generation, storageEpoch: scope.storageEpoch };
  const identity = { ...scope, authorizationVersion: '1' };
  const dueAt = new Date(now - 1000).toISOString();
  const values = { goal: 'Synthetic follow-up', focus: '', questions: [], sourceMessageIds: [], resources: [], pending: [], status: 'active',
    followUp: { reason: 'Synthetic due time', dueAt, watchResources: false, knowledgeSourceIds: [] } };
  const original = { runId, status: 'completed', stopReason: null, provenance: null, countsKnown: true,
    text: 'Synthetic private result, never returned by recovery', citations: [], privateSourceCitations: [], retrievalMode: 'not_used',
    tools: [], counts: { modelCalls: 1, toolCalls: 1, queryEmbeddings: 0 }, proposals: [] };
  const rows: Record<Exclude<WorkRecoveryKind, 'change'>, any> = {
    control: { enabled: true, generation },
    account: { userId: scope.ownerUserId, status: 'active', admitted: true, invitationLive: true,
      emailVerified: true, acknowledgementVersion: SERVICE_POLICY_VERSION },
    workspace: { id: scope.workspaceId, ownerUserId: scope.ownerUserId, storageEpoch: scope.storageEpoch,
      accessVersion: '1', changeSeq: '7', status: 'active' },
    child: { id: scope.childId, workspaceId: scope.workspaceId, status: 'active' },
    work: { ...scope, id: workId, version: 1, status: 'active',
      payloadEncrypted: cipher.encrypt(JSON.stringify(values), `agent-work:${scope.childId}:${scope.ownerUserId}:${workId}:1`) },
    followup: { ...identity, workId, workVersion: 1, enabled: true, dueAt, dueConsumed: true, watchResources: false, knowledgeSourceIds: [] },
    event: { ...identity, id: eventId, jobId, workerGeneration: generation, state: 'queued', runId,
      payloadEncrypted: cipher.encrypt(JSON.stringify({ works: [{ workId, workVersion: 1,
        changes: { due: true, resources: [], knowledge: [] } }] }), `agent-work-continuation:${scope.childId}:${scope.ownerUserId}:${eventId}`) },
    claim: { ...identity, runId, triggerKind: 'worker', triggerReference: eventId },
    run: { ...identity, id: runId, triggerKind: 'worker', triggerReference: eventId, sourceMessageId: null, recipeId: 'product-work-followup',
      dataVersion: scope.storageEpoch + ':7', state: 'completed', stopReason: null, expiresAtMs: now + 90_000,
      resultEncrypted: cipher.encrypt(JSON.stringify(original), `agent-run:${scope.childId}:${scope.ownerUserId}:${runId}`) },
  };
  const ids: Record<WorkRecoveryKind, string> = { control: 'current', account: scope.ownerUserId, workspace: scope.workspaceId,
    child: scope.childId, work: workId, followup: workId, event: eventId, claim: workRecoveryClaimId(scope, eventId), run: runId,
    change: JSON.stringify([scope.workspaceId, scope.storageEpoch, eventId]) };
  const ref = (kind: WorkRecoveryKind) => database.collection(namespace).doc(workRecoveryDocumentId(kind, ids[kind]));
  const seal = (kind: WorkRecoveryKind, value: unknown) => ({ format: 'yuban-work-recovery', version: 1,
    ciphertext: cipher.encrypt(JSON.stringify(value), workRecoveryAad(projectId, namespace, kind, ids[kind], scope)) });
  const open = (kind: WorkRecoveryKind, value: any) => JSON.parse(cipher.decrypt(value.ciphertext,
    workRecoveryAad(projectId, namespace, kind, ids[kind], scope)));
  const write = async (kind: Exclude<WorkRecoveryKind, 'change'>) => database.runTransaction(async tx => { tx.set(ref(kind), seal(kind, rows[kind])); });
  const read = async (kind: WorkRecoveryKind) => database.runTransaction(async tx => {
    const snapshot = await tx.get(ref(kind)); return snapshot.exists ? open(kind, snapshot.data()) : null;
  }, { readOnly: true });
  const seed = async () => database.runTransaction(async tx => {
    for (const kind of Object.keys(rows) as (keyof typeof rows)[]) tx.set(ref(kind), seal(kind, rows[kind]));
  });
  function cancelWork() {
    values.status = 'cancelled'; rows.work.status = 'cancelled'; rows.followup.enabled = false;
    rows.work.payloadEncrypted = cipher.encrypt(JSON.stringify(values), `agent-work:${scope.childId}:${scope.ownerUserId}:${workId}:1`);
  }
  return { options, job, scope, rows, ids, values, original, seed, ref, seal, open, write, read, cancelWork,
    setNow: (value: number) => { now = value; }, now: () => now, service: new FirestoreWorkContinuationRecovery(options) };
}

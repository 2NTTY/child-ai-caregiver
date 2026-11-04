import { privateSummaryAttemptSchema, privateSummaryWorkSchema, privateSummaryWorkProjection, summarySourceRevisionSchema,
  type PrivateSummaryAttempt, type PrivateSummarySourceRevision, type PrivateSummaryWork } from './private-summary-work.ts';
import { firebaseErasureIntentSchema, type FirebaseErasureIntent } from './firebase-erasure-journal.ts';
import { FirestoreDomainData, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import type { FirestoreRestoreDecoded } from './firestore-restore-codec.ts';
import type { DocumentSnapshot, Transaction } from '@google-cloud/firestore';
import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';
import { contentErasureSchema, contentErasureScopeMatches } from './firestore-content-erasure.ts';
import { firebaseErasureIntentHash } from './firebase-erasure-journal.ts';
import { firestoreAgentRunSchema, type FirestoreAgentRun } from './firestore-agent-runs.ts';
import type { FirestoreSessionService } from './firestore-session-service.ts';

export type PrivateSummarySessionErasurePort = Pick<FirestoreSessionService, 'prepareContentErasure'>;

/** Content deletion follows the original identity across restore epochs. */
export function privateSummaryRevisionErasedBy(revision: PrivateSummarySourceRevision, rawIntent: FirebaseErasureIntent): boolean {
  const intent = firebaseErasureIntentSchema.parse(rawIntent);
  return intent.type === 'content-delete' && revision.scope.ownerUserId === intent.scope.ownerUserId
    && revision.scope.workspaceId === intent.scope.workspaceId && revision.scope.childId === intent.scope.childId
    && revision.manifest.dependencies.some(dependency => dependency.kind === intent.content!.kind
      && dependency.id === intent.assetId && dependency.version <= intent.content!.throughVersion);
}

export function redactPrivateSummaryWork(work: PrivateSummaryWork): PrivateSummaryWork {
  const state = ['ready', 'executing', 'completed'].includes(work.state) ? 'invalidated' : work.state;
  if (work.state === state && work.accumulator === null && work.completionWake === null) return work;
  return privateSummaryWorkSchema.parse({ ...work, version: work.version + 1, state, accumulator: null, completionWake: null });
}

export function redactPrivateSummaryAttempt(attempt: PrivateSummaryAttempt, intent: FirebaseErasureIntent): PrivateSummaryAttempt {
  return privateSummaryAttemptSchema.parse({ ...attempt, contentState: 'erased', resultText: null,
    erasureIntentId: attempt.erasureIntentId ?? intent.operationId });
}

function redactRun(run: FirestoreAgentRun): FirestoreAgentRun {
  const pending = run.state === 'running' || run.state === 'unknown';
  const result = run.result === null ? null : { ...run.result, text: '', citations: [], proposals: [],
    ...(run.result.privateSourceCitations === undefined ? {} : { privateSourceCitations: [] }),
    tools: run.result.tools.map(({ name, status }) => ({ name, status })) };
  return firestoreAgentRunSchema.parse({ ...run, state: pending ? 'unknown' : run.state,
    stopReason: pending ? 'content_erased' : run.stopReason, result });
}

function openRecord(data: FirestoreDomainData, row: DocumentSnapshot, suffix: string, kind: string, id: string) {
  if (!row.exists) domainReject('private_summary_erasure_missing', 503);
  const raw = row.data()!, opened = openRecoveryEnvelope({ ...data.options, locator: raw.recovery,
    envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } });
  if (opened.context.kind !== kind || opened.context.id !== id || data.ref(suffix, kind, id).path !== row.ref.path
    || kind !== 'private-summary-work' && opened.context.recordVersion !== 1
    || Object.entries(data.tags(opened.context.scope)).some(([key, value]) => row.get(key) !== value))
    domainReject('private_summary_erasure_binding', 500);
  return opened;
}

async function readJob(data: FirestoreDomainData, tx: Transaction, id: string) {
  const row = await tx.get(data.ref('content_erasures', 'content-erasure', id));
  const opened = openRecord(data, row, 'content_erasures', 'content-erasure', id);
  const job = contentErasureSchema.parse(opened.value);
  if (job.intent.operationId !== id || !contentErasureScopeMatches(job, opened.context.scope) || row.get('stage') !== job.stage
    || !job.journal || job.journal.intentSha256 !== firebaseErasureIntentHash(job.intent)) domainReject('private_summary_erasure_binding', 500);
  return job;
}

/** Only the journal coordinator calls this, after journal IO and before the shared transaction's write phase. */
export async function preparePrivateSummaryRevisionErasure(data: FirestoreDomainData, tx: Transaction,
  jobId: string, revisionId: string): Promise<() => void> {
  const job = await readJob(data, tx, jobId), opened = openRecord(data,
    await tx.get(data.ref('private_summary_revisions', 'private-summary-revision', revisionId)), 'private_summary_revisions', 'private-summary-revision', revisionId);
  const revision = summarySourceRevisionSchema.parse(opened.value);
  if (revision.id !== revisionId || firestoreDomainHash(revision.scope) !== firestoreDomainHash(opened.context.scope))
    domainReject('private_summary_erasure_binding', 500);
  if (!privateSummaryRevisionErasedBy(revision, job.intent)) return () => {};
  const ref = data.ref('private_summary_works', 'private-summary-work', revision.workId), snapshot = await tx.get(ref);
  if (!snapshot.exists) return () => {};
  const stored = openRecord(data, snapshot, 'private_summary_works', 'private-summary-work', revision.workId);
  const work = privateSummaryWorkSchema.parse(stored.value);
  if (work.id !== revision.workId || firestoreDomainHash(work.scope) !== firestoreDomainHash(revision.scope)
    || firestoreDomainHash(stored.context.scope) !== firestoreDomainHash(revision.scope) || snapshot.get('recordVersion') !== work.version
    || Object.entries(privateSummaryWorkProjection(work)).some(([key, value]) => snapshot.get(key) !== value)) domainReject('private_summary_erasure_binding', 500);
  if (work.sourceRevisionId !== revision.id) return () => {};
  const next = redactPrivateSummaryWork(work);
  if (next === work) return () => {};
  return () => tx.set(ref, { ...data.tags(work.scope), ...privateSummaryWorkProjection(next),
    ...data.seal('private-summary-work', work.id, work.scope, privateSummaryWorkSchema, next, next.version) });
}

/** IDs only: all erasure authority comes from encrypted persistent records reread in this transaction. */
export async function preparePrivateSummaryAttemptErasure(data: FirestoreDomainData, tx: Transaction,
  jobId: string, attemptId: string, sessions: PrivateSummarySessionErasurePort | undefined): Promise<() => void> {
  const job = await readJob(data, tx, jobId), opened = openRecord(data,
    await tx.get(data.ref('private_summary_attempts', 'private-summary-attempt', attemptId)), 'private_summary_attempts', 'private-summary-attempt', attemptId);
  const attempt = privateSummaryAttemptSchema.parse(opened.value), scope = opened.context.scope;
  const source = openRecord(data, await tx.get(data.ref('private_summary_revisions', 'private-summary-revision', attempt.sourceRevisionId)),
    'private_summary_revisions', 'private-summary-revision', attempt.sourceRevisionId);
  const revision = summarySourceRevisionSchema.parse(source.value), same = (a: unknown, b: unknown) =>
    a === undefined || b === undefined ? a === b : firestoreDomainHash(a) === firestoreDomainHash(b);
  if (attempt.id !== attemptId || revision.workId !== attempt.binding.workId || revision.sourceRevision !== attempt.binding.sourceRevision
    || !same(scope, source.context.scope) || !same(scope, revision.scope)) domainReject('private_summary_erasure_binding', 500);
  if (!privateSummaryRevisionErasedBy(revision, job.intent)) return () => {};
  const runRef = data.ref('agent_runs', 'agent-run', attempt.runId), runRow = await tx.get(runRef);
  const runRecord = openRecord(data, runRow, 'agent_runs', 'agent-run', attempt.runId), run = firestoreAgentRunSchema.parse(runRecord.value);
  if (!same(runRecord.context.scope, scope) || run.id !== attempt.runId || run.ownerUserId !== scope.ownerUserId
    || run.workspaceId !== scope.workspaceId || run.childId !== scope.childId || run.storageEpoch !== scope.storageEpoch
    || !run.dataVersion.startsWith(scope.storageEpoch + ':') || run.authorizationVersion !== revision.authorizationVersion
    || run.workerGeneration !== revision.workerGeneration || run.trigger.kind !== 'worker' || run.recipeId !== 'memory-refresh'
    || run.trigger.reference !== attempt.triggerReference || run.sourceMessageId !== null || !same(run.summaryWork, attempt.binding)
    || !same(run.summaryEffect ?? null, attempt.receipt) || attempt.plan && attempt.plan.manifestHash !== revision.manifestHash
    || runRow.get('runId') !== run.id || runRow.get('createdAt') !== run.createdAt || runRow.get('triggerKind') !== run.trigger.kind)
    domainReject('private_summary_erasure_run_binding', 500);
  if (attempt.rootContext) {
    const root = attempt.rootContext.binding;
    if (root.rootRunId !== run.id || root.ownerId !== run.ownerUserId || root.workspaceId !== run.workspaceId
      || root.childId !== run.childId || root.storageEpoch !== run.storageEpoch || root.authorizationVersion !== run.authorizationVersion
      || root.trigger.kind !== run.trigger.kind || root.trigger.reference !== run.trigger.reference)
      domainReject('private_summary_erasure_run_binding', 500);
  }
  if (!sessions) domainReject('private_summary_erasure_session_unavailable', 503);
  const native = await sessions.prepareContentErasure(tx, { ownerUserId: run.ownerUserId, runId: run.id,
    erasureIntentId: attempt.erasureIntentId ?? job.intent.operationId });
  const next = redactPrivateSummaryAttempt(attempt, job.intent), nextRun = redactRun(run);
  return () => {
    // The original run fence, native fence and body redaction share the same atomic write set.
    tx.set(runRef, { ...data.tags(scope), runId: run.id, createdAt: run.createdAt, triggerKind: run.trigger.kind,
      ...data.seal('agent-run', run.id, scope, firestoreAgentRunSchema, nextRun) });
    native();
    tx.set(data.ref('private_summary_attempts', 'private-summary-attempt', attempt.id), { ...data.tags(scope),
      ...data.seal('private-summary-attempt', attempt.id, scope, privateSummaryAttemptSchema, next) });
  };
}

/** Schemas/chain relationships are validated before this journal replay. No accounting record is changed. */
export function replayPrivateSummaryContentErasure(records: FirestoreRestoreDecoded[], intent: FirebaseErasureIntent): void {
  const matching = new Set<string>(), runs = new Set<string>();
  const key = (scope: PrivateSummarySourceRevision['scope'], id: string) => firestoreDomainHash([scope, id]);
  for (const row of records) {
    if (row.context.family !== 'domain' || row.context.kind !== 'private-summary-revision') continue;
    const revision = summarySourceRevisionSchema.parse(row.value);
    if (privateSummaryRevisionErasedBy(revision, intent)) matching.add(key(row.context.scope, revision.id));
  }
  for (const row of records) {
    if (row.context.family !== 'domain') continue;
    if (row.context.kind === 'private-summary-work') {
      const work = privateSummaryWorkSchema.parse(row.value);
      if (matching.has(key(row.context.scope, work.sourceRevisionId))) {
        const redacted = redactPrivateSummaryWork(work);
        // Replay edits already-decoded values; their original AAD version stays bound until transform reseals them.
        row.value = { ...redacted, version: work.version };
      }
    }
    if (row.context.kind === 'private-summary-attempt') {
      const attempt = privateSummaryAttemptSchema.parse(row.value);
      if (matching.has(key(row.context.scope, attempt.sourceRevisionId))) {
        row.value = redactPrivateSummaryAttempt(attempt, intent);
        runs.add(key(row.context.scope, attempt.runId));
      }
    }
  }
  for (const row of records) if (row.context.family === 'domain' && row.context.kind === 'agent-run'
    && runs.has(key(row.context.scope, row.context.id))) row.value = redactRun(firestoreAgentRunSchema.parse(row.value));
}

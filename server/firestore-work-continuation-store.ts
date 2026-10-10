import { randomUUID } from 'node:crypto';
import type { Transaction, DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import { agentWorkValuesSchema } from '../src/shared/agent-work.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { ProductAgentResult } from '../src/shared/product-agent.ts';
import type { AgentRunClaim } from './product-agent-store.ts';
import { projectWorkContinuationContext, type WorkContinuationJob, type WorkContinuationContextEntry } from './agent-work-continuation.ts';
import { workContinuationJobSchema, type WorkContinuationRecovery } from './agent-work-continuation-worker.ts';
import { FirestoreWorkContinuationRecovery, workRecoverySchemas as schemas, workRecoveryPayloadSchema as payloadSchema,
  workRecoveryReceiptSchema as receiptSchema, workRecoveryScopeSchema as scopeSchema, workRecoveryClaimId,
  parseWorkRecovery as parse, sameWorkRecovery as same } from './firestore-work-continuation-recovery.ts';

const uuid = z.uuid(), version = z.number().int().min(1).max(2147483646);
const decimal = schemas.workspace.shape.changeSeq;
const selectedSchema = z.object({ workId: uuid, workVersion: version, selection: z.enum(['included', 'not_included']) }).strict();
const inputSchema = z.object({ format: z.literal('work-start-input'), version: z.literal(1), ...scopeSchema.shape,
  eventId: uuid, runId: uuid.nullable(), workerGeneration: uuid, authorizationVersion: decimal,
  works: z.array(selectedSchema).min(1).max(5) }).strict();
const eventSchema = schemas.event.extend({ runId: uuid.nullable(), inputVersion: z.literal(2),
  inputEvidence: inputSchema.nullable(), localDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u) }).strict();
type Event = z.infer<typeof eventSchema>;
const dueSchema = z.object({ workerGeneration: uuid, workIds: z.array(uuid).min(1).max(5)
  .refine(ids => new Set(ids).size === ids.length) }).strict();
const dailySchema = z.object({ ...scopeSchema.shape, localDay: z.string(), eventId: uuid, jobId: uuid, workerGeneration: uuid }).strict();
function fail(code: string): never { throw new Error('work_continuation_' + code); }
export type WorkContinuationAdmission = { decision: 'execute'; job: WorkContinuationJob; claim: AgentRunClaim; context: Record<string, unknown> }
  | { decision: 'lookup'; runId: string | null };
export type ClaimedWorkContinuation = Extract<WorkContinuationAdmission, { decision: 'execute' }>;

/** Unenabled owner-only pure-due lifecycle. All canonical prerequisites must already exist in this database. */
export class FirestoreWorkContinuationStore extends FirestoreWorkContinuationRecovery {
  private now() {
    const now = (this.options.serverClock ?? Date.now)();
    if (!Number.isSafeInteger(now) || now < 0 || now > 253402271909999) fail('clock');
    return now;
  }
  private async authority(tx: Transaction, generation: string) {
    const { scope } = this.options; this.now();
    const control = this.open('control', 'current', await tx.get(this.ref('control', 'current')), schemas.control);
    const account = this.open('account', scope.ownerUserId, await tx.get(this.ref('account', scope.ownerUserId)), schemas.account);
    const workspace = this.open('workspace', scope.workspaceId, await tx.get(this.ref('workspace', scope.workspaceId)), schemas.workspace);
    const child = this.open('child', scope.childId, await tx.get(this.ref('child', scope.childId)), schemas.child);
    if (!control.enabled || control.generation !== generation || account.userId !== scope.ownerUserId || account.status !== 'active'
      || !account.admitted || !account.invitationLive || !account.emailVerified || account.acknowledgementVersion !== SERVICE_POLICY_VERSION
      || workspace.id !== scope.workspaceId || workspace.ownerUserId !== scope.ownerUserId || workspace.status !== 'active'
      || workspace.storageEpoch !== scope.storageEpoch || child.id !== scope.childId || child.workspaceId !== scope.workspaceId
      || child.status !== 'active') fail('authority');
    return workspace;
  }
  private bound(value: z.infer<typeof scopeSchema> & { authorizationVersion: string }, accessVersion: string) {
    const scope = this.options.scope;
    return same(scope, { ownerUserId: value.ownerUserId, workspaceId: value.workspaceId, childId: value.childId, storageEpoch: value.storageEpoch })
      && value.authorizationVersion === accessVersion;
  }
  private async work(tx: Transaction, workId: string, accessVersion: string) {
    const scope = this.options.scope;
    const work = this.open('work', workId, await tx.get(this.ref('work', workId)), schemas.work);
    const followup = this.open('followup', workId, await tx.get(this.ref('followup', workId)), schemas.followup);
    if (!same(scope, { ownerUserId: work.ownerUserId, workspaceId: work.workspaceId, childId: work.childId, storageEpoch: work.storageEpoch })
      || work.id !== workId || !this.bound(followup, accessVersion) || followup.workId !== workId || followup.workVersion !== work.version) fail('binding');
    const values = this.decrypt(work.payloadEncrypted, `agent-work:${scope.childId}:${scope.ownerUserId}:${workId}:${work.version}`, agentWorkValuesSchema);
    if (values.status !== work.status) fail('binding');
    return { work, followup, values };
  }
  private active(row: Awaited<ReturnType<FirestoreWorkContinuationStore['work']>>, expected: number, consumed: boolean) {
    const { work, followup, values } = row;
    if (work.version !== expected || !followup.enabled || !['active', 'waiting'].includes(work.status)) return false;
    if (values.resources.length || values.pending.length || !values.followUp || values.followUp.watchResources || values.followUp.knowledgeSourceIds.length
      || !values.followUp.dueAt || values.followUp.dueAt !== followup.dueAt) fail('unsupported_event');
    if (Date.parse(followup.dueAt) > this.now()) { if (consumed) fail('unsupported_event'); return false; }
    if (followup.dueConsumed !== consumed) fail('due_binding');
    return true;
  }
  private job(raw: WorkContinuationJob) {
    const job = workContinuationJobSchema.parse(raw);
    if (job.storageEpoch !== this.options.scope.storageEpoch) fail('scope'); return job;
  }
  private async event(tx: Transaction, job: WorkContinuationJob, accessVersion: string, snapshot?: DocumentSnapshot) {
    const event = this.open('event', job.eventId, snapshot ?? await tx.get(this.ref('event', job.eventId)), eventSchema, 2);
    if (!this.bound(event, accessVersion) || event.id !== job.eventId || event.jobId !== job.jobId || event.workerGeneration !== job.workerGeneration) fail('binding');
    const { scope } = this.options;
    const payload = this.decrypt(event.payloadEncrypted, `agent-work-continuation:${scope.childId}:${scope.ownerUserId}:${event.id}`, payloadSchema);
    const evidence = event.inputEvidence;
    if (evidence) {
      if (!same({ ...scope, eventId: event.id, runId: event.runId, workerGeneration: event.workerGeneration,
        authorizationVersion: event.authorizationVersion }, { ownerUserId: evidence.ownerUserId, workspaceId: evidence.workspaceId,
        childId: evidence.childId, storageEpoch: evidence.storageEpoch, eventId: evidence.eventId, runId: evidence.runId,
        workerGeneration: evidence.workerGeneration, authorizationVersion: evidence.authorizationVersion })
        || !same(payload.works.map(({ workId, workVersion }) => ({ workId, workVersion })), evidence.works.map(({ workId, workVersion }) => ({ workId, workVersion })))) fail('input_binding');
      const included = evidence.works.filter(item => item.selection === 'included');
      if ((event.runId === null) !== (included.length === 0) || event.runId === null && event.state !== 'cancelled') fail('input_binding');
    } else if (event.runId !== null || event.state !== 'queued') fail('input_missing');
    return { event, payload };
  }
  private async original(tx: Transaction, event: Pick<Event, 'id' | 'runId'>, accessVersion: string) {
    const claimId = workRecoveryClaimId(this.options.scope, event.id), snapshot = await tx.get(this.ref('claim', claimId));
    if (event.runId === null) { if (snapshot.exists) fail('claim_conflict'); return null; }
    const claim = this.open('claim', claimId, snapshot, schemas.claim);
    const run = this.open('run', event.runId, await tx.get(this.ref('run', event.runId)), schemas.run);
    if (!this.bound(claim, accessVersion) || !this.bound(run, accessVersion) || claim.runId !== event.runId || run.id !== event.runId
      || claim.triggerReference !== event.id || run.triggerReference !== event.id || !run.dataVersion.startsWith(this.options.scope.storageEpoch + ':')
      || !decimal.safeParse(run.dataVersion.slice(this.options.scope.storageEpoch.length + 1)).success) fail('binding');
    const receipt = run.resultEncrypted === null ? null : this.decrypt(run.resultEncrypted,
      `agent-run:${run.childId}:${run.ownerUserId}:${run.id}`, receiptSchema);
    if (receipt && (receipt.runId !== run.id || receipt.status !== run.state || receipt.stopReason !== run.stopReason)
      || (run.state === 'completed' || run.state === 'stopped') && !receipt
      || run.state === 'running' && (receipt || run.stopReason !== null)
      || run.state === 'unknown' && !receipt && run.stopReason !== 'interrupted') fail('receipt_binding');
    return run;
  }
  private async terminal(tx: Transaction, workspace: z.infer<typeof schemas.workspace>, event: Event, nextState: Event['state']) {
    const nextSequence = (BigInt(workspace.changeSeq) + 1n).toString(); if (!decimal.safeParse(nextSequence).success) fail('sequence_exhausted');
    const scope = this.options.scope, changeId = JSON.stringify([scope.workspaceId, scope.storageEpoch, event.id]);
    const changeRef = this.ref('change', changeId); if ((await tx.get(changeRef)).exists) fail('change_conflict');
    // Caller has finished all other reads. No current-work state is inferred or changed here.
    return () => {
      tx.set(this.ref('event', event.id), this.seal('event', event.id, { ...event, state: nextState }, 2));
      tx.set(this.ref('workspace', workspace.id), this.seal('workspace', workspace.id, { ...workspace, changeSeq: nextSequence }));
      tx.create(changeRef, this.seal('change', changeId, { workspaceId: scope.workspaceId, storageEpoch: scope.storageEpoch,
        changeSeq: nextSequence, kind: 'memory', childId: scope.childId, privateUserId: scope.ownerUserId,
        ownerOnly: false, deleted: false, suppressWorkWake: true, eventId: event.id, runId: event.runId }));
    };
  }
  async enqueueDue(raw: z.infer<typeof dueSchema>): Promise<WorkContinuationJob | null> {
    const input = dueSchema.parse(raw), eventId = randomUUID(), jobId = randomUUID(), { database, scope } = this.options;
    return database.runTransaction(async tx => {
      const workspace = await this.authority(tx, input.workerGeneration);
      const localDay = new Date(this.now() + 8 * 3600_000).toISOString().slice(0, 10);
      const dailyId = JSON.stringify([scope.ownerUserId, scope.childId, localDay]), dailyRef = this.ref('daily', dailyId), existing = await tx.get(dailyRef);
      if (existing.exists) {
        const daily = this.open('daily', dailyId, existing, dailySchema);
        if (!same(scope, { ownerUserId: daily.ownerUserId, workspaceId: daily.workspaceId, childId: daily.childId, storageEpoch: daily.storageEpoch })
          || daily.localDay !== localDay || daily.workerGeneration !== input.workerGeneration) fail('daily_binding');
        const job = { eventId: daily.eventId, jobId: daily.jobId, storageEpoch: scope.storageEpoch, workerGeneration: daily.workerGeneration };
        await this.event(tx, job, workspace.accessVersion); return job;
      }
      const candidates: Awaited<ReturnType<FirestoreWorkContinuationStore['work']>>[] = [];
      for (const id of input.workIds) {
        const row = await this.work(tx, id, workspace.accessVersion);
        if (!row.followup.dueConsumed && this.active(row, row.work.version, false)) candidates.push(row);
      }
      if (!candidates.length) return null;
      const job = { eventId, jobId, workerGeneration: input.workerGeneration, storageEpoch: scope.storageEpoch };
      const event: Event = { ...scope, authorizationVersion: workspace.accessVersion, id: eventId, jobId,
        workerGeneration: input.workerGeneration, state: 'queued', runId: null, localDay, inputVersion: 2, inputEvidence: null,
        payloadEncrypted: this.options.cipher.encrypt(JSON.stringify({ works: candidates.map(row => ({ workId: row.work.id, workVersion: row.work.version,
          changes: { due: true, resources: [], knowledge: [] } })) }), `agent-work-continuation:${scope.childId}:${scope.ownerUserId}:${eventId}`) };
      const eventRef = this.ref('event', eventId); if ((await tx.get(eventRef)).exists) fail('event_conflict');
      const nextSequence = (BigInt(workspace.changeSeq) + 1n).toString(); if (!decimal.safeParse(nextSequence).success) fail('sequence_exhausted');
      const changeId = JSON.stringify([scope.workspaceId, scope.storageEpoch, eventId, 'queued']), changeRef = this.ref('change', changeId);
      if ((await tx.get(changeRef)).exists) fail('change_conflict');
      tx.create(eventRef, this.seal('event', eventId, event, 2));
      tx.set(this.ref('workspace', workspace.id), this.seal('workspace', workspace.id, { ...workspace, changeSeq: nextSequence }));
      tx.create(changeRef, this.seal('change', changeId, { workspaceId: scope.workspaceId, storageEpoch: scope.storageEpoch,
        changeSeq: nextSequence, kind: 'memory', childId: scope.childId, privateUserId: scope.ownerUserId,
        ownerOnly: false, deleted: false, suppressWorkWake: true, eventId, runId: null }));
      tx.create(dailyRef, this.seal('daily', dailyId, { ...scope, localDay, eventId, jobId, workerGeneration: input.workerGeneration }));
      for (const row of candidates) tx.set(this.ref('followup', row.work.id), this.seal('followup', row.work.id, { ...row.followup, dueConsumed: true }));
      return job;
    });
  }
  async beginBackground(raw: WorkContinuationJob): Promise<WorkContinuationAdmission> {
    const job = this.job(raw), runId = randomUUID(), { database, scope } = this.options;
    return database.runTransaction(async tx => {
      const workspace = await this.authority(tx, job.workerGeneration), snapshot = await tx.get(this.ref('event', job.eventId));
      if (snapshot.data()?.version === 1) {
        // A validated legacy event can only recover its original claim; never
        // upgrade its format, infer new input evidence or issue execution rights.
        const legacy = this.open('event', job.eventId, snapshot, schemas.event);
        if (!this.bound(legacy, workspace.accessVersion) || legacy.id !== job.eventId || legacy.jobId !== job.jobId
          || legacy.workerGeneration !== job.workerGeneration) fail('binding');
        const original = await this.original(tx, legacy, workspace.accessVersion);
        if (!original) fail('claim_missing');
        return { decision: 'lookup', runId: original.id };
      }
      const { event, payload } = await this.event(tx, job, workspace.accessVersion, snapshot);
      const original = await this.original(tx, event, workspace.accessVersion);
      if (event.inputEvidence !== null) return { decision: 'lookup', runId: original?.id ?? null };
      const entries: WorkContinuationContextEntry[] = [], selections: z.infer<typeof selectedSchema>[] = [];
      for (const candidate of payload.works) {
        const row = await this.work(tx, candidate.workId, workspace.accessVersion), included = this.active(row, candidate.workVersion, true);
        selections.push({ workId: candidate.workId, workVersion: candidate.workVersion, selection: included ? 'included' : 'not_included' });
        if (included) entries.push({ work: { ...row.values, id: row.work.id, childId: scope.childId, version: row.work.version },
          changes: candidate.changes, textPartial: false, knowledgeSourceIds: [] });
      }
      const selectedRun = entries.length ? runId : null;
      const next: Event = { ...event, runId: selectedRun, inputEvidence: { format: 'work-start-input', version: 1, ...scope,
        authorizationVersion: workspace.accessVersion, eventId: event.id, runId: selectedRun, workerGeneration: job.workerGeneration, works: selections } };
      if (!entries.length) { const commit = await this.terminal(tx, workspace, next, 'cancelled'); commit(); return { decision: 'lookup', runId: null }; }
      const context = projectWorkContinuationContext(event.id, entries), expiresAtMs = this.now() + 90_000;
      const claimId = workRecoveryClaimId(scope, event.id), binding = { ...scope, authorizationVersion: workspace.accessVersion };
      const run = { ...binding, id: runId, triggerKind: 'worker' as const, triggerReference: event.id, sourceMessageId: null,
        recipeId: 'product-work-followup' as const, dataVersion: scope.storageEpoch + ':' + workspace.changeSeq,
        state: 'running' as const, stopReason: null, expiresAtMs, resultEncrypted: null };
      if ((await tx.get(this.ref('run', runId))).exists) fail('run_conflict');
      tx.create(this.ref('claim', claimId), this.seal('claim', claimId, { ...binding, runId, triggerKind: 'worker', triggerReference: event.id }));
      tx.create(this.ref('run', runId), this.seal('run', runId, run)); tx.set(this.ref('event', event.id), this.seal('event', event.id, next, 2));
      const claim: AgentRunClaim = { runId, scope: { userId: scope.ownerUserId, childId: scope.childId, workspaceId: scope.workspaceId,
        authorizationVersion: workspace.accessVersion, dataVersion: run.dataVersion }, created: true, sourceMessageId: null,
        workerGeneration: job.workerGeneration, state: 'running', expiresAt: new Date(expiresAtMs).toISOString(), storageEpoch: scope.storageEpoch,
        trigger: { kind: 'worker', reference: event.id }, recipeId: run.recipeId };
      // Only the fulfilled transaction's return value may reach the consumer, never a callback side channel.
      return { decision: 'execute', job, claim, context };
    });
  }
  private async current(tx: Transaction, job: WorkContinuationJob, claim?: AgentRunClaim) {
    const workspace = await this.authority(tx, job.workerGeneration), { event, payload } = await this.event(tx, job, workspace.accessVersion);
    const run = await this.original(tx, event, workspace.accessVersion), entries: WorkContinuationContextEntry[] = [];
    let allCurrent = true;
    for (const candidate of payload.works) {
      const row = await this.work(tx, candidate.workId, workspace.accessVersion);
      if (event.inputEvidence?.works.find(item => item.workId === candidate.workId)?.selection !== 'included') continue;
      if (!this.active(row, candidate.workVersion, true)) { allCurrent = false; continue; }
      entries.push({ work: { ...row.values, id: row.work.id, childId: this.options.scope.childId, version: row.work.version },
        changes: candidate.changes, textPartial: false, knowledgeSourceIds: [] });
    }
    const active = Boolean(run && event.state === 'queued' && run.state === 'running' && run.expiresAtMs > this.now()
      && run.dataVersion === this.options.scope.storageEpoch + ':' + workspace.changeSeq && entries.length && allCurrent);
    if (claim && (!run || claim.runId !== run.id || claim.recipeId !== run.recipeId || claim.trigger?.kind !== 'worker'
      || claim.trigger.reference !== event.id || claim.sourceMessageId !== null || claim.workerGeneration !== job.workerGeneration || claim.storageEpoch !== run.storageEpoch
      || claim.expiresAt !== new Date(run.expiresAtMs).toISOString() || !same(claim.scope, { userId: run.ownerUserId, childId: run.childId,
        workspaceId: run.workspaceId, authorizationVersion: run.authorizationVersion, dataVersion: run.dataVersion }))) fail('claim_binding');
    return { workspace, event, run, entries, active };
  }
  async authorizeBackground(raw: WorkContinuationJob, claim: AgentRunClaim) {
    const job = this.job(raw); return this.options.database.runTransaction(async tx => (await this.current(tx, job, claim)).active, { readOnly: true });
  }
  async readWork(raw: WorkContinuationJob, claim: AgentRunClaim, workId: string | null) {
    const job = this.job(raw); if (workId !== null && !uuid.safeParse(workId).success) fail('work_invalid');
    return this.options.database.runTransaction(async tx => {
      const current = await this.current(tx, job, claim); if (!current.active) return null;
      if (workId !== null && !current.entries.some(item => item.work.id === workId)) fail('work_outside_input');
      return { items: current.entries.filter(item => workId === null || item.work.id === workId).map(item => item.work), complete: true, nextCursor: null };
    }, { readOnly: true });
  }
  async finishBackground(raw: WorkContinuationJob, claim: AgentRunClaim, rawResult: ProductAgentResult) {
    const job = this.job(raw), result = parse(receiptSchema, rawResult);
    if (result.runId !== claim.runId || result.status === 'unknown' || result.citations.length || result.privateSourceCitations?.length
      || result.retrievalMode !== 'not_used' || result.tools.some(tool => !['read_work', 'present_answer'].includes(tool.name))) fail('result_invalid');
    return this.options.database.runTransaction(async tx => {
      const current = await this.current(tx, job, claim); if (!current.active || !current.run) return false;
      const commit = await this.terminal(tx, current.workspace, current.event, result.status);
      const run = current.run, ciphertext = this.options.cipher.encrypt(JSON.stringify(result), `agent-run:${run.childId}:${run.ownerUserId}:${run.id}`);
      commit(); tx.set(this.ref('run', run.id), this.seal('run', run.id, { ...run, state: result.status, stopReason: result.stopReason, resultEncrypted: ciphertext }));
      return true;
    });
  }
  override async recoverBackground(raw: WorkContinuationJob): ReturnType<WorkContinuationRecovery['recoverBackground']> {
    const job = this.job(raw);
    const envelope = await this.options.database.runTransaction(async tx => (await tx.get(this.ref('event', job.eventId))).data(), { readOnly: true });
    if (envelope?.version === 1) return super.recoverBackground(job);
    return this.options.database.runTransaction(async tx => {
      const { workspace, event, run, entries } = await this.current(tx, job);
      if (!event.inputEvidence) fail('claim_missing');
      if (event.state !== 'queued') return { state: 'already_terminal', runId: run?.id ?? null };
      if (!run) fail('claim_missing');
      if (entries.length && run.state === 'running' && run.expiresAtMs > this.now()) return { state: 'pending', runId: run.id };
      const expired = run.state === 'running' && run.expiresAtMs <= this.now();
      const next = !entries.length ? 'cancelled' : run.state === 'running' ? 'unknown' : run.state;
      const commit = await this.terminal(tx, workspace, event, next); commit();
      if (expired) tx.set(this.ref('run', run.id), this.seal('run', run.id, { ...run, state: 'unknown', stopReason: 'interrupted' }));
      return { state: 'settled', runId: run.id };
    });
  }
}

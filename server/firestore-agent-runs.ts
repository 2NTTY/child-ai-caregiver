import { randomUUID } from 'node:crypto';
import { AGENT_RUN_LIMITS } from '../src/shared/agent-run-limits.ts';
import { z } from 'zod';
import type { DocumentSnapshot } from '@google-cloud/firestore';
import type { AgentScope } from './agent-runtime.ts';
import type { AgentRunClaim } from './product-agent-store.ts';
import type { ProductAgentResult } from '../src/shared/product-agent.ts';
import { productAgentResultSchema } from '../src/shared/product-agent-result.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { FirestoreChatStore } from './firestore-chat.ts';
import type { FirestoreMemoryStore } from './firestore-memory.ts';
import { FirestoreAuthorityError } from './firestore-authority.ts';
import { summarySaveSchema } from './memory-validation.ts';
import { FirestoreDomainError } from './firestore-domain-data.ts';

const uuid = z.uuid(), time = z.iso.datetime({ offset: true }), decimal = z.string().regex(/^(0|[1-9][0-9]{0,18})$/u);
export const firestoreAgentRunSchema = z.object({
  id: uuid, childId: uuid, ownerUserId: z.string().min(1).max(256), workspaceId: uuid, storageEpoch: uuid,
  authorizationVersion: decimal, dataVersion: z.string().max(100),
  trigger: z.object({ kind: z.enum(['interactive', 'worker']), reference: uuid }).strict(),
  workerGeneration: uuid.optional(),
  sourceMessageId: uuid.nullable(), recipeId: z.string().min(1).max(128),
  state: z.enum(['running', 'completed', 'stopped', 'unknown']), stopReason: z.string().max(128).nullable(),
  createdAt: time, expiresAt: time, result: productAgentResultSchema.nullable(),
}).strict();
export type FirestoreAgentRun = z.infer<typeof firestoreAgentRunSchema>;
export const firestoreAgentClaimSchema = z.object({ runId: uuid }).strict();
export interface FirestoreAgentRunOptions extends FirestoreDomainOptions {
  chat: FirestoreChatStore;
  memory: FirestoreMemoryStore;
  serverClock?: () => number;
  readInteractiveRunSeconds?: (tx: import("@google-cloud/firestore").Transaction) => Promise<number>;
  /** Only the authenticated worker composition supplies this canonical lease/resource gate. */
  authorizeWorker?: (binding: Binding, reference: string, recipeId: string) => Promise<boolean>;
}
export interface FirestoreAgentResultProjection {
  /** Read original proposal/action/document ledgers, even when final generation was interrupted. */
  read(binding: Binding, run: FirestoreAgentRun, result: ProductAgentResult): Promise<ProductAgentResult>;
}

/** Private business run authority. Native ADK sessions remain protocol state, never execution receipts. */
export function createFirestoreAgentRuns(options: FirestoreAgentRunOptions) {
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options);
  const now = options.serverClock ?? Date.now;
  const ref = (id: string) => data.ref('agent_runs', 'agent-run', id);
  const claimId = (b: Binding, kind: 'interactive' | 'worker', reference: string) =>
    JSON.stringify([b.scope.ownerUserId, b.scope.childId, kind, reference]);
  const current = (b: Binding): AgentScope => ({ userId: b.scope.ownerUserId, childId: b.scope.childId,
    workspaceId: b.scope.workspaceId, authorizationVersion: b.authorizationVersion,
    dataVersion: b.scope.storageEpoch + ':' + b.changeSeq });
  function matches(b: Binding, scope: AgentScope, run?: FirestoreAgentRun, exact = true) {
    return scope.userId === b.scope.ownerUserId && scope.childId === b.scope.childId
      && scope.workspaceId === b.scope.workspaceId && scope.authorizationVersion === b.authorizationVersion
      && scope.dataVersion.split(':')[0] === b.scope.storageEpoch
      && (!run || run.authorizationVersion === b.authorizationVersion && run.storageEpoch === b.scope.storageEpoch)
      && (!exact || (run?.dataVersion ?? scope.dataVersion) === current(b).dataVersion);
  }
  function decode(b: Binding, id: string, row: DocumentSnapshot): FirestoreAgentRun {
    if (!row.exists || Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
    const run = data.open('agent-run', id, b.scope, firestoreAgentRunSchema, row);
    if (run.id !== id || run.childId !== b.scope.childId || run.ownerUserId !== b.scope.ownerUserId
      || run.workspaceId !== b.scope.workspaceId || run.storageEpoch !== b.scope.storageEpoch
      || !run.dataVersion.startsWith(run.storageEpoch + ':') || row.get('runId') !== id
      || row.get('createdAt') !== run.createdAt || row.get('triggerKind') !== run.trigger.kind
      || row.get('recordVersion') !== 1 || run.result && run.result.runId !== id
      || (run.trigger.kind === 'interactive' ? run.sourceMessageId !== run.trigger.reference : run.sourceMessageId !== null))
      domainReject('agent_run_binding', 500);
    return run;
  }
  async function read(b: Binding, id: string) {
    domainParse(uuid, id); return decode(b, id, await b.transaction.get(ref(id)));
  }
  function expired(run: FirestoreAgentRun): FirestoreAgentRun {
    return run.state === 'running' && Date.parse(run.expiresAt) <= now()
      ? { ...run, state: 'unknown', stopReason: 'interrupted' } : run;
  }
  function write(b: Binding, run: FirestoreAgentRun, create = false) {
    const envelope = { ...data.tags(b.scope), runId: run.id, createdAt: run.createdAt, triggerKind: run.trigger.kind,
      ...data.seal('agent-run', run.id, b.scope, firestoreAgentRunSchema, run) };
    if (create) b.transaction.create(ref(run.id), envelope); else b.transaction.set(ref(run.id), envelope);
  }
  async function requireLive(b: Binding, scope: AgentScope, id: string) {
    const run = expired(await read(b, id));
    if (!matches(b, scope, run) || run.state !== 'running'
      || run.trigger.kind === 'worker' && (run.workerGeneration !== b.generation || !await options.authorizeWorker?.(b, run.trigger.reference, run.recipeId))) domainReject('agent_scope_changed');
    return run;
  }
  function advance(b: Binding, run: FirestoreAgentRun, changeSeq: string) {
    domainParse(decimal, changeSeq);
    // Only called by a server-owned prepared mutation, in the same Firestore transaction.
    if (BigInt(changeSeq) !== BigInt(b.changeSeq) + 1n) domainReject('agent_change_binding', 500);
    write(b, { ...run, dataVersion: b.scope.storageEpoch + ':' + changeSeq });
  }
  const empty = (run: FirestoreAgentRun): ProductAgentResult => ({ runId: run.id, status: run.state,
    stopReason: run.stopReason, provenance: null, countsKnown: false, text: '', citations: [], privateSourceCitations: [],
    retrievalMode: 'not_used', tools: [], counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, proposals: [] });
  async function originalRun(b: Binding, kind: 'interactive' | 'worker', reference: string) {
    const id = claimId(b, kind, reference), snapshot = await b.transaction.get(data.ref('agent_claims', 'agent-claim', id));
    if (!snapshot.exists) return null;
    const claim = data.open('agent-claim', id, b.scope, firestoreAgentClaimSchema, snapshot);
    const run = await read(b, claim.runId);
    if (run.trigger.kind !== kind || run.trigger.reference !== reference) domainReject('agent_claim_binding', 500);
    return run;
  }
  const originalReplyRun = (b: Binding, id: string) => originalRun(b, 'interactive', id);
  return {
    authority, data, current, matches, read, requireLive, advance, write, originalReplyRun, originalRun,
    async replyState(userId: string, childId: string, messageId: string) {
      domainParse(uuid, messageId);
      try { return await authority.runTransaction(userId, childId, async b => {
        const source = await options.chat.readMessage(b, childId, messageId);
        if (!source || source.role !== 'user' || source.authorUserId !== userId) domainReject('not_found', 404);
        const original = await originalReplyRun(b, messageId);
        if (!original) return null;
        if (!matches(b, current(b), original, false)) domainReject('agent_scope_changed');
        const run = expired(original);
        return { messageId, runId: run.id, status: run.state, stopReason: run.stopReason };
      }); } catch (error) {
        // A missing/foreign child is not an unclaimed message and must not enable a new reply.
        if (error instanceof FirestoreAuthorityError && [403, 404].includes(error.status)) domainReject('not_found', 404);
        throw error;
      }
    },
    async claim(userId: string, childId: string, trigger: AgentRunClaim['trigger'] & {}, recipeId: string): Promise<AgentRunClaim> {
      domainParse(firestoreAgentRunSchema.shape.trigger, trigger); domainParse(firestoreAgentRunSchema.shape.recipeId, recipeId);
      if (trigger.kind === 'interactive' ? recipeId !== 'product-interactive' : !options.authorizeWorker) domainReject('domain_not_ready', 503);
      const candidate = randomUUID();
      return authority.runTransaction(userId, childId, async b => {
        if (trigger.kind === 'interactive') {
          const source = await options.chat.readMessage(b, childId, trigger.reference);
          if (!source || source.role !== 'user' || source.authorUserId !== userId) domainReject('not_found', 404);
        } else if (!await options.authorizeWorker?.(b, trigger.reference, recipeId)) domainReject('background_not_authorized', 403);
        const old = await originalRun(b, trigger.kind, trigger.reference);
        // Existing claims keep their original absolute deadline; a retry never extends it.
        const seconds = old ? null : trigger.kind === "interactive"
          ? await options.readInteractiveRunSeconds?.(b.transaction) ?? AGENT_RUN_LIMITS.deadlineSeconds.default : 90;
        if (seconds !== null && (!Number.isSafeInteger(seconds) || seconds < AGENT_RUN_LIMITS.deadlineSeconds.min || seconds > AGENT_RUN_LIMITS.deadlineSeconds.max)) domainReject("invalid_run_deadline");
        const at = now();
        const run: FirestoreAgentRun = old ? expired(old) : {
          id: candidate, childId, ownerUserId: userId, workspaceId: b.scope.workspaceId, storageEpoch: b.scope.storageEpoch,
          authorizationVersion: b.authorizationVersion, dataVersion: current(b).dataVersion, trigger,
          ...(trigger.kind === 'worker' ? {workerGeneration:b.generation} : {}),
          sourceMessageId: trigger.kind === 'interactive' ? trigger.reference : null, recipeId, state: 'running', stopReason: null,
          createdAt: new Date(at).toISOString(), expiresAt: new Date(at + seconds! * 1000).toISOString(), result: null,
        };
        if (!old) {
          const id = claimId(b, trigger.kind, trigger.reference);
          const envelope = { ...data.tags(b.scope), ...data.seal('agent-claim', id, b.scope, firestoreAgentClaimSchema, { runId: run.id }) };
          write(b, run, true); b.transaction.create(data.ref('agent_claims', 'agent-claim', id), envelope);
        } else if (old.state !== run.state) write(b, run);
        return { runId: run.id, scope: { ...current(b), authorizationVersion: run.authorizationVersion, dataVersion: run.dataVersion },
          created: !old, sourceMessageId: run.sourceMessageId, state: run.state, expiresAt: run.expiresAt,
          storageEpoch: run.storageEpoch, trigger: run.trigger, recipeId: run.recipeId, workerGeneration: run.workerGeneration,
          purpose: trigger.kind === 'interactive' ? 'chat' : recipeId === 'product-work-followup' ? 'work-continuation' : 'background' };
      });
    },
    async authorize(scope: AgentScope, runId?: string) {
      try {
        return await authority.runTransaction(scope.userId, scope.childId, async b => {
          const run = runId ? expired(await read(b, runId)) : undefined;
          return matches(b, scope, run) && (!runId || run?.state === 'running')
            && (!run || run.trigger.kind !== 'worker' || run.workerGeneration === b.generation && await options.authorizeWorker?.(b, run.trigger.reference, run.recipeId) === true);
        });
      } catch (error) {
        if (error instanceof FirestoreAuthorityError && [403, 404, 428].includes(error.status)) return false;
        throw error;
      }
    },
    async cancelReply(userId: string, childId: string, messageId: string) {
      domainParse(uuid, messageId);
      return authority.runTransaction(userId, childId, async b => {
        const source = await options.chat.readMessage(b, childId, messageId), original = await originalReplyRun(b, messageId);
        if (!source || source.role !== 'user' || !original || original.result
          || !matches(b, current(b), original, false)) return false;
        const run = expired(original);
        if (run.state === 'stopped' && run.stopReason === 'cancelled') return true;
        if (run.state !== 'running') { if (run.state !== original.state) write(b, run); return false; }
        write(b, { ...run, state: 'stopped', stopReason: 'cancelled' }); return true;
      });
    },
    async result(userId: string, childId: string, runId: string, projection: FirestoreAgentResultProjection, cancelledOnly = false) {
      return authority.runTransaction(userId, childId, async b => {
        const original = await read(b, runId), run = expired(original);
        if (cancelledOnly && !(run.state === 'stopped' && run.stopReason === 'cancelled' && run.result === null)) return null;
        const value = await projection.read(b, run, { ...(run.result ?? empty(run)), status: run.state, stopReason: run.stopReason });
        if (run.state !== original.state) write(b, run);
        return value;
      });
    },
    async finish(scope: AgentScope, raw: ProductAgentResult, summary?: z.infer<typeof summarySaveSchema>) {
      const value = domainParse(productAgentResultSchema, raw);
      if (value.status === 'running') domainReject('invalid_result', 500);
      return authority.runTransaction(scope.userId, scope.childId, async b => {
        // The execution deadline prevents new work, not the original executor's terminal save.
        // A read may already have projected expiry as interrupted. Only that unresolved state
        // can settle; cancellation, another final result and changed authority remain fenced.
        const run = await read(b, value.runId);
        const unresolved = run.state === 'running' || run.state === 'unknown' && run.stopReason === 'interrupted';
        if (!unresolved || run.result !== null || !matches(b, scope, run, false)) return false;
        if (value.outcome === 'no_action' && run.trigger.kind !== 'worker') domainReject('invalid_result', 500);
        const unchanged = matches(b, scope, run) && (run.trigger.kind !== 'worker'
          || run.workerGeneration === b.generation && await options.authorizeWorker?.(b, run.trigger.reference, run.recipeId) === true);
        const result: ProductAgentResult = unchanged ? value : { ...value, status: 'stopped', stopReason: 'unauthorized',
          outcome: undefined, text: '資料在處理期間有變，請核對目前資料及原操作收據；不要重複提交已保存的操作。',
          citations: [], privateSourceCitations: [], retrievalMode: 'not_used', tools: [], proposals: [] };
        // A stale summary is optional; an invalid authority/read is not a silent empty summary.
        let prepared: Awaited<ReturnType<FirestoreMemoryStore['prepareSummaryWrite']>> | undefined;
        if (summary && result.status === 'completed') {
          try { prepared = await options.memory.prepareSummaryWrite(b, summary, run.id); }
          catch (error) {
            // This specific check precedes change reservation and all writes. Other failures remain fatal.
            if (!(error instanceof FirestoreDomainError && error.code === 'summary_coverage_changed')) throw error;
          }
        }
        const saved: FirestoreAgentRun = { ...run, state: result.status, stopReason: result.stopReason,
          dataVersion: b.scope.storageEpoch + ':' + (prepared?.changeSeq ?? b.changeSeq),
          result: { ...result, proposals: [] } };
        prepared?.commit(); write(b, saved); return true;
      });
    },
    async backgroundRuns(userId: string, childId: string) {
      return authority.runTransaction(userId, childId, async b => {
        const tags = data.tags(b.scope);
        const rows = await b.transaction.get(data.collection('agent_runs')
          .where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag)
          .where('childTag', '==', tags.childTag).where('userTag', '==', tags.userTag).where('triggerKind', '==', 'worker')
          .orderBy('createdAt', 'desc').orderBy('runId', 'desc').limit(20));
        return rows.docs.map(row => { const run = decode(b, row.get('runId'), row); return { runId: run.id, createdAt: run.createdAt }; });
      });
    },
  };
}
export type FirestoreAgentRuns = ReturnType<typeof createFirestoreAgentRuns>;

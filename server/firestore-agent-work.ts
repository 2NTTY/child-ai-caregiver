import type { Query, DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import { agentWorkSchema, readAgentWorkSchema, saveAgentWorkSchema, type AgentWork, type AgentWorkPage,
  type SaveAgentWork, type WorkResource } from '../src/shared/agent-work.ts';
import type { AgentScope } from './agent-runtime.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import type { FirestoreAgentRuns } from './firestore-agent-runs.ts';
import type { FirestoreAgentProposals } from './firestore-agent-proposals.ts';
import { domainParse, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';

const uuid = z.uuid(), time = z.iso.datetime({ offset: true });
export const firestoreAgentWorkProjectionSchema = z.object({ workId: uuid, version: z.number().int().positive(), createdAt: time }).strict();
export const firestoreAgentWorkOperationSchema = z.object({
  operationId: uuid, runId: uuid, callId: z.string().min(1).max(200), hash: z.string().regex(/^[a-f0-9]{64}$/u), result: agentWorkSchema,
}).strict();
const cursorSchema = z.object({ userId: z.string(), childId: uuid, epoch: uuid, changeSeq: z.string(),
  createdAt: time, id: uuid }).strict();
export function createFirestoreAgentWork(options: {
  runs: FirestoreAgentRuns; proposals: FirestoreAgentProposals;
  validateResource(binding: Binding, resource: WorkResource): Promise<void>;
  validateKnowledge(binding: Binding, sourceId: string): Promise<void>;
  continuation: import('./firestore-work-followup.ts').FirestoreWorkFollowUp;
}) {
  const { runs, proposals } = options, { data, authority } = runs;
  function scoped(b: Binding, suffix: string): Query {
    const tags = data.tags(b.scope);
    return data.collection(suffix).where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag)
      .where('userTag', '==', tags.userTag).where('childTag', '==', tags.childTag);
  }
  function open<T>(b: Binding, kind: string, id: string, schema: z.ZodType<T>, row: DocumentSnapshot) {
    if (Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
    return data.open(kind, id, b.scope, schema, row);
  }
  return {
    async readWork(userId: string, childId: string, raw: z.infer<typeof readAgentWorkSchema>): Promise<AgentWorkPage> {
      const input = domainParse(readAgentWorkSchema, raw);
      let cursor: z.infer<typeof cursorSchema> | null = null;
      if (input.cursor !== null) {
        try {
          if (!/^[A-Za-z0-9_-]{1,2048}$/u.test(input.cursor)) throw Error();
          cursor = cursorSchema.parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')));
          if (cursor.userId !== userId || cursor.childId !== childId) throw Error();
        } catch { domainReject('invalid_cursor', 400); }
      }
      return authority.runTransaction(userId, childId, async b => {
        if (input.workId) { const work = await b.readWork(input.workId); return { items: work ? [await options.continuation.project(b, work)] : [], nextCursor: null, complete: true }; }
        if (cursor && (cursor.epoch !== b.scope.storageEpoch || cursor.changeSeq !== b.changeSeq)) domainReject('version_conflict');
        let query = scoped(b, 'agent_work_index').orderBy('createdAt', 'desc').orderBy('workId', 'desc').limit(11);
        if (cursor) query = query.startAfter(cursor.createdAt, cursor.id);
        const rows = await b.transaction.get(query), items: AgentWork[] = [];
        let length = 0;
        for (const row of rows.docs.slice(0, 10)) {
          const id = domainParse(uuid, row.get('workId'), 'work_binding', 500);
          const projection = open(b, 'agent-work-index', id, firestoreAgentWorkProjectionSchema, row), work = await b.readWork(id);
          if (!work || projection.workId !== id || projection.version !== work.version || projection.createdAt !== work.createdAt
            || projection.createdAt !== row.get('createdAt')) domainReject('work_binding', 500);
          const size = JSON.stringify(work).length;
          if (items.length && length + size > 7000) break;
          items.push(await options.continuation.project(b, work)); length += size;
        }
        const last = items.at(-1), more = rows.size > items.length;
        return { items, complete: !more, nextCursor: more && last ? Buffer.from(JSON.stringify({
          userId, childId, epoch: b.scope.storageEpoch, changeSeq: b.changeSeq, createdAt: last.createdAt, id: last.id })).toString('base64url') : null };
      });
    },
    async saveWork(scope: AgentScope, runId: string, callId: string, raw: SaveAgentWork): Promise<AgentWork> {
      const input = domainParse(saveAgentWorkSchema, raw), hash = firestoreDomainHash(input);
      domainParse(z.string().min(1).max(200), callId);
      return authority.runTransaction(scope.userId, scope.childId, async b => {
        const opKey = JSON.stringify([scope.userId, scope.childId, input.operationId]), callKey = JSON.stringify([runId, callId]);
        const opRef = data.ref('agent_work_operations', 'agent-work-operation', opKey);
        const callRef = data.ref('agent_work_calls', 'agent-work-call', callKey);
        const [priorOp, priorCall] = await Promise.all([b.transaction.get(opRef), b.transaction.get(callRef)]);
        if (priorOp.exists || priorCall.exists) {
          const prior = priorOp.exists
            ? open(b, 'agent-work-operation', opKey, firestoreAgentWorkOperationSchema, priorOp)
            : open(b, 'agent-work-call', callKey, firestoreAgentWorkOperationSchema, priorCall);
          if (prior.hash !== hash || prior.operationId !== input.operationId
            || priorCall.exists && (prior.runId !== runId || prior.callId !== callId)) domainReject('operation_conflict');
          return prior.result;
        }
        const run = await runs.requireLive(b, scope, runId);
        if (run.trigger.kind !== 'interactive') domainReject('confirmation_requires_interactive_scope', 400);
        for (const id of input.values.sourceMessageIds) await proposals.source(b, run, id);
        for (const ref of input.values.resources) await options.validateResource(b, ref);
        for (const ref of input.values.pending) {
          const pending = proposals.visible(await proposals.read(b, ref.runId, ref.proposalId));
          if (pending.version !== ref.version || pending.status !== 'pending') domainReject('work_proposal_changed');
        }
        for (const sourceId of input.values.followUp?.knowledgeSourceIds ?? []) await options.validateKnowledge(b, sourceId);
        const prepared = await b.prepareWork(input), work = prepared.value;
        const followUp = await options.continuation.prepare(b, work);
        const result = { operationId: input.operationId, runId, callId, hash, result: work };
        const index = { ...data.tags(b.scope), workId: work.id, createdAt: work.createdAt,
          ...data.seal('agent-work-index', work.id, b.scope, firestoreAgentWorkProjectionSchema,
            { workId: work.id, version: work.version, createdAt: work.createdAt }, work.version) };
        const operation = { ...data.tags(b.scope), ...data.seal('agent-work-operation', opKey, b.scope, firestoreAgentWorkOperationSchema, result) };
        const call = { ...data.tags(b.scope), ...data.seal('agent-work-call', callKey, b.scope, firestoreAgentWorkOperationSchema, result) };
        prepared.commit(); followUp.commit(); b.transaction.set(data.ref('agent_work_index', 'agent-work-index', work.id), index);
        b.transaction.create(opRef, operation); b.transaction.create(callRef, call); runs.advance(b, run, prepared.changeSeq);
        return work;
      });
    },
  };
}

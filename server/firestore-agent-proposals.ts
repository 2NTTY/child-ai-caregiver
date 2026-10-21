import { randomUUID } from 'node:crypto';
import type { Query, DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import type { AgentScope } from './agent-runtime.ts';
import { agentProposalSchema, agentDecisionSchema, type AgentProposal, type AgentProposalValue, type AgentDecision, type AgentPendingPage } from '../src/shared/product-agent.ts';
import { agentSavedProposalSchema } from '../src/shared/product-agent-result.ts';
import { dataComposeReviewBindingSchema, type DataComposeReviewBinding } from '../src/shared/data-compose.ts';
import { composeReviewStillAllowsProposal } from './data-compose.ts';
import { firestoreTaskSchema, domainParse, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import type { FirestoreAgentRuns, FirestoreAgentRun } from './firestore-agent-runs.ts';
import type { FirestoreChatStore } from './firestore-chat.ts';
import type { FirestoreMemoryStore } from './firestore-memory.ts';
import { preserveMemoryFactUserWording } from './memory-policy.ts';
import type { FirestoreOnlineStore } from './firestore-online.ts';

const uuid = z.uuid(), time = z.iso.datetime({ offset: true });
export const firestoreAgentProposalSchema = z.object({
  proposal: agentSavedProposalSchema, callId: z.string().min(1).max(200),
  authorizationVersion: z.string().regex(/^[0-9]+$/u), sourceBasis: z.string().nullable(),
  /** Server compose-review binding; omitted for ordinary clear-edit proposes. */
  composeReview: dataComposeReviewBindingSchema.optional(),
}).strict();
export type FirestoreAgentProposal = z.infer<typeof firestoreAgentProposalSchema>;
const cursorSchema = z.object({ userId: z.string(), childId: uuid, epoch: uuid, createdAt: time, id: uuid }).strict();
type Target = { label: string | null; visibility?: 'family' | 'private'; sourceBasis: string | null };
type Prepared = { result: NonNullable<AgentProposal['result']>; changeSeq: string; commit(): void };
export interface FirestoreAgentProposalExtension {
  supports(value: AgentProposalValue): boolean;
  target(binding: Binding, value: AgentProposalValue): Promise<Target>;
  prepare(binding: Binding, saved: FirestoreAgentProposal, operationId: string): Promise<Prepared>;
}
export function createFirestoreAgentProposals(options: {
  runs: FirestoreAgentRuns; chat: FirestoreChatStore; memory: FirestoreMemoryStore; online: FirestoreOnlineStore;
  extensions?: readonly FirestoreAgentProposalExtension[]; serverClock?: () => number;
}) {
  const { runs, chat, memory, online } = options, { data, authority } = runs, now = options.serverClock ?? Date.now;
  function query(b: Binding): Query {
    const tags = data.tags(b.scope);
    return data.collection('agent_proposals').where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag)
      .where('userTag', '==', tags.userTag).where('childTag', '==', tags.childTag);
  }
  function decode(b: Binding, id: string, row: DocumentSnapshot): FirestoreAgentProposal {
    if (!row.exists || Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
    const saved = data.open('agent-proposal', id, b.scope, firestoreAgentProposalSchema, row), p = saved.proposal;
    if (p.id !== id || p.childId !== b.scope.childId || p.version !== row.get('recordVersion')
      || p.id !== row.get('proposalId') || p.runId !== row.get('runId') || p.createdAt !== row.get('createdAt')
      || p.expiresAt !== row.get('expiresAt') || p.status !== row.get('status')) domainReject('proposal_binding', 500);
    return saved;
  }
  const visible = (saved: FirestoreAgentProposal): AgentProposal => {
    const p = saved.proposal;
    return p.status === 'pending' && Date.parse(p.expiresAt) <= now() ? { ...p, status: 'expired' } : p;
  };
  async function read(b: Binding, runId: string, id: string) {
    domainParse(uuid, runId); domainParse(uuid, id);
    const saved = decode(b, id, await b.transaction.get(data.ref('agent_proposals', 'agent-proposal', id)));
    if (saved.proposal.runId !== runId) domainReject('not_found', 404);
    return saved;
  }
  function write(b: Binding, saved: FirestoreAgentProposal, create = false) {
    const p = saved.proposal, ref = data.ref('agent_proposals', 'agent-proposal', p.id);
    const envelope = { ...data.tags(b.scope), runId: p.runId, proposalId: p.id, createdAt: p.createdAt,
      expiresAt: p.expiresAt, status: p.status, authorizationVersion: saved.authorizationVersion,
      ...data.seal('agent-proposal', p.id, b.scope, firestoreAgentProposalSchema, saved, p.version) };
    if (create) b.transaction.create(ref, envelope); else b.transaction.set(ref, envelope);
  }
  async function inRun(b: Binding, runId: string) {
    const rows = await b.transaction.get(query(b).where('runId', '==', runId).orderBy('createdAt', 'asc').orderBy('proposalId', 'asc').limit(9));
    if (rows.size > 8) domainReject('agent_proposal_limit');
    return rows.docs.map(row => decode(b, domainParse(uuid, row.get('proposalId'), 'proposal_binding', 500), row));
  }
  async function source(b: Binding, run: FirestoreAgentRun, messageId: string) {
    if (!run.sourceMessageId) domainReject('source_changed');
    const message = await chat.readMessage(b, b.scope.childId, messageId), root = await chat.readMessage(b, b.scope.childId, run.sourceMessageId);
    if (!message || message.role !== 'user' || message.authorUserId !== b.scope.ownerUserId || !root) domainReject('source_changed');
    const [itemRow, rootRow] = await Promise.all([
      b.transaction.get(data.ref('chat_messages', 'chat-message', messageId)),
      b.transaction.get(data.ref('chat_messages', 'chat-message', run.sourceMessageId)),
    ]);
    if (itemRow.get('sortKey') > rootRow.get('sortKey')) domainReject('source_changed');
    return message;
  }
  async function target(b: Binding, run: FirestoreAgentRun, value: AgentProposalValue): Promise<Target> {
    if (value.kind === 'task_create' || value.kind === 'task_change') {
      if (value.kind === 'task_create') {
        if (value.values.assigneeUserId !== b.scope.ownerUserId) domainReject('invalid_assignee', 400);
        return { label: '本人', visibility: 'family', sourceBasis: null };
      }
      const row = await b.transaction.get(data.ref('tasks', 'task', value.taskId));
      if (!row.exists || Object.entries(data.tags(b.scope)).some(([key, tag]) => row.get(key) !== tag)) domainReject('not_found', 404);
      const task = data.open('task', value.taskId, b.scope, firestoreTaskSchema, row);
      if (task.id !== value.taskId || task.childId !== b.scope.childId || task.version !== value.change.expectedVersion) domainReject('version_conflict');
      if (value.change.action === 'reschedule' && value.change.assigneeUserId !== b.scope.ownerUserId) domainReject('invalid_assignee', 400);
      return { label: task.title + ' · 本人', visibility: 'family', sourceBasis: null };
    }
    if (value.kind === 'memory_fact') {
      await source(b, run, value.sourceMessageId ?? run.sourceMessageId!);
      return { label: null, visibility: value.intendedVisibility, sourceBasis: null };
    }
    if (value.kind === 'memory_fact_revise' || value.kind === 'memory_fact_deactivate') {
      const fact = await memory.readFact(b, value.factId);
      if (!fact || fact.version !== value.expectedVersion || fact.status === 'inactive') domainReject('version_conflict');
      if (value.kind === 'memory_fact_revise') await source(b, run, value.sourceMessageId);
      return { label: fact.key, visibility: fact.visibility, sourceBasis: null };
    }
    const extension = options.extensions?.find(item => item.supports(value));
    if (!extension) domainReject('domain_not_ready', 503);
    return extension.target(b, value);
  }
  async function prepareEffect(b: Binding, run: FirestoreAgentRun, saved: FirestoreAgentProposal, sharing: boolean): Promise<Prepared> {
    const { value, id } = saved.proposal;
    if (value.kind === 'task_create' || value.kind === 'task_change') {
      const prepared = await online.prepareTask(b, b.scope.childId, value.kind === 'task_change' ? value.taskId : undefined,
        value.kind === 'task_create' ? { values: value.values, confirm: true } : value.change, id);
      return { ...prepared, result: { kind: 'task', id: prepared.task.id, version: prepared.task.version } };
    }
    if (value.kind === 'memory_fact') {
      const prepared = await memory.prepareConfirmedFact(b, { intendedVisibility: value.intendedVisibility,
        values: { key: value.key, content: value.content, validUntil: value.validUntil,
          source: { kind: 'private_chat', messageId: value.sourceMessageId ?? run.sourceMessageId!,
            description: '由本人聊天提出，經本人核對確認' } } }, sharing, id);
      return { ...prepared, result: { kind: 'memory_fact', id: prepared.value.id, version: prepared.value.version } };
    }
    if (value.kind === 'memory_fact_revise' || value.kind === 'memory_fact_deactivate') {
      const prepared = await memory.prepareFactChange(b, value.kind === 'memory_fact_revise' ? 'revise' : 'deactivate', value.factId,
        value.kind === 'memory_fact_revise' ? { expectedVersion: value.expectedVersion, confirm: true, confirmShared: sharing,
          reason: value.reason, values: { key: value.key, content: value.content, validUntil: value.validUntil,
            source: { kind: 'private_chat', messageId: value.sourceMessageId, description: '由本人聊天提出，經本人核對更正' } } }
          : { expectedVersion: value.expectedVersion, reason: value.reason }, id);
      return { ...prepared, result: { kind: 'memory_fact', id: prepared.value.id, version: prepared.value.version } };
    }
    const extension = options.extensions?.find(item => item.supports(value));
    if (!extension) domainReject('domain_not_ready', 503);
    return extension.prepare(b, saved, id);
  }
  async function prepareDecision(b: Binding, runId: string, id: string, raw: AgentDecision) {
    const input = domainParse(agentDecisionSchema, raw), saved = await read(b, runId, id), p = visible(saved);
    const wanted = input.decision === 'accept' ? 'accepted' : 'dismissed';
    const run = await runs.read(b, runId);
    if (p.status === wanted && p.version === input.expectedVersion + 1) return { value: p, commit() {} };
    if (!['pending', 'expired'].includes(p.status) || p.version !== input.expectedVersion) domainReject('version_conflict');
    if (wanted === 'accepted' && p.status === 'expired') domainReject('confirmation_expired');
    if (p.status === 'pending' && (saved.authorizationVersion !== b.authorizationVersion || !runs.matches(b, runs.current(b), run, false)))
      domainReject('confirmation_scope_changed');
    let effect: Prepared | undefined;
    if (wanted === 'accepted') {
      const checked = await target(b, run, p.value);
      if (checked.sourceBasis !== saved.sourceBasis || checked.visibility !== p.targetVisibility) domainReject('source_changed');
      if (checked.visibility === 'family' && !input.confirmShared) domainReject('sharing_confirmation_required', 400);
      if (saved.composeReview && p.value.kind === 'family_document_change') {
        const live = runs.current(b);
        if (!composeReviewStillAllowsProposal({
          review: saved.composeReview,
          documentId: p.value.documentId,
          expectedVersion: p.value.change.expectedVersion,
          authorityVersion: p.value.change.authorityVersion,
          edits: p.value.change.edits,
          scope: live,
        })) domainReject('compose_review_required');
      }
      effect = await prepareEffect(b, run, saved, input.confirmShared);
    }
    const change = effect ? null : await b.prepareChange(p.id, 'memory', true);
    const value: AgentProposal = { ...p, version: p.version + 1, status: wanted, result: effect?.result ?? null };
    const next = { ...saved, proposal: value };
    return { value, commit() { effect?.commit(); change?.commit(); write(b, next); } };
  }
  return {
    query, read, visible, inRun, source, target, prepareDecision,
    async propose(scope: AgentScope, runId: string, callId: string, raw: AgentProposalValue, options?: { composeReview?: DataComposeReviewBinding }) {
      const value = domainParse(agentProposalSchema, raw); domainParse(z.string().min(1).max(200), callId);
      const composeReview = options?.composeReview ? dataComposeReviewBindingSchema.parse(options.composeReview) : undefined;
      return authority.runTransaction(scope.userId, scope.childId, async b => {
        const run = await runs.requireLive(b, scope, runId);
        if (run.trigger.kind !== 'interactive') domainReject('confirmation_requires_interactive_scope', 400);
        let proposalValue = value;
        if (value.kind === 'memory_fact') {
          const message = await source(b, run, value.sourceMessageId ?? run.sourceMessageId!);
          proposalValue = { ...value, content: preserveMemoryFactUserWording(message.text, value.content) };
        } else if (value.kind === 'memory_fact_revise') {
          const message = await source(b, run, value.sourceMessageId);
          proposalValue = { ...value, content: preserveMemoryFactUserWording(message.text, value.content) };
        }
        const previous = await inRun(b, runId), fingerprint = firestoreDomainHash(proposalValue);
        for (const item of previous) {
          const same = firestoreDomainHash(item.proposal.value) === fingerprint;
          if (item.callId === callId && !same) domainReject('operation_conflict');
          if (same) return visible(item);
        }
        if (previous.length >= 8) domainReject('agent_proposal_limit');
        const checked = await target(b, run, proposalValue), createdAt = new Date(now()).toISOString();
        const proposal: AgentProposal = { id: randomUUID(), runId, childId: scope.childId, version: 1, status: 'pending',
          createdAt, expiresAt: new Date(now() + 86_400_000).toISOString(), value: proposalValue, targetLabel: checked.label,
          ...(checked.visibility ? { targetVisibility: checked.visibility } : {}), result: null };
        write(b, {
          proposal, callId, authorizationVersion: b.authorizationVersion, sourceBasis: checked.sourceBasis,
          ...(composeReview ? { composeReview } : {}),
        }, true);
        runs.write(b, run); return proposal;
      });
    },
    async decide(userId: string, childId: string, runId: string, id: string, input: AgentDecision) {
      return authority.runTransaction(userId, childId, async b => {
        const prepared = await prepareDecision(b, runId, id, input); prepared.commit(); return prepared.value;
      });
    },
    async pendingProposals(userId: string, childId: string, rawCursor: string | null = null): Promise<AgentPendingPage> {
      let cursor: z.infer<typeof cursorSchema> | null = null;
      if (rawCursor !== null) {
        try {
          if (!/^[A-Za-z0-9_-]{1,1024}$/u.test(rawCursor)) throw Error();
          cursor = cursorSchema.parse(JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8')));
          if (cursor.userId !== userId || cursor.childId !== childId) throw Error();
        } catch { domainReject('invalid_input', 400); }
      }
      return authority.runTransaction(userId, childId, async b => {
        if (cursor && cursor.epoch !== b.scope.storageEpoch) domainReject('storage_epoch_changed');
        let search = query(b).where('status', 'in', ['pending', 'expired']).orderBy('createdAt', 'desc').orderBy('proposalId', 'desc').limit(21);
        if (cursor) search = search.startAfter(cursor.createdAt, cursor.id);
        const rows = await b.transaction.get(search), items = rows.docs.slice(0, 20).map(row => visible(decode(b, row.get('proposalId'), row)));
        const last = items.at(-1);
        return { proposals: items, nextCursor: rows.size > 20 && last ? Buffer.from(JSON.stringify({
          userId, childId, epoch: b.scope.storageEpoch, createdAt: last.createdAt, id: last.id })).toString('base64url') : null };
      });
    },
  };
}
export type FirestoreAgentProposals = ReturnType<typeof createFirestoreAgentProposals>;

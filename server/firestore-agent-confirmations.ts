import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DocumentSnapshot } from '@google-cloud/firestore';
import { requestAgentConfirmationSchema, type AgentConfirmation } from '../src/shared/agent-work.ts';
import type { AgentProposal } from '../src/shared/product-agent.ts';
import { agentSavedProposalSchema } from '../src/shared/product-agent-result.ts';
import { buildAgentConfirmationQuestion, isExplicitAgentConsent } from './agent-work-tool-descriptions.ts';
import type { AgentScope } from './agent-runtime.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import type { FirestoreAgentRuns } from './firestore-agent-runs.ts';
import type { FirestoreAgentProposals } from './firestore-agent-proposals.ts';
import type { FirestoreChatStore } from './firestore-chat.ts';
import { domainParse, domainReject, firestoreDomainHash, FirestoreDomainError } from './firestore-domain-data.ts';

const uuid = z.uuid(), time = z.iso.datetime({ offset: true }), version = z.number().int().positive();
export const firestoreAgentConfirmationSchema = z.object({
  id: uuid, askingRunId: uuid, proposalRunId: uuid, proposalId: uuid, proposalVersion: version,
  authorizationVersion: z.string(), policyVersion: z.number().int().nonnegative(), workId: uuid.nullable(), workVersion: version.nullable(),
  state: z.enum(['waiting', 'asked', 'accepted', 'invalidated']), askMessageId: uuid.nullable(), responseMessageId: uuid.nullable(),
  expiresAt: time, hash: z.string().regex(/^[a-f0-9]{64}$/u), question: z.string().min(1).max(16_000),
  shared: z.boolean(), result: agentSavedProposalSchema.nullable(),
}).strict();
type Saved = z.infer<typeof firestoreAgentConfirmationSchema>;
export const firestoreAgentConfirmationSlotSchema = z.object({ id: uuid }).strict();
export function createFirestoreAgentConfirmations(options: {
  runs: FirestoreAgentRuns; proposals: FirestoreAgentProposals; chat: FirestoreChatStore;
  policyVersion(binding: Binding): Promise<number>; serverClock?: () => number;
}) {
  const { runs, proposals, chat } = options, { data, authority } = runs, now = options.serverClock ?? Date.now;
  const ref = (id: string) => data.ref('agent_confirmations', 'agent-confirmation', id);
  function query(b: Binding) {
    const tags = data.tags(b.scope);
    return data.collection('agent_confirmations').where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag)
      .where('userTag', '==', tags.userTag).where('childTag', '==', tags.childTag);
  }
  function decode(b: Binding, row: DocumentSnapshot) {
    const id = domainParse(uuid, row.get('confirmationId'), 'confirmation_binding', 500);
    if (Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
    const saved = data.open('agent-confirmation', id, b.scope, firestoreAgentConfirmationSchema, row);
    if (saved.id !== id || saved.askingRunId !== row.get('askingRunId') || saved.state !== row.get('state')
      || saved.askMessageId !== row.get('askMessageId') || saved.expiresAt !== row.get('expiresAt'))
      domainReject('confirmation_binding', 500);
    return saved;
  }
  function write(b: Binding, saved: Saved, create = false) {
    const row = { ...data.tags(b.scope), confirmationId: saved.id, askingRunId: saved.askingRunId,
      askMessageId: saved.askMessageId, state: saved.state, expiresAt: saved.expiresAt,
      ...data.seal('agent-confirmation', saved.id, b.scope, firestoreAgentConfirmationSchema, saved) };
    if (create) b.transaction.create(ref(saved.id), row); else b.transaction.set(ref(saved.id), row);
  }
  async function recorded(b: Binding, responseId: string): Promise<AgentProposal | null> {
    const key = JSON.stringify([b.scope.ownerUserId, b.scope.childId, responseId]);
    const row = await b.transaction.get(data.ref('agent_confirmation_responses', 'agent-confirmation-response', key));
    if (!row.exists) return null;
    const pointer = data.open('agent-confirmation-response', key, b.scope, firestoreAgentConfirmationSlotSchema, row);
    const saved = decode(b, await b.transaction.get(ref(pointer.id)));
    const source = await chat.readMessage(b, b.scope.childId, responseId);
    const p = await proposals.read(b, saved.proposalRunId, saved.proposalId);
    if (saved.state !== 'accepted' || saved.responseMessageId !== responseId || !source || source.role !== 'user'
      || saved.authorizationVersion !== b.authorizationVersion || p.authorizationVersion !== b.authorizationVersion
      || !saved.result || saved.result.status !== 'accepted' || saved.result.version !== p.proposal.version
      || saved.result.id !== p.proposal.id || firestoreDomainHash(saved.result) !== firestoreDomainHash(p.proposal))
      domainReject('confirmation_receipt_changed');
    return saved.result;
  }
  const publicValue = (saved: Saved): AgentConfirmation => ({ id: saved.id, proposalRunId: saved.proposalRunId,
    proposalId: saved.proposalId, proposalVersion: saved.proposalVersion, expiresAt: saved.expiresAt, question: saved.question });
  return {
    recorded,
    async recordedConfirmation(userId: string, childId: string, responseMessageId: string) {
      return authority.runTransaction(userId, childId, async b => {
        const saved = await recorded(b, responseMessageId); return saved ? { proposalId: saved.id } : null;
      });
    },
    async requestConfirmation(scope: AgentScope, askingRunId: string, raw: z.infer<typeof requestAgentConfirmationSchema>) {
      const input = domainParse(requestAgentConfirmationSchema, raw);
      return authority.runTransaction(scope.userId, scope.childId, async b => {
        await runs.requireLive(b, scope, askingRunId);
        const target = await proposals.read(b, input.runId, input.proposalId), p = proposals.visible(target), run = await runs.read(b, input.runId);
        if (p.status !== 'pending' || p.version !== input.expectedVersion) domainReject('confirmation_expired');
        if (target.authorizationVersion !== b.authorizationVersion || !runs.matches(b, scope, run, false)) domainReject('confirmation_scope_changed');
        const work = input.workId ? await b.readWork(input.workId) : null;
        if (input.workId && (!work || !['active', 'waiting'].includes(work.status))) domainReject('work_cancelled');
        const checked = await proposals.target(b, run, p.value);
        if (checked.sourceBasis !== target.sourceBasis || checked.visibility !== p.targetVisibility) domainReject('source_changed');
        const child = await b.readChild(scope.childId), policyVersion = await options.policyVersion(b), shared = checked.visibility === 'family';
        const question = buildAgentConfirmationQuestion(p, shared, child?.displayName), hash = firestoreDomainHash(p.value);
        const slotId = JSON.stringify([askingRunId, input.proposalId, input.expectedVersion]);
        const slotRef = data.ref('agent_confirmation_slots', 'agent-confirmation-slot', slotId), slot = await b.transaction.get(slotRef);
        if (slot.exists) {
          const pointer = data.open('agent-confirmation-slot', slotId, b.scope, firestoreAgentConfirmationSlotSchema, slot);
          const previous = decode(b, await b.transaction.get(ref(pointer.id)));
          if (previous.hash !== hash || previous.workId !== input.workId || previous.workVersion !== (work?.version ?? null)
            || previous.policyVersion !== policyVersion || previous.authorizationVersion !== b.authorizationVersion
            || previous.state === 'invalidated' || previous.question !== question) domainReject('confirmation_scope_changed');
          return publicValue(previous);
        }
        const saved: Saved = { id: randomUUID(), askingRunId, proposalRunId: input.runId, proposalId: p.id, proposalVersion: p.version,
          authorizationVersion: b.authorizationVersion, policyVersion, workId: input.workId, workVersion: work?.version ?? null,
          state: 'waiting', askMessageId: null, responseMessageId: null, expiresAt: p.expiresAt, hash, question, shared, result: null };
        const marker = data.seal('agent-confirmation-slot', slotId, b.scope, firestoreAgentConfirmationSlotSchema, { id: saved.id });
        write(b, saved, true); b.transaction.create(slotRef, marker); return publicValue(saved);
      });
    },
    async confirmationQuestions(userId: string, childId: string, runId: string) {
      return authority.runTransaction(userId, childId, async b => {
        const asking = await runs.read(b, runId), current = runs.current(b);
        if (!runs.matches(b, current, asking, false)) return [];
        const rows = await b.transaction.get(query(b).where('askingRunId', '==', runId).limit(9));
        if (rows.size > 8) domainReject('confirmation_limit');
        const policyVersion = await options.policyVersion(b), questions: string[] = [];
        for (const row of rows.docs) {
          const saved = decode(b, row);
          if (!['waiting', 'asked'].includes(saved.state) || Date.parse(saved.expiresAt) <= now()
            || saved.authorizationVersion !== b.authorizationVersion || saved.policyVersion !== policyVersion) continue;
          if (saved.workId) {
            const work = await b.readWork(saved.workId);
            if (!work || work.version !== saved.workVersion || !['active', 'waiting'].includes(work.status)) continue;
          }
          try {
            const target = await proposals.read(b, saved.proposalRunId, saved.proposalId);
            const p = proposals.visible(target), run = await runs.read(b, saved.proposalRunId);
            if (p.status !== 'pending' || p.version !== saved.proposalVersion || firestoreDomainHash(p.value) !== saved.hash
              || target.authorizationVersion !== b.authorizationVersion || !runs.matches(b, current, run, false)) continue;
            // Read-only validation mirrors requestConfirmation; never prepare or execute a decision here.
            const checked = await proposals.target(b, run, p.value);
            if (checked.sourceBasis !== target.sourceBasis || checked.visibility !== p.targetVisibility
              || saved.shared !== (checked.visibility === 'family')) continue;
            questions.push(saved.question);
          } catch (error) {
            if (error instanceof FirestoreDomainError && (error.status === 404 || error.status === 409)) continue;
            throw error;
          }
        }
        return questions;
      });
    },
    async bindConfirmationQuestion(userId: string, childId: string, messageId: string) {
      return authority.runTransaction(userId, childId, async b => {
        const message = await chat.readMessage(b, childId, messageId);
        if (!message || message.role !== 'model' || !message.inReplyTo) return false;
        const run = await runs.originalReplyRun(b, message.inReplyTo); if (!run) return false;
        const rows = await b.transaction.get(query(b).where('askingRunId', '==', run.id).where('state', '==', 'waiting').limit(9));
        if (rows.size > 8) domainReject('confirmation_limit');
        const entries = rows.docs.map(row => decode(b, row));
        for (const saved of entries) write(b, { ...saved, askMessageId: message.id,
          state: Date.parse(saved.expiresAt) > now() && message.text.includes(saved.question) ? 'asked' : 'invalidated' });
        return true;
      });
    },
    async consumeConfirmation(userId: string, childId: string, responseMessageId: string): Promise<AgentProposal | null> {
      return authority.runTransaction(userId, childId, async b => {
        const prior = await recorded(b, responseMessageId); if (prior) return prior;
        const response = await chat.readMessage(b, childId, responseMessageId);
        if (!response || response.role !== 'user' || response.authorUserId !== userId) return null;
        const tags = data.tags(b.scope);
        const latest = await b.transaction.get(data.collection('chat_messages').where('workspaceTag', '==', tags.workspaceTag)
          .where('epochTag', '==', tags.epochTag).where('userTag', '==', tags.userTag).where('childTag', '==', tags.childTag)
          .orderBy('sortKey', 'desc').limit(2));
        if (latest.docs[0]?.get('messageId') !== responseMessageId || latest.size !== 2) return null;
        const previousId = domainParse(uuid, latest.docs[1].get('messageId'), 'chat_binding', 500);
        const previous = await chat.readMessage(b, childId, previousId); if (!previous || previous.role !== 'model') return null;
        const askedRows = await b.transaction.get(query(b).where('askMessageId', '==', previousId).where('state', '==', 'asked').limit(9));
        if (askedRows.size > 8) domainReject('confirmation_limit');
        const asked = askedRows.docs.map(row => decode(b, row));
        const retire = () => { for (const item of asked) write(b, { ...item, state: 'invalidated' }); return null; };
        if (!isExplicitAgentConsent(response.text) || asked.length !== 1) return retire();
        const saved = asked[0], policyVersion = await options.policyVersion(b);
        const pending = await b.transaction.get(proposals.query(b).where('status', '==', 'pending')
          .where('authorizationVersion', '==', b.authorizationVersion).where('expiresAt', '>', new Date(now()).toISOString()).limit(2));
        if (pending.size !== 1 || pending.docs[0].get('proposalId') !== saved.proposalId
          || saved.authorizationVersion !== b.authorizationVersion || policyVersion !== saved.policyVersion || Date.parse(saved.expiresAt) <= now())
          return retire();
        if (saved.workId) {
          const work = await b.readWork(saved.workId);
          if (!work || work.version !== saved.workVersion || !['active', 'waiting'].includes(work.status)) return retire();
        }
        const target = await proposals.read(b, saved.proposalRunId, saved.proposalId);
        if (target.proposal.version !== saved.proposalVersion || firestoreDomainHash(target.proposal.value) !== saved.hash) return retire();
        let prepared: Awaited<ReturnType<FirestoreAgentProposals['prepareDecision']>>;
        try { prepared = await proposals.prepareDecision(b, saved.proposalRunId, saved.proposalId,
          { expectedVersion: saved.proposalVersion, decision: 'accept', confirmShared: saved.shared }); }
        catch (error) {
          if (error instanceof FirestoreDomainError && error.status === 409) return retire();
          throw error;
        }
        const key = JSON.stringify([userId, childId, responseMessageId]);
        const marker = data.seal('agent-confirmation-response', key, b.scope, firestoreAgentConfirmationSlotSchema, { id: saved.id });
        prepared.commit(); write(b, { ...saved, state: 'accepted', responseMessageId, result: prepared.value });
        b.transaction.create(data.ref('agent_confirmation_responses', 'agent-confirmation-response', key), marker);
        return prepared.value;
      });
    },
  };
}

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DocumentSnapshot } from '@google-cloud/firestore';
import type { ChatStore } from './chat.ts';
import type { ChatMessage } from '../src/shared/chat.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { FirestoreOnlineMutation } from './firestore-online.ts';
import { firestoreAgentClaimSchema, firestoreAgentRunSchema } from './firestore-agent-runs.ts';

const uuid = z.uuid(), datetime = z.iso.datetime({ offset: true });
const text = z.string().refine(value => value.trim().length > 0 && value.isWellFormed()
  && !value.includes('\0') && [...value].length <= 10_000);
export const firestoreChatMessageSchema = z.object({
  id: uuid, childId: uuid, authorUserId: z.string().min(1).max(256).nullable(),
  role: z.enum(['user', 'model']), text, inReplyTo: uuid.nullable(), createdAt: datetime,
  agentRunId: uuid.optional(),
}).strict();
const inputSchema = z.object({ text }).strict();
const messagePath = /^\/api\/children\/([0-9a-f-]{36})\/messages$/iu;
const lockScope: WorkRecoveryScope = { ownerUserId: 'system:chat-reply',
  workspaceId: '00000000-0000-0000-0000-000000000000',
  childId: '00000000-0000-0000-0000-000000000000', storageEpoch: '00000000-0000-0000-0000-000000000000' };
const lockSchema = z.object({ leases: z.array(z.object({ messageId: uuid, token: uuid,
  expiresAtMs: z.number().int().nonnegative() }).strict()).max(4) }).strict();

export interface FirestoreChatStore extends ChatStore {
  mutation: FirestoreOnlineMutation;
  readMessage(binding: FirestoreAuthorityTransaction, childId: string, messageId: string): Promise<ChatMessage | null>;
}

/** The original chat contract, with private encrypted rows and caller-wide online receipts. */
export function createFirestoreChatStore(options: FirestoreDomainOptions): FirestoreChatStore {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  const scopeFor = (binding: FirestoreAuthorityTransaction, childId: string) => ({ ...binding.scope, childId });
  const messageRef = (id: string) => data.ref('chat_messages', 'chat-message', id);
  function open(snapshot: DocumentSnapshot, scope: WorkRecoveryScope, id: string): ChatMessage {
    const tags = data.tags(scope), raw = snapshot.data();
    if (Object.entries(tags).some(([key, value]) => raw?.[key] !== value)) domainReject('not_found', 404);
    const message = data.open('chat-message', id, scope, firestoreChatMessageSchema, snapshot);
    if (message.id !== id || message.childId !== scope.childId || snapshot.get('messageId') !== id
      || message.createdAt !== snapshot.get('createdAt') || snapshot.get('recordVersion') !== 1
      || (message.role === 'user' ? message.authorUserId !== scope.ownerUserId || message.inReplyTo !== null
        : message.authorUserId !== null || message.inReplyTo === null)) domainReject('chat_binding', 500);
    return message;
  }
  async function readMessage(binding: FirestoreAuthorityTransaction, childId: string, id: string) {
    domainParse(uuid, id); if (!await binding.readChild(childId)) domainReject('not_found', 404);
    const row = await binding.transaction.get(messageRef(id));
    return row.exists ? open(row, scopeFor(binding, childId), id) : null;
  }
  async function prepare(binding: FirestoreAuthorityTransaction, message: ChatMessage, opId: string) {
    const scope = scopeFor(binding, message.childId);
    if (!await binding.readChild(message.childId)) domainReject('not_found', 404);
    const ref = messageRef(message.id);
    if ((await binding.transaction.get(ref)).exists) domainReject('message_conflict');
    const change = await binding.prepareChange(opId, 'chat', false, message.childId);
    const envelope = { ...data.tags(scope), messageId: message.id, createdAt: message.createdAt, sortKey: data.sortKey(change.changeSeq),
      ...data.seal('chat-message', message.id, scope, firestoreChatMessageSchema, message) };
    return { changeSeq: change.changeSeq, commit() { change.commit(); binding.transaction.create(ref, envelope); } };
  }
  const mutation: FirestoreOnlineMutation = {
    supports: path => messagePath.test(path),
    async prepare(binding, submission) {
      const match = messagePath.exec(submission.path);
      if (!match) domainReject('not_found', 404);
      const childId = domainParse(uuid, match[1].toLowerCase()), input = domainParse(inputSchema, submission.payload);
      const message: ChatMessage = { id: randomUUID(), childId, authorUserId: binding.scope.ownerUserId,
        role: 'user', text: input.text, inReplyTo: null, createdAt: new Date().toISOString() };
      const write = await prepare(binding, message, submission.operation.opId);
      return { ...write, childId, statusCode: 201, result: { message } };
    },
  };
  return {
    mutation, readMessage,
    async listForUser(userId, childId, before = null) {
      if (before !== null) domainParse(uuid, before);
      return authority.runTransaction(userId, childId, async binding => {
        const tags = data.tags(binding.scope);
        let query = data.collection('chat_messages')
          .where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag)
          .where('userTag', '==', tags.userTag).where('childTag', '==', tags.childTag)
          .orderBy('sortKey', 'desc').limit(101);
        if (before) {
          const anchor = await readMessage(binding, childId, before);
          if (!anchor) domainReject('invalid_cursor', 400);
          const anchorRow = await binding.transaction.get(messageRef(anchor.id));
          query = query.startAfter(anchorRow.get('sortKey'));
        }
        const rows = await binding.transaction.get(query);
        const messages = rows.docs.slice(0, 100).map(row => open(row, binding.scope, domainParse(uuid, row.get('messageId'), 'chat_binding', 500)));
        return { messages: [...messages].reverse(), limit: 100, nextCursor: rows.size > 100 ? messages.at(-1)!.id : null };
      });
    },
    async createUserMessageForUser(userId, childId, raw) {
      const message: ChatMessage = { id: randomUUID(), childId, authorUserId: userId, role: 'user',
        text: domainParse(text, raw), inReplyTo: null, createdAt: new Date().toISOString() };
      return authority.runTransaction(userId, childId, async binding => {
        const write = await prepare(binding, message, message.id); write.commit(); return message;
      });
    },
    async createModelMessageForUser(userId, childId, inReplyTo, raw) {
      const message: ChatMessage = { id: randomUUID(), childId, authorUserId: null, role: 'model',
        text: domainParse(text, raw), inReplyTo: domainParse(uuid, inReplyTo), createdAt: new Date().toISOString() };
      return authority.runTransaction(userId, childId, async binding => {
        const original = await readMessage(binding, childId, inReplyTo);
        if (!original || original.role !== 'user') domainReject('not_found', 404);
        // A deterministic marker is the unique reply constraint, including across API replicas.
        const replyId = JSON.stringify([userId, childId, inReplyTo]), replyRef = data.ref('chat_replies', 'chat-reply', replyId);
        if ((await binding.transaction.get(replyRef)).exists) return null;
        const claimKey = JSON.stringify([userId, childId, 'interactive', inReplyTo]);
        const claimRow = await binding.transaction.get(data.ref('agent_claims', 'agent-claim', claimKey));
        let saved = message;
        if (claimRow.exists) {
          const { runId } = data.open('agent-claim', claimKey, binding.scope, firestoreAgentClaimSchema, claimRow);
          const runRow = await binding.transaction.get(data.ref('agent_runs', 'agent-run', runId));
          const run = data.open('agent-run', runId, binding.scope, firestoreAgentRunSchema, runRow);
          if (run.id !== runId || run.sourceMessageId !== inReplyTo || run.childId !== childId
            || run.ownerUserId !== userId || run.authorizationVersion !== binding.authorizationVersion
            || run.storageEpoch !== binding.scope.storageEpoch || run.state === 'running') domainReject('agent_reply_binding');
          saved = { ...message, agentRunId: runId };
        }
        const write = await prepare(binding, saved, saved.id);
        const marker = data.seal('chat-reply', replyId, binding.scope, z.object({ messageId: uuid }).strict(), { messageId: message.id });
        write.commit(); binding.transaction.create(replyRef, { ...data.tags(binding.scope), ...marker }); return saved;
      });
    },
    async acquireReplyLock(messageId) {
      domainParse(uuid, messageId);
      const ref = data.ref('chat_reply_leases', 'chat-reply-leases', 'active'), token = randomUUID();
      const acquired = await options.database.runTransaction(async tx => {
        const snapshot = await tx.get(ref), now = Date.now();
        const state = snapshot.exists ? data.open('chat-reply-leases', 'active', lockScope, lockSchema, snapshot) : { leases: [] };
        const leases = state.leases.filter(lease => lease.expiresAtMs > now);
        if (leases.length >= 4 || leases.some(lease => lease.messageId === messageId)) return false;
        leases.push({ messageId, token, expiresAtMs: now + 120_000 });
        tx.set(ref, data.seal('chat-reply-leases', 'active', lockScope, lockSchema, { leases })); return true;
      });
      if (!acquired) return null;
      let released = false;
      return async () => {
        if (released) return;
        await options.database.runTransaction(async tx => {
          const snapshot = await tx.get(ref); if (!snapshot.exists) return;
          const state = data.open('chat-reply-leases', 'active', lockScope, lockSchema, snapshot);
          const leases = state.leases.filter(lease => lease.token !== token);
          if (leases.length !== state.leases.length) tx.set(ref, data.seal('chat-reply-leases', 'active', lockScope, lockSchema, { leases }));
        });
        released = true;
      };
    },
  };
}

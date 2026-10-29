import { chatFileMessageReferenceSchema, chatFileLinkInputSchema } from '../src/shared/chat-files.ts';
import type { FirestoreChatFilesStore } from './firestore-chat-files.ts';
import { voiceMessageReferenceSchema, voiceLinkInputSchema } from '../src/shared/voice.ts';
import type { FirestoreVoiceStore } from './firestore-voice.ts';
import { photoMessageReferenceSchema, photoLinkInputSchema } from '../src/shared/photos.ts';
import type { FirestorePhotoStore } from './firestore-photos.ts';
import { officialHelpIdSchema, officialHelpFromTools } from '../src/shared/agent-feedback.ts';
import { prepareContextChange } from './firestore-context-basis.ts';
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
import { FieldPath } from '@google-cloud/firestore';
import { chatImportSourceSchema, importedChatMessageSchema, type ImportedChatMessage, type ImportedChatPage, type ImportedChatAttachment } from '../src/shared/chat-imports.ts';
import type { HandoverImportRow } from './handover-import.ts';
import type { HandoverIntegrity } from '../src/shared/handover.ts';
import { makeImportProvenance } from './handover-provenance.ts';

const uuid = z.uuid(), datetime = z.iso.datetime({ offset: true });
const messageText = z.string().refine(value => value.isWellFormed()
  && !value.includes('\0') && [...value].length <= 10_000);
const text = messageText.refine(value => value.trim().length > 0);
export const firestoreChatMessageSchema = z.object({
  id: uuid, childId: uuid, authorUserId: z.string().min(1).max(256).nullable(),
  role: z.enum(['user', 'model']), text: messageText, inReplyTo: uuid.nullable(), createdAt: datetime,
  agentRunId: uuid.optional(), officialHelp: z.array(officialHelpIdSchema).max(2).optional(),
  voice: voiceMessageReferenceSchema.optional(), file: chatFileMessageReferenceSchema.optional(), photo: photoMessageReferenceSchema.optional(),
}).strict().refine(v => (!(v.voice || v.file || v.photo) || v.role === 'user') && [v.voice, v.file, v.photo].filter(Boolean).length <= 1
  && (v.text.trim().length > 0 || v.voice !== undefined || v.file !== undefined || v.photo !== undefined));
const inputSchema = z.object({ text: messageText, voice: voiceLinkInputSchema.optional(), file: chatFileLinkInputSchema.optional(), photo: photoLinkInputSchema.optional() }).strict()
  .refine(v => [v.voice, v.file, v.photo].filter(Boolean).length <= 1 && (v.text.trim().length > 0 || v.voice !== undefined || v.file !== undefined || v.photo !== undefined));
const messagePath = /^\/api\/children\/([0-9a-f-]{36})\/messages$/iu;
const lockScope: WorkRecoveryScope = { ownerUserId: 'system:chat-reply',
  workspaceId: '00000000-0000-0000-0000-000000000000',
  childId: '00000000-0000-0000-0000-000000000000', storageEpoch: '00000000-0000-0000-0000-000000000000' };
const lockSchema = z.object({ leases: z.array(z.object({ messageId: uuid, token: uuid,
  expiresAtMs: z.number().int().nonnegative() }).strict()).max(4) }).strict();

export interface FirestoreChatStore extends ChatStore {
  mutation: FirestoreOnlineMutation;
  readMessage(binding: FirestoreAuthorityTransaction, childId: string, messageId: string): Promise<ChatMessage | null>;
  readImportedMessage(binding: FirestoreAuthorityTransaction, childId: string, id: string): Promise<ImportedChatMessage | null>;
  listImportedForUser(userId: string, childId: string, cursor?: string | null): Promise<ImportedChatPage>;
  getImportedForUser(userId: string, childId: string, id: string): Promise<ImportedChatMessage | null>;
  prepareImported(binding: FirestoreAuthorityTransaction, opId: string, row: HandoverImportRow, integrity: HandoverIntegrity,
    expected?: { id: string; expectedVersion: number }, attachment?: ImportedChatAttachment | null): Promise<{
      value: ImportedChatMessage; changeSeq: string; commit(): void;
    }>;
}

/** The original chat contract, with private encrypted rows and caller-wide online receipts. */
export function createFirestoreChatStore(options: FirestoreDomainOptions & { voice?: Pick<FirestoreVoiceStore, 'prepareLink'>; files?: Pick<FirestoreChatFilesStore, 'prepareLink'>; photos?: Pick<FirestorePhotoStore, 'prepareLink'> }): FirestoreChatStore {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  const scopeFor = (binding: FirestoreAuthorityTransaction, childId: string) => ({ ...binding.scope, childId });
  const messageRef = (id: string) => data.ref('chat_messages', 'chat-message', id);
  const importedRef = (id: string) => data.ref('chat_imported_messages', 'chat-imported-message', id);
  function openImported(row: DocumentSnapshot, scope: WorkRecoveryScope, id: string) {
    if (Object.entries(data.tags(scope)).some(([key, expected]) => row.get(key) !== expected)) domainReject('not_found', 404);
    const value = data.open('chat-imported-message', id, scope, importedChatMessageSchema, row);
    if (value.id !== id || value.childId !== scope.childId || value.version !== row.get('recordVersion')
      || row.get('messageId') !== id || row.get('createdAt') !== value.message.createdAt) domainReject('chat_import_binding', 500);
    return value;
  }
  async function readImportedMessage(binding: FirestoreAuthorityTransaction, childId: string, id: string) {
    domainParse(uuid, id);
    if (binding.sharedAccess) domainReject('private_scope_unavailable', 403);
    if (!await binding.readChild(childId)) domainReject('not_found', 404);
    const row = await binding.transaction.get(importedRef(id));
    return row.exists ? openImported(row, scopeFor(binding, childId), id) : null;
  }
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
    const summaryChange = await prepareContextChange(data, { ...binding, scope }, true);
    const change = await binding.prepareChange(opId, 'chat', false, message.childId);
    const envelope = { ...data.tags(scope), messageId: message.id, createdAt: message.createdAt, sortKey: data.sortKey(change.changeSeq),
      ...data.seal('chat-message', message.id, scope, firestoreChatMessageSchema, message) };
    return { changeSeq: change.changeSeq, commit() { change.commit(); summaryChange(); binding.transaction.create(ref, envelope); } };
  }
  const mutation: FirestoreOnlineMutation = {
    supports: path => messagePath.test(path),
    async prepare(binding, submission) {
      const match = messagePath.exec(submission.path);
      if (!match) domainReject('not_found', 404);
      const childId = domainParse(uuid, match[1].toLowerCase()), input = domainParse(inputSchema, submission.payload);
      const message: ChatMessage = { id: randomUUID(), childId, authorUserId: binding.scope.ownerUserId,
        role: 'user', text: input.text, inReplyTo: null, createdAt: new Date().toISOString() };
      if (input.voice && !options.voice) domainReject('voice_unavailable', 503);
      if (input.file && !options.files) domainReject('chat_file_unavailable', 503);
      if (input.photo && !options.photos) domainReject('photo_unavailable', 503);
      const linked = input.voice ? await options.voice!.prepareLink({ ...binding, scope: scopeFor(binding, childId) }, input.voice.id, input.voice.expectedVersion, message.id) : null;
      if (linked) message.voice = linked.voice;
      const linkedFile = input.file ? await options.files!.prepareLink({ ...binding, scope: scopeFor(binding, childId) }, input.file.id, input.file.expectedVersion, message.id) : null;
      if (linkedFile) message.file = linkedFile.file;
      if (input.photo) message.photo = await options.photos!.prepareLink({ ...binding, scope: scopeFor(binding, childId) }, input.photo.id, input.photo.expectedVersion);
      const write = await prepare(binding, message, submission.operation.opId);
      return { ...write, childId, statusCode: 201, result: { message }, commit() { linked?.commit(); linkedFile?.commit(); write.commit(); } };
    },
  };
  return {
    mutation, readMessage, readImportedMessage,
    getImportedForUser: (userId, childId, id) => authority.runTransaction(userId, childId, b => readImportedMessage(b, childId, id)),
    async listImportedForUser(userId, childId, cursor = null) {
      return authority.runTransaction(userId, childId, async b => {
        let query = data.collection('chat_imported_messages');
        for (const [key, value] of Object.entries(data.tags(b.scope))) query = query.where(key, '==', value) as typeof query;
        let page = query.orderBy(FieldPath.documentId()).limit(21);
        if (cursor) {
          if (!await readImportedMessage(b, childId, cursor)) domainReject('invalid_cursor', 400);
          page = page.startAfter(importedRef(cursor));
        }
        const rows = await b.transaction.get(page);
        const items = rows.docs.slice(0, 20).map(row => openImported(row, b.scope, domainParse(uuid, row.get('messageId'))));
        return { items, nextCursor: rows.size > 20 ? items.at(-1)!.id : null };
      });
    },
    async prepareImported(b, opId, row, integrity, expected, attachment = null) {
      if (b.sharedAccess) domainReject('private_scope_unavailable', 403);
      if (!await b.readChild(b.scope.childId)) domainReject('not_found', 404);
      const previous = expected ? await readImportedMessage(b, b.scope.childId, expected.id) : null;
      if (expected && (!previous || previous.version !== expected.expectedVersion)) domainReject('version_conflict');
      const source = row.section === 'chat' ? domainParse(chatImportSourceSchema, row.value, 'invalid_package_data')
        : row.section === 'chat_imports' ? domainParse(importedChatMessageSchema, row.value, 'invalid_package_data') : null;
      if (!source || source.childId !== row.childId) domainReject('invalid_package_scope', 400);
      const normalized = { ...row, value: { ...row.value, version: source.version } };
      const provenance = makeImportProvenance(normalized, integrity, b.actorUserId, new Date().toISOString());
      const message = 'message' in source ? source.message : source;
      const value = domainParse(importedChatMessageSchema, { id: previous?.id ?? randomUUID(), childId: b.scope.childId,
        version: (previous?.version ?? 0) + 1, message, attachment, importedFrom: provenance });
      const ref = importedRef(value.id);
      const change = await b.prepareChange(opId, 'chat', false, b.scope.childId);
      const envelope = { ...data.tags(b.scope), messageId: value.id, createdAt: value.message.createdAt,
        ...data.seal('chat-imported-message', value.id, b.scope, importedChatMessageSchema, value, value.version) };
      return { value, changeSeq: change.changeSeq, commit() { change.commit(); b.transaction.set(ref, envelope); } };
    },
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
          saved = { ...message, agentRunId: runId, officialHelp: officialHelpFromTools(run.result?.tools ?? []) };
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

/** Persisted schemas reused by isolated recovery; not a second domain model. */
export const firestoreChatRecoverySchemas = { reply: z.object({ messageId: uuid }).strict(), leases: lockSchema };

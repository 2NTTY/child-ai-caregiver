import { chatPageContextSchema } from '../src/shared/chat-page-context.ts';
import { ACCOUNT_DIRECTORY_ANSWER } from '../src/shared/chat-workspace-view.ts';
import { usedAccountDirectory } from './agent-account-directory.ts';
import { messageText, firestoreChatMessageStorageSchema, type StoredChatMessage } from './chat-message-schema.ts';
import type { ChatDeliverySourceVersion } from '../src/shared/chat-delivery-review.ts';
import { chatDeliveryContentHash } from './chat-delivery-review.ts';
import { firestoreFactStorageSchema, validMemoryFactAttribution } from './firestore-memory.ts';
import { factIsApplicable } from './memory-policy.ts';
import { contentVisible } from './firestore-disclosure.ts';
import { createFirestoreMixedChat } from './firestore-mixed-chat.ts';
import { createParentContact, proactiveReceiptSchema } from './proactive-chat.ts';
import type { FirestoreNativePush } from './firestore-native-push.ts';
export { firestoreChatMessageSchema } from './chat-message-schema.ts';
import { chatFileLinkInputSchema } from '../src/shared/chat-files.ts';
import type { FirestoreChatFilesStore } from './firestore-chat-files.ts';
import { voiceLinkInputSchema } from '../src/shared/voice.ts';
import type { FirestoreVoiceStore } from './firestore-voice.ts';
import { photoLinkInputSchema } from '../src/shared/photos.ts';
import type { FirestorePhotoStore } from './firestore-photos.ts';
import { officialHelpFromTools } from '../src/shared/agent-feedback.ts';
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

const uuid = z.uuid();
const text = messageText.refine(value => value.trim().length > 0);
const inputSchema = z.object({ text: messageText, pageContext: chatPageContextSchema.optional(), voice: voiceLinkInputSchema.optional(), file: chatFileLinkInputSchema.optional(), photo: photoLinkInputSchema.optional() }).strict()
  .refine(v => [v.voice, v.file, v.photo].filter(Boolean).length <= 1 && (v.text.trim().length > 0 || v.voice !== undefined || v.file !== undefined || v.photo !== undefined));
const messagePath = /^\/api\/children\/([0-9a-f-]{36})\/messages$/iu;
const lockScope: WorkRecoveryScope = { ownerUserId: 'system:chat-reply',
  workspaceId: '00000000-0000-0000-0000-000000000000',
  childId: '00000000-0000-0000-0000-000000000000', storageEpoch: '00000000-0000-0000-0000-000000000000' };
const lockSchema = z.object({ leases: z.array(z.object({ messageId: uuid, token: uuid,
  expiresAtMs: z.number().int().nonnegative() }).strict()).max(4) }).strict();

export interface FirestoreChatStore extends ChatStore, ReturnType<typeof createParentContact> {
  getOriginalMessageForUser(userId: string, childId: string, messageId: string, purpose?: 'memory'): Promise<ChatMessage|null>;
  markSeenForUser(userId: string, childId: string, messageId: string): Promise<{seen:true}>;
  mixed: ReturnType<typeof createFirestoreMixedChat>;
  mutation: FirestoreOnlineMutation;
  readMessage(binding: FirestoreAuthorityTransaction, childId: string, messageId: string, purpose?: 'memory'): Promise<ChatMessage | null>;
  memoryDeadline(binding: FirestoreAuthorityTransaction, message: StoredChatMessage): Promise<number>;
  reviewedMemoryDeadline(binding: FirestoreAuthorityTransaction, sources: ChatDeliverySourceVersion[]): Promise<number>;
  readImportedMessage(binding: FirestoreAuthorityTransaction, childId: string, id: string): Promise<ImportedChatMessage | null>;
  listImportedForUser(userId: string, childId: string, cursor?: string | null): Promise<ImportedChatPage>;
  getImportedForUser(userId: string, childId: string, id: string): Promise<ImportedChatMessage | null>;
  prepareImported(binding: FirestoreAuthorityTransaction, opId: string, row: HandoverImportRow, integrity: HandoverIntegrity,
    expected?: { id: string; expectedVersion: number }, attachment?: ImportedChatAttachment | null): Promise<{
      value: ImportedChatMessage; changeSeq: string; commit(): void;
    }>;
}

/** The original chat contract, with private encrypted rows and caller-wide online receipts. */
export function createFirestoreChatStore(options: FirestoreDomainOptions & { notifications?: Pick<FirestoreNativePush,'prepareChatDeliveries'>; voice?: Pick<FirestoreVoiceStore, 'prepareLink'>; files?: Pick<FirestoreChatFilesStore, 'prepareLink'>; photos?: Pick<FirestorePhotoStore, 'prepareLink'> }): FirestoreChatStore {
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
  function open(snapshot: DocumentSnapshot, scope: WorkRecoveryScope, id: string) {
    const tags = data.tags(scope), raw = snapshot.data();
    if (Object.entries(tags).some(([key, value]) => raw?.[key] !== value)) domainReject('not_found', 404);
    const message = data.open('chat-message', id, scope, firestoreChatMessageStorageSchema, snapshot);
    if (message.id !== id || message.childId !== scope.childId || snapshot.get('messageId') !== id
      || message.createdAt !== snapshot.get('createdAt') || snapshot.get('recordVersion') !== 1
      || (message.role === 'user' ? message.authorUserId !== scope.ownerUserId || message.inReplyTo !== null
        : message.authorUserId !== null || (message.inReplyTo === null) !== !!message.proactive)) domainReject('chat_binding', 500);
    return message;
  }
  const chatRows = new WeakMap<FirestoreAuthorityTransaction, Map<string, StoredChatMessage | null>>();
  function originals(b: FirestoreAuthorityTransaction) {
    let entries = chatRows.get(b);
    if (!entries) { entries = new Map(); chatRows.set(b, entries); }
    return entries;
  }
  async function original(b: FirestoreAuthorityTransaction, id: string) {
    const entries = originals(b);
    if (!entries.has(id)) {
      const row = await b.transaction.get(messageRef(id));
      entries.set(id, row.exists ? open(row, b.scope, id) : null);
    }
    return entries.get(id) ?? null;
  }
  const recallSources = (sources: ChatDeliverySourceVersion[]) => sources.filter(source =>
    source.citationId.startsWith('memory-fact:') || source.version === '1' && source.citationId.startsWith('chat:'));
  async function reviewedMemoryDeadline(b: FirestoreAuthorityTransaction, sources: ChatDeliverySourceVersion[], visited = new Set<string>()) {
    let until = Infinity;
    for (const source of recallSources(sources)) {
      const [kind, id, offset, length] = source.citationId.split(':');
      if (b.sharedAccess || !uuid.safeParse(id).success) return 0;
      if (kind === 'chat') {
        const parent = await original(b, id);
        if (!parent || !/^\d+$/u.test(offset) || !/^\d+$/u.test(length)) return 0;
        const text = parent.text.slice(Number(offset), Number(offset) + Number(length));
        if (text.length !== Number(length) || chatDeliveryContentHash(JSON.stringify({ role: parent.role, createdAt: parent.createdAt, text })) !== source.contentHash) return 0;
        until = Math.min(until, await memoryDeadline(b, parent, visited));
      } else {
        const row = await b.transaction.get(data.ref('memory_facts', 'memory-fact', id));
        if (!row.exists || row.get('live') !== true || String(row.get('recordVersion')) !== source.version) return 0;
        const fact = data.open('memory-fact', id, b.scope, firestoreFactStorageSchema, row);
        if (fact.id !== id || fact.childId !== b.scope.childId || String(fact.version) !== source.version
          || !validMemoryFactAttribution(fact, b.scope) || !factIsApplicable(fact)
          || chatDeliveryContentHash(fact.content) !== source.contentHash) return 0;
        if (fact.source.kind === 'care_record' && !await contentVisible(data, b, 'care', fact.source.recordId, fact.source.version, true)) return 0;
        if (fact.source.kind === 'private_chat') {
          const parent = fact.source.messageId && await original(b, fact.source.messageId);
          if (!parent || parent.role !== 'user') return 0;
        }
        if (fact.validUntil) until = Math.min(until, Date.parse(fact.validUntil));
      }
      if (until <= Date.now()) break;
    }
    return until;
  }
  async function memoryDeadline(b: FirestoreAuthorityTransaction, value: StoredChatMessage, visited = new Set<string>()): Promise<number> {
    let until = value.memorySummaryUntil ? Date.parse(value.memorySummaryUntil) : Infinity;
    if (value.role === 'user' || until <= Date.now()) return until;
    if (visited.has(value.id) || visited.size >= 4) return 0;
    if (value.inReplyTo) {
      const parent = await original(b, value.inReplyTo);
      if (!parent || parent.role !== 'user') return 0;
      if (parent.memorySummaryUntil) until = Math.min(until, Date.parse(parent.memorySummaryUntil));
    }
    let sources = value.memorySources;
    if (!sources && value.agentRunId) {
      // Older replies keep their source versions in the original reviewed run.
      const row = await b.transaction.get(data.ref('agent_runs', 'agent-run', value.agentRunId));
      if (!row.exists) return 0;
      const run = data.open('agent-run', value.agentRunId, b.scope, firestoreAgentRunSchema, row);
      if (run.id !== value.agentRunId || run.sourceMessageId !== value.inReplyTo || run.childId !== value.childId
        || run.ownerUserId !== b.scope.ownerUserId || run.state !== 'completed' || !run.result?.deliveryReview) return 0;
      sources = run.result.deliveryReview.sourceVersions;
    }
    if (sources?.length) until = Math.min(until, await reviewedMemoryDeadline(b, sources, new Set([...visited, value.id])));
    return until;
  }
  async function readMessage(binding: FirestoreAuthorityTransaction, childId: string, id: string, purpose?: 'memory') {
    domainParse(uuid, id); if (!await binding.readChild(childId)) domainReject('not_found', 404);
    const row = await binding.transaction.get(messageRef(id));
    if (!row.exists) return null;
    const stored = open(row, scopeFor(binding, childId), id);
    if (purpose === 'memory' && Date.now() >= await memoryDeadline(binding, stored)) return null;
    const { memorySummaryUntil, memorySources, ...message } = stored;
    return message;
  }
  async function prepare(binding: FirestoreAuthorityTransaction, message: StoredChatMessage, opId: string) {
    const scope = scopeFor(binding, message.childId);
    if (!await binding.readChild(message.childId)) domainReject('not_found', 404);
    const ref = messageRef(message.id);
    if ((await binding.transaction.get(ref)).exists) domainReject('message_conflict');
    const summaryChange = await prepareContextChange(data, { ...binding, scope },
      { chatOnly: true, userMessageId: message.role === 'user' ? message.id : undefined });
    const change = await binding.prepareChange(opId, 'chat', false, message.childId);
    const envelope = { ...data.tags(scope), messageId: message.id, createdAt: message.createdAt, sortKey: data.sortKey(change.changeSeq),
      ...data.seal('chat-message', message.id, scope, firestoreChatMessageStorageSchema, message) };
    return { changeSeq: change.changeSeq, commit() { change.commit(); summaryChange(); binding.transaction.create(ref, envelope); } };
  }
  const contact = createParentContact(data,readMessage,prepare,options.notifications);
  const mutation: FirestoreOnlineMutation = {
    supports: path => messagePath.test(path),
    async prepare(binding, submission) {
      const match = messagePath.exec(submission.path);
      if (!match) domainReject('not_found', 404);
      const childId = domainParse(uuid, match[1].toLowerCase()), input = domainParse(inputSchema, submission.payload);
      const message: ChatMessage = { id: randomUUID(), childId, authorUserId: binding.scope.ownerUserId,
        role: 'user', text: input.text, inReplyTo: null, createdAt: new Date().toISOString() };
      if (input.pageContext) {
        const scope = scopeFor(binding, childId);
        if (binding.sharedAccess || !await binding.readChild(childId)) domainReject('not_found', 404);
        const item = input.pageContext.item;
        if (item) {
          const targets = { task: ['tasks', 'task'], record: ['care_records', 'care-record'], document: ['documents', 'family-document'] } as const;
          const [collection, kind] = targets[item.kind];
          const row = await binding.transaction.get(data.ref(collection, kind, item.id));
          if (!row.exists || Object.entries(data.tags(scope)).some(([key, tag]) => row.get(key) !== tag)
            || row.get('recordVersion') !== item.version || item.kind === 'record' && row.get('live') !== true)
            domainReject('selected_item_changed', 409);
          if (item.snapshotId) {
            const document = data.open(kind, item.id, scope, z.object({ currentId: uuid.nullable(), historyIds: z.array(uuid) }), row);
            if (document.currentId !== item.snapshotId && !document.historyIds.includes(item.snapshotId)) domainReject('selected_item_changed', 409);
          }
        }
        message.pageContext = input.pageContext;
      }
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
    ...contact,
    getOriginalMessageForUser: (userId,childId,id,purpose) => authority.runTransaction(userId,childId,b => readMessage(b,childId,id,purpose)),
    markSeenForUser: (userId,childId,id) => authority.runTransaction(userId,childId,b => contact.markSeen(b,id)),
    mixed: createFirestoreMixedChat(options), mutation, readMessage, readImportedMessage, memoryDeadline, reviewedMemoryDeadline,
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
    async listForUser(userId, childId, before = null, purpose) {
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
        const sourceDeadlines: Record<string, string> = {};
        const items = rows.docs.slice(0, 100).map(row => open(row, binding.scope, domainParse(uuid, row.get('messageId'), 'chat_binding', 500)));
        if (purpose === 'agent') {
          const entries = originals(binding);
          for (const item of items) entries.set(item.id, item);
          for (const item of items) {
            const until = await memoryDeadline(binding, item);
            if (Number.isFinite(until)) sourceDeadlines[item.id] = new Date(until).toISOString();
          }
        }
        const messages = items.map(({ memorySummaryUntil, memorySources, ...message }) => message);
        const page = { messages: [...messages].reverse(), limit: 100, nextCursor: rows.size > 100 ? messages.at(-1)!.id : null };
        if (purpose !== 'agent') return page;
        return { ...page, dataVersion: binding.scope.storageEpoch + ':' + binding.changeSeq, sourceDeadlines };
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
        let memorySources: ChatDeliverySourceVersion[] | undefined;
        let deliver = false;
        if (claimRow.exists) {
          const { runId } = data.open('agent-claim', claimKey, binding.scope, firestoreAgentClaimSchema, claimRow);
          const runRow = await binding.transaction.get(data.ref('agent_runs', 'agent-run', runId));
          const run = data.open('agent-run', runId, binding.scope, firestoreAgentRunSchema, runRow);
          if (run.id !== runId || run.sourceMessageId !== inReplyTo || run.childId !== childId
            || run.ownerUserId !== userId || run.authorizationVersion !== binding.authorizationVersion
            || run.storageEpoch !== binding.scope.storageEpoch || run.state === 'running') domainReject('agent_reply_binding');
          saved = { ...message, agentRunId: runId, officialHelp: officialHelpFromTools(run.result?.tools ?? []) };
          const result = run.result;
          deliver = run.state === 'completed' && result?.status === 'completed' && result.outcome !== 'no_action'
            && !!result.text.trim() && (saved.text === result.text || saved.text.startsWith(result.text + '\n\n')
              || saved.text === ACCOUNT_DIRECTORY_ANSWER && usedAccountDirectory(result));
          memorySources = recallSources(result?.deliveryReview?.sourceVersions ?? []);
          if (deliver || memorySources.length) {
            if (Date.now() >= await memoryDeadline(binding, { ...saved, memorySources })) domainReject('source_changed');
          }
        }
        const write = await prepare(binding, { ...saved, ...(memorySources && { memorySources }) }, saved.id);
        const marker = data.seal('chat-reply', replyId, binding.scope, z.object({ messageId: uuid }).strict(), { messageId: message.id });
        const dispatch = deliver ? await options.notifications?.prepareChatDeliveries(binding,saved.id) : null;
        write.commit(); dispatch?.commit(); binding.transaction.create(replyRef, { ...data.tags(binding.scope), ...marker }); return saved;
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
export const firestoreChatRecoverySchemas = { reply: z.union([z.object({ messageId: uuid }).strict(), proactiveReceiptSchema]), leases: lockSchema };

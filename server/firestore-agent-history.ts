import { z } from 'zod';
import { historySearchSchema, historyReadSchema, type AgentHistoryPage, type AgentHistoryMessage } from '../src/shared/agent-work.ts';
import type { FirestoreAgentRuns } from './firestore-agent-runs.ts';
import type { FirestoreAgentActions } from './firestore-agent-actions.ts';
import type { FirestoreChatStore } from './firestore-chat.ts';
import type { FirestoreMemoryStore } from './firestore-memory.ts';
import { domainParse, domainReject } from './firestore-domain-data.ts';

const cursorSchema = z.object({ userId: z.string(), childId: z.uuid(), epoch: z.uuid(), changeSeq: z.string(),
  kind: historySearchSchema.shape.kind, query: z.string(), createdAt: z.iso.datetime({ offset: true }), id: z.uuid() }).strict();

/** Bounded private search; never indexes decrypted family content in the public corpus. */
export function createFirestoreAgentHistory(options: {
  runs: FirestoreAgentRuns; chat: FirestoreChatStore; memory: FirestoreMemoryStore; actions: FirestoreAgentActions;
}) {
  const { authority, data } = options.runs;
  return {
    async searchHistory(userId: string, childId: string, raw: z.infer<typeof historySearchSchema>): Promise<AgentHistoryPage> {
      const input = domainParse(historySearchSchema, raw);
      let cursor: z.infer<typeof cursorSchema> | null = null;
      if (input.cursor !== null) {
        try {
          if (!/^[A-Za-z0-9_-]{1,2048}$/u.test(input.cursor)) throw Error();
          cursor = cursorSchema.parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')));
          if (cursor.userId !== userId || cursor.childId !== childId || cursor.kind !== input.kind || cursor.query !== input.query) throw Error();
        } catch { domainReject('invalid_cursor', 400); }
      }
      return authority.runTransaction(userId, childId, async b => {
        if (cursor && (cursor.epoch !== b.scope.storageEpoch || cursor.changeSeq !== b.changeSeq)) domainReject('version_conflict');
        const tags = data.tags(b.scope), collection = { message: 'chat_messages', private_instruction: 'private_instructions', memory_fact: 'memory_facts' }[input.kind];
        const idField = { message: 'messageId', private_instruction: 'noteId', memory_fact: 'entityId' }[input.kind];
        let query = data.collection(collection).where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag)
          .where('userTag', '==', tags.userTag).where('childTag', '==', tags.childTag);
        if (input.kind === 'memory_fact') query = query.where('live', '==', true);
        query = query.orderBy('createdAt', 'desc').orderBy(idField, 'desc').limit(101);
        if (cursor) query = query.startAfter(cursor.createdAt, cursor.id);
        const rows = await b.transaction.get(query), matches: AgentHistoryPage['matches'] = [];
        let scanned = 0, last: { createdAt: string; id: string } | null = null;
        for (const row of rows.docs.slice(0, 100)) {
          const id = domainParse(z.uuid(), row.get(idField), 'history_binding', 500);
          const createdAt = domainParse(z.iso.datetime({ offset: true }), row.get('createdAt'), 'history_binding', 500);
          let text: string, version: number, role: 'user' | 'model' | null = null;
          if (input.kind === 'message') {
            const value = await options.chat.readMessage(b, childId, id);
            if (!value || value.createdAt !== createdAt) domainReject('history_binding', 500);
            text = value.text; version = 1; role = value.role;
          } else if (input.kind === 'private_instruction') {
            const value = await options.actions.readNote(b, id);
            if (!value || value.createdAt !== createdAt) domainReject('history_binding', 500);
            text = value.title + '\n' + value.text; version = value.version;
          } else {
            const value = await options.memory.readFact(b, id);
            if (!value || (value as typeof value & { createdAt: string }).createdAt !== createdAt) domainReject('history_binding', 500);
            // History retains inactive facts explicitly; it does not promote them into current knowledge.
            text = '[' + value.status + '; ' + value.sourceState + '] ' + value.key + ': ' + value.content;
            version = value.version;
          }
          scanned++; last = { id, createdAt };
          const index = text.toLocaleLowerCase('zh-HK').indexOf(input.query.toLocaleLowerCase('zh-HK'));
          if (index >= 0) matches.push({ id, kind: input.kind, version, createdAt, role, excerpt: text.slice(Math.max(0, index - 80), Math.max(0, index - 80) + 400) });
          if (matches.length === 10) break;
        }
        const complete = rows.size === scanned;
        return { matches, scanned, scanLimit: 100, complete, nextCursor: !complete && last ? Buffer.from(JSON.stringify({
          userId, childId, epoch: b.scope.storageEpoch, changeSeq: b.changeSeq, kind: input.kind, query: input.query, ...last })).toString('base64url') : null };
      });
    },
    async readHistory(userId: string, childId: string, raw: z.infer<typeof historyReadSchema>): Promise<AgentHistoryMessage | null> {
      const input = domainParse(historyReadSchema, raw);
      return authority.runTransaction(userId, childId, async b => {
        const message = await options.chat.readMessage(b, childId, input.messageId);
        if (!message) return null;
        const end = Math.min(message.text.length, input.offset + input.limit);
        return { id: message.id, childId, role: message.role, version: 1, createdAt: message.createdAt,
          text: message.text.slice(input.offset, end), offset: input.offset,
          nextOffset: end < message.text.length ? end : null, totalCharacters: message.text.length };
      });
    },
  };
}

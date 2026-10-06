import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { StorageCipher } from "./storage-crypto.ts";
import type { ChatMessage, ChatPage } from "../src/shared/chat.ts";
import { READ_ROLES, withChildAccess } from "./family-access.ts";
import { appendOnlineChange } from "./online-change.ts";

export interface ChatStore {
  acquireReplyLock(messageId: string): Promise<(() => Promise<void>) | null>;
  listForUser(userId: string, childId: string, before?: string | null): Promise<ChatPage | null>;
  createUserMessageForUser(userId: string, childId: string, text: string): Promise<ChatMessage | null>;
  createModelMessageForUser(userId: string, childId: string, inReplyTo: string, text: string): Promise<ChatMessage | null>;
}
interface MessageRow {
  id: string; child_id: string; author_user_id: string | null;
  role: "user" | "model"; text: string; in_reply_to: string | null; created_at: Date; agent_run_id?: string | null;
}
function toMessage(row: MessageRow, userId: string, cipher: StorageCipher): ChatMessage {
  return { id: row.id, childId: row.child_id, authorUserId: row.author_user_id, role: row.role,
    text: cipher.decrypt(row.text, `chat_messages:${row.id}:${row.child_id}:${userId}:${row.role}:${row.in_reply_to ?? ""}:text`), inReplyTo: row.in_reply_to, createdAt: row.created_at.toISOString(), ...(row.agent_run_id ? { agentRunId: row.agent_run_id } : {}) };
}
export function createChatStore(pool: Pool, cipher: StorageCipher, trackChanges = false, agentRuns = false): ChatStore {
  // Leave pool capacity for session, quota and message queries while locks are held.
  let activeLocks = 0;
  return {
    async acquireReplyLock(messageId) {
      if (activeLocks >= 4) return null;
      activeLocks++;
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        const result = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [messageId]);
        if (!result.rows[0]?.locked) { client.release(); activeLocks--; return null; }
        const lockedClient = client;
        let released = false;
        return async () => {
          if (released) return;
          released = true;
          let failed = false;
          try { await lockedClient.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [messageId]); }
          catch { failed = true; }
          finally { lockedClient.release(failed); activeLocks--; }
        };
      } catch { client?.release(true); activeLocks--; throw new Error("Chat lock unavailable"); }
    },
    async listForUser(userId, childId, before) {
      return withChildAccess(pool, userId, childId, READ_ROLES, async client => {
      const result = await client.query<MessageRow>(
        `SELECT m.id,m.child_id,m.author_user_id,m.role,m.text_encrypted AS text,m.in_reply_to,m.created_at
         ${agentRuns ? ",(SELECT r.id FROM agent_runs r WHERE r.owner_user_id=m.owner_user_id AND r.child_id=m.child_id AND r.trigger_kind='interactive' AND r.trigger_reference=m.in_reply_to) AS agent_run_id" : ""}
         FROM chat_messages m WHERE m.owner_user_id=$1 AND m.child_id=$2
         AND ($3::uuid IS NULL OR (m.created_at,m.id) < (SELECT anchor.created_at,anchor.id FROM chat_messages anchor
           WHERE anchor.id=$3 AND anchor.owner_user_id=$1 AND anchor.child_id=$2))
         ORDER BY m.created_at DESC,m.id DESC LIMIT 101`, [userId, childId, before ?? null],
      );
      const rows = result.rows.slice(0, 100);
      return { messages: rows.map(row => toMessage(row, userId, cipher)).reverse(), limit: 100,
        nextCursor: result.rows.length > 100 ? rows.at(-1)!.id : null };
      });
    },
    async createUserMessageForUser(userId, childId, text) {
      return withChildAccess(pool, userId, childId, READ_ROLES, async (client, _role, workspaceId) => {
      const messageId = randomUUID();
      const result = await client.query<MessageRow>(
        `INSERT INTO chat_messages (id, child_id, owner_user_id, author_user_id, role, text_encrypted)
         VALUES($1,$3,$2,$2,'user',$4)
         RETURNING id, child_id, author_user_id, role, text_encrypted AS text, in_reply_to, created_at`,
        [messageId, userId, childId, cipher.encrypt(text, `chat_messages:${messageId}:${childId}:${userId}:user::text`)],
      );
      if (trackChanges && result.rows[0]) await appendOnlineChange(client, workspaceId, "chat", childId, false, userId);
      return result.rows[0] ? toMessage(result.rows[0], userId, cipher) : null;
      }, trackChanges);
    },
    async createModelMessageForUser(userId, childId, inReplyTo, text) {
      return withChildAccess(pool, userId, childId, READ_ROLES, async (client, _role, workspaceId) => {
      const messageId = randomUUID();
      const result = await client.query<MessageRow>(
        `INSERT INTO chat_messages (id, child_id, owner_user_id, author_user_id, role, text_encrypted, in_reply_to)
         SELECT $1, original.child_id, $2, NULL, 'model', $5, original.id
         FROM chat_messages AS original
         WHERE original.child_id = $3
           AND original.id = $4 AND original.owner_user_id = $2 AND original.role = 'user'
         ON CONFLICT (in_reply_to) DO NOTHING
         RETURNING id, child_id, author_user_id, role, text_encrypted AS text, in_reply_to, created_at`,
        [messageId, userId, childId, inReplyTo, cipher.encrypt(text, `chat_messages:${messageId}:${childId}:${userId}:model:${inReplyTo}:text`)],
      );
      if (trackChanges && result.rows[0]) await appendOnlineChange(client, workspaceId, "chat", childId, false, userId);
      return result.rows[0] ? toMessage(result.rows[0], userId, cipher) : null;
      }, trackChanges);
    },
  };
}

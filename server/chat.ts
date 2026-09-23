import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ChatMessage, ChatPage } from "../src/shared/chat.ts";

export interface ChatStore {
  acquireReplyLock(messageId: string): Promise<(() => Promise<void>) | null>;
  listForUser(userId: string, childId: string): Promise<ChatPage | null>;
  createUserMessageForUser(userId: string, childId: string, text: string): Promise<ChatMessage | null>;
  createModelMessageForUser(userId: string, childId: string, inReplyTo: string, text: string): Promise<ChatMessage | null>;
}
interface MessageRow {
  id: string; child_id: string; author_user_id: string | null;
  role: "user" | "model"; text: string; in_reply_to: string | null; created_at: Date;
}
function toMessage(row: MessageRow): ChatMessage {
  return { id: row.id, childId: row.child_id, authorUserId: row.author_user_id, role: row.role,
    text: row.text, inReplyTo: row.in_reply_to, createdAt: row.created_at.toISOString() };
}
export function createChatStore(pool: Pool): ChatStore {
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
    async listForUser(userId, childId) {
      const result = await pool.query<MessageRow | { id: null }>(
        `SELECT message.id, message.child_id, message.author_user_id, message.role,
                message.text, message.in_reply_to, message.created_at
         FROM children AS child
         JOIN workspaces AS workspace ON workspace.id = child.workspace_id
         LEFT JOIN LATERAL (
           SELECT id, child_id, author_user_id, role, text, in_reply_to, created_at
           FROM chat_messages
           WHERE child_id = child.id AND owner_user_id = $1
           ORDER BY created_at DESC, id DESC LIMIT 100
         ) AS message ON true
         WHERE workspace.owner_user_id = $1 AND child.id = $2
         ORDER BY message.created_at DESC, message.id DESC`, [userId, childId],
      );
      if (!result.rows.length) return null;
      return { messages: result.rows.filter((row): row is MessageRow => row.id !== null).map(toMessage).reverse(), limit: 100 };
    },
    async createUserMessageForUser(userId, childId, text) {
      const result = await pool.query<MessageRow>(
        `INSERT INTO chat_messages (id, child_id, owner_user_id, author_user_id, role, text)
         SELECT $1, child.id, $2, $2, 'user', $4
         FROM children AS child JOIN workspaces AS workspace ON workspace.id = child.workspace_id
         WHERE workspace.owner_user_id = $2 AND child.id = $3
         RETURNING id, child_id, author_user_id, role, text, in_reply_to, created_at`,
        [randomUUID(), userId, childId, text],
      );
      return result.rows[0] ? toMessage(result.rows[0]) : null;
    },
    async createModelMessageForUser(userId, childId, inReplyTo, text) {
      const result = await pool.query<MessageRow>(
        `INSERT INTO chat_messages (id, child_id, owner_user_id, author_user_id, role, text, in_reply_to)
         SELECT $1, child.id, $2, NULL, 'model', $5, original.id
         FROM children AS child JOIN workspaces AS workspace ON workspace.id = child.workspace_id
         JOIN chat_messages AS original ON original.child_id = child.id
         WHERE workspace.owner_user_id = $2 AND child.id = $3
           AND original.id = $4 AND original.owner_user_id = $2 AND original.role = 'user'
         ON CONFLICT (in_reply_to) DO NOTHING
         RETURNING id, child_id, author_user_id, role, text, in_reply_to, created_at`,
        [randomUUID(), userId, childId, inReplyTo, text],
      );
      return result.rows[0] ? toMessage(result.rows[0]) : null;
    },
  };
}
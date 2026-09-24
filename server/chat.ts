import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { StorageCipher } from "./storage-crypto.ts";
import type { ChatMessage, ChatPage } from "../src/shared/chat.ts";
import { READ_ROLES, withChildAccess } from "./family-access.ts";

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
function toMessage(row: MessageRow, userId: string, cipher: StorageCipher): ChatMessage {
  return { id: row.id, childId: row.child_id, authorUserId: row.author_user_id, role: row.role,
    text: cipher.decrypt(row.text, `chat_messages:${row.id}:${row.child_id}:${userId}:${row.role}:${row.in_reply_to ?? ""}:text`), inReplyTo: row.in_reply_to, createdAt: row.created_at.toISOString() };
}
export function createChatStore(pool: Pool, cipher: StorageCipher): ChatStore {
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
      return withChildAccess(pool, userId, childId, READ_ROLES, async client => {
      const result = await client.query<MessageRow>(
        `SELECT id,child_id,author_user_id,role,text_encrypted AS text,in_reply_to,created_at FROM chat_messages
         WHERE owner_user_id=$1 AND child_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100`, [userId, childId],
      );
      return { messages: result.rows.map(row => toMessage(row, userId, cipher)).reverse(), limit: 100 };
      });
    },
    async createUserMessageForUser(userId, childId, text) {
      return withChildAccess(pool, userId, childId, READ_ROLES, async client => {
      const messageId = randomUUID();
      const result = await client.query<MessageRow>(
        `INSERT INTO chat_messages (id, child_id, owner_user_id, author_user_id, role, text_encrypted)
         VALUES($1,$3,$2,$2,'user',$4)
         RETURNING id, child_id, author_user_id, role, text_encrypted AS text, in_reply_to, created_at`,
        [messageId, userId, childId, cipher.encrypt(text, `chat_messages:${messageId}:${childId}:${userId}:user::text`)],
      );
      return result.rows[0] ? toMessage(result.rows[0], userId, cipher) : null;
      });
    },
    async createModelMessageForUser(userId, childId, inReplyTo, text) {
      return withChildAccess(pool, userId, childId, READ_ROLES, async client => {
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
      return result.rows[0] ? toMessage(result.rows[0], userId, cipher) : null;
      });
    },
  };
}

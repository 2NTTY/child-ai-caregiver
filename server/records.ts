import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { StorageCipher } from "./storage-crypto.ts";
import type { CreateChildInput, CreateTextRecordInput } from "../src/shared/inputs.ts";
import type { Child, RecordList, TextRecord } from "../src/shared/records.ts";

const RECORD_LIST_LIMIT = 100;

export interface RecordStore {
  deleteChildForUser(userId: string, childId: string): Promise<boolean>;
  listChildrenForUser(userId: string): Promise<Child[]>;
  getChildForUser(userId: string, childId: string): Promise<Child | null>;
  createChildForUser(userId: string, input: CreateChildInput): Promise<Child>;
  listRecordsForUser(userId: string, childId: string): Promise<RecordList | null>;
  createRecordForUser(userId: string, input: CreateTextRecordInput): Promise<TextRecord | null>;
}

interface ChildRow {
  id: string;
  workspace_id: string;
  display_name: string;
  created_at: Date;
}

interface RecordRow {
  id: string;
  child_id: string;
  author_user_id: string;
  text: string;
  created_at: Date;
}

type RecordPageRow = RecordRow | { [Key in keyof RecordRow]: null };

export function createRecordStore(pool: Pool, cipher: StorageCipher): RecordStore {
  function toChild(row: ChildRow, userId: string): Child {
    return { id: row.id, workspaceId: row.workspace_id,
      displayName: cipher.decrypt(row.display_name, `children:${row.id}:${userId}:display_name`),
      createdAt: row.created_at.toISOString() };
  }
  function toRecord(row: RecordRow): TextRecord {
    return { id: row.id, childId: row.child_id, authorUserId: row.author_user_id,
      text: cipher.decrypt(row.text, `text_records:${row.id}:${row.child_id}:${row.author_user_id}:text`),
      createdAt: row.created_at.toISOString() };
  }
  return {
    async deleteChildForUser(userId, childId) {
      const result = await pool.query(
        `WITH removed AS (
           DELETE FROM children child USING workspaces workspace
           WHERE child.workspace_id = workspace.id AND workspace.owner_user_id = $1 AND child.id = $2
           RETURNING child.id, child.workspace_id
         ) INSERT INTO deleted_children (id, workspace_id)
           SELECT id, workspace_id FROM removed RETURNING id`, [userId, childId]);
      return result.rowCount === 1;
    },
    async listChildrenForUser(userId) {
      const result = await pool.query<ChildRow>(
        `SELECT child.id, child.workspace_id, child.display_name_encrypted AS display_name, child.created_at
         FROM children AS child
         JOIN workspaces AS workspace ON workspace.id = child.workspace_id
         WHERE workspace.owner_user_id = $1
         ORDER BY child.created_at, child.id`,
        [userId],
      );
      return result.rows.map(row => toChild(row, userId));
    },
    async getChildForUser(userId, childId) {
      const result = await pool.query<ChildRow>(
        `SELECT child.id, child.workspace_id, child.display_name_encrypted AS display_name, child.created_at
         FROM children AS child
         JOIN workspaces AS workspace ON workspace.id = child.workspace_id
         WHERE workspace.owner_user_id = $1 AND child.id = $2`,
        [userId, childId],
      );
      return result.rows[0] ? toChild(result.rows[0], userId) : null;
    },
    async createChildForUser(userId, input) {
      const childId = randomUUID();
      const result = await pool.query<ChildRow>(
        `WITH owned_workspace AS (
           INSERT INTO workspaces (id, owner_user_id, storage_epoch)
           VALUES ($1, $2, $3)
           ON CONFLICT (owner_user_id) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id
           RETURNING id, owner_user_id
         )
         INSERT INTO children (id, workspace_id, display_name_encrypted)
         SELECT $4, id, $5 FROM owned_workspace WHERE owner_user_id = $2
         RETURNING id, workspace_id, display_name_encrypted AS display_name, created_at`,
        [randomUUID(), userId, randomUUID(), childId, cipher.encrypt(input.displayName, `children:${childId}:${userId}:display_name`)],
      );
      return toChild(result.rows[0]!, userId);
    },
    async listRecordsForUser(userId, childId) {
      const result = await pool.query<RecordPageRow>(
        `SELECT record.id, record.child_id, record.author_user_id, record.text, record.created_at
         FROM children AS child
         JOIN workspaces AS workspace ON workspace.id = child.workspace_id
         LEFT JOIN LATERAL (
           SELECT id, child_id, author_user_id, text_encrypted AS text, created_at
           FROM text_records
           WHERE child_id = child.id
           ORDER BY created_at DESC, id DESC
           LIMIT $3
         ) AS record ON true
         WHERE workspace.owner_user_id = $1 AND child.id = $2
         ORDER BY record.created_at DESC, record.id DESC`,
        [userId, childId, RECORD_LIST_LIMIT],
      );
      if (result.rows.length === 0) return null;
      // The lateral join returns one null row for an owned child without records.
      const records = result.rows.filter((row): row is RecordRow => row.id !== null).map(toRecord);
      return { records, limit: RECORD_LIST_LIMIT };
    },
    async createRecordForUser(userId, input) {
      const recordId = randomUUID();
      const result = await pool.query<RecordRow>(
        `INSERT INTO text_records (id, child_id, author_user_id, text_encrypted)
         SELECT $1, child.id, $2, $4
         FROM children AS child
         JOIN workspaces AS workspace ON workspace.id = child.workspace_id
         WHERE workspace.owner_user_id = $2 AND child.id = $3
         RETURNING id, child_id, author_user_id, text_encrypted AS text, created_at`,
        [recordId, userId, input.childId, cipher.encrypt(input.text, `text_records:${recordId}:${input.childId}:${userId}:text`)],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },
  };
}

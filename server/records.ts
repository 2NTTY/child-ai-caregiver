import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { StorageCipher } from "./storage-crypto.ts";
import type { CreateChildInput, CreateTextRecordInput } from "../src/shared/inputs.ts";
import type { Child, RecordList, TextRecord } from "../src/shared/records.ts";
import { READ_ROLES, WRITE_ROLES, withChildAccess, withWorkspaceAccess } from "./family-access.ts";
import { createWorkspaceStore } from "./workspaces.ts";
import { appendOnlineChange } from "./online-change.ts";

const RECORD_LIST_LIMIT = 100;

export interface RecordStore {
  deleteChildForUser(userId: string, childId: string): Promise<boolean>;
  listChildrenForUser(userId: string): Promise<Child[]>;
  getChildForUser(userId: string, childId: string): Promise<Child | null>;
  createChildForUser(userId: string, input: CreateChildInput, workspaceId?: string): Promise<Child>;
  listRecordsForUser(userId: string, childId: string): Promise<RecordList | null>;
  createRecordForUser(userId: string, input: CreateTextRecordInput): Promise<TextRecord | null>;
}

interface ChildRow {
  id: string;
  workspace_id: string;
  display_name: string;
  created_at: Date;
  owner_user_id: string;
  access_role: "owner" | "caregiver" | "viewer";
}

interface RecordRow {
  id: string;
  child_id: string;
  author_user_id: string;
  text: string;
  created_at: Date;
}

export function createRecordStore(pool: Pool, cipher: StorageCipher, trackChanges = false): RecordStore {
  function toChild(row: ChildRow): Child {
    return { id: row.id, workspaceId: row.workspace_id,
      displayName: cipher.decrypt(row.display_name, `children:${row.id}:${row.owner_user_id}:display_name`), accessRole: row.access_role,
      createdAt: row.created_at.toISOString() };
  }
  function toRecord(row: RecordRow): TextRecord {
    return { id: row.id, childId: row.child_id, authorUserId: row.author_user_id,
      text: cipher.decrypt(row.text, `text_records:${row.id}:${row.child_id}:${row.author_user_id}:text`),
      createdAt: row.created_at.toISOString() };
  }
  return {
    async deleteChildForUser(userId, childId) {
      return (await withChildAccess(pool, userId, childId, ["owner"], async (client, _role, workspaceId) => {
      const result = await client.query(
        `WITH removed AS (
           DELETE FROM children child USING workspaces workspace
           WHERE child.workspace_id = workspace.id AND workspace.owner_user_id = $1 AND child.id = $2
           RETURNING child.id, child.workspace_id
         ) INSERT INTO deleted_children (id, workspace_id)
           SELECT id, workspace_id FROM removed RETURNING id`, [userId, childId]);
      if (trackChanges && result.rowCount === 1) await appendOnlineChange(client, workspaceId, "children", childId, true);
      return result.rowCount === 1;
      }, trackChanges)) ?? false;
    },
    async listChildrenForUser(userId) {
      const result = await pool.query<ChildRow>(
        `SELECT child.id, child.workspace_id, child.display_name_encrypted AS display_name, child.created_at, workspace.owner_user_id,
          CASE WHEN workspace.owner_user_id=$1 THEN 'owner' ELSE member.role END AS access_role
         FROM children AS child
         JOIN workspaces AS workspace ON workspace.id = child.workspace_id
         LEFT JOIN family_members member ON member.workspace_id=workspace.id AND member.user_id=$1
         WHERE workspace.owner_user_id = $1 OR member.user_id IS NOT NULL
         ORDER BY child.created_at, child.id`,
        [userId],
      );
      return result.rows.map(toChild);
    },
    async getChildForUser(userId, childId) {
      return withChildAccess(pool, userId, childId, READ_ROLES, async (client, role) => {
      const result = await client.query<ChildRow>(
        `SELECT child.id, child.workspace_id, child.display_name_encrypted AS display_name, child.created_at
         FROM children AS child
         JOIN workspaces AS workspace ON workspace.id = child.workspace_id
         WHERE child.id = $1`,
        [childId],
      );
      if (!result.rows[0]) return null;
      const owner = (await client.query<{ owner_user_id: string }>("SELECT owner_user_id FROM workspaces WHERE id=$1", [result.rows[0].workspace_id])).rows[0];
      return toChild({ ...result.rows[0], owner_user_id: owner.owner_user_id, access_role: role });
      });
    },
    async createChildForUser(userId, input, workspaceId) {
      const target = workspaceId ?? (await createWorkspaceStore(pool).ensureForUser(userId)).id;
      return withWorkspaceAccess(pool, userId, target, WRITE_ROLES, async (client, role) => {
      const childId = randomUUID();
      const owner = (await client.query<{ owner_user_id: string }>("SELECT owner_user_id FROM workspaces WHERE id=$1", [target])).rows[0].owner_user_id;
      const result = await client.query<ChildRow>(
        `INSERT INTO children(id,workspace_id,display_name_encrypted) VALUES($1,$2,$3)
         RETURNING id,workspace_id,display_name_encrypted AS display_name,created_at`,
        [childId, target, cipher.encrypt(input.displayName, `children:${childId}:${owner}:display_name`)],
      );
      if (trackChanges) await appendOnlineChange(client, target, "children", childId);
      return toChild({ ...result.rows[0], owner_user_id: owner, access_role: role });
      }, trackChanges);
    },
    async listRecordsForUser(userId, childId) {
      return withChildAccess(pool, userId, childId, READ_ROLES, async client => {
      const result = await client.query<RecordRow>(
        `SELECT id,child_id,author_user_id,text_encrypted AS text,created_at FROM text_records
         WHERE child_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2`,
        [childId, RECORD_LIST_LIMIT],
      );
      return { records: result.rows.map(toRecord), limit: RECORD_LIST_LIMIT };
      });
    },
    async createRecordForUser(userId, input) {
      return withChildAccess(pool, userId, input.childId, WRITE_ROLES, async (client, _role, workspaceId) => {
      const recordId = randomUUID();
      const result = await client.query<RecordRow>(
        `INSERT INTO text_records (id, child_id, author_user_id, text_encrypted)
         VALUES($1,$3,$2,$4)
         RETURNING id, child_id, author_user_id, text_encrypted AS text, created_at`,
        [recordId, userId, input.childId, cipher.encrypt(input.text, `text_records:${recordId}:${input.childId}:${userId}:text`)],
      );
      if (trackChanges && result.rows[0]) await appendOnlineChange(client, workspaceId, "care", input.childId);
      return result.rows[0] ? toRecord(result.rows[0]) : null;
      }, trackChanges);
    },
  };
}

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { CarePage, CareRecord, CareRevision, CareSearch, CareValues, ChildProfile, ChildProfileData, HistoryPage } from "../src/shared/care.ts";
import { emptyCareDetails } from "../src/shared/care.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { FamilyError, READ_ROLES, WRITE_ROLES, requireFamilyVersion, withChildAccess } from "./family-access.ts";
import { appendOnlineChange } from "./online-change.ts";

interface Row { id: string; child_id: string; author_user_id: string; text_encrypted: string; created_at: Date; cursor_created_at?: string;
  version: number; details_encrypted: string | null; confirmed_by: string | null; confirmed_at: Date | null }
const textContext = (row: Pick<Row, "id" | "child_id" | "author_user_id">) => `text_records:${row.id}:${row.child_id}:${row.author_user_id}:text`;
const detailsContext = (row: Pick<Row, "id" | "child_id" | "version">) => `care-details:${row.child_id}:${row.id}:${row.version}`;
const revisionContext = (childId: string, recordId: string, version: number) => `care-history:${childId}:${recordId}:${version}`;
const profileContext = (childId: string, version: number) => `child-profile:${childId}:${version}`;

export function createCareStore(pool: Pool, cipher: StorageCipher, trackChanges = false) {
  function record(row: Row): CareRecord {
    const metadata = row.details_encrypted ? JSON.parse(cipher.decrypt(row.details_encrypted, detailsContext(row)))
      : { details: emptyCareDetails(), source: "使用者直接提交的文字原文", reason: "首次確認" };
    return { id: row.id, childId: row.child_id, authorUserId: row.author_user_id, createdAt: row.created_at.toISOString(),
      text: cipher.decrypt(row.text_encrypted, textContext(row)), ...metadata, version: row.version,
      confirmedBy: row.confirmed_by ?? row.author_user_id, confirmedAt: (row.confirmed_at ?? row.created_at).toISOString() };
  }
  async function lockChild(client: PoolClient, childId: string, writeProfile = false): Promise<number> {
    const row = (await client.query<{ profile_version: number }>(`SELECT profile_version FROM children WHERE id=$1 FOR ${writeProfile ? "UPDATE" : "SHARE"}`, [childId])).rows[0];
    if (!row) throw new FamilyError(404, "not_found");
    return row.profile_version;
  }
  async function archive(client: PoolClient, value: CareRecord) {
    const { id, childId, authorUserId: _author, createdAt: _created, ...revision } = value;
    await client.query("INSERT INTO text_record_revisions(record_id,version,payload_encrypted) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [id, value.version, cipher.encrypt(JSON.stringify(revision), revisionContext(childId, id, value.version))]);
  }
  async function currentProfile(client: PoolClient, childId: string, version: number): Promise<ChildProfile> {
    const row = (await client.query<{ payload_encrypted: string }>("SELECT payload_encrypted FROM child_profile_revisions WHERE child_id=$1 AND version=$2", [childId, version])).rows[0];
    return row ? JSON.parse(cipher.decrypt(row.payload_encrypted, profileContext(childId, version)))
      : { childId, version, data: null, confirmedBy: null, confirmedAt: null, reason: null };
  }
  return {
    async reportSource(userId:string,childId:string) {
      return withChildAccess(pool,userId,childId,READ_ROLES,async client=>{
        const profile=await currentProfile(client,childId,await lockChild(client,childId));
        const rows=(await client.query<Row>("SELECT * FROM text_records WHERE child_id=$1 ORDER BY created_at,id LIMIT 2001",[childId])).rows;
        if(rows.length>2000)throw new FamilyError(409,"summary_scope_too_large");
        return {profile,records:rows.map(record)};
      });
    },
    async search(userId: string, childId: string, input: CareSearch): Promise<CarePage | null> {
      return withChildAccess(pool, userId, childId, READ_ROLES, async (client, _role, workspaceId) => {
        await lockChild(client, childId);
        const changeSeq = trackChanges ? (await client.query<{ change_seq: string }>("SELECT change_seq::text FROM workspaces WHERE id=$1", [workspaceId])).rows[0].change_seq : undefined;
        if (input.cursor?.changeSeq !== undefined && input.cursor.changeSeq !== changeSeq) throw new FamilyError(409, "cursor_stale");
        const rows = (await client.query<Row>(`SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at FROM text_records WHERE child_id=$1
          AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid))
          ORDER BY created_at DESC,id DESC LIMIT 201`, [childId, input.cursor?.createdAt ?? null, input.cursor?.id ?? null])).rows;
        const records: CareRecord[] = [];
        let scanned = 0;
        const query = input.query?.toLocaleLowerCase("zh-HK") ?? "";
        for (const row of rows.slice(0, 200)) {
          scanned++;
          const value = record(row);
          const haystack = [value.text, value.source, value.details.eventTime.rawText,
            value.details.quantity?.rawValue, value.details.quantity?.unit].join("\n").toLocaleLowerCase("zh-HK");
          if ((!input.kind || value.details.kind === input.kind) && haystack.includes(query)) records.push(value);
          if (records.length === 50) break;
        }
        const last = rows[scanned - 1];
        return { records, scanned, limit: 50, nextCursor: scanned < rows.length && last
          ? { createdAt: last.cursor_created_at!, id: last.id, ...(changeSeq === undefined ? {} : { changeSeq }) } : null };
      });
    },
    async create(userId: string, childId: string, values: CareValues, basis: "explicit" | "preauthorized_user_statement" = "explicit"): Promise<CareRecord | null> {
      return withChildAccess(pool, userId, childId, WRITE_ROLES, async (client, _role, workspaceId) => {
        await lockChild(client, childId);
        const identity = { id: randomUUID(), child_id: childId, author_user_id: userId, version: 1 };
        const metadata = { details: values.details, source: values.source,
          reason: basis === "preauthorized_user_statement" ? "依本人預先授權，由 Agent 整理保存的使用者陳述；未逐項確認為事實" : "首次確認",
          confirmationBasis: basis };
        const row = (await client.query<Row>(`INSERT INTO text_records(id,child_id,author_user_id,text_encrypted,details_encrypted,confirmed_by,confirmed_at)
          VALUES($1,$2,$3,$4,$5,$3,now()) RETURNING *`, [identity.id, childId, userId,
          cipher.encrypt(values.text, textContext(identity)), cipher.encrypt(JSON.stringify(metadata), detailsContext(identity))])).rows[0];
        const value = record(row); await archive(client, value);
        if (trackChanges) await appendOnlineChange(client, workspaceId, "care", childId);
        return value;
      }, trackChanges);
    },
    async get(userId: string, childId: string, id: string): Promise<CareRecord | null> {
      return withChildAccess(pool, userId, childId, READ_ROLES, async client => {
        const row = (await client.query<Row>("SELECT * FROM text_records WHERE id=$1 AND child_id=$2 FOR SHARE", [id, childId])).rows[0];
        return row ? record(row) : null;
      });
    },
    async revise(userId: string, childId: string, id: string, values: CareValues, expectedVersion: number, reason: string,
      basis: "explicit" | "preauthorized_user_statement" = "explicit"): Promise<CareRecord | null> {
      return withChildAccess(pool, userId, childId, WRITE_ROLES, async (client, _role, workspaceId) => {
        await lockChild(client, childId);
        const row = (await client.query<Row>("SELECT * FROM text_records WHERE id=$1 AND child_id=$2 FOR UPDATE", [id, childId])).rows[0];
        if (!row) return null;
        requireFamilyVersion(row.version, expectedVersion);
        await archive(client, record(row));
        const next = { ...row, version: row.version + 1 };
        const updated = (await client.query<Row>(`UPDATE text_records SET text_encrypted=$3,details_encrypted=$4,version=version+1,confirmed_by=$5,confirmed_at=now()
          WHERE id=$1 AND child_id=$2 RETURNING *`, [id, childId, cipher.encrypt(values.text, textContext(row)),
          cipher.encrypt(JSON.stringify({ details: values.details, source: values.source, reason, confirmationBasis: basis }), detailsContext(next)), userId])).rows[0];
        const value = record(updated); await archive(client, value);
        if (trackChanges) await appendOnlineChange(client, workspaceId, "care", childId);
        return value;
      }, trackChanges);
    },
    async history(userId: string, childId: string, id: string, before = 2147483647): Promise<HistoryPage<CareRevision> | null> {
      return withChildAccess(pool, userId, childId, READ_ROLES, async client => {
        await lockChild(client, childId);
        const row = (await client.query<Row>("SELECT * FROM text_records WHERE id=$1 AND child_id=$2 FOR SHARE", [id, childId])).rows[0];
        if (!row) return null;
        const rows = (await client.query<{ version: number; payload_encrypted: string }>("SELECT version,payload_encrypted FROM text_record_revisions WHERE record_id=$1 AND version<$2 ORDER BY version DESC LIMIT 51", [id, before])).rows;
        const revisions: CareRevision[] = rows.slice(0, 50).map(item => JSON.parse(cipher.decrypt(item.payload_encrypted, revisionContext(childId, id, item.version))));
        if (!rows.length && row.version === 1 && before > 1) {
          const { id: _id, childId: _child, authorUserId: _author, createdAt: _created, ...value } = record(row); revisions.push(value);
        }
        return { revisions, nextBeforeVersion: rows.length > 50 ? rows[49].version : null };
      });
    },
    async delete(userId: string, childId: string, id: string, expectedVersion: number): Promise<boolean | null> {
      return withChildAccess(pool, userId, childId, WRITE_ROLES, async (client, _role, workspaceId) => {
        await lockChild(client, childId);
        const row = (await client.query<{ version: number }>("SELECT version FROM text_records WHERE id=$1 AND child_id=$2 FOR UPDATE", [id, childId])).rows[0];
        if (!row) return null;
        requireFamilyVersion(row.version, expectedVersion);
        await client.query("INSERT INTO deleted_records(id,child_id,version) VALUES($1,$2,$3)", [id, childId, row.version + 1]);
        await client.query("DELETE FROM text_records WHERE id=$1 AND child_id=$2", [id, childId]);
        if (trackChanges) await appendOnlineChange(client, workspaceId, "care", childId, true);
        return true;
      }, trackChanges);
    },
    async profile(userId: string, childId: string): Promise<ChildProfile | null> {
      return withChildAccess(pool, userId, childId, READ_ROLES, async client => currentProfile(client, childId, await lockChild(client, childId)));
    },
    async saveProfile(userId: string, childId: string, data: ChildProfileData, expectedVersion: number, reason: string): Promise<ChildProfile | null> {
      return withChildAccess(pool, userId, childId, WRITE_ROLES, async (client, _role, workspaceId) => {
        const version = await lockChild(client, childId, true); requireFamilyVersion(version, expectedVersion);
        const value: ChildProfile = { childId, version: version + 1, data, reason, confirmedBy: userId, confirmedAt: new Date().toISOString() };
        await client.query("INSERT INTO child_profile_revisions(child_id,version,payload_encrypted) VALUES($1,$2,$3)",
          [childId, value.version, cipher.encrypt(JSON.stringify(value), profileContext(childId, value.version))]);
        await client.query("UPDATE children SET profile_version=$2 WHERE id=$1", [childId, value.version]);
        if (trackChanges) await appendOnlineChange(client, workspaceId, "profile", childId);
        return value;
      }, trackChanges);
    },
    async profileHistory(userId: string, childId: string, before = 2147483647): Promise<HistoryPage<ChildProfile> | null> {
      return withChildAccess(pool, userId, childId, READ_ROLES, async client => {
        await lockChild(client, childId);
        const rows = (await client.query<{ version: number; payload_encrypted: string }>("SELECT version,payload_encrypted FROM child_profile_revisions WHERE child_id=$1 AND version<$2 ORDER BY version DESC LIMIT 51", [childId, before])).rows;
        return { revisions: rows.slice(0, 50).map(row => JSON.parse(cipher.decrypt(row.payload_encrypted, profileContext(childId, row.version)))),
          nextBeforeVersion: rows.length > 50 ? rows[49].version : null };
      });
    },
    async deleteProfile(userId: string, childId: string, expectedVersion: number): Promise<ChildProfile | null> {
      return withChildAccess(pool, userId, childId, WRITE_ROLES, async (client, _role, workspaceId) => {
        const version = await lockChild(client, childId, true); requireFamilyVersion(version, expectedVersion);
        await client.query("DELETE FROM child_profile_revisions WHERE child_id=$1", [childId]);
        await client.query("UPDATE children SET profile_version=profile_version+1 WHERE id=$1", [childId]);
        if (trackChanges) await appendOnlineChange(client, workspaceId, "profile", childId, true);
        return { childId, version: version + 1, data: null, confirmedBy: null, confirmedAt: null, reason: null };
      }, trackChanges);
    },
  };
}
export type CareStore = ReturnType<typeof createCareStore>;

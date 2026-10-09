import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { FamilyRole } from "../src/shared/family.ts";
import type { ChildProfile, HistoryPage } from "../src/shared/care.ts";
import type { FactCreate, FactConfirm, FactRevise, FactDeactivate, FactSource, MemoryFact, MemoryTopic, MemoryPage, MemoryContext, TopicCreate, TopicChange, TopicReopen } from "../src/shared/memory.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { FamilyError, READ_ROLES, WRITE_ROLES, requireFamilyVersion, withChildAccess } from "./family-access.ts";
import { factIsApplicable, normalizedFactKey, profileIsApplicable, requireTopicTransition, topicMayAsk } from "./memory-policy.ts";
import { factCreateSchema, factConfirmSchema, factReviseSchema, factDeactivateSchema, topicCreateSchema, topicChangeSchema, topicReopenSchema } from "./memory-validation.ts";
import { readSummary, readInitialConversationSummary, summaryInput, saveSummary } from "./memory-summary.ts";
import { appendOnlineChange } from "./online-change.ts";

interface Row { id: string; child_id: string; created_by: string; visibility: "private" | "family"; version: number; payload_encrypted: string }
type Kind = "facts" | "topics";
const singular = (kind: Kind) => kind === "facts" ? "fact" : "topic";
const aad = (kind: Kind, childId: string, id: string, version: number) => `memory-${singular(kind)}:${childId}:${id}:${version}`;
function requireWrite(role: FamilyRole, row: Row, userId: string) {
  if (row.visibility === "private" ? row.created_by !== userId : !WRITE_ROLES.includes(role)) throw new FamilyError(404, "not_found");
}
function requireSharing(role: FamilyRole, visibility: "private" | "family", confirmed: boolean) {
  if (visibility === "family" && !WRITE_ROLES.includes(role)) throw new FamilyError(404, "not_found");
  if (visibility === "family" && !confirmed) throw new FamilyError(400, "sharing_confirmation_required");
}
export function createMemoryStore(pool: Pool, cipher: StorageCipher, trackChanges = false) {
  async function transaction<T>(userId: string, childId: string, write: boolean, operation: (client: PoolClient, role: FamilyRole, profileVersion: number) => Promise<T>) {
    return withChildAccess(pool, userId, childId, READ_ROLES, async (client, role) => {
      const child = (await client.query<{ profile_version: number }>(`SELECT profile_version FROM children WHERE id=$1 FOR ${write ? "UPDATE" : "SHARE"}`, [childId])).rows[0];
      if (!child) throw new FamilyError(404, "not_found");
      return operation(client, role, child.profile_version);
    }, write && trackChanges);
  }
  async function changed(client: PoolClient, childId: string, visibility: "private" | "family", author: string, deleted = false) {
    if (!trackChanges) return;
    const row = (await client.query<{ workspace_id: string }>("SELECT workspace_id FROM children WHERE id=$1", [childId])).rows[0];
    await appendOnlineChange(client, row.workspace_id, "memory", childId, deleted, visibility === "private" ? author : null);
  }
  function visibleFact(value: MemoryFact, userId: string): MemoryFact {
    return value.createdBy !== userId && value.source.kind === "private_chat"
      ? { ...value, source: { kind: "private_chat", description: value.source.description } } : value;
  }
  function decode<T>(kind: Kind, row: Row): T { return JSON.parse(cipher.decrypt(row.payload_encrypted, aad(kind, row.child_id, row.id, row.version))); }
  async function sourceState(client: PoolClient, childId: string, source: FactSource): Promise<"current" | "changed"> {
    if (source.kind !== "care_record") return "current";
    const row = (await client.query<{ version: number }>("SELECT version FROM text_records WHERE id=$1 AND child_id=$2 FOR SHARE", [source.recordId, childId])).rows[0];
    return row?.version === source.version ? "current" : "changed";
  }
  async function checkSource(client: PoolClient, userId: string, childId: string, source: FactSource) {
    if (source.kind === "private_chat" && !(await client.query("SELECT 1 FROM chat_messages WHERE id=$1 AND child_id=$2 AND owner_user_id=$3 FOR SHARE", [source.messageId, childId, userId])).rowCount) throw new FamilyError(404, "not_found");
    if (await sourceState(client, childId, source) !== "current") throw new FamilyError(409, "source_changed");
  }
  async function factResult(client: PoolClient, row: Row, userId: string): Promise<MemoryFact> {
    const value = decode<MemoryFact>("facts", row);
    value.sourceState = await sourceState(client, row.child_id, value.source); value.applicable = factIsApplicable(value);
    return visibleFact(value, userId);
  }
  function topicResult(row: Row): MemoryTopic { const value = decode<MemoryTopic>("topics", row); return { ...value, mayAsk: topicMayAsk(value) }; }
  async function find(client: PoolClient, kind: Kind, userId: string, childId: string, id: string) {
    const row = (await client.query<Row>(`SELECT * FROM memory_${kind} WHERE id=$1 AND child_id=$2`, [id, childId])).rows[0];
    return row && (row.visibility === "family" || row.created_by === userId) ? row : null;
  }
  async function uniqueFact(client: PoolClient, fact: MemoryFact) {
    const rows = (await client.query<Row>(`SELECT * FROM memory_facts WHERE child_id=$1 AND id<>$2 AND status='confirmed'
      AND visibility=$3 AND ($3='family' OR created_by=$4)`, [fact.childId, fact.id, fact.visibility, fact.createdBy])).rows;
    if (rows.some(row => normalizedFactKey(decode<MemoryFact>("facts", row).key) === normalizedFactKey(fact.key))) throw new FamilyError(409, "fact_key_conflict");
  }
  async function writeFact(client: PoolClient, value: MemoryFact, isNew = false) {
    const payload = cipher.encrypt(JSON.stringify(value), aad("facts", value.childId, value.id, value.version));
    const message = value.source.kind === "private_chat" ? value.source.messageId : null;
    const record = value.source.kind === "care_record" ? value.source.recordId : null;
    const sourceVersion = value.source.kind === "care_record" ? value.source.version : null;
    if (isNew) await client.query(`INSERT INTO memory_facts(id,child_id,created_by,visibility,status,version,source_message_id,source_record_id,source_record_version,payload_encrypted)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [value.id, value.childId, value.createdBy, value.visibility, value.status, value.version, message, record, sourceVersion, payload]);
    else await client.query("UPDATE memory_facts SET visibility=$2,status=$3,version=$4,source_message_id=$5,source_record_id=$6,source_record_version=$7,payload_encrypted=$8 WHERE id=$1",
      [value.id, value.visibility, value.status, value.version, message, record, sourceVersion, payload]);
    await client.query("UPDATE memory_facts SET valid_until=$2,validity_indexed=true WHERE id=$1 AND version=$3", [value.id, value.validUntil, value.version]);
    await client.query("INSERT INTO memory_fact_revisions(fact_id,version,visibility,payload_encrypted) VALUES($1,$2,$3,$4)", [value.id, value.version, value.visibility, payload]);
    await changed(client, value.childId, value.visibility, value.createdBy);
  }
  async function writeTopic(client: PoolClient, value: MemoryTopic, creator: string, isNew = false) {
    const payload = cipher.encrypt(JSON.stringify(value), aad("topics", value.childId, value.id, value.version));
    if (isNew) await client.query("INSERT INTO memory_topics(id,child_id,created_by,visibility,status,version,reopened_from,payload_encrypted) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [value.id, value.childId, creator, value.visibility, value.status, value.version, value.reopenedFrom, payload]);
    else await client.query("UPDATE memory_topics SET status=$2,version=$3,payload_encrypted=$4,updated_at=now() WHERE id=$1", [value.id, value.status, value.version, payload]);
    await client.query("INSERT INTO memory_topic_revisions(topic_id,version,payload_encrypted) VALUES($1,$2,$3)", [value.id, value.version, payload]);
    await changed(client, value.childId, value.visibility, creator);
  }
  async function facts(client: PoolClient, userId: string, childId: string, after?: string, limit = 50, familyOnly = false, excludeInactive = false): Promise<MemoryPage<MemoryFact>> {
    const rows = (await client.query<Row>(`SELECT * FROM memory_facts WHERE child_id=$1 AND (visibility='family' OR (NOT $5::boolean AND created_by=$2))
      AND ($3::uuid IS NULL OR id>$3::uuid) AND (NOT $6::boolean OR status<>'inactive') ORDER BY id LIMIT $4`, [childId, userId, after ?? null, limit + 1, familyOnly, excludeInactive])).rows;
    const items: MemoryFact[] = []; for (const row of rows.slice(0, limit)) items.push(await factResult(client, row, familyOnly ? "" : userId));
    return { items, nextAfterId: rows.length > limit ? rows[limit - 1].id : null };
  }
  async function topics(client: PoolClient, userId: string, childId: string, after?: string, limit = 50, familyOnly = false): Promise<MemoryPage<MemoryTopic>> {
    const rows = (await client.query<Row>(`SELECT * FROM memory_topics WHERE child_id=$1 AND (visibility='family' OR (NOT $5::boolean AND created_by=$2))
      AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT $4`, [childId, userId, after ?? null, limit + 1, familyOnly])).rows;
    return { items: rows.slice(0, limit).map(topicResult), nextAfterId: rows.length > limit ? rows[limit - 1].id : null };
  }
  return {
    facts: (userId: string, childId: string, after?: string, limit = 50) => {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new FamilyError(400, "invalid_input");
      return transaction(userId, childId, false, client => facts(client, userId, childId, after, limit));
    },
    getFact: (userId: string, childId: string, id: string) => transaction(userId, childId, false, async client => {
      const row = await find(client, "facts", userId, childId, id); return row ? factResult(client, row, userId) : null;
    }),
    topics: (userId: string, childId: string, after?: string) => transaction(userId, childId, false, client => topics(client, userId, childId, after)),
    summary: (userId: string, childId: string) => transaction(userId, childId, false, async client => ({ summary: await readSummary(client, cipher, userId, childId) })),
    initialConversationSummary: (userId: string, childId: string) => transaction(userId, childId, false,
      client => readInitialConversationSummary(client, cipher, userId, childId)),
    prepareSummary: (userId: string, childId: string) => transaction(userId, childId, false, client => summaryInput(client, cipher, userId, childId)),
    saveSummary: (userId: string, childId: string, input: unknown) => transaction(userId, childId, true, async client => {
      const value = await saveSummary(client, cipher, userId, childId, input);
      await changed(client, childId, "private", userId); return value;
    }),
    async createFact(userId: string, childId: string, raw: FactCreate) {
      const input = factCreateSchema.parse(raw);
      return transaction(userId, childId, true, async (client, role) => {
        if (input.intendedVisibility === "family" && !WRITE_ROLES.includes(role)) throw new FamilyError(404, "not_found");
        await checkSource(client, userId, childId, input.values.source);
        const value: MemoryFact = { ...input.values, id: randomUUID(), childId, visibility: "private", intendedVisibility: input.intendedVisibility,
          status: "candidate", version: 1, createdBy: userId, confirmedBy: null, confirmedAt: null, reason: "候選，尚未確認", applicable: false, sourceState: "current" };
        await writeFact(client, value, true); return visibleFact(value, userId);
      });
    },
    async confirmFact(userId: string, childId: string, id: string, raw: FactConfirm) {
      const input = factConfirmSchema.parse(raw);
      return transaction(userId, childId, true, async (client, role) => {
        const row = await find(client, "facts", userId, childId, id); if (!row) return null;
        requireWrite(role, row, userId); requireFamilyVersion(row.version, input.expectedVersion);
        const old = decode<MemoryFact>("facts", row);
        if (old.status === "confirmed") throw new FamilyError(409, "already_confirmed");
        requireSharing(role, old.intendedVisibility, input.confirmShared); await checkSource(client, userId, childId, old.source);
        const value: MemoryFact = { ...old, visibility: old.intendedVisibility, status: "confirmed", version: old.version + 1,
          confirmedBy: userId, confirmedAt: new Date().toISOString(), reason: "使用者確認", sourceState: "current", applicable: false };
        value.applicable = factIsApplicable(value); await uniqueFact(client, value); await writeFact(client, value); return visibleFact(value, userId);
      });
    },
    async reviseFact(userId: string, childId: string, id: string, raw: FactRevise) {
      const input = factReviseSchema.parse(raw);
      return transaction(userId, childId, true, async (client, role) => {
        const row = await find(client, "facts", userId, childId, id); if (!row) return null;
        requireWrite(role, row, userId); requireFamilyVersion(row.version, input.expectedVersion);
        const old = decode<MemoryFact>("facts", row); requireSharing(role, old.visibility, input.confirmShared);
        await checkSource(client, userId, childId, input.values.source);
        const value: MemoryFact = { ...old, ...input.values, version: old.version + 1, reason: input.reason, sourceState: "current",
          confirmedBy: old.status === "confirmed" ? userId : old.confirmedBy, confirmedAt: old.status === "confirmed" ? new Date().toISOString() : old.confirmedAt };
        value.applicable = factIsApplicable(value); if (value.status === "confirmed") await uniqueFact(client, value);
        await writeFact(client, value); return visibleFact(value, userId);
      });
    },
    async deactivateFact(userId: string, childId: string, id: string, raw: FactDeactivate) {
      const input = factDeactivateSchema.parse(raw);
      return transaction(userId, childId, true, async (client, role) => {
        const row = await find(client, "facts", userId, childId, id); if (!row) return null;
        requireWrite(role, row, userId); requireFamilyVersion(row.version, input.expectedVersion);
        const value = { ...decode<MemoryFact>("facts", row), version: row.version + 1, status: "inactive" as const, reason: input.reason, applicable: false };
        value.sourceState = await sourceState(client, childId, value.source);
        await writeFact(client, value); return visibleFact(value, userId);
      });
    },
    async createTopic(userId: string, childId: string, raw: TopicCreate) {
      const input = topicCreateSchema.parse(raw);
      return transaction(userId, childId, true, async (client, role) => {
        requireSharing(role, input.visibility, input.confirmShared);
        const rows = (await client.query<Row>("SELECT * FROM memory_topics WHERE child_id=$1 AND visibility=$2 AND ($2='family' OR created_by=$3)", [childId, input.visibility, userId])).rows;
        if (rows.some(row => normalizedFactKey(topicResult(row).title) === normalizedFactKey(input.title))) throw new FamilyError(409, "topic_exists");
        const value: MemoryTopic = { id: randomUUID(), childId, visibility: input.visibility, title: input.title, note: input.note, status: "pending", version: 1,
          updatedBy: userId, updatedAt: new Date().toISOString(), resumeAfter: null, reopenReason: null, reopenedFrom: null, mayAsk: true };
        await writeTopic(client, value, userId, true); return value;
      });
    },
    async changeTopic(userId: string, childId: string, id: string, raw: TopicChange) {
      const input = topicChangeSchema.parse(raw);
      return transaction(userId, childId, true, async (client, role) => {
        const row = await find(client, "topics", userId, childId, id); if (!row) return null;
        requireWrite(role, row, userId); requireFamilyVersion(row.version, input.expectedVersion);
        const old = topicResult(row); requireTopicTransition(old.status, input.status, input.resumeAfter);
        const value = { ...old, status: input.status, note: input.note, resumeAfter: input.resumeAfter, version: row.version + 1, updatedBy: userId, updatedAt: new Date().toISOString() };
        value.mayAsk = topicMayAsk(value); await writeTopic(client, value, row.created_by); return value;
      });
    },
    async reopenTopic(userId: string, childId: string, id: string, raw: TopicReopen) {
      const input = topicReopenSchema.parse(raw);
      return transaction(userId, childId, true, async (client, role) => {
        const row = await find(client, "topics", userId, childId, id); if (!row) return null;
        requireWrite(role, row, userId); requireFamilyVersion(row.version, input.expectedVersion);
        const old = topicResult(row);
        if (!["answered", "resolved"].includes(old.status) || (await client.query("SELECT 1 FROM memory_topics WHERE reopened_from=$1", [id])).rowCount) throw new FamilyError(409, "topic_reopen_conflict");
        const value: MemoryTopic = { ...old, id: randomUUID(), version: 1, status: "pending", resumeAfter: null, reopenReason: input.reason, reopenedFrom: id,
          updatedBy: userId, updatedAt: new Date().toISOString(), mayAsk: true };
        await writeTopic(client, value, row.created_by, true); return value;
      });
    },
    async history(userId: string, childId: string, kind: Kind, id: string, before = 2147483647): Promise<HistoryPage<MemoryFact | MemoryTopic> | null> {
      return transaction(userId, childId, false, async client => {
        const row = await find(client, kind, userId, childId, id); if (!row) return null;
        const name = singular(kind);
        const rows = (await client.query<{ version: number; payload_encrypted: string }>(`SELECT version,payload_encrypted FROM memory_${name}_revisions
          WHERE ${name}_id=$1 AND version<$2 ${kind === "facts" && row.created_by !== userId ? "AND visibility='family'" : ""} ORDER BY version DESC LIMIT 51`, [id, before])).rows;
        const revisions: (MemoryFact | MemoryTopic)[] = [];
        for (const item of rows.slice(0, 50)) revisions.push(kind === "facts" ? await factResult(client, { ...row, ...item }, userId) : topicResult({ ...row, ...item }));
        return { revisions, nextBeforeVersion: rows.length > 50 ? rows[49].version : null };
      });
    },
    async delete(userId: string, childId: string, kind: Kind, id: string, expectedVersion: number) {
      return transaction(userId, childId, true, async (client, role) => {
        const row = await find(client, kind, userId, childId, id); if (!row) return null;
        requireWrite(role, row, userId); requireFamilyVersion(row.version, expectedVersion);
        await client.query("INSERT INTO deleted_memories(id,child_id,kind,version) VALUES($1,$2,$3,$4)", [id, childId, singular(kind), row.version + 1]);
        await client.query(`DELETE FROM memory_${kind} WHERE id=$1`, [id]);
        // Retain unrelated summary contents; invalid text cannot return to model context.
        await client.query("UPDATE conversation_summaries SET invalidated=true WHERE child_id=$1 AND ($2::boolean OR owner_user_id=$3)", [childId, row.visibility === "family", userId]);
        await changed(client, childId, row.visibility, row.created_by, true);
        return true;
      });
    },
    // Reports reuse the authorized fact decoder without reading conversation summaries or topics.
    reportFacts(userId: string, childId: string, afterId?: string) {
      return transaction(userId, childId, false, client => facts(client, userId, childId, afterId, 20, true, true));
    },
    async context(userId: string, childId: string, scope: "private" | "family", pages: { factsAfterId?: string; topicsAfterId?: string } = {}): Promise<MemoryContext | null> {
      return transaction(userId, childId, false, async (client, _role, profileVersion) => {
        const profileRow = (await client.query<{ payload_encrypted: string }>("SELECT payload_encrypted FROM child_profile_revisions WHERE child_id=$1 AND version=$2", [childId, profileVersion])).rows[0];
        const profile: ChildProfile = profileRow ? JSON.parse(cipher.decrypt(profileRow.payload_encrypted, `child-profile:${childId}:${profileVersion}`))
          : { childId, version: profileVersion, data: null, confirmedBy: null, confirmedAt: null, reason: null };
        const factPage = await facts(client, userId, childId, pages.factsAfterId, 20, scope === "family", true), topicPage = await topics(client, userId, childId, pages.topicsAfterId, 20, scope === "family");
        const input = scope === "private" ? await summaryInput(client, cipher, userId, childId) : null;
        const applicable = factPage.items.filter(value => value.applicable), values = new Map<string, Set<string>>();
        for (const fact of applicable) { const key = normalizedFactKey(fact.key), contents = values.get(key) ?? new Set<string>(); contents.add(fact.content); values.set(key, contents); }
        const conflictingKeys = [...values].filter(([, contents]) => contents.size > 1).map(([key]) => key);
        const profileApplicable = profileIsApplicable(profile.data);
        const unavailableFactKeys = factPage.items.filter(value => !value.applicable).map(value => normalizedFactKey(value.key));
        return { profile, profileApplicable, facts: applicable, topics: topicPage.items, summary: input?.previous ?? null, conflictingKeys, unavailableFactKeys,
          recentMessages: input?.messages ?? [], nextFactsAfterId: factPage.nextAfterId, nextTopicsAfterId: topicPage.nextAfterId, summaryUnavailable: input?.unavailableReason ?? null,
          truncated: { facts: Boolean(factPage.nextAfterId), topics: Boolean(topicPage.nextAfterId), messages: input?.moreUncovered ?? false } };
      });
    },
  };
}
export type MemoryStore = ReturnType<typeof createMemoryStore>;

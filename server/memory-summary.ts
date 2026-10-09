import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ChatMessage } from "../src/shared/chat.ts";
import type { ConversationSummary, SummaryInput } from "../src/shared/memory.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { FamilyError } from "./family-access.ts";
import { summarySaveSchema } from "./memory-validation.ts";
import { profileIsApplicable } from "./memory-policy.ts";

interface SavedSummary extends ConversationSummary { basis: string; invalidated?: boolean }
/** Server-only snapshot for one provider request; not a saved summary or public wire contract. */
export interface InitialConversationSummary {
  summary: Pick<ConversationSummary, "id" | "version" | "text" | "createdAt" | "lastCoveredMessageId">;
  basis: string;
  validUntil: string | null;
}
const aad = (childId: string, userId: string, id: string) => `memory-summary:${childId}:${userId}:${id}`;

// Current authority versions invalidate derived text. The digest never grants access.
async function basis(client: PoolClient, cipher: StorageCipher, userId: string, childId: string) {
  const pending = (await client.query<{ id: string; version: number; payload_encrypted: string }>(
    "SELECT id,version,payload_encrypted FROM memory_facts WHERE child_id=$1 AND (visibility='family' OR created_by=$2) AND NOT validity_indexed ORDER BY id LIMIT 100",
    [childId, userId])).rows;
  for (const row of pending) {
    const fact = JSON.parse(cipher.decrypt(row.payload_encrypted, `memory-fact:${childId}:${row.id}:${row.version}`));
    await client.query("UPDATE memory_facts SET valid_until=$3,validity_indexed=true WHERE id=$1 AND version=$2 AND NOT validity_indexed", [row.id, row.version, fact.validUntil]);
  }
  const profile = (await client.query("SELECT profile_version FROM children WHERE id=$1", [childId])).rows;
  const profileRow = (await client.query("SELECT version,payload_encrypted FROM child_profile_revisions WHERE child_id=$1 AND version=$2", [childId, profile[0]?.profile_version ?? 0])).rows[0];
  const profileData = profileRow ? JSON.parse(cipher.decrypt(profileRow.payload_encrypted, `child-profile:${childId}:${profileRow.version}`)).data : null;
  const row = (await client.query<{ authority: unknown; metadata_complete: boolean; checked_at: Date; fact_valid_until: Date | null }>(`WITH checked AS MATERIALIZED (SELECT clock_timestamp() AS at)
    SELECT md5(jsonb_build_array(
    (SELECT coalesce(jsonb_agg(jsonb_build_array(id,version) ORDER BY id),'[]'::jsonb) FROM text_records WHERE child_id=$1),
    (SELECT coalesce(jsonb_agg(jsonb_build_array(id,version,status,visibility,valid_until,valid_until IS NULL OR valid_until>checked.at) ORDER BY id),'[]'::jsonb)
      FROM memory_facts WHERE child_id=$1 AND (visibility='family' OR created_by=$2)),
    (SELECT coalesce(jsonb_agg(jsonb_build_array(id,version) ORDER BY id),'[]'::jsonb) FROM memory_topics WHERE child_id=$1 AND (visibility='family' OR created_by=$2))
    )::text) AS authority, NOT EXISTS(SELECT 1 FROM memory_facts WHERE child_id=$1 AND (visibility='family' OR created_by=$2) AND NOT validity_indexed) AS metadata_complete,
    checked.at AS checked_at, (SELECT min(valid_until) FROM memory_facts WHERE child_id=$1
      AND (visibility='family' OR created_by=$2) AND valid_until>checked.at) AS fact_valid_until FROM checked`,
    [childId, userId])).rows[0];
  const checkedAt = row.checked_at instanceof Date ? row.checked_at.getTime() : NaN, timeKnown = Number.isFinite(checkedAt);
  const profileValid = profileIsApplicable(profileData, timeKnown ? row.checked_at : new Date());
  let expiresAt = row.fact_valid_until === null ? Infinity : row.fact_valid_until instanceof Date ? row.fact_valid_until.getTime() : NaN;
  if (profileValid && profileData.validUntil !== null) {
    // Profile dates are inclusive in Hong Kong. Midnight of the next day is 16:00 UTC.
    const date = profileData.validUntil;
    const midnight = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(date) ? Date.parse(date + "T00:00:00.000Z") : NaN;
    const validDate = Number.isFinite(midnight) && new Date(midnight).toISOString().slice(0, 10) === date;
    expiresAt = validDate ? Math.min(expiresAt, midnight + 16 * 60 * 60 * 1000) : NaN;
  }
  const validityKnown = timeKnown && (expiresAt === Infinity || Number.isFinite(expiresAt) && expiresAt > checkedAt);
  return { digest: createHash("sha256").update(JSON.stringify(["v2", profile, profileValid, row.authority])).digest("hex"), complete: row.metadata_complete,
    validityKnown, validUntil: validityKnown && expiresAt !== Infinity ? new Date(expiresAt).toISOString() : null };
}
async function latest(client: PoolClient, cipher: StorageCipher, userId: string, childId: string) {
  const row = (await client.query<{ id: string; payload_encrypted: string; invalidated: boolean }>("SELECT id,payload_encrypted,invalidated FROM conversation_summaries WHERE child_id=$1 AND owner_user_id=$2 ORDER BY version DESC LIMIT 1", [childId, userId])).rows[0];
  return row ? { ...JSON.parse(cipher.decrypt(row.payload_encrypted, aad(childId, userId, row.id))), invalidated: row.invalidated } as SavedSummary : null;
}
async function intact(client: PoolClient, userId: string, childId: string) {
  const result = await client.query(`SELECT 1 FROM conversation_summaries s WHERE s.child_id=$1 AND s.owner_user_id=$2 AND NOT s.invalidated
    AND (SELECT count(*) FROM summary_message_coverage c WHERE c.summary_id=s.id) <> s.covered_count LIMIT 1`, [childId, userId]);
  return !result.rowCount;
}
async function checkedSummary(client: PoolClient, cipher: StorageCipher, userId: string, childId: string) {
  const value = await latest(client, cipher, userId, childId);
  const current = await basis(client, cipher, userId, childId);
  if (!value || value.invalidated || !current.complete || value.basis !== current.digest || !await intact(client, userId, childId)) return null;
  const { basis: _basis, invalidated: _invalidated, ...summary } = value; return { summary, current };
}
export async function readSummary(client: PoolClient, cipher: StorageCipher, userId: string, childId: string): Promise<ConversationSummary | null> {
  return (await checkedSummary(client, cipher, userId, childId))?.summary ?? null;
}
export async function readInitialConversationSummary(client: PoolClient, cipher: StorageCipher, userId: string, childId: string): Promise<InitialConversationSummary | null> {
  const value = await checkedSummary(client, cipher, userId, childId);
  if (!value?.current.validityKnown) return null;
  const { id, version, text, createdAt, lastCoveredMessageId } = value.summary;
  return { summary: { id, version, text, createdAt, lastCoveredMessageId }, basis: value.current.digest, validUntil: value.current.validUntil };
}
export async function summaryInput(client: PoolClient, cipher: StorageCipher, userId: string, childId: string): Promise<SummaryInput> {
  const value = await latest(client, cipher, userId, childId), currentBasis = await basis(client, cipher, userId, childId);
  const previous = value && !value.invalidated && currentBasis.complete && value.basis === currentBasis.digest && await intact(client, userId, childId) ? value : null;
  const rows = (await client.query<{ id: string; author_user_id: string | null; role: "user" | "model"; in_reply_to: string | null; text_encrypted: string; created_at: Date }>(
    `SELECT m.* FROM chat_messages m WHERE m.child_id=$1 AND m.owner_user_id=$2
      AND ($3::boolean OR NOT EXISTS(SELECT 1 FROM summary_message_coverage c WHERE c.message_id=m.id))
      ORDER BY m.created_at,m.id LIMIT 51`, [childId, userId, previous === null])).rows;
  const messages: ChatMessage[] = rows.slice(0, 50).map(row => ({ id: row.id, childId, authorUserId: row.author_user_id, role: row.role,
    inReplyTo: row.in_reply_to, createdAt: row.created_at.toISOString(), text: cipher.decrypt(row.text_encrypted,
      `chat_messages:${row.id}:${childId}:${userId}:${row.role}:${row.in_reply_to ?? ""}:text`) }));
  return { previous, previousVersion: value?.version ?? 0, basis: currentBasis.digest, messages, moreUncovered: rows.length > 50, ...(currentBasis.complete ? {} : { unavailableReason: "fact_metadata_pending" as const }) };
}
export async function saveSummary(client: PoolClient, cipher: StorageCipher, userId: string, childId: string, raw: unknown): Promise<ConversationSummary> {
  const input = summarySaveSchema.parse(raw), expected = await summaryInput(client, cipher, userId, childId);
  if (expected.unavailableReason) throw new FamilyError(409, "summary_metadata_pending");
  if (input.previousVersion !== expected.previousVersion || input.basis !== expected.basis
    || JSON.stringify(input.coveredMessageIds) !== JSON.stringify(expected.messages.slice(0, input.coveredMessageIds.length).map(message => message.id))) throw new FamilyError(409, "summary_coverage_changed");
  if (!expected.previous) {
    await client.query("UPDATE conversation_summaries SET invalidated=true WHERE child_id=$1 AND owner_user_id=$2", [childId, userId]);
    await client.query("DELETE FROM summary_message_coverage c USING conversation_summaries s WHERE c.summary_id=s.id AND s.child_id=$1 AND s.owner_user_id=$2", [childId, userId]);
  }
  const value: SavedSummary = { id: randomUUID(), childId, version: expected.previousVersion + 1, text: input.text, createdAt: new Date().toISOString(),
    previousId: expected.previous?.id ?? null, coveredMessageIds: input.coveredMessageIds, lastCoveredMessageId: input.coveredMessageIds.at(-1)!, basis: expected.basis };
  await client.query("INSERT INTO conversation_summaries(id,child_id,owner_user_id,version,previous_id,payload_encrypted,covered_count) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [value.id, childId, userId, value.version, value.previousId, cipher.encrypt(JSON.stringify(value), aad(childId, userId, value.id)), value.coveredMessageIds.length]);
  await client.query("INSERT INTO summary_message_coverage(message_id,summary_id) SELECT unnest($1::uuid[]),$2::uuid", [value.coveredMessageIds, value.id]);
  const { basis: _basis, ...publicValue } = value; return publicValue;
}

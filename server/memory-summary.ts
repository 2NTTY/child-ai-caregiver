import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ChatMessage } from "../src/shared/chat.ts";
import type { ConversationSummary, SummaryInput } from "../src/shared/memory.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { FamilyError } from "./family-access.ts";
import { summarySaveSchema } from "./memory-validation.ts";
import { factIsApplicable, profileIsApplicable } from "./memory-policy.ts";

interface SavedSummary extends ConversationSummary { basis: string; invalidated?: boolean }
const aad = (childId: string, userId: string, id: string) => `memory-summary:${childId}:${userId}:${id}`;

// Current authority versions invalidate derived text. The digest never grants access.
async function basis(client: PoolClient, cipher: StorageCipher, userId: string, childId: string) {
  const profile = (await client.query("SELECT profile_version FROM children WHERE id=$1", [childId])).rows;
  const records = (await client.query("SELECT id,version FROM text_records WHERE child_id=$1 ORDER BY id", [childId])).rows;
  const factRows = (await client.query("SELECT id,version,payload_encrypted FROM memory_facts WHERE child_id=$1 AND (visibility='family' OR created_by=$2) ORDER BY id", [childId, userId])).rows;
  const facts = factRows.map(row => { const value = JSON.parse(cipher.decrypt(row.payload_encrypted, `memory-fact:${childId}:${row.id}:${row.version}`)); return [row.id, row.version, factIsApplicable(value)]; });
  const profileRow = (await client.query("SELECT version,payload_encrypted FROM child_profile_revisions WHERE child_id=$1 AND version=$2", [childId, profile[0]?.profile_version ?? 0])).rows[0];
  const profileValid = profileRow ? profileIsApplicable(JSON.parse(cipher.decrypt(profileRow.payload_encrypted, `child-profile:${childId}:${profileRow.version}`)).data) : false;
  const topics = (await client.query("SELECT id,version FROM memory_topics WHERE child_id=$1 AND (visibility='family' OR created_by=$2) ORDER BY id", [childId, userId])).rows;
  return createHash("sha256").update(JSON.stringify([profile, profileValid, records, facts, topics])).digest("hex");
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
export async function readSummary(client: PoolClient, cipher: StorageCipher, userId: string, childId: string): Promise<ConversationSummary | null> {
  const value = await latest(client, cipher, userId, childId);
  if (!value || value.invalidated || value.basis !== await basis(client, cipher, userId, childId) || !await intact(client, userId, childId)) return null;
  const { basis: _basis, invalidated: _invalidated, ...publicValue } = value; return publicValue;
}
export async function summaryInput(client: PoolClient, cipher: StorageCipher, userId: string, childId: string): Promise<SummaryInput> {
  const value = await latest(client, cipher, userId, childId), currentBasis = await basis(client, cipher, userId, childId);
  const previous = value && !value.invalidated && value.basis === currentBasis && await intact(client, userId, childId) ? value : null;
  const rows = (await client.query<{ id: string; author_user_id: string | null; role: "user" | "model"; in_reply_to: string | null; text_encrypted: string; created_at: Date }>(
    `SELECT m.* FROM chat_messages m WHERE m.child_id=$1 AND m.owner_user_id=$2
      AND ($3::boolean OR NOT EXISTS(SELECT 1 FROM summary_message_coverage c WHERE c.message_id=m.id))
      ORDER BY m.created_at,m.id LIMIT 51`, [childId, userId, previous === null])).rows;
  const messages: ChatMessage[] = rows.slice(0, 50).map(row => ({ id: row.id, childId, authorUserId: row.author_user_id, role: row.role,
    inReplyTo: row.in_reply_to, createdAt: row.created_at.toISOString(), text: cipher.decrypt(row.text_encrypted,
      `chat_messages:${row.id}:${childId}:${userId}:${row.role}:${row.in_reply_to ?? ""}:text`) }));
  return { previous, previousVersion: value?.version ?? 0, basis: currentBasis, messages, moreUncovered: rows.length > 50 };
}
export async function saveSummary(client: PoolClient, cipher: StorageCipher, userId: string, childId: string, raw: unknown): Promise<ConversationSummary> {
  const input = summarySaveSchema.parse(raw), expected = await summaryInput(client, cipher, userId, childId);
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

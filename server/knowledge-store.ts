import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { KNOWLEDGE_EMBEDDING } from "../src/shared/knowledge.ts";
import type { KnowledgeCandidate, KnowledgeChunkInput, KnowledgeFilter, KnowledgeSourceInput } from "../src/shared/knowledge.ts";
import { embeddingDocument, knowledgeHash, parseKnowledgeFilter, parseKnowledgeSource, sourceVersionHash } from "./knowledge-inputs.ts";

interface VersionRow { id: string; source_id: string; version_hash: string; document: KnowledgeSourceInput; review_state: "draft" | "reviewed" | "withdrawn"; checked_at: Date | null }
export function vectorLiteral(values: readonly number[]): string {
  if (values.length !== KNOWLEDGE_EMBEDDING.dimensions || values.some(value => !Number.isFinite(value) || Math.abs(value) > 1e10)
    || !values.some(value => value !== 0)) throw new Error("Invalid knowledge vector");
  return `[${values.join(",")}]`;
}
async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let failed = false;
  try { await client.query("BEGIN"); const value = await action(client); await client.query("COMMIT"); return value; }
  catch (error) { failed = true; try { await client.query("ROLLBACK"); } catch { /* Destroy failed connection. */ } throw error; }
  finally { client.release(failed); }
}
async function version(client: Pick<Pool, "query"> | PoolClient, versionId: string): Promise<VersionRow> {
  const result = await client.query<VersionRow>("SELECT * FROM knowledge_versions WHERE id = $1", [versionId]);
  if (!result.rows[0]) throw new Error("Unknown knowledge version");
  return result.rows[0];
}
const vectorJoin = `JOIN knowledge_vectors e ON e.input_hash = c.embedding_hash AND e.model = $1 AND e.dimensions = $2 AND e.pipeline = $3`;
const embeddingKey = [KNOWLEDGE_EMBEDDING.model, KNOWLEDGE_EMBEDDING.dimensions, KNOWLEDGE_EMBEDDING.pipeline];

/** Operator-only maintenance methods are not exposed as browser/Agent tools. */
export function createKnowledgeStore(pool: Pool) {
  return {
    async importSource(input: unknown) {
      const document = parseKnowledgeSource(input);
      const hash = sourceVersionHash(document);
      return transaction(pool, async client => {
        await client.query("INSERT INTO knowledge_sources (id,url) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [document.sourceId, document.url]);
        const source = await client.query<{ url: string }>("SELECT url FROM knowledge_sources WHERE id = $1 FOR UPDATE", [document.sourceId]);
        if (source.rows[0]?.url !== document.url) throw new Error("Source URL changed; register a new source");
        const existing = await client.query<{ id: string; review_state: string }>("SELECT id,review_state FROM knowledge_versions WHERE source_id = $1 AND version_hash = $2", [document.sourceId, hash]);
        if (existing.rows[0]) return { versionId: existing.rows[0].id, hash, unchanged: true, state: existing.rows[0].review_state };
        const versionId = randomUUID();
        await client.query("INSERT INTO knowledge_versions (id,source_id,version_hash,document) VALUES ($1,$2,$3,$4)", [versionId, document.sourceId, hash, document]);
        for (const chunk of document.chunks) {
          const embedding = embeddingDocument(document.title, chunk.section, chunk.text);
          await client.query("INSERT INTO knowledge_chunks (id,version_id,section_key,document,content_hash,embedding_hash) VALUES ($1,$2,$3,$4,$5,$6)",
            [randomUUID(), versionId, chunk.key, chunk, knowledgeHash(chunk), embedding.hash]);
        }
        return { versionId, hash, unchanged: false, state: "draft" };
      });
    },
    async review(versionId: string, expectedHash: string, reviewer: string) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(reviewer)) throw new Error("Use an operator alias");
      return transaction(pool, async client => {
        const row = await version(client, versionId);
        await client.query("SELECT id FROM knowledge_sources WHERE id = $1 FOR UPDATE", [row.source_id]);
        if (row.version_hash !== expectedHash) throw new Error("Knowledge review version mismatch");
        // Explicit operator review is required; importing or generating vectors never approves content.
        await client.query("UPDATE knowledge_versions SET review_state = 'reviewed', reviewed_by = $2, checked_at = now() WHERE id = $1", [versionId, reviewer]);
        await client.query("UPDATE knowledge_sources SET last_checked_at = now() WHERE active_version_id = $1", [versionId]);
      });
    },
    async publish(versionId: string, expectedHash: string) {
      return transaction(pool, async client => {
        let row = await version(client, versionId);
        await client.query("SELECT id FROM knowledge_sources WHERE id = $1 FOR UPDATE", [row.source_id]);
        row = await version(client, versionId);
        if (row.review_state !== "reviewed" || row.version_hash !== expectedHash) throw new Error("Unreviewed knowledge version");
        if (row.document.validUntil && Date.parse(row.document.validUntil) <= Date.now()) throw new Error("Knowledge version expired");
        const readiness = await client.query<{ missing: string }>(
          `SELECT count(*)::text AS missing FROM knowledge_chunks c WHERE c.version_id = $4 AND NOT EXISTS
           (SELECT 1 FROM knowledge_vectors e WHERE e.input_hash = c.embedding_hash AND e.model = $1 AND e.dimensions = $2 AND e.pipeline = $3)`,
          [...embeddingKey, versionId]);
        if (Number(readiness.rows[0]?.missing) !== 0) throw new Error("Knowledge vectors incomplete");
        await client.query("UPDATE knowledge_versions SET published_at = COALESCE(published_at, now()) WHERE id = $1", [versionId]);
        await client.query("UPDATE knowledge_sources SET active_version_id = $2, enabled = true, disabled_reason = NULL, last_checked_at = $3 WHERE id = $1", [row.source_id, versionId, row.checked_at]);
      });
    },
    async disable(sourceId: string, reason: string) {
      if (!reason.trim() || reason.length > 400) throw new Error("A source disable reason is required");
      await transaction(pool, async client => {
        const result = await client.query<{ active_version_id: string | null }>("UPDATE knowledge_sources SET enabled = false, disabled_reason = $2 WHERE id = $1 RETURNING active_version_id", [sourceId, reason]);
        if (!result.rowCount) throw new Error("Unknown knowledge source");
        // A withdrawn edition cannot be republished without an explicit new content review.
        await client.query("UPDATE knowledge_versions SET review_state = 'withdrawn' WHERE id = $1", [result.rows[0]!.active_version_id]);
      });
    },
    async listVersions() {
      const result = await pool.query(`SELECT v.id, v.source_id, v.version_hash, v.review_state, v.checked_at, v.published_at,
        s.enabled, s.active_version_id = v.id AS active,
        (SELECT count(*)::integer FROM knowledge_chunks c WHERE c.version_id = v.id) AS chunks,
        (SELECT count(*)::integer FROM knowledge_chunks c ${vectorJoin} WHERE c.version_id = v.id) AS vectors,
        (SELECT count(DISTINCT c.id)::integer FROM knowledge_chunks c JOIN embedding_attempts a ON a.document_hash = c.embedding_hash
          WHERE c.version_id = v.id AND a.outcome <> 'succeeded' AND NOT EXISTS
          (SELECT 1 FROM knowledge_vectors e WHERE e.input_hash = c.embedding_hash AND e.model = $1 AND e.dimensions = $2 AND e.pipeline = $3)) AS failed_missing_vectors
        FROM knowledge_versions v JOIN knowledge_sources s ON s.id = v.source_id ORDER BY v.created_at DESC LIMIT 100`, embeddingKey);
      return result.rows;
    },
    async missingDocuments(versionId: string) {
      const row = await version(pool, versionId);
      if (row.review_state !== "reviewed") throw new Error("Review public content before embedding");
      const result = await pool.query<{ embedding_hash: string; document: KnowledgeChunkInput }>(
        `SELECT DISTINCT ON (c.embedding_hash) c.embedding_hash,c.document FROM knowledge_chunks c
         WHERE c.version_id = $4 AND NOT EXISTS (SELECT 1 FROM knowledge_vectors e
         WHERE e.input_hash = c.embedding_hash AND e.model = $1 AND e.dimensions = $2 AND e.pipeline = $3)
         ORDER BY c.embedding_hash`, [...embeddingKey, versionId]);
      return result.rows.map(chunk => embeddingDocument(row.document.title, chunk.document.section, chunk.document.text));
    },
    async embedDocument(document: { hash: string; title: string; text: string }, generate: () => Promise<readonly number[]>) {
      if (document.hash !== knowledgeHash([document.title, document.text])) throw new Error("Embedding document hash mismatch");
      const client = await pool.connect();
      let locked = false, failed = false;
      try {
        // Cross-process exclusion prevents concurrent maintenance jobs paying twice for identical content.
        const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1, 173610)) AS locked", [document.hash]);
        locked = lock.rows[0]?.locked === true;
        if (!locked) throw new Error("Knowledge embedding already in progress");
        const existing = await client.query("SELECT 1 FROM knowledge_vectors WHERE model = $1 AND dimensions = $2 AND pipeline = $3 AND input_hash = $4", [...embeddingKey, document.hash]);
        if (existing.rowCount) return { reused: true };
        const values = vectorLiteral(await generate());
        await client.query("INSERT INTO knowledge_vectors (model,dimensions,pipeline,input_hash,embedding) VALUES ($1,$2,$3,$4,$5::vector) ON CONFLICT DO NOTHING", [...embeddingKey, document.hash, values]);
        return { reused: false };
      } catch (error) { failed = true; throw error; }
      finally {
        if (locked && !failed) {
          try { await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 173610))", [document.hash]); } catch { failed = true; }
        }
        client.release(failed);
      }
    },
    async candidates(input: KnowledgeFilter, vector: readonly number[] | null): Promise<KnowledgeCandidate[]> {
      const filter = parseKnowledgeFilter(input);
      const values = vector === null ? null : vectorLiteral(vector);
      const rows = await pool.query<{ id: string; source_id: string; version_id: string; version_hash: string; content_hash: string;
        source_document: KnowledgeSourceInput; document: KnowledgeChunkInput; checked_at: Date; distance: number | null }>(
        `SELECT c.id,c.version_id,c.content_hash,c.document,v.source_id,v.version_hash,v.document AS source_document,v.checked_at,
         CASE WHEN $4::vector IS NULL THEN NULL ELSE e.embedding <=> $4::vector END AS distance
         FROM knowledge_sources s JOIN knowledge_versions v ON v.id = s.active_version_id AND v.source_id = s.id
         JOIN knowledge_chunks c ON c.version_id = v.id ${vectorJoin}
         WHERE s.enabled AND v.review_state = 'reviewed' AND v.published_at IS NOT NULL
           AND (v.document->>'validUntil' IS NULL OR (v.document->>'validUntil')::timestamptz > now())
           AND v.document->>'classification' = $5 AND c.document->'applicability'->>'region' = $6
           AND (c.document->'applicability'->>'ageBasis' = 'any' OR ($7::text IS NOT NULL
             AND c.document->'applicability'->>'ageBasis' = $7
             AND (c.document->'applicability'->>'minAgeMonths')::numeric <= $8
             AND CASE WHEN COALESCE((c.document->'applicability'->>'maxAgeMonthsExclusive')::boolean, false)
               THEN (c.document->'applicability'->>'maxAgeMonths')::numeric > $9
               ELSE (c.document->'applicability'->>'maxAgeMonths')::numeric >= $9 END))
           AND (cardinality($10::text[]) = 0 OR c.document->'applicability'->'topics' ?| $10::text[])
           AND ($5 <> 'recent_information' OR ((v.document->>'sourcePublishedAt')::timestamptz >= now() - interval '7 days'
             AND (v.document->>'sourcePublishedAt')::timestamptz <= now() AND s.last_checked_at >= now() - interval '24 hours'))
         ORDER BY c.id LIMIT 1001`,
        [...embeddingKey, values, filter.classification, filter.region, filter.age?.basis ?? null,
          filter.age?.minMonths ?? null, filter.age?.maxMonths ?? null, filter.topics]);
      if (rows.rows.length > 1000) throw new Error("Knowledge corpus exceeds the reviewed exact-search capacity");
      return rows.rows.map(row => ({ ...row.document, chunkId: row.id, sourceId: row.source_id, versionId: row.version_id,
        versionHash: row.version_hash, contentHash: row.content_hash, url: row.source_document.url, title: row.source_document.title,
        publisher: row.source_document.publisher, classification: row.source_document.classification,
        sourcePublishedAt: row.source_document.sourcePublishedAt, sourceUpdatedAt: row.source_document.sourceUpdatedAt,
        sourceDateText: row.source_document.sourceDateText ?? null, validUntil: row.source_document.validUntil ?? null,
        fetchedAt: row.source_document.fetchedAt, checkedAt: row.checked_at.toISOString(), reviewState: "reviewed", distance: row.distance }));
    },
  };
}
export type KnowledgeStore = ReturnType<typeof createKnowledgeStore>;

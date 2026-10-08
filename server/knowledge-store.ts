import { randomUUID } from "node:crypto";
import { personalLibraryItemSchema, type PersonalLibraryItem } from "../src/shared/personal-library.ts";
import type { Pool, PoolClient } from "pg";
import { KNOWLEDGE_EMBEDDING } from "../src/shared/knowledge.ts";
import type { KnowledgeCandidate, KnowledgeChunkInput, KnowledgeFilter, KnowledgeSourceInput } from "../src/shared/knowledge.ts";
import { knowledgeTokens } from "./knowledge-ranking.ts";
import { reviewKnowledgeVersion, publishKnowledgeVersion } from "./knowledge-version-review.ts";
import type { KnowledgeReviewAssessment } from "./knowledge-version-review.ts";
import { embeddingDocument, internalKnowledgeSource, knowledgeHash, parseKnowledgeFilter, parseKnowledgeSource, sourceVersionHash } from "./knowledge-inputs.ts";

interface VersionRow { id: string; source_id: string; version_hash: string; document: KnowledgeSourceInput; review_state: "draft" | "reviewed" | "withdrawn"; checked_at: Date | null }
export function vectorLiteral(values: readonly number[]): string {
  if (values.length !== KNOWLEDGE_EMBEDDING.dimensions || values.some(value => !Number.isFinite(value) || Math.abs(value) > 1e10)
    || !values.some(value => value !== 0)) throw new Error("Invalid knowledge vector");
  return `[${values.join(",")}]`;
}
async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let failed = false;
  try { await client.query("BEGIN"); await client.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='5s'"); const value = await action(client); await client.query("COMMIT"); return value; }
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
const restrictedSource = `(v.document->>'url' ~* '^https://(www[.]chp[.]gov[.]hk|([a-z]+[.])?rthk[.]hk)(/|$)')`;
// Shared eligibility for public retrieval and the read-only catalog. A catalog entry is not a citation.
const knowledgeEligibility = (allowInternal: string) => `s.enabled AND v.review_state = 'reviewed' AND v.published_at IS NOT NULL
  AND (w.id IS NULL OR (o.source_id IS NOT NULL AND w.enabled AND NOT o.unavailable AND o.approved_hash=o.content_hash AND o.approved_version_id=v.id))
  AND (${allowInternal} OR (w.definition->>'audience' IS DISTINCT FROM 'internal_noncommercial' AND NOT ${restrictedSource}))
  AND (v.document->>'validUntil' IS NULL OR (v.document->>'validUntil')::timestamptz > now())
  AND (v.document->>'classification' <> 'recent_information' OR ((v.document->>'sourcePublishedAt')::timestamptz >= now() - interval '7 days'
    AND (v.document->>'sourcePublishedAt')::timestamptz <= now() AND o.last_successful_check_at >= now() - interval '24 hours'))`;

/** Operator-only maintenance methods are not exposed as browser/Agent tools. */
export function createKnowledgeStore(pool: Pool, options: { audience?: "public" | "internal" } = {}) {
  // Only a trusted host operator may select internal review. This is never a model/browser filter.
  const internal = options.audience === "internal";
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
    async review(versionId: string, expectedHash: string, reviewer: string, assessment: KnowledgeReviewAssessment) {
      return transaction(pool, client => reviewKnowledgeVersion(client, versionId, expectedHash, reviewer, assessment, internal));
    },
    async publish(versionId: string, expectedHash: string) {
      return transaction(pool, client => publishKnowledgeVersion(client, versionId, expectedHash, internal, false));
    },
    async tryPublish(versionId: string, expectedHash?: string) {
      return transaction(pool, async client => {
        const row = await version(client, versionId);
        return publishKnowledgeVersion(client, versionId, expectedHash ?? row.version_hash, internal, true);
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
    async catalog(afterSourceId: string | null = null, connection: Pick<Pool, "query"> = pool): Promise<{ items: PersonalLibraryItem[]; nextSourceId: string | null }> {
      if (afterSourceId !== null && !/^[a-z0-9][a-z0-9-]{0,79}$/.test(afterSourceId)) throw new Error("Invalid catalog cursor");
      const result = await connection.query<{ source_id: string; version_id: string; source_document: KnowledgeSourceInput; checked_at: Date }>(
        `SELECT s.id AS source_id,v.id AS version_id,v.document AS source_document,v.checked_at
         FROM knowledge_sources s JOIN knowledge_versions v ON v.id=s.active_version_id AND v.source_id=s.id
         LEFT JOIN knowledge_observations o ON o.source_id=s.id LEFT JOIN knowledge_watches w ON w.id=COALESCE(o.watch_id,s.id)
         WHERE ${knowledgeEligibility("false")} AND v.document->>'classification' IN ('official_guidance','recent_information')
           AND ($1::text IS NULL OR s.id>$1) ORDER BY s.id LIMIT 11`, [afterSourceId]);
      const items = result.rows.slice(0, 10).map(row => personalLibraryItemSchema.parse({
        sourceId: row.source_id, versionId: row.version_id, title: row.source_document.title, publisher: row.source_document.publisher,
        url: row.source_document.url, classification: row.source_document.classification, checkedAt: row.checked_at.toISOString(),
        sourceUpdatedAt: row.source_document.sourceUpdatedAt, validUntil: row.source_document.validUntil ?? null,
      }));
      return { items, nextSourceId: result.rows.length > 10 ? items.at(-1)!.sourceId : null };
    },
    async candidates(input: KnowledgeFilter, vector: readonly number[] | null, selection: {
      query?: string; chunkIds?: string[]; versionId?: string; afterKey?: string; limit?: number;
    } = {}): Promise<KnowledgeCandidate[]> {
      const filter = parseKnowledgeFilter(input);
      const values = vector === null ? null : vectorLiteral(vector);
      if (selection.chunkIds && (!selection.chunkIds.length || selection.chunkIds.length > 6
        || selection.chunkIds.some(id => !/^[a-f0-9-]{36}$/i.test(id)))) throw new Error("Invalid knowledge citation IDs");
      const limit = Math.min(selection.limit ?? (selection.query ? 6 : 60), selection.query ? 6 : 60);
      if (!Number.isInteger(limit) || limit < 1 || selection.afterKey && !/^[a-z0-9-]{1,80}$/.test(selection.afterKey))
        throw new Error("Invalid knowledge selection");
      const queryTokens = [...knowledgeTokens(selection.query ?? "", true)];
      const tokenScore = (field: string, weight: number) => `(SELECT COALESCE(sum(CASE WHEN
        CASE WHEN qt.token ~ '^[a-z0-9]+$' THEN normalize(lower(${field}), NFKC) ~ ('(^|[^a-z0-9])' || qt.token || '([^a-z0-9]|$)')
        ELSE strpos(normalize(lower(${field}), NFKC),qt.token)>0 END THEN ${weight} ELSE 0 END),0) FROM unnest($16::text[]) AS qt(token))`;
      const keywordScore = `${tokenScore("source_document->>'title'", 4)} + ${tokenScore("document->>'section'", 3)}
        + (SELECT COALESCE(sum(${tokenScore("kw.value", 5)}),0) FROM jsonb_array_elements_text(document->'keywords') AS kw(value))
        + (SELECT COALESCE(sum(${tokenScore("tp.value", 4)}),0) FROM jsonb_array_elements_text(document->'applicability'->'topics') AS tp(value))
        + ${tokenScore("document->>'text'", 1)}`;
      const ranked = selection.query ? `, vector_top AS (SELECT id,row_number() OVER (ORDER BY distance,id) AS r
        FROM eligible WHERE distance<=0.4 ORDER BY distance,id LIMIT 60),
        keyword_scores AS (SELECT id,${keywordScore} AS score FROM eligible),
        keyword_top AS (SELECT id,row_number() OVER (ORDER BY score DESC,id) AS r FROM keyword_scores
          WHERE score>0 ORDER BY score DESC,id LIMIT 60),
        fused AS (SELECT id,sum(1.0/(60+r)) AS rank_score,min(r) AS best_rank
          FROM (SELECT * FROM vector_top UNION ALL SELECT * FROM keyword_top) ranks GROUP BY id)
        SELECT eligible.*,fused.rank_score FROM fused JOIN eligible USING(id) ORDER BY fused.rank_score DESC,fused.best_rank,id LIMIT $15`
        : `SELECT *,NULL::numeric AS rank_score FROM eligible ORDER BY chunk_order,id LIMIT $15`;
      const rows = await transaction(pool, client => client.query<{ id: string; source_id: string; version_id: string; version_hash: string; content_hash: string;
        source_document: KnowledgeSourceInput; document: KnowledgeChunkInput; checked_at: Date; last_successful_check_at: Date | null;
        usage_scope: "public_noncommercial" | "internal_noncommercial"; distance: number | null; rank_score: string | null }>(
        `WITH eligible AS MATERIALIZED (SELECT c.id,c.version_id,c.content_hash,c.document,v.source_id,v.version_hash,v.document AS source_document,v.checked_at,
         o.last_successful_check_at,CASE WHEN ${restrictedSource} THEN 'internal_noncommercial'
           ELSE COALESCE(w.definition->>'audience','public_noncommercial') END AS usage_scope,
         ord.chunk_order,CASE WHEN $4::vector IS NULL THEN NULL ELSE e.embedding <=> $4::vector END AS distance
         FROM knowledge_sources s JOIN knowledge_versions v ON v.id = s.active_version_id AND v.source_id = s.id
         JOIN knowledge_chunks c ON c.version_id = v.id ${vectorJoin}
         JOIN LATERAL (SELECT chunk_order FROM jsonb_array_elements(v.document->'chunks') WITH ORDINALITY AS listed(chunk,chunk_order)
           WHERE listed.chunk->>'key'=c.section_key) ord ON true
         LEFT JOIN knowledge_observations o ON o.source_id=s.id
         LEFT JOIN knowledge_watches w ON w.id=COALESCE(o.watch_id,s.id)
         WHERE ${knowledgeEligibility("$11::boolean")}
           AND v.document->>'classification' = $5 AND c.document->'applicability'->>'region' = $6
           AND (c.document->'applicability'->>'ageBasis' = 'any' OR $12='unknown' OR ($7::text IS NOT NULL
             AND c.document->'applicability'->>'ageBasis' = $7
             AND (c.document->'applicability'->>'minAgeMonths')::numeric <= CASE WHEN $12='overlap' THEN $9::numeric ELSE $8::numeric END
             AND CASE WHEN COALESCE((c.document->'applicability'->>'maxAgeMonthsExclusive')::boolean, false)
               THEN (c.document->'applicability'->>'maxAgeMonths')::numeric > CASE WHEN $12='overlap' THEN $8::numeric ELSE $9::numeric END
               ELSE (c.document->'applicability'->>'maxAgeMonths')::numeric >= CASE WHEN $12='overlap' THEN $8::numeric ELSE $9::numeric END END))
           AND (cardinality($10::text[]) = 0 OR c.document->'applicability'->'topics' ?| $10::text[])
           AND $16::text[] IS NOT NULL
           AND ($13::uuid[] IS NULL OR c.id=ANY($13::uuid[]))
           AND ($14::uuid IS NULL OR v.id=$14)
           AND ($17::text IS NULL OR ord.chunk_order>(SELECT listed.chunk_order
             FROM jsonb_array_elements(v.document->'chunks') WITH ORDINALITY AS listed(chunk,chunk_order)
             WHERE listed.chunk->>'key'=$17))
         ) ${ranked}`,
        [...embeddingKey, values, filter.classification, filter.region, filter.age?.basis ?? null,
          filter.age?.minMonths ?? null, filter.age?.maxMonths ?? null, filter.topics, internal, filter.ageMatch ?? "contained",
          selection.chunkIds ?? null, selection.versionId ?? null, limit, queryTokens, selection.afterKey ?? null]));
      return rows.rows.map(row => ({ ...row.document, chunkId: row.id, sourceId: row.source_id, versionId: row.version_id,
        versionHash: row.version_hash, contentHash: row.content_hash, url: row.source_document.url, title: row.source_document.title,
        publisher: row.source_document.publisher, classification: row.source_document.classification,
        sourcePublishedAt: row.source_document.sourcePublishedAt, sourceUpdatedAt: row.source_document.sourceUpdatedAt,
        sourceDateText: row.source_document.sourceDateText ?? null, validUntil: row.source_document.validUntil ?? null,
        fetchedAt: row.source_document.fetchedAt, checkedAt: row.checked_at.toISOString(),
        lastSuccessfulCheckAt: row.last_successful_check_at?.toISOString() ?? null, usageScope: row.usage_scope,
        reviewState: "reviewed", extraction: row.source_document.extraction,
        originalCoverage: row.document.originalText ? "chunk_original" : "excerpt_only",
        applicabilityStatus: row.document.applicability.ageBasis === "any" ? "applicable"
          : filter.ageMatch === "unknown" ? "requires_clarification" : filter.ageMatch === "overlap" ? "conditional" : "applicable",
        distance: row.distance, ...(row.rank_score === null ? {} : { rankScore: Number(row.rank_score) }) }));
    },
  };
}
export type KnowledgeStore = ReturnType<typeof createKnowledgeStore>;

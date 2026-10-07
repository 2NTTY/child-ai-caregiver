import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { reviewKnowledgeVersion } from "./knowledge-version-review.ts";
import type { KnowledgeReviewAssessment } from "./knowledge-version-review.ts";
import { knowledgeHash } from "./knowledge-inputs.ts";
import { refreshJobSchema } from "./knowledge-refresh-types.ts";
import type { ObservedContent, RefreshJob, SourceFetcher, SourceWatchDefinition } from "./knowledge-refresh-types.ts";

interface WatchRow { id: string; definition: SourceWatchDefinition; revision: string; enabled: boolean }
interface ObservationRow { source_id: string; watch_id: string; url: string; content_hash: string; document: ObservedContent;
  fetched_at: Date; last_successful_check_at: Date; unavailable: boolean }
const operatorAlias = (value: string) => { if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value)) throw new Error("knowledge_operator_invalid"); };
export function observationId(definition: SourceWatchDefinition, item: ObservedContent): string {
  return definition.kind !== "rss" ? definition.id : `${definition.id}-${knowledgeHash(item.url).slice(0,32)}`;
}
export function observationHash(item: ObservedContent): string {
  return knowledgeHash([item.url,item.title,item.text,item.sourcePublishedAt,item.sourceUpdatedAt,item.sourceDateText,
    ...(item.extraction || item.pages ? [item.extraction ?? null,item.pages ?? null] : [])]);
}
export function definitionHash(definition: SourceWatchDefinition): string {
  // JSONB changes object key order; compare explicit fields rather than JSON.stringify(row).
  return knowledgeHash([definition.id,definition.url,definition.kind,definition.classification,definition.publisher,
    definition.termsUrl,definition.audience,definition.selector ?? null,definition.itemHosts ?? [],definition.pdfPages ?? null,definition.title ?? null]);
}

async function tx<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect(); let failed = false;
  try {
    await client.query("BEGIN"); await client.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='5s'");
    const value = await action(client); await client.query("COMMIT"); return value;
  } catch (error) { failed = true; try { await client.query("ROLLBACK"); } catch {} throw error; }
  finally { client.release(failed); }
}

/** Only the operator registers reviewed definitions. Fetching never imports, embeds or publishes. */
export function createKnowledgeRefreshStore(pool: Pool, definitions: readonly SourceWatchDefinition[]) {
  const catalog = new Map(definitions.map(definition => [definition.id, definition]));
  const matches = (row: WatchRow) => {
    const expected = catalog.get(row.id);
    return expected && definitionHash(row.definition) === definitionHash(expected);
  };
  return {
    async register(id: string, operator: string) {
      operatorAlias(operator); const definition = catalog.get(id);
      if (!definition) throw new Error("knowledge_watch_not_in_catalog");
      await tx(pool, async client => {
        const revision = randomUUID();
        const result = await client.query<{ revision: string }>(`INSERT INTO knowledge_watches (id,definition,enabled,registered_by,revision) VALUES ($1,$2,true,$3,$4)
          ON CONFLICT (id) DO UPDATE SET definition=$2,enabled=true,registered_by=$3,terms_checked_at=now(),
            revision=CASE WHEN knowledge_watches.enabled AND knowledge_watches.definition=$2::jsonb THEN knowledge_watches.revision ELSE EXCLUDED.revision END,updated_at=now()
          RETURNING revision`, [id, definition, operator, revision]);
        // A changed scope or reactivation must not inherit approval from the prior registration.
        if (result.rows[0]?.revision === revision) await client.query(`UPDATE knowledge_observations
          SET approved_hash=NULL,approved_version_id=NULL,approved_by=NULL,approved_at=NULL WHERE watch_id=$1`, [id]);
      });
    },
    async disable(id: string) {
      await tx(pool, async client => {
        const result = await client.query("UPDATE knowledge_watches SET enabled=false,revision=gen_random_uuid(),updated_at=now() WHERE id=$1", [id]);
        if (!result.rowCount) throw new Error("knowledge_watch_unknown");
        await client.query("UPDATE knowledge_observations SET approved_hash=NULL,approved_version_id=NULL,approved_by=NULL,approved_at=NULL WHERE watch_id=$1", [id]);
      });
    },
    async list() {
      const watches = (await pool.query(`SELECT id,enabled,revision,last_attempt_at,last_successful_check_at,last_status FROM knowledge_watches ORDER BY id LIMIT 32`)).rows;
      const observations = (await pool.query(`SELECT o.source_id,o.watch_id,o.content_hash,o.unavailable,o.fetched_at,o.last_successful_check_at,
        o.approved_version_id,o.approved_at,(o.approved_hash=o.content_hash) AS current_review,
        o.document->>'sourcePublishedAt' AS source_published_at FROM knowledge_observations o ORDER BY o.last_successful_check_at DESC,o.source_id LIMIT 200`)).rows;
      const checks = (await pool.query("SELECT job_id,watch_id,status,item_count,changed_count,failure_code,http_status,checked_at FROM knowledge_source_checks ORDER BY checked_at DESC LIMIT 50")).rows;
      return { watches, observations, checks };
    },
    async inspect(sourceId: string) {
      const row = (await pool.query<ObservationRow>("SELECT * FROM knowledge_observations WHERE source_id=$1", [sourceId])).rows[0];
      if (!row) throw new Error("knowledge_observation_unknown"); return row;
    },
    async jobs(): Promise<{ definition: SourceWatchDefinition; data: RefreshJob }[]> {
      const control = (await pool.query<{ enabled: boolean; generation: string }>("SELECT enabled,generation FROM worker_control WHERE id=1")).rows[0];
      if (!control?.enabled) return [];
      return (await pool.query<WatchRow>("SELECT * FROM knowledge_watches WHERE enabled ORDER BY id LIMIT 32")).rows
        .filter(matches).map(row => ({ definition: row.definition, data: { watchId: row.id, revision: row.revision, workerGeneration: control.generation } }));
    },
    async approve(sourceId: string, contentHash: string, versionId: string, versionHash: string, operator: string, assessment: KnowledgeReviewAssessment) {
      operatorAlias(operator);
      return tx(pool, async client => {
        if (!(await client.query("SELECT id FROM knowledge_sources WHERE id=$1 FOR UPDATE", [sourceId])).rowCount) throw new Error("knowledge_source_unknown");
        const reference = (await client.query<{ watch_id: string }>("SELECT watch_id FROM knowledge_observations WHERE source_id=$1", [sourceId])).rows[0];
        const watch = reference && (await client.query<WatchRow>("SELECT * FROM knowledge_watches WHERE id=$1 FOR SHARE", [reference.watch_id])).rows[0];
        if (!watch?.enabled || !matches(watch) || assessment.observationHash !== contentHash) throw new Error("knowledge_observation_review_mismatch");
        const owner = (await client.query<{ source_id: string }>("SELECT source_id FROM knowledge_versions WHERE id=$1", [versionId])).rows[0];
        if (owner?.source_id !== sourceId) throw new Error("knowledge_observation_review_mismatch");
        return reviewKnowledgeVersion(client, versionId, versionHash, operator, assessment, watch.definition.audience === "internal_noncommercial", watch.revision);
      });
    },
    async process(input: RefreshJob, jobId: string, fetcher: SourceFetcher, signal: AbortSignal) {
      const data = refreshJobSchema.parse(input);
      if (!/^[a-f0-9-]{36}$/i.test(jobId)) throw new Error("knowledge_job_invalid");
      const client = await pool.connect(); let locked = false, discard = false;
      try {
        locked = (await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1,173611)) AS locked", [data.watchId])).rows[0]?.locked === true;
        if (!locked) throw new Error("knowledge_check_in_progress");
        if ((await client.query("SELECT 1 FROM knowledge_source_checks WHERE job_id=$1", [jobId])).rowCount) return { status: "already_recorded" };
        const eligible = async (lock: boolean) => {
          const watch = (await client.query<WatchRow>(`SELECT * FROM knowledge_watches WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [data.watchId])).rows[0];
          const control = (await client.query<{ enabled: boolean; generation: string }>(`SELECT enabled,generation FROM worker_control WHERE id=1${lock ? " FOR SHARE" : ""}`)).rows[0];
          return watch?.enabled && matches(watch) && watch.revision === data.revision && control?.enabled && control.generation === data.workerGeneration ? watch : null;
        };
        const watch = await eligible(false);
        if (!watch || signal.aborted) return { status: "inactive" };
        // Session advisory exclusion is held, but no SQL transaction or row lock spans the request.
        const fetched = await fetcher(watch.definition, signal);
        await client.query("BEGIN");
        await client.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='5s'");
        const current = await eligible(true);
        let status: "changed" | "unchanged" | "failed" | "unavailable" | "superseded" = "superseded", changed = 0, count = 0;
        if (current && !signal.aborted) {
          if (fetched.status === "ok") {
            if (fetched.items.length > 50 || (current.definition.kind !== "rss" && fetched.items.length !== 1)) throw new Error("knowledge_fetch_items_invalid");
            count = fetched.items.length;
            for (const item of fetched.items) {
              const id = observationId(current.definition, item), hash = observationHash(item);
              const previous = (await client.query<{ content_hash: string; unavailable: boolean }>("SELECT content_hash,unavailable FROM knowledge_observations WHERE source_id=$1", [id])).rows[0];
              if (!previous || previous.content_hash !== hash || previous.unavailable) changed++;
              await client.query(`INSERT INTO knowledge_observations (source_id,watch_id,url,content_hash,document,fetched_at,last_successful_check_at)
                VALUES ($1,$2,$3,$4,$5,now(),now()) ON CONFLICT (source_id) DO UPDATE SET content_hash=$4,document=$5,
                  fetched_at=now(),
                  last_successful_check_at=now(),unavailable=false`, [id, data.watchId, item.url, hash, item]);
            }
            status = changed ? "changed" : "unchanged";
          } else if (fetched.status === "unavailable") {
            status = "unavailable";
            await client.query(`UPDATE knowledge_observations SET unavailable=true,approved_hash=NULL,approved_version_id=NULL,approved_by=NULL,approved_at=NULL WHERE watch_id=$1`, [data.watchId]);
          } else status = "failed";
          await client.query(`UPDATE knowledge_watches SET last_attempt_at=now(),last_status=$2,
            last_successful_check_at=CASE WHEN $3 THEN now() ELSE last_successful_check_at END WHERE id=$1`, [data.watchId, status, fetched.status === "ok"]);
        }
        await client.query(`INSERT INTO knowledge_source_checks (job_id,watch_id,watch_revision,worker_generation,status,item_count,changed_count,failure_code,http_status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [jobId, data.watchId, data.revision, data.workerGeneration, status, count, changed,
          status === "failed" && fetched.status === "failed" ? fetched.reason : null,
          status === "unavailable" && fetched.status === "unavailable" ? fetched.httpStatus : null]);
        await client.query("COMMIT"); return { status, items: count, changed };
      } catch (error) { discard = true; try { await client.query("ROLLBACK"); } catch {} throw error; }
      finally {
        if (locked && !discard) try { await client.query("SELECT pg_advisory_unlock(hashtextextended($1,173611))", [data.watchId]); } catch { discard = true; }
        client.release(discard);
      }
    },
  };
}
export type KnowledgeRefreshStore = ReturnType<typeof createKnowledgeRefreshStore>;

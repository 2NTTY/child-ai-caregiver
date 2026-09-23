import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
}
export type AttemptOutcome = "succeeded" | "rate_limited" | "timeout" | "unavailable" | "invalid_response" | "unauthorized";
export interface AttemptRecord extends TokenUsage {
  userId: string;
  childId: string;
  model: string;
  outcome: AttemptOutcome;
  durationMs: number;
}
export interface AiUsageStore {
  reserve(userId: string, userLimit: number, globalLimit: number): Promise<boolean>;
  record(attempt: AttemptRecord): Promise<void>;
}
export function createAiUsageStore(pool: Pool): AiUsageStore {
  return {
    async reserve(userId, userLimit, globalLimit) {
      const client = await pool.connect();
      let failed = false;
      try {
        await client.query("BEGIN");
        // Serialize the short counter transaction across all API processes.
        await client.query("SELECT pg_advisory_xact_lock(173061, 6)");
        const day = "(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date";
        const keys = ["global", `user:${userId}`];
        await client.query(
          `INSERT INTO ai_daily_usage (day, scope_key, attempts)
           SELECT ${day}, key, 0 FROM unnest($1::text[]) AS key
           ON CONFLICT (day, scope_key) DO NOTHING`, [keys],
        );
        const result = await client.query<{ scope_key: string; attempts: number }>(
          `SELECT scope_key, attempts FROM ai_daily_usage WHERE day = ${day} AND scope_key = ANY($1::text[]) FOR UPDATE`, [keys],
        );
        const counters = new Map(result.rows.map(row => [row.scope_key, row.attempts]));
        if ((counters.get("global") ?? globalLimit) >= globalLimit || (counters.get(keys[1]!) ?? userLimit) >= userLimit) {
          await client.query("ROLLBACK");
          return false;
        }
        await client.query(
          `UPDATE ai_daily_usage SET attempts = attempts + 1 WHERE day = ${day} AND scope_key = ANY($1::text[])`, [keys],
        );
        await client.query("COMMIT");
        return true;
      } catch {
        failed = true;
        try { await client.query("ROLLBACK"); } catch { /* Destroy the failed connection. */ }
        throw new Error("AI quota storage unavailable");
      } finally {
        client.release(failed);
      }
    },
    async record(attempt) {
      // Persist an allowlist of metadata; never prompts, replies, credentials or raw errors.
      await pool.query(
        `INSERT INTO ai_attempts
         (id, user_id, child_id, model, outcome, input_tokens, output_tokens, cached_tokens, duration_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [randomUUID(), attempt.userId, attempt.childId, attempt.model, attempt.outcome,
          attempt.inputTokens, attempt.outputTokens, attempt.cachedTokens, attempt.durationMs],
      );
    },
  };
}
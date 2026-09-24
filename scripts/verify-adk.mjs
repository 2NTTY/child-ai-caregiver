import assert from "node:assert/strict";
import { z } from "zod";
import { readAiConfig } from "../server/ai-config.ts";
import { createPool } from "../server/database.ts";
import { createAiUsageStore } from "../server/ai-usage.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { createVertexAgentProvider } from "../server/agent-model-gateway.ts";

// Separate approval is required. Never run against the deployed or a real-family database.
let pool, calls = 0, toolCalls = 0, step = "preflight";
const recorded = [];
const maxCalls = Number(process.argv.find(arg => arg.startsWith("--max-model-calls="))?.split("=")[1] ?? "3");
try {
  if (!process.argv.includes("--approved-adk")) throw new Error("Approval required");
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 3) throw new Error("Invalid acceptance limit");
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^yuban_s06_test[A-Za-z0-9_]*$/.test(decodeURIComponent(url.pathname.slice(1)))
    || url.search || url.hash) throw new Error("Local synthetic DB required");
  if (process.env.GCP_PROJECT_ID !== "ai-caregivers-for-children") throw new Error("Unexpected project");
  const config = readAiConfig({ ...process.env, AI_ENABLED: "true", VERTEX_LOCATION: "global", GEMINI_MODEL: "gemini-3.1-flash-lite",
    AI_DAILY_USER_ATTEMPTS: "5", AI_DAILY_GLOBAL_ATTEMPTS: "20", AI_MAX_ATTEMPTS: "1", AI_MAX_OUTPUT_TOKENS: "512" });
  pool = createPool({ databaseUrl: url.toString() });
  step = "existing_synthetic_scope";
  const row = (await pool.query(`SELECT u.id AS user_id, c.id AS child_id, w.id AS workspace_id
    FROM "user" u JOIN workspaces w ON w.owner_user_id = u.id JOIN children c ON c.workspace_id = w.id
    WHERE u.email LIKE 'gemini-%@example.test' ORDER BY c.created_at LIMIT 1`)).rows[0];
  if (!row) throw new Error("Existing synthetic account required");
  const authorize = async () => (await pool.query(`SELECT 1 FROM children c JOIN workspaces w ON c.workspace_id = w.id
    WHERE c.id=$1 AND w.id=$2 AND w.owner_user_id=$3`, [row.child_id, row.workspace_id, row.user_id])).rowCount === 1;
  const usage = createAiUsageStore(pool);
  const vertex = createVertexAgentProvider(config);
  const runtime = createAgentRuntime({ config,
    usage: { reserve: (...args) => usage.reserve(...args), record: async record => { await usage.record(record); recorded.push(record); } },
    provider: { generate: async (request, signal) => {
      if (calls >= maxCalls || JSON.stringify({ contents: request.contents, config: request.config }).length > 12000) throw new Error("Acceptance cap reached");
      calls++;
      return vertex.generate(request, signal);
    } },
  });
  step = "real_adk_vertex_tool_cycle";
  const result = await runtime.run({
    scope: { userId: row.user_id, workspaceId: row.workspace_id, childId: row.child_id, authorizationVersion: "synthetic-p1-owner", dataVersion: "synthetic-static" },
    trigger: { kind: "interactive", reference: "s11-w03-synthetic-check" }, recipeId: "p1-chat", authorize,
    messages: [{ role: "user", text: "這是合成驗收。請使用 read_synthetic_context 查詢 drawing 欄位，再用一句香港繁體中文說明合成孩子畫了甚麼。不提供醫療建議，不保存或安排任何事項。" }],
    tools: [{ name: "read_synthetic_context", description: "Read the approved synthetic drawing field for this compatibility check.",
      parameters: z.object({ key: z.literal("drawing") }), authorize: async () => authorize(),
      execute: async () => { toolCalls++; return { status: "succeeded", reference: "synthetic-drawing", data: { drawing: "紅色小船" } }; } }],
  });
  assert.equal(result.status, "completed");
  assert.ok(toolCalls >= 1 && toolCalls <= 8);
  assert.ok(calls >= 2 && calls <= 3);
  assert.match(result.text, /紅/u);
  assert.match(result.text, /船/u);
  assert.ok(recorded.every(record => record.outcome === "succeeded"));
  assert.equal(recorded.length, calls);
  console.log(JSON.stringify({ result: "passed", checks: 4, realModelCalls: calls, toolCalls,
    model: config.model, location: config.location, adkVersion: "2.1.0", maxInputCharacters: 12000, maxOutputTokens: 512,
    usage: recorded.map(({ inputTokens, outputTokens, cachedTokens }) => ({ inputTokens, outputTokens, cachedTokens })),
    applicationRetries: 0, sdkRetries: 0, existingDataPreserved: true, bodiesLogged: false }));
} catch {
  console.error(JSON.stringify({ result: "failed", step, realModelCalls: calls, toolCalls, bodiesLogged: false }));
  process.exitCode = 1;
} finally { await pool?.end(); }

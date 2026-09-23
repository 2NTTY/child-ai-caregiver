import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { upgradeEncryptedStorage } from "../server/storage-upgrade.ts";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { readServerConfig } from "../server/config.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { createPool } from "../server/database.ts";
import { createAuth } from "../server/auth.ts";
import { createRequestHandler } from "../server/app.ts";
import { createWorkspaceStore } from "../server/workspaces.ts";
import { createRecordStore } from "../server/records.ts";
import { createChatStore } from "../server/chat.ts";
import { createAiUsageStore } from "../server/ai-usage.ts";
import { createModelGateway } from "../server/model-gateway.ts";
import { createVertexProvider } from "../server/vertex-provider.ts";

// Explicit approval, a synthetic local DB and fixed request/token caps are mandatory.
let pool, server;
let step = "preflight", calls = 0;
try {
  if (!process.argv.includes("--approved-gemini")) throw new Error("Approval required");
  const databaseUrl = new URL(process.env.TEST_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname)
    || !/^yuban_s06_test[A-Za-z0-9_]*$/.test(decodeURIComponent(databaseUrl.pathname.slice(1)))
    || databaseUrl.search || databaseUrl.hash) throw new Error("Local synthetic DB required");
  if (process.env.GCP_PROJECT_ID !== "ai-caregivers-for-children") throw new Error("Unexpected project");
  let handler;
  server = createServer((request, response) => { void handler(request, response).catch(() => response.destroy()); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const config = readServerConfig({ ...process.env, DATABASE_URL: databaseUrl.toString(),
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), SERVER_ORIGIN: origin, WEB_ORIGIN: origin, NODE_ENV: "test" });
  const ai = readAiConfig({ ...process.env, AI_ENABLED: "true", VERTEX_LOCATION: "global", GEMINI_MODEL: "gemini-3.1-flash-lite",
    AI_DAILY_USER_ATTEMPTS: "3", AI_DAILY_GLOBAL_ATTEMPTS: "100", AI_MAX_ATTEMPTS: "1",
    AI_TIMEOUT_MS: "30000", AI_MAX_INPUT_CHARACTERS: "6000", AI_MAX_OUTPUT_TOKENS: "512" });
  pool = createPool(config);
  const cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE));
  await upgradeEncryptedStorage(pool, cipher);
  const chat = createChatStore(pool, cipher), usage = createAiUsageStore(pool);
  step = "reply_lock_capacity_and_exclusion";
  const lockId = randomUUID();
  const locks = await Promise.all([lockId, randomUUID(), randomUUID(), randomUUID()].map(id => chat.acquireReplyLock(id)));
  assert.ok(locks.every(Boolean));
  try {
    assert.equal(await chat.acquireReplyLock(randomUUID()), null);
    assert.equal(await createChatStore(pool, cipher).acquireReplyLock(lockId), null);
    await pool.query("SELECT 1");
  } finally { await Promise.all(locks.map(release => release?.())); }
  const prompt = await readFile(new URL("../prompts/p1/childcare-chat.txt", import.meta.url), "utf8");
  const vertex = createVertexProvider(ai);
  const provider = { generate: async (...args) => {
    if (calls >= 3) throw new Error("Hard request cap reached");
    calls++;
    return vertex.generate(...args);
  } };
  handler = createRequestHandler({ config, auth: createAuth(config, pool), workspaces: createWorkspaceStore(pool),
    records: createRecordStore(pool, cipher), chat, aiUsage: usage, chatPrompt: prompt, aiMaxInputCharacters: ai.maxInputCharacters,
    modelGateway: createModelGateway({ config: ai, usage, provider }), checkDatabase: async () => { await pool.query("SELECT 1"); } });
  let cookie = "", userId;
  async function request(path, body, expectedStatus = 200, authenticated = true) {
    const response = await fetch(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST", headers: { origin, ...(authenticated ? { cookie } : {}),
        ...(userId ? { "x-expected-user-id": userId } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45000),
    });
    const received = response.headers.getSetCookie().map(value => value.split(";")[0]);
    if (received.length) cookie = received.join("; ");
    assert.equal(response.status, expectedStatus);
    return response.json();
  }
  step = "synthetic_http_login";
  const account = await request("/api/auth/sign-up/email", { name: "Synthetic Gemini check",
    email: `gemini-${randomUUID()}@example.test`, password: randomBytes(24).toString("hex") });
  userId = account.user.id;
  assert.ok(cookie);
  const { child } = await request("/api/children", { displayName: "合成孩子阿樂" }, 201);
  assert.deepEqual(await request("/api/ai/status"), { available: true });
  const messagesPath = `/api/children/${child.id}/messages`;
  const inputs = [
    "這是合成試玩資料。阿樂今日畫了一艘紅色小船。請用一句香港繁體中文回應，不要提供醫療建議。",
    "剛才阿樂畫了甚麼？請只用一句回答，保留物件及顏色。",
    "我想用剛才的畫跟阿樂聊天。請給我一句簡單的開放式問題，不要建立記錄或任務。",
  ];
  let lastMessage, lastReply;
  for (let index = 0; index < inputs.length; index++) {
    step = `gemini_turn_${index + 1}`;
    const { message } = await request(messagesPath, { text: inputs[index] }, 201);
    const { message: reply } = await request(`${messagesPath}/${message.id}/reply`, {});
    assert.equal(reply.role, "model");
    assert.equal(reply.inReplyTo, message.id);
    assert.ok(reply.text.trim());
    if (index === 1) { assert.match(reply.text, /紅/); assert.match(reply.text, /船/); }
    lastMessage = message; lastReply = reply;
  }
  step = "reply_reuse_and_session_denial";
  assert.equal((await request(`${messagesPath}/${lastMessage.id}/reply`, {})).message.id, lastReply.id);
  await request(`${messagesPath}/${lastMessage.id}/reply`, {}, 401, false);
  assert.equal(calls, 3);
  step = "reported_usage_and_persistence";
  const actualUsage = await request("/api/ai/usage");
  assert.equal(actualUsage.attempts, 3);
  assert.ok(actualUsage.inputTokens > 0);
  assert.ok(actualUsage.outputTokens > 0);
  assert.equal((await request(messagesPath)).messages.length, 6);
  const verificationPool = createPool(config);
  try { assert.equal((await createChatStore(verificationPool, cipher).listForUser(userId, child.id)).messages.length, 6); }
  finally { await verificationPool.end(); }
  console.log(JSON.stringify({ result: "passed", checks: 7, realModelCalls: calls, syntheticOnly: true,
    project: ai.project, model: ai.model, location: ai.location, requestMaxInputCharacters: 6000, requestMaxOutputTokens: 512,
    applicationRetries: 0, sdkRetries: 0, usage: actualUsage, preservedExistingData: true, conversationBodiesLogged: false }));
} catch {
  console.error(JSON.stringify({ result: "failed", step, realModelCalls: calls, conversationBodiesLogged: false }));
  process.exitCode = 1;
} finally {
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await pool?.end();
}

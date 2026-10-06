import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { createAgentActionsStore } from "../server/agent-actions-store.ts";
import { createCareStore } from "../server/care.ts";
import { createChatStore } from "../server/chat.ts";
import { readServerConfig } from "../server/config.ts";
import { createPool } from "../server/database.ts";
import { createProductAgentStore } from "../server/product-agent-store.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { emptyCareDetails } from "../src/shared/care.ts";

// Called only by the single browser case. No account/child creation, migration,
// Runner, SDK, gateway, worker, notification or cleanup is constructed here.
const storeCap = 15;
let pool, phase = "preflight", storeCalls = 0, networkAttempts = 0, runId = null;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Fixture external network blocked"); };
const call = action => { assert.ok(++storeCalls <= storeCap, "Store call cap exceeded"); return action(); };
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value);
let output;
try {
  assert.equal(Number(process.versions.node.split(".")[0]), 24);
  assert.equal(process.env.INT_DOMAIN_BROWSER_APPROVED, "true");
  assert.equal(process.env.AI_ENABLED, "false");
  assert.equal(process.env.WEB_PUSH_ENABLED, "false");
  assert.equal(process.env.TELEGRAM_ENABLED, "false");
  const database = new URL(process.env.TEST_DATABASE_URL ?? "");
  assert.ok(["postgres:", "postgresql:"].includes(database.protocol) && ["localhost", "127.0.0.1"].includes(database.hostname)
    && database.port === "5434" && database.pathname === "/yuban_s06_test" && !database.search && !database.hash);
  assert.ok(process.env.STORAGE_KEY_FILE && isAbsolute(process.env.STORAGE_KEY_FILE));
  let source = "";
  for await (const chunk of process.stdin) { source += chunk; assert.ok(Buffer.byteLength(source) <= 16384); }
  const input = JSON.parse(source);
  assert.ok(["seed", "revise"].includes(input.stage));
  assert.ok(typeof input.userId === "string" && input.userId.length > 0 && input.userId.length <= 128 && uuid(input.childId));
  assert.ok(typeof input.text === "string" && input.text.startsWith("INT-W03 合成") && input.text.length <= 1500);
  assert.ok(Number.isInteger(input.priorStoreCalls) && input.priorStoreCalls >= 0 && input.priorStoreCalls < storeCap);
  storeCalls = input.priorStoreCalls;
  const config = readServerConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL, BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    SERVER_ORIGIN: "http://localhost:3101", WEB_ORIGIN: "http://localhost:8181", HOST: "127.0.0.1", PORT: "3101", NODE_ENV: "test" });
  const key = await readSecretKey(process.env.STORAGE_KEY_FILE), cipher = createStorageCipher(key); key.fill(0);
  pool = createPool(config);
  const care = createCareStore(pool, cipher, true), details = emptyCareDetails("note");
  if (input.stage === "seed") {
    assert.equal(input.priorStoreCalls, 0);
    phase = "create_one_record";
    const record = await call(() => care.create(input.userId, input.childId, { text: input.text, details, source: "INT-W03 local synthetic fixture" }));
    assert.ok(record && uuid(record.id) && record.childId === input.childId && record.authorUserId === input.userId && record.version === 1);
    output = { recordId: record.id, version: record.version, confirmationBasis: record.confirmationBasis };
  } else {
    assert.equal(input.priorStoreCalls, 1); assert.ok(uuid(input.recordId));
    phase = "read_original_record";
    const original = await call(() => care.get(input.userId, input.childId, input.recordId));
    assert.ok(original && original.id === input.recordId && original.childId === input.childId && original.authorUserId === input.userId
      && original.version === 1 && original.details.kind === "note" && original.text.startsWith("INT-W03 合成"));
    const actions = createAgentActionsStore(pool, cipher), chat = createChatStore(pool, cipher, true, true), agent = createProductAgentStore(pool, cipher);
    phase = "save_exact_correction_policy";
    const policy = await call(() => actions.savePolicy(input.userId, input.childId, { operationId: randomUUID(), expectedVersion: 0,
      recordKinds: ["note"], allowRecordCorrections: true, allowPrivateNotes: false, allowSelfTasks: false,
      reminderConsentVersion: null, reminderBindings: [], confirm: true, confirmShared: true }));
    assert.ok(policy && policy.version === 1 && policy.effective && policy.allowRecordCorrections && !policy.allowPrivateNotes && !policy.allowSelfTasks);
    assert.deepEqual(policy.recordKinds, ["note"]); assert.deepEqual(policy.reminderBindings, []); assert.equal(policy.reminderConsentVersion, null);
    phase = "claim_source_user_statement";
    const message = await call(() => chat.createUserMessageForUser(input.userId, input.childId, `這是合成驗收資料。請將原日常備註更正為「${input.text}」。`));
    assert.ok(message && uuid(message.id));
    const claim = await call(() => agent.claim(input.userId, input.childId, { kind: "interactive", reference: message.id }, "product-interactive"));
    assert.ok(claim && claim.created && claim.state === "running" && claim.sourceMessageId === message.id); runId = claim.runId;
    phase = "execute_one_revision";
    const receipt = await call(() => actions.execute(claim.scope, claim.runId, "int-w03-revise-once", { kind: "revise_record", sourceQuote: input.text,
      expectedPolicyVersion: policy.version, recordId: input.recordId, expectedVersion: 1, text: input.text, details, reason: "合成驗收：更正原日常備註" }));
    assert.ok(receipt && receipt.kind === "revise_record" && receipt.state === "updated" && receipt.resource.kind === "care_record"
      && receipt.resource.id === input.recordId && receipt.resource.version === 2 && receipt.notification === "not_authorized");
    assert.deepEqual(receipt.channels, []);
    phase = "read_committed_revision";
    const record = await call(() => care.get(input.userId, input.childId, input.recordId));
    assert.ok(record && record.id === original.id && record.childId === input.childId && record.authorUserId === input.userId
      && record.version === 2 && record.text === input.text && record.confirmationBasis === "preauthorized_user_statement");
    phase = "finish_zero_model_run";
    assert.equal(await call(() => agent.finish(claim.scope, { runId: claim.runId, status: "completed", stopReason: null, provenance: null,
      countsKnown: true, text: "合成更正已保存，請核對原操作收據。", citations: [], retrievalMode: "not_used",
      tools: [{ name: "execute_ordinary_instruction", status: "succeeded", reference: receipt.id }],
      counts: { modelCalls: 0, toolCalls: 1, queryEmbeddings: 0 }, proposals: [] })), true);
    output = { recordId: record.id, version: record.version, confirmationBasis: record.confirmationBasis, receiptId: receipt.id, runId };
  }
  assert.equal(networkAttempts, 0);
  output = { ok: true, ...output, storeCalls, storeCap, networkAttempts, modelCalls: 0, queryEmbeddings: 0 };
} catch {
  output = { ok: false, phase, storeCalls, storeCap, networkAttempts, runId }; process.exitCode = 1;
} finally {
  if (pool) try { await pool.end(); } catch { output = { ok: false, phase: "close_fixture_pool", storeCalls, storeCap, networkAttempts, runId }; process.exitCode = 1; }
}
process.stdout.write(JSON.stringify(output));

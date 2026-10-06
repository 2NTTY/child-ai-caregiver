import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { AgentBudget } from "../server/agent-budget.ts";
import { createAgentSourceTools } from "../server/agent-source-tools.ts";
import { createAuth } from "../server/auth.ts";
import { createChatStore } from "../server/chat.ts";
import { readServerConfig } from "../server/config.ts";
import { createPool } from "../server/database.ts";
import { FamilyError } from "../server/family-access.ts";
import { createProductAgentStore } from "../server/product-agent-store.ts";
import { createRecordStore } from "../server/records.ts";
import { createSharedInputStore } from "../server/shared-input-store.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { privateSourceCitationSchema } from "../src/shared/product-agent.ts";

// Primary-reviewed single local scenario. No migration, Runner, model provider,
// embedding gateway, worker, notification, server or browser is constructed.
const limits = { accounts: 2, children: 1, storeCalls: 40 };
const counts = { accounts: 0, children: 0, storeCalls: 0, networkAttempts: 0 };
const scene = { userIds: [], childId: null, workspaceId: null, sourceId: null, runIds: [] };
const passed = [], budgets = [];
let pool, step = "preflight", output;
const call = async action => {
  assert.ok(++counts.storeCalls <= limits.storeCalls, "Store/API call cap exceeded");
  return action();
};
const check = async (name, action) => { step = name; await action(); passed.push(name); };
globalThis.fetch = async () => { counts.networkAttempts++; throw new Error("External fetch is outside this acceptance scope"); };

try {
  assert.deepEqual(process.argv.slice(2), ["--approved-local-int-w04"]);
  assert.equal(Number(process.versions.node.split(".")[0]), 24);
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["postgres:", "postgresql:"].includes(database.protocol)
    && ["localhost", "127.0.0.1"].includes(database.hostname)
    && database.port === "5434" && database.pathname === "/yuban_s06_test"
    && !database.search && !database.hash, "Assigned local test database required");
  assert.ok(process.env.STORAGE_KEY_FILE && isAbsolute(process.env.STORAGE_KEY_FILE));
  for (const flag of ["AI_ENABLED", "WEB_PUSH_ENABLED", "TELEGRAM_ENABLED"]) assert.equal(process.env[flag], "false");
  const key = await readSecretKey(process.env.STORAGE_KEY_FILE);
  const cipher = createStorageCipher(key); key.fill(0);
  const config = readServerConfig({ DATABASE_URL: process.env.DATABASE_URL, NODE_ENV: "test",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), SERVER_ORIGIN: "http://127.0.0.1:3099",
    WEB_ORIGIN: "http://127.0.0.1:3099", HOST: "127.0.0.1", PORT: "3099" });
  pool = createPool(config);
  await check("reviewed_migration_and_disabled_worker", async () => {
    const sql = (await readFile(new URL("../server/migrations/026-private-source-management.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
    const hashes = [sql, sql.replace(/\n/g, "\r\n")].map(value => createHash("sha256").update(value).digest("hex"));
    const row = (await call(() => pool.query(`SELECT m.checksum,w.enabled FROM app_migrations m
      CROSS JOIN worker_control w WHERE m.id='026-private-source-management' AND w.id=1`))).rows[0];
    assert.ok(row && hashes.includes(row.checksum), "Primary must apply reviewed migration 026 first");
    assert.equal(row.enabled, false);
  });
  const records = createRecordStore(pool, cipher, true), chat = createChatStore(pool, cipher, true, true);
  const agent = createProductAgentStore(pool, cipher), sources = createSharedInputStore(pool, cipher);
  // Tool-internal store reads count toward the same cap as direct calls.
  const scopedSources = { list: (...args) => call(() => sources.list(...args)), get: (...args) => call(() => sources.get(...args)) };
  const claimRun = async text => {
    const message = await call(() => chat.createUserMessageForUser(scene.userIds[0], scene.childId, text));
    assert.ok(message);
    const claim = await call(() => agent.claim(scene.userIds[0], scene.childId,
      { kind: "interactive", reference: message.id }, "product-interactive"));
    assert.ok(claim?.created && claim.state === "running" && claim.sourceMessageId === message.id);
    scene.runIds.push(claim.runId); return claim;
  };
  const sourceTools = claim => {
    const budget = new AgentBudget(); budgets.push(budget);
    const authorize = () => call(() => agent.authorize(claim.scope, claim.runId));
    return createAgentSourceTools(scopedSources, agent, { scope: claim.scope, runId: claim.runId, budget }, authorize);
  };
  const executeTool = async (bundle, claim, name, args) => {
    const tool = bundle.tools.find(candidate => candidate.name === name); assert.ok(tool);
    const parsed = tool.parameters.parse(args);
    return tool.execute(parsed, { scope: claim.scope, runId: claim.runId,
      callId: `int-w04-${name}`, signal: budgets.at(-1).signal });
  };
  await check("two_synthetic_accounts_one_shared_child", async () => {
    const auth = createAuth(config, pool);
    for (let index = 0; index < limits.accounts; index++) {
      const account = await call(() => auth.api.signUpEmail({ body: {
        name: `Synthetic INT-W04 ${index}`, email: `int-w04-${randomUUID()}@example.test`,
        password: randomBytes(24).toString("hex") }, headers: new Headers({ origin: config.publicOrigin }) }));
      assert.ok(account?.user?.id); scene.userIds.push(account.user.id); counts.accounts++;
    }
    const child = await call(() => records.createChildForUser(scene.userIds[0], { displayName: "INT-W04 合成驗收孩子" }));
    assert.ok(child?.id && child.workspaceId); scene.childId = child.id; scene.workspaceId = child.workspaceId; counts.children++;
    // One synthetic membership setup, restricted to the workspace created above.
    assert.equal((await call(() => pool.query(`INSERT INTO family_members(workspace_id,user_id,role)
      SELECT id,$2,'caregiver' FROM workspaces WHERE id=$1 AND owner_user_id=$3 RETURNING workspace_id`,
    [scene.workspaceId, scene.userIds[1], scene.userIds[0]]))).rowCount, 1);
    assert.equal((await call(() => records.getChildForUser(scene.userIds[1], scene.childId)))?.id, scene.childId);
  });
  const [owner, foreign] = scene.userIds, childId = scene.childId;
  const excerpt = "合成來源：睡前可一起閱讀圖畫書。";
  const body = `${excerpt}\n合成來源的未授權部分：這段不交給模型。`;
  const management = { intention: "本人指定只用於私人來源回述", purpose: "answer_reference",
    nature: "external_material", timeScope: "long_reference", validityText: "合成驗收資料",
    enabled: true, modelExcerpt: excerpt };
  let proposal, accepted, source, readClaim, readBundle;
  await check("propose_accept_and_exact_acceptance_replay", async () => {
    const claim = await claimRun("這是合成驗收，請把本人提供的資料設為私人回答參考，僅授權已選原文片段。");
    proposal = await call(() => agent.propose(claim.scope, claim.runId, "int-w04-source-once", {
      kind: "private_source_create", input: { kind: "personal_source", sourceLabel: "INT-W04 合成私人來源",
        sourceUrl: null, sourceDateText: null, sourceNotes: "本人提供的合成文字", text: body }, management }));
    assert.ok(proposal?.status === "pending" && proposal.result === null);
    assert.equal(await call(() => agent.finish(claim.scope, { runId: claim.runId, status: "completed", stopReason: null,
      provenance: null, countsKnown: true, text: "合成私人來源候選已準備，等待本人核對。", citations: [], retrievalMode: "not_used",
      tools: [{ name: "propose_private_source", status: "succeeded", reference: proposal.id }],
      counts: { modelCalls: 0, toolCalls: 1, queryEmbeddings: 0 }, proposals: [] })), true);
    const decision = { expectedVersion: proposal.version, decision: "accept", confirmShared: false };
    accepted = await call(() => agent.decide(owner, childId, claim.runId, proposal.id, decision));
    assert.ok(accepted?.status === "accepted" && accepted.result?.kind === "private_source");
    scene.sourceId = accepted.result.id;
    const repeated = await call(() => agent.decide(owner, childId, claim.runId, proposal.id, decision));
    assert.deepEqual(repeated, accepted);
    const listed = await call(() => sources.list(owner, childId));
    assert.equal(listed.inputs.length, 1); source = listed.inputs[0];
    assert.equal(source.id, scene.sourceId); assert.equal(source.version, accepted.result.version);
    assert.equal(source.kind, "personal_source"); assert.deepEqual(source.management, management);
  });
  await check("actual_list_read_tool_and_private_citation", async () => {
    readClaim = await claimRun("請讀取本人已核對授權的合成來源片段。"); readBundle = sourceTools(readClaim);
    const listed = await executeTool(readBundle, readClaim, "list_private_sources", {});
    assert.equal(listed.status, "succeeded"); assert.equal(listed.data.result.length, 1);
    assert.equal(listed.data.result[0].id, source.id);
    assert.equal(listed.data.result[0].management.modelReadAllowed, true);
    assert.equal(Object.hasOwn(listed.data.result[0], "text"), false);
    const read = await executeTool(readBundle, readClaim, "read_private_source", { inputId: source.id, expectedVersion: source.version });
    assert.equal(read.status, "succeeded");
    const citation = privateSourceCitationSchema.parse(read.data.result.citation);
    assert.equal(citation.citationId, `private:${source.id}:${source.version}`);
    assert.equal(citation.excerpt, excerpt); assert.notEqual(citation.excerpt, body);
    assert.equal(citation.sha256, source.sha256); assert.equal(read.data.result.verifiedOfficial, false);
    assert.deepEqual(readBundle.evidence.get(citation.citationId), citation);
    // Membership was proved above; null here tests private ownership, not child isolation.
    assert.equal(await call(() => sources.get(foreign, childId, source.id)), null);
  });
  await check("disable_same_resource_and_reject_fresh_read", async () => {
    const disabled = await call(() => sources.manage(owner, childId, source.id, { expectedVersion: source.version,
      management: { ...management, enabled: false }, content: null, reason: "合成驗收：本人停用私人來源" }));
    assert.equal(disabled.id, source.id); assert.equal(disabled.version, source.version + 1);
    assert.equal(disabled.management.enabled, false); assert.equal(disabled.management.modelExcerpt, null);
    const claim = await claimRun("合成來源已停用，請核對現在不可讀取。");
    const bundle = sourceTools(claim);
    const read = await executeTool(bundle, claim, "read_private_source", { inputId: source.id, expectedVersion: disabled.version });
    assert.equal(read.status, "rejected"); assert.equal(read.data?.code, "source_model_consent_required");
    assert.equal(bundle.evidence.size, 0);
    const history = await call(() => sources.managementHistory(owner, childId, source.id));
    assert.equal(history.inputId, source.id); assert.equal(history.version, disabled.version);
    assert.ok(history.revisions.some(revision => revision.version === disabled.version && revision.management?.enabled === false));
    assert.ok(history.revisions.some(revision => revision.version === source.version && revision.management?.enabled === true));
    assert.equal(counts.networkAttempts, 0);
  });
  await check("cleanup_only_created_child", async () => {
    assert.equal(await call(() => records.deleteChildForUser(owner, childId)), true);
    assert.equal(await call(() => records.getChildForUser(owner, childId)), null);
  });
  output = { result: "passed", checks: passed, counts, limits, scene, cleanedChild: true, syntheticAccountsRetained: true,
    realModelCalls: 0, embeddings: 0, externalNotifications: 0, migratedByThisScript: false };
} catch (error) {
  // First failure stops the scenario and retains only synthetic identifiers.
  // Never print assertion messages, driver errors, credentials or private bodies.
  process.exitCode = 1;
  output = { result: "failed", step, errorKind: error instanceof FamilyError ? error.code : error?.name ?? "Error",
    checksPassed: passed, counts, limits, preservedScene: scene, cleanupAttempted: step === "cleanup_only_created_child" };
} finally {
  for (const budget of budgets) budget.close();
  try { await pool?.end(); }
  catch { process.exitCode = 1; output = { ...output, result: "failed", closePoolFailed: true }; }
}
process.stdout.write(JSON.stringify(output) + "\n");

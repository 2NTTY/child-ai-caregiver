import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Firestore } from "@google-cloud/firestore";
import { FinishReason } from "@google/genai";
import { z } from "zod";
import {
  DEFAULT_SOFT_BUDGET_RATIO,
  ROLE_SOFT_BUDGET_PROFILES,
  deriveSoftBudgetTargets,
  resolveRoleSoftBudgetRatio,
  roundBudgetAllowance,
  roundConsumptionReserve,
} from "../src/shared/agent-run-limits.ts";
import { AgentBudget } from "../server/agent-budget.ts";
import { createAgentRuntime, type AgentTool } from "../server/agent-runtime.ts";
import { createHighWatermarkMonitor, evaluateSustainedHighWatermark, type HighWatermarkAlert } from "../server/agent-high-watermark.ts";
import { resolvePersonalModelLimits } from "../server/personal-model-policy.ts";
import { platformPolicySchema } from "../src/shared/admin.ts";
import { effectiveModelLimitsSchema } from "../src/shared/model-settings-schema.ts";
import { PERSONAL_MODEL, type ModelSettings } from "../src/shared/model-settings.ts";
import { firestoreDomainFixture } from "./helpers/firestore-domain-memory.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { createFirestoreAuthority } from "../server/firestore-authority.ts";
import { createFirestoreAdmin } from "../server/firestore-admin.ts";
import { createFirestoreModelRouting } from "../server/firestore-model-routing.ts";
import { createFirestoreChatStore } from "../server/firestore-chat.ts";
import { createFirestoreCareStore } from "../server/firestore-care.ts";
import { createFirestoreMemoryStore } from "../server/firestore-memory.ts";
import { createFirestoreOnlineStore } from "../server/firestore-online.ts";
import { createFirestoreProductAgent } from "../server/firestore-product-agent.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { SERVICE_POLICY_VERSION } from "../src/shared/account-service.ts";

test("centralized rounding contract rounds allowances down (floor) and reserves up (ceil)", () => {
  assert.equal(roundBudgetAllowance(64 * 0.25), 16);
  assert.equal(roundBudgetAllowance(1.99), 1);
  assert.equal(roundBudgetAllowance(2 * 0.25, 1), 1);
  assert.equal(roundBudgetAllowance(2 * 0.25, 0), 0);
  assert.equal(roundConsumptionReserve(6.4), 7);
  assert.equal(roundConsumptionReserve(4.0), 4);
  assert.equal(roundConsumptionReserve(0.01), 1);

  const softFrom64 = deriveSoftBudgetTargets({ modelCalls: 8, toolCalls: 64, queryEmbeddings: 4 }, 0.25);
  assert.deepEqual(softFrom64, {
    softBudgetRatio: 0.25,
    modelCalls: 2,
    toolCalls: 16,
    queryEmbeddings: 1,
  });
});

test("role/work-type soft budget profiles apply deterministically with precedence rules", (t) => {
  assert.equal(resolveRoleSoftBudgetRatio(), DEFAULT_SOFT_BUDGET_RATIO);
  assert.equal(resolveRoleSoftBudgetRatio({ role: "reviewer" }), ROLE_SOFT_BUDGET_PROFILES.reviewer);
  assert.equal(resolveRoleSoftBudgetRatio({ role: "retriever" }), ROLE_SOFT_BUDGET_PROFILES.retriever);
  assert.equal(resolveRoleSoftBudgetRatio({ role: "reviewer", policyRatio: 0.5 }), 0.5);
  assert.equal(
    resolveRoleSoftBudgetRatio({ role: "reviewer", policyRatio: 0.5, profileOverrides: { reviewer: 0.15 } }),
    0.15,
  );
  assert.equal(
    resolveRoleSoftBudgetRatio({ role: "reviewer", policyRatio: 0.5, profileOverrides: { reviewer: 0.15 }, runOverride: 0.4 }),
    0.4,
  );

  const budget = new AgentBudget();
  t.after(() => budget.close());
  budget.configurePersonal({ modelCalls: 10, toolCalls: 16, queryEmbeddings: 5 });
  const reviewerSnap = budget.planningSnapshot(true, { role: "reviewer" });
  assert.equal(reviewerSnap.softBudgetRatio, 0.2);
  assert.deepEqual(reviewerSnap.softBudget, { modelCalls: 2, toolCalls: 3, queryEmbeddings: 1 });
  const retrieverSnap = budget.planningSnapshot(true, { role: "retriever" });
  assert.equal(retrieverSnap.softBudgetRatio, 0.3);
  assert.deepEqual(retrieverSnap.softBudget, { modelCalls: 3, toolCalls: 4, queryEmbeddings: 1 });
});

test("admin softBudgetRatio updates propagate to routing and effective limits without code deployment", async () => {
  const f = firestoreDomainFixture();
  const options = {
    database: f.database,
    cipher: createStorageCipher(Buffer.alloc(32, 61)),
    projectId: "synthetic-soft-policy",
    namespace: "synthetic_soft_policy",
  };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({
    email: "owner@example.test",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    operationId: randomUUID(),
  });
  await authority.admitIdentity({ userId: "owner", email: "owner@example.test", emailVerified: true });
  await authority.acknowledge({ userId: "owner", operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });

  const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: options.projectId });
  const admin = createFirestoreAdmin(options, config);
  const routing = createFirestoreModelRouting(options, config);

  const initialPolicy = (await admin.overview()).policy;
  assert.equal(initialPolicy.softBudgetRatio, 0.25);

  const { version, updatedAt: _u, ...values } = initialPolicy;
  await admin.submit("admin", {
    kind: "policy",
    opId: randomUUID(),
    expectedVersion: version,
    values: { ...values, maxModelCalls: 8, maxToolCalls: 16, maxQueryEmbeddings: 4, softBudgetRatio: 0.5 },
  });

  const resolved = await routing.resolve("owner", "interactive");
  assert.equal(resolved.runLimits.softBudgetRatio, 0.5);

  const legacyParsed = platformPolicySchema.parse({
    enabled: true,
    model: PERSONAL_MODEL,
    dailyUserAttempts: 20,
    dailyGlobalAttempts: 200,
    personalDailyGlobalAttempts: 1000,
    maxModelCalls: 8,
    maxQueryEmbeddings: 4,
    version: 0,
    updatedAt: null,
  });
  assert.equal(legacyParsed.softBudgetRatio, 0.25);
});

test("resolvePersonalModelLimits exposes softTargets, softBudgetRatio, and per-dimension policy sources", () => {
  const policy = platformPolicySchema.parse({
    enabled: true,
    model: PERSONAL_MODEL,
    dailyUserAttempts: 30,
    dailyGlobalAttempts: 300,
    personalDailyGlobalAttempts: 1000,
    maxModelCalls: 8,
    maxToolCalls: 16,
    maxQueryEmbeddings: 4,
    maxRunSeconds: 300,
    modelRequestSeconds: 90,
    maxModelRetries: 2,
    softBudgetRatio: 0.5,
    version: 4,
    updatedAt: null,
  });
  const settings: ModelSettings = {
    version: 2,
    mode: "personal",
    provider: "gemini",
    model: PERSONAL_MODEL,
    keyConfigured: true,
    backgroundEnabled: false,
    dailyLimit: 200,
    maxModelCalls: 10,
    maxQueryEmbeddings: 6,
    maxToolCalls: 12,
    updatedAt: null,
  };
  const personalEffective = effectiveModelLimitsSchema.parse(resolvePersonalModelLimits(settings, policy));
  assert.equal(personalEffective.policyVersion, 4);
  assert.equal(personalEffective.softBudgetRatio, 0.5);
  assert.deepEqual(personalEffective.softTargets, { modelCalls: 5, toolCalls: 6, queryEmbeddings: 3 });
  assert.deepEqual(personalEffective.limitSources, {
    dailyLimit: "personal",
    maxModelCalls: "personal",
    maxQueryEmbeddings: "personal",
    maxToolCalls: "personal",
    maxRunSeconds: "administrator",
    modelRequestSeconds: "administrator",
    maxModelRetries: "administrator",
    softBudgetRatio: "administrator",
  });

  const platformEffective = effectiveModelLimitsSchema.parse(
    resolvePersonalModelLimits({ ...settings, mode: "platform" }, policy),
  );
  assert.deepEqual(platformEffective.softTargets, { modelCalls: 4, toolCalls: 8, queryEmbeddings: 2 });
  assert.equal(platformEffective.limitSources?.maxModelCalls, "administrator");
});

test("in-flight policy transition aborts on revoke and tightens limits at barrier without resetting counters", async (t) => {
  const budget = new AgentBudget();
  t.after(() => budget.close());
  budget.configurePersonal({ modelCalls: 8, toolCalls: 16, queryEmbeddings: 4, deadlineMs: 120_000, softBudgetRatio: 0.5 });

  await budget.admitModel();
  budget.take("toolCalls", 5);
  assert.deepEqual(budget.counts, { modelCalls: 1, toolCalls: 5, queryEmbeddings: 0 });

  const tightened = budget.applyPolicyTransition({
    enabled: true,
    maxModelCalls: 2,
    maxToolCalls: 10,
    softBudgetRatio: 0.25,
  });
  assert.deepEqual(tightened, { stopped: false, countersPreserved: true });
  assert.equal(budget.counts.modelCalls, 1);
  assert.equal(budget.counts.toolCalls, 5);
  assert.equal(budget.limits.modelCalls, 2);
  assert.equal(budget.limits.toolCalls, 10);
  assert.equal(budget.softBudgetRatio, 0.25);

  await budget.admitModel();
  await assert.rejects(budget.admitModel(), { reason: "model_limit" });
  assert.equal(budget.counts.modelCalls, 2);

  const disabled = budget.applyPolicyTransition({ enabled: false });
  assert.deepEqual(disabled, { stopped: true, reason: "unavailable", countersPreserved: true });
  assert.equal(budget.counts.modelCalls, 2);
  await assert.rejects(budget.admitModel(), { reason: "unavailable" });
});

test("sustained high-watermark detector flags sliding-window >= 80% runs and repeated-signature loops per category", () => {
  const mixed = [
    ...Array.from({ length: 14 }, () => ({ runCategory: "interactive", usedModelCalls: 2, hardModelCalls: 8 })),
    { runCategory: "interactive", usedModelCalls: 7, hardModelCalls: 8 },
    { runCategory: "interactive", usedModelCalls: 7, hardModelCalls: 8 },
    { runCategory: "interactive", usedModelCalls: 2, hardModelCalls: 8 },
    { runCategory: "interactive", usedModelCalls: 7, hardModelCalls: 8 },
    { runCategory: "interactive", usedModelCalls: 7, hardModelCalls: 8 },
    { runCategory: "background", usedModelCalls: 8, hardModelCalls: 8 },
  ];
  const belowThreshold = evaluateSustainedHighWatermark(mixed, "interactive");
  assert.equal(belowThreshold.triggered, false);
  assert.equal(belowThreshold.highWatermarkCount, 4);

  const atThreshold = evaluateSustainedHighWatermark(
    [...mixed, { runCategory: "interactive", usedModelCalls: 7, hardModelCalls: 8 }],
    "interactive",
  );
  assert.equal(atThreshold.triggered, true);
  assert.equal(atThreshold.highWatermarkCount, 5);
  assert.equal(atThreshold.windowCount, 20);
  assert.equal(atThreshold.recommendedAction, "tighten_or_compact");
  assert.deepEqual(atThreshold.triggeredDimensions, ["modelCalls"]);

  const consecutiveOnly = evaluateSustainedHighWatermark(
    [
      { runCategory: "interactive", usedModelCalls: 7, hardModelCalls: 8 },
      { runCategory: "interactive", usedModelCalls: 7, hardModelCalls: 8 },
      { runCategory: "interactive", usedModelCalls: 7, hardModelCalls: 8 },
    ],
    "interactive",
  );
  assert.equal(consecutiveOnly.triggered, true);
  assert.equal(consecutiveOnly.consecutiveHighStreak, 3);
  assert.equal(consecutiveOnly.recommendedAction, "review_soft_ratio");

  const slidingOut = evaluateSustainedHighWatermark(
    [
      ...Array.from({ length: 5 }, () => ({ runCategory: "interactive", usedModelCalls: 8, hardModelCalls: 8 })),
      ...Array.from({ length: 20 }, () => ({ runCategory: "interactive", usedModelCalls: 1, hardModelCalls: 8 })),
    ],
    "interactive",
  );
  assert.equal(slidingOut.triggered, false);
  assert.equal(slidingOut.highWatermarkCount, 0);

  const loop = evaluateSustainedHighWatermark(
    [
      { runCategory: "interactive", usedModelCalls: 2, hardModelCalls: 8, repeatedCallSignature: "search:same" },
      { runCategory: "interactive", usedModelCalls: 2, hardModelCalls: 8, repeatedCallSignature: "search:same" },
      { runCategory: "interactive", usedModelCalls: 2, hardModelCalls: 8, repeatedCallSignature: "search:same" },
    ],
    "interactive",
  );
  assert.equal(loop.triggered, true);
  assert.equal(loop.loopDetected, true);
  assert.equal(loop.recommendedAction, "stop_loop_early");
});

test("admin roleSoftBudgetRatios and personal softBudgetRatio persist and resolve via Firestore routing", async () => {
  const f = firestoreDomainFixture();
  const options = {
    database: f.database,
    cipher: createStorageCipher(Buffer.alloc(32, 31)),
    projectId: "synthetic-policy-round",
    namespace: "policy_round",
  };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({ email: "owner@example.test", expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
  await authority.admitIdentity({ userId: "owner", email: "owner@example.test", emailVerified: true });
  await authority.acknowledge({ userId: "owner", operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });

  const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: options.projectId });
  const admin = createFirestoreAdmin(options, config);
  const initialPolicy = await admin.readPolicy();
  const roleRatios = { interactive: 0.3, background: 0.5, reviewer: 0.1, retriever: 0.6 };
  await admin.submit("admin-1", {
    opId: randomUUID(),
    kind: "policy",
    expectedVersion: initialPolicy.version,
    values: {
      enabled: initialPolicy.enabled,
      model: initialPolicy.model,
      dailyUserAttempts: initialPolicy.dailyUserAttempts,
      dailyGlobalAttempts: initialPolicy.dailyGlobalAttempts,
      personalDailyGlobalAttempts: initialPolicy.personalDailyGlobalAttempts,
      maxModelCalls: 6,
      maxQueryEmbeddings: 3,
      maxToolCalls: 16,
      maxRunSeconds: 180,
      modelRequestSeconds: 45,
      maxModelRetries: 1,
      softBudgetRatio: 0.4,
      roleSoftBudgetRatios: roleRatios,
    },
  });

  const savedPolicy = await admin.readPolicy();
  assert.equal(savedPolicy.softBudgetRatio, 0.4);
  assert.deepEqual(savedPolicy.roleSoftBudgetRatios, roleRatios);

  const routing = createFirestoreModelRouting(options, config);
  const platformResolved = await routing.resolve("owner", "interactive");
  assert.deepEqual(platformResolved.roleSoftBudgetRatios, roleRatios);
  assert.equal(platformResolved.runLimits.softBudgetRatio, 0.4);
  assert.equal(await platformResolved.readPolicyTransition(), null);

  await routing.settings.save("owner", {
    opId: randomUUID(),
    expectedVersion: 0,
    mode: "personal",
    provider: "gemini",
    model: PERSONAL_MODEL,
    apiKey: "synthetic-personal-key",
    backgroundEnabled: false,
    dailyLimit: 50,
    maxModelCalls: 8,
    maxQueryEmbeddings: 4,
    softBudgetRatio: 0.35,
    consent: true,
  });

  const personalResolved = await routing.resolve("owner", "interactive");
  assert.equal(personalResolved.runLimits.softBudgetRatio, 0.35);
  assert.deepEqual(personalResolved.roleSoftBudgetRatios, roleRatios);
  const personalView = await routing.view("owner");
  assert.equal(personalView.effective?.softBudgetRatio, 0.35);
  assert.equal(personalView.effective?.limitSources?.softBudgetRatio, "personal");

  await admin.submit("admin-1", {
    opId: randomUUID(),
    kind: "policy",
    expectedVersion: savedPolicy.version,
    values: {
      enabled: true,
      model: initialPolicy.model,
      dailyUserAttempts: initialPolicy.dailyUserAttempts,
      dailyGlobalAttempts: initialPolicy.dailyGlobalAttempts,
      personalDailyGlobalAttempts: initialPolicy.personalDailyGlobalAttempts,
      maxModelCalls: 6,
      maxQueryEmbeddings: 3,
      maxToolCalls: 16,
      maxRunSeconds: 180,
      modelRequestSeconds: 45,
      maxModelRetries: 1,
      softBudgetRatio: 0.4,
      roleSoftBudgetRatios: { ...roleRatios, reviewer: 0.2 },
    },
  });
  const transition = await personalResolved.readPolicyTransition();
  assert.equal(transition?.enabled, true);
  assert.equal(transition?.roleSoftBudgetRatios?.reviewer, 0.2);
});

test("createAgentRuntime enforces live policy tighten/revoke, reviewer role ratio, and repeated-signature loop guard", async () => {
  const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project", AI_AGENT_MAX_INPUT_CHARACTERS: "32000" });
  const noopUsage = { reserve: async () => true, record: async () => {} };
  const scope = { userId: "user-1", childId: "child-1", workspaceId: "ws-1", authorizationVersion: "1", dataVersion: "1" };

  // 1. Mid-run policy revoke (enabled: false) before 2nd model turn aborts cleanly with unavailable.
  let policyRevoked = false;
  const toolExecs = { tighten: 0, loop: 0 };
  const stepTool = (onExec: () => void): AgentTool => ({
    name: "read_step",
    description: "Read a synthetic step.",
    parameters: z.object({ step: z.string() }),
    authorize: async () => true,
    execute: async () => {
      onExec();
      return { status: "succeeded", data: { ok: true } };
    },
  });
  const revokeRuntime = createAgentRuntime({
    config,
    usage: noopUsage,
    provider: {
      generate: async (_req, _signal) => ({
        content: { role: "model", parts: [{ functionCall: { id: "c1", name: "read_step", args: { step: "one" } } }] },
        finishReason: FinishReason.STOP,
      }),
    },
  });
  const revokeResult = await revokeRuntime.run({
    scope,
    recipeId: "p1-chat",
    trigger: { kind: "interactive", reference: "m1" },
    messages: [{ role: "user", text: "Test revoke" }],
    tools: [stepTool(() => { policyRevoked = true; })],
    authorize: async () => true,
    readPolicyTransition: async () => (policyRevoked ? { enabled: false } : null),
  });
  assert.equal(revokeResult.status, "stopped");
  assert.equal(revokeResult.stopReason, "unavailable");
  assert.equal(revokeResult.counts.modelCalls, 1);

  // 2. Mid-run policy tightening reduces maxModelCalls & softBudgetRatio without resetting counters.
  let tightenCalls = 0;
  const tightenRuntime = createAgentRuntime({
    config,
    usage: noopUsage,
    provider: {
      generate: async () => {
        tightenCalls += 1;
        return {
          content: {
            role: "model",
            parts: [{ functionCall: { id: `t-${tightenCalls}`, name: "read_step", args: { step: String(tightenCalls) } } }],
          },
          finishReason: FinishReason.STOP,
        };
      },
    },
  });
  let issuedTighten = false;
  const tightenResult = await tightenRuntime.run({
    scope,
    recipeId: "p1-chat",
    trigger: { kind: "interactive", reference: "m2" },
    messages: [{ role: "user", text: "Test tighten" }],
    tools: [stepTool(() => { toolExecs.tighten += 1; })],
    authorize: async () => true,
    readPolicyTransition: async () => {
      if (!issuedTighten && toolExecs.tighten >= 1) {
        issuedTighten = true;
        return { enabled: true, maxModelCalls: 1, maxToolCalls: 4, softBudgetRatio: 0.25 };
      }
      return null;
    },
  });
  assert.equal(tightenResult.status, "stopped");
  assert.equal(tightenResult.stopReason, "model_limit");
  assert.equal(tightenResult.counts.modelCalls, 1);
  assert.equal(tightenResult.counts.toolCalls, 1);

  // 3. Reviewer role inside finalize.completeText inherits reviewer soft ratio (admin override) rather than interactive default.
  const reviewInstructions: string[] = [];
  let reviewStep = 0;
  const reviewerRuntime = createAgentRuntime({
    config,
    usage: noopUsage,
    provider: {
      generate: async request => {
        reviewStep += 1;
        if (reviewStep === 1) {
          return { content: { role: "model", parts: [{ text: "Draft answer" }] }, finishReason: FinishReason.STOP };
        }
        reviewInstructions.push(String(request.config?.systemInstruction ?? ""));
        return { content: { role: "model", parts: [{ text: "Reviewed answer" }] }, finishReason: FinishReason.STOP };
      },
    },
  });
  const reviewed = await reviewerRuntime.run({
    scope,
    recipeId: "p1-chat",
    trigger: { kind: "interactive", reference: "m3" },
    messages: [{ role: "user", text: "Check reviewer budget" }],
    tools: [],
    roleSoftBudgetRatios: { reviewer: 0.15 },
    authorize: async () => true,
    finalize: async (res, context) => context.completeText!({
      system: "Review output",
      user: res.text ?? "",
      attemptKey: "review-1",
      purpose: "delivery_review",
    }),
  });
  assert.equal(reviewed.status, "completed");
  assert.equal(reviewed.text, "Reviewed answer");
  const marker = reviewInstructions[0]?.split("Server role budget:\n")[1];
  assert.ok(marker, "Expected Server role budget JSON in reviewer prompt");
  const parsedRoleBudget = JSON.parse(marker);
  assert.equal(parsedRoleBudget.budget.softBudgetRatio, 0.15);

  // 4. Identical tool signature repeated >= repeatedSignatureStreak stops loop early and alerts monitor.
  const loopAlerts: HighWatermarkAlert[] = [];
  const loopMonitor = createHighWatermarkMonitor({
    loadWindow: async () => [],
    persistWindow: async () => {},
  });
  const loopRuntime = createAgentRuntime({
    config,
    usage: noopUsage,
    highWatermarkMonitor: loopMonitor,
    onHighWatermarkAlert: alert => { loopAlerts.push(alert); },
    provider: {
      generate: async () => ({
        content: { role: "model", parts: [{ functionCall: { id: randomUUID(), name: "read_step", args: { step: "same" } } }] },
        finishReason: FinishReason.STOP,
      }),
    },
  });
  const loopResult = await loopRuntime.run({
    scope,
    recipeId: "p1-chat",
    trigger: { kind: "interactive", reference: "m4" },
    messages: [{ role: "user", text: "Loop forever" }],
    tools: [stepTool(() => { toolExecs.loop += 1; })],
    authorize: async () => true,
  });
  assert.equal(loopResult.status, "stopped");
  assert.equal(loopResult.stopReason, "tool_limit");
  assert.equal(toolExecs.loop, 2);
  assert.equal(loopAlerts.length, 1);
  assert.equal(loopAlerts[0]?.loopDetected, true);
  assert.equal(loopAlerts[0]?.recommendedAction, "stop_loop_early");
});

test("createFirestoreProductAgent persists HighWatermarkMonitor samples across runs and fires alert", async () => {
  const f = firestoreDomainFixture();
  function query(raw: any): any {
    return new Proxy(raw, {
      get(target, key) {
        if (key === "get") return () => f.database.runTransaction(tx => tx.get(target));
        const value = target[key];
        return typeof value === "function"
          ? (...args: any[]) => {
              const res = value(...args);
              return res?.query ? query(res) : res?.path ? { ...res, id: res.path.split("/").at(-1) } : res;
            }
          : value;
      },
    });
  }
  const database = { ...f.database, collection: (path: string) => query(f.database.collection(path)) } as Firestore;
  const options = {
    database,
    projectId: "synthetic-hwm",
    namespace: "hwm_prod",
    cipher: createStorageCipher(Buffer.alloc(32, 41)),
  };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({ email: "owner@example.test", expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
  await authority.admitIdentity({ userId: "owner", email: "owner@example.test", emailVerified: true });
  await authority.acknowledge({ userId: "owner", operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const { child } = await authority.createChild({ userId: "owner", displayName: "測試孩子", operationId: randomUUID() });

  const chat = createFirestoreChatStore(options);
  const care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({ ...options, chat, care });
  const online = createFirestoreOnlineStore({ ...options, mutations: [chat.mutation, care.mutation, memory.mutation] });
  const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: options.projectId });
  const admin = createFirestoreAdmin(options, config);
  const basePolicy = await admin.readPolicy();
  await admin.submit("admin-1", {
    opId: randomUUID(),
    kind: "policy",
    expectedVersion: basePolicy.version,
    values: {
      enabled: true,
      model: basePolicy.model,
      dailyUserAttempts: basePolicy.dailyUserAttempts,
      dailyGlobalAttempts: basePolicy.dailyGlobalAttempts,
      personalDailyGlobalAttempts: basePolicy.personalDailyGlobalAttempts,
      maxModelCalls: 1,
      maxQueryEmbeddings: 1,
    },
  });

  const alerts: HighWatermarkAlert[] = [];
  let callSeq = 0;
  const product = await createFirestoreProductAgent({
    ...options,
    chat,
    care,
    memory,
    online,
    config,
    onHighWatermarkAlert: alert => { alerts.push(alert); },
    platformProvider: {
      generate: async () => ({
        content: {
          role: "model",
          parts: [{
            functionCall: {
              id: `pa-${++callSeq}`,
              name: "present_answer",
              args: { kind: "clarification", paragraphs: [{ text: "寶寶幾個月大？", citationIds: [] }] },
            },
          }],
        },
        finishReason: FinishReason.STOP,
        usageMetadata: { promptTokenCount: 5, totalTokenCount: 10 },
      }),
    },
  });

  for (let i = 0; i < 3; i += 1) {
    const userMsg = await chat.createUserMessageForUser("owner", child.id, `Run ${i}`);
    assert.ok(userMsg);
    const res = await product.agent.reply("owner", child.id, userMsg.id, async () => true);
    assert.equal(res?.status, "completed", JSON.stringify(res));
    assert.equal(res?.counts.modelCalls, 1);
  }
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.triggered, true);
  assert.equal(alerts[0]?.consecutiveHighStreak, 3);
});

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SOFT_BUDGET_RATIO,
  ROLE_SOFT_BUDGET_PROFILES,
  deriveSoftBudgetTargets,
  resolveRoleSoftBudgetRatio,
  roundBudgetAllowance,
  roundConsumptionReserve,
} from "../src/shared/agent-run-limits.ts";
import { AgentBudget } from "../server/agent-budget.ts";
import { evaluateSustainedHighWatermark } from "../server/agent-high-watermark.ts";
import { resolvePersonalModelLimits } from "../server/personal-model-policy.ts";
import { platformPolicySchema } from "../src/shared/admin.ts";
import { effectiveModelLimitsSchema } from "../src/shared/model-settings-schema.ts";
import { PERSONAL_MODEL, type ModelSettings } from "../src/shared/model-settings.ts";
import { firestoreDomainFixture } from "./helpers/firestore-domain-memory.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { createFirestoreAuthority } from "../server/firestore-authority.ts";
import { createFirestoreAdmin } from "../server/firestore-admin.ts";
import { createFirestoreModelRouting } from "../server/firestore-model-routing.ts";
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

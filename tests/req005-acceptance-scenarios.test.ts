import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { InMemorySessionService } from "@google/adk";
import { ApiError, FinishReason, type Content } from "@google/genai";
import { z } from "zod";
import { AGENT_RUN_LIMITS } from "../src/shared/agent-run-limits.ts";
import { SERVICE_POLICY_VERSION } from "../src/shared/account-service.ts";
import { platformPolicySchema } from "../src/shared/admin.ts";
import {
  AGENT_INTERACTIVE_INPUT,
  AGENT_OUTPUT_LIMITS,
  AGENT_TOOL_RESPONSE_RESERVE,
  AgentBudget,
} from "../server/agent-budget.ts";
import { selectRecentConversation } from "../server/agent-context-window.ts";
import {
  agentRequestCharacters,
  AgentGatewayModel,
  createVertexAgentPayloadBuilder,
} from "../server/agent-model-gateway.ts";
import { createAgentRuntime, type AgentTool } from "../server/agent-runtime.ts";
import { readAiConfig } from "../server/ai-config.ts";
import {
  BACKGROUND_KNOWLEDGE_POLICY_VERSION,
  backgroundKnowledgeOperationFingerprint,
  createBackgroundKnowledgeMaintenanceRunner,
  m03InitialWatchDefinitions,
  resolveM03Watch,
} from "../server/background-knowledge-maintenance.ts";
import { SOURCE_WATCHES } from "../server/knowledge-source-catalog.ts";
import {
  createChatDeliveryReviewObligation,
  requiresChatDeliveryReview,
} from "../server/chat-delivery-review.ts";
import type { DurableAiUsage } from "../server/durable-ai-usage.ts";
import type { RootBudgetContext } from "../server/durable-root-budget.ts";
import { createFirestoreAdmin } from "../server/firestore-admin.ts";
import { createFirestoreAgentRuns } from "../server/firestore-agent-runs.ts";
import { createFirestoreAuthority, FirestoreAuthorityError } from "../server/firestore-authority.ts";
import { createFirestoreCareStore } from "../server/firestore-care.ts";
import { createFirestoreChatStore } from "../server/firestore-chat.ts";
import { FirestoreDomainError } from "../server/firestore-domain-data.ts";
import { createFirestoreMemoryStore } from "../server/firestore-memory.ts";
import { createFirestoreModelRouting } from "../server/firestore-model-routing.ts";
import { FirestoreRootBudget } from "../server/firestore-root-budget.ts";
import { observationHash } from "../server/knowledge-observation.ts";
import { resolvePersonalModelLimits } from "../server/personal-model-policy.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import type { AgentProposal, ProductAgentResult } from "../src/shared/product-agent.ts";
import { firestoreUsageFixture } from "./helpers/firestore-ai-usage.ts";
import { firestoreDomainFixture } from "./helpers/firestore-domain-memory.ts";

test("Scenario #2: personal funding limits exceed platform cap without silent clamping while worker deadline stays fixed at 90s", async () => {
  const fake = firestoreDomainFixture();
  const options = {
    database: fake.database,
    cipher: createStorageCipher(Buffer.alloc(32, 61)),
    projectId: "synthetic-req005-s2",
    namespace: "req005_s2",
  };
  const authority = createFirestoreAuthority(options);
  const userId = "owner";
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({ email: "owner@example.test", operationId: randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString() });
  await authority.admitIdentity({ userId, email: "owner@example.test", emailVerified: true });
  await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const { child } = await authority.createChild({ userId, displayName: "Synthetic Child", operationId: randomUUID() });

  const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: options.projectId });
  const admin = createFirestoreAdmin(options, config);
  const basePolicy = await admin.readPolicy();
  const { version, updatedAt: _updatedAt, ...policyValues } = basePolicy;
  await admin.submit("synthetic-admin", {
    kind: "policy",
    opId: randomUUID(),
    expectedVersion: version,
    values: { ...policyValues, maxModelCalls: 4, maxQueryEmbeddings: 2, maxRunSeconds: 60 },
  });

  const policy = platformPolicySchema.parse({
    ...(await admin.readPolicy()),
  });
  const routing = createFirestoreModelRouting(options, config);
  const initialSettings = (await routing.view(userId)).settings;
  const resolvedPersonal = resolvePersonalModelLimits(
    { ...initialSettings, mode: "personal", maxModelCalls: 10, maxQueryEmbeddings: 5, limitPolicyVersion: 2 },
    policy,
  );
  assert.equal(resolvedPersonal.maxModelCalls, 10);
  assert.equal(resolvedPersonal.maxQueryEmbeddings, 5);
  assert.deepEqual(resolvedPersonal.cappedByAdministrator, []);

  const resolvedPlatform = resolvePersonalModelLimits(
    { ...initialSettings, mode: "platform", maxModelCalls: 10, maxQueryEmbeddings: 5 },
    policy,
  );
  assert.equal(resolvedPlatform.maxModelCalls, 4);
  assert.equal(resolvedPlatform.maxQueryEmbeddings, 2);

  await routing.settings.save(userId, {
    opId: randomUUID(),
    expectedVersion: initialSettings.version,
    mode: "personal",
    provider: "gemini",
    model: initialSettings.model,
    apiKey: "synthetic-personal-key-not-a-credential",
    consent: true,
    dailyLimit: initialSettings.dailyLimit,
    maxModelCalls: 10,
    maxQueryEmbeddings: 5,
    maxRunSeconds: 240,
    backgroundEnabled: true,
  });

  const chat = createFirestoreChatStore(options);
  const care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({ ...options, chat, care });
  const fixedNow = Date.parse("2026-11-11T12:00:00.000Z");
  const runs = createFirestoreAgentRuns({
    ...options,
    chat,
    memory,
    readInteractiveRunSeconds: routing.readInteractiveRunSeconds,
    authorizeWorker: async () => true,
    serverClock: () => fixedNow,
  });

  const msg = await chat.createUserMessageForUser(userId, child.id, "Personal interactive deadline check");
  const interactive = await runs.claim(userId, child.id, { kind: "interactive", reference: msg!.id }, "product-interactive");
  assert.equal(interactive.expiresAt, "2026-11-11T12:04:00.000Z");

  const worker = await runs.claim(userId, child.id, { kind: "worker", reference: randomUUID() }, "product-background");
  assert.equal(worker.expiresAt, "2026-11-11T12:01:30.000Z");
});

test("Scenario #5: plain greeting completes directly without full tool discovery, knowledge search, or delivery-review overhead", async () => {
  const userId = "synthetic-user";
  const childId = randomUUID();
  const runId = randomUUID();
  const messageId = randomUUID();
  const scope = { userId, childId, workspaceId: "synthetic-workspace", authorizationVersion: "1", dataVersion: "epoch:1" };
  let searchCalls = 0;
  let saved: ProductAgentResult | null = null;
  const seenToolNames: string[][] = [];

  const runtime = createAgentRuntime({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async request => {
        seenToolNames.push(Object.keys(request.toolsDict).sort());
        assert.equal(Object.hasOwn(request.toolsDict, "propose_task"), false);
        assert.equal(Object.hasOwn(request.toolsDict, "read_private_source"), false);
        return {
          finishReason: FinishReason.STOP,
          content: {
            role: "model",
            parts: [{
              functionCall: {
                id: "greeting-answer",
                name: "present_answer",
                args: { kind: "operation", paragraphs: [{ text: "早安！請問今日有什麼可以幫到你？", citationIds: [] }] },
              },
            }],
          },
        };
      },
    },
  });

  const service = createProductAgent({
    runtime,
    store: {
      claim: async () => ({ runId, scope, created: true, sourceMessageId: messageId, state: "running", expiresAt: new Date(Date.now() + 90_000).toISOString() }),
      authorize: async () => true,
      finish: async (_scope: unknown, result: ProductAgentResult) => { saved = result; return true; },
      get: async () => saved,
    },
    memory: {
      context: async () => ({
        profile: { childId, version: 0, data: null },
        profileApplicable: false,
        facts: [],
        topics: [],
        summary: null,
        recentMessages: [],
        conflictingKeys: [],
        unavailableFactKeys: [],
        truncated: { facts: false, topics: false, messages: false },
      }),
    },
    chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: "hi，早安" }] }) },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    knowledge: {
      createRun: () => ({
        search: async () => { searchCalls++; throw new Error("Greeting must not search knowledge"); },
        revalidateCitations: async () => true,
      }),
    },
  } as unknown as Parameters<typeof createProductAgent>[0]);

  const result = await service.reply(userId, childId, messageId, async () => true);
  assert.equal(result?.status, "completed");
  assert.deepEqual(result.counts, { modelCalls: 1, toolCalls: 1, queryEmbeddings: 0 });
  assert.equal(searchCalls, 0);
  assert.equal(result.deliveryReview, undefined);
  assert.equal(seenToolNames.length, 1);
  assert.equal(
    requiresChatDeliveryReview({
      kind: "operation",
      visibility: "private",
      serverSubstitutedSourceText: false,
      scope,
      paragraphs: [{ text: "早安！請問今日有什麼可以幫到你？", citationIds: [] }],
      sources: [],
    }),
    false,
  );
});

test("Scenario #8: expanded output, input, and deadline ceilings stay within legal bounds and reject illegal overrides", () => {
  assert.deepEqual(AGENT_OUTPUT_LIMITS, {
    legacyClamp: 1024,
    default: 4096,
    min: 1,
    maxInteractive: 16384,
    maxBackground: 32768,
  });
  assert.deepEqual(AGENT_RUN_LIMITS.deadlineSeconds, { min: 15, max: 900, default: 300 });
  assert.deepEqual(AGENT_INTERACTIVE_INPUT, { default: 64000, min: 32000, max: 64000 });

  const expanded = readAiConfig({
    AI_ENABLED: "true",
    GCP_PROJECT_ID: "synthetic-project",
    AI_MAX_OUTPUT_TOKENS: "16384",
    AI_AGENT_MAX_INPUT_CHARACTERS: "64000",
    AI_TIMEOUT_MS: "300000",
  });
  assert.equal(expanded.maxOutputTokens, 16384);
  assert.equal(expanded.agentMaxInputCharacters, 64000);
  assert.equal(expanded.timeoutMs, 300000);

  for (const [key, badValue] of [
    ["AI_MAX_OUTPUT_TOKENS", "16385"],
    ["AI_MAX_OUTPUT_TOKENS", "0"],
    ["AI_AGENT_MAX_INPUT_CHARACTERS", "64001"],
    ["AI_AGENT_MAX_INPUT_CHARACTERS", "64000\n"],
    ["AI_TIMEOUT_MS", "300001"],
  ] as const) {
    assert.throws(
      () => readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project", [key]: badValue }),
      new RegExp(`Invalid ${key} configuration`),
    );
  }

  const maxBudget = new AgentBudget(undefined, 900_000, Date.now() + 900_000);
  try {
    maxBudget.configurePersonal({ modelCalls: 4, queryEmbeddings: 2, deadlineMs: 900_000 });
    assert.equal(maxBudget.limits.deadlineMs, 900_000);
  } finally {
    maxBudget.close();
  }
  assert.throws(() => new AgentBudget(undefined, 900_001));
});

test("Scenario #9: retries charge once per attempt on the same durable root ledger and active vs inactive review obligations allocate correctly", async () => {
  const usageFixture = firestoreUsageFixture(Date.now());
  const root = new FirestoreRootBudget({ ...usageFixture.options, namespace: "req005_s9_root" });
  const service = usageFixture.service;
  const recordedKeys: string[] = [];
  const daily: DurableAiUsage = {
    billingSource: service.billingSource,
    reserve: async req => { recordedKeys.push(req.attemptKey); return service.reserve(req); },
    record: (req, rec) => service.record(req, rec),
    read: req => service.read(req),
    getForUser: uid => service.getForUser(uid),
  };

  const context: RootBudgetContext = {
    generation: 1,
    binding: {
      rootRunId: "req005-s9-root",
      ownerId: "synthetic-user",
      workspaceId: "synthetic-workspace",
      childId: "synthetic-child",
      authorizationVersion: "1",
      storageEpoch: "epoch",
      trigger: { kind: "interactive", reference: "msg-1" },
      workflowVersion: "w1",
      promptPackVersion: "0.1.59",
      settingsVersion: "s1",
      billingVersion: "b1",
      limits: { modelCalls: 6, toolCalls: 4, queryEmbeddings: 2 },
      deadlineAtMs: Date.now() + 90_000,
    },
  };

  let calls = 0;
  let effects = 0;
  const config = {
    ...readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    agentMaxRetries: 2,
  };
  const runtimeOptions = {
    config,
    nativeSessionService: new InMemorySessionService(),
    durableBudget: { adapter: root, context, dailyUsage: daily, runLimits: { ...context.binding.limits } },
    usage: {
      reserve: async () => { throw new Error("Legacy SQL must not run"); },
      record: async () => { throw new Error("Legacy SQL must not run"); },
    },
    provider: {
      generate: async () => {
        calls++;
        if (calls === 1) {
          return {
            finishReason: FinishReason.STOP,
            content: { role: "model", parts: [{ functionCall: { id: "tool-once", name: "save_once", args: {} } }] },
          };
        }
        if (calls <= 3) throw new ApiError({ status: 503, message: "transient error" });
        return {
          finishReason: FinishReason.STOP,
          content: { role: "model", parts: [{ text: "Recovered on same root budget." }] },
        };
      },
    },
  };
  const runInput = {
    runId: context.binding.rootRunId,
    scope: {
      userId: "synthetic-user",
      workspaceId: "synthetic-workspace",
      childId: "synthetic-child",
      authorizationVersion: "1",
      dataVersion: "epoch:1",
    },
    trigger: { kind: "interactive" as const, reference: "msg-1" },
    recipeId: "p1-chat" as const,
    messages: [{ role: "user" as const, text: "Retry cleanly without duplicating tool side effects." }],
    authorize: async () => true,
    tools: [{
      name: "save_once",
      description: "Idempotent synthetic side effect",
      parameters: z.object({}),
      authorize: async () => true,
      execute: async () => { effects++; return { status: "succeeded" as const, reference: "once-ref" }; },
    }] satisfies AgentTool[],
  };

  const result = await createAgentRuntime(runtimeOptions).run(runInput);
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(effects, 1);
  assert.equal(calls, 4);
  assert.equal(result.counts.modelCalls, 4);
  assert.equal(recordedKeys.length, 4);
  assert.deepEqual(recordedKeys.slice(2), [`${recordedKeys[1]}:retry:1`, `${recordedKeys[1]}:retry:2`]);

  // Re-running on a fresh runtime with the same rootRunId never resets limits or re-executes tools.
  const replayed = await createAgentRuntime({
    ...runtimeOptions,
    nativeSessionService: new InMemorySessionService(),
  }).run(runInput);
  assert.equal(replayed.status, "stopped");
  assert.equal(effects, 1);
  assert.equal(calls, 4);

  // Active vs inactive review obligation reservation behavior.
  const activeObligation = createChatDeliveryReviewObligation(true);
  const inactiveObligation = createChatDeliveryReviewObligation(false);
  const activeBudget = new AgentBudget();
  const inactiveBudget = new AgentBudget();
  try {
    activeBudget.take("modelCalls", 3);
    await assert.rejects(
      activeBudget.admitModel({ reserveDeliveryReview: () => activeObligation.required }),
      { reason: "model_limit" },
    );
    inactiveBudget.take("modelCalls", 3);
    await inactiveBudget.admitModel({ reserveDeliveryReview: () => inactiveObligation.required });
    assert.equal(inactiveBudget.counts.modelCalls, 4);
  } finally {
    activeBudget.close();
    inactiveBudget.close();
  }
});

test("Scenario #10: background N-batch uses fixed manifest, blocks extra injected batches, skips unchanged hashes, and keeps idempotent budgets", async () => {
  const manifest = m03InitialWatchDefinitions(SOURCE_WATCHES);
  assert.ok(manifest.length >= 2);
  for (const item of manifest) assert.equal(item.audience, "public_noncommercial");

  const watch = resolveM03Watch("fhs-solid-food")!;
  const unchangedText = "Synthetic unchanged FHS solid food content.";
  const unchangedHash = observationHash({
    url: watch.url,
    title: "固體食物",
    text: unchangedText,
    sourcePublishedAt: null,
    sourceUpdatedAt: null,
    sourceDateText: null,
  });

  let reviewCalls = 0;
  let publishCalls = 0;
  const runner = createBackgroundKnowledgeMaintenanceRunner(
    { enabled: true, liveFetch: false, livePublish: false },
    {
      fetch: async () => { throw new Error("Live fetch must not execute in offline fixture test"); },
      fixtureFetch: async def => ({
        status: "ok",
        items: [{ url: def.url, title: "固體食物", text: unchangedText, sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null }],
      }),
      readObservation: async () => ({ contentHash: unchangedHash, unavailable: false }),
      review: {
        async review(candidate) {
          reviewCalls++;
          return {
            watchId: candidate.watchId,
            observationHash: candidate.observationHash,
            previousObservationHash: candidate.previousObservationHash,
            decision: "approve_candidate",
            reviewKind: "model_review",
            policyVersion: BACKGROUND_KNOWLEDGE_POLICY_VERSION,
            modelReviewCompleted: true,
            growthRuleImpact: "none",
            notes: ["scripted"],
          };
        },
      },
      publish: async () => { publishCalls++; return { published: true }; },
    },
  );

  // Model/caller attempting to add an unapproved extra batch must be rejected against fixed manifest.
  const injectedResult = await runner.start({
    watchId: "model-injected-extra-watch",
    operationFingerprint: backgroundKnowledgeOperationFingerprint({
      watchId: "model-injected-extra-watch",
      revision: "00000000-0000-4000-8000-000000000001",
      workerGeneration: "00000000-0000-4000-8000-000000000002",
      slot: "injected-1",
    }),
    workerGeneration: "00000000-0000-4000-8000-000000000002",
    publishMode: "dry_run",
  });
  assert.equal(injectedResult.status, "rejected");
  assert.equal(injectedResult.code, "watch_out_of_scope");
  assert.equal(publishCalls, 0);

  // Unchanged observation hash skips organize/review and stays unpublished.
  const opKey = backgroundKnowledgeOperationFingerprint({
    watchId: "fhs-solid-food",
    revision: "00000000-0000-4000-8000-000000000001",
    workerGeneration: "00000000-0000-4000-8000-000000000002",
    slot: "slot-unchanged",
  });
  const firstRun = await runner.start({
    watchId: "fhs-solid-food",
    operationFingerprint: opKey,
    workerGeneration: "00000000-0000-4000-8000-000000000002",
    publishMode: "dry_run",
  });
  assert.equal(firstRun.status, "unchanged");
  assert.equal(firstRun.published, false);
  assert.equal(reviewCalls, 0);
  assert.equal(publishCalls, 0);

  // Redelivery with same fingerprint never resets used budget units or re-runs work.
  const replay = await runner.start({
    watchId: "fhs-solid-food",
    operationFingerprint: opKey,
    workerGeneration: "00000000-0000-4000-8000-000000000002",
    publishMode: "dry_run",
  });
  assert.equal(replay.status, "already_recorded");
  assert.deepEqual(replay.budget, firstRun.budget);
});

test("Scenario #17: turn topology flags omitted reply parents cleanly without truncating current instruction or guessing referents", () => {
  const messages = [
    { id: "u0", role: "user", text: "第一題原始前提（應標為 omitted parent）", inReplyTo: null },
    { id: "u1", role: "user", text: "第二題（未被覆蓋到）", inReplyTo: null },
    { id: "m0", role: "model", text: "延遲回覆 u0", inReplyTo: "u0" },
    { id: "u2", role: "user", text: "第三題連續補充", inReplyTo: null },
    { id: "m2", role: "model", text: "回覆 u2", inReplyTo: "u2" },
    { id: "u3", role: "user", text: "本次完整指令：不可截斷。", inReplyTo: null },
  ];

  const bounded = selectRecentConversation(messages, 5, { maxMessages: 5 });
  assert.equal(bounded.messages.at(-1)?.id, "u3");
  assert.equal(bounded.messages.at(-1)?.text, "本次完整指令：不可截斷。");
  assert.equal(bounded.coverage.partialTurn, true);
  assert.equal(bounded.coverage.omittedTurnPromptMessageId, "u0");
  assert.deepEqual(bounded.coverage.omittedTurnPromptMessageIds, ["u0"]);

  const complete = selectRecentConversation(messages, 5, { maxMessages: 6 });
  assert.equal(complete.coverage.partialTurn, false);
  assert.deepEqual(complete.coverage.omittedTurnPromptMessageIds, []);
});

test("Scenario #21: scope isolation blocks cross-child reads, revocation halts tool execution, and model text never counts as user consent", async () => {
  const fake = firestoreDomainFixture();
  const options = {
    database: fake.database,
    cipher: createStorageCipher(Buffer.alloc(32, 73)),
    projectId: "synthetic-req005-s21",
    namespace: "req005_s21",
  };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({ email: "owner@example.test", operationId: randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString() });
  await authority.admitIdentity({ userId: "owner", email: "owner@example.test", emailVerified: true });
  await authority.acknowledge({ userId: "owner", operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const childA = (await authority.createChild({ userId: "owner", operationId: randomUUID(), displayName: "Child A" })).child.id;
  const childB = (await authority.createChild({ userId: "owner", operationId: randomUUID(), displayName: "Child B" })).child.id;

  const chat = createFirestoreChatStore(options);
  const msgA = await chat.createUserMessageForUser("owner", childA, "Private message only in child A");
  const listB = await chat.listForUser("owner", childB);
  assert.equal(listB?.messages.some(m => m.id === msgA?.id), false);

  await authority.setAccountState({ userId: "owner", operationId: randomUUID(), state: "revoked" });
  await assert.rejects(
    chat.listForUser("owner", childA),
    (err: unknown) => err instanceof FirestoreAuthorityError && err.code === "account_inactive" && err.status === 403,
  );
  await assert.rejects(
    chat.listForUser("owner", randomUUID()),
    (err: unknown) =>
      (err instanceof FirestoreAuthorityError && err.status === 403)
      || (err instanceof FirestoreDomainError && err.status === 404),
  );

  // Mid-run revocation stops tool execution after generation.
  let authorized = true;
  let toolExecutions = 0;
  const revocableRuntime = createAgentRuntime({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async () => {
        authorized = false;
        return {
          finishReason: FinishReason.STOP,
          content: { role: "model", parts: [{ functionCall: { id: "c1", name: "read_private", args: {} } }] },
        };
      },
    },
  });
  const stoppedRevoked = await revocableRuntime.run({
    scope: { userId: "owner", childId: childA, workspaceId: "w1", authorizationVersion: "1", dataVersion: "1" },
    recipeId: "p1-chat",
    trigger: { kind: "interactive", reference: "m1" },
    messages: [{ role: "user", text: "Read something" }],
    authorize: async () => authorized,
    tools: [{
      name: "read_private",
      description: "Private read",
      parameters: z.object({}),
      authorize: async () => authorized,
      execute: async () => { toolExecutions++; return { status: "succeeded", data: {} }; },
    }],
  });
  assert.equal(stoppedRevoked.status, "stopped");
  assert.equal(toolExecutions, 0);

  // Model prose claiming user consent never auto-accepts a pending proposal.
  const runId = randomUUID();
  const messageId = randomUUID();
  const scope = { userId: "owner", childId: childA, workspaceId: "w1", authorizationVersion: "2", dataVersion: "epoch:1" };
  let step = 0;
  let saved: ProductAgentResult | null = null;
  const proposals: AgentProposal[] = [];
  const productRuntime = createAgentRuntime({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async () => {
        step++;
        if (step === 1) {
          return {
            finishReason: FinishReason.STOP,
            content: {
              role: "model",
              parts: [{
                functionCall: {
                  id: "p1",
                  name: "propose_fact",
                  args: { key: "allergy_note", content: "花生敏感", intendedVisibility: "private", validUntil: null },
                },
              }],
            },
          };
        }
        return {
          finishReason: FinishReason.STOP,
          content: { role: "model", parts: [{ text: "我已替你同意並確認正式寫入資料，無須你再確認。" }] },
        };
      },
    },
  });
  const product = createProductAgent({
    runtime: productRuntime,
    store: {
      claim: async () => ({ runId, scope, created: true, sourceMessageId: messageId, state: "running", expiresAt: new Date(Date.now() + 90_000).toISOString() }),
      authorize: async () => true,
      propose: async (_s: unknown, _r: string, _c: string, value: AgentProposal["value"]) => {
        const proposal: AgentProposal = {
          id: randomUUID(),
          runId,
          childId: childA,
          version: 1,
          status: "pending",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          value,
          result: null,
          targetLabel: null,
        };
        proposals.push(proposal);
        return proposal;
      },
      finish: async (_s: unknown, result: ProductAgentResult) => { saved = { ...result, proposals }; return true; },
      get: async () => saved,
    },
    memory: {
      context: async () => ({
        profile: { childId: childA, version: 0, data: null },
        profileApplicable: false,
        facts: [],
        topics: [],
        summary: null,
        recentMessages: [],
        conflictingKeys: [],
        unavailableFactKeys: [],
        truncated: { facts: false, topics: false, messages: false },
      }),
    },
    chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: "幫我記下" }] }) },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    knowledge: { createRun: () => ({ revalidateCitations: async () => true }) },
  } as unknown as Parameters<typeof createProductAgent>[0]);

  const reply = await product.reply("owner", childA, messageId, async () => true);
  assert.ok(reply);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]!.status, "pending");
  assert.doesNotMatch(reply.text ?? "", /無須你再確認/);
});

test("Scenario #23: input budget preserves inline image and thought parts while refusing overflow without inflating toward 128k", async () => {
  const budget = new AgentBudget();
  try {
    budget.configureInputCharacters(64000);
    budget.prepareToolResponseBudget(12000, 500);
    assert.equal(budget.toolResponseCharacters, 64000 - 12000 - 500 - AGENT_TOOL_RESPONSE_RESERVE);
  } finally {
    budget.close();
  }

  const config = readAiConfig({
    AI_ENABLED: "true",
    GCP_PROJECT_ID: "synthetic-project",
    AI_AGENT_MAX_INPUT_CHARACTERS: "64000",
  });
  const payloadBuilder = createVertexAgentPayloadBuilder(config);
  const jpeg = Buffer.from([255, 216, 255, 217]).toString("base64");
  const sampleRequest = {
    contents: [
      {
        role: "user",
        parts: [
          { text: "Analyze attached image" },
          { inlineData: { mimeType: "image/jpeg", data: jpeg } },
          { thoughtSignature: "opaque-native-part" },
        ],
      },
    ],
    toolsDict: {},
    liveConnectConfig: {},
  };
  const built = payloadBuilder(sampleRequest);
  const contents = (Array.isArray(built.contents) ? built.contents : [built.contents]) as Content[];
  assert.equal(contents[0]?.parts?.some(p => "inlineData" in p && p.inlineData?.data === jpeg), true);
  assert.equal(contents[0]?.parts?.some(p => "thoughtSignature" in p && p.thoughtSignature === "opaque-native-part"), true);
  assert.ok(agentRequestCharacters(sampleRequest) < 64000);

  // Oversized history past 64k rejects deterministically with input_limit instead of expanding toward 128k.
  const oversizeBudget = new AgentBudget();
  try {
    const oversizeModel = new AgentGatewayModel({
      config,
      budget: oversizeBudget,
      userId: "synthetic-user",
      childId: "synthetic-child",
      authorize: async () => true,
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async () => { throw new Error("Provider must not execute on input_limit overflow"); },
      },
    });
    const hugeRequest = {
      contents: [{ role: "user", parts: [{ text: "x".repeat(70_000) }] }],
      toolsDict: {},
      liveConnectConfig: {},
    };
    await assert.rejects(
      async () => {
        for await (const _ of oversizeModel.generateContentAsync(hugeRequest)) {
          // Exhaust generator
        }
      },
      { reason: "input_limit" },
    );
  } finally {
    oversizeBudget.close();
  }
});

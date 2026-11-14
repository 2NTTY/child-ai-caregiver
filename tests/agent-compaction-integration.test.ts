import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createEvent, InMemorySessionService, type BaseContextCompactor, type CompactedEvent } from "@google/adk";
import { FinishReason } from "@google/genai";
import { z } from "zod";
import { AgentStopped, agentBudgetFingerprint } from "../server/agent-budget.ts";
import { loadAgentPrompt } from "../server/agent-prompt.ts";
import type { AgentModelProvider } from "../server/agent-model-gateway.ts";
import { createAgentRuntime, type AgentRunInput } from "../server/agent-runtime.ts";
import { readAiConfig } from "../server/ai-config.ts";
import type { DurableAiUsage, DurableAiUsageRequest } from "../server/durable-ai-usage.ts";
import type { RootBudgetContext } from "../server/durable-root-budget.ts";
import { FirestoreAiUsage } from "../server/firestore-ai-usage.ts";
import { FirestoreRootBudget } from "../server/firestore-root-budget.ts";
import type { InitialConversationSummary } from "../server/memory-summary.ts";
import { createProductAgent } from "../server/product-agent.ts";
import type { AgentProposal, ProductAgentResult } from "../src/shared/product-agent.ts";
import { firestoreUsageFixture } from "./helpers/firestore-ai-usage.ts";

const ids = {
  user: "synthetic-compaction-user",
  child: "11111111-1111-4111-8111-111111111111",
  run: "22222222-2222-4222-8222-222222222222",
  message: "33333333-3333-4333-8333-333333333333",
  proposal: "44444444-4444-4444-8444-444444444444",
  task: "55555555-5555-4555-8555-555555555555",
  doc: "66666666-6666-4666-8666-666666666666",
};

type AgentModelRequest = Parameters<AgentModelProvider["generate"]>[0];

function toolCount(request: AgentModelRequest): number {
  return (request.config?.tools ?? []).reduce((sum, entry) => {
    const declarations = "functionDeclarations" in entry ? entry.functionDeclarations : undefined;
    return sum + (declarations?.length ?? 0);
  }, 0);
}

async function advanceTimestamp() {
  const start = Date.now();
  while (Date.now() <= start) {
    await new Promise<void>(resolve => setTimeout(resolve, 2));
  }
}

async function durableCompactionFixture(options: { modelCalls: number }) {
  const f = firestoreUsageFixture(Date.now());
  const usageRequests: DurableAiUsageRequest[] = [];
  const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project", AI_DAILY_USER_ATTEMPTS: "20" });
  const prompt = await loadAgentPrompt("product-interactive", "tool_cycle", ["run", "scope", "conversation", "context", "evidence", "capabilities"]);
  const context: RootBudgetContext = {
    generation: 1,
    binding: {
      rootRunId: ids.run,
      ownerId: ids.user,
      workspaceId: "synthetic-workspace",
      childId: ids.child,
      authorizationVersion: "1",
      storageEpoch: "synthetic-epoch",
      trigger: { kind: "interactive", reference: ids.message },
      workflowVersion: "synthetic-workflow",
      promptPackVersion: prompt.packVersion,
      settingsVersion: "fixed-settings",
      billingVersion: "fixed-platform",
      limits: { modelCalls: options.modelCalls, toolCalls: 8, queryEmbeddings: 2 },
      deadlineAtMs: Date.now() + 90_000,
    },
  };
  const root = new FirestoreRootBudget({ ...f.options, namespace: "synthetic_compaction_root" });
  const usageService = new FirestoreAiUsage(f.options);
  const daily: DurableAiUsage = {
    billingSource: usageService.billingSource,
    reserve: async request => {
      usageRequests.push(structuredClone(request));
      return usageService.reserve(request);
    },
    record: (request, record) => usageService.record(request, record),
    read: request => usageService.read(request),
    getForUser: userId => usageService.getForUser(userId),
  };
  return { f, root, daily, usageRequests, config, context };
}

test("Scenario #26a: durable compaction charges the same root and daily ledger without leaking initial summary or crashing post-compaction keys", async () => {
  const s = await durableCompactionFixture({ modelCalls: 5 });
  const outgoingRequests: { hasTools: boolean; payload: string }[] = [];
  const secretInitialText = "SYNTHETIC_INITIAL_PRIVATE_SUMMARY_SECRET";
  const initialSummary: InitialConversationSummary = {
    summary: {
      id: "synthetic-initial-summary",
      version: 1,
      text: secretInitialText,
      createdAt: new Date().toISOString(),
      lastCoveredMessageId: ids.message,
    },
    basis: "a".repeat(64),
    validUntil: null,
  };
  let toolReads = 0;
  let reviewCalls = 0;
  const runtime = createAgentRuntime({
    config: s.config,
    nativeSessionService: new InMemorySessionService(),
    durableBudget: { adapter: s.root, context: s.context, dailyUsage: s.daily, runLimits: { ...s.context.binding.limits } },
    usage: {
      reserve: async () => { throw new Error("Legacy SQL quota must not be called"); },
      record: async () => { throw new Error("Legacy SQL usage must not be called"); },
    },
    provider: {
      generate: async outgoing => {
        const payload = JSON.stringify({ system: outgoing.config?.systemInstruction ?? "", contents: outgoing.contents });
        const hasTools = toolCount(outgoing) > 0;
        outgoingRequests.push({ hasTools, payload });
        const step = outgoingRequests.length;
        if (step === 1) {
          await advanceTimestamp();
          assert.equal(hasTools, true);
          assert.ok(payload.includes(secretInitialText), "First interactive turn should receive initial private summary");
          return {
            content: { role: "model", parts: [{ functionCall: { id: "fc-1", name: "read_context", args: {} } }] },
            finishReason: FinishReason.STOP,
            usageMetadata: { promptTokenCount: 180, totalTokenCount: 200, cachedContentTokenCount: 0 },
          };
        }
        if (step === 2) {
          assert.equal(hasTools, false, "Compaction call must never expose interactive tools");
          assert.equal(payload.includes(secretInitialText), false, "Compaction prompt must never leak initialConversationSummary");
          return {
            content: { role: "model", parts: [{ text: "COMPACTED_SYNTHETIC_HISTORY_TOKEN" }] },
            finishReason: FinishReason.STOP,
            usageMetadata: { promptTokenCount: 40, totalTokenCount: 55, cachedContentTokenCount: 0 },
          };
        }
        if (step === 3) {
          assert.equal(hasTools, true);
          assert.ok(payload.includes("COMPACTED_SYNTHETIC_HISTORY_TOKEN"), "Post-compaction turn must see compacted history");
          return {
            content: { role: "model", parts: [{ text: "Final post-compaction answer" }] },
            finishReason: FinishReason.STOP,
            usageMetadata: { promptTokenCount: 50, totalTokenCount: 70, cachedContentTokenCount: 0 },
          };
        }
        assert.equal(step, 4);
        assert.equal(hasTools, false);
        assert.ok(payload.includes("DELIVERY_REVIEW_SYSTEM"));
        return {
          content: { role: "model", parts: [{ text: "{\"decision\":\"pass\"}" }] },
          finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 30, totalTokenCount: 40, cachedContentTokenCount: 0 },
        };
      },
    },
  });

  const input: AgentRunInput = {
    runId: ids.run,
    deadlineAtMs: s.context.binding.deadlineAtMs,
    scope: { userId: ids.user, workspaceId: "synthetic-workspace", childId: ids.child, authorizationVersion: "1", dataVersion: "synthetic-epoch:1" },
    trigger: { kind: "interactive", reference: ids.message },
    recipeId: "product-interactive",
    availableInputs: ["run", "scope", "conversation", "context", "evidence", "capabilities"],
    requireDeliveryReview: true,
    initialConversationSummary: initialSummary,
    contextCompaction: { tokenThreshold: 100, eventRetentionSize: 1 },
    messages: [{ role: "user", text: "Synthetic question needing context read before reply." }],
    tools: [{
      name: "read_context",
      description: "Read synthetic context",
      parameters: z.object({}),
      authorize: async () => true,
      execute: async () => { await advanceTimestamp(); toolReads++; return { status: "succeeded", data: { note: "synthetic" } }; },
    }],
    authorize: async () => true,
    finalize: async (res, runContext, reason) => {
      assert.equal(reason, "normal");
      const verdict = await runContext.completeText!({
        system: "DELIVERY_REVIEW_SYSTEM",
        user: res.text ?? "",
        attemptKey: "model:delivery-review-test",
        purpose: "delivery_review",
      });
      reviewCalls++;
      return `${res.text} [${JSON.parse(verdict).decision}]`;
    },
  };

  const result = await runtime.run(input);
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.text, "Final post-compaction answer [pass]");
  assert.equal(toolReads, 1);
  assert.equal(reviewCalls, 1);
  assert.deepEqual(result.counts, { modelCalls: 4, toolCalls: 1, queryEmbeddings: 0 });
  assert.equal(outgoingRequests.length, 4);

  const snapshot = await s.root.read(s.context);
  assert.equal(snapshot.used.modelCalls, 4);
  assert.equal(snapshot.attempts.filter(a => a.kind === "model" && a.key.startsWith("compaction:")).length, 1, JSON.stringify(snapshot.attempts));
  assert.equal(snapshot.attempts.filter(a => a.kind === "model" && a.key.startsWith("model:")).length, 3, JSON.stringify(snapshot.attempts));
  assert.equal(snapshot.attempts.filter(a => a.kind === "tool_batch").length, 1, JSON.stringify(snapshot.attempts));
  const expectedCompactionKey = "compaction:" + agentBudgetFingerprint([ids.run, s.context.binding.trigger, "compaction", 1]);
  assert.ok(snapshot.attempts.some(a => a.key === expectedCompactionKey));

  const dailySummary = await s.daily.getForUser(ids.user);
  assert.equal(dailySummary.attempts, 4);
  assert.equal(dailySummary.inputTokens, 180 + 40 + 50 + 30);
  assert.equal(s.usageRequests.filter(req => req.attemptKey === expectedCompactionKey).length, 1);
});

test("Scenario #26b: reserveDeliveryReview blocks compaction from consuming the final reserved call so delivery review still succeeds", async () => {
  const s = await durableCompactionFixture({ modelCalls: 3 });
  let providerCalls = 0;
  let finalizeReason: string | null = null;
  let reviewSucceeded = false;

  const runtime = createAgentRuntime({
    config: s.config,
    nativeSessionService: new InMemorySessionService(),
    durableBudget: { adapter: s.root, context: s.context, dailyUsage: s.daily, runLimits: { ...s.context.binding.limits } },
    usage: {
      reserve: async () => { throw new Error("Legacy SQL quota must not be called"); },
      record: async () => { throw new Error("Legacy SQL usage must not be called"); },
    },
    provider: {
      generate: async outgoing => {
        providerCalls++;
        if (providerCalls === 1) {
          return {
            content: { role: "model", parts: [{ functionCall: { id: "fc-1", name: "read_context", args: {} } }] },
            finishReason: FinishReason.STOP,
            usageMetadata: { promptTokenCount: 20, totalTokenCount: 30, cachedContentTokenCount: 0 },
          };
        }
        if (providerCalls === 2) {
          return {
            content: { role: "model", parts: [{ functionCall: { id: "fc-2", name: "read_context", args: {} } }] },
            finishReason: FinishReason.STOP,
            usageMetadata: { promptTokenCount: 250, totalTokenCount: 270, cachedContentTokenCount: 0 },
          };
        }
        assert.equal(providerCalls, 3);
        const system = JSON.stringify(outgoing.config?.systemInstruction ?? "");
        assert.ok(system.includes("RESERVED_DELIVERY_REVIEW"), "Final reserved call must go to delivery_review, not compaction");
        return {
          content: { role: "model", parts: [{ text: "RESERVED_REVIEW_OK" }] },
          finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 25, totalTokenCount: 35, cachedContentTokenCount: 0 },
        };
      },
    },
  });

  const result = await runtime.run({
    runId: ids.run,
    deadlineAtMs: s.context.binding.deadlineAtMs,
    scope: { userId: ids.user, workspaceId: "synthetic-workspace", childId: ids.child, authorizationVersion: "1", dataVersion: "synthetic-epoch:1" },
    trigger: { kind: "interactive", reference: ids.message },
    recipeId: "product-interactive",
    availableInputs: ["run", "scope", "conversation", "context", "evidence", "capabilities"],
    requireDeliveryReview: true,
    finalizeOnModelLimit: true,
    contextCompaction: { tokenThreshold: 100, eventRetentionSize: 1 },
    messages: [{ role: "user", text: "Synthetic request checking reserved final delivery review protection." }],
    tools: [{
      name: "read_context",
      description: "Read synthetic context",
      parameters: z.object({}),
      authorize: async () => true,
      execute: async () => { await advanceTimestamp(); return { status: "succeeded", data: { step: providerCalls } }; },
    }],
    authorize: async () => true,
    finalize: async (_res, runContext, reason) => {
      finalizeReason = reason;
      const reviewText = await runContext.completeText!({
        system: "RESERVED_DELIVERY_REVIEW",
        user: "Verify pending reply",
        attemptKey: "model:reserved-review",
        purpose: "delivery_review",
      });
      reviewSucceeded = reviewText === "RESERVED_REVIEW_OK";
      return "Finalized with protected review";
    },
  });

  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(finalizeReason, "model_limit");
  assert.equal(reviewSucceeded, true);
  assert.equal(providerCalls, 3);
  assert.deepEqual(result.counts, { modelCalls: 3, toolCalls: 2, queryEmbeddings: 0 });
  const snapshot = await s.root.read(s.context);
  assert.equal(snapshot.used.modelCalls, 3);
  assert.equal(snapshot.attempts.some(a => a.key.startsWith("compaction:")), false);
});

function productCompactionFixture(options: { unknownConfirm?: boolean }) {
  const scope = { userId: ids.user, childId: ids.child, workspaceId: "synthetic-workspace", authorizationVersion: "1", dataVersion: "epoch:1" };
  let claimed = false;
  let saved: ProductAgentResult | null = null;
  let deleted = false;
  let revoked = false;
  let memoryWrites = 0;
  let taskWrites = 0;
  let proposalWrites = 0;
  let confirmationWrites = 0;
  const providerRequests: { hasTools: boolean; payload: string }[] = [];
  const proposals: AgentProposal[] = [];
  const now = new Date().toISOString();
  const task = {
    id: ids.task,
    childId: ids.child,
    version: 1,
    title: "Synthetic daily check",
    details: "Synthetic fixture",
    kind: "ordinary" as const,
    assigneeUserId: ids.user,
    createdBy: ids.user,
    createdAt: now,
    updatedAt: now,
    occurrence: {
      id: randomUUID(),
      dueAt: new Date(Date.now() + 3600_000).toISOString(),
      timeZone: "Asia/Hong_Kong",
      state: "scheduled" as const,
      terminalBasisVersion: null,
    },
  };

  const runtime = createAgentRuntime({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async request => {
        const hasTools = toolCount(request) > 0;
        const payload = JSON.stringify({ system: request.config?.systemInstruction ?? "", contents: request.contents });
        providerRequests.push({ hasTools, payload });
        const step = providerRequests.length;
        if (step === 1) {
          await advanceTimestamp();
          return {
            content: {
              role: "model",
              parts: [
                { functionCall: { id: "c-1", name: "read_context", args: {} } },
                { functionCall: { id: "c-2", name: "load_capabilities", args: { capabilities: ["tasks"] } } },
              ],
            },
            finishReason: FinishReason.STOP,
            usageMetadata: { promptTokenCount: 220, totalTokenCount: 250, cachedContentTokenCount: 0 },
          };
        }
        if (step === 2) {
          assert.equal(hasTools, false, "Compaction prompt must be tool-free");
          assert.equal(payload.includes("PRIVATE_PRODUCT_HISTORY_SEED"), false, "Compaction must never receive initialConversationSummary");
          return {
            content: { role: "model", parts: [{ text: "IN_RUN_COMPACTED_NOTES_NEVER_PROMOTE" }] },
            finishReason: FinishReason.STOP,
            usageMetadata: { promptTokenCount: 30, totalTokenCount: 45, cachedContentTokenCount: 0 },
          };
        }
        if (step === 3 && options.unknownConfirm) {
          return {
            content: {
              role: "model",
              parts: [
                { functionCall: { id: "c-3", name: "propose_task_change", args: { taskId: ids.task, expectedVersion: 1, action: "complete", note: "Complete check", dueAt: null, timeZone: null, assigneeUserId: null } } },
                { functionCall: { id: "c-4", name: "request_confirmation", args: { runId: ids.run, proposalId: ids.proposal, expectedVersion: 1, workId: null } } },
              ],
            },
            finishReason: FinishReason.STOP,
            usageMetadata: { promptTokenCount: 50, totalTokenCount: 65, cachedContentTokenCount: 0 },
          };
        }
        return {
          content: {
            role: "model",
            parts: [{
              functionCall: {
                id: "c-final",
                name: "present_answer",
                args: { kind: "operation", paragraphs: [{ text: "已查看目前安排。", citationIds: [] }] },
              },
            }],
          },
          finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 45, totalTokenCount: 60, cachedContentTokenCount: 0 },
        };
      },
    },
  });

  const wrappedRuntime = {
    run: (input: AgentRunInput) => runtime.run({
      ...input,
      tools: context => (typeof input.tools === "function" ? input.tools(context) : input.tools).map(tool => {
        if (tool.name === "load_capabilities") {
          return {
            ...tool,
            execute: async (...args: Parameters<typeof tool.execute>) => {
              // Ensure retained post-tool event timestamp strictly exceeds prior events for deterministic compaction.
              await advanceTimestamp();
              return tool.execute(...args);
            },
          };
        }
        if (tool.name !== "request_confirmation" || !options.unknownConfirm) return tool;
        return {
          ...tool,
          execute: async (...args: Parameters<typeof tool.execute>) => {
            await tool.execute(...args);
            throw new Error("Synthetic uncertain transport timeout");
          },
        };
      }),
    }),
  };

  const store = {
    claim: async () => {
      const created = !claimed;
      claimed = true;
      return { runId: ids.run, scope, created, state: saved?.status ?? "running", expiresAt: new Date(Date.now() + 90_000).toISOString() };
    },
    authorize: async () => !revoked,
    propose: async (_scope: unknown, _runId: string, _callId: string, value: AgentProposal["value"]) => {
      proposalWrites++;
      const proposal: AgentProposal = {
        id: ids.proposal,
        runId: ids.run,
        childId: ids.child,
        version: 1,
        status: "pending",
        createdAt: now,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        value,
        result: null,
        targetLabel: task.title,
      };
      proposals.push(proposal);
      return proposal;
    },
    requestConfirmation: async () => {
      confirmationWrites++;
      return {
        id: randomUUID(),
        proposalRunId: ids.run,
        proposalId: ids.proposal,
        proposalVersion: 1,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        question: "是否完成？",
      };
    },
    confirmationQuestions: async () => (proposals.length > 0 && confirmationWrites > 0 ? ["是否完成？"] : []),
    bindConfirmationQuestion: async () => true,
    finish: async (_scope: unknown, result: ProductAgentResult) => {
      saved = structuredClone({ ...result, proposals: structuredClone(proposals) });
      return true;
    },
    get: async () => {
      if (deleted && saved) return { ...structuredClone(saved), proposals: [] };
      return saved ? structuredClone(saved) : null;
    },
  };

  const service = createProductAgent({
    contextCompaction: { tokenThreshold: 80, eventRetentionSize: 1 },
    runtime: wrappedRuntime as unknown as Parameters<typeof createProductAgent>[0]["runtime"],
    store: store as unknown as Parameters<typeof createProductAgent>[0]["store"],
    chat: {
      listForUser: async () => ({ messages: [{ id: ids.message, childId: ids.child, authorUserId: ids.user, role: "user", text: "請幫我查看安排", inReplyTo: null, createdAt: now }] }),
    } as unknown as Parameters<typeof createProductAgent>[0]["chat"],
    memory: {
      context: async () => ({
        profile: { childId: ids.child, version: 0, data: null },
        profileApplicable: false,
        facts: [],
        topics: [],
        summary: null,
        recentMessages: [],
        conflictingKeys: [],
        unavailableFactKeys: [],
        truncated: { facts: false, topics: false, messages: false },
      }),
      initialConversationSummary: async () => ({
        summary: {
          id: "priv-sum-1",
          version: 1,
          text: "PRIVATE_PRODUCT_HISTORY_SEED",
          createdAt: now,
          lastCoveredMessageId: ids.message,
        },
        basis: "b".repeat(64),
        validUntil: null,
      }),
      prepareSummary: async () => { memoryWrites++; throw new Error("In-run compaction must never invoke formal memory summary writes"); },
      createFact: async () => { memoryWrites++; throw new Error("In-run compaction must never promote memory facts"); },
      updateFact: async () => { memoryWrites++; throw new Error("In-run compaction must never update memory facts"); },
    } as unknown as Parameters<typeof createProductAgent>[0]["memory"],
    tasks: {
      list: async () => ({ items: [task], eligibleAssignees: [{ userId: ids.user, name: "Synthetic" }], nextAfterId: null }),
      create: async () => { taskWrites++; throw new Error("Unexpected task create"); },
      change: async () => { taskWrites++; throw new Error("Unexpected task change"); },
    } as unknown as Parameters<typeof createProductAgent>[0]["tasks"],
    knowledge: { createRun: () => ({}) } as unknown as Parameters<typeof createProductAgent>[0]["knowledge"],
  });

  return {
    service,
    providerRequests,
    proposals,
    revoke: () => { revoked = true; },
    deleteRecords: () => { deleted = true; proposals.length = 0; },
    ledger: () => ({ memoryWrites, taskWrites, proposalWrites, confirmationWrites }),
  };
}

test("Scenario #22: createProductAgent multi-turn compaction isolates initial summary and never promotes compacted text to formal memory or tasks", async () => {
  const f = productCompactionFixture({ unknownConfirm: false });
  const result = await f.service.reply(ids.user, ids.child, ids.message, async () => true);
  assert.ok(result);
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.text, "已查看目前安排。");
  assert.equal(f.providerRequests.length, 3);
  assert.equal(f.providerRequests[1].hasTools, false);
  assert.ok(f.providerRequests[2].payload.includes("IN_RUN_COMPACTED_NOTES_NEVER_PROMOTE"));
  assert.deepEqual(f.ledger(), { memoryWrites: 0, taskWrites: 0, proposalWrites: 0, confirmationWrites: 0 });
});

test("Scenario #25: post-compaction unknown tool outcome stops safely and recovery after delete or revocation never replays or resurrects records", async () => {
  const f = productCompactionFixture({ unknownConfirm: true });
  const first = await f.service.reply(ids.user, ids.child, ids.message, async () => true);
  assert.ok(first);
  assert.equal(first.status, "stopped", JSON.stringify(first));
  assert.equal(first.stopReason, "tool_unknown", JSON.stringify(first));
  assert.equal(f.providerRequests.length, 3);
  assert.equal(f.ledger().proposalWrites, 1);
  assert.equal(f.ledger().confirmationWrites, 1);

  f.deleteRecords();
  const replayed = await f.service.reply(ids.user, ids.child, ids.message, async () => true);
  assert.ok(replayed);
  assert.equal(replayed.status, "stopped");
  assert.equal(replayed.stopReason, "tool_unknown");
  assert.deepEqual(replayed.proposals, []);
  f.revoke();
  const unauthorized = await f.service.reply(ids.user, ids.child, ids.message, async () => false);
  assert.equal(unauthorized, null, "Revoked scope must refuse recovery without returning stale content");
  assert.equal(f.providerRequests.length, 3, "Replay with same trigger/run must never re-invoke provider");
  assert.deepEqual(f.ledger(), { memoryWrites: 0, taskWrites: 0, proposalWrites: 1, confirmationWrites: 1 });
});

test("post-compaction modelAttemptKey skips system compacted events even when invocationId matches", async () => {
  const s = await durableCompactionFixture({ modelCalls: 4 });
  let step = 0;
  let injected = false;
  const customCompactor: BaseContextCompactor = {
    shouldCompact: ctx => !injected && ctx.session.events.some(event => Boolean(event.content?.parts?.some(part => part.functionResponse))),
    compact: async ctx => {
      injected = true;
      const compactedEvent: CompactedEvent = {
        ...createEvent({
          author: "system",
          invocationId: ctx.invocationId,
          content: { role: "model", parts: [{ text: "COMPACTED_SYSTEM_WITH_INVOCATION" }] },
        }),
        isCompacted: true,
        startTime: 0,
        endTime: 0,
        compactedContent: "COMPACTED_SYSTEM_WITH_INVOCATION",
      };
      ctx.session.events.push(compactedEvent);
    },
  };
  const runtime = createAgentRuntime({
    config: s.config,
    nativeSessionService: new InMemorySessionService(),
    durableBudget: { adapter: s.root, context: s.context, dailyUsage: s.daily, runLimits: { ...s.context.binding.limits } },
    usage: {
      reserve: async () => { throw new Error("Legacy SQL quota must not be called"); },
      record: async () => { throw new Error("Legacy SQL usage must not be called"); },
    },
    provider: {
      generate: async () => {
        step++;
        if (step === 1) {
          return {
            content: { role: "model", parts: [{ functionCall: { id: "fc-inv", name: "ping", args: {} } }] },
            finishReason: FinishReason.STOP,
            usageMetadata: { promptTokenCount: 30, totalTokenCount: 40, cachedContentTokenCount: 0 },
          };
        }
        return {
          content: { role: "model", parts: [{ text: "Completed after compacted system event" }] },
          finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 35, totalTokenCount: 45, cachedContentTokenCount: 0 },
        };
      },
    },
  });

  const result = await runtime.run({
    runId: ids.run,
    deadlineAtMs: s.context.binding.deadlineAtMs,
    scope: { userId: ids.user, workspaceId: "synthetic-workspace", childId: ids.child, authorizationVersion: "1", dataVersion: "synthetic-epoch:1" },
    trigger: { kind: "interactive", reference: ids.message },
    recipeId: "product-interactive",
    availableInputs: ["run", "scope", "conversation", "context", "evidence", "capabilities"],
    authorize: async () => true,
    contextCompactors: [customCompactor],
    messages: [{ role: "user", text: "Ping before compacted system event." }],
    tools: [{
      name: "ping",
      description: "Synthetic ping tool",
      parameters: z.object({}),
      authorize: async () => true,
      execute: async () => ({ status: "succeeded", data: { ok: true } }),
    }],
  });

  assert.equal(injected, true);
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.text, "Completed after compacted system event");
  assert.equal(step, 2);
});

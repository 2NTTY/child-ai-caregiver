import assert from "node:assert/strict";
import test from "node:test";
import { formatOtelMetadataSpan, sanitizeAgentTraceEvent, type AgentTraceEvent } from "../server/agent-trace.ts";
import { createAgentSourceTools } from "../server/agent-source-tools.ts";
import { createAgentRunTraceCollector } from "../server/agent-trace.ts";
import { AgentBudget } from "../server/agent-budget.ts";
import { AgentGatewayModel } from "../server/agent-model-gateway.ts";
import { readAiConfig } from "../server/ai-config.ts";

test("trace exporters drop unregistered metadata even when it looks like a valid code or slug", () => {
  const label = "synthetic_family_label";
  const raw = { runId: label, phase: "tool_rejection", role: "main_chat", elapsedMs: 0,
    tool: label, code: label, stopReason: label, recipeId: label,
    contextAssembly: { packVersion: "0.1.68", recipeId: "product-interactive", assemblyPolicyVersion: label,
      categories: [{ category: "summary", included: true, reasonCode: "included" },
        { category: "profile", included: true, reasonCode: "included", versionRefs: [{ kind: "profile", version: label }] }],
      capacity: {}, loaderCalls: {} },
  } as unknown as AgentTraceEvent;
  const event = sanitizeAgentTraceEvent(raw);
  assert.ok(event.contextAssembly);
  assert.ok(!JSON.stringify([event, formatOtelMetadataSpan(raw)]).includes(label));
  assert.equal(formatOtelMetadataSpan(event).attributes["yuban.run_id"], event.runId);
  const known = sanitizeAgentTraceEvent({ ...raw, recipeId: "product-interactive", tool: "read_private_source",
    code: "version_conflict", stopReason: "deadline" });
  assert.deepEqual([known.tool, known.code, known.stopReason, known.recipeId],
    ["read_private_source", "version_conflict", "deadline", "product-interactive"]);
});

test("a slow or failed usage record cannot hide the provider terminal or release the response", async () => {
  for (const providerSucceeded of [true, false]) {
    const budget = new AgentBudget(), events: AgentTraceEvent[] = [];
    let enter!: () => void, refuse!: (error: Error) => void;
    const recording = new Promise<void>(resolve => { enter = resolve; });
    const pending = new Promise<void>((_, reject) => { refuse = reject; });
    const model = new AgentGatewayModel({ budget, config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
      userId: "fixture", childId: "fixture", authorize: async () => true, onTrace: event => { events.push(event); },
      usage: { reserve: async () => true, record: async () => { enter(); await pending; } },
      provider: { generate: async () => {
        if (!providerSucceeded) throw new Error("scripted failure");
        return { content: { role: "model", parts: [{ text: "fixture" }] }, finishReason: "STOP" as never };
      } },
    });
    const result = model.completeText({ system: "fixture", user: "fixture", attemptKey: "attempt" });
    const rejected = assert.rejects(result);
    try {
      await recording;
      assert.deepEqual(events.map(event => event.phase), ["model_attempt_start", providerSucceeded ? "model_attempt_end" : "model_attempt_error"]);
      assert.equal(events[0]!.attemptKeyHash, events[1]!.attemptKeyHash);
    } finally { refuse(new Error("ledger unavailable")); await rejected; budget.close(); }
    assert.equal(events.length, 2);
  }
});

test("private originals mark the source milestone only after the version, consent and final grant checks", async () => {
  for (const variant of ["usable", "revoked", "version_changed", "no_consent"] as const) {
    const budget = new AgentBudget(), events: AgentTraceEvent[] = [];
    const trace = createAgentRunTraceCollector({ runId: "fixture", role: "main_chat", sinks: [e => { events.push(e); }] });
    const scope = { userId: "fixture-owner", childId: "fixture-child", workspaceId: "fixture-workspace", authorizationVersion: "1", dataVersion: "1" };
    const input = { id: "synthetic", version: 1, sha256: "a".repeat(64), text: "synthetic_private_excerpt",
      management: { enabled: variant !== "no_consent", modelExcerpt: "synthetic_private_excerpt" } };
    let authorized = true;
    const surface = createAgentSourceTools({ get: async () => { if (variant === "revoked") authorized = false; return input; } } as never,
      {} as never, { scope, runId: "test", budget, trace: trace.handle }, async () => authorized);
    const read = surface.tools.find(tool => tool.name === "read_private_source")!;
    try {
      const result = read.execute({ inputId: input.id, expectedVersion: variant === "version_changed" ? 2 : 1 }, { scope, runId: "test", callId: "one", signal: budget.signal });
      if (variant === "revoked") await assert.rejects(result, { reason: "unauthorized" });
      else assert.equal((await result).status, variant === "usable" ? "succeeded" : variant === "version_changed" ? "conflict" : "rejected");
      assert.equal(events.filter(e => e.phase === "source_usable").length, variant === "usable" ? 1 : 0);
      assert.ok(!JSON.stringify(events).includes(input.text));
    } finally { budget.close(); }
  }
});

test("an interrupted model attempt ends once before the outer root settles, even when the provider never returns", async () => {
  for (const reason of ["cancelled", "deadline"] as const) {
    const parent = new AbortController(), budget = new AgentBudget(parent.signal, reason === "deadline" ? 250 : 5000);
    const trace = createAgentRunTraceCollector({ runId: "test", role: "main_chat" });
    let records = 0, dispatches = 0, inner: Promise<string> | undefined;
    const model = new AgentGatewayModel({ budget, config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
      userId: "fixture", childId: "fixture", authorize: async () => true, onTrace: event => trace.emitGatewayEvent(event),
      usage: { reserve: async () => true, record: async () => { records++; } },
      provider: { generate: async () => {
        dispatches++;
        if (reason === "cancelled") parent.abort();
        return new Promise<never>(() => {});
      } },
    });
    try {
      try { await budget.wait(() => inner = model.completeText({ system: "fixture", user: "fixture", attemptKey: "test" })); }
      catch (error) { assert.equal((error as { reason: string }).reason, reason); }
      budget.close();
      trace.finalize({ status: "stopped", stopReason: reason, counts: budget.counts });
      await assert.rejects(inner!, { reason });
      const events = trace.events();
      assert.deepEqual(events.map(e => e.phase), ["model_attempt_start", "model_attempt_error", "run_end"]);
      assert.equal(events[1]!.stopReason, reason);
      assert.equal(events[0]!.attemptKeyHash, events[1]!.attemptKeyHash);
      assert.equal(events[2]!.terminalCategory, reason === "cancelled" ? "cancelled" : "failed");
      assert.equal(records, 1);
      assert.equal(dispatches, 1);
    } finally { budget.close(); }
  }
});

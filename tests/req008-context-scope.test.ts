import assert from "node:assert/strict";
import test from "node:test";
import { assembleTurnBackground } from "../server/agent-context-assembly.ts";
import { bindPersistentAgent } from "../server/persistent-agent-reply.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";
import { createProductAgent, type ProductAgent } from "../server/product-agent.ts";
import { discoverDailyNeeds } from "../server/daily-needs-discovery.ts";
import type { MemoryContext } from "../src/shared/memory.ts";
import type { GrowthPage } from "../src/shared/growth.ts";
import type { ConcernPage } from "../src/shared/concerns.ts";
import type { TaskPage } from "../src/shared/tasks.ts";

const scope = { userId: "u1", childId: "c1", workspaceId: "w1", authorizationVersion: "1", dataVersion: "1" };
const text = "開始加固食糊仔要留意咩？";
const now = new Date("2026-10-08T00:00:00Z");
const defaultRow = {
  status: "confirmed", sourceState: "current", visibility: "private", applicable: true, confirmedBy: "u1",
  confirmedAt: "2026-09-01T00:00:00Z", validUntil: null, childId: "c1", version: 1,
};
const facts = [
  { ...defaultRow, key: "Allergy", id: "f1", content: "甲過敏" },
  { ...defaultRow, key: "ALLERGY", id: "f2", content: "乙過敏" },
  { ...defaultRow, key: "餐單", id: "f3", content: "加固食糊仔" },
];
const profile = { childId: "other", version: 2, data: { region: "Foreign region", age: { kind: "birth_date", date: "2026-04-08" } } };
function memory(profileApplicable: boolean, row = profile) {
  return { context: async () => ({ profileApplicable, profile: row, facts, conflictingKeys: ["allergy"],
    truncated: { facts: false, topics: false, messages: false } } as unknown as MemoryContext) };
}
test("only current-child rows and unambiguous facts enter a turn; past profile data is not projected", async () => {
  for (const [applicable, row] of [[true, profile], [false, { ...profile, childId: "c1" }]] as const) {
    const result = await assembleTurnBackground({ scope, userText: text, mode: "assistant", now, authorize: async () => true,
      memory: memory(applicable, row), includeTasks: true,
      growth: { list: async () => ({ topics: [], items: ["other", "c1"].map(childId => ({ id: childId, childId, topicId: "solid_food", state: "proposed" })) } as unknown as GrowthPage) },
      concerns: { list: async () => ({ items: ["other", "c1"].map(childId => ({ id: childId, childId, title: "加固", status: "following" })) } as unknown as ConcernPage) },
      tasks: { list: async () => ({ items: ["other", "c1"].map(childId => ({ id: childId, childId, title: "task", occurrence: { state: "scheduled" } })) } as unknown as TaskPage) },
    });
    assert.equal(result.childProfile.region, null);
    assert.equal(result.childProfile.ageMonthsMin, null);
    assert.deepEqual(result.relevantFacts.items.map(x => x.id), ["f3"]);
    assert.deepEqual(result.activeFocus.growthItems.map(x => x.id), ["c1"]);
    assert.deepEqual(result.activeFocus.openConcerns.map(x => x.id), ["c1"]);
    assert.deepEqual(result.tasks.items.map(x => x.id), ["c1"]);
    assert.equal(discoverDailyNeeds({ background: result, userText: text }).signals.some(x => x.kind === "known_constraint_reminder"), false);
  }
});

test("late loss of authorization invalidates all assembled sections", async () => {
  let live = true;
  const result = await assembleTurnBackground({ scope, userText: text, mode: "assistant", now,
    authorize: async () => live, memory: memory(true, { ...profile, childId: "c1" }),
    concerns: { list: async () => { live = false; return { items: [] } as unknown as ConcernPage; } },
  });
  for (const key of ["childProfile", "relevantFacts", "activeFocus", "tasks"] as const) assert.equal(result[key].status, "invalidated");
  assert.deepEqual(result.relevantFacts.items, []);
  assert.equal(result.childProfile.region, null);
});

test("persistent composition refuses ephemeral before delegation and forwards ordinary reply arguments", async () => {
  const seen: Parameters<ProductAgent["reply"]>[] = [];
  const core = { reply: async (...args: Parameters<ProductAgent["reply"]>) => { seen.push(args); return null; } };
  const agent = bindPersistentAgent(core as ProductAgent);
  const base = ["u1", "c1", "m1", async () => true] as const;
  assert.equal(await agent.reply(...base, undefined, undefined, { conversationMode: "ephemeral" }), null);
  assert.equal(seen.length, 0);
  await agent.reply(...base);
  await agent.reply(...base, undefined, undefined, { conversationMode: "chat_only" });
  assert.deepEqual(seen, [[...base], [...base, undefined, undefined, { conversationMode: "chat_only" }]]);
});

test("only selected, applicable sources bound the preloaded context lifetime", async () => {
  const cutoff = "2026-10-08T00:02:00Z";
  for (const validUntil of [cutoff, null]) {
    const context = await memory(true, { ...profile, childId: "c1" }).context();
    const result = await assembleTurnBackground({ scope, mode: "assistant", userText: text, now, authorize: async () => true,
      memory: { context: async () => ({
        ...context,
        profile: { ...context.profile, data: { ...context.profile.data!, validUntil: "2026-10-08" } },
        facts: context.facts.map(x => ({ ...x, validUntil: x.id === "f3" ? validUntil : "2026-10-08T00:01:00Z" })),
      }) },
    });
    assert.equal(result.sourceDeadlineMs, Date.parse(validUntil ?? "2026-10-08T16:00:00Z"));
    assert.equal("sourceDeadlineMs" in result.assemblyMetadata, false);
  }
});


test("product reply checks the preloaded source lifetime and only an assistant turn may consume a confirmation", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: now.getTime() });
  const input = (await memory(true, { ...profile, childId: "c1" }).context());
  const done = new Error("synthetic turn boundary");
  let consumes = 0, runs = 0;
  type Options = Parameters<typeof createProductAgent>[0];
  const store = {
    consumeConfirmation: async () => { consumes++; return null; },
    claim: async () => ({ runId: "run", scope, created: true, expiresAt: new Date(now.getTime() + 60000).toISOString() }),
    authorize: async () => true,
  };
  const runtime: Pick<Options["runtime"], "run"> = { run: async run => {
    runs++;
    assert.equal(await run.authorize!(), true);
    t.mock.timers.setTime(now.getTime() + 1000);
    assert.equal(await run.authorize!(), false);
    throw done; // No model/tool/store finish is called.
  } };
  const core = createProductAgent({
    runtime, store,
    memory: { context: async () => ({ ...input, facts: input.facts.map(f => ({
      ...f, validUntil: new Date(now.getTime() + 1000).toISOString(),
    })) }) },
    chat: { listForUser: async () => ({ messages: [{ id: "m1", role: "user", text }] }) },
  } as unknown as Options);
  const persisted = bindPersistentAgent(core);
  for (const mode of ["chat_only", "assistant"] as const) {
    t.mock.timers.setTime(now.getTime());
    await assert.rejects(persisted.reply("u1", "c1", "m1", async () => true, undefined, undefined,
      { conversationMode: mode }), error => error === done);
    assert.equal(consumes, mode === "assistant" ? 1 : 0);
  }
  assert.equal(runs, 2);
});

test("source expiry during receipt reconciliation or readback withholds the answer, not the original action ledger", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: now.getTime() });
  const context = await memory(true, { ...profile, childId: "c1" }).context();
  const deadline = now.getTime() + 1000;
  const receipt = { id: "verified-receipt", kind: "save_record" };
  const knownTool = { name: "save_ordinary_record", status: "succeeded", reference: receipt.id } as const;
  const counts = { modelCalls: 1, toolCalls: 1, queryEmbeddings: 0 };
  for (const phase of ["reconcile", "readback", "reconcile-fallback", "live"] as const) {
    t.mock.timers.setTime(now.getTime());
    const saved: { value?: ProductAgentResult } = {};
    let executions = 0;
    const core = createProductAgent({
      memory: { context: async () => ({ ...context, facts: context.facts.map(f => ({ ...f, validUntil: new Date(deadline).toISOString() })) }) },
      chat: { listForUser: async () => ({ messages: [{ id: "m1", role: "user", text }] }) },
      runtime: { run: async () => { executions++; return { runId: "run", status: "completed", tools: [], counts }; } },
      actions: { policy: async () => null, receipts: async () => {
        if (phase === "reconcile") t.mock.timers.setTime(deadline);
        return [receipt];
      } },
      store: {
        claim: async () => ({ runId: "run", scope, created: true, expiresAt: new Date(now.getTime() + 60000).toISOString() }),
        authorize: async () => true,
        finish: async (_scope: unknown, result: ProductAgentResult, draft: unknown) => {
          saved.value = result;
          assert.equal(draft, undefined);
          return phase !== "reconcile-fallback";
        },
        readCancelled: async () => null,
        get: async () => {
          const stored = saved.value;
          assert.ok(stored);
          if (phase === "readback" || phase === "reconcile-fallback") t.mock.timers.setTime(deadline);
          return stored.status === "completed" ? {
            ...stored, text: "synthetic private answer", privateSourceCitations: [{ id: "private-source" }],
            deliveryReview: { draftHash: "private-review" }, tools: [knownTool, { name: "read_context", status: "succeeded", reference: "private-source" }],
          } : { ...stored, tools: [knownTool] };
        },
      },
    } as unknown as Parameters<typeof createProductAgent>[0]);
    const result = await core.reply("u1", "c1", "m1", async () => true);
    assert.equal(executions, 1);
    assert.equal(saved.value?.status, phase === "reconcile" ? "stopped" : "completed");
    assert.deepEqual(result?.counts, counts);
    if (phase === "live") {
      assert.equal(result?.status, "completed");
      assert.equal(result?.text, "synthetic private answer");
    } else {
      assert.equal(result?.status, "stopped");
      assert.equal(result?.stopReason, "source_changed");
      assert.equal(JSON.stringify(result).includes("synthetic private answer"), false);
      assert.equal(JSON.stringify(result).includes("private-source"), false);
      assert.equal(result?.deliveryReview, undefined);
      assert.deepEqual(result?.privateSourceCitations, []);
      assert.deepEqual(result?.tools, [knownTool]);
    }
  }
});

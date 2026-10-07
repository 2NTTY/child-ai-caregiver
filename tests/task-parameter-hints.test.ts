import assert from "node:assert/strict";
import test from "node:test";
import { FinishReason } from "@google/genai";
import type { LlmResponse } from "@google/adk";
import { z } from "zod";
import { taskValuesSchema } from "../src/shared/tasks.ts";
import { taskParameterHints } from "../server/task-parameter-hints.ts";
import { createAgentRuntime, type AgentTool } from "../server/agent-runtime.ts";
import { createProductAgentTools } from "../server/product-agent-tools.ts";
import { AgentBudget } from "../server/agent-budget.ts";
import { readAiConfig } from "../server/ai-config.ts";

const schema = z.object({ values: taskValuesSchema }).strict();
const valid = { values: { title: "Synthetic task", details: "", kind: "ordinary", assigneeUserId: "synthetic-user",
  dueAt: "2026-10-08T09:00:00+08:00", timeZone: "Asia/Hong_Kong" } };
const secret = "SYNTHETIC_SECRET_NEVER_REFLECT";
const scope = { userId: "synthetic-user", childId: "synthetic-child", workspaceId: "synthetic-workspace", authorizationVersion: "1", dataVersion: "1" };
const cases = [
  ["valid", valid, true, null],
  ["missing wrapper", valid.values, false, "values"],
  ["wrong wrapper", { task: valid.values }, false, "values"],
  ["missing details", { values: { ...valid.values, details: undefined } }, false, "values.details"],
  ["missing assignee", { values: { ...valid.values, assigneeUserId: undefined } }, false, "values.assigneeUserId"],
  ["date only", { values: { ...valid.values, dueAt: "2026-10-08" } }, false, "values.dueAt"],
  ["local time without offset", { values: { ...valid.values, dueAt: "2026-10-08T09:00:00" } }, false, "values.dueAt"],
  ["invalid kind", { values: { ...valid.values, kind: secret } }, false, "values.kind"],
  ["unknown root key", { ...valid, [secret]: secret }, false, "$"],
  ["unknown nested key", { values: { ...valid.values, [secret]: secret } }, false, "values"],
  ["invalid time zone", { values: { ...valid.values, timeZone: secret } }, false, "values.timeZone"],
  ["blank title", { values: { ...valid.values, title: " " } }, false, "values.title"],
  ["date below allowed range", { values: { ...valid.values, dueAt: "1999-12-31T23:59:59Z" } }, false, "values.dueAt"],
  ["UTC Z time", { values: { ...valid.values, dueAt: "2026-10-08T01:00:00Z" } }, true, null],
] as const;

async function runOnce(args: Record<string, unknown>, options: {
  hints?: boolean; authorize?: boolean; response?: { status: "rejected" | "unknown"; data?: Record<string, unknown> };
} = {}) {
  let providerCalls = 0, executed = 0, authorized = 0;
  let response: Record<string, unknown> | undefined;
  const diagnostics: unknown[] = [], usage: unknown[] = [];
  const tool: AgentTool = { name: "propose_task", description: "Synthetic task proposal validation.", parameters: schema,
    ...(options.hints === false ? {} : { parameterErrorHints: taskParameterHints }),
    authorize: async () => { authorized++; return options.authorize !== false; },
    execute: async () => { executed++; return options.response ?? { status: "succeeded" }; } };
  const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    diagnostics: event => { diagnostics.push(event); }, usage: { reserve: async () => true, record: async record => { usage.push(record); } },
    provider: { generate: async request => {
      if (providerCalls++ === 0) return { finishReason: FinishReason.STOP,
        content: { role: "model", parts: [{ functionCall: { id: "synthetic-call", name: tool.name, args } }] } };
      response = request.contents.flatMap(content => content.parts ?? []).find(part => part.functionResponse?.id === "synthetic-call")?.functionResponse?.response;
      return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{ text: "Synthetic completion." }] } } satisfies LlmResponse;
    } } });
  const result = await runtime.run({ scope, recipeId: "p1-chat", trigger: { kind: "interactive", reference: "synthetic-message" },
    messages: [{ role: "user", text: "Synthetic task validation." }], tools: [tool], authorize: async () => true });
  return { result, response, executed, authorized, providerCalls, diagnostics, usage };
}

test("fourteen synthetic task shapes preserve validation and reject before authorization or execution", async () => {
  for (const [name, args, accepted, expectedPath] of cases) {
    assert.equal(schema.safeParse(args).success, accepted, name);
    const run = await runOnce(args);
    assert.equal(run.result.status, "completed", name);
    assert.equal(run.executed, accepted ? 1 : 0, name);
    assert.equal(run.authorized, accepted ? 1 : 0, name);
    assert.equal(run.providerCalls, 2, name);
    if (!accepted) {
      const data = run.response?.data as { code: string; nextAction: string; hints: { path: string; reason: string; expected: string }[] };
      assert.equal(data.code, "invalid_parameters", name);
      assert.match(data.nextAction, /No operation was executed/u);
      assert.ok(data.hints.some(hint => hint.path === expectedPath), name);
      assert.ok(data.hints.length <= 3); assert.ok(JSON.stringify(data.hints).length <= 512);
      assert.doesNotMatch(JSON.stringify([run.response, run.result, run.diagnostics, run.usage]), new RegExp(secret, "u"), name);
    }
  }
});

test("only propose_task registers field hints in the product tool set", () => {
  const budget = new AgentBudget();
  try {
    const tools = createProductAgentTools({ run: { scope, runId: "synthetic-run", budget },
      knowledge: { createRun: () => ({}) }, authorize: async () => true,
    } as unknown as Parameters<typeof createProductAgentTools>[0]).tools;
    assert.deepEqual(tools.filter(tool => tool.parameterErrorHints).map(tool => tool.name), ["propose_task"]);
    assert.equal(tools.find(tool => tool.name === "propose_task")?.parameterErrorHints, taskParameterHints);
  } finally { budget.close(); }
});

test("hints never read messages, values or unknown keys and never copy dynamic paths", () => {
  const issue = { code: "unrecognized_keys", path: ["values"] };
  for (const key of ["message", "input", "keys"]) Object.defineProperty(issue, key, { get() { assert.fail(`Must not read ${key}`); } });
  const hints = taskParameterHints([issue as z.core.$ZodIssue]);
  assert.deepEqual(hints, [{ path: "values", reason: "undeclared_fields", expected: "object with all declared task fields" }]);
  for (const path of [[secret], ["values", secret], ["values", "title", secret], ["values", { toString() { assert.fail("Must not stringify a path segment"); } }]]) {
    assert.deepEqual(taskParameterHints([{ code: "custom", path, message: secret, input: secret } as z.core.$ZodIssue]), []);
  }
});

test("hints use fixed reasons for known refinements and preserve exact contract boundaries", () => {
  const mutations = [
    ["title", " ", "invalid_value"], ["timeZone", secret, "invalid_value"],
    ["dueAt", "1999-12-31T23:59:59Z", "out_of_range"], ["dueAt", "2101-01-01T00:00:00Z", "out_of_range"],
    ["dueAt", "2026-10-08T09:00:00", "invalid_format"], ["title", "x".repeat(161), "out_of_range"],
    ["details", "x".repeat(2001), "out_of_range"], ["assigneeUserId", "x".repeat(129), "out_of_range"],
    ["timeZone", "x".repeat(101), "out_of_range"],
  ] as const;
  for (const [field, value, reason] of mutations) {
    const parsed = schema.safeParse({ values: { ...valid.values, [field]: value } });
    assert.equal(parsed.success, false);
    if (!parsed.success) assert.ok(taskParameterHints(parsed.error.issues).some(hint => hint.path === `values.${field}` && hint.reason === reason));
  }
  for (const dueAt of ["2000-01-01T00:00:00Z", "2100-12-31T23:59:59Z"]) assert.equal(schema.safeParse({ values: { ...valid.values, dueAt } }).success, true);
});

test("hints are deduplicated, complete and bounded to three entries and 512 JSON characters", () => {
  const issue = (path: string[], code: string) => ({ path, code, message: secret }) as z.core.$ZodIssue;
  const hints = taskParameterHints([
    issue(["values", "dueAt"], "invalid_format"), issue(["values", "dueAt"], "custom"),
    issue(["values", "dueAt"], "too_big"), issue(["values", "timeZone"], "custom"),
    issue(["values", "title"], "custom"), issue(["values", "kind"], "invalid_value"),
  ]);
  assert.equal(hints.length, 3); assert.ok(JSON.stringify(hints).length <= 512);
  assert.deepEqual(JSON.parse(JSON.stringify(hints)), hints);
  assert.equal(hints.filter(hint => hint.path === "values.dueAt" && hint.reason === "out_of_range").length, 1);
  assert.ok(hints.every(hint => !hint.expected.endsWith("…")));
  assert.doesNotMatch(JSON.stringify(hints), new RegExp(secret, "u"));
});

test("unregistered tools keep generic feedback and authorization or handler outcomes never gain hints", async () => {
  const generic = await runOnce({ values: {} }, { hints: false });
  assert.equal((generic.response?.data as any)?.code, "invalid_parameters");
  assert.equal(Object.hasOwn(generic.response?.data as object, "hints"), false);
  const denied = await runOnce(valid, { authorize: false });
  assert.equal((denied.response?.data as any)?.code, "not_authorized"); assert.equal(denied.executed, 0);
  assert.equal(Object.hasOwn(denied.response?.data as object, "hints"), false);
  const business = await runOnce(valid, { response: { status: "rejected", data: { code: "invalid_input" } } });
  assert.deepEqual(business.response, { status: "rejected", data: { code: "invalid_input" } }); assert.equal(business.executed, 1);
  const unknown = await runOnce(valid, { response: { status: "unknown" } });
  assert.equal(unknown.result.stopReason, "tool_unknown"); assert.equal(unknown.providerCalls, 1); assert.equal(unknown.executed, 1);
});

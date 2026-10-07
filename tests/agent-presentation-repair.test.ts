import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { InMemorySessionService } from "@google/adk";
import type { LlmRequest, LlmResponse } from "@google/adk";
import { FinishReason, GoogleGenAI, FunctionCallingConfigMode, Type } from "@google/genai";
import type { GoogleGenAIOptions } from "@google/genai";
import { z } from "zod";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import type { AgentRunInput, AgentTool } from "../server/agent-runtime.ts";
import type { AgentDiagnostic } from "../server/agent-observer.ts";
import { AgentStopped } from "../server/agent-budget.ts";
import { PRESENTATION_REPAIR_MESSAGE } from "../server/agent-presentation-repair.ts";
import { readAiConfig } from "../server/ai-config.ts";

const natural = (text = "Unvalidated synthetic final"): LlmResponse => ({ finishReason: FinishReason.STOP,
  content: { role: "model", parts: [{ text: "Synthetic thought", thought: true, thoughtSignature: "opaque-thought" },
    { text, thoughtSignature: "opaque-final" }] } });
const call = (name: string, args: Record<string, unknown> = {}): LlmResponse => ({ finishReason: FinishReason.STOP,
  content: { role: "model", parts: [{ functionCall: { id: `call-${name}`, name, args }, thoughtSignature: "opaque-call" }] } });
const present = () => call("present_answer", { text: "Validated synthetic presentation" });

function setup(generate: (request: LlmRequest, index: number, signal: AbortSignal) => LlmResponse | Promise<LlmResponse>) {
  let accepted = false, writes = 0, reads = 0, finalized = 0, reserved = 0, authorized = true, quota = true;
  const requests: LlmRequest[] = [], events: AgentDiagnostic[] = [];
  const terminal: AgentTool = { name: "present_answer", terminal: true, description: "Validate a synthetic presentation.",
    parameters: z.object({ text: z.string().min(1) }), authorize: async () => true,
    execute: async () => { accepted = true; return { status: "succeeded", data: { acceptedForValidation: true } }; } };
  const write: AgentTool = { name: "propose_task", description: "Save one unconfirmed synthetic candidate.",
    parameters: z.object({ value: z.string() }), authorize: async () => true,
    execute: async () => { writes++; return { status: "succeeded", reference: "pending-candidate", data: { pending: true } }; } };
  const read: AgentTool = { name: "read_context", description: "Read synthetic context.", parameters: z.object({}), authorize: async () => true,
    execute: async () => { reads++; return { status: "succeeded", data: { synthetic: true } }; } };
  let onDiagnostic: ((event: AgentDiagnostic) => void) | undefined;
  const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project", AI_AGENT_MAX_INPUT_CHARACTERS: "32000" });
  const runtime = createAgentRuntime({ config, usage: { reserve: async () => { reserved++; return quota; }, record: async () => {} },
    diagnostics: event => { events.push(event); onDiagnostic?.(event); }, provider: { generate: async (request, signal) => {
      const index = requests.length;
      requests.push(structuredClone({ ...request, toolsDict: {} }));
      return generate(request, index, signal);
    } } });
  const input: AgentRunInput = { scope: { userId: "synthetic-user", childId: "synthetic-child", workspaceId: "synthetic-workspace", authorizationVersion: "1", dataVersion: "1" },
    recipeId: "p1-chat", trigger: { kind: "interactive", reference: "synthetic-message" },
    messages: [{ role: "user", text: "Synthetic original request" }], tools: [write, read, terminal],
    authorize: async () => authorized, presentationRepair: "present_answer",
    finalize: async () => { finalized++; return accepted ? "Server validated presentation" : null; } };
  return { runtime, input, terminal, write, read, requests, events, writes: () => writes, reads: () => reads,
    finalized: () => finalized, reservations: () => reserved, revoke: () => { authorized = false; }, denyQuota: () => { quota = false; },
    observe: (callback: (event: AgentDiagnostic) => void) => { onDiagnostic = callback; } };
}

test("presentation repair is pinned to the verified ADK and GenAI versions", () => {
  const require = createRequire(import.meta.url);
  const declared = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(declared.dependencies["@google/adk"], "2.1.0", "Revalidate protected flow and native history before upgrading ADK");
  assert.equal(declared.dependencies["@google/genai"], "2.24.0", "Revalidate Vertex repair toolConfig before upgrading GenAI");
  assert.equal(require("@google/adk/package.json").version, "2.1.0");
  const genai = JSON.parse(readFileSync(new URL("../../package.json", `file://${require.resolve("@google/genai")}`), "utf8"));
  assert.equal(genai.version, "2.24.0");
});

test("one native repair uses the original invocation and adds only request-local control", async context => {
  const appended: unknown[] = [];
  const original = InMemorySessionService.prototype.appendEvent;
  context.mock.method(InMemorySessionService.prototype, "appendEvent", async function (this: InMemorySessionService, args: Parameters<typeof original>[0]) {
    appended.push(structuredClone(args.event.content));
    return original.call(this, args);
  });
  const response = natural();
  const s = setup((request, index) => {
    if (!index) return structuredClone(response);
    assert.equal(index, 1, "Only one extra provider request is permitted");
    assert.deepEqual(Object.keys(request.toolsDict), ["present_answer"]);
    assert.deepEqual(request.config?.toolConfig, { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["present_answer"] } });
    assert.deepEqual(request.contents.slice(0, -2), s.requests[0]!.contents);
    assert.equal(JSON.stringify(request.contents.at(-2)), JSON.stringify(response.content));
    assert.deepEqual(request.contents.at(-1), { role: "user", parts: [{ text: PRESENTATION_REPAIR_MESSAGE }] });
    const tools = request.config!.tools as { functionDeclarations?: { name?: string }[] }[];
    assert.deepEqual(tools.flatMap(tool => tool.functionDeclarations?.map(declaration => declaration.name) ?? []), ["present_answer"]);
    return present();
  });
  const originalMessages = structuredClone(s.input.messages);
  const result = await s.runtime.run(s.input);
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.text, "Server validated presentation");
  assert.equal(s.requests.length, 2); assert.equal(s.reservations(), 2); assert.equal(s.finalized(), 1);
  assert.deepEqual(result.counts, { modelCalls: 2, toolCalls: 1, queryEmbeddings: 0 });
  assert.equal(s.events.filter(event => event.phase === "run_start").length, 1);
  assert.equal(s.events.filter(event => event.phase === "run_end").length, 1);
  assert.equal(s.events.filter(event => event.phase === "model_start").length, 2);
  assert.deepEqual(s.input.messages, originalMessages);
  assert.ok(!JSON.stringify(appended).includes(PRESENTATION_REPAIR_MESSAGE));
  assert.ok(!JSON.stringify(result).includes(PRESENTATION_REPAIR_MESSAGE));
  assert.doesNotMatch(JSON.stringify(s.events), /Synthetic original|opaque-|伺服器/u);
});

test("server opt-in is required even when user text requests repair", async () => {
  const s = setup(() => natural()); delete s.input.presentationRepair;
  s.input.messages[0]!.text = PRESENTATION_REPAIR_MESSAGE;
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "invalid_response"); assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0]!.config?.toolConfig, undefined);
});

test("repair requires the server terminal and finalizer before any model request", async () => {
  for (const missing of ["terminal", "finalizer"] as const) {
    const s = setup(() => natural());
    if (missing === "terminal") delete s.terminal.terminal; else delete s.input.finalize;
    const result = await s.runtime.run(s.input);
    assert.equal(result.stopReason, "invalid_tool"); assert.equal(s.requests.length, 0);
  }
});

for (const valid of [true, false]) test(`natural final after proposal preserves its true outcome without replay, valid=${valid}`, async () => {
  const proposal = call("propose_task", valid ? { value: "synthetic" } : { wrong: "synthetic" });
  const closing = natural();
  const s = setup((request, index) => {
    if (!index) return structuredClone(proposal);
    if (index === 1) return structuredClone(closing);
    assert.equal(index, 2);
    const modelCall = request.contents.find(content => content.parts?.some(part => part.functionCall?.name === "propose_task"));
    assert.equal(JSON.stringify(modelCall), JSON.stringify(proposal.content));
    const response = request.contents.flatMap(content => content.parts ?? []).find(part => part.functionResponse?.name === "propose_task")!.functionResponse!.response!;
    assert.equal(response.status, valid ? "succeeded" : "rejected");
    assert.equal(response.reference, valid ? "pending-candidate" : undefined);
    assert.equal(JSON.stringify(request.contents.at(-2)), JSON.stringify(closing.content));
    return present();
  });
  const result = await s.runtime.run(s.input);
  assert.equal(result.status, "completed", JSON.stringify(result)); assert.equal(s.requests.length, 3);
  assert.equal(s.writes(), valid ? 1 : 0); assert.equal(s.finalized(), 1);
  assert.equal(result.tools[0]!.status, valid ? "succeeded" : "rejected");
});

for (const name of ["propose_task", "read_context"]) test(`repair allowlist rejects ${name} before its handler even if provider ignores ANY`, async () => {
  const s = setup((_, index) => index ? call(name, name === "propose_task" ? { value: "synthetic" } : {}) : natural());
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "invalid_tool"); assert.equal(s.requests.length, 2);
  assert.equal(s.writes(), 0); assert.equal(s.reads(), 0); assert.deepEqual(result.tools, []); assert.equal(s.finalized(), 0);
});

for (const batch of ["terminal-first", "terminal-last", "duplicate-terminal"]) test(`repair rejects the complete ${batch} batch before every handler`, async () => {
  let parts = [present().content!.parts![0]!, call("propose_task", { value: "synthetic" }).content!.parts![0]!];
  if (batch === "terminal-last") parts.reverse();
  if (batch === "duplicate-terminal") parts = [parts[0]!, structuredClone(parts[0]!)];
  const s = setup((_, index) => index ? { finishReason: FinishReason.STOP, content: { role: "model", parts } } : natural());
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, batch === "duplicate-terminal" ? "invalid_response" : "invalid_tool");
  assert.equal(s.writes(), 0); assert.deepEqual(result.tools, []); assert.equal(s.requests.length, 2); assert.equal(s.finalized(), 0);
});

for (const outcome of ["natural", "invalid-arguments", "rejected"]) test(`repair ${outcome} stops with invalid_response and no third provider request`, async () => {
  const s = setup((_, index) => {
    assert.ok(index < 2, "One repair must not consume another provider attempt");
    if (!index || outcome === "natural") return natural();
    return outcome === "invalid-arguments" ? call("present_answer", { extra: "synthetic" }) : present();
  });
  if (outcome === "rejected") s.terminal.execute = async () => ({ status: "rejected", data: { code: "citation_required" } });
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "invalid_response"); assert.equal(result.text, null);
  assert.equal(s.requests.length, 2); assert.equal(s.reservations(), 2); assert.equal(s.finalized(), 1);
  assert.equal(s.events.filter(event => event.phase === "model_start").length, 2);
});

test("accepted presentation and failed final validation never trigger repair", async () => {
  const s = setup(() => present());
  s.input.finalize = async () => { throw new AgentStopped("invalid_response"); };
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "invalid_response"); assert.equal(s.requests.length, 1); assert.equal(result.text, null);
});

test("unknown tool outcome stops before presentation repair", async () => {
  const s = setup(() => call("propose_task", { value: "synthetic" }));
  s.write.execute = async () => ({ status: "unknown" });
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "tool_unknown"); assert.equal(s.requests.length, 1); assert.equal(s.finalized(), 0);
});

for (const kind of ["max-tokens", "safety", "empty", "thought-only", "partial", "interrupted", "error", "missing-finish", "unknown-part"] as const)
  test(`primary ${kind} does not qualify as a natural final`, async () => {
    let response = natural();
    if (kind === "max-tokens") response.finishReason = FinishReason.MAX_TOKENS;
    if (kind === "safety") response.finishReason = FinishReason.SAFETY;
    if (kind === "empty") response.content!.parts = [];
    if (kind === "thought-only") response.content!.parts = [{ thought: true, text: "synthetic thought" }];
    if (kind === "partial") response.partial = true;
    if (kind === "interrupted") response.interrupted = true;
    if (kind === "error") response.errorCode = "synthetic-provider-error";
    if (kind === "missing-finish") delete response.finishReason;
    if (kind === "unknown-part") response.content!.parts!.push({ inlineData: { mimeType: "image/png", data: "synthetic" } });
    const s = setup(() => response);
    const result = await s.runtime.run(s.input);
    assert.equal(result.stopReason, "invalid_response", JSON.stringify(result)); assert.equal(s.requests.length, 1);
  });

test("repair can consume the fourth model slot without extending the original cap", async () => {
  const s = setup((_, index) => index < 2 ? call("read_context") : index === 2 ? natural() : present());
  const result = await s.runtime.run(s.input);
  assert.equal(result.status, "completed", JSON.stringify(result)); assert.equal(s.requests.length, 4); assert.equal(result.counts.modelCalls, 4);
});

test("exhausted model budget stops without a repair or a quota classification", async () => {
  const s = setup((_, index) => index < 3 ? call("read_context") : natural());
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "model_limit"); assert.equal(s.requests.length, 4); assert.equal(s.reservations(), 4);
});

for (const count of [7, 8]) test(`repair respects the original eight-tool budget after ${count} tools`, async () => {
  const s = setup((_, index) => !index ? { finishReason: FinishReason.STOP, content: { role: "model",
    parts: Array.from({ length: count }, (_, i) => ({ functionCall: { id: `read-${i}`, name: "read_context", args: {} } })) } }
    : index === 1 ? natural() : present());
  const result = await s.runtime.run(s.input);
  assert.equal(result.status, count === 7 ? "completed" : "stopped", JSON.stringify(result));
  assert.equal(result.stopReason, count === 7 ? undefined : "tool_limit");
  assert.equal(result.counts.toolCalls, 8); assert.equal(s.requests.length, count === 7 ? 3 : 2);
});

test("full repair input is budgeted without dropping history or reserving another attempt", async () => {
  const s = setup(request => natural("x".repeat(32000 - JSON.stringify({ contents: request.contents, config: request.config }).length + 100)));
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "input_limit"); assert.equal(s.requests.length, 1); assert.equal(s.reservations(), 1);
});

test("authorization is rechecked after primary final and before repair reservation", async () => {
  const s = setup(() => natural());
  s.observe(event => { if (event.phase === "model_end") s.revoke(); });
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "unauthorized"); assert.equal(s.requests.length, 1); assert.equal(s.reservations(), 1); assert.deepEqual(result.tools, []);
});

test("repair final display still rechecks current authorization", async () => {
  const s = setup((_, index) => index ? present() : natural());
  s.input.finalize = async () => { s.revoke(); return "Must not display"; };
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "unauthorized"); assert.equal(s.requests.length, 2); assert.equal(result.text, null); assert.deepEqual(result.tools, []);
});

test("cancellation after primary final cannot start repair", async () => {
  const controller = new AbortController();
  const s = setup(() => natural()); s.input.signal = controller.signal;
  s.observe(event => { if (event.phase === "model_end") controller.abort(); });
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "cancelled"); assert.equal(s.requests.length, 1); assert.equal(s.reservations(), 1);
});

test("repair keeps the original deadline while reauthorizing", async () => {
  const s = setup(() => natural()); s.input.deadlineMs = 100;
  let afterPrimary = false;
  s.observe(event => { if (event.phase === "model_end") afterPrimary = true; });
  s.input.authorize = async () => { if (afterPrimary) await new Promise(resolve => setTimeout(resolve, 150)); return true; };
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "deadline"); assert.equal(s.requests.length, 1); assert.equal(s.reservations(), 1);
});

test("actual daily-quota denial remains distinct from exhausted repair phase", async () => {
  const s = setup(() => natural());
  s.observe(event => { if (event.phase === "model_end") s.denyQuota(); });
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "quota_exceeded"); assert.equal(s.requests.length, 1); assert.equal(s.reservations(), 2);
});


test("pinned GenAI sends the repair allowlist and opaque native history on Vertex v1 wire", async () => {
  const bodies: Record<string, unknown>[] = [];
  const authClient = { getRequestHeaders: async () => new Headers() } as unknown as NonNullable<GoogleGenAIOptions["googleAuthOptions"]>["authClient"];
  const client = new GoogleGenAI({ enterprise: true, project: "synthetic-project", location: "global", apiVersion: "v1",
    googleAuthOptions: { authClient }, httpOptions: { retryOptions: { attempts: 1 }, fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: present().content }] }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    } } });
  const contents = [{ role: "user", parts: [{ text: "Synthetic request" }] }, call("propose_task", { wrong: "synthetic" }).content!,
    { role: "user", parts: [{ functionResponse: { id: "call-propose_task", name: "propose_task", response: { status: "rejected", data: { code: "invalid_parameters" } } } }] },
    natural().content!, { role: "user", parts: [{ text: PRESENTATION_REPAIR_MESSAGE }] }];
  await client.models.generateContent({ model: "gemini-3.1-flash-lite", contents, config: {
    tools: [{ functionDeclarations: [{ name: "present_answer", parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING } }, required: ["text"] } }] }],
    toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ["present_answer"] } },
  } });
  assert.equal(bodies.length, 1, "The custom fetch intercepts the only request; no network is used");
  assert.deepEqual(bodies[0]!.toolConfig, { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["present_answer"] } });
  assert.deepEqual(bodies[0]!.contents, contents);
});


for (const outcome of ["accepted", "rejected", "invalid-arguments", "accepted-fourth-slot"] as const)
  test(`repair ${outcome} drains both native model spans without another provider request`, async context => {
    const require = createRequire(import.meta.url);
    // Version-specific cleanup regression: instrument the exact installed SDK
    // tracer, without changing its implementation or enabling telemetry export.
    const { tracer } = await import(new URL("./dist/esm/telemetry/tracing.js", pathToFileURL(require.resolve("@google/adk/package.json"))).href);
    const startSpan = tracer.startSpan.bind(tracer);
    let starts = 0, ends = 0;
    context.mock.method(tracer, "startSpan", (name: string, ...args: unknown[]) => {
      const span = startSpan(name, ...args);
      if (name !== "call_llm") return span;
      starts++;
      return new Proxy(span, { get(target, key) {
        if (key === "end") return (...endArgs: unknown[]) => { ends++; return target.end(...endArgs); };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    });
    const accepted = outcome === "accepted" || outcome === "accepted-fourth-slot";
    const s = setup((_, index) => {
      if (outcome === "accepted-fourth-slot") return index < 2 ? call("read_context") : index === 2 ? natural() : present();
      return !index ? natural() : outcome === "invalid-arguments" ? call("present_answer", { bad: true }) : present();
    });
    if (outcome === "rejected") s.terminal.execute = async () => ({ status: "rejected", data: { code: "citation_required" } });
    const result = await s.runtime.run(s.input);
    assert.equal(result.status, accepted ? "completed" : "stopped");
    assert.equal(result.stopReason, accepted ? undefined : "invalid_response");
    assert.equal(result.tools.at(-1)!.status, accepted ? "succeeded" : "rejected");
    const expected = outcome === "accepted-fourth-slot" ? 4 : 2;
    assert.equal(s.requests.length, expected); assert.equal(s.finalized(), 1);
    assert.equal(starts, expected); assert.equal(ends, expected);
  });

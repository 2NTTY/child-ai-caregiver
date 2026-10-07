import assert from "node:assert/strict";
import test from "node:test";
import { FinishReason } from "@google/genai";
import type { LlmRequest, LlmResponse } from "@google/adk";
import { z } from "zod";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import type { AgentRunInput, AgentTool } from "../server/agent-runtime.ts";
import { readAiConfig } from "../server/ai-config.ts";
import type { AttemptRecord } from "../server/ai-usage.ts";

const answer = (text: string): LlmResponse => ({ content: { role: "model", parts: [{ text }] }, finishReason: FinishReason.STOP });
const call = (name = "read_context", args: Record<string, unknown> = { key: "age" }): LlmResponse => ({
  content: { role: "model", parts: [{ functionCall: { id: "synthetic-call", name, args }, thoughtSignature: "opaque-signature" }] },
  finishReason: FinishReason.STOP,
});
function setup(generate: (request: LlmRequest, index: number, signal: AbortSignal) => Promise<LlmResponse>) {
  const requests: LlmRequest[] = [];
  const records: AttemptRecord[] = [];
  let executed = 0;
  let reserved = 0;
  let quotaAvailable = true;
  const tool: AgentTool = { name: "read_context", description: "Read a synthetic approved context field.",
    parameters: z.object({ key: z.enum(["age", "region"]) }), authorize: async () => true,
    execute: async () => { executed++; return { status: "succeeded", reference: "synthetic-record", data: { value: "synthetic context" } }; } };
  const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project", AI_AGENT_MAX_INPUT_CHARACTERS: "32000" }),
    usage: { reserve: async () => { reserved++; return quotaAvailable; }, record: async record => { records.push(record); } },
    provider: { generate: async (request, signal) => { const index = requests.length; requests.push(structuredClone({ ...request, toolsDict: {} })); return generate(request, index, signal); } } });
  const input: AgentRunInput = { scope: { userId: "user", childId: "child", workspaceId: "workspace", authorizationVersion: "1", dataVersion: "1" },
    recipeId: "p1-chat", trigger: { kind: "interactive", reference: "message" },
    messages: [{ role: "user", text: "Synthetic question" }], tools: [tool], authorize: async () => true };
  return { runtime, input, tool, requests, records, executions: () => executed, reservations: () => reserved,
    denyQuota: () => { quotaAvailable = false; } };
}

test("real ADK Runner performs two tool steps, preserves native signatures and returns text only", async () => {
  const s = setup(async (_, index) => index < 2 ? call("read_context", { key: index ? "region" : "age" }) : answer("已讀取兩項合成資料。"));
  const result = await s.runtime.run(s.input);
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.text, "已讀取兩項合成資料。");
  assert.equal(s.executions(), 2);
  assert.equal(s.reservations(), 3);
  assert.deepEqual(result.counts, { modelCalls: 3, toolCalls: 2, queryEmbeddings: 0 });
  const parts = s.requests[1]!.contents.flatMap(content => content.parts ?? []);
  assert.ok(parts.some(part => part.thoughtSignature === "opaque-signature"));
  assert.ok(parts.some(part => part.functionResponse?.id === "synthetic-call"));
  assert.doesNotMatch(JSON.stringify(result), /opaque-signature|functionCall|systemInstruction/u);
  assert.doesNotMatch(JSON.stringify(s.records), /Synthetic question|synthetic context/u);
});

test("invalid parameters and forged scope are rejected before handler execution", async () => {
  const s = setup(async (_, index) => index ? answer("參數未獲接納。") : call("read_context", { key: "age", userId: "other" }));
  const result = await s.runtime.run(s.input);
  assert.equal(result.status, "completed");
  assert.equal(result.tools[0]?.status, "rejected");
  assert.equal(s.executions(), 0);
  assert.equal(result.counts.toolCalls, 1);
});

test("tool authorization rejects expired confirmations and unauthorized resources", async () => {
  const s = setup(async () => call());
  let finalized = 0;
  s.tool.authorize = async () => false;
  s.input.finalizeOnModelLimit = true;
  s.input.finalize = async () => { finalized++; return "Must not complete rejected tools."; };
  const result = await s.runtime.run(s.input);
  assert.equal(s.executions(), 0);
  assert.equal(result.tools[0]?.status, "rejected");
  assert.equal(result.stopReason, "model_limit");
  assert.equal(finalized, 0);
});

test("unknown tools count as attempts and cannot reach any handler", async () => {
  const s = setup(async () => call("not_allowed"));
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "invalid_tool");
  assert.equal(result.counts.toolCalls, 1);
  assert.equal(s.executions(), 0);
});

test("model and tool budgets bound scripted loops without extra provider calls", async () => {
  const s = setup(async () => call());
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "model_limit", JSON.stringify(result));
  assert.equal(s.requests.length, 4);
  const many = setup(async () => ({ ...call(), content: { role: "model", parts: Array.from({ length: 9 }, () => call().content!.parts![0]!) } }));
  assert.equal((await many.runtime.run(many.input)).stopReason, "tool_limit");
  assert.equal(many.executions(), 0);
});

test("model limit finalizes four successful tool steps once without a fifth provider call", async () => {
  const names = ["read_context", "search_knowledge", "present_answer", "propose_task"];
  const s = setup(async (_, index) => call(names[index]));
  const executed: string[] = [];
  let finalized = 0;
  s.input.tools = names.map(name => ({ ...s.tool, name, execute: async (args, context) => {
    executed.push(name); return s.tool.execute(args, context);
  } }));
  s.input.finalizeOnModelLimit = true;
  s.input.finalize = async (result, context) => {
    finalized++;
    assert.deepEqual(result.tools.map(tool => tool.status), names.map(() => "succeeded"));
    assert.deepEqual(context.budget.counts, { modelCalls: 4, toolCalls: 4, queryEmbeddings: 0 });
    return "Server validated presentation.";
  };
  const result = await s.runtime.run(s.input);
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.stopReason, undefined);
  assert.equal(result.text, "Server validated presentation.");
  assert.deepEqual(executed, names);
  assert.equal(finalized, 1);
  assert.equal(s.requests.length, 4);
  assert.equal(s.reservations(), 4);
  assert.deepEqual(result.counts, { modelCalls: 4, toolCalls: 4, queryEmbeddings: 0 });
});

test("model limit with no prepared finalization text stays stopped", async () => {
  const s = setup(async () => call());
  let finalized = 0;
  s.input.finalizeOnModelLimit = true;
  s.input.finalize = async () => { finalized++; return null; };
  const result = await s.runtime.run(s.input);
  assert.equal(result.status, "stopped");
  assert.equal(result.stopReason, "invalid_response");
  assert.equal(result.text, null);
  assert.equal(finalized, 1);
  assert.equal(s.requests.length, 4);
});

test("successful tools survive final model failure without executing again", async () => {
  const s = setup(async (_, index) => { if (index === 3) throw new Error("secret-provider-error"); return call(); });
  let finalized = 0;
  s.input.finalizeOnModelLimit = true;
  s.input.finalize = async () => { finalized++; return "Must not complete an unavailable model."; };
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "unavailable");
  assert.equal(result.tools[0]?.status, "succeeded");
  assert.equal(result.text, null);
  assert.equal(s.executions(), 3);
  assert.equal(result.counts.modelCalls, 4);
  assert.equal(finalized, 0);
  assert.doesNotMatch(JSON.stringify(result), /secret-provider-error/u);
});

test("unknown tool outcomes stop before a model can propose a blind retry", async () => {
  const s = setup(async () => call());
  let executions = 0;
  let finalized = 0;
  s.input.finalizeOnModelLimit = true;
  s.input.finalize = async () => { finalized++; return "Must not complete an unknown outcome."; };
  s.tool.execute = async () => { executions++; throw new Error("uncertain external outcome"); };
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "tool_unknown");
  assert.equal(result.tools[0]?.status, "unknown");
  assert.equal(executions, 1);
  assert.equal(s.requests.length, 1);
  assert.equal(finalized, 0);
});

test("oversized context is rejected without calling or reserving the model", async () => {
  const s = setup(async () => answer("unused"));
  s.input.messages[0]!.text = "x".repeat(32000);
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "input_limit");
  assert.equal(s.requests.length, 0);
  assert.equal(s.reservations(), 0);
});

test("revocation after generation prevents tools and returning private results", async () => {
  let authorized = true;
  const s = setup(async () => { authorized = false; return call(); });
  s.input.authorize = async () => authorized;
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "unauthorized");
  assert.equal(s.executions(), 0);
  assert.deepEqual(result.tools, []);
});

test("quota denial stops before the provider and does not trigger a hidden retry", async () => {
  const s = setup(async () => answer("unused"));
  s.denyQuota();
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "quota_exceeded");
  assert.equal(s.requests.length, 0);
  assert.equal(s.reservations(), 1);
  assert.equal(s.records.length, 0);
});

test("fallback tool progress is hidden when authorization changes during model limit finalization", async () => {
  let authorized = true;
  let finalized = 0;
  const s = setup(async () => call());
  s.input.authorize = async () => authorized;
  s.input.finalizeOnModelLimit = true;
  s.input.finalize = async () => { finalized++; authorized = false; return "Private prepared presentation."; };
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "unauthorized");
  assert.equal(s.executions(), 4);
  assert.equal(finalized, 1);
  assert.equal(result.text, null);
  assert.deepEqual(result.tools, []);
});

test("cancellation reaches provider and no following operation starts", async () => {
  const controller = new AbortController();
  let aborted: AbortSignal | undefined;
  const s = setup(async (_, __, signal) => { aborted = signal; controller.abort(); return new Promise(() => {}); });
  s.input.signal = controller.signal;
  s.input.finalizeOnModelLimit = true;
  s.input.finalize = async () => { throw new Error("Finalization must not follow cancellation"); };
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "cancelled");
  assert.equal(aborted?.aborted, true);
  assert.equal(s.executions(), 0);
});

test("photo transport keeps bounded image bytes outside text budget through the real Runner tool cycle", async () => {
  // A synthetic signature fixture tests transport only, not image recognition or decoding.
  const bytes=Buffer.alloc(33000);bytes[0]=255;bytes[1]=216;bytes[2]=255;
  const image={mimeType:"image/jpeg" as const,data:bytes.toString("base64")};
  const s=setup(async(request,index)=>{
    assert.deepEqual(request.contents.flatMap(content=>content.parts??[]).find(part=>part.inlineData)?.inlineData,image);
    return index===0?call():answer("候選待核對。");
  });
  s.input.recipeId="photo-capture";
  s.input.availableInputs=["run","scope","conversation","context","evidence","capabilities"];
  s.input.image=image;
  const result=await s.runtime.run(s.input);
  assert.equal(result.status,"completed",JSON.stringify(result));
  assert.equal(s.executions(),1);assert.equal(s.reservations(),2);
});

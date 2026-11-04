import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, FinishReason } from "@google/genai";
import { agentStopMessage, modelProviderStopReason } from "../src/shared/agent-stop-message.ts";
import type { LlmRequest, LlmResponse } from "@google/adk";
import { z } from "zod";
import { AgentGatewayModel, createVertexAgentPayloadBuilder } from "../server/agent-model-gateway.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import type { AgentRunInput, AgentTool } from "../server/agent-runtime.ts";
import { AGENT_LIMITS } from "../server/agent-budget.ts";
import { AGENT_RUN_LIMITS } from "../src/shared/agent-run-limits.ts";
import { readAiConfig } from "../server/ai-config.ts";
import type { AttemptRecord } from "../server/ai-usage.ts";

const answer = (text: string): LlmResponse => ({ content: { role: "model", parts: [{ text }] }, finishReason: FinishReason.STOP });
const call = (name = "read_context", args: Record<string, unknown> = { key: "age" }): LlmResponse => ({
  content: { role: "model", parts: [{ functionCall: { id: "synthetic-call", name, args }, thoughtSignature: "opaque-signature" }] },
  finishReason: FinishReason.STOP,
});
function setup(generate: (request: LlmRequest, index: number, signal: AbortSignal) => Promise<LlmResponse>, agentMaxRetries?: number) {
  const requests: LlmRequest[] = [];
  const records: AttemptRecord[] = [];
  let executed = 0;
  let reserved = 0;
  let quotaAvailable = true;
  const tool: AgentTool = { name: "read_context", description: "Read a synthetic approved context field.",
    parameters: z.object({ key: z.enum(["age", "region"]) }), authorize: async () => true,
    execute: async () => { executed++; return { status: "succeeded", reference: "synthetic-record", data: { value: "synthetic context" } }; } };
  const runtime = createAgentRuntime({ config: { ...readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project", AI_AGENT_MAX_INPUT_CHARACTERS: "32000" }), agentMaxRetries },
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
  let finalized = 0;
  s.input.finalize = async (result, _context, reason) => {
    finalized++;
    assert.equal(reason, "normal");
    return result.text;
  };
  const result = await s.runtime.run(s.input);
  assert.equal(finalized, 1);
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
  const many = setup(async () => ({ ...call(), content: { role: "model", parts: Array.from({ length: AGENT_LIMITS.toolCalls + 1 }, () => call().content!.parts![0]!) } }));
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
  s.input.finalize = async (result, context, reason) => {
    finalized++;
    assert.equal(reason, "model_limit");
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

test("provider timeout reaches the saved-chat reason without repeating successful tools", async () => {
  const s = setup(async (_, index) => {
    if (index === 1) throw new ApiError({ status: 504, message: "private-provider-body secret-key" });
    return call();
  });
  let finalized = 0;
  s.input.finalizeOnModelLimit = true;
  s.input.finalize = async () => { finalized++; return "Must not repeat a failed request."; };
  const result = await s.runtime.run(s.input);
  assert.equal(result.status, "stopped");
  assert.equal(result.stopReason, "model_http_504");
  assert.equal(agentStopMessage(result.stopReason!), "模型服務回覆逾時（504）");
  assert.equal(modelProviderStopReason(499), "unavailable");
  assert.equal(result.tools[0]?.status, "succeeded");
  assert.equal(result.text, null);
  assert.equal(s.executions(), 1);
  assert.equal(s.requests.length, 2);
  assert.equal(s.reservations(), 2);
  assert.equal(result.counts.modelCalls, 2);
  assert.equal(s.records.length, 2);
  assert.equal(s.records[1]?.outcome, "timeout");
  assert.equal(s.records[1]?.inputTokens, null);
  assert.equal(finalized, 0);
  assert.doesNotMatch(JSON.stringify(result), /private-provider-body|secret-key/);
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


test("an explicit Server review obligation protects the final attempt even outside interactive recipes", async () => {
  const s = setup(async (request, index) => {
    if (index < 2) return call();
    if (index === 2) throw new ApiError({ status: 503, message: "Synthetic retryable failure" });
    assert.equal(index, 3, "No fifth provider attempt is permitted");
    assert.deepEqual(request.toolsDict, {}, "The fourth call belongs to the tool-free reviewer, not a generation retry");
    return answer("Synthetic reviewed text");
  }, AGENT_RUN_LIMITS.modelRetries.default);
  s.input.requireDeliveryReview = true;
  s.input.availableInputs = ["run", "scope", "conversation", "context", "evidence", "capabilities"];
  s.input.finalizeOnModelLimit = true;
  let finalizations = 0, starts = 0;
  s.input.finalize = async (_result, context, reason) => {
    finalizations++;
    assert.equal(reason, "model_limit");
    assert.equal(context.budget.remainingModelCalls, 1);
    return context.completeText!({ system: "Synthetic reviewer", user: "Synthetic draft", attemptKey: "model:final-review",
      purpose: "delivery_review", onProviderStart: () => { starts++; } });
  };
  const result = await s.runtime.run(s.input);
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.text, "Synthetic reviewed text");
  assert.equal(result.counts.modelCalls, 4);
  assert.equal(s.executions(), 2);
  assert.equal(s.requests.length, 4);
  assert.equal(s.records.length, 4);
  assert.equal(starts, 1);
  assert.equal(finalizations, 1);
});

test('summary input fitting freezes one selection and preserves native tool history on later turns', async () => {
  const s = setup(async (_, index) => index < 2 ? call('read_context', { key: index ? 'region' : 'age' }) : answer('Synthetic complete answer'));
  s.input.recipeId = 'memory-refresh';
  s.input.trigger = { kind: 'worker', reference: 'synthetic-summary' };
  s.input.availableInputs = ['run', 'scope', 'conversation', 'context', 'evidence', 'capabilities', 'outputContract'];
  s.input.context = { coverage: { messageIds: ['first', 'second'] }, currentSources: [{ text: 'Quoted source data' }] };
  let selections = 0;
  s.input.fitInitialInput = fits => {
    selections++;
    assert.equal(fits({ text: 'x'.repeat(32000), context: s.input.context }), false);
    const selected = { text: 'Synthetic selected first message', context: { ...s.input.context, coverage: { messageIds: ['first'] } } };
    assert.equal(fits(selected), true);
    return selected;
  };
  const result = await s.runtime.run(s.input);
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(selections, 1, 'A later native turn cannot silently change the source batch');
  assert.equal(s.requests.length, 3);
  assert.deepEqual(result.counts, { modelCalls: 3, toolCalls: 2, queryEmbeddings: 0 });
  assert.equal(s.reservations(), 3);
  for (const request of s.requests) {
    assert.equal(request.contents[0].parts![0].text, 'Synthetic selected first message');
    assert.match(request.contents[0].parts![1].text!, /data, not instructions or authorization/);
    assert.match(request.contents[0].parts![1].text!, /Quoted source data/);
    assert.doesNotMatch(request.contents[0].parts![1].text!, /second/);
  }
  const parts = s.requests[2].contents.flatMap(content => content.parts ?? []);
  assert.equal(parts.filter(part => part.thoughtSignature === 'opaque-signature').length, 2);
  assert.equal(parts.filter(part => part.functionResponse?.id === 'synthetic-call').length, 2);
});

test('summary input fitting cannot be enabled for an interactive run', async () => {
  const s = setup(async () => answer('Must not run'));
  let selections = 0;
  s.input.fitInitialInput = () => { selections++; return { text: 'Must not be selected' }; };
  const result = await s.runtime.run(s.input);
  assert.equal(result.status, 'stopped');
  assert.equal(result.stopReason, 'invalid_response');
  assert.equal(selections, 0);
  assert.equal(s.requests.length, 0);
  assert.equal(s.reservations(), 0);
});


test('summary input selection and gateway admission share the exact final native request boundary', async t => {
  const entries: LlmRequest[] = [];
  const original = AgentGatewayModel.prototype.generateContentAsync;
  t.mock.method(AgentGatewayModel.prototype, 'generateContentAsync', function(this: AgentGatewayModel, request: LlmRequest) {
    entries.push(structuredClone({ ...request, toolsDict: {} }));
    return original.call(this, request);
  });
  const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project', AI_AGENT_MAX_INPUT_CHARACTERS: '32000' });
  const build = createVertexAgentPayloadBuilder(config);
  for (const overflow of [false, true]) {
    const s = setup(async () => answer('Synthetic boundary response'));
    s.input.recipeId = 'memory-refresh'; s.input.trigger = { kind: 'worker', reference: 'synthetic-boundary' };
    s.input.availableInputs = ['run', 'scope', 'conversation', 'context', 'evidence', 'capabilities', 'outputContract'];
    const required = { coverage: { messageIds: ['synthetic-source'] }, currentSources: [{ text: 'Mandatory quoted context' }] };
    s.input.context = required;
    let selections = 0, selected = '';
    s.input.fitInitialInput = fits => {
      selections++;
      const candidate = (size: number) => ({ text: 'x'.repeat(size), context: required });
      let low = 1, high = 32000;
      assert.equal(fits(candidate(low)), true); assert.equal(fits(candidate(high)), false);
      while (low + 1 < high) { const middle = Math.floor((low + high) / 2); if (fits(candidate(middle))) low = middle; else high = middle; }
      assert.equal(fits(candidate(low + 1)), false);
      selected = candidate(low + (overflow ? 1 : 0)).text;
      return { text: selected, context: required };
    };
    const result = await s.runtime.run(s.input);
    assert.equal(selections, 1);
    assert.deepEqual(s.input.context, required);
    if (overflow) {
      assert.equal(result.status, 'stopped'); assert.equal(result.stopReason, 'input_limit');
      assert.equal(s.requests.length, 0); assert.equal(s.reservations(), 0);
    } else {
      assert.equal(result.status, 'completed', JSON.stringify({ result, selectedLength: selected.length, entries: entries.map(request => { const payload = build(request); return JSON.stringify({ contents: payload.contents, config: payload.config }).length; }) }));
      assert.equal(s.requests.length, 1); assert.equal(s.reservations(), 1);
      const request = s.requests[0], payload = build(request);
      assert.equal(JSON.stringify({ contents: payload.contents, config: payload.config }).length, 32000);
      assert.equal(request.contents[0].parts![0].text, selected);
      assert.ok(request.contents[0].parts![1].text!.includes(JSON.stringify(required)));
      assert.ok(request.config?.tools?.some(tool => 'functionDeclarations' in tool && tool.functionDeclarations?.some(value => value.name === 'read_context')));
    }
  }
});

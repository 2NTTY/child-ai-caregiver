import assert from "node:assert/strict";
import test from "node:test";
import type { LlmRequest, LlmResponse } from "@google/adk";
import { FinishReason } from "@google/genai";
import { z } from "zod";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import type { AgentRunInput, AgentTool } from "../server/agent-runtime.ts";
import { AgentCapabilitySelection } from "../server/agent-tool-capabilities.ts";
import type { AgentToolCatalog } from "../server/agent-tool-capabilities.ts";
import { createAgentActionTools } from "../server/agent-action-tools.ts";
import type { AgentActionsStore } from "../server/agent-actions-store.ts";
import type { AgentActionReceipt, AgentDirectAction } from "../src/shared/agent-actions.ts";
import { loadAgentPrompt } from "../server/agent-prompt.ts";
import { PRODUCT_AGENT_TOOL_CATALOG } from "../server/product-agent-capabilities.ts";
import { readAiConfig } from "../server/ai-config.ts";

const inputs = ["run", "scope", "conversation", "context", "evidence", "capabilities"];
const call = (name: string, args: Record<string, unknown> = {}): LlmResponse => ({ finishReason: FinishReason.STOP,
  content: { role: "model", parts: [{ functionCall: { id: "call-" + name, name, args }, thoughtSignature: "opaque-native-signature" }] } });
const batch = (...responses: LlmResponse[]): LlmResponse => ({ finishReason: FinishReason.STOP,
  content: { role: "model", parts: responses.flatMap(response => response.content!.parts!) } });
const load = (capabilities = ["writes"]) => call("load_capabilities", { capabilities });
const present = () => call("present_answer", { text: "Synthetic final" });
const natural = (): LlmResponse => ({ finishReason: FinishReason.STOP,
  content: { role: "model", parts: [{ text: "Unvalidated synthetic closing text" }] } });
const instructionText = (request: LlmRequest) => {
  const content = request.config?.systemInstruction as { parts?: { text?: string }[] } | string;
  return typeof content === "string" ? content : content?.parts?.map(part => part.text ?? "").join("\n") ?? "";
};
const metadata = (request: LlmRequest) => JSON.parse(instructionText(request).split("Server runtime metadata:\n").at(-1)!) as {
  capabilities: string[];
  capabilityCatalog: { loader?: string; loaded: string[]; groups: { id: string; toolNames: string[] }[] };
};
const catalog: AgentToolCatalog = { coreToolNames: ["read_context"], loader: PRODUCT_AGENT_TOOL_CATALOG.loader,
  groups: [{ id: "writes", description: "Synthetic authorized writes", toolNames: ["save_item"], promptModuleIds: ["module.capture-confirmation"] },
    { id: "unavailable", description: "Unavailable synthetic service", toolNames: ["missing_service"], promptModuleIds: ["module.summary-report"] }] };

function setup(generate: (request: LlmRequest, index: number, signal: AbortSignal) => LlmResponse | Promise<LlmResponse>) {
  let accepted = false, writes = 0, finalized = 0;
  const requests: LlmRequest[] = [];
  const terminal: AgentTool = { name: "present_answer", terminal: true, description: "Validate a synthetic answer.",
    parameters: z.object({ text: z.string() }), authorize: async () => true,
    execute: async () => { accepted = true; return { status: "succeeded" }; } };
  const write: AgentTool = { name: "save_item", description: "Save one synthetic item.", parameters: z.object({}),
    authorize: async () => true, execute: async () => { writes++; return { status: "succeeded", reference: "saved-once" }; } };
  const read: AgentTool = { name: "read_context", description: "Read synthetic context.", parameters: z.object({}),
    authorize: async () => true, execute: async () => ({ status: "succeeded", data: { synthetic: true } }) };
  const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} }, provider: { generate: async (request, signal) => {
      const index = requests.length;
      requests.push(structuredClone({ ...request, toolsDict: {} }));
      return generate(request, index, signal);
    } } });
  const input: AgentRunInput = { scope: { userId: "synthetic-user", childId: "synthetic-child", workspaceId: "synthetic-workspace",
    authorizationVersion: "1", dataVersion: "1" }, recipeId: "product-interactive", trigger: { kind: "interactive", reference: "synthetic-message" },
    availableInputs: inputs, messages: [{ role: "user", text: "Synthetic continuation" }], tools: [read, write, terminal], toolCatalog: catalog,
    authorize: async () => true, presentationRepair: "present_answer",
    finalize: async () => { finalized++; return accepted ? "Server validated presentation" : null; } };
  return { runtime, input, terminal, write, read, requests, writes: () => writes, finalized: () => finalized };
}

test("semantic continuation loads actual services and trusted modules before the real action handler", async () => {
  const initial = await loadAgentPrompt("product-interactive", "tool_cycle", inputs);
  const selectedModuleIds = PRODUCT_AGENT_TOOL_CATALOG.groups
    .filter(group => group.id === "tasks" || group.id === "documents")
    .flatMap(group => [...group.promptModuleIds]);
  const expanded = await loadAgentPrompt("product-interactive", "tool_cycle", inputs, [...selectedModuleIds, ...selectedModuleIds]);
  assert.equal(expanded.moduleIds.filter(id => id === "module.task-intents").length, 1);
  assert.ok(!initial.moduleIds.includes("module.task-intents"));
  await assert.rejects(loadAgentPrompt("product-interactive", "tool_cycle", inputs, ["../../AGENTS.md"]));
  const operations: { runId: string; callId: string; action: AgentDirectAction }[] = [];
  const receipt: AgentActionReceipt = { id: "synthetic-receipt", runId: "synthetic-run", kind: "create_self_task",
    resource: { kind: "task", id: "synthetic-task", version: 1 }, state: "scheduled", notification: "not_authorized", channels: [],
    createdAt: "2026-10-08T00:00:00.000Z" };
  const actions = { execute: async (_scope, runId, callId, action) => {
    operations.push({ runId, callId, action }); return { ...receipt, runId };
  } } as AgentActionsStore;
  const s = setup((request, index) => {
    const meta = metadata(request);
    if (!index) {
      assert.ok(instructionText(request).includes(initial.text));
      assert.deepEqual(meta.capabilityCatalog.loaded, []);
      assert.ok(!Object.hasOwn(request.toolsDict, "create_ordinary_reminder"));
      assert.deepEqual(meta.capabilityCatalog.groups.find(group => group.id === "documents")!.toolNames, ["read_care_summary"]);
      assert.ok(!meta.capabilityCatalog.groups.some(group => ["concerns", "private_sources", "contact"].includes(group.id)));
      assert.equal(request.contents.at(-1)!.parts![0]!.text, "就按剛才的安排處理。");
      assert.ok(request.contents.some(content => content.parts?.some(part => part.text?.includes("待辦"))));
      return load(["tasks", "documents"]);
    }
    assert.ok(instructionText(request).includes(expanded.text));
    assert.deepEqual(meta.capabilityCatalog.loaded, ["tasks", "documents"]);
    assert.ok(Object.hasOwn(request.toolsDict, "create_ordinary_reminder"));
    assert.ok(!Object.hasOwn(request.toolsDict, "save_ordinary_record"));
    const parts = request.contents.flatMap(content => content.parts ?? []);
    assert.ok(parts.some(part => part.thoughtSignature === "opaque-native-signature"));
    assert.ok(parts.some(part => part.functionResponse?.id === "call-load_capabilities"));
    if (index === 1) return batch(call("create_ordinary_reminder", {
      sourceQuote: "就按剛才的安排處理。", expectedPolicyVersion: 1, title: "帶故事書", details: "放入袋內",
      dueAt: "2026-10-09T11:30:00.000Z", timeZone: "Asia/Hong_Kong",
    }), load(["tasks", "documents"]));
    assert.equal(index, 2);
    assert.ok(parts.some(part => part.functionResponse?.response?.reference === receipt.id));
    return present();
  });
  s.input.toolCatalog = PRODUCT_AGENT_TOOL_CATALOG;
  s.input.messages = [{ role: "user", text: "明天晚上七時半建立帶故事書的待辦，並核對七日摘要。" },
    { role: "model", text: "已理解內容與時間，待按現有授權處理。" }, { role: "user", text: "就按剛才的安排處理。" }];
  s.input.tools = run => [...createAgentActionTools(actions, run, s.input.authorize), s.read, s.terminal,
    { name: "read_care_summary", description: "Read a synthetic summary.", parameters: z.object({}), authorize: async () => true,
      execute: async () => ({ status: "succeeded" }) }];
  const result = await s.runtime.run(s.input);
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(operations.length, 1); assert.equal(operations[0]!.runId, result.runId);
  assert.equal(operations[0]!.callId, "call-create_ordinary_reminder"); assert.equal(operations[0]!.action.kind, "create_self_task");
  assert.equal(s.finalized(), 1);
  assert.deepEqual(result.counts, { modelCalls: 3, toolCalls: 4, queryEmbeddings: 0 });
  assert.deepEqual(result.tools.map(tool => tool.status), ["succeeded", "succeeded", "succeeded", "succeeded"]);
});

test("capability loading is isolated across runs and never grants handler authorization", async () => {
  const s = setup((request, index) => {
    if (index === 0 || index === 2) {
      assert.deepEqual(metadata(request).capabilityCatalog.loaded, []);
      assert.ok(!Object.hasOwn(request.toolsDict, "save_item"));
      assert.deepEqual(metadata(request).capabilityCatalog.groups.map(group => group.id), ["writes"]);
      return load();
    }
    assert.deepEqual(metadata(request).capabilityCatalog.loaded, ["writes"]);
    if (index === 3) return call("save_item");
    if (index === 4) {
      const response = request.contents.flatMap(content => content.parts ?? []).find(part => part.functionResponse?.name === "save_item")!.functionResponse!.response!;
      assert.equal(response.status, "rejected"); assert.equal((response.data as Record<string, unknown>).code, "not_authorized");
    }
    return present();
  });
  assert.equal((await s.runtime.run(s.input)).status, "completed");
  s.write.authorize = async () => false;
  const result = await s.runtime.run({ ...s.input, scope: { ...s.input.scope, userId: "second-synthetic-user" } });
  assert.equal(result.status, "completed", JSON.stringify(result)); assert.equal(s.writes(), 0);
  assert.deepEqual(result.tools.map(tool => tool.status), ["succeeded", "rejected", "succeeded"]);
  assert.deepEqual(result.counts, { modelCalls: 3, toolCalls: 3, queryEmbeddings: 0 });
});

test("illegal loader parameters and unloaded same-batch tools fail closed with counted attempts", async () => {
  const s = setup((request, index) => {
    assert.deepEqual(metadata(request).capabilityCatalog.loaded, []);
    assert.ok(!Object.hasOwn(request.toolsDict, "save_item"));
    if (!index) return load(["unavailable"]);
    if (index === 1) return call("load_capabilities", { capabilities: ["writes"], extra: true });
    assert.equal(index, 2);
    return batch(load(), call("save_item"));
  });
  assert.throws(() => new AgentCapabilitySelection([s.read, s.write, s.terminal], { ...catalog, groups: [] }));
  assert.throws(() => new AgentCapabilitySelection([s.read, s.write, s.terminal], { ...catalog,
    loader: { ...catalog.loader, name: "save_item" } }));
  assert.throws(() => new AgentCapabilitySelection([s.read, s.write, s.terminal], { ...catalog,
    groups: [...catalog.groups, { ...catalog.groups[0]!, id: "duplicate_owner" }] }));
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "invalid_tool", JSON.stringify(result)); assert.equal(s.writes(), 0);
  assert.equal(s.finalized(), 0);
  assert.deepEqual(result.tools.map(tool => tool.status), ["rejected", "rejected"]);
  assert.deepEqual(result.counts, { modelCalls: 3, toolCalls: 4, queryEmbeddings: 0 });
});

test("cancellation after loading stops the same run before a business operation", async () => {
  const controller = new AbortController();
  const s = setup((request, index) => {
    if (!index) return load();
    assert.equal(index, 1); assert.ok(Object.hasOwn(request.toolsDict, "save_item"));
    controller.abort(); return call("save_item");
  });
  s.input.signal = controller.signal;
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "cancelled", JSON.stringify(result)); assert.equal(s.writes(), 0);
  assert.deepEqual(result.tools, []); assert.equal(s.finalized(), 0);
  assert.deepEqual(result.counts, { modelCalls: 2, toolCalls: 1, queryEmbeddings: 0 });
});

test("repeated capability loads remain monotonic and consume the shared tool limit", async () => {
  const s = setup((request, index) => {
    if (index) assert.deepEqual(metadata(request).capabilityCatalog.loaded, ["writes"]);
    return batch(load(), load(), load());
  });
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "tool_limit", JSON.stringify(result)); assert.equal(s.requests.length, 3);
  assert.equal(s.writes(), 0); assert.equal(s.finalized(), 0);
  assert.deepEqual(result.counts, { modelCalls: 3, toolCalls: 6, queryEmbeddings: 0 });
  assert.equal(result.tools.length, 6); assert.ok(result.tools.every(tool => tool.status === "succeeded"));
});

test("presentation-only repair after a saved tool never reloads or replays business operations", async () => {
  let repairChecked = false;
  const s = setup((request, index) => {
    if (!index) return load();
    if (index === 1) return call("save_item");
    if (index === 2) return natural();
    assert.equal(index, 3);
    assert.deepEqual(Object.keys(request.toolsDict), ["present_answer"]);
    assert.deepEqual(request.config?.toolConfig, { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["present_answer"] } });
    repairChecked = true;
    throw new Error("Synthetic final provider failure");
  });
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "unavailable", JSON.stringify(result)); assert.equal(result.text, null);
  assert.equal(s.writes(), 1); assert.equal(s.finalized(), 0);
  assert.equal(repairChecked, true);
  assert.deepEqual(result.tools.map(tool => [tool.name, tool.status]), [["load_capabilities", "succeeded"], ["save_item", "succeeded"]]);
  assert.deepEqual(result.counts, { modelCalls: 4, toolCalls: 2, queryEmbeddings: 0 });
});

test("unknown loaded-tool outcomes stop without replay or a fresh run", async () => {
  let executions = 0;
  const s = setup((_, index) => {
    if (!index) return load();
    assert.equal(index, 1); return call("save_item");
  });
  s.write.execute = async () => { executions++; throw new Error("Synthetic uncertain side effect"); };
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "tool_unknown", JSON.stringify(result)); assert.equal(executions, 1);
  assert.equal(s.requests.length, 2); assert.equal(s.finalized(), 0); assert.equal(result.text, null);
  assert.deepEqual(result.tools.map(tool => tool.status), ["succeeded", "unknown"]);
  assert.deepEqual(result.counts, { modelCalls: 2, toolCalls: 2, queryEmbeddings: 0 });
});

import assert from "node:assert/strict";
import test from "node:test";
import { FunctionTool } from "@google/adk";
import { GoogleAuth } from "google-auth-library";
import { createProductAgentTools } from "../server/product-agent-tools.ts";
import { PRODUCT_AGENT_TOOL_CATALOG } from "../server/product-agent-capabilities.ts";
import { AgentCapabilitySelection } from "../server/agent-tool-capabilities.ts";
import { createAgentConcernTools } from "../server/agent-concern-tools.ts";
import { createAgentDocumentTools } from "../server/agent-document-tools.ts";
import { createVertexAgentProvider } from "../server/agent-model-gateway.ts";
import { AgentBudget } from "../server/agent-budget.ts";
import { readAiConfig } from "../server/ai-config.ts";
import type { AgentTool } from "../server/agent-runtime.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";

// Synthetic conversation retained as transport data, never as a tool selector.
const messages = [
  "這是純合成驗收資料。請幫合成驗收小星 A 記下：2026年10月7日香港時間中午12點，他自己把黃色積木收回盒子。請保存為日常觀察記錄，標記「合成驗收 Agent A1」，不要建立待辦，也不要通知任何人。",
  "Agent 暫未能完成回覆；原訊息仍已保存。請查看運行狀態及未完成事項。",
  "這是新的純合成验收記錄，不要重做先前的請求。請替合成驗收小星 A 保存一則日常觀察：2026年10月7日香港時間13:20，他把藍色繪本放回書架。標記「合成驗收 Agent A2」。不要建立待辦，不要發出任何通知。",
];
const id = "00000000-0000-4000-8000-000000000001";
// Vertex v1 Schema fields, verified against the official reference. No payload is logged.
const schemaFields = new Set(["type", "format", "title", "description", "nullable", "default", "items",
  "minItems", "maxItems", "enum", "properties", "propertyOrdering", "required", "minProperties", "maxProperties",
  "minimum", "maximum", "minLength", "maxLength", "pattern", "example", "anyOf", "additionalProperties", "ref", "defs"]);
function contractIssues(value: unknown, path: string, issues: string[] = []): string[] {
  assert.ok(value && typeof value === "object");
  for (const [key, child] of Object.entries(value)) {
    if (!schemaFields.has(key)) issues.push(path + "." + key);
    if (key === "enum" && (!Array.isArray(child) || child.some(item => typeof item !== "string"))) issues.push(path + ".enum(non-string)");
    if (key === "properties" || key === "defs") for (const [name, schema] of Object.entries(child)) contractIssues(schema, path + "." + key + "." + name, issues);
    if (["anyOf", "oneOf", "allOf"].includes(key)) child.forEach((schema: unknown, index: number) => contractIssues(schema, `${path}.${key}[${index}]`, issues));
    if (key === "items") contractIssues(child, path + ".items", issues);
  }
  return issues;
}
function native(tool: AgentTool, execute: (args: Record<string, unknown>) => Promise<unknown> = async () => ({})) {
  return new FunctionTool({ name: tool.name, description: tool.description, parameters: tool.parameters.strict(), execute });
}

test("all Server capabilities serialize only documented Vertex schema fields", async context => {
  const budget = new AgentBudget();
  try {
    const tools = createProductAgentTools({ includeDocuments: true, run: { scope: {}, runId: "synthetic", budget },
      memory: {}, tasks: {}, store: {}, knowledge: { createRun: () => ({}) }, authorize: async () => false,
      actions: {}, summary: {}, contact: {}, concerns: {}, sources: {}, documents: {}, growth: {},
    } as unknown as Parameters<typeof createProductAgentTools>[0]).tools;
    assert.equal(tools.length, 28);
    assert.deepEqual(tools.map(tool => tool.name).sort(), [...PRODUCT_AGENT_TOOL_CATALOG.coreToolNames,
      ...PRODUCT_AGENT_TOOL_CATALOG.groups.flatMap(group => group.toolNames)].sort());
    const selection = new AgentCapabilitySelection(tools, PRODUCT_AGENT_TOOL_CATALOG);
    const declarations = [...tools, selection.loader(async () => {})!].map(tool => native(tool)._getDeclaration()!);
    let calls = 0;
    context.mock.method(GoogleAuth.prototype, "getRequestHeaders", async () => new Headers({ authorization: "Bearer synthetic" }));
    context.mock.method(globalThis, "fetch", async (url: string | URL | Request, init: RequestInit) => {
      calls++;
      assert.equal(String(url), "https://aiplatform.googleapis.com/v1/projects/synthetic-project/locations/global/publishers/google/models/gemini-3.1-flash-lite:generateContent");
      const body = JSON.parse(String(init.body));
      assert.deepEqual(Object.keys(body.generationConfig).sort(), ["candidateCount", "maxOutputTokens", "thinkingConfig"]);
      const sent = body.tools.flatMap((tool: { functionDeclarations: { name: string; parameters: unknown }[] }) => tool.functionDeclarations);
      assert.equal(sent.length, 29);
      assert.deepEqual(sent.flatMap((tool: { name: string; parameters: unknown }) => contractIssues(tool.parameters, tool.name)), []);
      return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: "synthetic" }] }, finishReason: "STOP" }] });
    });
    await createVertexAgentProvider(readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" })).generate({
      model: "gemini-3.1-flash-lite", contents: [{ role: "user", parts: [{ text: "synthetic contract check" }] }],
      toolsDict: {}, liveConnectConfig: {}, config: { tools: [{ functionDeclarations: declarations }] },
    }, budget.signal);
    assert.equal(calls, 1);
  } finally { budget.close(); }
});

test("document change declarations use supported union fields without changing strict execution", async () => {
  let writes = 0;
  const run = { scope: {}, runId: "synthetic" } as never;
  const tools = createAgentDocumentTools({} as never, { writeDocument: async () => { writes++; return null; } } as never, run, async () => true);
  for (const tool of tools) assert.deepEqual(contractIssues(native(tool)._getDeclaration()!.parameters, tool.name), []);
  const change = tools.find(tool => tool.name === "change_family_document")!;
  const call = { scope: {}, runId: "synthetic", callId: "synthetic", signal: new AbortController().signal } as never;
  const valid = { sourceQuote: "Synthetic request", documentId: id, change: { action: "refresh", expectedVersion: 1, authorityVersion: "synthetic" } };
  for (const bad of [{ ...valid.change, expectedVersion: 0 }, { ...valid.change, action: "delete" }, { ...valid.change, checked: true }]) {
    assert.equal(change.parameters.safeParse({ ...valid, change: bad }).success, false);
    assert.equal((await change.execute({ ...valid, change: bad }, call)).status, "rejected");
  }
  assert.equal(change.parameters.safeParse({ ...valid, userId: "forged" }).success, false);
  assert.equal(writes, 0);
  await change.execute(valid, call);
  assert.equal(writes, 1);
});

test("the real product-interactive Runner request keeps its system configuration and supported schemas", async context => {
  const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" });
  let requests = 0, reservations = 0, records = 0;
  let productTools: ReturnType<typeof createProductAgentTools>;
  const sourceContext = { excerpt: "UNTRUSTED_TRANSPORT_SENTINEL {literal_state} {optional_state?}" };
  context.mock.method(GoogleAuth.prototype, "getRequestHeaders", async () => new Headers({ authorization: "Bearer synthetic" }));
  context.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init: RequestInit) => {
    requests++;
    const body = JSON.parse(String(init.body));
    assert.ok(body.systemInstruction.parts.every((part: { text: unknown }) => typeof part.text === "string"));
    assert.doesNotMatch(JSON.stringify(body.systemInstruction), /UNTRUSTED_TRANSPORT_SENTINEL|literal_state|optional_state/u);
    assert.equal(body.contents.at(-1).parts[0].text, messages.at(-1));
    assert.ok(body.contents.at(-1).parts[1].text.endsWith(JSON.stringify(sourceContext)));
    assert.equal(body.generationConfig.candidateCount, 1);
    assert.equal(body.generationConfig.maxOutputTokens, 1024);
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "MINIMAL");
    const declarations = body.tools.flatMap((tool: { functionDeclarations: { name: string; parameters: unknown }[] }) => tool.functionDeclarations);
    assert.equal(declarations.length, 6);
    assert.deepEqual(declarations.map((tool: { name: string }) => tool.name).sort(),
      ["load_capabilities", "present_answer", "read_care_records", "read_context", "read_private_instructions", "search_knowledge"]);
    assert.equal(declarations.some((tool: { name: string }) => ["read_contact_options", "contact_caregiver"].includes(tool.name)), false);
    assert.deepEqual(declarations.flatMap((tool: { name: string; parameters: unknown }) => contractIssues(tool.parameters, tool.name)), []);
    return Response.json({ candidates: [{ content: { role: "model", parts: [{ functionCall: { id: "terminal-call", name: "present_answer",
      args: { kind: "clarification", paragraphs: [{ text: "Synthetic transport response", citationIds: [] }] } } }] }, finishReason: "STOP" }] });
  });
  const runtime = createAgentRuntime({ config, provider: createVertexAgentProvider(config),
    usage: { reserve: async () => { reservations++; return true; }, record: async () => { records++; } } });
  const result = await runtime.run({ scope: { userId: "synthetic-user", childId: "synthetic-child", workspaceId: "synthetic-workspace", authorizationVersion: "1", dataVersion: "1" },
    recipeId: "product-interactive", trigger: { kind: "interactive", reference: "synthetic" },
    availableInputs: ["run", "scope", "conversation", "context", "evidence", "capabilities"],
    context: sourceContext,
    messages: messages.map((text, index) => ({ role: index === 1 ? "model" : "user", text })), authorize: async () => true,
    toolCatalog: PRODUCT_AGENT_TOOL_CATALOG,
    tools: run => { productTools = createProductAgentTools({ includeDocuments: true, run,
      memory: {}, tasks: {}, store: {}, knowledge: { createRun: () => ({}) }, authorize: async () => true,
      actions: {}, summary: {}, contact: {}, concerns: {}, sources: {}, documents: {}, growth: {},
    } as unknown as Parameters<typeof createProductAgentTools>[0]); return productTools.tools; },
    finalize: async () => (await productTools.presentation())?.text ?? null,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.text, "Synthetic transport response");
  assert.deepEqual(result.counts, { modelCalls: 1, toolCalls: 1, queryEmbeddings: 0 });
  assert.equal(requests, 1); assert.equal(reservations, 1); assert.equal(records, 1);
});

test("concern tool declarations preserve true-only confirmation, strict branch validation and authorization", async () => {
  let proposals = 0, allowed = true;
  const run = { scope: {}, runId: "synthetic" } as never;
  const tools = createAgentConcernTools({} as never, { propose: async () => { proposals++; return {}; } } as never,
    run, async () => allowed);
  const tool = tools.find(value => value.name === "propose_concern_change")!;
  assert.deepEqual(contractIssues(native(tool)._getDeclaration()!.parameters, tool.name), []);
  const call = { scope: {}, runId: "synthetic", callId: "synthetic", signal: new AbortController().signal } as never;
  const valid = { concernId: id, change: { action: "archive", expectedVersion: 1, authorityVersion: "synthetic", confirm: true } };
  for (const bad of [{ ...valid.change, confirm: false }, { ...valid.change, confirm: "true" },
    { ...valid.change, expectedVersion: 0 }, { ...valid.change, expectedVersion: 2147483647 },
    { ...valid.change, followUpAt: "2026-10-07T05:00:00Z" }]) {
    assert.equal(tool.parameters.safeParse({ ...valid, change: bad }).success, false);
    assert.equal((await tool.execute({ ...valid, change: bad }, call)).status, "rejected");
  }
  const malicious = { ...valid, userId: "forged" };
  await assert.rejects(native(tool, args => tool.execute(args, call)).runAsync({ args: malicious, toolContext: {} as never }));
  assert.equal(proposals, 0);
  allowed = false;
  assert.equal((await tool.execute(valid, call)).status, "rejected");
  assert.equal(proposals, 0);
  allowed = true;
  for (const action of ["archive", "restore"]) assert.equal((await tool.execute({ ...valid, change: { ...valid.change, action } }, call)).status, "succeeded");
  assert.equal(proposals, 2);
});

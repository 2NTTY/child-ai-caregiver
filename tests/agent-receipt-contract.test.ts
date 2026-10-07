import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { createAgentActionsApi, AgentActionsApiError } from "../src/client/agent-actions-api.ts";

const root = path.resolve(import.meta.dirname, ".."), require = createRequire(import.meta.url);
const childId = "11111111-1111-4111-8111-111111111111", runId = "22222222-2222-4222-8222-222222222222";
const oldReceipt = { id: "33333333-3333-4333-8333-333333333333", runId, kind: "save_record",
  resource: { kind: "care_record", id: "44444444-4444-4444-8444-444444444444", version: 1 },
  state: "saved", notification: "not_authorized", channels: [], createdAt: "2026-10-07T07:37:35Z" };
const signal = () => new AbortController().signal;
function client(receipts: unknown[]) {
  return createAgentActionsApi("/api", (async () => Response.json({ receipts })) as typeof fetch);
}

// Load the unchanged real owner and presentation using the repository's existing transpile-test pattern.
function load(entry: string, overrides: Record<string, any> = {}, cache = new Map<string, any>()): any {
  const file = path.resolve(root, entry);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  new Function("require", "module", "exports", code)((name: string) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (!name.startsWith(".")) return require(name);
    let target = path.resolve(path.dirname(file), name);
    if (!existsSync(target)) target += ".ts";
    return load(target, overrides, cache);
  }, module, module.exports);
  return module.exports;
}
function renderReceiptText(authorization: unknown): string {
  const node = (type: unknown, props: unknown) => ({ type, props });
  const placeholder = new Proxy({}, { get: (_target, key) => String(key) });
  const production = { agentModel: { readState: "ready", run: { id: runId }, online: true }, agentActions: {}, agentInbox: {}, agentInboxActions: {},
    agentPending: { state: "idle", entries: [], nextCursor: null }, authorization, authorizationActions: {} };
  const overrides: Record<string, any> = {
    "react": { useEffect() {}, useRef: () => ({ current: null }) }, "react/jsx-runtime": { jsx: node, jsxs: node },
    "react-native": { StyleSheet: { create: (value: unknown) => value }, View: "View" }, "react-native-paper": { Text: "Text" },
    "./ProductionProvider": { useProduction: () => production },
    "../components/chat/chat-presentation": { chatColors: placeholder, chatFont: "synthetic", chatType: { tool: {} } },
    "../theme": { colors: placeholder, spacing: placeholder },
    "../agent-view-model": { agentTime: (value: string) => value, proposalExpired: () => false, agentProposalLabels: {} },
  };
  for (const name of ["../components/agent/AgentInboxView", "../components/agent/AgentRunView", "../components/AppDialog",
    "../components/AppScrollView", "../components/chat/locateCitationSource", "../components/ui"]) overrides[name] = placeholder;
  const { AgentConversation } = load("frontend/src/production/AgentConversation.tsx", overrides);
  const tree = AgentConversation({ visible: true, onDismiss() {}, onOpenSettings() {}, onReloadChat() {}, reloadDisabled: false });
  const text = (value: any): string => typeof value === "string" ? value : Array.isArray(value) ? value.map(text).join("")
    : value && typeof value === "object" ? text(value.props?.children) : "";
  return text(tree);
}

test("receipt HTTP 200 accepts legacy receipts and every declared status-only quantity grounding", async () => {
  assert.deepEqual(await client([oldReceipt]).receipts(childId, runId, signal(), "synthetic-user"), [oldReceipt]);
  for (const status of ["source_supported", "removed", "absent", "unchanged"]) {
    const receipt = { ...oldReceipt, quantityGrounding: { status } };
    assert.deepEqual(await client([receipt]).receipts(childId, runId, signal(), "synthetic-user"), [receipt]);
  }
});

test("receipt parsing stays strict about status, private measurement fields, identity and duplicate receipts", async () => {
  for (const grounding of [null, {}, { status: "exact" }, { status: "removed", quantity: null },
    { status: "source_supported", rawValue: "120", unit: "ml" }, { status: "removed", sourceQuote: "Synthetic private phrase" }])
    await assert.rejects(client([{ ...oldReceipt, quantityGrounding: grounding }]).receipts(childId, runId, signal(), "synthetic-user"), AgentActionsApiError);
  for (const receipts of [[{ ...oldReceipt, quantity: { rawValue: "120", unit: "ml" } }],
    [{ ...oldReceipt, runId: childId }], [oldReceipt, oldReceipt]])
    await assert.rejects(client(receipts).receipts(childId, runId, signal(), "synthetic-user"), AgentActionsApiError);
});

for (const withGrounding of [false, true]) test(`real receipt owner and shallow conversation render the saved ${withGrounding ? "status-only" : "legacy"} receipt`, async context => {
  const receipt = { ...oldReceipt, ...(withGrounding ? { quantityGrounding: { status: "removed" } } : {}) };
  let requests = 0;
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    requests++;
    assert.equal(url, `/api/children/${childId}/agent/actions?runId=${runId}`);
    assert.equal(init.method, "GET"); assert.equal((init.headers as Record<string, string>)["x-expected-user-id"], "synthetic-user");
    return Response.json({ receipts: [receipt] });
  });
  const { AgentAuthorizationOwner } = load("frontend/src/production/AgentAuthorizationOwner.ts");
  const owner = new AgentAuthorizationOwner("/api", true, () => assert.fail("Unexpected access loss"), () => assert.fail("Receipt reads must not write"));
  owner.syncContext({ key: childId, childId, userId: "synthetic-user" }, true);
  try {
    await owner.readReceipts(runId);
    assert.deepEqual(owner.getSnapshot().receipts[runId], { state: "ready", items: [receipt] });
    const text = renderReceiptText(owner.getSnapshot());
    assert.ok(text.includes("保存照護記錄 · 已保存"));
    assert.ok(!text.includes("操作收據尚未確認"));
    assert.equal(requests, 1);
  } finally { owner.dispose(); }
});

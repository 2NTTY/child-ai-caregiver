import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { FinishReason } from "@google/genai";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import type { AgentRunResult, AgentScope } from "../server/agent-runtime.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { readAiConfig } from "../server/ai-config.ts";
import type { DocumentChange, FamilyDocument } from "../src/shared/family-documents.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";

// Characterization only: real local ADK Runner, scripted provider and synthetic stores.
// The commit marker models an atomic store commit; it is not a real database transaction.
function fixture(revokeAtCommit: boolean, mode: "abort" | "source-invalid" | "partial-invalid" = "abort") {
  const runId = "d4a1b662-d13d-476b-bf52-40a28aa1a1a7", childId = "1ebcb39d-a2db-4b8c-a432-7ffcb3de5808";
  const messageId = "7de5a0e8-e106-4485-b7d2-3b572741da39", userId = "synthetic-user";
  const sourceQuote = "請把準備單的書包一項勾選為已準備。";
  const scope: AgentScope = { userId, childId, workspaceId: "synthetic-workspace", authorizationVersion: "1", dataVersion: "epoch:1" };
  const expiresAt = new Date(Date.now() + 90_000).toISOString();
  const original: FamilyDocument = { id: "11111111-1111-4111-8111-111111111111", childId, kind: "preparation", purpose: "school",
    version: 3, status: "active", archivedAt: null, autoRefresh: false, readState: "ready", history: [],
    current: { id: "22222222-2222-4222-8222-222222222222", version: 2, generatedAt: "2026-10-08T00:00:00Z", sourceBasis: "synthetic-basis",
      title: "School preparation", summary: "Synthetic summary", ageLabel: "Unknown", period: { from: "2026-10-08", to: "2026-10-08" }, eventDate: null,
      coverageNote: "Synthetic coverage", sources: [], changes: [], sections: [{ id: "checklist", title: "Checklist", kind: "checklist", domain: null,
        items: [{ id: "bag", text: "Pack the supplied bag", sourceIds: [], checked: false }] }] },
    manifest: { snapshotId: "22222222-2222-4222-8222-222222222222", snapshotVersion: 2, invalidated: false,
      sections: [{ id: "checklist", kind: "checklist", itemIds: ["bag"] }] } };
  const change: DocumentChange = { action: "check_item", expectedVersion: 3, authorityVersion: "synthetic-authority:6",
    sectionId: "checklist", itemId: "bag", checked: true };
  const otherDocumentId = "44444444-4444-4444-8444-444444444444";
  const summaryMessages = Array.from({ length: 12 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    childId, authorUserId: userId, role: "user" as const, text: "Synthetic summary source " + i,
    inReplyTo: null, createdAt: "2026-10-08T00:00:00Z" }));
  const abort = new AbortController();
  const ledger = new Map<string, { runId: string; documentId: string; version: number; change: DocumentChange }>();
  const runtimeResults: AgentRunResult[] = [];
  const events: { name: string; aborted: boolean; authorized: boolean }[] = [];
  let currentUser = true, claimed = false, calls = 0, claims = 0, writes = 0, finishes = 0, reads = 0;
  let revokeOnGet = false;
  let committedDocument = structuredClone(original), saved: ProductAgentResult | null = null, savedSummary: unknown;
  const documents = new Map<string, FamilyDocument>();
  const record = (name: string) => events.push({ name, aborted: abort.signal.aborted, authorized: currentUser });
  const localRuntime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} },
    diagnostics: event => { if (event.phase === "tool_start") record("tool-start:" + event.tool); },
    provider: { generate: async request => {
      record("provider");
      assert.equal(abort.signal.aborted, false, "No new provider call may start after abort");
      const index = calls++;
      assert.ok(index < (mode === "abort" ? 2 : 3), "The scripted provider must not generate closing text or retry the operation");
      if (index === 0) assert.equal("change_family_document" in request.toolsDict, false);
      else {
        assert.ok("change_family_document" in request.toolsDict);
        assert.ok(request.contents.some(content => content.parts?.some(part => part.functionResponse?.name === "load_capabilities")));
      }
      const steps = mode === "abort" ? [
        [{ id: "load-documents", name: "load_capabilities", args: { capabilities: ["documents"] } }],
        [{ id: "check-bag", name: "change_family_document", args: { sourceQuote, documentId: original.id, change } }],
      ] : [
        [{ id: "load-documents", name: "load_capabilities", args: { capabilities: ["documents", "memory"] } },
          { id: "read-context", name: "read_context", args: {} }],
        [{ id: "check-bag", name: "change_family_document", args: { sourceQuote, documentId: original.id, change } },
          ...(mode === "partial-invalid" ? [{ id: "check-other-bag", name: "change_family_document", args: { sourceQuote, documentId: otherDocumentId, change } }] : []),
          { id: "stage-summary", name: "stage_private_summary", args: { text: "SYNTHETIC PRIVATE SUMMARY" } }],
        [{ id: "answer", name: "present_answer", args: { kind: "operation", paragraphs: [{ text: "SYNTHETIC PRIVATE DOCUMENT BODY", citationIds: [] }] } }],
      ];
      return { content: { role: "model", parts: steps[index].map(functionCall => ({ functionCall })) }, finishReason: FinishReason.STOP };
    } } });
  // Capture the actual runtime return without preserving or injecting discarded tool results.
  const runtime = { ...localRuntime, run: async (input: Parameters<typeof localRuntime.run>[0]) => {
    const result = await localRuntime.run(input);
    runtimeResults.push(structuredClone(result));
    return result;
  } };
  const options = { runtime,
    store: {
      claim: async (actor: string, child: string, trigger: { kind: string; reference: string }, recipe: string) => {
        assert.equal(actor, userId); assert.equal(child, childId);
        assert.deepEqual(trigger, { kind: "interactive", reference: messageId }); assert.equal(recipe, "product-interactive");
        record("claim"); claims++;
        const created = !claimed; claimed = true;
        return { runId, scope, created, sourceMessageId: messageId, state: saved?.status ?? "running", expiresAt };
      },
      authorize: async (value: AgentScope, originalRun: string) => {
        assert.deepEqual(value, scope); assert.equal(originalRun, runId); return currentUser;
      },
      writeDocument: async (value: AgentScope, originalRun: string, operationId: string, quote: string,
        mutation: { id: string; change: DocumentChange }) => {
        record("write-start");
        assert.equal(abort.signal.aborted, false); assert.equal(currentUser, true);
        assert.deepEqual(value, scope); assert.equal(originalRun, runId); assert.equal(quote, sourceQuote);
        assert.ok(mutation.id === original.id || mode === "partial-invalid" && mutation.id === otherDocumentId);
        assert.deepEqual(mutation.change, change);
        assert.equal(ledger.has(operationId), false, "The fixture must record a single original operation");
        const document = structuredClone(original); document.id = mutation.id; document.version = 4;
        document.current!.sections[0].items[0].checked = true; documents.set(mutation.id, document);
        if (mutation.id === original.id) committedDocument = document;
        ledger.set(operationId, { runId, documentId: mutation.id, version: 4, change: structuredClone(change) });
        writes++; record("commit-marker");
        if (revokeAtCommit) currentUser = false;
        if (mode === "abort") { abort.abort(); record("abort-after-commit"); }
        return structuredClone(document);
      },
      documentReceipts: async (value: AgentScope, originalRun: string) => {
        assert.deepEqual(value, scope); assert.equal(originalRun, runId);
        const receipts = [...ledger].map(([operationId, receipt]) => ({ operationId, documentId: receipt.documentId,
          savedVersion: receipt.version, toolName: "change_family_document" as const }));
        return currentUser ? { receipts: mode === "abort" ? receipts : mode === "partial-invalid" ? receipts.slice(-1) : [],
          unavailable: mode !== "abort", linked: receipts.length > 0 } : null;
      },
      finish: async (value: AgentScope, result: ProductAgentResult, summary?: unknown) => {
        assert.deepEqual(value, scope); assert.equal(currentUser, true);
        finishes++; record("finish"); saved = structuredClone(result); savedSummary = summary; return true;
      },
      get: async (actor: string, child: string, originalRun: string) => {
        assert.equal(actor, userId); assert.equal(child, childId); assert.equal(originalRun, runId);
        record("get"); const value = currentUser ? structuredClone(saved) : null;
        if (revokeOnGet) { currentUser = false; record("identity-revoked-during-get"); }
        return value;
      },
    },
    documents: { describe: async (actor: string, child: string, id: string) => {
      assert.equal(actor, userId); assert.equal(child, childId); assert.ok(documents.has(id));
      assert.equal(currentUser, true); reads++; record("document-readback");
      return { item: structuredClone(documents.get(id)), authorityVersion: "synthetic-authority:7" };
    } },
    memory: { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false,
      facts: [], topics: [], summary: null, recentMessages: mode === "abort" ? [] : summaryMessages, conflictingKeys: [], unavailableFactKeys: [],
      truncated: { facts: false, topics: false, messages: false } }),
      prepareSummary: async () => ({ previous: null, previousVersion: 0, basis: "synthetic-summary-basis", messages: summaryMessages, moreUncovered: false }) },
    chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: sourceQuote }] }) },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    knowledge: { createRun: () => ({ search: async () => { throw new Error("No knowledge call permitted"); }, revalidateCitations: async () => true }) },
  } as unknown as Parameters<typeof createProductAgent>[0];
  const service = createProductAgent(options);
  return { service, abort, runId, childId, messageId, userId, original, current: async () => currentUser,
    revokeDuringNextGet: () => { revokeOnGet = true; },
    observe: () => ({ revokeAtCommit, mode, fixtureOnlyCommit: true, currentUser, calls, claims, writes, finishes, reads, savedSummary,
      ledger: [...ledger].map(([operationId, receipt]) => ({ operationId, ...receipt })),
      documentVersion: committedDocument.version, checked: committedDocument.current!.sections[0].items[0].checked,
      runtimeResults: structuredClone(runtimeResults), saved: structuredClone(saved), events: structuredClone(events) }) };
}

function emitEvidence(name: string, observation: Record<string, unknown>) {
  const json = JSON.stringify(observation, null, 2);
  const directory = process.env.CHAT_CHARACTERIZATION_EVIDENCE_DIR;
  if (directory) writeFileSync(join(directory, name + ".json"), json + "\n");
  console.log("CHARACTERIZATION " + name + " " + JSON.stringify(observation));
}

for (const revoked of [false, true]) test(`committed document cancellation recovery, authorization=${revoked ? "revoked" : "retained"}`, async () => {
  const setup = fixture(revoked);
  let first: ProductAgentResult | null | undefined, retry: ProductAgentResult | null | undefined;
  try {
    first = await setup.service.reply(setup.userId, setup.childId, setup.messageId, setup.current, setup.abort.signal);
    retry = await setup.service.reply(setup.userId, setup.childId, setup.messageId, setup.current, new AbortController().signal);
    const observed = setup.observe();
    assert.equal(observed.writes, 1); assert.equal(observed.calls, 2); assert.equal(observed.ledger.length, 1);
    assert.equal(observed.documentVersion, 4); assert.equal(observed.checked, true);
    const hash = createHash("sha256").update(`family-document:${setup.runId}:check-bag`).digest("hex");
    const expectedOperationId = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
    assert.equal(observed.ledger[0].operationId, expectedOperationId);
    assert.equal(observed.ledger[0].runId, setup.runId); assert.equal(observed.ledger[0].documentId, setup.original.id);
    assert.equal(observed.runtimeResults.length, 1, "Retry must not open a second runtime");
    assert.equal(observed.runtimeResults[0].status, "stopped");
    assert.ok(["cancelled", "tool_unknown"].includes(observed.runtimeResults[0].stopReason!));
    assert.deepEqual(observed.runtimeResults[0].counts, { modelCalls: 2, toolCalls: 2, queryEmbeddings: 0 });
    assert.deepEqual(observed.runtimeResults[0].tools, [], "The runtime cancellation/authority guard remains intact");
    assert.equal(observed.events.some(event => event.aborted
      && (["provider", "write-start"].includes(event.name) || event.name.startsWith("tool-start:"))), false);
    assert.ok(observed.events.findIndex(event => event.name === "commit-marker") < observed.events.findIndex(event => event.name === "abort-after-commit"));
    if (revoked) {
      assert.equal(first, null); assert.equal(retry, null); assert.equal(observed.saved, null);
      assert.equal(observed.finishes, 0); assert.equal(observed.claims, 1); assert.equal(observed.reads, 0);
    } else {
      assert.equal(first?.runId, setup.runId); assert.equal(first?.status, "stopped");
      assert.match(first!.text, /文件操作已保存/u);
      assert.deepEqual(first?.tools, [{ name: "change_family_document", status: "succeeded", reference: setup.original.id }]);
      assert.deepEqual(first?.citations, []); assert.deepEqual(first?.privateSourceCitations, []);
      assert.deepEqual(retry, first); assert.deepEqual(observed.saved, first);
      assert.equal(observed.finishes, 1); assert.equal(observed.claims, 2);
    }
  } finally {
    emitEvidence(revoked ? "revoked" : "retained", { ...setup.observe(), first: first ?? null, retry: retry ?? null,
      reportingContract: revoked ? "No private result may be exposed after revocation" : "Authorized committed metadata is recovered without restoring discarded runtime tools" });
  }
});

test("same-message recovery rechecks identity after reading the persisted result", async () => {
  const setup = fixture(false);
  await setup.service.reply(setup.userId, setup.childId, setup.messageId, setup.current, setup.abort.signal);
  setup.revokeDuringNextGet();
  const result = await setup.service.reply(setup.userId, setup.childId, setup.messageId, setup.current);
  const observed = setup.observe();
  assert.equal(result, null); assert.equal(observed.currentUser, false);
  assert.equal(observed.calls, 2); assert.equal(observed.writes, 1); assert.equal(observed.finishes, 1);
  assert.equal(observed.claims, 2); assert.equal(observed.runtimeResults.length, 1);
  emitEvidence("retry-identity-changed", { ...observed, result });
});

for (const mode of ["source-invalid", "partial-invalid"] as const) test(`completed document presentation is blocked before finish, receipts=${mode}`, async () => {
  const setup = fixture(false, mode);
  let result: ProductAgentResult | null | undefined;
  try {
    result = await setup.service.reply(setup.userId, setup.childId, setup.messageId, setup.current, setup.abort.signal);
    const observed = setup.observe();
    assert.equal(observed.runtimeResults[0].status, "completed");
    assert.equal(observed.runtimeResults[0].text, "SYNTHETIC PRIVATE DOCUMENT BODY");
    assert.ok(observed.runtimeResults[0].tools.some(tool => tool.name === "stage_private_summary" && tool.status === "succeeded"));
    assert.equal(result?.status, "stopped"); assert.equal(result?.stopReason, "document_source_changed");
    assert.ok(!JSON.stringify(observed.saved).includes("SYNTHETIC PRIVATE DOCUMENT BODY"));
    assert.equal(observed.savedSummary, undefined); assert.deepEqual(result?.citations, []);
    assert.ok(!result?.tools.some(tool => tool.reference));
    assert.deepEqual(await setup.service.reply(setup.userId, setup.childId, setup.messageId, setup.current), result);
    assert.equal(setup.observe().calls, 3); assert.equal(setup.observe().writes, mode === "partial-invalid" ? 2 : 1);
  } finally { emitEvidence(mode, { ...setup.observe(), result: result ?? null }); }
});

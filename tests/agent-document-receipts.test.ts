import assert from "node:assert/strict";
import test from "node:test";
import { createAgentDocumentTools } from "../server/agent-document-tools.ts";
import { FamilyError } from "../server/family-access.ts";
import type { AgentRunContext } from "../server/agent-runtime.ts";
import type { FamilyDocument } from "../src/shared/family-documents.ts";

// Adapter-only synthetic data: no database, model or external service.
test("document views inline authorized short snapshots and preserve bounded write receipts on readback failure", async () => {
  const document: FamilyDocument = { id: "11111111-1111-4111-8111-111111111111", childId: "synthetic-child", kind: "preparation", purpose: "school",
    version: 3, status: "active", archivedAt: null, autoRefresh: false, readState: "ready", history: [],
    current: { id: "22222222-2222-4222-8222-222222222222", version: 2, generatedAt: "2026-10-08T00:00:00Z", sourceBasis: "synthetic-basis",
      title: "School preparation", summary: "Synthetic summary", ageLabel: "Unknown", period: { from: "2026-10-08", to: "2026-10-08" }, eventDate: null,
      coverageNote: "Synthetic coverage", sources: [], changes: [], sections: [{ id: "checklist", title: "Checklist", kind: "checklist", domain: null,
        items: [{ id: "bag", text: "Pack the supplied bag", sourceIds: [] }] }] },
    manifest: { snapshotId: "22222222-2222-4222-8222-222222222222", snapshotVersion: 2, invalidated: false,
      sections: [{ id: "checklist", kind: "checklist", itemIds: ["bag"] }] } };
  const budget = { toolResponseCharacters: 8000 };
  const run = { scope: { userId: "synthetic-user", workspaceId: "synthetic-workspace", childId: document.childId, authorizationVersion: "1", dataVersion: "1" },
    runId: "33333333-3333-4333-8333-333333333333", budget } as unknown as AgentRunContext;
  let described: FamilyDocument | null = document, failure: Error | null = null, writes = 0;
  const store = { list: async () => ({ items: [described!], authorityVersion: "synthetic-authority:7", hasMore: false }), describe: async () => { if (failure) throw failure; return described ? { item: described, authorityVersion: "synthetic-authority:7" } : null; } };
  const agent = { writeDocument: async () => { writes++; return document; } };
  const tools = createAgentDocumentTools(store as never, agent as never, run, async () => true);
  const invoke = (name: string, args: Record<string, unknown>) => tools.find(tool => tool.name === name)!.execute(args,
    { scope: run.scope, runId: run.runId, callId: name, signal: new AbortController().signal });
  const listed = await invoke("read_family_documents", { documentId: null });
  assert.deepEqual(listed.data?.snapshot, document.current);
  assert.equal(listed.data?.contentPartial, false);
  assert.equal(listed.data?.authorityVersion, "synthetic-authority:7");
  const generate = () => invoke("generate_family_document", { sourceQuote: "Create school preparation", kind: "preparation", purpose: "school", eventDate: null,
    period: { from: "2026-10-08", to: "2026-10-08" } });
  const change = () => invoke("change_family_document", { sourceQuote: "Refresh school preparation", documentId: document.id,
    change: { action: "refresh", expectedVersion: 3, authorityVersion: "synthetic-authority:6" } });
  const checkComplete = (result: Awaited<ReturnType<typeof invoke>>) => {
    assert.equal(result.status, "succeeded"); assert.equal(result.data?.authorityVersion, "synthetic-authority:7");
    assert.deepEqual(result.data?.snapshot, document.current); assert.equal(result.data?.contentPartial, false);
    assert.ok(JSON.stringify(result).length <= 8000 - 256);
  };
  checkComplete(await invoke("read_family_documents", { documentId: document.id }));
  for (const result of [await generate(), await change()]) {
    checkComplete(result); assert.equal(result.reference, document.id); assert.match(result.data!.receiptId as string, /^[a-f0-9-]{36}$/u);
  }
  assert.equal(writes, 2);
  described = { ...document, current: { ...document.current!, summary: "x".repeat(9000) } };
  const large = await invoke("read_family_documents", { documentId: document.id });
  assert.equal(large.data?.snapshot, null); assert.equal(large.data?.contentPartial, true); assert.equal(large.data?.readRequired, true);
  assert.deepEqual(large.data?.manifest, { snapshotId: document.current!.id, snapshotVersion: 2, invalidated: false,
    sections: [{ id: "checklist", kind: "checklist", itemCount: 1 }] });
  assert.ok(JSON.stringify(large).length <= 8000 - 256);
  described = { ...document, readState: "invalidated", manifest: { ...document.manifest!, invalidated: true } };
  const invalidated = await invoke("read_family_documents", { documentId: document.id });
  assert.equal(invalidated.data?.snapshot, null); assert.equal(invalidated.data?.contentPartial, true);
  for (const unavailable of ["denied", "conflict", "changed_version", "changed_snapshot", "query_failed"] as const) {
    failure = unavailable === "conflict" ? new FamilyError(409, "document_changed") : unavailable === "query_failed" ? new Error("synthetic-query-failure") : null;
    described = unavailable === "denied" ? null : unavailable === "changed_version" ? { ...document, version: 4 }
      : unavailable === "changed_snapshot" ? { ...document, current: { ...document.current!, version: 3 } } : document;
    const saved = await generate();
    assert.equal(saved.status, "succeeded", unavailable); assert.equal(saved.reference, document.id);
    assert.match(saved.data!.receiptId as string, /^[a-f0-9-]{36}$/u);
    assert.deepEqual(saved.data?.document, { id: document.id, version: 3 });
    assert.equal(saved.data?.snapshot, null); assert.equal(saved.data?.authorityVersion, undefined);
    assert.equal(saved.data?.contentPartial, true); assert.equal(saved.data?.readRequired, true);
    assert.equal(JSON.stringify(saved).includes("Synthetic summary"), false);
  }
  failure = null; budget.toolResponseCharacters = 600;
  described = { ...document, current: { ...document.current!, title: "x".repeat(3000) } };
  const bounded = await generate();
  assert.equal(bounded.status, "succeeded"); assert.equal(bounded.reference, document.id);
  assert.match(bounded.data!.receiptId as string, /^[a-f0-9-]{36}$/u);
  assert.deepEqual(bounded.data?.document, { id: document.id, version: 3 });
  assert.equal(bounded.data?.contentPartial, true); assert.equal(bounded.data?.snapshot, null);
  assert.ok(JSON.stringify(bounded).length <= 600 - 256);
});

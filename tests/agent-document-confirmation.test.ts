import assert from "node:assert/strict";
import test from "node:test";
import { createAgentDocumentTools } from "../server/agent-document-tools.ts";
import { FirestoreDomainError } from "../server/firestore-domain-data.ts";
import { createAgentObserver } from "../server/agent-observer.ts";

test("document proposals bind the saved target before reporting a prepared confirmation", async () => {
  const runId = "11111111-1111-4111-8111-111111111111", proposalId = "22222222-2222-4222-8222-222222222222";
  const documentId = "33333333-3333-4333-8333-333333333333";
  const scope = { userId: "parent", childId: "child", workspaceId: "workspace", authorizationVersion: "1", dataVersion: "epoch:1" };
  const value = { documentId, change: { action: "patch", expectedVersion: 7, authorityVersion: "epoch:7",
    edits: [{ op: "upsert_item", sectionId: "checklist", itemId: "bottle", text: "Synthetic bottle" }] } };
  let confirmations = 0, conflict = false;
  const agent = {
    propose: async () => ({ id: proposalId, runId, version: 1, status: "pending", value }),
    requestConfirmation: async (actualScope: unknown, askingRun: string, input: unknown) => {
      confirmations++;
      assert.equal(actualScope, scope); assert.equal(askingRun, runId);
      assert.deepEqual(input, { runId, proposalId, expectedVersion: 1, workId: null });
      if (conflict) throw new FirestoreDomainError(409, "confirmation_scope_changed");
    },
    writeDocument: async () => { throw Error("No edit before user confirmation"); },
  };
  const tools = createAgentDocumentTools({} as never, agent as never,
    { scope, runId, budget: { toolResponseCharacters: 8000 } } as never, async () => true);
  const invoke = () => tools.find(tool => tool.name === "propose_family_document_change")!.execute(value,
    { scope, runId, callId: "original-call", signal: new AbortController().signal });
  const saved = await invoke();
  assert.equal(saved.status, "succeeded"); assert.equal(saved.reference, proposalId); assert.equal(saved.data?.confirmationPrepared, true);
  conflict = true;
  const rejected = await invoke();
  assert.equal(rejected.status, "conflict"); assert.equal(rejected.data?.confirmationPrepared, undefined); assert.equal(confirmations, 2);
  const events: unknown[] = [];
  const observer = createAgentObserver({ runId, toolNames: ["propose_family_document_change"], sink: event => { events.push(event); } });
  observer.recordToolRejection("propose_family_document_change", "execution", rejected);
  assert.equal((events[0] as { code: string }).code, "confirmation_scope_changed");
  assert.equal(JSON.stringify(events).includes("Synthetic bottle"), false);
});

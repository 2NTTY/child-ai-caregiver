import assert from "node:assert/strict";
import test from "node:test";
import {
  DATA_COMPOSE_REVIEW_POLICY_VERSION, dataComposeDraftSchema, dataComposeReviewBindingSchema,
} from "../src/shared/data-compose.ts";
import {
  allowFormalComposeSave, assertUneditedItemsPreserved, createDataComposeTools, dataComposeDraftHash,
  dataComposeReviewAllows, editedItemKeys, finalizeComposedFamilyDocument, previewComposedSnapshot,
} from "../server/data-compose.ts";
import type { DocumentSnapshot } from "../src/shared/family-documents.ts";
import type { DataComposeDraft } from "../src/shared/data-compose.ts";

const scope = {
  userId: "parent", workspaceId: "workspace", childId: "child",
  authorizationVersion: "1", dataVersion: "epoch:1",
};
const documentId = "33333333-3333-4333-8333-333333333333";

function snapshot(): DocumentSnapshot {
  return {
    id: "44444444-4444-4444-8444-444444444444", version: 3, generatedAt: "2026-10-14T00:00:00.000Z",
    sourceBasis: "synthetic", title: "到診準備", summary: "合成摘要", ageLabel: "2歲",
    period: { from: "2026-10-01", to: "2026-10-14" }, eventDate: "2026-10-20", coverageNote: "",
    sections: [
      {
        id: "checklist", title: "清單", kind: "checklist", domain: null,
        items: [
          { id: "bottle", text: "帶水壺", sourceIds: [], checked: false },
          { id: "snack", text: "帶小食", sourceIds: [], checked: false },
          { id: "jacket", text: "帶外套", sourceIds: [], checked: false },
        ],
      },
      {
        id: "notes", title: "備註", kind: "notes", domain: null,
        items: [{ id: "note-1", text: "保持原備註", sourceIds: [] }],
      },
    ],
    sources: [], changes: [],
  };
}

function draft(overrides: Partial<DataComposeDraft> = {}): DataComposeDraft {
  return dataComposeDraftSchema.parse({
    documentId, expectedVersion: 3, authorityVersion: "epoch:7",
    edits: [{ op: "upsert_item", sectionId: "checklist", itemId: "bottle", text: "帶溫水壺" }],
    gaps: [], requiredConfirmations: ["parent_shared_document"],
    ...overrides,
  });
}

function passRecord(current = draft(), promptVersion = "0.1.39") {
  return dataComposeReviewBindingSchema.parse({
    draftHash: dataComposeDraftHash(current),
    documentId: current.documentId,
    expectedVersion: current.expectedVersion,
    authorityVersion: current.authorityVersion,
    scope: { ...scope },
    decision: "pass",
    model: "gemini-3.1-flash-lite",
    promptVersion,
    policyVersion: DATA_COMPOSE_REVIEW_POLICY_VERSION,
  });
}

test("compose review binding follows draft hash, version and scope", () => {
  const current = draft();
  const record = passRecord(current);
  assert.equal(dataComposeReviewAllows(record, current, "0.1.39"), true);
  assert.equal(dataComposeReviewAllows(record, draft({
    edits: [{ op: "upsert_item", sectionId: "checklist", itemId: "bottle", text: "另一句" }],
  }), "0.1.39"), false);
  assert.equal(dataComposeReviewAllows(record, draft({ expectedVersion: 4 }), "0.1.39"), false);
  assert.equal(dataComposeReviewAllows({ ...record, decision: "revise" }, current, "0.1.39"), false);
  assert.equal(dataComposeReviewAllows(record, current, "0.1.38"), false);
  assert.equal(allowFormalComposeSave({
    draft: current, review: record, promptVersion: "0.1.39", scope,
  }), true);
  assert.equal(allowFormalComposeSave({
    draft: current, review: null, promptVersion: "0.1.39", scope,
  }), false);
});

test("same-id partial edit keeps the rest of the document", () => {
  const previous = snapshot();
  const current = draft();
  const next = previewComposedSnapshot(previous, current);
  assertUneditedItemsPreserved(previous, next, current);
  const bottle = next.sections[0]!.items.find(item => item.id === "bottle");
  assert.equal(bottle?.text, "帶溫水壺");
  assert.equal(next.sections[0]!.items.find(item => item.id === "snack")?.text, "帶小食");
  assert.equal(next.sections[0]!.items.find(item => item.id === "jacket")?.text, "帶外套");
  assert.equal(next.sections[1]!.items[0]?.text, "保持原備註");
  assert.deepEqual([...editedItemKeys(current)], ["checklist\u0000bottle"]);
});

test("unreviewed draft cannot become a formal save", async () => {
  const current = draft();
  let wrote = 0, proposed = 0;
  const agent = {
    writeDocument: async () => { wrote++; return { id: documentId }; },
    propose: async () => { proposed++; return { id: "proposal", runId: "run", version: 1, status: "pending" }; },
    requestConfirmation: async () => {},
  };
  const rejected = await finalizeComposedFamilyDocument({
    draft: current, review: null, promptVersion: "0.1.39", scope, runId: "run", callId: "call",
    snapshot: snapshot(), agent: agent as never, sourceQuote: "請只改水壺",
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.status === "rejected" && rejected.code, "compose_review_required");
  assert.equal(wrote, 0);
  assert.equal(proposed, 0);

  const accepted = await finalizeComposedFamilyDocument({
    draft: current, review: passRecord(current), promptVersion: "0.1.39", scope, runId: "run",
    callId: "call-2", snapshot: snapshot(), agent: agent as never, sourceQuote: "請只改水壺",
  });
  assert.equal(accepted.status, "proposal");
  assert.equal(wrote, 0);
  assert.equal(proposed, 1);
});

test("compose tool rejects self-approval and blocks formal save without review pass", async () => {
  const current = draft();
  const previous = snapshot();
  let proposed = 0;
  const documents = {
    describe: async () => ({
      authorityVersion: "epoch:7",
      item: { id: documentId, version: 3, current: previous, kind: "preparation", purpose: "appointment" },
    }),
  };
  const agent = {
    writeDocument: async () => { throw new Error("no direct write in this test"); },
    propose: async () => { proposed++; return null; },
    requestConfirmation: async () => {},
  };
  const run = {
    scope, runId: "11111111-1111-4111-8111-111111111111",
    budget: { remainingModelCalls: 0, toolResponseCharacters: 8000 },
    authorize: async () => true,
  };
  const tools = createDataComposeTools({
    documents: documents as never, agent: agent as never, run: run as never,
    authorize: async () => true, scriptedDraft: current, reviewModel: "gemini-3.1-flash-lite",
  });
  const tool = tools.find(item => item.name === "compose_family_data")!;
  const smuggled = await tool.execute({
    documentId, expectedVersion: 3, authorityVersion: "epoch:7", intent: "只改水壺",
    approved: true, skipReview: true,
  }, { scope, runId: run.runId, callId: "c1", signal: new AbortController().signal });
  assert.equal(smuggled.status, "rejected");
  // Strict intent schema drops self-approval flags before execute body runs.
  assert.equal(smuggled.data?.code, "invalid_input");

  const unfinished = await tool.execute({
    documentId, expectedVersion: 3, authorityVersion: "epoch:7", intent: "只改水壺",
  }, { scope, runId: run.runId, callId: "c2", signal: new AbortController().signal });
  assert.equal(unfinished.status, "rejected");
  assert.equal(unfinished.data?.code, "compose_review_required");
  assert.equal(unfinished.data?.formalSave, false);
  assert.equal(proposed, 0);
});

test("compose tool prepares confirmation after scripted draft and passing review", async () => {
  const current = draft();
  const previous = snapshot();
  let proposed = 0, confirmations = 0;
  const documents = {
    describe: async () => ({
      authorityVersion: "epoch:7",
      item: { id: documentId, version: 3, current: previous },
    }),
  };
  const agent = {
    writeDocument: async () => { throw new Error("content edits use proposals"); },
    propose: async () => {
      proposed++;
      return { id: "22222222-2222-4222-8222-222222222222", runId: "11111111-1111-4111-8111-111111111111",
        version: 1, status: "pending", value: { kind: "family_document_change" } };
    },
    requestConfirmation: async () => { confirmations++; },
  };
  const run = {
    scope, runId: "11111111-1111-4111-8111-111111111111",
    budget: { remainingModelCalls: 2, toolResponseCharacters: 8000 },
    authorize: async () => true,
    completeText: async () => JSON.stringify({
      draftHash: dataComposeDraftHash(current), decision: "pass", issues: [],
    }),
  };
  const tools = createDataComposeTools({
    documents: documents as never, agent: agent as never, run: run as never,
    authorize: async () => true, scriptedDraft: current, reviewModel: "gemini-3.1-flash-lite",
  });
  const result = await tools[0]!.execute({
    documentId, expectedVersion: 3, authorityVersion: "epoch:7", intent: "只改水壺那一項",
  }, { scope, runId: run.runId, callId: "compose-call", signal: new AbortController().signal });
  assert.equal(result.status, "succeeded");
  assert.equal(result.data?.confirmationPrepared, true);
  assert.equal(result.data?.formalSave, false);
  assert.equal(result.data?.review?.decision, "pass");
  assert.equal(proposed, 1);
  assert.equal(confirmations, 1);
});

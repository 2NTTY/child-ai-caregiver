import assert from "node:assert/strict";
import test from "node:test";
import {
  DATA_COMPOSE_REVIEW_POLICY_VERSION, dataComposeDraftSchema, dataComposeReviewBindingSchema,
} from "../src/shared/data-compose.ts";
import {
  allowFormalComposeSave, assertUneditedItemsPreserved, buildDataComposeReviewEvidence,
  composeReviewStillAllowsProposal, createDataComposeTools, dataComposeDraftHash,
  dataComposeReviewAllows, editedItemKeys, enforceDataComposeReview, finalizeComposedFamilyDocument,
  previewComposedSnapshot,
} from "../server/data-compose.ts";
import type { DocumentSnapshot } from "../src/shared/family-documents.ts";
import type { DataComposeDraft } from "../src/shared/data-compose.ts";
import { AGENT_LIMITS } from "../server/agent-budget.ts";

const scope = {
  userId: "parent", workspaceId: "workspace", childId: "child",
  authorizationVersion: "1", dataVersion: "epoch:1",
};
const documentId = "33333333-3333-4333-8333-333333333333";

function snapshot(overrides: Partial<DocumentSnapshot> = {}): DocumentSnapshot {
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
    ...overrides,
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
    authorize: async () => true, trustedUserMessage: "請只改水壺那一項", scriptedDraft: current, reviewModel: "gemini-3.1-flash-lite",
  });
  const tool = tools.find(item => item.name === "compose_family_data")!;
  const smuggled = await tool.execute({
    documentId, expectedVersion: 3, authorityVersion: "epoch:7", intent: "只改水壺",
    sourceQuote: "請只改水壺那一項", approved: true, skipReview: true,
  }, { scope, runId: run.runId, callId: "c1", signal: new AbortController().signal });
  assert.equal(smuggled.status, "rejected");
  // Strict intent schema drops self-approval flags before execute body runs.
  assert.equal(smuggled.data?.code, "invalid_input");

  const unfinished = await tool.execute({
    documentId, expectedVersion: 3, authorityVersion: "epoch:7", intent: "只改水壺",
    sourceQuote: "請只改水壺那一項",
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
  let proposeOptions: unknown;
  const documents = {
    describe: async () => ({
      authorityVersion: "epoch:7",
      item: { id: documentId, version: 3, current: previous },
    }),
  };
  const agent = {
    writeDocument: async () => { throw new Error("content edits use proposals"); },
    propose: async (_scope: unknown, _runId: unknown, _callId: unknown, _value: unknown, options?: unknown) => {
      proposed++;
      proposeOptions = options;
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
    authorize: async () => true, trustedUserMessage: "請幫我把水壺改成溫水壺", scriptedDraft: current, reviewModel: "gemini-3.1-flash-lite",
  });
  const result = await tools[0]!.execute({
    documentId, expectedVersion: 3, authorityVersion: "epoch:7", intent: "只改水壺那一項",
    sourceQuote: "請幫我把水壺改成溫水壺",
  }, { scope, runId: run.runId, callId: "compose-call", signal: new AbortController().signal });
  assert.equal(result.status, "succeeded");
  assert.equal(result.data?.confirmationPrepared, true);
  assert.equal(result.data?.formalSave, false);
  assert.equal(result.data?.review?.decision, "pass");
  assert.equal(proposed, 1);
  assert.equal(confirmations, 1);
  assert.equal((proposeOptions as { composeReview?: { draftHash: string } } | undefined)?.composeReview?.draftHash,
    dataComposeDraftHash(current));
});

test("review evidence keeps trusted intent and verbatim originals, not only coverageNote", () => {
  const previous = snapshot({
    sources: [{
      id: "src-1", resourceId: "child", kind: "record", version: 1, label: "到診備忘",
      text: "家長備註：記得帶水壺", at: null,
    }],
  });
  const current = draft({
    coverageNote: "generator claims food was requested",
    edits: [{ op: "upsert_item", sectionId: "checklist", itemId: "snack", text: "改成固體食物" }],
  });
  const evidence = buildDataComposeReviewEvidence({
    draft: current, snapshot: previous, trustedIntent: "只改水壺那一項",
  });
  assert.equal(evidence.trustedIntent, "只改水壺那一項");
  assert.equal(evidence.generatorCoverageNote, "generator claims food was requested");
  assert.ok(evidence.originals.some(item => item.itemId === "snack" && item.text === "帶小食"));
  assert.ok(evidence.neighbours.some(item => item.itemId === "bottle" && item.text === "帶水壺"));
  assert.equal(evidence.sources[0]?.excerptComplete, true);
  assert.equal(evidence.truncated, false);
});

test("truncation flags hide incomplete originals and sources", () => {
  const longText = "帶水壺".repeat(100);
  const longSource = "來源全文".repeat(100);
  const previous = snapshot({
    sections: [{
      id: "checklist", title: "清單", kind: "checklist", domain: null,
      items: [{ id: "bottle", text: longText, sourceIds: ["src-1"], checked: false }],
    }],
    sources: [{
      id: "src-1", resourceId: "child", kind: "record", version: 1, label: "長來源",
      text: longSource, at: null,
    }],
  });
  const current = draft({
    edits: [{ op: "upsert_item", sectionId: "checklist", itemId: "bottle", text: "帶溫水壺" }],
  });
  const evidence = buildDataComposeReviewEvidence({
    draft: current, snapshot: previous, trustedIntent: "只改水壺",
  });
  assert.equal(evidence.originals[0]?.textComplete, false);
  assert.equal(evidence.sources[0]?.excerptComplete, false);
  assert.equal(evidence.truncated, true);
  assert.ok((evidence.originals[0]?.text.length ?? 0) < longText.length);
});

test("kettle-to-food rewrite fails review and cannot formalize", async () => {
  const previous = snapshot();
  const drifted = draft({
    coverageNote: "only kettle",
    edits: [{ op: "upsert_item", sectionId: "checklist", itemId: "snack", text: "改成固體食物" }],
  });
  const evidence = buildDataComposeReviewEvidence({
    draft: drifted, snapshot: previous, trustedIntent: "請只改水壺",
  });
  assert.equal(evidence.trustedIntent, "請只改水壺");
  assert.ok(evidence.originals.some(item => item.itemId === "snack"));
  assert.ok(evidence.neighbours.some(item => item.itemId === "bottle"));

  let reviewPayload = "";
  const run = {
    scope, runId: "11111111-1111-4111-8111-111111111111",
    budget: { remainingModelCalls: 2, toolResponseCharacters: 8000 },
    authorize: async () => true,
    completeText: async (input: { user: string }) => {
      reviewPayload = input.user;
      return JSON.stringify({
        draftHash: dataComposeDraftHash(drifted),
        decision: "revise",
        issues: [{ editIndex: 0, reason: "intent asked for kettle only", support: "snack changed" }],
      });
    },
  };
  await assert.rejects(() => enforceDataComposeReview({
    draft: drifted, snapshot: previous, trustedIntent: "請只改水壺", context: run as never,
    provenance: { packVersion: "0.1.39", model: "gemini-3.1-flash-lite" },
  }), (error: Error) => error.message === "compose_review_incomplete");
  assert.match(reviewPayload, /請只改水壺/);
  assert.match(reviewPayload, /帶水壺/);
  assert.match(reviewPayload, /trustedIntent/);
  assert.doesNotMatch(reviewPayload, /"intentCoverage"/);

  const rejected = await finalizeComposedFamilyDocument({
    draft: drifted, review: null, promptVersion: "0.1.39", scope, runId: "run", callId: "call",
    snapshot: previous, agent: {
      writeDocument: async () => { throw new Error("no"); },
      propose: async () => { throw new Error("no propose without review"); },
      requestConfirmation: async () => {},
    } as never, sourceQuote: "請只改水壺",
  });
  assert.equal(rejected.status, "rejected");
});

test("shared budget of 4 covers real compose+review after two outer model turns", async () => {
  assert.equal(AGENT_LIMITS.modelCalls, 4);
  const current = draft();
  const previous = snapshot();
  // Simulate load_capabilities + compose_family_data decision already spent.
  let remaining = 2;
  let modelCalls = 0;
  const documents = {
    describe: async () => ({
      authorityVersion: "epoch:7",
      item: { id: documentId, version: 3, current: previous },
    }),
  };
  const agent = {
    writeDocument: async () => { throw new Error("content edits use proposals"); },
    propose: async (_s: unknown, _r: unknown, _c: unknown, _v: unknown, options?: { composeReview?: unknown }) => {
      assert.ok(options?.composeReview);
      return { id: "22222222-2222-4222-8222-222222222222", runId: "11111111-1111-4111-8111-111111111111",
        version: 1, status: "pending" };
    },
    requestConfirmation: async () => {},
  };
  const run = {
    scope, runId: "11111111-1111-4111-8111-111111111111",
    budget: {
      get remainingModelCalls() { return remaining; },
      toolResponseCharacters: 8000,
    },
    authorize: async () => true,
    completeText: async (input: { attemptKey?: string; user?: string }) => {
      assert.ok(remaining >= 1, "must stay within shared budget of 4");
      remaining -= 1;
      modelCalls += 1;
      // Real path: first spend is compose draft, second is independent review — not scriptedDraft.
      if (modelCalls === 1) {
        assert.match(String(input.attemptKey ?? input.user ?? ""), /data-compose/);
        return JSON.stringify(current);
      }
      return JSON.stringify({
        draftHash: dataComposeDraftHash(current), decision: "pass", issues: [],
      });
    },
  };
  const tools = createDataComposeTools({
    documents: documents as never, agent: agent as never, run: run as never,
    authorize: async () => true, trustedUserMessage: "請只改水壺",
    // Intentionally omit scriptedDraft — classmate F1 rejects scriptedDraft as budget proof.
    reviewModel: "gemini-3.1-flash-lite",
  });
  const result = await tools[0]!.execute({
    documentId, expectedVersion: 3, authorityVersion: "epoch:7", intent: "只改水壺",
    sourceQuote: "請只改水壺",
  }, { scope, runId: run.runId, callId: "budget-call", signal: new AbortController().signal });
  assert.equal(result.status, "succeeded", JSON.stringify(result));
  assert.equal(modelCalls, 2);
  assert.equal(remaining, 0);
  assert.equal(AGENT_LIMITS.modelCalls, 4);
});

test("compose review binding must still match proposal edits at accept time", () => {
  const current = draft();
  const review = passRecord(current);
  assert.equal(composeReviewStillAllowsProposal({
    review, documentId: current.documentId, expectedVersion: current.expectedVersion,
    authorityVersion: current.authorityVersion, edits: current.edits, scope,
  }), true);
  assert.equal(composeReviewStillAllowsProposal({
    review, documentId: current.documentId, expectedVersion: current.expectedVersion,
    authorityVersion: current.authorityVersion,
    edits: [{ op: "upsert_item", sectionId: "checklist", itemId: "snack", text: "改成固體食物" }],
    scope,
  }), false);
});

test("nullable document snapshot is rejected without narrowing crash", async () => {
  const current = draft();
  const documents = {
    describe: async () => ({
      authorityVersion: "epoch:7",
      item: { id: documentId, version: 3, current: null },
    }),
  };
  const run = {
    scope, runId: "11111111-1111-4111-8111-111111111111",
    budget: { remainingModelCalls: 2, toolResponseCharacters: 8000 },
    authorize: async () => true,
  };
  const tools = createDataComposeTools({
    documents: documents as never, agent: {
      writeDocument: async () => null,
      propose: async () => null,
      requestConfirmation: async () => {},
    } as never, run: run as never,
    authorize: async () => true, trustedUserMessage: "請只改水壺", scriptedDraft: current,
  });
  const result = await tools[0]!.execute({
    documentId, expectedVersion: 3, authorityVersion: "epoch:7", intent: "只改水壺",
    sourceQuote: "請只改水壺",
  }, { scope, runId: run.runId, callId: "null-snap", signal: new AbortController().signal });
  assert.equal(result.status, "rejected");
  assert.equal(result.data?.code, "not_found");
});

test("classmate F2: reviewer binds authenticated user message, not model intent args", async () => {
  const previous = snapshot();
  const wrongRemove = draft({
    edits: [{ op: "remove_item", sectionId: "checklist", itemId: "snack" }],
    gaps: [], requiredConfirmations: [],
  });
  let reviewPayload = "";
  let wrote = 0;
  const run = {
    scope, runId: "11111111-1111-4111-8111-111111111111",
    budget: { remainingModelCalls: 2, toolResponseCharacters: 8000 },
    authorize: async () => true,
    completeText: async (input: { user: string }) => {
      reviewPayload = input.user;
      // Reviewer sees trusted user wording「只刪水壺」and must not pass a snack delete.
      assert.match(reviewPayload, /只刪水壺/);
      assert.match(reviewPayload, /generatorIntentSummary/);
      return JSON.stringify({
        draftHash: dataComposeDraftHash(wrongRemove),
        decision: "revise",
        issues: [{ editIndex: 0, reason: "user asked to delete kettle only", support: "snack remove" }],
      });
    },
  };
  const documents = {
    describe: async () => ({
      authorityVersion: "epoch:7",
      item: { id: documentId, version: 3, current: previous },
    }),
  };
  const tools = createDataComposeTools({
    documents: documents as never,
    agent: {
      writeDocument: async () => { wrote++; return { id: documentId }; },
      propose: async () => { throw new Error("must not propose wrong structural delete"); },
      requestConfirmation: async () => {},
    } as never,
    run: run as never,
    authorize: async () => true,
    trustedUserMessage: "只刪水壺",
    scriptedDraft: wrongRemove,
    reviewModel: "gemini-3.1-flash-lite",
  });
  const result = await tools[0]!.execute({
    documentId, expectedVersion: 3, authorityVersion: "epoch:7",
    // Parent model fills the wrong intent summary.
    intent: "只刪小食",
    sourceQuote: "只刪水壺",
  }, { scope, runId: run.runId, callId: "kettle-vs-snack", signal: new AbortController().signal });
  assert.equal(result.status, "rejected");
  assert.equal(result.data?.code, "compose_review_required");
  assert.equal(wrote, 0);
  assert.match(reviewPayload, /"trustedIntent":"只刪水壺"/);
  assert.match(reviewPayload, /"generatorIntentSummary":"只刪小食"/);
});

test("classmate F3: accept freshness uses epoch dataVersion, not mechanical exact string", () => {
  const current = draft();
  const review = passRecord(current);
  // Unrelated write bumped changeSeq; epoch prefix still matches.
  assert.equal(composeReviewStillAllowsProposal({
    review, documentId: current.documentId, expectedVersion: current.expectedVersion,
    authorityVersion: current.authorityVersion, edits: current.edits,
    scope: { ...scope, dataVersion: "epoch:99" },
  }), true);
  // Different storage epoch is not fresh.
  assert.equal(composeReviewStillAllowsProposal({
    review, documentId: current.documentId, expectedVersion: current.expectedVersion,
    authorityVersion: current.authorityVersion, edits: current.edits,
    scope: { ...scope, dataVersion: "other:1" },
  }), false);
  // Authorization change is not fresh.
  assert.equal(composeReviewStillAllowsProposal({
    review, documentId: current.documentId, expectedVersion: current.expectedVersion,
    authorityVersion: current.authorityVersion, edits: current.edits,
    scope: { ...scope, authorizationVersion: "2" },
  }), false);
});

test("classmate F4: fourteen neighbour items in one section set truncated from omitted count", () => {
  const items = Array.from({ length: 14 }, (_, index) => ({
    id: `item-${index}`, text: `項目${index}`, sourceIds: [] as string[], checked: false,
  }));
  const previous = snapshot({
    sections: [{ id: "checklist", title: "清單", kind: "checklist", domain: null, items }],
  });
  // Edit none of the neighbour candidates — remove a fictional path via upsert on first item.
  const current = draft({
    edits: [{ op: "upsert_item", sectionId: "checklist", itemId: "item-0", text: "已改" }],
  });
  const evidence = buildDataComposeReviewEvidence({
    draft: current, snapshot: previous, trustedIntent: "只改第一項",
  });
  assert.equal(evidence.neighbours.length, 12);
  assert.equal(evidence.truncated, true);
  assert.equal(evidence.neighbours.some(item => item.itemId === "item-13"), false);
});

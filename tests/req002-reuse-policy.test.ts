import assert from "node:assert/strict";
import test from "node:test";
import type { KnowledgeCandidate, KnowledgeEvidence, KnowledgeFilter } from "../src/shared/knowledge.ts";
import { AgentBudget, AgentStopped } from "../server/agent-budget.ts";
import { runReadToolBatch, normalizeReadBatchPolicy } from "../server/agent-tool-batch.ts";
import { createKnowledgeRetriever } from "../server/knowledge-retriever.ts";
import type { AgentScope, AgentTool } from "../server/agent-runtime.ts";
import { z } from "zod";
import { queryEmbeddingAttemptKey } from "../server/agent-native-attempt.ts";
import { enforceChatDeliveryReview, repairSourcesRemainBound, type ChatDeliveryDraft } from "../server/chat-delivery-review.ts";
import * as policy from "../server/agent-evidence-reuse.ts";

const filter: KnowledgeFilter = { region: "HK", classification: "official_guidance", age: null, topics: [] };
const current = { sourceId: "sample", versionId: "v1", versionHash: "edition-one", chunkId: "c1", contentHash: "body-one",
  classification: "official_guidance", reviewState: "reviewed", text: "currently reviewed", sourceExcerpt: "current excerpt",
  validUntil: null, originalText: "long original", distance: 0 } as KnowledgeCandidate;
const prior = { ...current, text: "old wording", citedExcerpt: "old quote",
  readCoverage: { kind: "original_segment", complete: true } } as KnowledgeEvidence;

test("prior reuse reads only the owner's current library; unavailable, repinned and reclassified editions are not evidence", async () => {
  let rows = [current];
  const seen: string[] = [];
  const read = async (f: KnowledgeFilter, selection: { libraryUserId: string; chunkIds: string[]; limit: number }) => {
    assert.deepEqual(f, filter); assert.deepEqual(selection.chunkIds, ["c1"]); assert.equal(selection.limit, 6);
    seen.push(selection.libraryUserId);
    return selection.libraryUserId === "session-owner" ? rows : [];
  };
  const check = (owner = "session-owner") => policy.readReusableEvidence(owner, filter, [prior], read);
  const allowed = await check();
  assert.equal(allowed.valid[0]?.text, current.text);
  assert.deepEqual(allowed.valid[0]?.readCoverage, { kind: "reviewed_text_and_excerpt", complete: false });
  assert.equal(allowed.valid[0]?.originalText, undefined); assert.equal(allowed.valid[0]?.citedExcerpt, undefined);
  assert.deepEqual((await check("other-session")).valid, []);
  for (const change of [{ sourceId: "different" }, { versionId: "v2" }, { versionHash: "edition-two" },
    { contentHash: "body-two" }, { classification: "recent_information" as const }, { validUntil: "2000-01-01T00:00:00Z" }]) {
    rows = [{ ...current, ...change }];
    assert.deepEqual((await check()).invalidated, [prior]);
  }
  rows = [];
  assert.deepEqual((await check()).valid, []);
  assert.ok(seen.every(id => id === "session-owner" || id === "other-session"));
});

test("repair guards retain only bound draft sources, check current grants on every reuse and deny unverifiable private evidence", async () => {
  let active = true;
  const consulted: string[] = [];
  const resolver = (id: string) => { consulted.push(id); return id === "selected" ? async () => active : undefined; };
  const check = policy.bindRepairSourceChecks(["selected"], resolver);
  assert.equal(await check(), true); active = false; assert.equal(await check(), false);
  assert.deepEqual(consulted, ["selected"]);
  assert.equal(await policy.bindRepairSourceChecks(["no-proof"], resolver)(), false);
  assert.equal(await policy.bindRepairSourceChecks([], resolver)(), true);
});

test("both query tools use the same durable embedding policy; ordinary reads do not reserve embedding attempts", () => {
  for (const name of ["search_knowledge", "search_source_card_evidence"]) {
    assert.equal(policy.needsQueryEmbeddingKey(true, name), true);
    assert.equal(policy.needsQueryEmbeddingKey(false, name), false);
  }
  assert.equal(policy.needsQueryEmbeddingKey(true, "read_source_card_evidence"), false);
});

test("a sibling stopping the batch while another read awaits its permit prevents that read from starting", async () => {
  const budget = new AgentBudget();
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(settle => { resolve = settle; });
    return { promise, resolve };
  }
  const pendingPermit = deferred<boolean>();
  const waiting = deferred<void>();
  const started: string[] = [];
  const tool: AgentTool = {
    name: "read_fixture", effect: "read", description: "Read a synthetic fixture.",
    parameters: z.object({ ordinal: z.number() }), authorize: async args => {
      if (args.ordinal === 1) { waiting.resolve(); return pendingPermit.promise; }
      return true;
    }, execute: async () => ({ status: "succeeded" }),
  };
  try {
    await assert.rejects(runReadToolBatch({ scope: { userId: "fixture", childId: "child", workspaceId: "w", authorizationVersion: "1", dataVersion: "1" } satisfies AgentScope, budget, authorize: async () => true,
      policy: normalizeReadBatchPolicy({ maxConcurrent: 2 }),
      slice: [0, 1].map(index => ({ index, callId: String(index), tool, args: { ordinal: index } })),
      executeItem: async (item, _args, signal) => {
        started.push(item.callId);
        if (item.index === 0) {
          signal.addEventListener("abort", () => pendingPermit.resolve(true), { once: true });
          await waiting.promise; throw new AgentStopped("cancelled");
        }
        return { status: "succeeded" };
      },
    }), (error: unknown) => error instanceof AgentStopped && error.reason === "cancelled");
    assert.deepEqual(started, ["0"]);
  } finally { pendingPermit.resolve(false); budget.close(); }
});

test("the retriever verifies every cached page member under the same live library grant", async t => {
  const owner = "fixture-owner";
  const row = (chunkId: string, key: string) => ({ ...current, chunkId, key, contentHash: "hash-" + key,
    section: "section", title: "title", keywords: [], originalText: "fixture " + key,
    applicability: { region: "HK", ageBasis: "any" as const, minAgeMonths: null, maxAgeMonths: null, topics: [], conditions: [] } });
  const anchor = row("c1", "first"), neighbor = row("c2", "second");
  let granted = [anchor, neighbor];
  const knowledge = createKnowledgeRetriever({
    enforcesPersonalLibrarySelection: true,
    async candidates(_filter, _vector, selection) {
      assert.equal(selection?.libraryUserId, owner);
      if (selection?.chunkIds) return granted.filter(x => selection.chunkIds!.includes(x.chunkId));
      return granted.filter(x => selection?.afterKey === anchor.key && x.key === neighbor.key);
    },
  }, { embed: async () => assert.fail("no embeddings for exact revalidation") } as never);
  const budget = new AgentBudget(); t.after(() => budget.close());
  const run = knowledge.createRun({ actor: { actorId: owner, kind: "query_embedding", operationId: "fixture-run" }, budget, authorize: async () => true });
  const seeded = await run.revalidateAndSeedEvidence([anchor], filter);
  assert.deepEqual(seeded.valid.map(x => x.chunkId), [anchor.chunkId]);
  assert.deepEqual((await run.readContext(seeded.valid[0]!, filter)).chunks.map(x => x.chunkId), [anchor.chunkId, neighbor.chunkId]);
  assert.equal((await run.readContext(seeded.valid[0]!, filter)).complete, true);
  granted = [anchor];
  await assert.rejects(run.readContext(seeded.valid[0]!, filter), { code: "knowledge_context_source_changed" });
});

test("durable personal-source siblings bind independent native call IDs and reject absent or mismatched attempts", () => {
  const scope = { userId: "parent", workspaceId: "w", childId: "c", authorizationVersion: "1", dataVersion: "1" };
  const runId = "run", name = "search_source_card_evidence", args = { query: "fixture" };
  const event = { id: "one-event", author: "agent", invocationId: "invocation", content: { parts:
    ["read-one", "read-two"].map(id => ({ functionCall: { id, name, args } })) } };
  const context = { agentName: "agent", invocationId: "invocation", functionCallId: "read-one", invocationContext: {
    session: { id: runId, userId: scope.userId, appName: "yuban_hk", events: [event] } } } as never;
  const first = queryEmbeddingAttemptKey(context, scope, runId, name, args);
  const second = queryEmbeddingAttemptKey(context, scope, runId, name, args, "read-two");
  assert.match(first, /^embedding:[a-f0-9]{64}$/u); assert.notEqual(second, first);
  assert.equal(queryEmbeddingAttemptKey(context, scope, runId, name, args, "read-one"), first);
  for (const fn of [() => queryEmbeddingAttemptKey(context, scope, runId, name, args, "missing"),
    () => queryEmbeddingAttemptKey(context, scope, runId, name, { query: "changed" }, "read-two"),
    () => queryEmbeddingAttemptKey(context, { ...scope, userId: "other" }, runId, name, args)])
    assert.throws(fn, (error: unknown) => error instanceof AgentStopped && error.reason === "unavailable");
});

test("the review boundary stops before replay when a draft grant changes, and never widens the repair payload", async () => {
  for (const scenario of ["valid", "revoked", "revoked-before-rereview", "implicit-addition", "changed-at-acceptance", "other-session"] as const) {
    const budget = new AgentBudget();
    const scope = { userId: "fixture-parent", childId: "11111111-2222-4333-8444-555555555555", workspaceId: "fixture",
      authorizationVersion: "1", dataVersion: "epoch:1" };
    let draft: ChatDeliveryDraft = { kind: "caregiving", visibility: "private", scope, serverSubstitutedSourceText: false,
      paragraphs: [{ text: "合成初稿", citationIds: ["fixture"] }], sources: [{ citationId: "fixture", version: "v1",
        contentHash: "a".repeat(64), classification: "official_guidance", excerpt: "合成原文", excerptComplete: true }] };
    let current = true;
    const phases: string[] = [];
    const presentation = () => Promise.resolve({ text: draft.paragraphs[0]!.text, citations: [], retrievalMode: "not_used" as const });
    const surface = { presentation, deliveryDraft: () => draft, bindRepairEvidence: () => async () => current,
      replaceDeliveryAnswer(next: { paragraphs: ChatDeliveryDraft["paragraphs"] }) {
        draft = { ...draft, paragraphs: next.paragraphs, sources: scenario === "implicit-addition"
          ? [...draft.sources, { ...draft.sources[0]!, citationId: "another-implicit-source" }] : draft.sources };
      } };
    try {
      const outcome = enforceChatDeliveryReview({ tools: surface, presentation: await presentation(), provenance: { packVersion: "fixture", model: "fixture" },
        context: { scope: scenario === "other-session" ? { ...scope, dataVersion: "epoch:2" } : scope, budget, runId: "fixture", completeText: async request => {
          phases.push(request.purpose!);
          const payload = JSON.parse(request.user.slice(request.user.indexOf("{")));
          if (phases.length === 1) {
            if (scenario === "revoked") current = false;
            return JSON.stringify({ draftHash: payload.draftHash, decision: "revise", issues: [{ paragraph: 0, reason: "fix", support: "fixture" }] });
          }
          if (request.purpose === "delivery_repair") {
            assert.deepEqual(payload.sources.map((s: { citationId: string }) => s.citationId), ["fixture"]);
            assert.equal("retrievedEvidence" in payload, false);
            if (scenario === "revoked-before-rereview") current = false;
            return JSON.stringify({ kind: "caregiving", paragraphs: [{ text: "合成修訂", citationIds: ["fixture"] }] });
          }
          if (scenario === "changed-at-acceptance") draft = { ...draft, sources: [{ ...draft.sources[0]!, version: "v2" }] };
          return JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] });
        } } });
      if (scenario === "valid") {
        assert.equal((await outcome).review?.decision, "pass");
        assert.deepEqual(phases, ["delivery_review", "delivery_repair", "delivery_review"]);
      } else {
        await assert.rejects(outcome, (err: unknown) => err instanceof AgentStopped
          && err.reason === (["other-session", "implicit-addition", "changed-at-acceptance"].includes(scenario) ? "unauthorized" : "delivery_review_incomplete"));
        assert.deepEqual(phases, scenario === "other-session" ? [] : scenario === "revoked" ? ["delivery_review"]
          : scenario === "changed-at-acceptance" ? ["delivery_review", "delivery_repair", "delivery_review"] : ["delivery_review", "delivery_repair"]);
      }
    } finally { budget.close(); }
  }
});

test("source subsets remain eligible; relabeling, replacement, duplication and excerpt growth never do", () => {
  const one = { citationId: "one", version: "v1", contentHash: "hash", classification: "recent_information" as const, excerpt: "fixture", excerptComplete: false };
  const two = { ...one, citationId: "two" };
  assert.ok(repairSourcesRemainBound([one, two], [{ ...two }]));
  assert.ok(repairSourcesRemainBound([one], []));
  for (const delta of [{ citationId: "three" }, { version: "v2" }, { contentHash: "other" }, { classification: "official_guidance" as const },
    { excerpt: "expanded fixture" }, { excerptComplete: true }]) assert.equal(repairSourcesRemainBound([one], [{ ...one, ...delta }]), false);
  assert.equal(repairSourcesRemainBound([one], [one, one]), false);
});

test("legacy and unconfigured global readers cannot authorize previous-turn reuse", async t => {
  for (const store of [{}, { enforcesPersonalLibrarySelection: false }]) {
    let reads = 0;
    const budget = new AgentBudget(); t.after(() => budget.close());
    const run = createKnowledgeRetriever({ ...store, candidates: async () => { reads++; return [current]; } }, {} as never)
      .createRun({ actor: { kind: "query_embedding", actorId: "owner", operationId: "run" }, budget, authorize: async () => true });
    assert.equal(run.supportsScopedEvidenceReuse, false);
    assert.deepEqual(await run.revalidateAndSeedEvidence([prior], filter), { valid: [], invalidated: [prior] });
    assert.equal(reads, 0);
  }
});

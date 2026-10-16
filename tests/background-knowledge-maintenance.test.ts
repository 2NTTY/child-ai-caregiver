import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKGROUND_KNOWLEDGE_DEFAULT_BUDGET, BACKGROUND_KNOWLEDGE_POLICY_VERSION,
  BACKGROUND_KNOWLEDGE_ROLE_ID, M03_INITIAL_WATCH_IDS,
  allowLiveBackgroundKnowledgePublish, backgroundKnowledgeOperationFingerprint,
  backgroundKnowledgeReviewMatchesCandidate,
  createBackgroundKnowledgeMaintenanceRunner, createProgrammaticKnowledgeReviewStub,
  m03InitialWatchDefinitions, rejectPrivateMaintenanceScope, resolveM03Watch,
  type BackgroundKnowledgeCandidate, type KnowledgeSemanticReviewPort,
} from "../server/background-knowledge-maintenance.ts";
import { SOURCE_WATCHES } from "../server/knowledge-source-catalog.ts";
import { observationHash } from "../server/knowledge-observation.ts";
import type { ObservedContent, SourceFetcher } from "../server/knowledge-refresh-types.ts";

const page = resolveM03Watch("fhs-solid-food")!;
const pdf = resolveM03Watch("fhs-feeding-booklet-en")!;
assert.equal(page.kind, "page");
assert.equal(pdf.kind, "pdf");

const pageItem = (text = "合成固體食物指引：約六個月開始。"): ObservedContent => ({
  url: page.url, title: "固體食物", text, sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: "2026年",
});
const pdfItem = (text = "Synthetic feeding booklet page three."): ObservedContent => ({
  url: pdf.url, title: "Feeding booklet", text, sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null,
  extraction: {
    format: "text_pdf", contentHash: "a".repeat(64), pageStart: 3, pageEnd: 3, totalPages: 20, complete: false,
  },
  pages: [{ page: 3, text, status: "text" }],
});

const fingerprint = (watchId: string, slot = "slot-1") => backgroundKnowledgeOperationFingerprint({
  watchId, revision: "00000000-0000-4000-8000-000000000001",
  workerGeneration: "00000000-0000-4000-8000-000000000002", slot,
});

function mockFetcher(byId: Record<string, ObservedContent | { status: "failed"; reason: "network" } | { status: "unavailable"; httpStatus: 404 }>): SourceFetcher {
  return async (definition) => {
    const entry = byId[definition.id];
    if (!entry) return { status: "failed", reason: "response" };
    if ("status" in entry) return entry;
    return { status: "ok", items: [entry] };
  };
}

function modelReviewPort(mutate?: (binding: ReturnType<typeof Object.assign>) => void): KnowledgeSemanticReviewPort {
  return {
    async review(candidate) {
      const binding = {
        watchId: candidate.watchId,
        observationHash: candidate.observationHash,
        previousObservationHash: candidate.previousObservationHash,
        decision: "approve_candidate" as const,
        reviewKind: "model_review" as const,
        policyVersion: BACKGROUND_KNOWLEDGE_POLICY_VERSION,
        modelReviewCompleted: true,
        growthRuleImpact: "none" as const,
        notes: ["scripted model review"],
      };
      mutate?.(binding);
      return binding;
    },
  };
}

test("M03 first-round allowlist is exactly one FHS page and one PDF from the catalog", () => {
  assert.deepEqual([...M03_INITIAL_WATCH_IDS], ["fhs-solid-food", "fhs-feeding-booklet-en"]);
  const selected = m03InitialWatchDefinitions(SOURCE_WATCHES);
  assert.equal(selected.length, 2);
  assert.ok(selected.every(definition => definition.publisher.includes("家庭健康服務")));
  assert.equal(resolveM03Watch("chp-recent"), null);
  assert.equal(resolveM03Watch("fhs-toddler-development"), null);
});

test("disabled runner returns not_enabled and never reports published success", async () => {
  const runner = createBackgroundKnowledgeMaintenanceRunner(
    { enabled: false, liveFetch: false, livePublish: false },
    { fetch: mockFetcher({ "fhs-solid-food": pageItem() }) },
  );
  assert.equal(runner.enabled, false);
  assert.equal(runner.roleId, BACKGROUND_KNOWLEDGE_ROLE_ID);
  const result = await runner.start({
    watchId: "fhs-solid-food",
    operationFingerprint: fingerprint("fhs-solid-food"),
    workerGeneration: "00000000-0000-4000-8000-000000000002",
    publishMode: "dry_run",
  });
  assert.equal(result.status, "not_enabled");
  assert.equal(result.published, false);
  assert.equal(result.code, "background_knowledge_disabled");
});

test("out-of-scope watch and private family fields are rejected", async () => {
  assert.equal(rejectPrivateMaintenanceScope({ childId: "child-1" }), "knowledge_maintenance_private_scope_forbidden");
  assert.equal(rejectPrivateMaintenanceScope({ familyUserId: "user-1" }), "knowledge_maintenance_private_scope_forbidden");
  assert.equal(rejectPrivateMaintenanceScope({}), null);
  const runner = createBackgroundKnowledgeMaintenanceRunner(
    { enabled: true, liveFetch: false, livePublish: false },
    { fetch: mockFetcher({}) },
  );
  const result = await runner.start({
    watchId: "chp-recent",
    operationFingerprint: fingerprint("chp-recent"),
    workerGeneration: "00000000-0000-4000-8000-000000000002",
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.code, "watch_out_of_scope");
  assert.equal(result.published, false);
});

test("AC-P2M-03 dry path: mock page change -> stub review -> dry_run_ready without live publish", async () => {
  const item = pageItem("新版：約六個月開始引入固體食物。");
  const runner = createBackgroundKnowledgeMaintenanceRunner(
    { enabled: true, liveFetch: false, livePublish: false },
    {
      fetch: mockFetcher({ "fhs-solid-food": item }),
      readObservation: async () => ({ contentHash: observationHash(pageItem("舊版")), unavailable: false }),
    },
  );
  const result = await runner.start({
    watchId: "fhs-solid-food",
    operationFingerprint: fingerprint("fhs-solid-food", "changed"),
    workerGeneration: "00000000-0000-4000-8000-000000000002",
    publishMode: "live",
  });
  assert.equal(result.status, "dry_run_ready");
  assert.equal(result.published, false);
  assert.equal(result.publishMode, "dry_run");
  assert.equal(result.review?.reviewKind, "programmatic_stub");
  assert.equal(result.review?.modelReviewCompleted, false);
  assert.equal(result.review?.policyVersion, BACKGROUND_KNOWLEDGE_POLICY_VERSION);
  assert.equal(result.review?.decision, "approve_candidate");
  assert.equal(result.budget?.usedUnits, 2);
});

test("unchanged hash skips organize and stays unpublished", async () => {
  const item = pageItem();
  const hash = observationHash(item);
  const runner = createBackgroundKnowledgeMaintenanceRunner(
    { enabled: true, liveFetch: false, livePublish: false },
    {
      fetch: mockFetcher({ "fhs-solid-food": item }),
      readObservation: async () => ({ contentHash: hash, unavailable: false }),
    },
  );
  const result = await runner.start({
    watchId: "fhs-solid-food",
    operationFingerprint: fingerprint("fhs-solid-food", "same"),
    workerGeneration: "00000000-0000-4000-8000-000000000002",
  });
  assert.equal(result.status, "unchanged");
  assert.equal(result.published, false);
  assert.equal(result.review?.decision, "unchanged");
  // Reservation still charges the planned units so a crash window cannot skip budget.
  assert.equal(result.budget?.usedUnits, 2);
});

test("PDF fixture follows reviewed page window; unreadable page stays candidate", async () => {
  const bad: ObservedContent = {
    ...pdfItem(),
    pages: [{ page: 3, text: "", status: "unreadable" }],
    extraction: pdfItem().extraction,
  };
  const runner = createBackgroundKnowledgeMaintenanceRunner(
    { enabled: true, liveFetch: false, livePublish: false },
    { fetch: mockFetcher({ "fhs-feeding-booklet-en": bad }) },
  );
  const result = await runner.start({
    watchId: "fhs-feeding-booklet-en",
    operationFingerprint: fingerprint("fhs-feeding-booklet-en", "pdf-bad"),
    workerGeneration: "00000000-0000-4000-8000-000000000002",
  });
  assert.equal(result.status, "candidate_held");
  assert.equal(result.published, false);
  assert.equal(result.review?.decision, "hold_candidate");
});

test("AC-P2M-04: redelivery is idempotent and budget does not reset on restart", async () => {
  const budgets = new Map<string, typeof BACKGROUND_KNOWLEDGE_DEFAULT_BUDGET>();
  const results = new Map<string, Awaited<ReturnType<ReturnType<typeof createBackgroundKnowledgeMaintenanceRunner>["start"]>>>();
  const key = fingerprint("fhs-solid-food", "budget");
  const ports = {
    fetch: mockFetcher({ "fhs-solid-food": pageItem("變更一次") }),
    loadBudget: async (fingerprintValue: string) => budgets.get(fingerprintValue) ?? null,
    saveBudget: async (fingerprintValue: string, budget: typeof BACKGROUND_KNOWLEDGE_DEFAULT_BUDGET) => { budgets.set(fingerprintValue, budget); },
    loadResult: async (fingerprintValue: string) => results.get(fingerprintValue) ?? null,
    saveResult: async (fingerprintValue: string, result: (typeof results extends Map<string, infer V> ? V : never)) => { results.set(fingerprintValue, result); },
  };
  const first = createBackgroundKnowledgeMaintenanceRunner({ enabled: true, liveFetch: false, livePublish: false }, ports);
  const once = await first.start({
    watchId: "fhs-solid-food", operationFingerprint: key,
    workerGeneration: "00000000-0000-4000-8000-000000000002",
  });
  assert.equal(once.status, "dry_run_ready");
  const used = once.budget!.usedUnits;
  // Simulate process restart with the same durable ledger — units must not zero.
  const second = createBackgroundKnowledgeMaintenanceRunner({ enabled: true, liveFetch: false, livePublish: false }, ports);
  const again = await second.start({
    watchId: "fhs-solid-food", operationFingerprint: key,
    workerGeneration: "00000000-0000-4000-8000-000000000002",
  });
  assert.equal(again.status, "already_recorded");
  assert.equal(again.published, false);
  assert.equal(budgets.get(key)?.usedUnits, used);
});

test("budget exhaustion refuses further work without opening a new fingerprint reset", async () => {
  const key = fingerprint("fhs-solid-food", "exhausted");
  const runner = createBackgroundKnowledgeMaintenanceRunner(
    { enabled: true, liveFetch: false, livePublish: false },
    {
      fetch: mockFetcher({ "fhs-solid-food": pageItem("還想再做") }),
      loadBudget: async () => ({ ...BACKGROUND_KNOWLEDGE_DEFAULT_BUDGET, usedUnits: 8, maxUnits: 8 }),
    },
  );
  const result = await runner.start({
    watchId: "fhs-solid-food", operationFingerprint: key,
    workerGeneration: "00000000-0000-4000-8000-000000000002",
  });
  assert.equal(result.status, "budget_exhausted");
  assert.equal(result.published, false);
});

test("stub review never self-reports model review completion", async () => {
  const stub = createProgrammaticKnowledgeReviewStub();
  const binding = await stub.review({
    watchId: "fhs-solid-food",
    definition: page,
    observed: pageItem(),
    observationHash: observationHash(pageItem()),
    previousObservationHash: null,
  });
  assert.equal(binding.reviewKind, "programmatic_stub");
  assert.equal(binding.modelReviewCompleted, false);
  assert.equal(binding.policyVersion, BACKGROUND_KNOWLEDGE_POLICY_VERSION);
});

test("live publish remains gated even when request asks for live", async () => {
  let published = 0;
  const runner = createBackgroundKnowledgeMaintenanceRunner(
    { enabled: true, liveFetch: false, livePublish: false },
    {
      fetch: mockFetcher({ "fhs-solid-food": pageItem("可發布候選") }),
      publish: async () => { published++; return { published: true }; },
    },
  );
  const result = await runner.start({
    watchId: "fhs-solid-food",
    operationFingerprint: fingerprint("fhs-solid-food", "no-live"),
    workerGeneration: "00000000-0000-4000-8000-000000000002",
    publishMode: "live",
  });
  assert.equal(result.status, "dry_run_ready");
  assert.equal(result.published, false);
  assert.equal(published, 0);
});

test("216B: live publish rejects programmatic stub even when livePublish is on", async () => {
  let published = 0;
  const runner = createBackgroundKnowledgeMaintenanceRunner(
    { enabled: true, liveFetch: true, livePublish: true },
    {
      fetch: mockFetcher({ "fhs-solid-food": pageItem("stub 不可 live 發布") }),
      publish: async () => { published++; return { published: true }; },
    },
  );
  const result = await runner.start({
    watchId: "fhs-solid-food",
    operationFingerprint: fingerprint("fhs-solid-food", "stub-live"),
    workerGeneration: "00000000-0000-4000-8000-000000000002",
    publishMode: "live",
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.code, "live_requires_model_review");
  assert.equal(result.published, false);
  assert.equal(result.review?.reviewKind, "programmatic_stub");
  assert.equal(result.review?.modelReviewCompleted, false);
  assert.equal(published, 0);
});

test("216A: parallel same fingerprint publishes only once", async () => {
  let published = 0;
  let releaseGate!: () => void;
  const gate = new Promise<void>(resolve => { releaseGate = resolve; });
  const item = pageItem("並行同指紋");
  const runner = createBackgroundKnowledgeMaintenanceRunner(
    { enabled: true, liveFetch: true, livePublish: true },
    {
      fetch: async (definition, signal) => {
        await gate;
        if (signal.aborted) throw new Error("aborted");
        return { status: "ok", items: [item] };
      },
      review: modelReviewPort(),
      publish: async () => {
        published++;
        return { published: true };
      },
    },
  );
  const request = {
    watchId: "fhs-solid-food" as const,
    operationFingerprint: fingerprint("fhs-solid-food", "parallel"),
    workerGeneration: "00000000-0000-4000-8000-000000000002",
    publishMode: "live" as const,
  };
  const pending = Promise.all([runner.start(request), runner.start(request)]);
  releaseGate();
  const [first, second] = await pending;
  const statuses = [first.status, second.status].sort();
  assert.ok(statuses.includes("published"));
  assert.ok(statuses.includes("already_recorded") || statuses.includes("rejected"));
  assert.equal(published, 1);
  assert.equal(first.published || second.published, true);
  assert.equal(first.published && second.published, false);
});

test("216C: cancelled signal before publish does not publish", async () => {
  let published = 0;
  const controller = new AbortController();
  const runner = createBackgroundKnowledgeMaintenanceRunner(
    { enabled: true, liveFetch: true, livePublish: true },
    {
      fetch: async (definition) => {
        controller.abort();
        return { status: "ok", items: [pageItem("取消後唔發布")] };
      },
      review: modelReviewPort(),
      publish: async () => { published++; return { published: true }; },
    },
  );
  const result = await runner.start({
    watchId: "fhs-solid-food",
    operationFingerprint: fingerprint("fhs-solid-food", "cancel"),
    workerGeneration: "00000000-0000-4000-8000-000000000002",
    publishMode: "live",
  }, controller.signal);
  assert.equal(result.status, "rejected");
  assert.equal(result.code, "cancelled");
  assert.equal(result.published, false);
  assert.equal(published, 0);
});

test("216D: publish requires review binding to match candidate watch/hash/policy", () => {
  const item = pageItem();
  const candidate: BackgroundKnowledgeCandidate = {
    watchId: "fhs-solid-food",
    definition: page,
    observed: item,
    observationHash: observationHash(item),
    previousObservationHash: "b".repeat(64),
  };
  const matched = {
    watchId: candidate.watchId,
    observationHash: candidate.observationHash,
    previousObservationHash: candidate.previousObservationHash,
    decision: "approve_candidate" as const,
    reviewKind: "model_review" as const,
    policyVersion: BACKGROUND_KNOWLEDGE_POLICY_VERSION,
    modelReviewCompleted: true,
    growthRuleImpact: "none" as const,
    notes: ["ok"],
  };
  assert.equal(backgroundKnowledgeReviewMatchesCandidate(matched, candidate), true);
  assert.equal(allowLiveBackgroundKnowledgePublish(matched, candidate), true);
  assert.equal(backgroundKnowledgeReviewMatchesCandidate({
    ...matched, observationHash: "c".repeat(64),
  }, candidate), false);
  assert.equal(allowLiveBackgroundKnowledgePublish({
    ...matched, reviewKind: "programmatic_stub", modelReviewCompleted: false,
  }, candidate), false);
  assert.equal(allowLiveBackgroundKnowledgePublish({
    ...matched, policyVersion: "p3-m03-background-knowledge/1",
  }, candidate), false);
});

test("216B/D: model review binding can authorize scripted live publish once", async () => {
  let published = 0;
  const item = pageItem("模型審核後發布");
  const runner = createBackgroundKnowledgeMaintenanceRunner(
    { enabled: true, liveFetch: true, livePublish: true },
    {
      fetch: mockFetcher({ "fhs-solid-food": item }),
      review: modelReviewPort(),
      publish: async (candidate, review) => {
        assert.equal(allowLiveBackgroundKnowledgePublish(review, candidate), true);
        published++;
        return { published: true };
      },
    },
  );
  const key = fingerprint("fhs-solid-food", "model-live");
  const once = await runner.start({
    watchId: "fhs-solid-food",
    operationFingerprint: key,
    workerGeneration: "00000000-0000-4000-8000-000000000002",
    publishMode: "live",
  });
  assert.equal(once.status, "published");
  assert.equal(once.published, true);
  assert.equal(once.review?.reviewKind, "model_review");
  assert.equal(once.review?.modelReviewCompleted, true);
  assert.equal(published, 1);
  const again = await runner.start({
    watchId: "fhs-solid-food",
    operationFingerprint: key,
    workerGeneration: "00000000-0000-4000-8000-000000000002",
    publishMode: "live",
  });
  assert.equal(again.status, "already_recorded");
  assert.equal(published, 1);
});

test("216D: tampered review binding is rejected before publish", async () => {
  let published = 0;
  const runner = createBackgroundKnowledgeMaintenanceRunner(
    { enabled: true, liveFetch: true, livePublish: true },
    {
      fetch: mockFetcher({ "fhs-solid-food": pageItem("綁定被竄改") }),
      review: modelReviewPort(binding => {
        binding.observationHash = "d".repeat(64);
      }),
      publish: async () => { published++; return { published: true }; },
    },
  );
  const result = await runner.start({
    watchId: "fhs-solid-food",
    operationFingerprint: fingerprint("fhs-solid-food", "tamper"),
    workerGeneration: "00000000-0000-4000-8000-000000000002",
    publishMode: "live",
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.code, "review_binding_mismatch");
  assert.equal(result.published, false);
  assert.equal(published, 0);
});
test("F1: expired lease after stall cannot overwrite budget/result of later runner", async () => {
  const key = fingerprint("fhs-solid-food", "f1-lease");
  const budgets = new Map();
  const results = new Map();
  const claims = new Map();
  let releaseFetchA;
  const fetchAGate = new Promise((resolve) => { releaseFetchA = resolve; });
  let aFetchStarted;
  const aFetchStartedGate = new Promise((resolve) => { aFetchStarted = resolve; });
  const itemA = pageItem("??? A ???");
  const itemB = pageItem("??? B ????");

  const ports = {
    fetch: async (definition, signal) => {
      // First caller (A) stalls; later callers (B) return immediately.
      if (!ports._aEntered) {
        ports._aEntered = true;
        aFetchStarted();
        await fetchAGate;
        if (signal?.aborted) throw new Error("aborted");
        return { status: "ok", items: [itemA] };
      }
      return { status: "ok", items: [itemB] };
    },
    loadBudget: async (fp) => budgets.get(fp) ?? null,
    saveBudget: async (fp, budget) => { budgets.set(fp, budget); },
    loadResult: async (fp) => results.get(fp) ?? null,
    saveResult: async (fp, result) => { results.set(fp, result); },
    claimOperation: async (fp, leaseToken, leaseUntilMs) => {
      const prior = results.get(fp);
      if (prior) return { status: "completed", result: prior };
      const current = claims.get(fp);
      const now = Date.now();
      if (current && current.untilMs > now && current.leaseToken !== leaseToken) {
        return { status: "busy" };
      }
      claims.set(fp, { leaseToken, untilMs: leaseUntilMs });
      return { status: "claimed", leaseToken };
    },
    releaseOperation: async (fp, leaseToken) => {
      const current = claims.get(fp);
      if (current?.leaseToken === leaseToken) claims.delete(fp);
    },
    _aEntered: false,
  };

  const runnerA = createBackgroundKnowledgeMaintenanceRunner(
    { enabled: true, liveFetch: false, livePublish: false },
    ports,
  );
  const request = {
    watchId: "fhs-solid-food",
    operationFingerprint: key,
    workerGeneration: "00000000-0000-4000-8000-000000000002",
    publishMode: "dry_run",
  };
  const pendingA = runnerA.start(request);
  await aFetchStartedGate;
  // Expire A's lease (>120s) while stalled on fetch.
  const held = claims.get(key);
  assert.ok(held);
  claims.set(key, { leaseToken: held.leaseToken, untilMs: Date.now() - 1 });

  const runnerB = createBackgroundKnowledgeMaintenanceRunner(
    { enabled: true, liveFetch: false, livePublish: false },
    ports,
  );
  const resultB = await runnerB.start(request);
  assert.equal(resultB.status, "dry_run_ready");
  assert.equal(resultB.observationHash, observationHash(itemB));
  assert.equal(results.get(key)?.status, "dry_run_ready");
  const budgetAfterB = budgets.get(key)?.usedUnits;
  // A already reserved 2 before stalling; B reserves another 2 on the shared ledger.
  assert.equal(budgetAfterB, 4);

  releaseFetchA();
  const resultA = await pendingA;
  // Stale A must not publish/overwrite: either lease_lost or already_recorded from B.
  assert.equal(resultA.published, false);
  assert.ok(
    resultA.status === "already_recorded"
      || (resultA.status === "rejected" && resultA.code === "operation_lease_lost"),
    `unexpected stale-A status ${resultA.status}/${resultA.code}`,
  );
  // B's durable result and budget must not be overwritten / regressed by stale A.
  assert.equal(results.get(key)?.status, "dry_run_ready");
  assert.equal(results.get(key)?.observationHash, observationHash(itemB));
  assert.ok((budgets.get(key)?.usedUnits ?? 0) >= budgetAfterB);
});

test("F2: publish+receipt then saveResult failure restores receipt hash instead of publishing newer source", async () => {
  const key = fingerprint("fhs-solid-food", "f2-receipt");
  const budgets = new Map();
  const results = new Map();
  const receipts = new Map();
  let saveResultFails = true;
  let published = 0;
  let fetchRound = 0;
  const hashA = observationHash(pageItem("?? A ???"));
  const itemB = pageItem("?? B ???");

  const runner = createBackgroundKnowledgeMaintenanceRunner(
    { enabled: true, liveFetch: true, livePublish: true },
    {
      fetch: async () => {
        fetchRound++;
        if (fetchRound === 1) return { status: "ok", items: [pageItem("?? A ???")] };
        return { status: "ok", items: [itemB] };
      },
      review: modelReviewPort(),
      publish: async (candidate) => {
        published++;
        assert.equal(candidate.observationHash, hashA);
        return { published: true };
      },
      loadBudget: async (fp) => budgets.get(fp) ?? null,
      saveBudget: async (fp, budget) => { budgets.set(fp, budget); },
      loadResult: async (fp) => results.get(fp) ?? null,
      saveResult: async (fp, result) => {
        if (saveResultFails) {
          saveResultFails = false;
          throw new Error("injected saveResult failure after receipt");
        }
        results.set(fp, result);
      },
      loadPublishReceipt: async (fp) => receipts.get(fp) ?? null,
      savePublishReceipt: async (fp, receipt) => { receipts.set(fp, receipt); },
    },
  );

  await assert.rejects(() => runner.start({
    watchId: "fhs-solid-food",
    operationFingerprint: key,
    workerGeneration: "00000000-0000-4000-8000-000000000002",
    publishMode: "live",
  }), /injected saveResult failure/);
  assert.equal(published, 1);
  assert.equal(receipts.get(key)?.observationHash, hashA);
  assert.equal(results.has(key), false);

  const restored = await runner.start({
    watchId: "fhs-solid-food",
    operationFingerprint: key,
    workerGeneration: "00000000-0000-4000-8000-000000000002",
    publishMode: "live",
  });
  assert.equal(restored.status, "published");
  assert.equal(restored.code, "publish_receipt_restored");
  assert.equal(restored.observationHash, hashA);
  assert.equal(restored.published, true);
  assert.equal(published, 1);
  assert.notEqual(restored.observationHash, observationHash(itemB));
});

test("F3: abort during deferred loadPublishReceipt does not call publisher", async () => {
  let published = 0;
  let releaseReceipt;
  const receiptGate = new Promise((resolve) => { releaseReceipt = resolve; });
  const controller = new AbortController();
  const runner = createBackgroundKnowledgeMaintenanceRunner(
    { enabled: true, liveFetch: true, livePublish: true },
    {
      fetch: mockFetcher({ "fhs-solid-food": pageItem("????????") }),
      review: modelReviewPort(),
      loadPublishReceipt: async () => {
        await receiptGate;
        return null;
      },
      publish: async () => { published++; return { published: true }; },
    },
  );
  const pending = runner.start({
    watchId: "fhs-solid-food",
    operationFingerprint: fingerprint("fhs-solid-food", "f3-abort-receipt"),
    workerGeneration: "00000000-0000-4000-8000-000000000002",
    publishMode: "live",
  }, controller.signal);
  // Abort while receipt load is deferred; publisher must stay at 0.
  controller.abort();
  releaseReceipt();
  const result = await pending;
  assert.equal(result.status, "rejected");
  assert.equal(result.code, "cancelled");
  assert.equal(result.published, false);
  assert.equal(published, 0);
});

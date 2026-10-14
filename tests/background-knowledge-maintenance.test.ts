import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKGROUND_KNOWLEDGE_DEFAULT_BUDGET, BACKGROUND_KNOWLEDGE_POLICY_VERSION,
  BACKGROUND_KNOWLEDGE_ROLE_ID, M03_INITIAL_WATCH_IDS, backgroundKnowledgeOperationFingerprint,
  createBackgroundKnowledgeMaintenanceRunner, createProgrammaticKnowledgeReviewStub,
  m03InitialWatchDefinitions, rejectPrivateMaintenanceScope, resolveM03Watch,
} from "../server/background-knowledge-maintenance.ts";
import { SOURCE_WATCHES } from "../server/knowledge-source-catalog.ts";
import { observationHash } from "../server/knowledge-observation.ts";
import type { ObservedContent, SourceFetcher, SourceWatchDefinition } from "../server/knowledge-refresh-types.ts";

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
  assert.ok((result.budget?.usedUnits ?? 0) >= 2);
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
  assert.equal(result.budget?.usedUnits, 1);
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

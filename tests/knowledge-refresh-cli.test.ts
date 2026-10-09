import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { KNOWLEDGE_REFRESH_QUEUE, REFRESH_JOB_OPTIONS } from "../server/knowledge-refresh-types.ts";
import type { RefreshJob, SourceWatchDefinition } from "../server/knowledge-refresh-types.ts";
import type { KnowledgeReviewAssessment } from "../server/knowledge-version-review.ts";

const failureMessage = "knowledge_refresh_operation_failed_check_scope_parameters_and_source_review";
const operator = ["--operator", "synthetic-operator", "--operator-confirmed"];
const hash = "a".repeat(64), versionHash = "b".repeat(64);
const version = "00000000-0000-4000-8000-000000000001";
const definition: SourceWatchDefinition = { id: "official-watch", url: "https://www.fhs.gov.hk/synthetic",
  kind: "page", classification: "official_guidance", publisher: "Synthetic official source",
  termsUrl: "https://www.fhs.gov.hk/terms", audience: "public_noncommercial" };
const data: RefreshJob = { watchId: definition.id, revision: version,
  workerGeneration: "00000000-0000-4000-8000-000000000002" };

test("knowledge refresh CLI operator boundaries and producer output", async context => {
  const directory = await mkdtemp(join(tmpdir(), "knowledge-refresh-cli-synthetic-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const assessmentFile = join(directory, "synthetic-assessment.json");
  // This synthetic payload tests CLI transport only, not review or publication semantics.
  const assessment: KnowledgeReviewAssessment = {
    comparedVersionId: null, comparedHash: null, observationHash: hash,
    changes: [{ key: "synthetic-guidance", oldQuote: null, newQuote: "Public synthetic source",
      meaning: "new", explanation: "Synthetic comparison for the CLI interface." }],
    checks: { age: "Synthetic age check", numbersAndUnits: "Synthetic units check",
      timing: "Synthetic timing check", conditions: "Synthetic conditions check",
      exceptions: "Synthetic exceptions check", prohibitions: "Synthetic prohibitions check",
      withdrawal: "Synthetic withdrawal check" },
    questions: [{ query: "Synthetic question", expectedKeys: ["synthetic-guidance"], reason: "Synthetic coverage" }],
    growthRuleImpact: "none", growthRuleReason: "Synthetic CLI fixture", decision: "approve",
  };
  await writeFile(assessmentFile, JSON.stringify(assessment));
  const publication = { status: "published" };
  const approve = ["approve", definition.id, ...operator, "--source-and-terms-checked",
    "--observation-hash", hash, "--version", version, "--version-hash", versionHash, "--assessment", assessmentFile];
  function approveWithout(flag: string, hasValue = false) {
    const args = [...approve], index = args.indexOf(flag);
    assert.notEqual(index, -1);
    args.splice(index, hasValue ? 2 : 1);
    return args;
  }
  function approveWith(flag: string, value: string) {
    const args = [...approve], index = args.indexOf(flag);
    assert.notEqual(index, -1);
    args[index + 1] = value;
    return args;
  }
  const events: string[] = [], calls: unknown[][] = [], output: string[] = [], errors: string[] = [];
  let jobs: { definition: SourceWatchDefinition; data: RefreshJob }[] = [];
  let alreadyPending = false, stageError: string | undefined, sequence = 0;
  const pool = { async end() { events.push("pool.end"); } };
  const store = {
    async list() { calls.push(["list"]); if (stageError === "list") throw new Error("private database detail"); return { watches: [] }; },
    async inspect(id: string) { calls.push(["inspect", id]); return { source_id: id, document: { text: "Public synthetic source" } }; },
    async register(id: string, alias: string) { calls.push(["register", id, alias]); },
    async disable(id: string) { calls.push(["disable", id]); },
    async approve(...args: unknown[]) { calls.push(["approve", ...args]); return publication; },
    async jobs() { events.push("store.jobs"); return jobs; },
  };
  const queue = {
    async start() { events.push("queue.start"); if (stageError === "start") throw new Error("private queue detail"); },
    async stop() { events.push("queue.stop"); if (stageError === "stop") throw new Error("private shutdown detail"); },
    boss: { async send(name: string, input: RefreshJob, options: { id: string }) {
      events.push("queue.send"); calls.push(["send", name, input, options]);
      return alreadyPending ? null : options.id;
    } },
  };
  // Node 24.19 supports exports; the pinned Node types predate this option.
  const moduleOptions = (exports: Record<string, unknown>) => ({ cache: false, exports });
  context.mock.module("../server/knowledge-source-catalog.ts", moduleOptions({ SOURCE_WATCHES: [definition] }));
  context.mock.module("../server/config.ts", moduleOptions({ readServerConfig: () => { events.push("config"); return {}; } }));
  context.mock.module("../server/database.ts", moduleOptions({ createPool: () => { events.push("pool.create"); return pool; } }));
  context.mock.module("../server/knowledge-refresh-store.ts", moduleOptions({
    createKnowledgeRefreshStore: (actualPool: unknown, catalog: unknown) => {
      assert.equal(actualPool, pool); assert.deepEqual(catalog, [definition]); return store;
    },
  }));
  context.mock.module("../server/worker-queue.ts", moduleOptions({
    createWorkerQueue: (actualPool: unknown, mode: string) => {
      assert.equal(actualPool, pool); assert.equal(mode, "producer"); events.push("queue.create"); return queue;
    },
  }));
  // Let Node emit module-mock setup warnings before capturing CLI output.
  await new Promise<void>(resolve => setImmediate(resolve));
  context.mock.method(console, "log", (value: unknown) => { output.push(String(value)); });
  context.mock.method(console, "error", (value: unknown) => { errors.push(String(value)); });

  async function run(args: string[], settings: { pending?: boolean; inactive?: boolean; error?: string } = {}) {
    events.length = 0; calls.length = 0; output.length = 0; errors.length = 0;
    jobs = settings.inactive ? [] : [{ definition, data }];
    alreadyPending = settings.pending ?? false; stageError = settings.error;
    const previousArgs = process.argv, previousExit = process.exitCode;
    process.argv = [process.execPath, "knowledge-refresh.mjs", ...args];
    process.exitCode = undefined;
    try {
      await import(new URL(`../scripts/knowledge-refresh.mjs?cli-case=${sequence++}`, import.meta.url).href);
      return process.exitCode;
    } finally { process.argv = previousArgs; process.exitCode = previousExit; }
  }

  await context.test("catalog reads fixed public definitions without config or database access", async () => {
    assert.equal(await run(["catalog"]), undefined);
    assert.deepEqual(JSON.parse(output[0]), [definition]);
    assert.deepEqual(events, []); assert.deepEqual(calls, []); assert.deepEqual(errors, []);
  });

  await context.test("missing confirmations, invalid values, unknown and duplicate flags stop before database access", async () => {
    const invalid = [
      [], ["fetch", definition.id], ["catalog", "extra"], ["list", "--operator-confirmed"],
      ["inspect"], ["inspect", "../source"], ["inspect", "Source"], ["inspect", "a".repeat(81)],
      ["register", definition.id, "--operator", "alias", "--source-and-terms-checked"],
      ["register", definition.id, ...operator], ["disable", definition.id, "--operator-confirmed"],
      ["disable", definition.id, "--operator", "private alias", "--operator-confirmed"],
      ["disable", definition.id, ...operator, "--operator-confirmed"],
      ["disable", definition.id, "--operator-confirmed", "--operator"],
      ["check", definition.id, ...operator], ["check", definition.id, ...operator, "--unknown"],
      ...["--operator-confirmed", "--source-and-terms-checked"].map(flag => approveWithout(flag)),
      ...["--operator", "--observation-hash", "--version", "--version-hash", "--assessment"].map(flag => approveWithout(flag, true)),
      approveWith("--operator", "private alias"),
      approveWith("--observation-hash", "a".repeat(63)),
      approveWith("--version-hash", "g".repeat(64)),
      approveWith("--version", "invalid-version"),
      approveWith("--version", "00000000-0000-4000-0000-000000000001"),
      [...approve, "--unknown"], [...approve, "--operator-confirmed"],
      [...approve, "--assessment", assessmentFile], [...approveWithout("--assessment", true), "--assessment"],
    ];
    for (const args of invalid) {
      assert.equal(await run(args), 1, JSON.stringify(args));
      assert.deepEqual(events, []); assert.deepEqual(calls, []); assert.deepEqual(output, []);
      assert.deepEqual(errors, [failureMessage]);
    }
  });

  await context.test("public reads and approved maintenance use only their store methods", async () => {
    assert.equal(await run(["list"]), undefined);
    assert.deepEqual(JSON.parse(output[0]), { watches: [] }); assert.deepEqual(calls, [["list"]]);
    assert.equal(await run(["inspect", definition.id]), undefined);
    assert.deepEqual(calls, [["inspect", definition.id]]);
    assert.equal(await run(["register", definition.id, ...operator, "--source-and-terms-checked"]), undefined);
    assert.deepEqual(calls, [["register", definition.id, "synthetic-operator"]]);
    assert.equal(events.includes("queue.create"), false);
    assert.equal(await run(["disable", "retired-watch", ...operator]), undefined);
    assert.deepEqual(calls, [["disable", "retired-watch"]]);
    assert.equal(await run(approve), undefined);
    assert.deepEqual(calls, [["approve", definition.id, hash, version, versionHash, "synthetic-operator", assessment]]);
    assert.deepEqual(output.map(value => JSON.parse(value)), [{ event: "knowledge_observation_review",
      sourceId: definition.id, versionId: version, publication }]);
    assert.deepEqual(errors, []);
    assert.deepEqual(events, ["config", "pool.create", "pool.end"]);
    assert.equal(events.at(-1), "pool.end");
  });

  await context.test("missing, oversized and malformed assessment files fail privately and close the pool", async () => {
    const missingFile = join(directory, "missing-synthetic-assessment.json");
    const oversizedFile = join(directory, "oversized-synthetic-assessment.json");
    const malformedFile = join(directory, "malformed-synthetic-assessment.json");
    await writeFile(oversizedFile, JSON.stringify("x".repeat(255999)));
    await writeFile(malformedFile, '{"synthetic-private-detail":');
    for (const file of [missingFile, oversizedFile, malformedFile]) {
      assert.equal(await run(approveWith("--assessment", file)), 1);
      assert.deepEqual(calls, []); assert.deepEqual(output, []);
      assert.deepEqual(errors, [failureMessage]);
      assert.deepEqual(events, ["config", "pool.create", "pool.end"]);
    }
  });

  await context.test("checks enqueue current references and distinguish queued from already pending", async () => {
    for (const pending of [false, true]) {
      assert.equal(await run(["check", definition.id, ...operator, "--approved-source-check"], { pending }), undefined);
      assert.deepEqual(events, ["config", "pool.create", "queue.create", "queue.start", "store.jobs", "queue.send", "queue.stop", "pool.end"]);
      const [, name, input, options] = calls[0] as [string, string, RefreshJob, Record<string, unknown>];
      assert.equal(name, KNOWLEDGE_REFRESH_QUEUE); assert.deepEqual(input, data);
      assert.match(options.id as string, /^[a-f0-9-]{36}$/);
      assert.deepEqual(options, { ...REFRESH_JOB_OPTIONS, id: options.id, singletonKey: definition.id });
      assert.deepEqual(JSON.parse(output[0]), { event: "knowledge_source_check", watchId: definition.id,
        jobId: pending ? null : options.id, status: pending ? "already_pending" : "queued" });
    }
  });

  await context.test("inactive or unlisted watches cannot enqueue", async () => {
    assert.equal(await run(["check", "unlisted-watch", ...operator, "--approved-source-check"]), 1);
    assert.equal(events.length, 0);
    assert.equal(await run(["check", definition.id, ...operator, "--approved-source-check"], { inactive: true }), 1);
    assert.equal(events.includes("queue.send"), false);
    assert.deepEqual(events.slice(-2), ["queue.stop", "pool.end"]);
    assert.deepEqual(errors, [failureMessage]);
  });

  await context.test("failures use a fixed message and still close queue before pool", async () => {
    assert.equal(await run(["list"], { error: "list" }), 1);
    assert.deepEqual(errors, [failureMessage]); assert.equal(events.at(-1), "pool.end");
    for (const error of ["start", "stop"]) {
      assert.equal(await run(["check", definition.id, ...operator, "--approved-source-check"], { error }), 1);
      assert.deepEqual(errors, [failureMessage]); assert.deepEqual(events.slice(-2), ["queue.stop", "pool.end"]);
    }
  });
});

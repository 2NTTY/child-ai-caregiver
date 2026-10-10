import assert from "node:assert/strict";
import test from "node:test";
import { workContinuationSchema } from "../src/shared/agent-work.ts";
import { handleProductAgentRequest } from "../server/product-agent-api.ts";

// Executable specification examples, NOT a Firestore adapter or product worker test.
// The hand-authored traces below describe evidence a future implementation must
// produce. The validator rejects contradictory traces; it does not implement
// claim, cancellation, storage, retries, model execution, or access control.
// The last test alone exercises the existing DTO and HTTP handler compatibility.
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const E = "00000000-0000-4000-8000-000000000003";
const R = "00000000-0000-4000-8000-000000000004";
const C = "00000000-0000-4000-8000-000000000005";
const scope = { project: "synthetic-project", namespace: "synthetic-contract", ownerId: "synthetic-owner",
  childId: C, storageEpoch: "synthetic-epoch", workerGeneration: "synthetic-generation", eventId: E };
type Scope = typeof scope;
type Candidate = { workId: string; workVersion: number; eligible: boolean };
type Member = { workId: string; workVersion: number; state: "included" | "not_included" };
type Snapshot = { format: 1; scope: Scope; runId: string | null; members: Member[] };
type Context = { eventId: string; works: { id: string; version: number }[] };
type Attempt = { id: string; authority: "granted" | "denied"; read: "complete" | "failed" | "incomplete";
  outcome: "committed" | "aborted"; candidates: Candidate[] };
type Step = { kind: "provider_start"; runId: string; inputAttemptId: string }
  | { kind: "cancel"; workId: string; newVersion: number }
  | { kind: "receipt_saved"; runId: string }
  | { kind: "late_result_discarded" }
  | { kind: "redelivery"; runId: string; newGenerationCalls: number }
  | { kind: "terminal"; state: "completed" | "stopped" | "unknown" };
type Trace = { attempts: Attempt[]; commit: { attemptId: string; snapshot: Snapshot; returnedContext: Context | null } | null;
  response: "success" | "denied" | "error"; steps: Step[]; finalSnapshot: Snapshot | null };

function validateTrace(trace: Trace) {
  const committed = trace.attempts.filter(attempt => attempt.outcome === "committed");
  assert.equal(new Set(trace.attempts.map(attempt => attempt.id)).size, trace.attempts.length, "unique attempt IDs");
  assert.ok(committed.length <= 1, "one successful claim commit");
  if (!trace.commit) {
    assert.equal(committed.length, 0, "no partial commit");
    assert.equal(trace.finalSnapshot, null, "failed commit cannot publish a snapshot");
    assert.equal(trace.steps.length, 0, "failed claim cannot start or finish a run");
    assert.notEqual(trace.response, "success", "failed authority/read/commit is not ordinary unknown");
    return;
  }
  assert.equal(trace.response, "success");
  assert.equal(committed.length, 1);
  const attempt = committed[0], { snapshot, returnedContext } = trace.commit;
  assert.equal(trace.commit.attemptId, attempt.id, "context comes from successful attempt");
  assert.equal(attempt.authority, "granted", "authority failure is not member exclusion");
  assert.equal(attempt.read, "complete", "partial/error reads cannot close the candidate set");
  assert.ok(attempt.candidates.length > 0 && attempt.candidates.length <= 5, "complete bounded candidate set");
  assert.equal(new Set(attempt.candidates.map(candidate => candidate.workId)).size, attempt.candidates.length, "unique candidates");
  assert.deepEqual(snapshot.scope, scope, "original event and authority binding");
  assert.equal(snapshot.format, 1);
  assert.deepEqual(snapshot.members, attempt.candidates.map(candidate => ({ workId: candidate.workId,
    workVersion: candidate.workVersion, state: candidate.eligible ? "included" : "not_included" })), "classify every original candidate once");
  const included = snapshot.members.filter(member => member.state === "included");
  if (included.length) {
    assert.equal(snapshot.runId, R, "original deterministic run binding");
    assert.deepEqual(returnedContext, { eventId: E, works: included.map(member => ({ id: member.workId, version: member.workVersion })) },
      "never reselect context outside the committed attempt");
  } else {
    assert.equal(snapshot.runId, null, "all excluded is explicitly no run");
    assert.equal(returnedContext, null);
  }
  let invalidated = false, providerStarts = 0, receiptSaved = false;
  for (const step of trace.steps) {
    if (step.kind === "cancel") {
      const member = snapshot.members.find(member => member.workId === step.workId);
      assert.ok(member); assert.ok(step.newVersion > member.workVersion);
      invalidated = true;
    } else if (step.kind === "provider_start") {
      assert.ok(snapshot.runId); assert.equal(step.runId, snapshot.runId);
      assert.equal(step.inputAttemptId, attempt.id);
      assert.equal(invalidated, false, "invalidated loaded context cannot start another provider call");
      assert.equal(++providerStarts, 1, "these one-call examples cannot regenerate the original run");
    } else if (step.kind === "receipt_saved") {
      assert.equal(step.runId, snapshot.runId); assert.ok(snapshot.runId);
      assert.equal(invalidated, false, "late result cannot be saved as current after cancellation");
      receiptSaved = true;
    } else if (step.kind === "late_result_discarded") {
      assert.equal(invalidated, true);
    } else if (step.kind === "redelivery") {
      assert.ok(snapshot.runId); assert.equal(step.runId, snapshot.runId);
      assert.equal(step.newGenerationCalls, 0, "redelivery reads the original run only");
    } else if (step.state === "completed") {
      assert.equal(receiptSaved, true, "batch completion requires its original receipt");
    }
  }
  assert.deepEqual(trace.finalSnapshot, snapshot, "cancel/retry/terminal cannot rewrite historical input evidence");
}

const mixedSnapshot: Snapshot = { format: 1, scope, runId: R, members: [
  { workId: A, workVersion: 1, state: "not_included" }, { workId: B, workVersion: 1, state: "included" }] };
const mixed: Trace = {
  attempts: [{ id: "committed", authority: "granted", read: "complete", outcome: "committed", candidates: [
    { workId: A, workVersion: 1, eligible: false }, { workId: B, workVersion: 1, eligible: true }] }],
  commit: { attemptId: "committed", snapshot: mixedSnapshot, returnedContext: { eventId: E, works: [{ id: B, version: 1 }] } },
  response: "success", steps: [{ kind: "provider_start", runId: R, inputAttemptId: "committed" },
    { kind: "receipt_saved", runId: R }, { kind: "terminal", state: "completed" }], finalSnapshot: mixedSnapshot,
};
function rejects(trace: Trace, expected: RegExp) { assert.throws(() => validateTrace(trace), expected); }

test("synthetic contract: cancellation before claim excludes only that original constituent", () => {
  validateTrace(mixed);
  const copiedBatchOutcome = structuredClone(mixed);
  (copiedBatchOutcome.commit!.snapshot.members[0] as { state: string }).state = "completed";
  rejects(copiedBatchOutcome, /classify every original candidate/);
  const wrongVersion = structuredClone(mixed); wrongVersion.commit!.snapshot.members[0].workVersion = 2;
  rejects(wrongVersion, /classify every original candidate/);
});

test("synthetic contract: claim-time inclusion survives cancellation without authorizing stale input", () => {
  for (const alreadyStarted of [false, true]) {
    const trace = structuredClone(mixed);
    trace.steps = [...(alreadyStarted ? [{ kind: "provider_start" as const, runId: R, inputAttemptId: "committed" }] : []),
      { kind: "cancel", workId: B, newVersion: 2 }, { kind: "late_result_discarded" }, { kind: "terminal", state: "unknown" }];
    validateTrace(trace);
    const stale = structuredClone(trace); stale.steps.push({ kind: "provider_start", runId: R, inputAttemptId: "committed" });
    rejects(stale, /invalidated loaded context/);
    const lateSave = structuredClone(trace); lateSave.steps.push({ kind: "receipt_saved", runId: R });
    rejects(lateSave, /late result cannot be saved/);
    const rewritten = structuredClone(trace); rewritten.finalSnapshot = structuredClone(trace.finalSnapshot!);
    rewritten.finalSnapshot.members[1].state = "not_included";
    rejects(rewritten, /cannot rewrite historical input evidence/);
  }
});

test("synthetic contract: only the successful callback attempt can supply snapshot and context", () => {
  const trace = structuredClone(mixed);
  trace.attempts.unshift({ id: "aborted", authority: "granted", read: "complete", outcome: "aborted", candidates: [
    { workId: A, workVersion: 1, eligible: true }, { workId: B, workVersion: 1, eligible: true }] });
  validateTrace(trace);
  const stale = structuredClone(trace); stale.commit!.returnedContext!.works.unshift({ id: A, version: 1 });
  rejects(stale, /never reselect context/);
  const failed: Trace = { attempts: [{ ...trace.attempts[1], outcome: "aborted" }], commit: null,
    response: "error", steps: [], finalSnapshot: null };
  validateTrace(failed);
  const leaked = structuredClone(failed); leaked.finalSnapshot = structuredClone(mixedSnapshot);
  rejects(leaked, /failed commit cannot publish/);
});

test("synthetic contract: committed claim survives restart and receipt acknowledgement loss", () => {
  for (const savedReceipt of [false, true]) {
    const trace = structuredClone(mixed);
    trace.steps = savedReceipt ? [...mixed.steps] : [];
    trace.steps.push({ kind: "redelivery", runId: R, newGenerationCalls: 0 });
    if (!savedReceipt) trace.steps.push({ kind: "terminal", state: "unknown" });
    validateTrace(trace);
    const replay = structuredClone(trace);
    (replay.steps.find(step => step.kind === "redelivery") as Extract<Step, { kind: "redelivery" }>).newGenerationCalls = 1;
    rejects(replay, /redelivery reads the original run only/);
  }
});

test("synthetic contract: complete all-excluded and invalid candidate sets remain distinct", () => {
  const trace = structuredClone(mixed);
  trace.attempts[0].candidates[1].eligible = false;
  trace.commit!.snapshot.members[1].state = "not_included";
  trace.commit!.snapshot.runId = null; trace.commit!.returnedContext = null; trace.steps = [];
  trace.finalSnapshot = structuredClone(trace.commit!.snapshot); validateTrace(trace);
  const incomplete = structuredClone(mixed); incomplete.attempts[0].read = "incomplete";
  rejects(incomplete, /partial\/error reads cannot close/);
  const omitted = structuredClone(mixed); omitted.commit!.snapshot.members.shift();
  rejects(omitted, /classify every original candidate/);
  const oversized = structuredClone(mixed);
  oversized.attempts[0].candidates = Array.from({ length: 6 }, (_, index) => ({ workId: String(index), workVersion: 1, eligible: false }));
  rejects(oversized, /complete bounded candidate set/);
  const duplicate = structuredClone(mixed); duplicate.attempts[0].candidates[1].workId = A;
  rejects(duplicate, /unique candidates/);
});

test("synthetic contract: missing historical evidence is not an authority or read failure", () => {
  // Hand-authored observations, rather than a new production reader.
  const reads = [
    { authority: "granted", storageRead: "complete", snapshot: "historical_absent", result: "unknown" },
    { authority: "granted", storageRead: "complete", snapshot: "unclaimed", result: "omitted" },
    { authority: "denied", storageRead: "not_performed", snapshot: "unavailable", result: "denied" },
    { authority: "granted", storageRead: "failed", snapshot: "unavailable", result: "error" },
    { authority: "granted", storageRead: "complete", snapshot: "binding_invalid", result: "error" },
    { authority: "granted", storageRead: "complete", snapshot: "new_claim_missing", result: "error" },
  ];
  function validateRead(read: typeof reads[number]) {
    if (read.result === "unknown") {
      assert.equal(read.authority, "granted", "unknown requires readable authority");
      assert.equal(read.storageRead, "complete", "unknown requires a successful read");
      assert.equal(read.snapshot, "historical_absent", "only absent historical evidence is ordinary unknown");
    } else if (read.result === "omitted") {
      assert.equal(read.authority, "granted"); assert.equal(read.storageRead, "complete"); assert.equal(read.snapshot, "unclaimed");
    } else if (read.authority === "denied") assert.equal(read.result, "denied");
    else assert.equal(read.result, "error");
  }
  for (const read of reads) validateRead(read);
  for (const read of reads.slice(1)) assert.throws(() => validateRead({ ...read, result: "unknown" }), /unknown requires|only absent historical/);
  for (const fault of ["denied", "failed"] as const) {
    const trace = structuredClone(mixed);
    if (fault === "denied") trace.attempts[0].authority = "denied"; else trace.attempts[0].read = "failed";
    rejects(trace, /authority failure|partial\/error reads/);
  }
  for (const field of ["project", "namespace", "ownerId", "childId", "storageEpoch", "workerGeneration", "eventId"] as const) {
    const trace = structuredClone(mixed); trace.commit!.snapshot.scope[field] = "different";
    rejects(trace, /original event and authority binding/);
  }
  const wrongRun = structuredClone(mixed); wrongRun.commit!.snapshot.runId = A;
  rejects(wrongRun, /original deterministic run binding/);
});

test("existing product compatibility: strict DTO rejects new fields and work route ignores a single opt-in", async () => {
  const legacy = { eventId: E, runId: R, state: "completed", createdAt: "2026-10-10T02:00:00.000Z" };
  assert.equal(workContinuationSchema.safeParse(legacy).success, true);
  assert.equal(workContinuationSchema.safeParse({ ...legacy,
    participation: { state: "not_included", workVersion: 1 } }).success, false);
  let calls = 0;
  const page = { items: [{ latestFollowUp: legacy }], complete: true, nextCursor: null };
  const options = { isCurrentUser: async () => true,
    store: { readWork: async (user: string, child: string, input: unknown) => {
      calls++; assert.equal(user, scope.ownerId); assert.equal(child, C);
      assert.deepEqual(input, { workId: null, cursor: null }); return page;
    } } } as unknown as Parameters<typeof handleProductAgentRequest>[2];
  const response = await handleProductAgentRequest(new Request(`https://synthetic.invalid/api/children/${C}/agent/work?followUpEvidence=1`,
    { headers: { "x-expected-user-id": scope.ownerId } }), scope.ownerId, options);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), page); assert.equal(calls, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { PgBoss } from "pg-boss";
import type { Pool, PoolClient } from "pg";
import { appendOnlineChange } from "../server/online-change.ts";
import type { KnowledgeReviewAssessment } from "../server/knowledge-version-review.ts";
import { continuationKnowledgeMeaning, projectWorkContinuationContext, WORK_CONTINUATION_CONTEXT_LIMIT,
  type WorkContinuationContextEntry, type AgentWorkContinuationStore } from "../server/agent-work-continuation.ts";
import { createAgentWorkContinuationWorker, workContinuationJobSchema } from "../server/agent-work-continuation-worker.ts";
import { saveAgentWorkSchema } from "../src/shared/agent-work.ts";

// Offline evidence for pure semantic selection and retry/reference behavior. SQL has a separate approved entry.
test("continuations require a useful semantic basis and metadata notices preserve deferral", async () => {
  const wakeQueries: string[] = [];
  const client = { async query(sql: string) {
    if (sql.startsWith("UPDATE agent_work_followups")) wakeQueries.push(sql);
    const rows = sql.startsWith("UPDATE workspaces") ? [{ change_seq: "1" }] : sql.startsWith("SELECT 1 FROM app_migrations") ? [{}] : [];
    return { rows, rowCount: rows.length };
  } } as unknown as PoolClient;
  const workspaceId = randomUUID(), childId = randomUUID();
  await appendOnlineChange(client, workspaceId, "memory", childId, false, "synthetic-owner", false, { suppressWorkWake: true });
  assert.equal(wakeQueries.length, 0);
  await appendOnlineChange(client, workspaceId, "memory", childId, false, "synthetic-owner");
  assert.equal(wakeQueries.length, 1);
  const kinds = ["task", "memory_fact", "private_note", "private_source", "concern", "family_document", "care_record", "receipt"] as const;
  const sources = Array.from({ length: 4 }, (_, index) => `synthetic-${index}-` + "x".repeat(68));
  const maximal: WorkContinuationContextEntry[] = Array.from({ length: 5 }, () => {
    const resources = kinds.map(kind => ({ kind, id: randomUUID(), version: 2147483646 }));
    return { work: { id: randomUUID(), childId, version: 2147483646, status: "waiting", goal: "\u0000".repeat(500), focus: "x".repeat(300),
      questions: ["x".repeat(300), "x".repeat(300)], sourceMessageIds: Array.from({ length: 6 }, () => randomUUID()), resources,
      followUp: { reason: "x".repeat(300), dueAt: new Date().toISOString(), watchResources: true, knowledgeSourceIds: sources } },
      textPartial: true, knowledgeSourceIds: sources,
      changes: { due: true, resources: resources.map(resource => ({ ...resource, previousVersion: 2147483645, status: "scheduled" })),
        knowledge: sources.map(sourceId => ({ sourceId, versionId: randomUUID(), meaning: "material" })) } };
  });
  const bounded = projectWorkContinuationContext(randomUUID(), maximal);
  assert.ok(JSON.stringify(bounded).length <= WORK_CONTINUATION_CONTEXT_LIMIT);
  assert.equal(bounded.works.length, 5);
  assert.deepEqual(bounded.works.map(entry => (entry.work as { id: string }).id), maximal.map(entry => entry.work.id));
  assert.ok(bounded.works.some(entry => entry.referencesPartial === true));
  const oldId = randomUUID(), newId = randomUUID(), hash = "a".repeat(64);
  const before = { sourceId: "synthetic-official", versionId: oldId, hash, available: true };
  const assessment = { comparedVersionId: oldId, comparedHash: hash, changes: [{ meaning: "unchanged" }] } as KnowledgeReviewAssessment;
  const next = { ...before, versionId: newId, assessment };
  assert.equal(continuationKnowledgeMeaning(before, next), null);
  assert.equal(continuationKnowledgeMeaning(before, { ...next, assessment: { ...assessment, changes: [{ meaning: "changed" }] } as KnowledgeReviewAssessment }), "material");
  assert.equal(continuationKnowledgeMeaning({ ...before, versionId: randomUUID() }, next), "recheck");
  assert.equal(continuationKnowledgeMeaning(before, { ...next, available: false }), null);
  assert.equal(continuationKnowledgeMeaning(before, { ...next, versionId: oldId, hash: "b".repeat(64) }), null);
  const values = { goal: "Synthetic useful work", focus: "", questions: [], sourceMessageIds: [], resources: [], pending: [], status: "waiting" };
  const input = { operationId: randomUUID(), workId: null, expectedVersion: 0, values };
  assert.equal(saveAgentWorkSchema.safeParse({ ...input, values: { ...values, followUp: { reason: "Synthetic basis", dueAt: null, watchResources: false, knowledgeSourceIds: [] } } }).success, false);
  assert.equal(saveAgentWorkSchema.safeParse({ ...input, values: { ...values, followUp: { reason: "Synthetic basis", dueAt: null, watchResources: true, knowledgeSourceIds: ["synthetic-official"] } } }).success, true);
  assert.equal(workContinuationJobSchema.safeParse({ eventId: randomUUID(), jobId: randomUUID(), workerGeneration: randomUUID(), storageEpoch: randomUUID(), goal: "Private text" }).success, false);
});

test("the continuation worker retries one original reference and respects a settled or stale event", async () => {
  const job = { eventId: randomUUID(), jobId: randomUUID(), workerGeneration: randomUUID(), storageEpoch: randomUUID() };
  const runId = randomUUID(), userId = "synthetic-owner", childId = randomUUID();
  let state = "running", live = true, calls = 0, modelClaims = 0;
  const references: string[] = [];
  const store = {
    async backgroundInput() { return live && ["running", "queued"].includes(state) ? { userId, childId, context: { eventType: "work_continuation", works: [] } } : null; },
    async finishBackground() { if (state === "running") return "running"; return "settled"; },
  } as unknown as AgentWorkContinuationStore;
  const agent = { async background(input: { reference: string; authorize: () => Promise<boolean> }) {
    assert.ok(await input.authorize()); references.push(input.reference); calls++;
    // A persisted original run is reused on a handler retry, not generated again.
    if (calls === 1) modelClaims++;
    return { runId, status: state } as any;
  } };
  const worker = createAgentWorkContinuationWorker({} as Pool, {} as PgBoss, store, agent);
  await assert.rejects(worker.process(job, job.jobId), /work_continuation_run_unconfirmed/);
  state = "queued"; // Event remains eligible; the original run has now become unknown.
  agent.background = async input => { references.push(input.reference); calls++; state = "unknown"; return { runId, status: "unknown" } as any; };
  await worker.process(job, job.jobId);
  await worker.process(job, job.jobId);
  assert.equal(modelClaims, 1); assert.equal(calls, 2); assert.deepEqual(references, [job.eventId, job.eventId]);
  live = false; await worker.process(job, job.jobId); assert.equal(calls, 2);
  await assert.rejects(worker.process(job, randomUUID()), /work_continuation_job_invalid/);
  await worker.stop();
});

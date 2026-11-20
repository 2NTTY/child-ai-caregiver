import { FinishReason } from "@google/genai";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { KNOWLEDGE_EMBEDDING } from "../src/shared/knowledge.ts";
import { embeddingDocument } from "../server/knowledge-inputs.ts";
import { observationHash } from "../server/knowledge-observation.ts";
import type { SourceWatchDefinition } from "../server/knowledge-refresh-types.ts";
import { createScheduledKnowledgeAgent } from "../server/scheduled-knowledge-agent.ts";
import { createFirestoreKnowledgeWork } from "../server/firestore-knowledge-work.ts";
import { firestoreDomainHash } from "../server/firestore-domain-data.ts";
import { createFirestoreKnowledgeStore } from "../server/firestore-knowledge.ts";
import { FirestoreAiUsage } from "../server/firestore-ai-usage.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { createFirestoreAuthority } from "../server/firestore-authority.ts";
import { createFirestoreBackgroundMaintenance } from "../server/firestore-background-maintenance.ts";
import { createFirestoreBackgroundQueue, prepareFirestoreBackgroundWork } from "../server/firestore-background-work.ts";
import { FirestoreDomainData, FIRESTORE_TASK_DISPATCH_SCOPE } from "../server/firestore-domain-data.ts";
import { createFirestoreKnowledgeRefresh } from "../server/firestore-knowledge-refresh.ts";
import { SOURCE_WATCHES } from "../server/knowledge-source-catalog.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { firestoreDomainFixture } from "./helpers/firestore-domain-memory.ts";

test("the original scheduled CHP work stays stopped after watch revocation and redelivery", async () => {
  const { database } = firestoreDomainFixture();
  const domain = { database, projectId: "demo-chp-scheduler", namespace: "scheduled_chp", cipher: createStorageCipher(Buffer.alloc(32, 5)) };
  const authority = createFirestoreAuthority(domain), data = new FirestoreDomainData(domain), generation = randomUUID();
  await authority.initializeControl({ enabled: true, generation });
  const readControl: typeof authority.readControl = tx => authority.readControl(tx);
  const refresh = createFirestoreKnowledgeRefresh({ ...domain, definitions: SOURCE_WATCHES, readControl });
  const watchId = "chp-recent", slot = new Date(Date.now() - 1000).toISOString();
  await refresh.register(watchId, "fixture-maintainer");
  const [watch] = await refresh.jobs();
  assert.equal(watch?.definition.id, watchId);
  const id = await database.runTransaction(async tx => {
    const work = await prepareFirestoreBackgroundWork(data, tx, { kind: "knowledge-check", scope: FIRESTORE_TASK_DISPATCH_SCOPE,
      resourceId: watchId, basis: watch!.data.revision + ":" + slot, generation, authorizationVersion: "0" }, slot);
    work.commit();
    return work.id;
  });
  const maintenance = createFirestoreBackgroundMaintenance({ ...domain, enabled: true, knowledge: refresh,
    photos: {} as never, erasures: {} as never, cleanup: {} as never });
  let executions = 0;
  const queue = () => createFirestoreBackgroundQueue({ ...domain, enabled: true, readControl,
    transport: { enqueue: () => assert.fail("Unexpected transport"), probe: () => assert.fail("Unexpected probe") },
    execute(work, signal) { executions++; return maintenance.process(work, signal); } });
  const delivery = { kind: "product-work" as const, id, generation, dispatchRevision: 1, scheduledAt: slot };
  await refresh.disable(watchId);
  assert.deepEqual(await queue().process(delivery), { state: "stopped" });
  assert.deepEqual(await queue().process(delivery), { state: "stopped" });
  assert.equal(executions, 1);
  assert.deepEqual((await refresh.list()).checks, []);
});

test("scheduled public pages resume the same review after daily admission and publish only changed observations", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-04-06T01:00:00Z") });
  const { database, records } = firestoreDomainFixture(), generation = randomUUID();
  const domain = { database, projectId: "demo-watch-scheduler", namespace: "updated_sources", cipher: createStorageCipher(Buffer.alloc(32, 5)) };
  const authority = createFirestoreAuthority(domain);
  await authority.initializeControl({ enabled: true, generation });
  const readControl: typeof authority.readControl = tx => authority.readControl(tx);
  const refresh = createFirestoreKnowledgeRefresh({ ...domain, definitions: SOURCE_WATCHES, readControl });
  const sourceIds = SOURCE_WATCHES.map(watch => watch.id), watchId = "fhs-child-vision";
  const knowledge = createFirestoreKnowledgeStore({ ...domain, sourceIds, observations: refresh.gate });
  const vector = [1, ...Array(1023).fill(0)];
  const notice = (definition: SourceWatchDefinition, text: string) => ({
url: definition.url, title: "Synthetic notice", text,
    sourceDateText: null, sourcePublishedAt: null, sourceUpdatedAt: null
});
  const checks = { age: "No age claim", numbersAndUnits: "No numbers", timing: "No timing instruction", conditions: "Preserved", exceptions: "None", prohibitions: "None", withdrawal: "Compared" };
  async function seed(id: string, key: string) {
    await refresh.register(id, "fixture-maintainer");
    const entry = (await refresh.jobs()).find(w => w.definition.id === id)!;
    const item = notice(entry.definition, "Earlier synthetic source notice.");
    await refresh.process(entry.data, randomUUID(), async () => ({ status: "ok", items: [item] }), new AbortController().signal);
    const chunk = {
key, section: "Earlier notice", sourceExcerpt: item.text, originalText: item.text, text: item.text, keywords: ["notice"],
      applicability: { region: "HK", ageBasis: "any" as const, minAgeMonths: null, maxAgeMonths: null, topics: ["care"], conditions: [] }
};
    const source = {
sourceId: id, url: item.url, title: item.title, publisher: entry.definition.publisher, termsUrl: entry.definition.termsUrl,
      classification: entry.definition.classification, sourcePublishedAt: null, sourceUpdatedAt: null, fetchedAt: new Date().toISOString(), chunks: [chunk]
};
    const version = await knowledge.importSource(source);
    await knowledge.review(version.versionId, version.hash, "fixture-maintainer", {
comparedVersionId: null, comparedHash: null, observationHash: observationHash(item),
      changes: [{ key, meaning: "new", oldQuote: null, newQuote: item.text, explanation: "Recorded prior synthetic edition." }], checks,
      questions: [{ query: "Earlier notice?", expectedKeys: [key], reason: "Prior edition" }], growthRuleImpact: "reviewed", growthRuleReason: "Synthetic prior review.", decision: "approve"
});
    for (let i = 0; i < 4; i++) if ((await knowledge.prepareSearch(version.versionId, version.hash)).complete) break;
    await knowledge.publish(version.versionId, version.hash, [{ chunkKey: key, inputHash: embeddingDocument(item.title, chunk.section, chunk.text).hash, ...KNOWLEDGE_EMBEDDING, values: vector }]);
    return { version, entry };
  }
  const { entry: watch, version: previous } = await seed(watchId, "unrelated-notice");
  let body = "First synthetic source notice.", fetches = 0, embeddings = 0;
  const roles: string[] = [];
  const agent = createScheduledKnowledgeAgent({
    ...domain, config: readAiConfig({
      AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-model-project",
      AI_BACKGROUND_KNOWLEDGE_MAINTENANCE_ENABLED: "true", AI_BACKGROUND_KNOWLEDGE_LIVE_FETCH: "true", AI_BACKGROUND_KNOWLEDGE_LIVE_PUBLISH: "true",
      AI_DAILY_USER_ATTEMPTS: "1"
    }), knowledge, refresh, readControl, payer: "platform", sourceIds,
    routing: { resolve: () => assert.fail("Unexpected personal payer") }, currentAuth: () => assert.fail("Unexpected personal identity"),
    fetch: async definition => { fetches++; return { status: "ok", items: [notice(definition, body)] }; },
    providers: () => ({
      model: { generate: () => assert.fail("Unexpected chat provider") }, agent: {
        async generate(req) {
          const payload = JSON.parse(req.contents[0]!.parts![0]!.text!);
          roles.push(payload.role);
          const output = payload.originalUnits ? {
            units: payload.originalUnits.map((unit: { id: string; originalText: string }) => ({
              unitId: unit.id, section: "Notice", text: unit.originalText, keywords: ["notice"],
              applicability: { region: "HK", ageBasis: "any", minAgeMonths: null, maxAgeMonths: null, topics: ["care"], conditions: [] }
            }))
          } : {
            changes: payload.comparisonUnits.map((c: { key: string; oldQuote: string | null; newQuote: string | null }) => ({
              key: c.key, meaning: !c.oldQuote ? "new" : !c.newQuote ? "removed" : "unchanged", explanation: "Compared with recorded source."
})),
            checks,
            questions: [{ query: "What is the notice?", expectedKeys: [payload.candidate.chunks[0].key], reason: "Original source" }],
            decision: "approve", decisionReason: "Matches the original."
          };
          return { content: { role: "model", parts: [{ text: JSON.stringify(output) }] }, finishReason: FinishReason.STOP, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 6, totalTokenCount: 16 } };
        }
      }, embedding: { async embed() { embeddings++; return { values: vector, inputTokens: 3, billableCharacters: 20 }; } }
    }),
  })!;
  assert.deepEqual(sourceIds.filter(agent.accepts), ["fhs-solid-food", "fhs-toddler-development", "fhs-preschool-development", watchId, "fhs-feeding-booklet-en"]);
  const run = (slot: string) => agent.run(watchId, watch!.data.revision, slot, generation, new AbortController().signal);
  const first = new Date().toISOString(), day = 86400_000;
  const maintenance = createFirestoreBackgroundMaintenance({
    ...domain, enabled: true, knowledge: refresh, knowledgeAgent: agent,
    photos: {} as never, erasures: {} as never, cleanup: {} as never
  });
  const queue = createFirestoreBackgroundQueue({
    ...domain, enabled: true, readControl,
    transport: { enqueue: () => assert.fail("Unexpected transport"), probe: () => assert.fail("Unexpected probe") },
    execute: (work, signal) => maintenance.process(work, signal)
  });
  await maintenance.tick();
  const jobs = [...records.entries()].filter(([path]) => path.startsWith(domain.namespace + "_background_work/"));
  assert.equal(jobs.length, 1);
  const id = jobs[0]![1].id;
  const delivery = { kind: "product-work" as const, id, generation, dispatchRevision: 1, scheduledAt: first };
  const nextAdmission = "2026-04-07T00:00:00.000Z";
  // The authoritative daily admission may lose a race after the capacity precheck.
  const capacity = t.mock.method(FirestoreAiUsage.prototype, "modelCapacity", async () => true);
  assert.deepEqual(await queue.process(delivery), { state: "pending" });
  assert.deepEqual(await queue.process(delivery), { state: "stopped" });
  assert.deepEqual(await run(first), { state: "deferred", nextAt: nextAdmission });
  assert.deepEqual([fetches, roles.length, embeddings], [1, 1, 0]);
  capacity.mock.restore();
  t.mock.timers.tick(day);
  const resumed = await queue.process({ ...delivery, dispatchRevision: 2, scheduledAt: nextAdmission });
  const obs = (await refresh.inspect(watchId)).observation!;
  const fingerprint = firestoreDomainHash(["knowledge-scheduled-edition/2", watchId, watch!.data.revision, agent.binding, "live", obs.contentHash, obs.fetchedAt]);
  const work = createFirestoreKnowledgeWork({ ...domain, readControl });
  const originalRequest = { watchId, workerGeneration: generation, publishMode: "live" as const, operationFingerprint: fingerprint };
  const saved = await work.inspect(originalRequest);
  const embeddingAdmission = "2026-04-08T00:00:00.000Z";
  assert.deepEqual(resumed, { state: "pending" });
  assert.deepEqual(await run(first), { state: "deferred", nextAt: embeddingAdmission });
  assert.equal(saved?.prepared?.review.decision, "approve_candidate");
  assert.equal(saved?.budget.modelCalls, 2);
  assert.deepEqual([fetches, roles.length, embeddings], [1, 2, 0]);
  assert.equal((await knowledge.publishedEdition(watchId))?.versionId, previous.versionId);
  t.mock.timers.tick(day);
  assert.deepEqual(await queue.process({ ...delivery, dispatchRevision: 3, scheduledAt: embeddingAdmission }), { state: "completed" });
  assert.equal((await work.inspect(originalRequest))?.receipt?.state, "committed");
  const initial = await knowledge.publishedEdition(watchId);
  assert.equal(initial?.source.chunks[0]?.text, body);
  assert.deepEqual([fetches, roles.length, embeddings], [1, 2, 1]);
  t.mock.timers.tick(5 * day);
  assert.deepEqual(await run(new Date().toISOString()), { state: "completed" });
  assert.deepEqual([fetches, roles.length, embeddings], [2, 2, 1]);
  t.mock.timers.tick(7 * day);
  const next = new Date().toISOString(); body = "Revised synthetic source notice.";
  assert.equal((await run(next)).state, "deferred");
  assert.equal((await knowledge.publishedEdition(watchId))?.versionId, initial?.versionId);
  t.mock.timers.tick(day);
  assert.equal((await run(next)).state, "deferred");
  assert.equal((await knowledge.publishedEdition(watchId))?.versionId, initial?.versionId);
  assert.deepEqual([fetches, roles.length, embeddings], [3, 4, 1]);
  t.mock.timers.tick(day);
  assert.equal((await run(next)).state, "completed");
  const revised = await knowledge.publishedEdition(watchId);
  assert.notEqual(revised?.versionId, initial?.versionId);
  assert.equal(revised?.source.chunks[0]?.text, body);
  assert.deepEqual(roles, ["background-knowledge-maintenance", "knowledge-semantic-review", "background-knowledge-maintenance", "knowledge-semantic-review"]);
  assert.deepEqual([fetches, embeddings], [3, 2]);

  t.mock.timers.tick(7 * day);
  const protectedWatch = await seed("fhs-toddler-development", "play-and-language");
  const protectedSlot = new Date().toISOString(), entry = protectedWatch.entry;
  const runProtected = (slot: string) => agent.run(entry.definition.id, entry.data.revision, slot, generation, new AbortController().signal);
  assert.equal((await runProtected(protectedSlot)).state, "deferred");
  t.mock.timers.tick(day);
  assert.equal((await runProtected(protectedSlot)).state, "stopped");
  const held = (await knowledge.listVersions(undefined, true)).items.find(v => v.sourceId === entry.definition.id && v.state === "draft");
  assert.match(held?.growthRuleReason ?? "", /toddler_play.*play-and-language.*candidate missing/);
  assert.equal(held?.comparedVersionId, protectedWatch.version.versionId);
  const candidate = await knowledge.growthReviewCandidate(held!.id);
  assert.equal(candidate.hash, held!.hash);
  assert.equal(candidate.source.chunks[0]?.originalText, body);
  assert.equal(candidate.assessment.growthRuleImpact, "requires_review");
  const filter = { region: "HK" as const, classification: "official_guidance" as const, age: null, ageMatch: "unknown" as const, topics: [] };
  const visible = await knowledge.candidates(filter, null, {});
  assert.ok(visible.some(c => c.versionId === protectedWatch.version.versionId));
  assert.ok(!visible.some(c => c.versionId === held?.id));
  t.mock.timers.tick(6 * day);
  assert.equal((await runProtected(new Date().toISOString())).state, "stopped");
  assert.deepEqual([roles.length, embeddings], [6, 2]);
  await refresh.disable(entry.definition.id);
  assert.ok(!(await knowledge.candidates(filter, null, {})).some(c => c.versionId === protectedWatch.version.versionId));
});

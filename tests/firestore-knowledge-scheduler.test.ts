import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
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

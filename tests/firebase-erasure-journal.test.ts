import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { FIREBASE_PHOTO_TIMEOUT_MS, type FirebasePhotoBucketPort, type FirebasePhotoSdkBucket } from "../server/firebase-photo-objects.ts";
import { createFirebaseErasureJournal, createFirebaseErasureBucketPort, FirebaseErasureError, firebaseErasureIntentHash,
  type FirebaseErasureIntent } from "../server/firebase-erasure-journal.ts";

const CONFIG = { projectId: "synthetic-erasure-project", namespace: "unit_erasure", bucketName: "independent-private-erasure-bucket" };
const INTENT: FirebaseErasureIntent = { scope: { ownerUserId: "synthetic-owner", workspaceId: randomUUID(), childId: randomUUID(), storageEpoch: randomUUID() },
  assetId: randomUUID(), operationId: randomUUID(), at: "2026-10-11T12:00:00.000Z", type: "photo-delete" };
const GENERATION = "9007199254740993999";
const rejects = (code: string) => (error: unknown) => error instanceof FirebaseErasureError && error.code === code && error.message === code;
function fixture() {
  const stored = new Map<string, { ciphertext: Buffer; metadata: any }>(), writes: any[] = [], reads: any[] = [], streams: Readable[] = [];
  let lost = false, failWrite = false, stalled = false;
  const bucket: FirebasePhotoBucketPort = {
    async writeNew(name, bytes, options) {
      writes.push({ name, bytes: Buffer.from(bytes), options });
      if (failWrite) throw new Error("synthetic unavailable body@example.test");
      if (stored.has(name)) throw Object.assign(new Error("synthetic conflict"), { code: 412 });
      const value = { ciphertext: Buffer.from(bytes), metadata: { name, bucket: CONFIG.bucketName, generation: GENERATION,
        size: String(bytes.length), metadata: options.metadata!.metadata } };
      stored.set(name, value); if (lost) throw new Error("synthetic lost reply"); return value.metadata;
    },
    async metadata(name, generation) { reads.push({ name, generation }); if (!stored.has(name)) throw Object.assign(new Error("synthetic missing"), { code: 404 });
      return structuredClone(stored.get(name)!.metadata); },
    readPinned(name, generation) {
      let sent = false;
      const stream = new Readable({ read() { if (sent) return; sent = true;
        this.emit("response", { statusCode: 206, headers: { "x-goog-generation": generation } });
        if (stalled) return; this.push(stored.get(name)!.ciphertext); this.push(null); } });
      streams.push(stream); return stream;
    },
  };
  const journal = createFirebaseErasureJournal({ config: CONFIG, cipher: createStorageCipher(Buffer.alloc(32, 72)), bucket });
  return { journal, bucket, stored, writes, reads, streams, lose: () => { lost = true; }, fail: () => { failWrite = true; }, stall: () => { stalled = true; } };
}
test("independent journal is encrypted, immutable and recovers the original generation after a lost reply", async () => {
  const f = fixture(); f.lose();
  const original = await f.journal.writeOnce(INTENT);
  assert.equal(original.generation, GENERATION); assert.equal(original.intentSha256, firebaseErasureIntentHash(INTENT));
  assert.deepEqual(f.writes[0].options.preconditionOpts, { ifGenerationMatch: 0 });
  assert.equal(f.writes[0].options.resumable, false); assert.equal(f.writes[0].options.validation, "crc32c");
  assert.equal(f.writes[0].options.timeout, FIREBASE_PHOTO_TIMEOUT_MS);
  assert.deepEqual(Object.keys(f.writes[0].options.metadata.metadata).sort(), ["binding", "cipherSha256", "format", "intentSha256"]);
  assert.equal(f.writes[0].bytes.includes(INTENT.scope.ownerUserId), false); assert.equal(original.objectName.includes(INTENT.assetId), false);
  assert.deepEqual(await f.journal.writeOnce(INTENT), original);
  assert.deepEqual(await f.journal.read(INTENT, original), INTENT);
  assert.deepEqual(f.reads.slice(0, 2).map(row => row.generation), [undefined, GENERATION]);
  assert.equal(f.streams.every(stream => stream.destroyed), true);
  assert.deepEqual(Object.keys(f.journal).sort(), ["read", "readObject", "writeOnce"]);
});
test("same operation with another intent is conflict and an unavailable readback never becomes success", async () => {
  const f = fixture(), descriptor = await f.journal.writeOnce(INTENT);
  await assert.rejects(f.journal.writeOnce({ ...INTENT, at: "2026-10-11T12:00:01.000Z" }), rejects("erasure_conflict"));
  await assert.rejects(f.journal.writeOnce({ ...INTENT, assetId: randomUUID() }), rejects("erasure_conflict"));
  await assert.rejects(f.journal.read({ ...INTENT, scope: { ...INTENT.scope, childId: randomUUID() } }, descriptor), rejects("erasure_conflict"));
  const missing = fixture(); missing.fail();
  await assert.rejects(missing.journal.writeOnce(INTENT), rejects("erasure_unavailable")); assert.equal(missing.writes.length, 1);
});
test("journal rejects ciphertext tampering and oversized metadata before returning an intent", async () => {
  const f = fixture(), descriptor = await f.journal.writeOnce(INTENT), value = f.stored.get(descriptor.objectName)!;
  value.ciphertext[value.ciphertext.length - 8] ^= 1;
  await assert.rejects(f.journal.read(INTENT, descriptor), rejects("erasure_unavailable"));
  const count = f.streams.length; value.metadata.size = "8193";
  await assert.rejects(f.journal.read(INTENT, descriptor), rejects("erasure_unavailable")); assert.equal(f.streams.length, count);
});
test("journal media has an absolute deadline that destroys a stalled stream", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(), descriptor = await f.journal.writeOnce(INTENT); f.stall();
  const denied = assert.rejects(f.journal.read(INTENT, descriptor), rejects("erasure_unavailable"));
  await new Promise<void>(resolve => setImmediate(resolve));
  t.mock.timers.tick(FIREBASE_PHOTO_TIMEOUT_MS); await denied; assert.equal(f.streams[0].destroyed, true);
});
test("journal public SDK requests use exact decimal revisions and the journal-specific bounded Range", async () => {
  const f = fixture(), descriptor = await f.journal.writeOnce(INTENT), options: any[] = [];
  const sdk: FirebasePhotoSdkBucket = { file(name) { return { metadata: {},
    async save() { throw new Error("unexpected upload"); },
    async request(input) { options.push(input); return [f.stored.get(name)!.metadata, { statusCode: 200 }]; },
    requestStream(input) { options.push(input); return f.bucket.readPinned(name, input.qs!.generation!); } }; } };
  const journal = createFirebaseErasureJournal({ config: CONFIG, cipher: createStorageCipher(Buffer.alloc(32, 72)), bucket: createFirebaseErasureBucketPort(sdk) });
  assert.deepEqual(await journal.read(INTENT, descriptor), INTENT);
  assert.equal(options[0].qs.generation, GENERATION); assert.equal(options[1].qs.generation, GENERATION);
  assert.equal(options[1].headers.Range, "bytes=0-8192"); assert.equal(options[1].headers["Accept-Encoding"], "identity");
  assert.equal(options.every(value => value.timeout === FIREBASE_PHOTO_TIMEOUT_MS), true);
});

test("an old database backup can recover a later journal object from only its name and exact generation", async () => {
  const f = fixture(), descriptor = await f.journal.writeOnce(INTENT);
  const fresh = createFirebaseErasureJournal({ config: CONFIG, cipher: createStorageCipher(Buffer.alloc(32, 72)), bucket: f.bucket });
  assert.deepEqual(await fresh.readObject(descriptor.objectName, descriptor.generation), { intent: INTENT, descriptor });
  await assert.rejects(fresh.readObject(descriptor.objectName, "9007199254740993997"), rejects("erasure_conflict"));
  await assert.rejects(fresh.read({ ...INTENT, scope: { ...INTENT.scope, storageEpoch: randomUUID() } }, descriptor), rejects("erasure_conflict"));
});
test("independent recovery rejects swapped object, project and encrypted epoch payloads", async () => {
  const f = fixture(), first = await f.journal.writeOnce(INTENT);
  const other = await f.journal.writeOnce({ ...INTENT, operationId: randomUUID(), scope: { ...INTENT.scope, storageEpoch: randomUUID() } });
  const object = f.stored.get(first.objectName)!, swapped = f.stored.get(other.objectName)!;
  object.ciphertext = Buffer.from(swapped.ciphertext);
  object.metadata.metadata.cipherSha256 = swapped.metadata.metadata.cipherSha256;
  object.metadata.metadata.intentSha256 = swapped.metadata.metadata.intentSha256;
  object.metadata.size = swapped.metadata.size;
  await assert.rejects(f.journal.readObject(first.objectName, first.generation), rejects("erasure_unavailable"));
  const clean = fixture(), descriptor = await clean.journal.writeOnce(INTENT);
  const project = createFirebaseErasureJournal({ config: { ...CONFIG, projectId: "another-erasure-project" },
    cipher: createStorageCipher(Buffer.alloc(32, 72)), bucket: clean.bucket });
  await assert.rejects(project.readObject(descriptor.objectName, descriptor.generation), rejects("erasure_conflict"));
  const differentName = "erasures/v1/" + "f".repeat(64);
  const moved = structuredClone(clean.stored.get(descriptor.objectName)!); moved.metadata.name = differentName;
  clean.stored.set(differentName, moved);
  await assert.rejects(clean.journal.readObject(differentName, descriptor.generation), rejects("erasure_conflict"));
});
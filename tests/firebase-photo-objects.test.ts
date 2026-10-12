import { storageMediaFixture } from "./firebase-storage-media-fixture.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import { Storage, type Bucket, type SaveOptions } from "@google-cloud/storage";
import { createStorageCipher, type StorageCipher } from "../server/storage-crypto.ts";
import { photoHash } from "../server/photo-files.ts";
import { PHOTO_LIMITS } from "../src/shared/photos.ts";
import type { WorkRecoveryScope } from "../server/firestore-work-continuation-recovery.ts";
import {
  createCloudStoragePhotoObjects, createFirebasePhotoObjects, createFirebasePhotoBucketPort,
  FIREBASE_PHOTO_MAX_CIPHER_BYTES, FIREBASE_PHOTO_TIMEOUT_MS, FirebasePhotoObjectError, firebasePhotoObjectDescriptorSchema,
  type FirebasePhotoBucketPort, type FirebasePhotoSdkBucket, type FirebasePhotoSdkFile,
} from "../server/firebase-photo-objects.ts";

const CONFIG = { projectId: "synthetic-photo-project", namespace: "unit-photos", bucketName: "synthetic-private-photo-bucket" };
const SCOPE: WorkRecoveryScope = { ownerUserId: "synthetic-owner@example.test",
  workspaceId: "10000000-0000-4000-8000-000000000001", childId: "20000000-0000-4000-8000-000000000002",
  storageEpoch: "30000000-0000-4000-8000-000000000003" };
const PHOTO_ID = "40000000-0000-4000-8000-000000000004";
const GENERATION = "9007199254740993123";
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(4), Buffer.from("IHDR"), Buffer.alloc(8)]);
const INPUT = { base64: PNG.toString("base64"), mimeType: "image/png" as const };
type StoredObject = { ciphertext: Buffer; metadata: { name: string; bucket: string; generation: string; size: string;
  metadata: Record<string, string>; contentEncoding?: string } };
const errorCode = (code: string, status?: number) => (error: unknown) => {
  assert.ok(error instanceof FirebasePhotoObjectError);
  assert.equal(error.code, code); if (status !== undefined) assert.equal(error.status, status);
  assert.equal(error.message, code); assert.equal(error.message.includes(SCOPE.ownerUserId), false); return true;
};
function fixture() {
  const objects = new Map<string, StoredObject>(), writes: { name: string; data: Buffer; options: SaveOptions }[] = [];
  const metadataReads: { name: string; generation?: string }[] = [], mediaReads: { name: string; generation: string }[] = [];
  const contexts: string[] = [], streams: Readable[] = [];
  let loseReply = false, failCreate = false, failMetadata = false, stalled = false, status = 206;
  const realCipher = createStorageCipher(Buffer.alloc(32, 29));
  const cipher: StorageCipher = { encrypt(text, context) { contexts.push(context); return realCipher.encrypt(text, context); },
    decrypt: (text, context) => realCipher.decrypt(text, context) };
  const bucket: FirebasePhotoBucketPort = {
    async writeNew(name, data, options) {
      writes.push({ name, data: Buffer.from(data), options: structuredClone(options) });
      if (failCreate) throw new Error("synthetic unknown upload failure " + SCOPE.ownerUserId);
      if (objects.has(name)) throw Object.assign(new Error("synthetic precondition failure " + SCOPE.ownerUserId), { code: 412 });
      const object: StoredObject = { ciphertext: Buffer.from(data), metadata: { name, bucket: CONFIG.bucketName,
        generation: GENERATION, size: String(data.length), metadata: { ...options.metadata!.metadata } as Record<string, string> } };
      objects.set(name, object);
      if (loseReply) throw Object.assign(new Error("synthetic lost reply " + SCOPE.ownerUserId), { code: 503 });
      return structuredClone(object.metadata);
    },
    async metadata(name, generation) {
      metadataReads.push({ name, generation });
      if (failMetadata) throw new Error("synthetic metadata failure " + SCOPE.ownerUserId);
      const object = objects.get(name);
      if (!object) throw Object.assign(new Error("synthetic object missing"), { code: 404 });
      return structuredClone(object.metadata);
    },
    readPinned(name, generation) {
      mediaReads.push({ name, generation }); const object = objects.get(name)!;
      let sent = false;
      const stream = new Readable({ read() {
        if (sent) return; sent = true;
        this.emit("response", { statusCode: status, headers: { "x-goog-generation": generation } });
        if (this.destroyed || stalled) return;
        this.push(object.ciphertext); this.push(null);
      } });
      streams.push(stream); return stream;
    },
  };
  const port = createFirebasePhotoObjects({ config: CONFIG, cipher, bucket });
  return { port, bucket, objects, writes, metadataReads, mediaReads, contexts, streams, cipher: realCipher,
    loseReply: () => { loseReply = true; }, failCreate: () => { failCreate = true; },
    failMetadata: () => { failMetadata = true; }, stall: () => { stalled = true; }, status: (value: number) => { status = value; } };
}

test("immutable create uses the required precondition and opaque metadata, then pinned read authenticates original bytes", async () => {
  const f = fixture(), descriptor = await f.port.write(SCOPE, PHOTO_ID, INPUT);
  assert.equal(f.writes.length, 1); assert.equal(f.metadataReads.length, 0);
  assert.equal(f.writes[0].options.resumable, false); assert.equal(f.writes[0].options.validation, "crc32c");
  assert.equal(f.writes[0].options.timeout, FIREBASE_PHOTO_TIMEOUT_MS);
  assert.deepEqual(f.writes[0].options.preconditionOpts, { ifGenerationMatch: 0 });
  assert.deepEqual(Object.keys(f.writes[0].options.metadata!.metadata!).sort(), ["binding", "cipherSha256", "format", "sha256"]);
  assert.equal(f.writes[0].options.metadata!.contentType, "application/octet-stream");
  assert.equal(f.writes[0].data.includes(PNG), false); assert.equal(f.writes[0].data.includes(INPUT.base64), false);
  assert.equal(JSON.stringify(f.writes[0].options).includes(SCOPE.ownerUserId), false);
  assert.match(descriptor.objectName, /^photos\/v1\/[a-f0-9]{64}\/[a-f0-9-]{36}$/u);
  assert.equal(descriptor.objectName.includes(SCOPE.ownerUserId), false); assert.equal(descriptor.generation, GENERATION);
  assert.ok(BigInt(descriptor.generation) > BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(descriptor.sha256, photoHash(PNG)); assert.equal(descriptor.bytes, PNG.length);
  const aad = JSON.parse(f.contexts[0]);
  assert.deepEqual(aad.scope, SCOPE); assert.equal(aad.projectId, CONFIG.projectId);
  assert.equal(aad.namespace, CONFIG.namespace); assert.equal(aad.bucket, CONFIG.bucketName);
  assert.equal(aad.objectName, descriptor.objectName); assert.equal(aad.photoId, PHOTO_ID);
  assert.equal(aad.format, "yuban-photo-object"); assert.equal(aad.version, 1);
  const content = await f.port.read(SCOPE, PHOTO_ID, descriptor);
  assert.deepEqual(content.buffer, PNG); assert.equal(content.base64, INPUT.base64); assert.equal(content.mimeType, INPUT.mimeType);
  assert.deepEqual(f.metadataReads, [{ name: descriptor.objectName, generation: GENERATION }]);
  assert.deepEqual(f.mediaReads, [{ name: descriptor.objectName, generation: GENERATION }]); assert.equal(f.streams[0].destroyed, true);
  assert.deepEqual(Object.keys(f.port).sort(), ["read", "recover", "write"]);
});

test("a lost create reply and an identical precondition conflict recover the original immutable generation", async () => {
  const f = fixture(); f.loseReply();
  const recovered = await f.port.write(SCOPE, PHOTO_ID, INPUT), original = f.objects.get(recovered.objectName)!;
  assert.equal(f.writes.length, 1); assert.equal(f.metadataReads.length, 2);
  assert.deepEqual(f.metadataReads.map(item => item.generation), [undefined, GENERATION]);
  assert.equal(recovered.cipherSha256, photoHash(original.ciphertext));
  const repeated = await f.port.write(SCOPE, PHOTO_ID, INPUT);
  assert.deepEqual(repeated, recovered); assert.equal(f.writes.length, 2);
  assert.notEqual(photoHash(f.writes[1].data), recovered.cipherSha256);
  assert.deepEqual(f.objects.get(recovered.objectName), original);
});

test("different bytes at the same immutable path return conflict without replacing the existing object", async () => {
  const f = fixture(), original = await f.port.write(SCOPE, PHOTO_ID, INPUT);
  const before = structuredClone(f.objects.get(original.objectName)!.metadata), changed = Buffer.from(PNG); changed[23] = 1;
  await assert.rejects(f.port.write(SCOPE, PHOTO_ID, { ...INPUT, base64: changed.toString("base64") }), errorCode("photo_object_conflict", 409));
  assert.equal(f.writes.length, 2); assert.deepEqual(f.objects.get(original.objectName)!.metadata, before);
  assert.deepEqual((await f.port.read(SCOPE, PHOTO_ID, original)).buffer, PNG);
});

test("unknown create outcomes with missing or unavailable readback remain unavailable and never recreate", async () => {
  const missing = fixture(); missing.failCreate();
  await assert.rejects(missing.port.write(SCOPE, PHOTO_ID, INPUT), errorCode("photo_object_unavailable", 503));
  assert.equal(missing.writes.length, 1); assert.equal(missing.metadataReads.length, 1); assert.equal(missing.mediaReads.length, 0);
  const unavailable = fixture(); unavailable.loseReply(); unavailable.failMetadata();
  await assert.rejects(unavailable.port.write(SCOPE, PHOTO_ID, INPUT), errorCode("photo_object_unavailable", 503));
  assert.equal(unavailable.writes.length, 1); assert.equal(unavailable.metadataReads.length, 1);
});

test("strict descriptors and every trusted scope component reject cross-scope reads before object access", async () => {
  const f = fixture(), descriptor = await f.port.write(SCOPE, PHOTO_ID, INPUT);
  for (const scope of [
    { ...SCOPE, ownerUserId: "synthetic-other-owner" },
    { ...SCOPE, workspaceId: "10000000-0000-4000-8000-000000000005" },
    { ...SCOPE, childId: "20000000-0000-4000-8000-000000000006" },
    { ...SCOPE, storageEpoch: "30000000-0000-4000-8000-000000000007" },
  ]) await assert.rejects(f.port.read(scope, PHOTO_ID, descriptor), errorCode("photo_object_invalid_input", 400));
  for (const config of [{ ...CONFIG, projectId: "synthetic-other-project" }, { ...CONFIG, namespace: "other-unit" }]) {
    const port = createFirebasePhotoObjects({ config, cipher: f.cipher, bucket: f.bucket });
    await assert.rejects(port.read(SCOPE, PHOTO_ID, descriptor), errorCode("photo_object_invalid_input", 400));
  }
  await assert.rejects(f.port.read(SCOPE, "40000000-0000-4000-8000-000000000008", descriptor), errorCode("photo_object_invalid_input", 400));
  assert.equal(firebasePhotoObjectDescriptorSchema.safeParse({ ...descriptor, generation: Number(GENERATION) }).success, false);
  assert.equal(firebasePhotoObjectDescriptorSchema.safeParse({ ...descriptor, generation: "0" }).success, false);
  assert.equal(firebasePhotoObjectDescriptorSchema.safeParse({ ...descriptor, generation: "0001" }).success, false);
  assert.equal(firebasePhotoObjectDescriptorSchema.safeParse({ ...descriptor, url: "https://example.test" }).success, false);
  assert.equal(f.metadataReads.length, 0); assert.equal(f.mediaReads.length, 0);
});

test("bucket binding and a mismatched pinned metadata generation fail before downloading content", async () => {
  const f = fixture(), descriptor = await f.port.write(SCOPE, PHOTO_ID, INPUT);
  const otherBucket = createFirebasePhotoObjects({ config: { ...CONFIG, bucketName: "another-private-bucket" }, cipher: f.cipher, bucket: f.bucket });
  await assert.rejects(otherBucket.read(SCOPE, PHOTO_ID, descriptor), errorCode("photo_object_integrity_failed", 503));
  f.objects.get(descriptor.objectName)!.metadata.generation = "9007199254740993124";
  await assert.rejects(f.port.read(SCOPE, PHOTO_ID, descriptor), errorCode("photo_object_integrity_failed", 503));
  assert.equal(f.mediaReads.length, 0);
});

test("ciphertext hash, GCM authentication, plaintext hash, size and native photo type are all enforced", async () => {
  const f = fixture(), descriptor = await f.port.write(SCOPE, PHOTO_ID, INPUT), object = f.objects.get(descriptor.objectName)!;
  const pristine = Buffer.from(object.ciphertext), metadata = structuredClone(object.metadata);
  object.ciphertext[object.ciphertext.length - 8] ^= 1;
  await assert.rejects(f.port.read(SCOPE, PHOTO_ID, descriptor), errorCode("photo_object_integrity_failed", 503));
  // Supply a matching ciphertext hash so rejection must come from the GCM envelope, not the hash check.
  object.metadata.metadata.cipherSha256 = photoHash(object.ciphertext);
  await assert.rejects(f.port.read(SCOPE, PHOTO_ID, { ...descriptor, cipherSha256: photoHash(object.ciphertext) }), errorCode("photo_object_integrity_failed", 503));
  object.ciphertext = pristine; object.metadata = structuredClone(metadata);
  object.metadata.metadata.sha256 = "0".repeat(64);
  await assert.rejects(f.port.read(SCOPE, PHOTO_ID, { ...descriptor, sha256: "0".repeat(64) }), errorCode("photo_object_integrity_failed", 503));
  object.metadata = structuredClone(metadata);
  await assert.rejects(f.port.read(SCOPE, PHOTO_ID, { ...descriptor, bytes: PNG.length + 1 }), errorCode("photo_object_integrity_failed", 503));
  await assert.rejects(f.port.read(SCOPE, PHOTO_ID, { ...descriptor, mimeType: "image/jpeg" }), errorCode("photo_object_integrity_failed", 503));
  const invalid = Buffer.from(f.cipher.encrypt(Buffer.from("not a photo").toString("base64"), f.contexts[0]));
  object.ciphertext = invalid; object.metadata.size = String(invalid.length); object.metadata.metadata.cipherSha256 = photoHash(invalid);
  await assert.rejects(f.port.read(SCOPE, PHOTO_ID, { ...descriptor, cipherSha256: photoHash(invalid) }), errorCode("photo_object_integrity_failed", 503));
});

test("oversized metadata, an oversized stream ignoring its declared size, and error HTTP status never return plaintext", async () => {
  const f = fixture(), descriptor = await f.port.write(SCOPE, PHOTO_ID, INPUT), object = f.objects.get(descriptor.objectName)!;
  const originalSize = object.metadata.size;
  object.metadata.size = String(FIREBASE_PHOTO_MAX_CIPHER_BYTES + 1);
  await assert.rejects(f.port.read(SCOPE, PHOTO_ID, descriptor), errorCode("photo_object_integrity_failed", 503));
  assert.equal(f.mediaReads.length, 0);
  object.metadata.size = originalSize; object.ciphertext = Buffer.alloc(FIREBASE_PHOTO_MAX_CIPHER_BYTES + 1);
  await assert.rejects(f.port.read(SCOPE, PHOTO_ID, descriptor), errorCode("photo_object_integrity_failed", 503));
  assert.equal(f.streams[0].destroyed, true);
  f.status(404);
  await assert.rejects(f.port.read(SCOPE, PHOTO_ID, descriptor), errorCode("photo_object_unavailable", 503));
  assert.equal(f.streams[1].destroyed, true);
});

test("invalid or oversized photo input fails before any upload", async () => {
  const f = fixture();
  await assert.rejects(f.port.write(SCOPE, PHOTO_ID, { ...INPUT, base64: "YQ==" }), errorCode("photo_object_invalid_input", 400));
  await assert.rejects(f.port.write(SCOPE, PHOTO_ID, { ...INPUT, mimeType: "image/jpeg" }), errorCode("photo_object_invalid_input", 400));
  await assert.rejects(f.port.write(SCOPE, PHOTO_ID, { ...INPUT, base64: Buffer.alloc(PHOTO_LIMITS.bytes + 1).toString("base64") }), errorCode("photo_object_invalid_input", 400));
  assert.equal(f.writes.length, 0); assert.equal(f.contexts.length, 0);
});

test("public SDK requests preserve an above-safe-integer generation string and bound the media request", async () => {
  const f = fixture(), descriptor = await f.port.write(SCOPE, PHOTO_ID, INPUT);
  const requests: Parameters<FirebasePhotoSdkFile["request"]>[0][] = [], streamRequests: Parameters<import("../server/firebase-photo-objects.ts").FirebaseStorageMediaClient["request"]>[0][] = [];
  const names: string[] = [], fileArgumentCounts: number[] = [];
  const sdk: FirebasePhotoSdkBucket = { ...storageMediaFixture(CONFIG.bucketName, f.bucket.readPinned, options => streamRequests.push(options as never)), file(name) {
    names.push(name); fileArgumentCounts.push(arguments.length);
    return { metadata: f.objects.get(name)!.metadata, async save() { throw new Error("unexpected upload"); },
      async request(options) { requests.push(structuredClone(options)); return [f.objects.get(name)!.metadata, { statusCode: 200 }]; },
      requestStream() { throw new Error("legacy transport must not be used"); } };
  } };
  const port = createFirebasePhotoObjects({ config: CONFIG, cipher: f.cipher, bucket: createFirebasePhotoBucketPort(sdk) });
  assert.deepEqual((await port.read(SCOPE, PHOTO_ID, descriptor)).buffer, PNG);
  assert.deepEqual(requests[0].qs, { generation: GENERATION });
  assert.equal(requests[0].timeout, FIREBASE_PHOTO_TIMEOUT_MS); assert.equal(streamRequests[0].timeout, FIREBASE_PHOTO_TIMEOUT_MS);
  assert.deepEqual(streamRequests[0].params, { alt: "media", generation: GENERATION });
  assert.equal(typeof streamRequests[0].params!.generation, "string");
  assert.equal(streamRequests[0].headers!.Range, "bytes=0-" + FIREBASE_PHOTO_MAX_CIPHER_BYTES);
  assert.equal(streamRequests[0].headers!["Accept-Encoding"], "identity");
  assert.equal(streamRequests[0].headers!["Cache-Control"], "no-store"); assert.equal(streamRequests[0].retry, false); assert.equal(streamRequests[0].maxRedirects, 0); assert.ok(streamRequests[0].signal instanceof AbortSignal);
  assert.deepEqual(fileArgumentCounts, [1]); assert.deepEqual(names, [descriptor.objectName]);
});

test("the runtime factory constructs the installed SDK with automatic retries disabled and rejects endpoint or emulator configuration", t => {
  const calls: { project: string; autoRetry: boolean | undefined; timeout: number | undefined; name: string }[] = [];
  t.mock.method(Storage.prototype, "bucket", function(this: Storage, name: string) {
    calls.push({ project: this.projectId, autoRetry: this.retryOptions.autoRetry, timeout: this.timeout, name });
    // Narrow synthetic public SDK surface; this test never invokes other Bucket methods or a network request.
    return { file() { throw new Error("unexpected provider call"); } } as unknown as Bucket;
  });
  const options = { config: CONFIG, cipher: createStorageCipher(Buffer.alloc(32, 31)) };
  assert.deepEqual(Object.keys(createCloudStoragePhotoObjects(options)).sort(), ["read", "recover", "write"]);
  assert.deepEqual(calls, [{ project: CONFIG.projectId, autoRetry: false, timeout: FIREBASE_PHOTO_TIMEOUT_MS, name: CONFIG.bucketName }]);
  assert.throws(() => createCloudStoragePhotoObjects({ ...options, config: { ...CONFIG, apiEndpoint: "http://localhost:9199" } } as typeof options), errorCode("photo_object_invalid_input", 400));
  assert.throws(() => createCloudStoragePhotoObjects({ ...options, apiEndpoint: "https://other.example.test" } as typeof options), errorCode("photo_object_unavailable", 503));
  const previous = process.env.STORAGE_EMULATOR_HOST;
  try {
    process.env.STORAGE_EMULATOR_HOST = "http://localhost:9199";
    assert.throws(() => createCloudStoragePhotoObjects(options), errorCode("photo_object_unavailable", 503));
    assert.equal(calls.length, 1);
  } finally { if (previous === undefined) delete process.env.STORAGE_EMULATOR_HOST; else process.env.STORAGE_EMULATOR_HOST = previous; }
});

test("an absolute media deadline destroys a stalled stream and returns unavailable without leaving it live", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(), descriptor = await f.port.write(SCOPE, PHOTO_ID, INPUT);
  f.stall();
  const reading = f.port.read(SCOPE, PHOTO_ID, descriptor);
  const denied = assert.rejects(reading, errorCode("photo_object_unavailable", 503));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(f.streams.length, 1); assert.equal(f.streams[0].destroyed, false);
  t.mock.timers.tick(FIREBASE_PHOTO_TIMEOUT_MS - 1);
  assert.equal(f.streams[0].destroyed, false);
  t.mock.timers.tick(1); await denied;
  assert.equal(f.streams[0].destroyed, true);
  assert.equal(f.writes.length, 1); assert.equal(f.mediaReads.length, 1);
  t.mock.timers.tick(FIREBASE_PHOTO_TIMEOUT_MS);
});
test("unknown upload recovery only reads the original immutable object and never attempts another create", async () => {
  const f = fixture(), original = await f.port.write(SCOPE, PHOTO_ID, INPUT);
  assert.deepEqual(await f.port.recover(SCOPE, PHOTO_ID, INPUT), original);
  const changed = Buffer.from(PNG); changed[23] = 2;
  await assert.rejects(f.port.recover(SCOPE, PHOTO_ID, { ...INPUT, base64: changed.toString("base64") }), errorCode("photo_object_conflict", 409));
  await assert.rejects(f.port.recover(SCOPE, "40000000-0000-4000-8000-000000000009", INPUT), errorCode("photo_object_unavailable", 503));
  assert.equal(f.writes.length, 1);
});
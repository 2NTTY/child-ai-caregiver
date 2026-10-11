import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { Storage } from "@google-cloud/storage";
import { createFirebasePhotoBucketPort } from "../server/firebase-photo-objects.ts";
import { createFirebaseErasureBucketPort } from "../server/firebase-erasure-journal.ts";
import { createFirebasePhotoBackupBucketPort } from "../server/firebase-photo-recovery.ts";
import { createFirebaseBackupArtifactBucketPort } from "../server/firebase-backup-artifacts.ts";

const nativeAuth = createRequire(import.meta.resolve("@google-cloud/storage"))("google-auth-library");
function testStorage(port: number) {
  const storage = new Storage({ projectId: "synthetic-project", retryOptions: { autoRetry: false } });
  const auth = new nativeAuth.OAuth2Client();
  auth.setCredentials({ access_token: "synthetic-loopback-token", expiry_date: Date.now() + 3_600_000 });
  storage.authClient.request = options => {
    const url = new URL(String(options.url));
    assert.equal(url.origin, "https://storage.googleapis.com");
    return auth.request({ ...options, url: "http://127.0.0.1:" + port + url.pathname });
  };
  return storage;
}
const GENERATION = "9007199254740993123";
const factories = [createFirebasePhotoBucketPort, createFirebaseErasureBucketPort,
  createFirebasePhotoBackupBucketPort, createFirebaseBackupArtifactBucketPort];

test("native Storage GET readers finish at response EOF and preserve exact generation and headers", async () => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url!);
    assert.equal(request.headers["accept-encoding"], "identity");
    assert.match(request.headers.range!, /^bytes=0-[0-9]+$/u);
    response.writeHead(206, { "content-length": "4", "x-goog-generation": GENERATION });
    response.end("test");
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  const storage = testStorage(address.port);
  try {
    for (const factory of factories) {
      const stream = factory(storage.bucket("synthetic-bucket")).readPinned("synthetic-object", GENERATION);
      let accepted = false;
      stream.once("response", response => {
        assert.equal(response.statusCode, 206); assert.equal(response.headers["x-goog-generation"], GENERATION); accepted = true;
      });
      const deadline = setTimeout(() => stream.destroy(new Error("native_reader_did_not_finish")), 1_500);
      const parts: Buffer[] = [];
      try { for await (const part of stream) { assert.equal(accepted, true); parts.push(part); } }
      finally { clearTimeout(deadline); stream.destroy(); }
      assert.equal(Buffer.concat(parts).toString(), "test");
    }
    assert.equal(requests.length, 4);
    for (const url of requests) assert.equal(new URL(url, "http://localhost").searchParams.get("generation"), GENERATION);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("cancelling a native Storage response destroys the underlying stalled HTTP request", async () => {
  let closed!: () => void;
  const connectionClosed = new Promise<void>(resolve => { closed = resolve; });
  const server = createServer((_request, response) => {
    response.once("close", closed);
    response.writeHead(206, { "content-length": "4", "x-goog-generation": GENERATION });
    response.write("t");
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  const storage = testStorage(address.port);
  const stream = createFirebasePhotoBucketPort(storage.bucket("synthetic-bucket")).readPinned("synthetic-object", GENERATION);
  let timer: NodeJS.Timeout | undefined;
  try {
    const failure = new Error("synthetic_consumer_cancelled");
    stream.once("response", () => stream.destroy(failure));
    await assert.rejects(async () => { for await (const _part of stream) assert.fail("cancelled response yielded bytes"); }, failure);
    await Promise.race([connectionClosed, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("native_request_not_cancelled")), 1_500);
    })]);
    assert.equal(stream.destroyed, true);
  } finally { clearTimeout(timer); stream.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("cancelling before response headers aborts the native authenticated HTTP request", async () => {
  let arrived!: () => void, closed!: () => void;
  const requestArrived = new Promise<void>(resolve => { arrived = resolve; });
  const connectionClosed = new Promise<void>(resolve => { closed = resolve; });
  const server = createServer((_request, response) => { response.once("close", closed); arrived(); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  const stream = createFirebasePhotoBucketPort(testStorage(address.port).bucket("synthetic-bucket")).readPinned("synthetic-object", GENERATION);
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("native_request_not_cancelled")), 1_500); });
  try {
    const failure = new Error("synthetic_preheader_cancelled");
    const rejected = assert.rejects(async () => { for await (const _part of stream) assert.fail("cancelled response yielded bytes"); }, failure);
    await Promise.race([requestArrived, deadline]); stream.destroy(failure);
    await Promise.race([Promise.all([rejected, connectionClosed]), deadline]);
  } finally { clearTimeout(timer); stream.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("error status reaches the domain guard without buffering its body or retrying", async () => {
  let closed!: () => void, requests = 0;
  const connectionClosed = new Promise<void>(resolve => { closed = resolve; });
  const server = createServer((_request, response) => {
    requests++; response.once("close", closed);
    response.writeHead(500, { "content-length": String(2 * 1024 * 1024) }); response.write("untrusted");
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  const stream = createFirebasePhotoBucketPort(testStorage(address.port).bucket("synthetic-bucket")).readPinned("synthetic-object", GENERATION);
  let timer: NodeJS.Timeout | undefined, status: number | undefined;
  try {
    const failure = new Error("synthetic_rejected_status");
    stream.once("response", response => { status = response.statusCode; stream.destroy(failure); });
    const rejected = assert.rejects(async () => { for await (const _part of stream) assert.fail("error body yielded bytes"); }, failure);
    await Promise.race([Promise.all([rejected, connectionClosed]), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("error_status_buffered_or_not_cancelled")), 1_500);
    })]);
    assert.equal(status, 500); assert.equal(requests, 1);
  } finally { clearTimeout(timer); stream.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { createPhotoCleanup } from "../server/photo-cleanup.ts";
import { createPhotoStore } from "../server/photo-store.ts";
import type { PhotoFiles } from "../server/photo-files.ts";
import type { StorageCipher } from "../server/storage-crypto.ts";

const flush = async () => { for (let count = 0; count < 8; count++) await Promise.resolve(); };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

test("photo cleanup keeps the initial pass and 30 second cadence with one start", async context => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0;
  const cleanup = createPhotoCleanup({ async purgeDeleted() { calls++; } });
  const started = cleanup.start();
  assert.equal(cleanup.start(), started);
  await started;
  assert.equal(calls, 1);
  context.mock.timers.tick(29999);
  assert.equal(calls, 1);
  context.mock.timers.tick(1);
  await flush();
  assert.equal(calls, 2);
  await cleanup.stop();
  context.mock.timers.tick(60000);
  await cleanup.start();
  assert.equal(calls, 2);
});

test("photo cleanup drains the original deletion receipt before closing storage", async context => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const removal = deferred();
  const removing = deferred();
  const events: string[] = [];
  let selects = 0, closed = false;
  const photoId = "00000000-0000-4000-8000-000000000001";
  const pool = {
    async query(sql: string, values?: unknown[]) {
      assert.equal(closed, false, "Deletion acknowledgement must precede pool shutdown");
      if (sql.startsWith("SELECT")) return { rows: ++selects === 1 ? [] : [{ id: photoId }] };
      assert.equal(sql, "DELETE FROM photo_file_deletions WHERE id=$1");
      assert.deepEqual(values, [photoId]);
      events.push("receipt-acknowledged");
      return { rows: [] };
    },
    async end() { closed = true; events.push("pool-closed"); },
  };
  const files = { async remove(id: string) {
    assert.equal(id, photoId);
    events.push("remove-started"); removing.resolve();
    await removal.promise;
    events.push("remove-finished");
  } } as PhotoFiles;
  const store = createPhotoStore(pool as unknown as Pool, {} as StorageCipher, files);
  const cleanup = createPhotoCleanup(store);
  await cleanup.start();
  context.mock.timers.tick(30000);
  await removing.promise;
  context.mock.timers.tick(60000);
  assert.equal(selects, 2, "An in-flight pass must not overlap a new pass");
  const stopping = cleanup.stop();
  assert.equal(cleanup.stop(), stopping);
  const closing = stopping.then(() => pool.end());
  await flush();
  assert.equal(closed, false);
  removal.resolve();
  await closing;
  assert.deepEqual(events, ["remove-started", "remove-finished", "receipt-acknowledged", "pool-closed"]);
  context.mock.timers.tick(60000);
  assert.equal(selects, 2);
});

test("photo cleanup keeps failures pending and retries at the next interval without logging details", async context => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const warnings = context.mock.method(console, "warn", () => {});
  let calls = 0;
  const cleanup = createPhotoCleanup({ async purgeDeleted() {
    calls++;
    if (calls === 1) throw new Error("synthetic private failure detail");
  } });
  await cleanup.start();
  assert.equal(calls, 1);
  assert.deepEqual(warnings.mock.calls.map(call => call.arguments), [["attachment_cleanup_pending"]]);
  context.mock.timers.tick(30000);
  await flush();
  assert.equal(calls, 2);
  await cleanup.stop();
});

test("photo cleanup stopped during its first pass does not install a timer afterward", async context => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const firstPass = deferred();
  let calls = 0, stopped = false;
  const cleanup = createPhotoCleanup({ async purgeDeleted() { calls++; await firstPass.promise; } });
  const started = cleanup.start();
  const stopping = cleanup.stop();
  void stopping.then(() => { stopped = true; });
  await flush();
  assert.equal(stopped, false);
  firstPass.resolve();
  await Promise.all([started, stopping]);
  context.mock.timers.tick(60000);
  assert.equal(calls, 1);
});

test("photo cleanup stopped before startup does not begin a deletion pass", async () => {
  let calls = 0;
  const cleanup = createPhotoCleanup({ async purgeDeleted() { calls++; } });
  await cleanup.stop();
  await cleanup.start();
  assert.equal(calls, 0);
});

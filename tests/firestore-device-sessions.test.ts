import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import type { Firestore } from "@google-cloud/firestore";
import { DeviceSessionError, FirestoreDeviceSessions, type FirestoreDeviceSessionsOptions, type DeviceSessionIssue } from "../server/firestore-device-sessions.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const code = (value: string, status?: number) => (error: unknown) => error instanceof DeviceSessionError
  && error.code === value && (status === undefined || error.status === status);
function fixture() {
  const records = new Map<string, unknown>(); let retry = false, lose = false, unavailable = false, now = 1_800_000_000_000;
  let tail = Promise.resolve(); let readCount = 0, writeCount = 0;
  type Ref = { path: string };
  const database = {
    collection(namespace: string) { return { doc(id: string): Ref { return { path: namespace + "/" + id }; } }; },
    async runTransaction(callback: (tx: unknown) => Promise<unknown>, options?: { readOnly?: boolean }) {
      if (unavailable) throw new Error("Synthetic Firestore unavailable");
      let release!: () => void; const previous = tail; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
      try {
        const run = async () => {
          const writes = new Map<string, unknown>();
          const get = async (ref: Ref) => {
            readCount++; assert.equal(writes.size, 0, "All reads precede writes");
            return { exists: records.has(ref.path), data: () => structuredClone(records.get(ref.path)) };
          };
          const set = (ref: Ref, value: unknown) => {
            assert.notEqual(options?.readOnly, true); writes.set(ref.path, structuredClone(value));
          };
          const result = await callback({ get, getAll: (...refs: Ref[]) => Promise.all(refs.map(get)), set,
            create(ref: Ref, value: unknown) { assert.equal(records.has(ref.path), false); set(ref, value); } });
          return { writes, result };
        };
        if (retry) { retry = false; await run(); }
        const { writes, result } = await run();
        for (const [key, value] of writes) { records.set(key, value); writeCount++; }
        if (lose) { lose = false; throw new Error("Synthetic lost commit acknowledgement"); }
        return result;
      } finally { release(); }
    },
  } as unknown as Firestore;
  const options: FirestoreDeviceSessionsOptions = { database, cipher: createStorageCipher(Buffer.alloc(32, 91)),
    projectId: "synthetic-server-project", namespace: "device_test", serverClock: () => now };
  const service = new FirestoreDeviceSessions(options);
  const issue = (cookie: string, userId = "synthetic-owner", authTimeSeconds = Math.floor(now / 1000)): DeviceSessionIssue =>
    ({ userId, sessionHash: hash(cookie), expiresAtMs: now + 432_000_000, authTimeSeconds });
  return { database, options, service, records, issue, setNow: (value: number) => { now = value; }, now: () => now,
    retryNext: () => { retry = true; }, loseNext: () => { lose = true; }, unavailable: (value: boolean) => { unavailable = value; },
    counts: () => ({ readCount, writeCount }) };
}

test("device ledger is inert, validates server configuration, stores ciphertext with opaque paths, and never stores cookies", async () => {
  const f = fixture(); assert.equal(f.records.size, 0);
  for (const patch of [{ database: undefined }, { cipher: undefined }, { projectId: "" }, { namespace: "../unsafe" }, { serverClock: 3 }]) {
    assert.throws(() => new FirestoreDeviceSessions({ ...f.options, ...patch } as unknown as FirestoreDeviceSessionsOptions), code("invalid_configuration", 400));
  }
  const cookie = "sensitive-native-session-cookie", identity = f.issue(cookie, "private.person@example.test");
  await f.service.issue(identity);
  const serialized = JSON.stringify([...f.records]);
  assert.equal(serialized.includes(cookie), false); assert.equal(serialized.includes(identity.userId), false);
  assert.equal(f.records.size, 2);
  assert.ok([...f.records.keys()].every(path => /^device_test\/auth-(control|session)-[a-f0-9]{64}$/.test(path)));
  assert.ok([...f.records.values()].every(row => Object.keys(row as object).sort().join(",") === "ciphertext,format,kind,version"));
  const before = f.counts(); await f.service.assertActive(identity); const after = f.counts();
  assert.equal(after.readCount - before.readCount, 2); assert.equal(after.writeCount, before.writeCount);
  assert.equal("close" in f.service, false);
});

test("identical issue is replay safe, binding changes and revoked cookies cannot overwrite ledger state", async () => {
  const f = fixture(), identity = f.issue("device-one");
  await f.service.issue(identity); const before = f.counts().writeCount;
  await f.service.issue(identity); assert.equal(f.counts().writeCount, before);
  await assert.rejects(f.service.issue({ ...identity, expiresAtMs: identity.expiresAtMs + 1 }), code("session_binding_conflict", 409));
  await f.service.revokeThis(identity); await f.service.revokeThis(identity);
  await assert.rejects(f.service.assertActive(identity), code("session_invalid", 401));
  await assert.rejects(f.service.issue(identity), code("session_invalid", 401));
  assert.equal(f.records.size, 2);
});

test("this-device sign-out preserves the other device and expiry is enforced without writes", async () => {
  const f = fixture(), one = f.issue("one"), two = f.issue("two");
  await f.service.issue(one); await f.service.issue(two);
  await f.service.revokeThis(one);
  await assert.rejects(f.service.assertActive(one), code("session_invalid", 401)); await f.service.assertActive(two);
  f.setNow(two.expiresAtMs);
  const writes = f.counts().writeCount;
  await assert.rejects(f.service.assertActive(two), code("session_invalid", 401)); assert.equal(f.counts().writeCount, writes);
});

test("revoke-others retains only the current old session and requires auth_time strictly after the revocation second", async () => {
  const f = fixture(), one = f.issue("one"), two = f.issue("two"), otherOwner = f.issue("other-owner", "other-owner");
  await f.service.issue(one); await f.service.issue(two); await f.service.issue(otherOwner);
  await f.service.revokeOthers(one);
  await f.service.assertActive(one); await f.service.assertActive(otherOwner);
  await assert.rejects(f.service.assertActive(two), code("session_invalid", 401));
  await assert.rejects(f.service.issue(one), code("recent_reauthentication_required", 409));
  await f.service.issue({ ...one, existingSessionHash: one.sessionHash });
  await assert.rejects(f.service.issue({ ...one, existingSessionHash: two.sessionHash }), code("recent_reauthentication_required", 409));
  await assert.rejects(f.service.issue(f.issue("old-auth-exchange")), code("recent_reauthentication_required", 409));
  f.setNow(f.now() + 999);
  await assert.rejects(f.service.issue(f.issue("same-second-auth")), code("recent_reauthentication_required", 409));
  f.setNow(f.now() + 1);
  const newlyAuthenticated = f.issue("fresh-auth"); await f.service.issue(newlyAuthenticated); await f.service.assertActive(newlyAuthenticated);
  await f.service.revokeOthers(one);
  await f.service.assertActive(one); await assert.rejects(f.service.assertActive(newlyAuthenticated), code("session_invalid", 401));
  await f.service.revokeThis(one);
  await assert.rejects(f.service.assertActive(one), code("session_invalid", 401));
  await assert.rejects(f.service.issue(f.issue("new-hash-old-token", one.userId, one.authTimeSeconds)), code("recent_reauthentication_required", 409));
});

test("owner, project, namespace and document kind cannot substitute another encrypted record", async () => {
  const f = fixture(), one = f.issue("one"), two = f.issue("two", "other-owner");
  await f.service.issue(one); await f.service.issue(two);
  await assert.rejects(f.service.issue({ ...one, userId: two.userId }), code("device_sessions_unavailable", 503));
  await assert.rejects(f.service.assertActive({ ...one, userId: two.userId }), code("device_sessions_unavailable", 503));
  const differentProject = new FirestoreDeviceSessions({ ...f.options, projectId: "other-server-project" });
  await assert.rejects(differentProject.assertActive(one), code("device_sessions_unavailable", 503));
  const differentNamespace = new FirestoreDeviceSessions({ ...f.options, namespace: "other_namespace" });
  await assert.rejects(differentNamespace.assertActive(one), code("session_invalid", 401));
  await differentNamespace.issue(one); await differentNamespace.assertActive(one);
  const key = "device_test/auth-session-" + one.sessionHash, envelope = f.records.get(key) as { kind: string };
  f.records.set(key, { ...envelope, kind: "sessionControl" });
  await assert.rejects(f.service.assertActive(one), code("device_sessions_unavailable", 503));
});

test("transaction callback replay and lost acknowledgement preserve committed revocation and identical issue recovery", async () => {
  const f = fixture(), one = f.issue("one"), two = f.issue("two");
  f.retryNext(); await f.service.issue(one); assert.equal(f.records.size, 2);
  f.loseNext(); await assert.rejects(f.service.issue(two), code("device_sessions_unavailable", 503));
  await f.service.issue(two); await f.service.assertActive(two);
  f.retryNext(); f.loseNext();
  await assert.rejects(f.service.revokeOthers(one), code("device_sessions_unavailable", 503));
  await f.service.assertActive(one); await assert.rejects(f.service.assertActive(two), code("session_invalid", 401));
  await assert.rejects(f.service.issue(f.issue("old-token-new-cookie")), code("recent_reauthentication_required", 409));
  f.unavailable(true);
  await assert.rejects(f.service.assertActive(one), code("device_sessions_unavailable", 503));
});

test("missing credentials and malformed lifetimes fail closed without creating or repairing ledger documents", async () => {
  const f = fixture(), one = f.issue("one");
  await assert.rejects(f.service.assertActive(one), code("session_invalid", 401)); await f.service.revokeThis(one);
  await assert.rejects(f.service.revokeOthers(one), code("session_invalid", 401));
  for (const input of [{ ...one, sessionHash: "raw-cookie" }, { ...one, userId: "" }, { ...one, expiresAtMs: f.now() },
    { ...one, authTimeSeconds: Math.floor(f.now() / 1000) + 1 }]) await assert.rejects(f.service.issue(input), error => error instanceof DeviceSessionError && error.status === 400);
  assert.equal(f.records.size, 0);
  await f.service.issue(one);
  f.records.delete("device_test/auth-control-" + hash(one.userId));
  await assert.rejects(f.service.issue(one), code("device_sessions_unavailable", 503)); assert.equal(f.records.size, 1);
});

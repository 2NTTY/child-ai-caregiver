import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createFirebaseRequestHandler } from "../server/firebase-app.ts";
import { FirebaseAuthError, type FirebaseAuthPort } from "../server/firebase-auth.ts";
import { createFirestoreAuthority, FirestoreAuthorityError, type FirestoreAuthority } from "../server/firestore-authority.ts";
import { SERVICE_DATA_NOTICE, SERVICE_POLICY_VERSION, type AccountServiceStatus } from "../src/shared/account-service.ts";
import type { ServerAuthSession, ServerAuthSessionWithHeaders } from "../server/auth-port.ts";
import { createFirestoreFamilyDocumentStore } from "../server/firestore-family-documents.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { firestoreDomainFixture } from "./helpers/firestore-domain-memory.ts";
import type { DocumentRequest, FamilyDocument } from "../src/shared/family-documents.ts";
import type { PhotoAttachment } from "../src/shared/photos.ts";
import type { FirebasePhotoApiPort } from "../server/firebase-photo-api.ts";
import type { OnlineSubmission } from "../src/shared/online.ts";
import { createFirestoreOnlineStore, type FirestoreOnlineStore } from "../server/firestore-online.ts";
import { createFirestoreTaskWorker } from "../server/firestore-task-worker.ts";

const PUBLIC_ORIGIN = "https://synthetic.example.test";
const USER_ID = "synthetic-owner";
const OPERATION_ID = "55e6449b-7ef3-4bf2-9c99-2f2f64fd746b";
const acknowledgement = { accepted: true, policyVersion: SERVICE_POLICY_VERSION, operationId: OPERATION_ID };
function fixture(mailConfigured = false) {
  let userId: string | null = USER_ID, acknowledged = false;
  let authFailure: unknown, statusFailure: unknown, acknowledgementFailure: unknown;
  let beforeSession: ((sessionNumber: number) => void) | undefined;
  const authRequests: Request[] = [], sessionHeaders: Headers[] = [], statusUserIds: (string | null)[] = [];
  const writes: Parameters<FirestoreAuthority["acknowledge"]>[0][] = [];
  function status(uid: string | null): Omit<AccountServiceStatus, "mailConfigured"> {
    return { enabled: true, registration: "invite", policyVersion: SERVICE_POLICY_VERSION, notice: SERVICE_DATA_NOTICE,
      user: uid === null ? null : { id: uid, emailVerified: true, acknowledged,
        acknowledgementVersion: acknowledged ? SERVICE_POLICY_VERSION : null } };
  }
  const authority: Pick<FirestoreAuthority, "accountStatus" | "acknowledge"> = {
    async accountStatus(uid) {
      statusUserIds.push(uid); if (statusFailure) throw statusFailure; return status(uid);
    },
    async acknowledge(input) {
      if (acknowledgementFailure) throw acknowledgementFailure;
      writes.push(input); acknowledged = true; return { policyVersion: SERVICE_POLICY_VERSION };
    },
  };
  function getSession(options: { headers: Headers; returnHeaders?: false }): Promise<ServerAuthSession | null>;
  function getSession(options: { headers: Headers; returnHeaders: true }): Promise<ServerAuthSessionWithHeaders>;
  async function getSession(options: { headers: Headers; returnHeaders?: boolean }) {
    sessionHeaders.push(options.headers); beforeSession?.(sessionHeaders.length); if (authFailure) throw authFailure;
    const response = userId === null ? null : { user: { id: userId } };
    return options.returnHeaders ? { response, headers: new Headers() } : response;
  }
  const auth: FirebaseAuthPort = {
    getSession,
    async handler(request) {
      authRequests.push(request);
      return Response.json({ provider: "native-firebase", path: new URL(request.url).pathname }, { status: 202,
        headers: { "Cache-Control": "public, max-age=600", "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Credentials": "true", "Set-Cookie": "__session=synthetic; HttpOnly; Secure; SameSite=Lax" } });
    },
    fromNodeHeaders() { return new Headers(); },
    async assertRecentReauthentication() { throw new Error("Not part of this foundation assignment"); },
  };
  const options = { authority, auth, publicOrigin: PUBLIC_ORIGIN, mailConfigured };
  const handler = createFirebaseRequestHandler(options);
  const get = (path: string, headers?: HeadersInit) => handler(new Request(PUBLIC_ORIGIN + path, { headers }));
  const post = (body: unknown = acknowledgement, patch: Record<string, string | null> = {}) => {
    const headers = new Headers({ Origin: PUBLIC_ORIGIN, "Content-Type": "application/json", "x-expected-user-id": USER_ID });
    for (const [key, value] of Object.entries(patch)) { if (value === null) headers.delete(key); else headers.set(key, value); }
    return handler(new Request(PUBLIC_ORIGIN + "/api/account/acknowledgement", { method: "POST", headers, body: JSON.stringify(body) }));
  };
  return { handler, options, get, post, writes, authRequests, sessionHeaders, statusUserIds, status,
    setUser: (value: string | null) => { userId = value; }, beforeSession: (value: (sessionNumber: number) => void) => { beforeSession = value; }, failAuth: (value: unknown) => { authFailure = value; },
    failStatus: (value: unknown) => { statusFailure = value; }, failAcknowledgement: (value: unknown) => { acknowledgementFailure = value; } };
}
function privateResponse(response: Response) {
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Pragma"), "no-cache");
  assert.ok([...response.headers.keys()].every(key => !key.startsWith("access-control-")));
}
async function errorCode(response: Response, status: number, code: string) {
  assert.equal(response.status, status); privateResponse(response);
  const value = await response.json(); assert.equal(value.error.code, code); assert.equal(typeof value.error.message, "string");
  return value;
}

test("foundation handler is inert and health reports only the process stage without checking credentials or database", async () => {
  const f = fixture();
  assert.equal(f.authRequests.length + f.sessionHeaders.length + f.statusUserIds.length + f.writes.length, 0);
  f.failAuth(new Error("private credential configuration")); f.failStatus(new Error("private database configuration"));
  const response = await f.get("/healthz");
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: "ok", storage: "firestore", stage: "foundation" });
  privateResponse(response);
  assert.equal(f.sessionHeaders.length, 0); assert.equal(f.statusUserIds.length, 0);
  assert.throws(() => createFirebaseRequestHandler({ ...f.options, mailConfigured: undefined } as unknown as typeof f.options), /invalid_firebase_app_configuration/);
  assert.throws(() => createFirebaseRequestHandler({ ...f.options, publicOrigin: PUBLIC_ORIGIN + "/" }), /invalid_firebase_app_configuration/);
});

test("all auth paths delegate the original Web Request and preserve native cookies while enforcing private responses without CORS permission", async () => {
  const f = fixture();
  for (const [path, method] of [["/api/auth/get-session", "GET"], ["/api/auth/session", "POST"], ["/api/auth/sign-out", "POST"]]) {
    const request = new Request(PUBLIC_ORIGIN + path, { method, ...(method === "POST" ? { body: "{}" } : {}) });
    const response = await f.handler(request); assert.equal(f.authRequests.at(-1), request);
    assert.equal(response.status, 202); assert.equal((await response.json()).path, path); privateResponse(response);
    assert.equal(response.headers.get("set-cookie"), "__session=synthetic; HttpOnly; Secure; SameSite=Lax");
  }
  assert.equal(f.sessionHeaders.length, 0); assert.equal(f.writes.length, 0);
});

test("account status uses only the current auth identity and explicitly supplied mail readiness for anonymous and signed-in reads", async () => {
  const f = fixture();
  const response = await f.get("/api/account", { "x-expected-user-id": "untrusted-identity" });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ...f.status(USER_ID), mailConfigured: false });
  assert.deepEqual(f.statusUserIds, [USER_ID]); privateResponse(response);
  f.setUser(null);
  assert.deepEqual(await (await f.get("/api/account")).json(), { ...f.status(null), mailConfigured: false });
  assert.deepEqual(f.statusUserIds, [USER_ID, null]);
  const configured = fixture(true); assert.equal((await (await configured.get("/api/account")).json()).mailConfigured, true);
});

test("acknowledgement validates the existing schema, carries the original operation ID and returns the full current account status", async () => {
  const f = fixture(true), response = await f.post();
  assert.equal(response.status, 200); privateResponse(response);
  assert.deepEqual(f.writes, [{ userId: USER_ID, operationId: OPERATION_ID, policyVersion: SERVICE_POLICY_VERSION }]);
  assert.deepEqual(await response.json(), { ...f.status(USER_ID), mailConfigured: true });
  assert.deepEqual(f.statusUserIds, [USER_ID]);
  for (const body of [{ ...acknowledgement, accepted: false }, { ...acknowledgement, userId: "untrusted" },
    { ...acknowledgement, policyVersion: "old-policy" }, { ...acknowledgement, operationId: "new-operation" }]) {
    await errorCode(await f.post(body), 400, "account_acknowledgement_invalid");
  }
  assert.equal(f.writes.length, 1);
});

test("acknowledgement requires exact same-origin and a matching authenticated identity before calling authority", async () => {
  const f = fixture();
  for (const origin of [null, "https://foreign.example.test", PUBLIC_ORIGIN + "/"]) {
    await errorCode(await f.post(acknowledgement, { Origin: origin }), 403, "origin_rejected");
  }
  assert.equal(f.sessionHeaders.length, 0);
  for (const expected of [null, "different-user"]) {
    await errorCode(await f.post(acknowledgement, { "x-expected-user-id": expected }), 409, "identity_changed");
  }
  f.setUser(null); await errorCode(await f.post(), 401, "unauthorized");
  assert.equal(f.writes.length, 0); assert.equal(f.statusUserIds.length, 0);
});

test("acknowledgement JSON parsing bounds both declared and actual bytes and rejects malformed or non-JSON bodies", async () => {
  const f = fixture();
  await errorCode(await f.post(acknowledgement, { "Content-Type": null }), 415, "json_required");
  await errorCode(await f.post(acknowledgement, { "Content-Length": "16385" }), 413, "request_body_too_large");
  await errorCode(await f.post({ ...acknowledgement, padding: "x".repeat(16 * 1024) }), 413, "request_body_too_large");
  const headers = { Origin: PUBLIC_ORIGIN, "Content-Type": "application/json", "x-expected-user-id": USER_ID };
  for (const body of ["{", "", "[]", "null"]) {
    const response = await f.handler(new Request(PUBLIC_ORIGIN + "/api/account/acknowledgement", { method: "POST", headers, body }));
    assert.equal(response.status, 400); privateResponse(response);
  }
  assert.equal(f.writes.length, 0);
});

test("auth or database outages remain 503 and do not become anonymous account state or successful acknowledgements", async () => {
  const f = fixture();
  f.failAuth(new FirebaseAuthError(503, "authentication_unavailable"));
  await errorCode(await f.get("/api/account"), 503, "firebase_service_unavailable");
  assert.equal(f.statusUserIds.length, 0);
  f.failAuth(undefined); f.failStatus(new Error("private database host and secret"));
  const error = await errorCode(await f.get("/api/account"), 503, "firebase_service_unavailable");
  assert.equal(JSON.stringify(error).includes("secret"), false);
  await errorCode(await f.post(), 503, "firebase_service_unavailable");
  assert.equal(f.writes.length, 1, "Committed write can survive a failed result read; caller retains its original operation ID");
  f.failStatus(undefined); f.failAcknowledgement(new Error("private database details"));
  await errorCode(await f.post(), 503, "firebase_service_unavailable");
  assert.equal(f.writes.length, 1);
});

test("known authority and authentication errors preserve only fixed safe codes and unexpected errors never expose exception text", async () => {
  const f = fixture();
  for (const [code, status] of [["invalid_input", 400], ["operation_conflict", 409], ["account_inactive", 403], ["email_not_verified", 403]] as const) {
    f.failAcknowledgement(new FirestoreAuthorityError(code, status));
    await errorCode(await f.post(), status, code);
  }
  f.failAcknowledgement(new FirestoreAuthorityError("private-email@example.test", 403));
  const result = await errorCode(await f.post(), 503, "firebase_service_unavailable");
  assert.equal(JSON.stringify(result).includes("private-email"), false);
  f.failAcknowledgement(undefined); f.failAuth(new FirebaseAuthError(403, "identity_email_changed"));
  await errorCode(await f.get("/api/account"), 403, "identity_email_changed");
});

test("unmigrated business domains return explicit 503 without fake data, auth lookups or writer execution", async () => {
  const f = fixture();
  for (const path of ["/api", "/api/children", "/api/children/child/messages", "/api/account/export", "/api/health"]) {
    await errorCode(await f.get(path), 503, "firebase_domain_not_ready");
  }
  await errorCode(await f.handler(new Request(PUBLIC_ORIGIN + "/api/children", { method: "POST", body: "{}" })), 503, "firebase_domain_not_ready");
  await errorCode(await f.get("/unknown"), 404, "not_found");
  await errorCode(await f.handler(new Request(PUBLIC_ORIGIN + "/healthz", { method: "POST" })), 404, "not_found");
  assert.equal(f.sessionHeaders.length, 0); assert.equal(f.statusUserIds.length, 0); assert.equal(f.writes.length, 0);
});

test("Firebase domain dispatch preserves session fencing, original routes and explicit unavailable domains", async () => {
  const f = fixture(), reads: { userId: string; cursor: string | null }[] = [];
  const childId = "00000000-0000-4000-8000-000000000001";
  let changeIdentity = false;
  const unavailable = async () => { throw new Error("Unexpected store call"); };
  const online = {
    spaces: unavailable, context: unavailable, submit: unavailable, lookup: unavailable, changes: unavailable,
    children: { async list(userId: string, cursor: string | null = null) {
      reads.push({ userId, cursor }); if (changeIdentity) f.setUser("other-user");
      return { children: [{ id: childId, workspaceId: childId, displayName: "Synthetic child", createdAt: "2026-10-11T00:00:00Z", accessRole: "owner" as const }], nextCursor: null };
    } },
    tasks: { list: unavailable, get: unavailable, history: unavailable },
  };
  const handler = createFirebaseRequestHandler({ ...f.options, online });
  const get = (path: string, expected = USER_ID) => handler(new Request(PUBLIC_ORIGIN + path, { headers: { "x-expected-user-id": expected } }));
  const page = await get("/api/children?cursor=synthetic-cursor");
  assert.equal(page.status, 200); privateResponse(page);
  assert.equal((await page.json()).children[0].id, childId);
  assert.deepEqual(reads, [{ userId: USER_ID, cursor: "synthetic-cursor" }]);
  await errorCode(await get("/api/children", "other-user"), 409, "identity_changed");
  assert.equal(reads.length, 1);
  await errorCode(await handler(new Request(PUBLIC_ORIGIN + "/api/online/context", { method: "POST", headers: { Origin: "https://other.example.test" }, body: "{}" })), 403, "origin_rejected");
  changeIdentity = true;
  const changed = await get("/api/children");
  await errorCode(changed, 409, "identity_changed");
  f.setUser(null);
  await errorCode(await get("/api/children"), 401, "unauthorized");
  await errorCode(await get("/api/children/" + childId + "/documents"), 503, "firebase_domain_not_ready");
});
const preparationRequest: DocumentRequest = { kind: "preparation", purpose: "appointment", title: "Synthetic preparation document",
  eventDate: "2026-10-15", period: { from: "2026-10-01", to: "2026-10-31" } };
async function documentFixture() {
  const f = fixture(), fake = firestoreDomainFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 86)),
    projectId: "synthetic-firebase-document-app", namespace: "synthetic_firebase_document_app" };
  const authority = createFirestoreAuthority(options), documents = createFirestoreFamilyDocumentStore(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  await authority.issueInvitation({ email: "owner@example.test", expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
  await authority.admitIdentity({ userId: USER_ID, email: "owner@example.test", emailVerified: true });
  await authority.acknowledge({ userId: USER_ID, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const child = (await authority.createChild({ userId: USER_ID, operationId: randomUUID(), displayName: "合成文件孩子" })).child;
  const handler = createFirebaseRequestHandler({ ...f.options, authority, documents }), path = `/api/children/${child.id}/documents`;
  const post = (opId = OPERATION_ID, patch: Record<string, string | null> = {}) => {
    const headers = new Headers({ Origin: PUBLIC_ORIGIN, "Content-Type": "application/json", "x-expected-user-id": USER_ID });
    for (const [key, value] of Object.entries(patch)) { if (value === null) headers.delete(key); else headers.set(key, value); }
    return handler(new Request(PUBLIC_ORIGIN + path, { method: "POST", headers, body: JSON.stringify({ opId, request: preparationRequest }) }));
  };
  const get = (suffix = "", headers: HeadersInit = { "x-expected-user-id": USER_ID }) => handler(new Request(PUBLIC_ORIGIN + path + suffix, { headers }));
  return { ...f, handler, fake, documents, child, post, get };
}

test("Firebase document dispatch uses the real Firestore port and preserves the direct original operation contract", async () => {
  const f = await documentFixture(), created = await f.post();
  assert.equal(created.status, 200); privateResponse(created);
  const item = (await created.json()).item as FamilyDocument;
  assert.equal(item.childId, f.child.id); assert.equal(item.current!.title, preparationRequest.title);
  assert.equal(item.readState, "ready");
  const committed = [...f.fake.records], replay = await f.post();
  assert.equal(replay.status, 200); assert.deepEqual((await replay.json()).item, item); assert.deepEqual([...f.fake.records], committed);
  const read = await f.get("/" + item.id); assert.equal(read.status, 200); privateResponse(read);
  assert.deepEqual((await read.json()).item, item);
  const page = await f.get(); assert.equal(page.status, 200); assert.equal((await page.json()).page.items[0].id, item.id);
  assert.deepEqual(await f.documents.operationReceipt(USER_ID, f.child.id, OPERATION_ID), { operationId: OPERATION_ID, documentId: item.id, savedVersion: 1 });
});

test("Firebase document dispatch rejects foreign origins, missing expected users and unauthenticated identities before writing", async () => {
  const f = await documentFixture(), before = [...f.fake.records];
  await errorCode(await f.post(OPERATION_ID, { Origin: PUBLIC_ORIGIN + "/" }), 403, "origin_rejected");
  assert.equal(f.sessionHeaders.length, 0);
  await errorCode(await f.post(OPERATION_ID, { "x-expected-user-id": null }), 428, "account_precondition_required");
  await errorCode(await f.get("", {}), 428, "account_precondition_required");
  await errorCode(await f.post(OPERATION_ID, { "x-expected-user-id": "different-user" }), 409, "session_changed");
  f.setUser(null); await errorCode(await f.post(), 401, "unauthorized");
  assert.deepEqual([...f.fake.records], before);
});

test("Firebase document dispatch fences a switched identity before store access and after a committed result without exposing the document", async () => {
  const beforeRead = await documentFixture(), before = [...beforeRead.fake.records];
  beforeRead.beforeSession(number => { if (number === 2) beforeRead.setUser("different-user"); });
  await errorCode(await beforeRead.post(), 409, "identity_changed"); assert.deepEqual([...beforeRead.fake.records], before);
  const afterWrite = await documentFixture();
  afterWrite.beforeSession(number => { if (number === 3) afterWrite.setUser("different-user"); });
  const changed = await errorCode(await afterWrite.post(), 409, "identity_changed");
  assert.equal("item" in changed, false);
  const receipt = await afterWrite.documents.operationReceipt(USER_ID, afterWrite.child.id, OPERATION_ID); assert.ok(receipt);
  const committed = [...afterWrite.fake.records]; afterWrite.setUser(USER_ID);
  const recovered = await afterWrite.post(); assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).item.id, receipt.documentId); assert.deepEqual([...afterWrite.fake.records], committed);
});

function photoFixture() {
  const f = fixture(), childId = '00000000-0000-4000-8000-000000000011', id = '00000000-0000-4000-8000-000000000012';
  const bytes = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes); bytes.write('IHDR', 12, 'ascii');
  const photo: PhotoAttachment = { id, childId, ownerUserId: USER_ID, createdAt: '2026-10-11T00:00:00Z', version: 1, state: 'reserved', visibility: 'private',
    canManage: true, recordId: null, fileName: 'synthetic.png', source: 'Synthetic', mimeType: 'image/png', bytes: bytes.length, sha256: 'a'.repeat(64),
    extraction: { state: 'not_requested', runId: null, draft: null, stopReason: null, processedAt: null, model: null } };
  const cursor = { scopeTag: 'b'.repeat(64), sortKey: photo.createdAt + '/' + id };
  const reads: Parameters<FirebasePhotoApiPort['list']>[2][] = [], uploads: string[] = [], submissions: OnlineSubmission[] = [];
  let changedAfterUpload = false;
  const photos: FirebasePhotoApiPort = {
    async list(userId, child, input) { assert.equal(userId, USER_ID); assert.equal(child, childId); reads.push(input);
      return { photos: [photo], canCreate: true, complete: input?.cursor !== null, nextCursor: input?.cursor ? null : cursor }; },
    async get(userId, child, asset) { assert.equal(userId, USER_ID); assert.equal(child, childId); assert.equal(asset, id); return photo; },
    async content() { return { bytes, base64: bytes.toString('base64'), mimeType: 'image/png' }; },
    async upload(userId, child, asset, base64) { assert.equal(userId, USER_ID); assert.equal(child, childId); assert.equal(asset, id); uploads.push(base64);
      if (changedAfterUpload) f.setUser('other-user'); return { ...photo, state: 'ready', version: 2 }; },
  };
  const unavailable = async () => { throw new Error('Unexpected store call'); };
  const online: FirestoreOnlineStore = { spaces: unavailable, context: unavailable, lookup: unavailable, changes: unavailable,
    children: { list: unavailable }, tasks: { list: unavailable, get: unavailable, history: unavailable },
    async submit(userId, submission) { assert.equal(userId, USER_ID); submissions.push(submission);
      return { state: 'confirmed', operation: submission.operation, path: submission.path, changeSeq: '1', statusCode: 201, result: { photo } }; } };
  const handler = createFirebaseRequestHandler({ ...f.options, photos, online }), path = `/api/children/${childId}/photos`;
  const get = (suffix = '', headers: HeadersInit = { 'x-expected-user-id': USER_ID }) => handler(new Request(PUBLIC_ORIGIN + path + suffix, { headers }));
  const post = (suffix: string, body: unknown = {}, patch: Record<string, string | null> = {}) => {
    const headers = new Headers({ Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json', 'x-expected-user-id': USER_ID });
    for (const [key, value] of Object.entries(patch)) { if (value === null) headers.delete(key); else headers.set(key, value); }
    return handler(new Request(PUBLIC_ORIGIN + path + suffix, { method: 'POST', headers, body: JSON.stringify(body) }));
  };
  return { ...f, handler, photos, photo, cursor, bytes, id, childId, path, get, post, reads, uploads, submissions,
    changeAfterUpload() { changedAfterUpload = true; } };
}

test('Firebase photo reads preserve opaque pagination, private content and strict query boundaries', async () => {
  const f = photoFixture(), first = await f.get(); assert.equal(first.status, 200); privateResponse(first);
  const page = await first.json(); assert.deepEqual(page.photos, [f.photo]); assert.equal(page.complete, false); assert.equal(typeof page.nextCursor, 'string');
  assert.deepEqual(JSON.parse(Buffer.from(page.nextCursor, 'base64url').toString('utf8')), f.cursor);
  const second = await f.get('?cursor=' + encodeURIComponent(page.nextCursor) + '&limit=100');
  assert.equal(second.status, 200); assert.equal((await second.json()).complete, true);
  assert.deepEqual(f.reads, [{ limit: 50, cursor: null }, { limit: 100, cursor: f.cursor }]);
  const read = await f.get('/' + f.id); assert.deepEqual((await read.json()).photo, f.photo);
  const content = await f.get('/' + f.id + '/content'); privateResponse(content);
  assert.equal(content.headers.get('content-type'), 'image/png'); assert.equal(content.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(content.headers.get('content-security-policy'), "default-src 'none'; sandbox"); assert.deepEqual(Buffer.from(await content.arrayBuffer()), f.bytes);
  for (const suffix of ['?limit=101', '?limit=1.5', '?limit=1&limit=2', '?unknown=x']) await errorCode(await f.get(suffix), 400, 'invalid_input');
  await errorCode(await f.get('?cursor=bad+cursor'), 400, 'invalid_cursor');
  await errorCode(await f.get('/bad-id'), 404, 'not_found'); assert.equal(f.reads.length, 2);
});

test('Firebase photo writes enforce same-origin and expected identity, original operations and explicit unconnected actions', async () => {
  const f = photoFixture(), upload = '/' + f.id + '/content';
  await errorCode(await f.post(upload, { base64: f.bytes.toString('base64') }, { Origin: 'https://foreign.example' }), 403, 'origin_rejected');
  assert.equal(f.sessionHeaders.length, 0);
  await errorCode(await f.get('', {}), 428, 'account_precondition_required');
  await errorCode(await f.get('', { 'x-expected-user-id': 'other-user' }), 409, 'session_changed');
  await errorCode(await f.post(''), 428, 'operation_required'); await errorCode(await f.post('/' + f.id + '/delete'), 428, 'operation_required');
  for (const action of ['extract', 'confirm']) await errorCode(await f.post('/' + f.id + '/' + action), 503, 'firebase_domain_not_ready');
  await errorCode(await f.post(upload, { base64: 'not base64' }), 400, 'invalid_input');
  await errorCode(await f.post(upload, { base64: 'Zg' }), 400, 'invalid_photo');
  await errorCode(await f.post(upload, { base64: f.bytes.toString('base64') }, { 'Content-Type': 'text/plain' }), 415, 'unsupported_media_type');
  const success = await f.post(upload, { base64: f.bytes.toString('base64') }); assert.equal(success.status, 200); assert.equal((await success.json()).photo.state, 'ready');
  assert.deepEqual(f.uploads, [f.bytes.toString('base64')]);
  const submission: OnlineSubmission = { path: f.path, payload: { fileName: f.photo.fileName, mimeType: f.photo.mimeType, bytes: f.photo.bytes, sha256: f.photo.sha256, source: f.photo.source },
    operation: { opId: OPERATION_ID, deviceId: randomUUID(), workspaceId: randomUUID(), storageEpoch: randomUUID() } };
  const response = await f.handler(new Request(PUBLIC_ORIGIN + '/api/online/submit', { method: 'POST',
    headers: { Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json', 'x-expected-user-id': USER_ID }, body: JSON.stringify(submission) }));
  assert.equal(response.status, 200); assert.deepEqual(f.submissions, [submission]); assert.deepEqual((await response.json()).operation, submission.operation);
  const foundation = fixture(); await errorCode(await foundation.get(f.path), 503, 'firebase_domain_not_ready'); assert.equal(foundation.sessionHeaders.length, 0);
});

test('Firebase photo identity fences prevent store access and suppress an upload result after the identity changes', async () => {
  const before = photoFixture(); before.beforeSession(number => { if (number === 2) before.setUser('other-user'); });
  await errorCode(await before.get(), 409, 'identity_changed'); assert.equal(before.reads.length, 0);
  const after = photoFixture(); after.changeAfterUpload();
  const rejected = await errorCode(await after.post('/' + after.id + '/content', { base64: after.bytes.toString('base64') }), 409, 'identity_changed');
  assert.equal(after.uploads.length, 1); assert.equal('photo' in rejected, false);
  const online = photoFixture(); online.beforeSession(number => { if (number === 2) online.setUser('other-user'); });
  const submission = { path: online.path, payload: {}, operation: { opId: OPERATION_ID, deviceId: randomUUID(), workspaceId: randomUUID(), storageEpoch: randomUUID() } };
  await errorCode(await online.handler(new Request(PUBLIC_ORIGIN + '/api/online/submit', { method: 'POST', headers: {
    Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json', 'x-expected-user-id': USER_ID }, body: JSON.stringify(submission) })), 409, 'identity_changed');
  assert.equal(online.submissions.length, 0);
});

test('Firebase task list and detail read the durable reminder view in their canonical transaction', async () => {
  const f = fixture(), fake = firestoreDomainFixture(), generation = randomUUID(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 85)),
    projectId: 'synthetic-firebase-task-app', namespace: 'synthetic_firebase_task_app', serverClock: () => Date.parse('2026-10-11T04:00:00Z') };
  const authority = createFirestoreAuthority(options), reminders = createFirestoreTaskWorker({ ...options, enabled: true,
    async currentAuth(userId) { return { userId, disabled: false, emailVerified: true, email: 'owner@example.test' }; } });
  const online = createFirestoreOnlineStore({ ...options, reminders });
  await authority.initializeControl({ enabled: true, generation });
  await authority.issueInvitation({ email: 'owner@example.test', expiresAt: '2027-01-01T00:00:00Z', operationId: randomUUID() });
  await authority.admitIdentity({ userId: USER_ID, email: 'owner@example.test', emailVerified: true });
  await authority.acknowledge({ userId: USER_ID, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const command = async (path: string, payload: unknown) => online.submit(USER_ID, { path, payload,
    operation: { ...await online.context(USER_ID, { path, payload }), deviceId: randomUUID(), opId: randomUUID() } });
  const child = (await command('/api/children', { displayName: 'Synthetic reminder child' })).result as { child: { id: string } };
  const path = `/api/children/${child.child.id}/tasks`;
  await command(path, { confirm: true, values: { title: 'Private reminder', details: 'Private details', kind: 'ordinary', assigneeUserId: USER_ID,
    dueAt: '2026-10-11T03:00:00Z', timeZone: 'Asia/Hong_Kong' } });
  const job = (await reminders.due(USER_ID, child.child.id))[0], result = await reminders.process(job); assert.equal(result.state, 'deferred');
  const handler = createFirebaseRequestHandler({ ...f.options, authority, online }), headers = { 'x-expected-user-id': USER_ID };
  const listed = await handler(new Request(PUBLIC_ORIGIN + path, { headers })); assert.equal(listed.status, 200);
  const page = await listed.json(); assert.equal(page.workerEnabled, true); assert.deepEqual(page.reminders, [result.receipt]);
  assert.equal(page.work[0].status, 'pending'); assert.equal(page.work[0].failures, 0);
  const detailed = await handler(new Request(PUBLIC_ORIGIN + path + '/' + job.taskId, { headers })); assert.equal(detailed.status, 200);
  const detail = await detailed.json(); assert.deepEqual(detail.task, page.items[0]); assert.deepEqual(detail.reminders, page.reminders); assert.deepEqual(detail.work, page.work);
  assert.equal(detail.workerEnabled, true); assert.deepEqual(await online.tasks.get(USER_ID, child.child.id, job.taskId), detail.task);
});

test('Firebase personal library remains optional and preserves pagination, expected identity and read fences', async () => {
  const childId = '00000000-0000-4000-8000-000000000021', path = `/api/children/${childId}/library`, f = fixture();
  const reads: { userId: string; childId: string; cursor: string | null }[] = [];
  let changeAfterRead = false;
  const page = { items: [], nextCursor: 'opaque-library-cursor', complete: false };
  const library = { async page(userId: string, childId: string, cursor: string | null = null) {
    reads.push({ userId, childId, cursor }); if (changeAfterRead) f.setUser('other-user'); return page;
  } };
  const handler = createFirebaseRequestHandler({ ...f.options, library });
  const get = (suffix = '', headers: HeadersInit = { 'x-expected-user-id': USER_ID }) => handler(new Request(PUBLIC_ORIGIN + path + suffix, { headers }));
  await errorCode(await f.get(path), 503, 'firebase_domain_not_ready'); assert.equal(f.sessionHeaders.length, 0);
  await errorCode(await get('', {}), 428, 'account_precondition_required');
  await errorCode(await get('', { 'x-expected-user-id': 'other-user' }), 409, 'session_changed'); assert.equal(reads.length, 0);
  const result = await get('?cursor=opaque-library-cursor'); assert.equal(result.status, 200); privateResponse(result); assert.deepEqual(await result.json(), page);
  assert.deepEqual(reads, [{ userId: USER_ID, childId, cursor: 'opaque-library-cursor' }]);
  await errorCode(await get('?cursor=a&cursor=b'), 400, 'invalid_input'); assert.equal(reads.length, 1);
  changeAfterRead = true;
  const changed = await errorCode(await get(), 409, 'identity_changed'); assert.equal('items' in changed, false);
  const before = fixture(), untouched = createFirebaseRequestHandler({ ...before.options, library });
  before.beforeSession(number => { if (number === 2) before.setUser('other-user'); });
  await errorCode(await untouched(new Request(PUBLIC_ORIGIN + path, { headers: { 'x-expected-user-id': USER_ID } })), 409, 'identity_changed');
  assert.equal(reads.length, 2);
});

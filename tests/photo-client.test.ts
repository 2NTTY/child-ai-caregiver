import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { createPhotoApi, PhotoApiError } from "../src/client/photo-api.ts";
import type { PhotoAttachment } from "../src/shared/photos.ts";
import type { OnlineSubmission } from "../src/shared/online.ts";
import { emptyCareDetails } from "../src/shared/care.ts";

const CHILD = randomUUID(), OWNER = "synthetic-photo-owner", OTHER_CHILD = randomUUID();
const photo = (): PhotoAttachment => ({
  id: randomUUID(), childId: CHILD, ownerUserId: OWNER, fileName: "synthetic.png", source: "Synthetic parent",
  mimeType: "image/png", bytes: 24, sha256: "1".repeat(64), createdAt: "2026-10-11T12:00:00.000Z",
  version: 1, state: "reserved", visibility: "private", canManage: true, recordId: null,
  extraction: { state: "not_requested", runId: null, draft: null, stopReason: null, processedAt: null, model: null },
});
const ALL = Array.from({length:100},photo), signal = () => new AbortController().signal;
const rejected = (error: unknown) => error instanceof PhotoApiError && !error.confirmed;

test("shared photo deletion retains the selected online command across an unknown reply and unconfirmed lookup", async () => {
  const selection = { spaceId: randomUUID() }, actor = "synthetic-shared-carer";
  const basis = { spaceVersion: 2, membershipVersion: 3, shareVersion: 4, actorAuthorizationVersion: "5", sourceAuthorizationVersion: "6" };
  const original: PhotoAttachment = { ...photo(), state: "ready", visibility: "shared", canManage: true, sharedSpaceId: selection.spaceId };
  const context = { workspaceId: randomUUID(), storageEpoch: randomUUID(), sharingBasis: basis };
  const deleted = { deleted: true as const, cleanupPending: true as const };
  let submission: OnlineSubmission | undefined, lookups = 0, posts = 0, requests = 0;
  const api = createPhotoApi("https://example.test", async (input, init) => {
    requests++;
    const url = new URL(String(input));
    assert.equal(init?.credentials, "include"); assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), actor);
    if (url.pathname.endsWith("/photos/" + original.id)) {
      assert.equal(init?.method, "GET"); assert.equal(url.searchParams.get("spaceId"), selection.spaceId);
      return Response.json({ photo: original });
    }
    if (url.pathname === "/api/online/context") {
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { path: "/api/children/" + CHILD + "/photos/" + original.id + "/delete",
        payload: { expectedVersion: original.version, confirmDelete: true }, sharing: selection });
      return Response.json(context);
    }
    if (url.pathname === "/api/online/submit") {
      posts++; submission = JSON.parse(String(init?.body));
      assert.deepEqual(submission!.sharing, { ...selection, expectedBasis: basis });
      assert.equal(submission!.operation.workspaceId, context.workspaceId); assert.equal(submission!.operation.storageEpoch, context.storageEpoch);
      throw new Error("Lost deletion reply");
    }
    assert.ok(submission); assert.equal(init?.method, "GET");
    assert.equal(url.pathname, "/api/online/operations/" + submission.operation.opId);
    return Response.json(++lookups === 1 ? { state: "unconfirmed" } : {
      state: "confirmed", operation: submission.operation, changeSeq: "9", statusCode: 200, result: deleted,
    });
  }, undefined, selection);
  assert.deepEqual(await api.photo(CHILD, original.id, signal(), actor), original);
  await assert.rejects(api.delete(original, signal(), actor), rejected);
  assert.equal(api.hasPendingOnline(), true);
  assert.deepEqual(await api.reconcilePending(signal(), actor), { state: "unconfirmed" });
  const before = requests;
  await assert.rejects(api.delete({ ...original, childId: OTHER_CHILD }, signal(), actor),
    (error: unknown) => error instanceof PhotoApiError && error.onlineCode === "operation_pending");
  await assert.rejects(api.delete({ ...original, sharedSpaceId: randomUUID() }, signal(), actor), rejected);
  const unavailable = (error: unknown) => error instanceof PhotoApiError && error.onlineCode === "shared_attachment_write_unavailable";
  await assert.rejects(api.reserve(CHILD, original, signal(), actor), unavailable);
  await assert.rejects(api.upload(original, "AAAA", signal(), actor), unavailable);
  await assert.rejects(api.extract(original, signal(), actor), unavailable);
  await assert.rejects(api.confirm(original, { expectedVersion: original.version, confirmShared: true,
    values: { text: "Synthetic note", source: "Synthetic carer", details: emptyCareDetails() } }, signal(), actor), unavailable);
  assert.equal(requests, before);
  assert.deepEqual(await api.reconcilePending(signal(), actor), { state: "confirmed", result: deleted });
  assert.equal(api.hasPendingOnline(), false); assert.equal(posts, 1); assert.equal(lookups, 2);
});

test("photo client collects two bounded pages into the existing complete list result", async () => {
  const calls: string[] = [];
  const api = createPhotoApi("https://example.test/api/",async (input,init) => {
    const url=new URL(String(input));calls.push(url.pathname+url.search);
    assert.equal(init?.method,"GET");assert.equal(init?.credentials,"include");assert.equal(init?.cache,"no-store");
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"),OWNER);
    assert.ok(init?.signal instanceof AbortSignal);
    if(calls.length===1)return Response.json({photos:ALL.slice(0,50),canCreate:true,complete:false,nextCursor:"opaque_cursor_1"});
    assert.equal(url.searchParams.get("cursor"),"opaque_cursor_1");
    return Response.json({photos:ALL.slice(50),canCreate:false,complete:true,nextCursor:null});
  });
  assert.deepEqual(await api.photos(CHILD,signal(),OWNER),{photos:ALL,canCreate:false});
  assert.equal(calls.length,2);assert.equal(calls[0],"/api/children/"+CHILD+"/photos");
});
test("legacy full photo lists remain compatible and partial pagination shapes are rejected", async () => {
  const legacy=createPhotoApi("",async()=>Response.json({photos:ALL,canCreate:true}));
  assert.deepEqual(await legacy.photos(CHILD,signal(),OWNER),{photos:ALL,canCreate:true});
  for(const body of [
    {photos:[ALL[0]],canCreate:true,complete:true},
    {photos:[ALL[0]],canCreate:true,nextCursor:null},
    {photos:[ALL[0]],canCreate:true,complete:false,nextCursor:null},
    {photos:[ALL[0]],canCreate:true,complete:true,nextCursor:"opaque_cursor_1"},
  ]) await assert.rejects(createPhotoApi("",async()=>Response.json(body)).photos(CHILD,signal(),OWNER),rejected);
});

test("repeated cursors, duplicate IDs, excessive totals and empty nonterminal pages cannot produce a partial success", async () => {
  const cases=[
    [{photos:[ALL[0]],canCreate:true,complete:false,nextCursor:"same_cursor"},
      {photos:[ALL[1]],canCreate:true,complete:false,nextCursor:"same_cursor"}],
    [{photos:[ALL[0]],canCreate:true,complete:false,nextCursor:"next_cursor"},
      {photos:[{...ALL[0],id:ALL[0].id.toUpperCase()}],canCreate:true,complete:true,nextCursor:null}],
    [{photos:ALL.slice(0,50),canCreate:true,complete:false,nextCursor:"next_cursor"},
      {photos:[...ALL.slice(50),photo()],canCreate:true,complete:true,nextCursor:null}],
    [{photos:[],canCreate:true,complete:false,nextCursor:"empty_cursor"}],
  ];
  for(const pages of cases) {
    let calls=0;
    const api=createPhotoApi("",async()=>{assert.ok(calls<pages.length);return Response.json(pages[calls++]);});
    await assert.rejects(api.photos(CHILD,signal(),OWNER),rejected);assert.equal(calls,pages.length);
  }
});

test("every subsequent page validates child, private owner and photo integrity and cannot change to the legacy format", async () => {
  for(const next of [
    {photos:[{...ALL[1],childId:OTHER_CHILD}],canCreate:true,complete:true,nextCursor:null},
    {photos:[{...ALL[1],ownerUserId:"other-synthetic-owner"}],canCreate:true,complete:true,nextCursor:null},
    {photos:[{...ALL[1],sha256:"invalid-hash"}],canCreate:true,complete:true,nextCursor:null},
    {photos:[ALL[1]],canCreate:true},
  ]) {
    let calls=0;
    const api=createPhotoApi("",async()=>Response.json(++calls===1
      ?{photos:[ALL[0]],canCreate:true,complete:false,nextCursor:"next_cursor"}:next));
    await assert.rejects(api.photos(CHILD,signal(),OWNER),rejected);assert.equal(calls,2);
  }
});

test("a failed later page rejects the whole list without returning previously collected photos", async () => {
  let calls=0;
  const api=createPhotoApi("",async()=>++calls===1
    ?Response.json({photos:ALL.slice(0,50),canCreate:true,complete:false,nextCursor:"next_cursor"})
    :Response.json({error:{code:"temporary_unavailable"}},{status:503}));
  await assert.rejects(api.photos(CHILD,signal(),OWNER),(error:unknown)=>rejected(error)&&error instanceof PhotoApiError&&error.status===503);
  assert.equal(calls,2);
});

test("abort or reset during a later page rejects a late matching response even when fetch ignores its signal", async () => {
  for(const mode of ["abort","reset"] as const) {
    const controller=new AbortController();let calls=0,entered!:()=>void,release!:()=>void;
    const waiting=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
    const api=createPhotoApi("",async()=>{
      if(++calls===1)return Response.json({photos:ALL.slice(0,50),canCreate:true,complete:false,nextCursor:"next_cursor"});
      entered();await gate;return Response.json({photos:ALL.slice(50),canCreate:true,complete:true,nextCursor:null});
    });
    const pending=api.photos(CHILD,controller.signal,OWNER),denied=assert.rejects(pending,rejected);await waiting;
    if(mode==="abort")controller.abort();else api.resetOnline();
    release();await denied;assert.equal(calls,2);
  }
});

test("a reset during first-page JSON parsing prevents any subsequent page request", async () => {
  let calls=0;
  const api=createPhotoApi("",async()=>{
    calls++;
    const response=Response.json({photos:[ALL[0]],canCreate:true,complete:false,nextCursor:"next_cursor"}),json=response.json.bind(response);
    response.json=async()=>{const value=await json();api.resetOnline();return value;};
    return response;
  });
  await assert.rejects(api.photos(CHILD,signal(),OWNER),rejected);assert.equal(calls,1);
});

test("native photo bytes use the shared identity and integrity checks without browser crypto", async t => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const original = { ...photo(), state: "ready" as const, bytes: bytes.length, sha256: digest };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "FileReader");
  let reads = 0, calls = 0, invalidate = false;
  class NativeReader {
    result: ArrayBuffer | null = null;
    onload?: () => void;
    readAsArrayBuffer() { reads++; this.result = bytes.slice().buffer; this.onload?.(); }
  }
  Object.defineProperty(globalThis, "FileReader", { configurable: true, value: NativeReader });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, "FileReader", descriptor); else Reflect.deleteProperty(globalThis, "FileReader"); });
  const api = createPhotoApi("https://example.test", async (_, init) => {
    calls++; assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), OWNER);
    const blob = new Blob([bytes], { type: "image/png" });
    Object.defineProperty(blob, "arrayBuffer", { value: undefined });
    const response = new Response(null, { headers: { "content-type": "image/png" } });
    response.blob = async () => blob;
    return response;
  }, async actual => {
    assert.deepEqual(actual, bytes);
    if (invalidate) api.resetOnline();
    return createHash("sha256").update(actual).digest("hex");
  });
  assert.equal((await api.content(original, signal(), OWNER)).size, bytes.length);
  await assert.rejects(api.content({ ...original, sha256: "0".repeat(64) }, signal(), OWNER), rejected);
  invalidate = true;
  await assert.rejects(api.content(original, signal(), OWNER), rejected);
  assert.equal(calls, 3); assert.equal(reads, 3);
});

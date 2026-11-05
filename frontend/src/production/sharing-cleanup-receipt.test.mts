import assert from "node:assert/strict";
import test from "node:test";
import { SharingController, type SharingMode } from "./SharingController.ts";
import { createSharingApi } from "../../../src/client/sharing-api.ts";
import type { SharingCommand, SharingOperation, SharedSpaceView } from "../../../src/shared/sharing-control.ts";

// Only the transport is synthetic. The whole controller, authenticated client and Zod schemas execute.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const dissolve: SharingCommand = { action: "dissolve", operationId: id(2), spaceId: id(1), expectedVersion: 1 };
const next: SharingCommand = { action: "create", operationId: id(3), kind: "class", name: "Synthetic next class" };
const original: SharingOperation = { action: "dissolve", operationId: id(2), space: null,
  exit: { spaceId: id(1), version: 2, state: "dissolved", cleanupState: "pending" } };
const created: SharedSpaceView = { id: id(4), kind: "class", name: "Synthetic next class", role: "owner", managerUserId: "synthetic-user",
  transferTargetUserId: null, version: 1, createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z" };
const nextReceipt: SharingOperation = { operationId: id(3), action: "create", space: created };
const complete = (receipt: SharingOperation = original): SharingOperation => ({ ...receipt, exit: { ...receipt.exit!, cleanupState: "completed" } });
const reject = (code = "invalid_input", status = 400) => Response.json({ error: { code } }, { status });
type Lookup = (operationId: string, signal: AbortSignal) => SharingOperation | null | Response | Promise<SharingOperation | null | Response>;
function fixture(options: { mode?: SharingMode; submit?: (command: SharingCommand, signal: AbortSignal) => Response | Promise<Response>;
  lookup?: Lookup } = {}) {
  const posts: SharingCommand[] = [], gets: string[] = [], paths: string[] = [];
  const api = createSharingApi("https://cleanup-test.invalid", async (input, init) => {
    const url = new URL(String(input)); paths.push(url.pathname + url.search);
    assert.equal(url.origin, "https://cleanup-test.invalid"); assert.equal(init?.credentials, "include"); assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), "synthetic-user"); assert.ok(init?.signal);
    if (url.pathname.endsWith("/commands")) {
      assert.equal(init.method, "POST"); const command = JSON.parse(String(init.body)) as SharingCommand; posts.push(command);
      if (options.submit) return options.submit(command, init.signal);
      return Response.json(command.action === "dissolve" ? { ...original, operationId: command.operationId,
        exit: { ...original.exit, spaceId: command.spaceId } } : { ...nextReceipt, operationId: command.operationId });
    }
    assert.equal(init?.method, "GET");
    if (url.pathname.includes("/operations/")) {
      const operationId = url.pathname.split("/").at(-1)!; gets.push(operationId);
      const operation = options.lookup ? await options.lookup(operationId, init.signal) : original;
      return operation instanceof Response ? operation : Response.json({ operation });
    }
    if (["/api/shared-spaces", "/api/shared-spaces/classes", "/api/shared-spaces/teachers"].includes(url.pathname)
      || /\/(members|roster|invitations|classes)$/.test(url.pathname)) return Response.json({ items: [], nextCursor: null });
    assert.equal(url.pathname, "/api/shared-spaces/" + created.id); return Response.json(created);
  });
  const controller = new SharingController(api, options.mode ?? "class");
  controller.syncContext("synthetic-user", "synthetic-user:session:1", true);
  return { controller, posts, gets, paths };
}
const retained = (c: SharingController) => c.getSnapshot().cleanupReceipts ?? [];
const retainedIds = (c: SharingController) => retained(c).map(receipt => receipt.operationId);

// Regression killed by restoring submit's single-slot clearing and/or confirmed's sole-receipt ownership.
test("known rejection of a newer command keeps accepted cleanup reachable by original ID", async () => {
  const f = fixture({ submit: command => command.action === "dissolve" ? Response.json(original) : reject() });
  try {
    await f.controller.submit(dissolve); await f.controller.checkOriginal(); await f.controller.submit(next);
    assert.equal(f.controller.getSnapshot().pending, null); assert.equal(f.controller.getSnapshot().receipt?.operationId, original.operationId);
    assert.deepEqual(retainedIds(f.controller), [original.operationId]); await f.controller.checkOriginal();
    assert.deepEqual(f.gets, [original.operationId, original.operationId]); assert.deepEqual(f.posts, [dissolve, next]);
  } finally { f.controller.dispose(); }
});

test("new confirmed result does not replace cleanup; its later completion cannot overwrite the newer receipt", async () => {
  const f = fixture({ lookup: () => complete() });
  try {
    await f.controller.submit(dissolve); await f.controller.submit(next);
    assert.equal(f.controller.getSnapshot().receipt?.operationId, next.operationId); assert.deepEqual(retainedIds(f.controller), [original.operationId]);
    await f.controller.checkOriginal(original.operationId);
    assert.deepEqual(retainedIds(f.controller), []); assert.equal(f.controller.getSnapshot().receipt?.operationId, next.operationId);
    assert.match(f.controller.getSnapshot().notice!, /清理已完成/u); assert.deepEqual(f.posts, [dissolve, next]);
    await f.controller.checkOriginal(original.operationId); await f.controller.retryOriginal(); assert.deepEqual(f.gets, [original.operationId]);
  } finally { f.controller.dispose(); }
});

test("unknown new command coexists with cleanup; targeted reads never settle or retry the unknown command", async () => {
  let attempt = 0;
  const f = fixture({ submit: command => {
    if (command.action === "dissolve") return Response.json(original);
    if (++attempt === 1) throw new Error("Synthetic lost create reply");
    return Response.json(nextReceipt);
  }, lookup: operationId => operationId === original.operationId ? complete() : null });
  try {
    await f.controller.submit(dissolve); await f.controller.submit(next);
    const pending = f.controller.getSnapshot().pending;
    assert.equal(pending?.command.operationId, next.operationId); assert.equal(pending?.unknown, true);
    assert.deepEqual(retainedIds(f.controller), [original.operationId]);
    await f.controller.checkOriginal(original.operationId);
    assert.deepEqual(f.controller.getSnapshot().pending, pending); assert.deepEqual(retainedIds(f.controller), []);
    await f.controller.retryOriginal(); assert.deepEqual(f.posts, [dissolve, next]);
    await f.controller.checkOriginal(); assert.equal(f.controller.getSnapshot().pending?.checked, true);
    await f.controller.retryOriginal(); assert.deepEqual(f.posts, [dissolve, next, next]);
    assert.equal(f.controller.getSnapshot().pending, null); assert.deepEqual(f.gets, [original.operationId, next.operationId]);
  } finally { f.controller.dispose(); }
});

for (const code of ["invalid_input", "version_conflict"]) test(`unknown retry ${code} keeps earlier cleanup and existing rejection semantics`, async () => {
  let attempts = 0;
  const f = fixture({ submit: command => {
    if (command.action === "dissolve") return Response.json(original);
    if (++attempts === 1) throw new Error("Synthetic lost response");
    return reject(code, 409);
  }, lookup: operationId => operationId === next.operationId ? null : original });
  try {
    await f.controller.submit(dissolve); await f.controller.submit(next); await f.controller.checkOriginal(); await f.controller.retryOriginal();
    assert.deepEqual(retainedIds(f.controller), [original.operationId]);
    assert.equal(f.controller.getSnapshot().pending?.command.operationId ?? null, code === "version_conflict" ? null : next.operationId);
    await f.controller.checkOriginal(original.operationId); assert.deepEqual(f.posts, [dissolve, next, next]);
  } finally { f.controller.dispose(); }
});

test("two accepted cleanups stay distinct; repeated pending checks deduplicate and completing one removes only itself", async () => {
  const second: SharingCommand = { ...dissolve, operationId: id(6), spaceId: id(5) };
  const secondReceipt: SharingOperation = { ...original, operationId: second.operationId, exit: { ...original.exit!, spaceId: id(5) } };
  let completedId: string | null = null;
  const f = fixture({ mode: "teachers", lookup: operationId => {
    const receipt = operationId === original.operationId ? original : secondReceipt; return completedId === operationId ? complete(receipt) : receipt;
  } });
  try {
    await f.controller.submit(dissolve); await f.controller.submit(second);
    assert.deepEqual(retainedIds(f.controller), [original.operationId, second.operationId]);
    await f.controller.checkOriginal(original.operationId); await f.controller.checkOriginal(original.operationId);
    assert.deepEqual(retainedIds(f.controller), [original.operationId, second.operationId]);
    completedId = original.operationId; await f.controller.checkOriginal(original.operationId);
    assert.deepEqual(retainedIds(f.controller), [second.operationId]); assert.equal(f.controller.getSnapshot().receipt?.operationId, second.operationId);
    await f.controller.checkOriginal(); assert.equal(f.gets.at(-1), second.operationId);
    completedId = second.operationId; await f.controller.checkOriginal(second.operationId);
    assert.deepEqual(retainedIds(f.controller), []); assert.equal(f.controller.getSnapshot().receipt?.exit?.cleanupState, "completed");
    await f.controller.checkOriginal(); await f.controller.retryOriginal(); assert.deepEqual(f.posts, [dissolve, second]);
  } finally { f.controller.dispose(); }
});

test("unknown dissolve becomes retained only after original lookup proves pending cleanup, without a replay", async () => {
  const f = fixture({ submit: () => { throw new Error("Synthetic lost dissolve reply"); } });
  try {
    await f.controller.submit(dissolve); assert.deepEqual(retainedIds(f.controller), []); assert.equal(f.controller.getSnapshot().pending?.unknown, true);
    await f.controller.checkOriginal(); assert.equal(f.controller.getSnapshot().pending, null); assert.deepEqual(retainedIds(f.controller), [original.operationId]);
    await f.controller.checkOriginal(); assert.deepEqual(retainedIds(f.controller), [original.operationId]); assert.deepEqual(f.posts, [dissolve]);
  } finally { f.controller.dispose(); }
});

test("completed and redacted dissolution confirmations are not queued as unresolved cleanup", async () => {
  for (const operation of [complete(), { operationId: original.operationId, action: "dissolve", space: null, redacted: true }]) {
    const f = fixture({ submit: () => Response.json(operation) });
    try { await f.controller.submit(dissolve); assert.deepEqual(retainedIds(f.controller), []);
      assert.equal(f.controller.getSnapshot().pending, null); await f.controller.checkOriginal(); await f.controller.retryOriginal();
      assert.deepEqual(f.posts, [dissolve]); assert.deepEqual(f.gets, []);
    } finally { f.controller.dispose(); }
  }
});

for (const [name, proof] of [
  ["null", null], ["wrong ID", { ...complete(), operationId: id(99) }],
  ["wrong action", { ...complete(), action: "leave" }], ["wrong space", { ...complete(), exit: { ...complete().exit, spaceId: id(99) } }],
  ["wrong version", { ...complete(), exit: { ...complete().exit, version: 99 } }],
  ["wrong state", { ...complete(), exit: { ...complete().exit, state: "left" } }],
  ["missing cleanup state", { ...original, exit: { spaceId: id(1), version: 2, state: "dissolved" } }],
  ["redacted", { operationId: original.operationId, action: "dissolve", space: null, redacted: true }],
  ["permission denial", reject("space_access_denied", 403)],
] as const) test(`${name} cleanup proof cannot complete, erase or replay accepted cleanup`, async () => {
  const f = fixture({ lookup: () => proof as SharingOperation | Response | null });
  try {
    await f.controller.submit(dissolve); await f.controller.submit(next); await f.controller.checkOriginal(original.operationId);
    assert.deepEqual(retainedIds(f.controller), [original.operationId]); assert.equal(retained(f.controller)[0]?.exit?.cleanupState, "pending");
    assert.equal(f.controller.getSnapshot().receipt?.operationId, next.operationId); assert.equal(f.controller.getSnapshot().pending, null);
    await f.controller.retryOriginal(); assert.deepEqual(f.posts, [dissolve, next]); assert.match(f.controller.getSnapshot().notice!, /未能核對班級清理進度/u);
  } finally { f.controller.dispose(); }
});

test("only owner-retained IDs can be checked; foreign ID cannot fall through to unknown command lookup", async () => {
  const f = fixture({ submit: command => command.action === "dissolve" ? Response.json(original) : Promise.reject(new Error("Synthetic lost reply")) });
  try {
    await f.controller.submit(dissolve); await f.controller.submit(next); const before = f.controller.getSnapshot().pending;
    await f.controller.checkOriginal(id(99)); await f.controller.checkOriginal(next.operationId);
    assert.deepEqual(f.gets, []); assert.deepEqual(f.controller.getSnapshot().pending, before); assert.deepEqual(retainedIds(f.controller), [original.operationId]);
  } finally { f.controller.dispose(); }
});

test("safe list, selection, roster search and clear selection remain available while accepted cleanup is pending", async () => {
  const f = fixture();
  try {
    await f.controller.submit(dissolve); await f.controller.loadSpaces(); await f.controller.selectSpace(created.id);
    await f.controller.searchRoster("Synthetic search"); assert.equal(f.controller.getSnapshot().rosterQuery, "Synthetic search");
    f.controller.clearSelection(); assert.equal(f.controller.getSnapshot().selected, null);
    assert.deepEqual(retainedIds(f.controller), [original.operationId]); assert.deepEqual(f.posts, [dissolve]);
    assert.ok(f.paths.some(path => path.includes("query=synthetic+search")));
  } finally { f.controller.dispose(); }
});

test("invalid schema and offline submissions/checks preserve cleanup and make no requests", async () => {
  const f = fixture();
  try {
    await f.controller.submit(dissolve); const count = f.paths.length;
    await f.controller.submit({ ...next, name: "" });
    f.controller.syncContext("synthetic-user", "synthetic-user:session:1", false);
    await f.controller.submit(next); await f.controller.checkOriginal(original.operationId); await f.controller.checkOriginal();
    assert.equal(f.paths.length, count); assert.deepEqual(retainedIds(f.controller), [original.operationId]);
    f.controller.syncContext("synthetic-user", "synthetic-user:session:1", true); await f.controller.checkOriginal(original.operationId);
    assert.deepEqual(f.gets, [original.operationId]);
  } finally { f.controller.dispose(); }
});

test("busy cleanup check cannot race a new write, another check or retry", async () => {
  let release!: (receipt: SharingOperation) => void;
  const f = fixture({ lookup: () => new Promise(resolve => { release = resolve; }) });
  try {
    await f.controller.submit(dissolve); const checking = f.controller.checkOriginal(original.operationId);
    assert.equal(f.controller.getSnapshot().busy, "check"); await f.controller.submit(next); await f.controller.checkOriginal(original.operationId); await f.controller.retryOriginal();
    assert.deepEqual(f.posts, [dissolve]); assert.deepEqual(f.gets, [original.operationId]);
    release(original); await checking; assert.deepEqual(retainedIds(f.controller), [original.operationId]);
  } finally { f.controller.dispose(); }
});

for (const reset of ["session", "identity", "revoke", "dispose", "offline"] as const) test(`${reset} prevents a late cleanup reply from restoring or completing stale state`, async () => {
  let release!: (receipt: SharingOperation) => void, signal!: AbortSignal;
  const f = fixture({ lookup: (_operationId, s) => { signal = s; return new Promise(resolve => { release = resolve; }); } });
  try {
    await f.controller.submit(dissolve); const checking = f.controller.checkOriginal(original.operationId);
    if (reset === "dispose") f.controller.dispose();
    else if (reset === "revoke") f.controller.syncContext(null, null, true);
    else if (reset === "identity") f.controller.syncContext("other", "other:session:1", true);
    else f.controller.syncContext("synthetic-user", reset === "session" ? "synthetic-user:session:2" : "synthetic-user:session:1", reset !== "offline");
    assert.equal(signal.aborted, true); release(complete()); await checking;
    assert.deepEqual(retainedIds(f.controller), reset === "offline" ? [original.operationId] : []);
    assert.equal(f.controller.getSnapshot().receipt?.exit?.cleanupState ?? null, reset === "offline" ? "pending" : null);
    assert.equal(f.controller.getSnapshot().busy, null); assert.deepEqual(f.posts, [dissolve]);
  } finally { f.controller.dispose(); }
});

test("identity change during a late dissolve POST cannot add an old receipt to the new session", async () => {
  let release!: (response: Response) => void, signal!: AbortSignal;
  const f = fixture({ submit: (_command, s) => { signal = s; return new Promise(resolve => { release = resolve; }); } });
  try {
    const submitting = f.controller.submit(dissolve); f.controller.syncContext("synthetic-user", "synthetic-user:session:2", true);
    assert.equal(signal.aborted, true); release(Response.json(original)); await submitting;
    assert.deepEqual(retainedIds(f.controller), []); assert.equal(f.controller.getSnapshot().receipt, null); assert.equal(f.controller.getSnapshot().pending, null);
  } finally { f.controller.dispose(); }
});

test("one mode/controller cannot check or clear another controller's retained cleanup", async () => {
  const a = fixture(), b = fixture({ mode: "teachers" });
  try {
    await a.controller.submit(dissolve); await b.controller.submit(next); await b.controller.checkOriginal(original.operationId);
    assert.deepEqual(b.gets, []); assert.deepEqual(retainedIds(a.controller), [original.operationId]); assert.deepEqual(retainedIds(b.controller), []);
  } finally { a.controller.dispose(); b.controller.dispose(); }
});

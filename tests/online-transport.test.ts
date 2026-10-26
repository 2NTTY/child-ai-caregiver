import assert from "node:assert/strict";
import test from "node:test";
import { createOnlineChangeObserver } from "../src/client/online-change-observer.ts";
import { subscribeOnlineRefresh } from "../src/client/online-refresh-events.ts";
import { createOnlineTransport, OnlineTransportError } from "../src/client/online-transport.ts";
import type { OnlineCommand, OnlineIdentity } from "../src/shared/online.ts";

const workspaceId = "5980663d-3bea-46fa-b63d-42d937026710";
const storageEpoch = "79081f55-9e30-4ee5-91fb-71982b20d6f7";
const command: OnlineCommand = { path: "/api/children", payload: { displayName: "小豆", details: { b: 2, a: 1 } } };
const signal = new AbortController().signal;
type Call = { url: string; init: RequestInit; body: unknown };
type Step = (call: Call) => Response | Promise<Response>;

function fixture(steps: Step[]) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init, body: init.body ? JSON.parse(String(init.body)) as unknown : null };
    calls.push(call);
    const step = steps.shift();
    if (!step) throw new Error("Unexpected fetch");
    return await step(call);
  }) as typeof fetch;
  return { transport: createOnlineTransport("/api", fetcher), calls, steps };
}
const context: Step = () => Response.json({ workspaceId, storageEpoch });
const unconfirmed: Step = () => Response.json({ state: "unconfirmed" });
function identity(call: Call): OnlineIdentity {
  assert.ok(call.body && typeof call.body === "object" && "operation" in call.body);
  return (call.body as { operation: OnlineIdentity }).operation;
}
function confirmed(operation: OnlineIdentity, result: unknown = { saved: true }): Response {
  return Response.json({ state: "confirmed", operation, changeSeq: "1", statusCode: 201, result });
}
async function rejected(promise: Promise<unknown>, status: number, code: string | null, confirmedState = false) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof OnlineTransportError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    assert.equal(error.confirmed, confirmedState);
    return true;
  });
}

test("an unknown result checks the same operation before resending the original command", async () => {
  let first: OnlineIdentity | null = null;
  const f = fixture([context,
    call => { first = identity(call); throw new DOMException("Aborted", "AbortError"); },
    unconfirmed,
    call => { assert.deepEqual(identity(call), first); assert.deepEqual(call.body, { ...command, operation: first }); return confirmed(first!); },
  ]);
  assert.equal(f.transport.hasPending(), false);
  assert.equal(f.calls.length, 0);
  await rejected(f.transport.submit(command, signal, "parent"), 0, null);
  assert.equal(f.transport.hasPending(), true);
  const equivalent = { payload: { details: { a: 1, b: 2 }, displayName: "小豆" }, path: command.path };
  assert.deepEqual(await f.transport.submit(equivalent, signal, "parent"), { saved: true });
  assert.equal(f.transport.hasPending(), false);
  assert.deepEqual(f.calls.map(call => `${call.init.method} ${call.url}`), [
    "POST /api/online/context", "POST /api/online/submit", "GET /api/online/operations/" + first!.opId, "POST /api/online/submit",
  ]);
  assert.deepEqual(f.calls[0].body, command);
  for (const call of f.calls) {
    assert.equal(call.init.credentials, "include");
    assert.equal(call.init.cache, "no-store");
    assert.equal(call.init.signal, signal);
    assert.equal(new Headers(call.init.headers).get("x-expected-user-id"), "parent");
  }
});

test("a confirmed lookup returns the result without another POST", async () => {
  let first: OnlineIdentity;
  const f = fixture([context,
    call => { first = identity(call); throw new Error("socket closed"); },
    () => confirmed(first, { id: "saved" }),
  ]);
  await rejected(f.transport.submit(command, signal, "parent"), 0, null);
  assert.deepEqual(await f.transport.submit(command, signal, "parent"), { id: "saved" });
  assert.equal(f.calls.length, 3);
  assert.equal(f.transport.hasPending(), false);
});

test("a different pending command is rejected without network activity", async () => {
  const f = fixture([context, () => { throw new Error("socket closed"); }]);
  await rejected(f.transport.submit(command, signal, "parent"), 0, null);
  await rejected(f.transport.submit({ ...command, payload: { displayName: "另一個" } }, signal, "parent"), 409, "operation_pending");
  assert.equal(f.calls.length, 2);
  assert.equal(f.transport.hasPending(), true);
});

test("changing account drops the old operation and allocates a new identity", async () => {
  let previous: OnlineIdentity;
  const f = fixture([context, call => { previous = identity(call); throw new Error("socket closed"); },
    context, call => { assert.notEqual(identity(call).opId, previous.opId); return confirmed(identity(call)); },
  ]);
  await rejected(f.transport.submit(command, signal, "parent"), 0, null);
  assert.deepEqual(await f.transport.submit(command, signal, "helper"), { saved: true });
  assert.equal(f.calls.length, 4);
  assert.equal(new Headers(f.calls[2].init.headers).get("x-expected-user-id"), "helper");
});

test("a malformed successful receipt keeps the operation unknown", async () => {
  let first: OnlineIdentity;
  const f = fixture([context, call => { first = identity(call); return confirmed({ ...first, opId: crypto.randomUUID() }); },
    () => confirmed(first),
  ]);
  await rejected(f.transport.submit(command, signal, "parent"), 0, null);
  assert.equal(f.transport.hasPending(), true);
  const receipt = await f.transport.checkPending(signal, "parent");
  assert.equal(receipt?.state, "confirmed");
  assert.equal(f.transport.hasPending(), false);
  assert.equal(f.calls.length, 3);
});

test("checkPending only looks up and leaves unconfirmed work pending", async () => {
  const f = fixture([context, () => { throw new DOMException("Aborted", "AbortError"); }, unconfirmed]);
  await rejected(f.transport.submit(command, signal, "parent"), 0, null);
  assert.deepEqual(await f.transport.checkPending(signal, "parent"), { state: "unconfirmed" });
  assert.equal(f.transport.hasPending(), true);
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[2].init.method, "GET");
});

test("a redacted confirmed submit result reports confirmation and clears pending", async () => {
  const f = fixture([context, call => confirmed(identity(call), null)]);
  await rejected(f.transport.submit(command, signal, "parent"), 409, "operation_result_unavailable", true);
  assert.equal(f.transport.hasPending(), false);
});

test("storage epoch conflict retains pending operation without changing identity", async () => {
  let first: OnlineIdentity;
  const f = fixture([context,
    call => { first = identity(call); return Response.json({ error: { code: "storage_epoch_changed", message: "private detail" } }, { status: 409 }); },
    unconfirmed,
    call => { assert.deepEqual(identity(call), first); return confirmed(first); },
  ]);
  await rejected(f.transport.submit(command, signal, "parent"), 409, "storage_epoch_changed");
  assert.equal(f.transport.hasPending(), true);
  assert.deepEqual(await f.transport.submit(command, signal, "parent"), { saved: true });
  assert.equal(f.calls.length, 4);
});

test("two successful identical actions use distinct operation IDs", async () => {
  const ids: string[] = [];
  const f = fixture([context, call => { ids.push(identity(call).opId); return confirmed(identity(call)); },
    context, call => { ids.push(identity(call).opId); return confirmed(identity(call)); },
  ]);
  assert.deepEqual(await f.transport.submit(command, signal, "parent"), { saved: true });
  assert.deepEqual(await f.transport.submit(command, signal, "parent"), { saved: true });
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
});

test("a known submit 4xx clears pending while a 5xx keeps it", async () => {
  const conflict = fixture([context,
    () => Response.json({ error: { code: "version_conflict", message: "private detail" } }, { status: 409 }),
  ]);
  await rejected(conflict.transport.submit(command, signal, "parent"), 409, "version_conflict");
  assert.equal(conflict.transport.hasPending(), false);

  const failure = fixture([context,
    () => Response.json({ error: { code: "internal_detail", message: "private detail" } }, { status: 503 }),
  ]);
  await rejected(failure.transport.submit(command, signal, "parent"), 503, null);
  assert.equal(failure.transport.hasPending(), true);
});

test("overlapping calls are blocked and reset invalidates an in-flight response", async () => {
  let finish: ((response: Response) => void) | undefined;
  const f = fixture([() => new Promise<Response>(resolve => { finish = resolve; })]);
  const started = f.transport.submit(command, signal, "parent");
  await rejected(f.transport.checkPending(signal, "parent"), 409, "operation_busy");
  assert.equal(f.calls.length, 1);
  f.transport.reset();
  finish!(Response.json({ workspaceId, storageEpoch }));
  await rejected(started, 0, null);
  assert.equal(f.transport.hasPending(), false);
  assert.equal(f.calls.length, 1);
});


test("shared online observer keeps scoped cursors and discards late reads after suspension", async () => {
  const reasons: string[] = [], cursors: string[] = [];
  let phase = "initial", calls = 0, events = 0;
  let complete!: (response: Response) => void;
  let heldSignal: AbortSignal | undefined;
  const unsubscribe = subscribeOnlineRefresh(() => { events++; });
  const observer = createOnlineChangeObserver("https://service.invalid/api", "parent", async reason => { reasons.push(reason); },
    (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls++;
      assert.equal(init.method ?? "GET", "GET");
      assert.equal(init.body, undefined);
      assert.equal(new Headers(init.headers).get("x-expected-user-id"), "parent");
      const url = new URL(String(input));
      if (phase === "held") { heldSignal = init.signal!; return new Promise<Response>(resolve => { complete = resolve; }); }
      if (phase === "unavailable") return Response.json({}, { status: 503 });
      if (url.pathname.endsWith("/spaces")) return Response.json({ workspaces: [{ id: workspaceId, storageEpoch }] });
      assert.equal(url.searchParams.get("workspaceId"), workspaceId);
      assert.equal(url.searchParams.get("storageEpoch"), storageEpoch);
      cursors.push(url.searchParams.get("cursor")!);
      return Response.json({ workspaceId, storageEpoch, cursor: phase === "changed" ? "2" : "1", accessVersion: 1,
        changes: phase === "changed" ? [{ sequence: "2" }] : [], hasMore: false });
    }) as typeof fetch);
  try {
    await observer.check(true);
    await observer.check();
    phase = "changed"; await observer.check();
    phase = "unavailable"; await observer.check();
    assert.deepEqual(reasons, ["changed", "changed", "unavailable"]);
    assert.deepEqual(cursors, ["0", "1", "1"]);
    phase = "held";
    const pending = observer.check();
    await observer.check(); // Busy reads do not start a second request.
    assert.equal(calls, 8);
    observer.dispose();
    assert.equal(heldSignal?.aborted, true);
    complete(Response.json({ workspaces: [{ id: workspaceId, storageEpoch }] }));
    await pending; await observer.check(true);
    assert.equal(calls, 8);
    assert.equal(events, 3);
    assert.deepEqual(reasons, ["changed", "changed", "unavailable"]);
  } finally { observer.dispose(); unsubscribe(); }
});

test("selected shared observer advances opaque cursors, resets invalid reads and disposes late responses", async () => {
  const selection = { spaceId: workspaceId, childId: storageEpoch, module: "attachments" as const };
  const reasons: string[] = [], requested: URL[] = [];
  let phase: "initial" | "changed" | "quiet" | "invalid" | "restarted" | "held" = "initial";
  let release!: (response: Response) => void, heldSignal: AbortSignal | undefined;
  const observer = createOnlineChangeObserver("https://service.invalid/api", "carer", async reason => { reasons.push(reason); },
    async (input, init) => {
      const url = new URL(String(input)); requested.push(url);
      assert.equal(init?.method ?? "GET", "GET"); assert.equal(init?.body, undefined);
      assert.equal(init?.credentials, "include"); assert.equal(init?.cache, "no-store");
      assert.equal(new Headers(init?.headers).get("x-expected-user-id"), "carer");
      if (phase === "held") { heldSignal = init?.signal ?? undefined; return new Promise<Response>(resolve => { release = resolve; }); }
      return Response.json({ ...selection, ...(phase === "invalid" ? { module: "care" } : {}),
        cursor: phase === "initial" ? "opaque first+/=" : "opaque next+/=", changed: phase === "changed", hasMore: phase === "changed" });
    }, selection);
  try {
    await observer.check(true);
    assert.equal(requested[0].pathname, "/api/online/shared-changes");
    assert.equal(requested[0].searchParams.get("spaceId"), selection.spaceId);
    assert.equal(requested[0].searchParams.get("childId"), selection.childId);
    assert.equal(requested[0].searchParams.get("module"), selection.module);
    assert.equal(requested[0].searchParams.has("cursor"), false);
    assert.deepEqual(reasons, ["forced"]);
    phase = "changed"; await observer.check();
    assert.equal(requested.length, 2); // hasMore waits for the next foreground check.
    assert.equal(requested[1].searchParams.get("cursor"), "opaque first+/=");
    phase = "quiet"; await observer.check();
    assert.equal(requested[2].searchParams.get("cursor"), "opaque next+/=");
    assert.deepEqual(reasons, ["forced", "changed"]);
    phase = "invalid"; await observer.check();
    assert.deepEqual(reasons, ["forced", "changed", "unavailable"]);
    phase = "restarted"; await observer.check();
    assert.equal(requested[4].searchParams.has("cursor"), false);
    phase = "held"; const pending = observer.check();
    await observer.check(); assert.equal(requested.length, 6);
    observer.dispose(); assert.equal(heldSignal?.aborted, true);
    release(Response.json({ ...selection, cursor: "late", changed: true, hasMore: false }));
    await pending; await observer.check(true);
    assert.equal(requested.length, 6); assert.deepEqual(reasons, ["forced", "changed", "unavailable"]);
  } finally { observer.dispose(); }
});

test("shared observer tracks visible modules separately without falling back to private changes", async () => {
  const target = { spaceId: "00000000-0000-4000-8000-000000000001", childId: "00000000-0000-4000-8000-000000000002" };
  const requests: URL[] = [], reasons: string[] = [];
  let round = 0;
  const selections = (["tasks", "documents"] as const).map(module => ({ ...target, module }));
  const observer = createOnlineChangeObserver("https://service.invalid/api", "carer", async reason => { reasons.push(reason); }, async input => {
    const url = new URL(String(input)); requests.push(url);
    assert.equal(url.pathname, "/api/online/shared-changes");
    const module = url.searchParams.get("module")!;
    if (round === 2 && module === "documents") return Response.json({ error: "revoked" }, { status: 403 });
    return Response.json({ ...target, module, cursor: `${module}-${round}`, changed: round === 1 && module === "documents", hasMore: false });
  }, selections);
  try {
    await observer.check(true);
    round = 1; await observer.check();
    assert.equal(requests[2].searchParams.get("cursor"), "tasks-0");
    assert.equal(requests[3].searchParams.get("cursor"), "documents-0");
    round = 2; await observer.check();
    round = 3; await observer.check();
    assert.equal(requests[6].searchParams.has("cursor"), false);
    assert.equal(requests[7].searchParams.has("cursor"), false);
    assert.deepEqual(reasons, ["forced", "changed", "unavailable"]);
    assert.throws(() => createOnlineChangeObserver("/api", "carer", async () => {}, fetch, [selections[0], selections[0]]), /selection/);
  } finally { observer.dispose(); }
});

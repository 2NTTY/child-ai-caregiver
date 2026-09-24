import assert from "node:assert/strict";
import test from "node:test";
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

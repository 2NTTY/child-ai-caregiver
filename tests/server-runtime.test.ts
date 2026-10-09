import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import type { PoolClient } from "pg";
import { createRequestHandler } from "../server/app.ts";
import { AccountAdmissionError } from "../server/account-admission.ts";
import type { ServerAuthPort, ServerAuthSession, ServerAuthSessionWithHeaders } from "../server/auth-port.ts";
import type { ServerConfig } from "../server/config.ts";
import { createPool } from "../server/database.ts";
import type { WorkspaceStore } from "../server/workspaces.ts";

const config: ServerConfig = {
  databaseUrl: "postgresql://synthetic_user:synthetic_password@localhost/synthetic_runtime",
  authSecret: "s06-runtime-synthetic-key-8kX2mT7pR5qN9vL3",
  publicOrigin: "http://localhost:3001",
  webOrigin: "http://localhost:8081",
  host: "127.0.0.1",
  port: 3001,
  production: false,
};

type HandlerOptions = Parameters<typeof createRequestHandler>[0];
type SessionLookup = ServerAuthPort["getSession"];

const unusedStore = new Proxy({} as WorkspaceStore, {
  get() { throw new Error("Storage must not be accessed"); },
});

async function dispatch(path: string, auth: {
  handler?: (request: Request) => Promise<Response>;
  getSession?: SessionLookup;
}, workspaces: WorkspaceStore = unusedStore, chat?: HandlerOptions["chat"],
  proxy: { peer?: string; forwarded?: string; trusted?: string; expectedUserId?: string; origin?: string | null; method?: "GET" | "POST" } = {},
  services: Pick<HandlerOptions, "account" | "personalLibrary"> = {}) {
  const headers = new Map<string, string | number | readonly string[]>();
  let body: Buffer = Buffer.alloc(0);
  const request = {
    method: proxy.method ?? "GET", url: path,
    headers: { origin: proxy.origin === null ? undefined : proxy.origin ?? config.webOrigin,
      cookie: "better-auth.session_token=synthetic-session", "x-forwarded-for": proxy.forwarded, "x-expected-user-id": proxy.expectedUserId },
    socket: { remoteAddress: proxy.peer ?? "127.0.0.1" },
    resume() {},
  } as unknown as IncomingMessage;
  const response = Object.assign(new EventEmitter(), {
    statusCode: 200, headersSent: false, destroyed: false, writableEnded: false,
    setHeader(name: string, value: string | number | readonly string[]) { headers.set(name.toLowerCase(), value); },
    end(value: Buffer) { body = value; this.writableEnded = true; },
  });
  const unusedAuth = async (): Promise<never> => { throw new Error("Unexpected authentication call"); };
  const fromNodeHeaders = (nodeHeaders: IncomingHttpHeaders) => {
    const converted = new Headers();
    for (const [name, value] of Object.entries(nodeHeaders)) {
      if (Array.isArray(value)) for (const item of value) converted.append(name, item);
      else if (value !== undefined) converted.set(name, value);
    }
    return converted;
  };
  await createRequestHandler({
    config: { ...config, trustedProxyIp: proxy.trusted },
    auth: {
      handler: auth.handler ?? unusedAuth,
      getSession: auth.getSession ?? unusedAuth,
      fromNodeHeaders,
    },
    workspaces, chat, ...services,
    records: new Proxy({} as HandlerOptions["records"], {
      get() { throw new Error("Record storage must not be accessed"); },
    }),
    checkDatabase: async () => { throw new Error("Database health must not be queried"); },
  })(request, response as unknown as ServerResponse);
  return { status: response.statusCode, headers, body: body.toString("utf8") };
}

function sessionLookup(session: ServerAuthSession | null | (() => ServerAuthSession | null), cookies: string[]): SessionLookup {
  const headers = new Headers();
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  function getSession(options: { headers: Headers; returnHeaders?: false }): Promise<ServerAuthSession | null>;
  function getSession(options: { headers: Headers; returnHeaders: true }): Promise<ServerAuthSessionWithHeaders>;
  async function getSession(options: { headers: Headers; returnHeaders?: boolean }) {
    const response = typeof session === "function" ? session() : session;
    return options.returnHeaders === true ? { headers, response } : response;
  }
  return getSession;
}

test("workspace responses forward every refreshed session cookie without merging them", async () => {
  const cookies = [
    "better-auth.session_token=renewed-session; Expires=Wed, 23 Sep 2026 00:00:00 GMT; Path=/; HttpOnly; SameSite=Lax",
    "better-auth.session_data=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
  ];
  const workspace = { id: "workspace-id", storageEpoch: "storage-epoch", createdAt: "2026-09-22T00:00:00.000Z" };
  const store: WorkspaceStore = {
    listForUser: async (userId) => { assert.equal(userId, "owner"); return [workspace]; },
    getForUser: async () => { throw new Error("Unexpected workspace lookup"); },
    ensureForUser: async () => { throw new Error("Unexpected workspace creation"); },
  };
  const response = await dispatch("/api/workspaces", { getSession: sessionLookup({ user: { id: "owner" } }, cookies) }, store);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { workspaces: [workspace] });
  assert.deepEqual(response.headers.get("set-cookie"), cookies);
});

test("unauthorized workspace responses preserve the session deletion cookies", async () => {
  const cookies = [
    "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
    "better-auth.session_data=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
  ];
  const response = await dispatch("/api/workspaces", { getSession: sessionLookup(null, cookies) });
  assert.equal(response.status, 401);
  assert.equal(JSON.parse(response.body).error.code, "unauthorized");
  assert.deepEqual(response.headers.get("set-cookie"), cookies);
});

test("authentication server errors return a fixed unavailable response without provider details", async () => {
  for (const status of [500, 502, 503, 599]) {
    const response = await dispatch("/api/auth/get-session", {
      handler: async () => new Response("synthetic-private-database-error", { status }),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(JSON.parse(response.body), {
      error: { code: "service_unavailable", message: "服務暫時未能處理，請稍後重試。" },
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("authentication client errors retain their response and cookies", async () => {
  const cookie = "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly";
  const response = await dispatch("/api/auth/get-session", {
    handler: async () => Response.json({ code: "SESSION_EXPIRED" }, { status: 401, headers: { "set-cookie": cookie } }),
  });
  assert.equal(response.status, 401);
  assert.deepEqual(JSON.parse(response.body), { code: "SESSION_EXPIRED" });
  assert.deepEqual(response.headers.get("set-cookie"), [cookie]);
});

test("thrown authentication provider errors fail closed without private details or downstream access", async () => {
  const providerError = new Error("synthetic-private-provider-error");
  let calls = 0;
  const fail = async (): Promise<never> => { calls += 1; throw providerError; };
  for (const path of ["/api/auth/get-session", "/api/workspaces"]) {
    const response = await dispatch(path, { handler: fail, getSession: fail });
    assert.equal(response.status, 503);
    assert.deepEqual(JSON.parse(response.body), {
      error: { code: "service_unavailable", message: "服務暫時未能處理，請稍後重試。" },
    });
    assert.doesNotMatch(response.body, /synthetic-private/u);
  }
  assert.equal(calls, 2);
});

test("fresh same-request session checks block revocation before reads and account switches before private returns", async () => {
  const owner = { user: { id: "owner" } };
  for (const scenario of [
    { next: null, ownerReads: 1, expectedPages: 0 },
    { next: { user: { id: "other" } }, ownerReads: 2, expectedPages: 1 },
  ]) {
    let reads = 0, pages = 0;
    const response = await dispatch("/api/children/79081f55-9e30-4ee5-91fb-71982b20d6f7/library", {
      getSession: sessionLookup(() => ++reads <= scenario.ownerReads ? owner : scenario.next, []),
    }, unusedStore, undefined, { expectedUserId: "owner" }, {
      personalLibrary: { page: async userId => {
        assert.equal(userId, "owner");
        pages += 1;
        return { items: [], nextCursor: "synthetic-private-library-cursor", complete: false };
      } },
    });
    assert.equal(response.status, 409);
    assert.equal(JSON.parse(response.body).error.code, "session_changed");
    assert.doesNotMatch(response.body, /synthetic-private/u);
    assert.equal(reads, scenario.ownerReads + 1);
    assert.equal(pages, scenario.expectedPages);
  }
});

test("invited account rejection stops before domain actions", async () => {
  let reads = 0, admissionChecks = 0;
  const unused = async (): Promise<never> => { throw new Error("Unexpected account action"); };
  const response = await dispatch("/api/workspaces", {
    getSession: sessionLookup(() => { reads += 1; return { user: { id: "owner" } }; }, []),
  }, unusedStore, undefined, {}, {
    account: { admission: {
      enabled: true, assertCanRegister: unused, admit: unused, assertSessionAdmission: unused,
      status: unused, acknowledge: unused,
      assertUsable: async userId => {
        assert.equal(userId, "owner");
        admissionChecks += 1;
        throw new AccountAdmissionError(403, "invitation_required");
      },
    } },
  });
  assert.equal(response.status, 403);
  assert.equal(JSON.parse(response.body).error.code, "invitation_required");
  assert.equal(reads, 1);
  assert.equal(admissionChecks, 1);
});

test("expected-user mismatches stop library access and native session revocation", async () => {
  let pages = 0, revocations = 0, reads = 0;
  const auth = {
    handler: async () => { revocations += 1; return Response.json({ revoked: true }); },
    getSession: sessionLookup(() => { reads += 1; return { user: { id: "owner" } }; }, []),
  };
  const library = await dispatch("/api/children/79081f55-9e30-4ee5-91fb-71982b20d6f7/library",
    auth, unusedStore, undefined, { expectedUserId: "other" }, {
      personalLibrary: { page: async () => { pages += 1; return { items: [], nextCursor: null, complete: true }; } },
    });
  const revoke = await dispatch("/api/auth/revoke-other-sessions", auth, unusedStore, undefined,
    { expectedUserId: "other", method: "POST" });
  for (const response of [library, revoke]) {
    assert.equal(response.status, 409);
    assert.equal(JSON.parse(response.body).error.code, "session_changed");
  }
  assert.equal(pages, 0);
  assert.equal(revocations, 0);
  assert.equal(reads, 2);
});

test("origin and CSRF checks reject requests before authentication or domain actions", async () => {
  const forbidden = await dispatch("/api/workspaces", {}, unusedStore, undefined, { origin: "https://synthetic.invalid" });
  const missing = await dispatch("/api/workspaces", {}, unusedStore, undefined, { origin: null, method: "POST" });
  for (const response of [forbidden, missing]) {
    assert.equal(response.status, 403);
    assert.equal(JSON.parse(response.body).error.code, "forbidden_origin");
  }
});

test("database socket errors stay handled for checked-out and idle connections without leaking details", async (context) => {
  const logs: unknown[][] = [];
  context.mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
  const pool = createPool(config);
  try {
    for (let index = 0; index < 2; index += 1) {
      const client = new EventEmitter() as PoolClient;
      pool.emit("connect", client);
      assert.doesNotThrow(() => client.emit("error", new Error(`synthetic-private-socket-${index}`)));
      assert.doesNotThrow(() => client.emit("error", new Error(`synthetic-private-repeat-${index}`)));
    }
    assert.doesNotThrow(() => pool.emit("error", new Error("synthetic-private-idle-error")));
    assert.ok(logs.length > 0);
    for (const args of logs) {
      assert.equal(args.length, 1);
      assert.equal(typeof args[0], "string");
      assert.doesNotMatch(args[0] as string, /synthetic-private/u);
    }
  } finally {
    await pool.end();
  }
});

for (const scenario of ["unlock failure", "rollback failure"] as const) {
  test(`migration releases its client before pool shutdown after ${scenario}`, async (context) => {
    const releases: (boolean | undefined)[] = [];
    const queries: string[] = [];
    let ended = false;
    let releasedBeforeEnd = false;
    const logs: unknown[][] = [];
    context.mock.method(console, "info", () => {});
    context.mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (scenario === "unlock failure" && sql.includes("pg_advisory_unlock")) throw new Error("synthetic-private-unlock-error");
        if (scenario === "rollback failure" && sql.startsWith("CREATE TABLE")) throw new Error("synthetic-private-migration-error");
        if (scenario === "rollback failure" && sql === "ROLLBACK") throw new Error("synthetic-private-rollback-error");
        return { rows: [] };
      },
      release(destroy?: boolean) { releases.push(destroy); },
    };
    context.mock.module(new URL("../server/config.ts", import.meta.url), { namedExports: { readServerConfig: () => config } });
    context.mock.module(new URL("../server/database.ts", import.meta.url), { namedExports: {
      createPool: () => ({
        connect: async () => client,
        end: async () => { ended = true; releasedBeforeEnd = releases.length === 1; },
      }),
    } });
    context.mock.module(new URL("../server/auth.ts", import.meta.url), { namedExports: { createAuth: () => ({ options: {} }) } });
    context.mock.module("better-auth/db/migration", { namedExports: {
      getMigrations: async () => ({ runMigrations: async () => {} }),
    } });
    const previousExitCode = process.exitCode;
    try {
      const migrationUrl = new URL("../server/migrate.ts", import.meta.url);
      migrationUrl.searchParams.set("runtime-test", scenario);
      await import(migrationUrl.href);
      assert.equal(releases.length, 1);
      if (scenario === "unlock failure") assert.equal(releases[0], true);
      if (scenario === "rollback failure") assert.ok(queries.includes("ROLLBACK"));
      assert.equal(ended, true);
      assert.equal(releasedBeforeEnd, true);
      assert.doesNotMatch(JSON.stringify(logs), /synthetic-private/u);
    } finally {
      process.exitCode = previousExitCode;
    }
  });
}

test("AI availability requires a session and exposes no server configuration", async () => {
  const denied = await dispatch("/api/ai/status", { getSession: sessionLookup(null, []) });
  assert.equal(denied.status, 401);
  const permitted = await dispatch("/api/ai/status", { getSession: sessionLookup({ user: { id: "owner" } }, []) });
  assert.equal(permitted.status, 200);
  assert.deepEqual(JSON.parse(permitted.body), { available: false });
  assert.equal(permitted.headers.get("cache-control"), "no-store");
});
test("chat HTTP route uses the current session and preserves renewed cookies", async () => {
  const cookie = "better-auth.session_token=synthetic-renewed; Path=/; HttpOnly";
  const response = await dispatch("/api/children/79081f55-9e30-4ee5-91fb-71982b20d6f7/messages",
    { getSession: sessionLookup({ user: { id: "owner" } }, [cookie]) }, unusedStore, {
      acquireReplyLock: async () => { throw new Error("Unexpected generation lock"); },
      listForUser: async (userId) => { assert.equal(userId, "owner"); return { messages: [], limit: 100 }; },
      createUserMessageForUser: async () => { throw new Error("Unexpected write"); },
      createModelMessageForUser: async () => { throw new Error("Unexpected model write"); },
    });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { messages: [], limit: 100 });
  assert.deepEqual(response.headers.get("set-cookie"), [cookie]);
});

test("only the configured proxy peer can supply a single client IP", async () => {
  for (const [peer, forwarded, trusted, expected] of [
    ["172.30.51.3", "203.0.113.10", "172.30.51.3", "203.0.113.10"],
    ["::ffff:172.30.51.3", "203.0.113.11", "172.30.51.3", "203.0.113.11"],
    ["172.30.51.3", "2001:db8::10", "172.30.51.3", "2001:db8::10"],
    ["172.30.51.4", "203.0.113.10", "172.30.51.3", "172.30.51.4"],
    ["172.30.51.3", "203.0.113.10, 203.0.113.11", "172.30.51.3", "172.30.51.3"],
    ["172.30.51.3", "invalid", "172.30.51.3", "172.30.51.3"],
    ["127.0.0.1", "203.0.113.10", undefined, "127.0.0.1"],
  ]) {
    const response = await dispatch("/api/auth/get-session", { handler: async request => {
      assert.equal(request.headers.get("x-forwarded-for"), expected);
      return Response.json(null);
    } }, unusedStore, undefined, { peer, forwarded, trusted });
    assert.equal(response.status, 200);
  }
});

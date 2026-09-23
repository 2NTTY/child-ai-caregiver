import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import type { PoolClient } from "pg";
import { createRequestHandler } from "../server/app.ts";
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
type SessionLookup = (options: { headers: Headers; returnHeaders?: boolean }) => Promise<unknown>;

const unusedStore = new Proxy({} as WorkspaceStore, {
  get() { throw new Error("Storage must not be accessed"); },
});

async function dispatch(path: string, auth: {
  handler?: (request: Request) => Promise<Response>;
  getSession?: SessionLookup;
}, workspaces: WorkspaceStore = unusedStore) {
  const headers = new Map<string, string | number | readonly string[]>();
  let body: Buffer = Buffer.alloc(0);
  const request = {
    method: "GET", url: path,
    headers: { origin: config.webOrigin, cookie: "better-auth.session_token=synthetic-session" },
    socket: { remoteAddress: "127.0.0.1" },
    resume() {},
  } as unknown as IncomingMessage;
  const response = {
    statusCode: 200, headersSent: false, destroyed: false,
    setHeader(name: string, value: string | number | readonly string[]) { headers.set(name.toLowerCase(), value); },
    end(value: Buffer) { body = value; },
  };
  const unusedAuth = async () => { throw new Error("Unexpected authentication call"); };
  await createRequestHandler({
    config,
    auth: {
      handler: auth.handler ?? unusedAuth,
      api: { getSession: auth.getSession ?? unusedAuth },
    } as unknown as HandlerOptions["auth"],
    workspaces,
    records: new Proxy({} as HandlerOptions["records"], {
      get() { throw new Error("Record storage must not be accessed"); },
    }),
    checkDatabase: async () => { throw new Error("Database health must not be queried"); },
  })(request, response as unknown as ServerResponse);
  return { status: response.statusCode, headers, body: body.toString("utf8") };
}

function sessionLookup(session: { user: { id: string } } | null, cookies: string[]): SessionLookup {
  const headers = new Headers();
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return async (options) => options.returnHeaders ? { headers, response: session } : session;
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
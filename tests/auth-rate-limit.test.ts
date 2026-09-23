import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { betterAuth } from "better-auth";

test("session reads do not consume login limits and login limits are isolated by sanitized client IP", async (context) => {
  // Keep the real HTTP middleware, but omit startup schema inspection in this isolated unit test.
  context.mock.module("better-auth", { namedExports: {
    betterAuth: (options: Parameters<typeof betterAuth>[0]) => betterAuth({ ...options,
      advanced: { ...options.advanced, database: { validateSchema: false } },
    }),
  } });
  const { createAuth } = await import("../server/auth.ts");
  const pool = new Pool();
  // These requests have no cookie or valid credentials and must not reach PostgreSQL.
  pool.connect = async () => { throw new Error("Unexpected database connection"); };
  const auth = createAuth({
    databaseUrl: "postgresql://localhost/unused", authSecret: "synthetic-auth-rate-limit-secret-2026",
    publicOrigin: "http://localhost:3001", webOrigin: "http://localhost:3001",
    host: "127.0.0.1", port: 3001, production: false,
  }, pool);
  try {
    for (let i = 0; i < 105; i += 1) {
      const response = await auth.handler(new Request("http://localhost:3001/api/auth/get-session", {
        headers: { "x-forwarded-for": "203.0.113.21" },
      }));
      assert.equal(response.status, 200);
      assert.equal(await response.json(), null);
    }
    const attempt = (ip: string) => auth.handler(new Request("http://localhost:3001/api/auth/sign-in/email", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3001", "x-forwarded-for": ip },
      body: JSON.stringify({ email: "invalid", password: "synthetic" }),
    }));
    for (let i = 0; i < 3; i += 1) assert.equal((await attempt("203.0.113.21")).status, 400);
    const limited = await attempt("203.0.113.21");
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("x-retry-after")) > 0);
    assert.equal((await attempt("203.0.113.22")).status, 400);
  } finally {
    await pool.end();
  }
});

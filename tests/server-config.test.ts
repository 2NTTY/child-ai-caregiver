import assert from "node:assert/strict";
import test from "node:test";
import { readServerConfig } from "../server/config.ts";

const validEnv = {
  DATABASE_URL: "postgresql://synthetic_user:synthetic_password@localhost:5432/synthetic_config",
  BETTER_AUTH_SECRET: "s06-config-test-key-5yKu4mD8Qz2vT6xN",
};

test("server configuration supplies loopback development defaults", () => {
  assert.deepEqual(readServerConfig(validEnv), {
    databaseUrl: validEnv.DATABASE_URL,
    authSecret: validEnv.BETTER_AUTH_SECRET,
    publicOrigin: "http://localhost:3001",
    webOrigin: "http://localhost:8081",
    host: "127.0.0.1",
    port: 3001,
    production: false,
  });
});

test("development configuration supports explicit loopback addresses and HTTPS origins", () => {
  for (const origin of ["http://localhost:4010", "http://127.0.0.2:4010", "http://[::1]:4010", "https://care.example:8443"]) {
    const config = readServerConfig({ ...validEnv, NODE_ENV: "development", SERVER_ORIGIN: origin, WEB_ORIGIN: origin, HOST: "::1", PORT: "4010" });
    assert.equal(config.publicOrigin, origin);
    assert.equal(config.webOrigin, origin);
    assert.equal(config.host, "::1");
    assert.equal(config.port, 4010);
  }
  assert.equal(readServerConfig({ ...validEnv, SERVER_ORIGIN: "HTTPS://CARE.EXAMPLE:443" }).publicOrigin, "https://care.example");
});

test("production requires an HTTPS server origin and defaults the web origin to it", () => {
  assert.throws(() => readServerConfig({ ...validEnv, NODE_ENV: "production" }), { message: "Invalid SERVER_ORIGIN configuration" });
  const config = readServerConfig({ ...validEnv, NODE_ENV: "production", SERVER_ORIGIN: "https://care.example" });
  assert.equal(config.production, true);
  assert.equal(config.publicOrigin, "https://care.example");
  assert.equal(config.webOrigin, config.publicOrigin);
  assert.equal(readServerConfig({ ...validEnv, NODE_ENV: "production", SERVER_ORIGIN: "https://api.care.example", WEB_ORIGIN: "https://care.example" }).webOrigin, "https://care.example");
});

test("production rejects cleartext origins even on loopback", () => {
  for (const origin of ["http://localhost:3001", "http://127.0.0.1:3001", "http://[::1]:3001"]) {
    assert.throws(() => readServerConfig({ ...validEnv, NODE_ENV: "production", SERVER_ORIGIN: origin }), { message: "Invalid SERVER_ORIGIN configuration" });
    assert.throws(() => readServerConfig({ ...validEnv, NODE_ENV: "production", SERVER_ORIGIN: "https://care.example", WEB_ORIGIN: origin }), { message: "Invalid WEB_ORIGIN configuration" });
  }
});

test("server configuration accepts both PostgreSQL URL schemes", () => {
  for (const databaseUrl of ["postgres://localhost/synthetic_config", "postgresql://localhost:5432/synthetic_config?application_name=synthetic"]) {
    assert.equal(readServerConfig({ ...validEnv, DATABASE_URL: databaseUrl }).databaseUrl, databaseUrl);
  }
});

test("server configuration rejects missing or invalid database URLs", () => {
  for (const databaseUrl of [undefined, "", " ", "not-a-url", "mysql://localhost/synthetic_config", "postgresql:///synthetic_config", "postgres:synthetic_config", "postgres://localhost/synthetic_config#", "postgres://localhost/synthetic_config\n"]) {
    assert.throws(() => readServerConfig({ ...validEnv, DATABASE_URL: databaseUrl }), { message: "Invalid DATABASE_URL configuration" });
  }
});

test("server configuration requires a sufficiently long non-placeholder auth secret", () => {
  for (const secret of [undefined, "", "q7mK8xB2vD4pR6sT9yN3zF5cH1wL0eA", "a".repeat(32), "better-auth-secret-12345678901234567890", "replace-with-at-least-32-random-characters", "change-me-to-at-least-32-random-characters", "your-secret-key-at-least-32-characters-long", ` ${validEnv.BETTER_AUTH_SECRET}`, `${validEnv.BETTER_AUTH_SECRET}\n`]) {
    assert.throws(() => readServerConfig({ ...validEnv, BETTER_AUTH_SECRET: secret }), { message: "Invalid BETTER_AUTH_SECRET configuration" });
  }
});

test("server configuration validates the TCP port range without coercing malformed values", () => {
  for (const port of ["1", "65535"]) {
    assert.equal(readServerConfig({ ...validEnv, PORT: port }).port, Number(port));
  }
  for (const port of ["", "0", "65536", "-1", "3.1", "1e3", "NaN", "Infinity", "3001 ", "0x10", "+3001"]) {
    assert.throws(() => readServerConfig({ ...validEnv, PORT: port }), { message: "Invalid PORT configuration" });
  }
});

test("server configuration rejects empty or whitespace listener hosts", () => {
  for (const host of ["", " ", "localhost\n"]) {
    assert.throws(() => readServerConfig({ ...validEnv, HOST: host }), { message: "Invalid HOST configuration" });
  }
});

test("server and web origins reject paths, credentials, wildcards and parser normalization tricks", () => {
  const invalidOrigins = [
    "", "//care.example", "file:///care.example", "http://care.example", "http://localhost.care.example", "http://127.care.example",
    "https://care.example/", "https://care.example/api", "https://care.example/..", "https://care.example?", "https://care.example?key=private", "https://care.example#", "https://care.example#private",
    "https://name:private@care.example", "https://@care.example", "https://*.care.example", "https://%2a.care.example", "https://care.example\\private", " https://care.example", "https://care.example\n",
  ];
  for (const name of ["SERVER_ORIGIN", "WEB_ORIGIN"] as const) {
    for (const origin of invalidOrigins) {
      assert.throws(() => readServerConfig({ ...validEnv, [name]: origin }), { message: `Invalid ${name} configuration` });
    }
  }
});

test("configuration failures identify the setting without revealing rejected values", () => {
  const privateMarker = "synthetic-private-value";
  for (const [name, value] of [
    ["DATABASE_URL", `mysql://name:${privateMarker}@private.example/database`],
    ["BETTER_AUTH_SECRET", privateMarker],
    ["SERVER_ORIGIN", `https://name:${privateMarker}@private.example`],
    ["WEB_ORIGIN", `https://private.example?key=${privateMarker}`],
    ["PORT", privateMarker],
  ]) {
    assert.throws(() => readServerConfig({ ...validEnv, [name]: value }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, `Invalid ${name} configuration`);
      assert.equal(error.message.includes(privateMarker), false);
      assert.equal(error.message.includes("private.example"), false);
      return true;
    });
  }
});

test("proxy trust defaults off and accepts only one explicit IPv4 peer", () => {
  assert.equal(readServerConfig(validEnv).trustedProxyIp, undefined);
  assert.equal(readServerConfig({ ...validEnv, TRUSTED_PROXY_IP: "172.30.51.3" }).trustedProxyIp, "172.30.51.3");
  for (const value of ["web", "172.30.51.0/28", "0.0.0.0/0", "172.30.51.3,127.0.0.1", " 172.30.51.3", "::1"]) {
    assert.throws(() => readServerConfig({ ...validEnv, TRUSTED_PROXY_IP: value }), { message: "Invalid TRUSTED_PROXY_IP configuration" });
  }
});

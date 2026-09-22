import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Run only after the local integration acceptance has been approved.
const repositoryDirectory = fileURLToPath(new URL("../", import.meta.url));
const ownedProcesses = new Set();
const interruption = new AbortController();
const requestTimeoutMs = 5_000;
const includeRecords = process.argv.includes("--records");
let configuration;
let serverProcess;
let currentCheck = "PREFLIGHT";
let passedChecks = 0;
let databaseTouched = false;

class VerificationFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function requireResult(condition, code) {
  if (!condition) throw new VerificationFailure(code);
}

function checkInterruption() {
  requireResult(!interruption.signal.aborted, "INTERRUPTED");
}

function readConfiguration() {
  requireResult(Number(process.versions.node.split(".")[0]) === 24, "NODE_24_REQUIRED");
  const databaseUrl = process.env.TEST_DATABASE_URL;
  requireResult(typeof databaseUrl === "string" && databaseUrl.length > 0, "TEST_DATABASE_URL_REQUIRED");
  let parsedUrl;
  let databaseName;
  try {
    parsedUrl = new URL(databaseUrl);
    databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
  } catch {
    throw new VerificationFailure("TEST_DATABASE_URL_INVALID");
  }
  requireResult(
    ["postgres:", "postgresql:"].includes(parsedUrl.protocol)
      && ["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsedUrl.hostname)
      && parsedUrl.username.length > 0
      && /^yuban_s06_test[A-Za-z0-9_]*$/.test(databaseName)
      && databaseName.length <= 63
      && !parsedUrl.search
      && !parsedUrl.hash,
    "LOCAL_TEST_DATABASE_REQUIRED",
  );
  // Query parameters are rejected because connection options can override a URL host.
  const portText = process.env.TEST_PORT ?? "3099";
  const port = Number(portText);
  requireResult(/^\d+$/.test(portText) && Number.isInteger(port) && port > 0 && port <= 65535, "TEST_PORT_INVALID");
  const serverOrigin = "http://127.0.0.1:" + port;
  const webOrigin = "http://localhost:" + port;
  const inheritedKeys = new Set(["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"]);
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => inheritedKeys.has(name.toUpperCase())),
  );
  return {
    port,
    serverOrigin,
    webOrigin,
    environment: {
      ...environment,
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      SERVER_ORIGIN: serverOrigin,
      WEB_ORIGIN: webOrigin,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "test",
    },
  };
}

async function requireFreePort() {
  checkInterruption();
  await new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.once("error", () => rejectPort(new VerificationFailure("TEST_PORT_UNAVAILABLE")));
    probe.listen({ host: "127.0.0.1", port: configuration.port, exclusive: true }, () => {
      probe.close((error) => {
        if (error) rejectPort(new VerificationFailure("TEST_PORT_UNAVAILABLE"));
        else resolvePort();
      });
    });
  });
}

function spawnOwned(relativePath) {
  checkInterruption();
  const child = spawn(process.execPath, [resolve(repositoryDirectory, relativePath)], {
    cwd: repositoryDirectory,
    env: configuration.environment,
    windowsHide: true,
    // Never forward migration/server errors, HTTP bodies, credentials, or cookies.
    stdio: "ignore",
  });
  const owned = { child, result: undefined, stopping: undefined };
  ownedProcesses.add(owned);
  const finish = (result) => {
    if (owned.result !== undefined) return;
    owned.result = result;
    ownedProcesses.delete(owned);
  };
  child.on("error", () => {
    // A failed kill is not proof that a process has exited.
    if (!child.pid) finish({ code: null, spawnFailed: true });
  });
  child.once("exit", (code) => finish({ code, spawnFailed: false }));
  return owned;
}

async function waitForExit(owned, timeoutMs, interruptible = true) {
  const deadline = performance.now() + timeoutMs;
  while (owned.result === undefined && performance.now() < deadline) {
    if (interruptible) checkInterruption();
    await delay(100);
  }
  return owned.result;
}

async function stopOwned(owned) {
  if (!owned || owned.result !== undefined) return;
  if (owned.stopping) return owned.stopping;
  owned.stopping = (async () => {
    // ChildProcess.kill targets this exact child on Windows too; never use taskkill.
    owned.child.kill("SIGTERM");
    if (await waitForExit(owned, 5_000, false)) return;
    owned.child.kill("SIGKILL");
    requireResult(await waitForExit(owned, 5_000, false), "OWNED_PROCESS_STOP_FAILED");
  })();
  return owned.stopping;
}

async function request(path, { method = "GET", cookie, body, origin = configuration.webOrigin, headers = {}, expectedUserId } = {}) {
  checkInterruption();
  requireResult(serverProcess?.result === undefined, "SERVER_EXITED");
  const requestHeaders = { accept: "application/json", ...headers };
  if (origin !== null) requestHeaders.origin = origin;
  if (cookie) requestHeaders.cookie = cookie;
  if (expectedUserId) requestHeaders["x-expected-user-id"] = expectedUserId;
  if (body !== undefined) requestHeaders["content-type"] = "application/json";
  try {
    const response = await fetch(new URL(path, configuration.serverOrigin), {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.any([interruption.signal, AbortSignal.timeout(requestTimeoutMs)]),
    });
    const data = await response.json().catch(() => undefined);
    requireResult(serverProcess?.result === undefined, "SERVER_EXITED");
    return { status: response.status, headers: response.headers, data };
  } catch (error) {
    checkInterruption();
    if (error instanceof VerificationFailure) throw error;
    throw new VerificationFailure("HTTP_REQUEST_FAILED");
  }
}

async function startServer() {
  await requireFreePort();
  serverProcess = spawnOwned("server/index.ts");
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    checkInterruption();
    requireResult(serverProcess.result === undefined, "SERVER_START_FAILED");
    try {
      const health = await request("/api/health", { origin: null });
      if (health.status === 200 && health.data?.status === "ok") return;
    } catch (error) {
      if (!(error instanceof VerificationFailure) || error.code !== "HTTP_REQUEST_FAILED") throw error;
    }
    await delay(200);
  }
  throw new VerificationFailure("DATABASE_HEALTH_NOT_READY");
}

async function runCheck(name, action) {
  currentCheck = name;
  checkInterruption();
  await action();
  passedChecks += 1;
  console.log("[PASS] " + name);
}

function requireStatus(response, status) {
  requireResult(response.status === status, "EXPECTED_HTTP_" + status + "_RECEIVED_" + response.status);
}

function readSessionCookie(response) {
  const cookies = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]);
  requireResult(cookies.length > 0 && cookies.every((value) => value.indexOf("=") > 0), "SESSION_COOKIE_MISSING");
  return cookies.join("; ");
}

async function signIn(account) {
  const options = {
    method: "POST",
    body: { email: account.email, password: account.password },
  };
  let response = await request("/api/auth/sign-in/email", options);
  if (response.status === 429) {
    // Keep the real authentication rate limit enabled; retry once within its window.
    const retryAfter = Number(response.headers.get("retry-after") ?? response.headers.get("x-retry-after"));
    requireResult(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 10, "AUTH_RETRY_WINDOW_INVALID");
    await delay(retryAfter * 1000 + 100, undefined, { signal: interruption.signal });
    response = await request("/api/auth/sign-in/email", options);
  }
  requireStatus(response, 200);
  requireResult(response.data?.user?.id === account.id, "SESSION_IDENTITY_MISMATCH");
  account.cookie = readSessionCookie(response);
}

async function requireSession(account, cookie = account.cookie) {
  const response = await request("/api/auth/get-session", { cookie, origin: null });
  requireStatus(response, 200);
  requireResult(response.data?.user?.id === account.id, "SESSION_IDENTITY_MISMATCH");
}

function readWorkspace(response) {
  requireStatus(response, 200);
  const workspace = response.data?.workspace;
  requireResult(
    workspace && typeof workspace.id === "string" && workspace.id.length > 0
      && ((typeof workspace.storageEpoch === "string" && workspace.storageEpoch.length > 0)
        || (Number.isSafeInteger(workspace.storageEpoch) && workspace.storageEpoch >= 0))
      && typeof workspace.createdAt === "string" && Number.isFinite(Date.parse(workspace.createdAt)),
    "WORKSPACE_RESPONSE_INVALID",
  );
  return workspace;
}

function requireSameWorkspace(actual, expected) {
  requireResult(
    actual && actual.id === expected.id && actual.storageEpoch === expected.storageEpoch && actual.createdAt === expected.createdAt,
    "WORKSPACE_PERSISTENCE_MISMATCH",
  );
}

async function requireWorkspaceList(account, expected) {
  const response = await request("/api/workspaces", { cookie: account.cookie, origin: null });
  requireStatus(response, 200);
  requireResult(Array.isArray(response.data?.workspaces) && response.data.workspaces.length === expected.length, "WORKSPACE_LIST_MISMATCH");
  for (let index = 0; index < expected.length; index += 1) {
    requireSameWorkspace(response.data.workspaces[index], expected[index]);
  }
}

async function verifyIntegration() {
  configuration = readConfiguration();
  await requireFreePort();
  await runCheck("MIGRATIONS", async () => {
    databaseTouched = true;
    const migration = spawnOwned("server/migrate.ts");
    const result = await waitForExit(migration, 60_000);
    requireResult(result, "MIGRATION_TIMEOUT");
    requireResult(!result.spawnFailed && result.code === 0, "MIGRATION_FAILED");
  });
  await runCheck("DATABASE_HEALTH", startServer);

  const runId = randomUUID();
  const accounts = ["a", "b"].map((suffix) => ({
    email: "s06-" + runId + "-" + suffix + "@example.test",
    password: randomBytes(24).toString("base64url"),
    name: "S06 synthetic account " + suffix.toUpperCase(),
    id: undefined,
    cookie: undefined,
  }));
  const [accountA, accountB] = accounts;
  const inventedId = randomUUID();
  const workspacePath = (workspace) => "/api/workspaces/" + encodeURIComponent(workspace.id);
  let workspaceA;
  let workspaceB;
  let signedOutCookie;
  let childA;
  let childASecond;
  let childB;
  let recordA;
  const originalText = "  下午約三點飲咗半杯水\n孩子話有啲攰，未量體溫。  ";

  const childRecordsPath = (child) => "/api/children/" + encodeURIComponent(child.id) + "/records";
  const readChildren = async (account) => {
    const response = await request("/api/children", { cookie: account.cookie });
    requireStatus(response, 200);
    requireResult(Array.isArray(response.data?.children), "CHILD_LIST_INVALID");
    return response.data.children;
  };
  const readRecords = async (account, child) => {
    const response = await request(childRecordsPath(child), { cookie: account.cookie });
    requireStatus(response, 200);
    requireResult(Array.isArray(response.data?.records) && response.data.limit === 100, "RECORD_LIST_INVALID");
    return response.data.records;
  };

  await runCheck("UNAUTHENTICATED_REQUESTS", async () => {
    requireStatus(await request("/api/workspaces", { origin: null }), 401);
    requireStatus(await request("/api/workspaces/" + inventedId, { origin: null }), 401);
    requireStatus(await request("/api/workspaces", {
      method: "POST",
      body: { ownerId: inventedId, workspaceId: inventedId },
      headers: { "x-user-id": inventedId },
    }), 401);
  });

  await runCheck("EMAIL_AUTHENTICATION", async () => {
    for (const account of accounts) {
      const response = await request("/api/auth/sign-up/email", {
        method: "POST",
        body: { email: account.email, password: account.password, name: account.name },
      });
      requireStatus(response, 200);
      requireResult(typeof response.data?.user?.id === "string" && response.data.user.id.length > 0, "AUTH_USER_RESPONSE_INVALID");
      account.id = response.data.user.id;
      await signIn(account);
      await requireSession(account);
    }
    requireResult(accountA.id !== accountB.id, "DISTINCT_ACCOUNTS_REQUIRED");
  });

  await runCheck("SERVER_OWNED_WORKSPACES", async () => {
    await requireWorkspaceList(accountA, []);
    await requireWorkspaceList(accountB, []);
    workspaceA = readWorkspace(await request("/api/workspaces", {
      method: "POST",
      cookie: accountA.cookie,
      body: { ownerId: accountB.id, userId: accountB.id, workspaceId: inventedId, id: inventedId },
      headers: { "x-user-id": accountB.id },
    }));
    requireResult(workspaceA.id !== inventedId, "CLIENT_WORKSPACE_ID_ACCEPTED");
    await requireWorkspaceList(accountB, []);
    workspaceB = readWorkspace(await request("/api/workspaces", {
      method: "POST",
      cookie: accountB.cookie,
      body: { ownerId: accountA.id, workspaceId: workspaceA.id },
      headers: { "x-user-id": accountA.id },
    }));
    requireResult(workspaceA.id !== workspaceB.id, "DISTINCT_WORKSPACES_REQUIRED");
    await requireWorkspaceList(accountA, [workspaceA]);
    await requireWorkspaceList(accountB, [workspaceB]);
  });

  await runCheck("ACCOUNT_ISOLATION", async () => {
    requireStatus(await request(workspacePath(workspaceA), { cookie: accountB.cookie }), 404);
    requireStatus(await request(workspacePath(workspaceB), { cookie: accountA.cookie }), 404);
    requireStatus(await request(workspacePath(workspaceA), {
      cookie: accountB.cookie, headers: { "x-user-id": accountA.id },
    }), 404);
    requireStatus(await request("/api/workspaces", {
      origin: null, headers: { "x-user-id": accountA.id },
    }), 401);
    requireStatus(await request("/api/workspaces", {
      method: "POST", body: { ownerId: accountA.id, workspaceId: workspaceA.id },
      headers: { "x-user-id": accountA.id },
    }), 401);
    requireStatus(await request("/api/workspaces/" + inventedId, { cookie: accountA.cookie }), 404);
    requireSameWorkspace(readWorkspace(await request(workspacePath(workspaceA), { cookie: accountA.cookie, origin: null })), workspaceA);
    requireSameWorkspace(readWorkspace(await request(workspacePath(workspaceB), { cookie: accountB.cookie, origin: null })), workspaceB);
  });

  await runCheck("REPEATED_CREATION_AND_READ", async () => {
    requireSameWorkspace(readWorkspace(await request("/api/workspaces", {
      method: "POST",
      cookie: accountA.cookie,
      origin: configuration.serverOrigin,
      body: { ownerId: accountB.id, workspaceId: workspaceB.id },
      headers: { "x-user-id": accountB.id },
    })), workspaceA);
    requireSameWorkspace(readWorkspace(await request("/api/workspaces", {
      method: "POST", cookie: accountB.cookie, body: {},
    })), workspaceB);
    await requireWorkspaceList(accountA, [workspaceA]);
    await requireWorkspaceList(accountB, [workspaceB]);
  });

  await runCheck("ORIGIN_GUARD", async () => {
    const untrustedOrigin = "http://untrusted.example.test";
    requireStatus(await request("/api/workspaces", {
      method: "POST", cookie: accountA.cookie, body: {}, origin: null,
    }), 403);
    requireStatus(await request("/api/workspaces", {
      method: "POST", cookie: accountA.cookie, body: {}, origin: untrustedOrigin,
    }), 403);
    requireStatus(await request("/api/workspaces", { cookie: accountA.cookie, origin: untrustedOrigin }), 403);
    requireStatus(await request("/api/auth/sign-in/email", {
      method: "POST", body: { email: accountA.email, password: accountA.password }, origin: untrustedOrigin,
    }), 403);
  });

  await runCheck("WRONG_PASSWORD", async () => {
    requireStatus(await request("/api/auth/sign-in/email", {
      method: "POST", body: { email: accountA.email, password: randomBytes(24).toString("base64url") },
    }), 401);
  });

  if (includeRecords) {
    await runCheck("CHILD_CREATION_AND_OWNERSHIP", async () => {
      requireStatus(await request("/api/children", { origin: null }), 401);
      requireStatus(await request("/api/children", { method: "POST", body: { displayName: "合成孩子" } }), 401);
      const createChild = async (account, name) => {
        const response = await request("/api/children", {
          method: "POST", cookie: account.cookie, expectedUserId: account.id,
          body: { displayName: name, ownerId: accountB.id, workspaceId: inventedId },
        });
        requireStatus(response, 201);
        requireResult(response.data?.child?.displayName === name.trim(), "CHILD_RESPONSE_INVALID");
        return response.data.child;
      };
      childA = await createChild(accountA, "  合成小晴  ");
      childASecond = await createChild(accountA, "合成小朗");
      childB = await createChild(accountB, "合成小欣");
      requireResult(childA.workspaceId === workspaceA.id && childB.workspaceId === workspaceB.id, "CHILD_OWNER_MISMATCH");
      const childrenA = await readChildren(accountA);
      const childrenB = await readChildren(accountB);
      requireResult(childrenA.length === 2 && childrenB.length === 1, "CHILD_LIST_OWNER_MISMATCH");
      requireResult(childrenA.some((child) => child.id === childA.id) && childrenB[0]?.id === childB.id, "CHILD_LIST_MISMATCH");
    });
    await runCheck("RAW_TEXT_AND_SERVER_AUTHOR", async () => {
      const response = await request(childRecordsPath(childA), {
        method: "POST", cookie: accountA.cookie, expectedUserId: accountA.id,
        body: { text: originalText, childId: childB.id, authorUserId: accountB.id },
      });
      requireStatus(response, 201);
      recordA = response.data?.record;
      requireResult(recordA?.text === originalText && recordA.childId === childA.id && recordA.authorUserId === accountA.id, "RECORD_OWNERSHIP_OR_TEXT_MISMATCH");
      requireResult(Number.isFinite(Date.parse(recordA.createdAt)), "RECORD_SERVER_TIME_INVALID");
      const records = await readRecords(accountA, childA);
      requireResult(records.length === 1 && records[0]?.id === recordA.id && records[0]?.text === originalText, "RECORD_READ_MISMATCH");
      requireResult((await readRecords(accountA, childASecond)).length === 0, "CHILD_RECORDS_MIXED");
    });
    await runCheck("CHILD_RECORD_ACCESS_BOUNDARY", async () => {
      requireStatus(await request(childRecordsPath(childA), { cookie: accountB.cookie }), 404);
      requireStatus(await request(childRecordsPath(childA), {
        method: "POST", cookie: accountB.cookie, expectedUserId: accountB.id, body: { text: "合成越權輸入", ownerId: accountA.id },
      }), 404);
      requireStatus(await request(childRecordsPath(childB), { cookie: accountA.cookie }), 404);
      requireStatus(await request(childRecordsPath(childA), { origin: null }), 401);
      requireResult((await readRecords(accountB, childB)).length === 0, "FOREIGN_RECORD_CREATED");
      requireResult((await readRecords(accountA, childA)).length === 1, "FOREIGN_RECORD_CREATED");
    });
    await runCheck("CHILD_RECORD_INPUT_VALIDATION", async () => {
      requireStatus(await request("/api/children", { method: "POST", cookie: accountA.cookie, expectedUserId: accountA.id, body: { displayName: "  " } }), 400);
      requireStatus(await request(childRecordsPath(childA), { method: "POST", cookie: accountA.cookie, expectedUserId: accountA.id, body: { text: "  " } }), 400);
      requireStatus(await request("/api/children/not-a-uuid/records", { cookie: accountA.cookie }), 404);
      requireResult((await readRecords(accountA, childA)).length === 1, "INVALID_RECORD_CREATED");
    });
  }

  if (includeRecords) await runCheck("ACCOUNT_SWITCH_WRITE_PRECONDITION", async () => {
    requireStatus(await request("/api/children", {
      method: "POST", cookie: accountB.cookie, expectedUserId: accountA.id, body: { displayName: "不可跨帳號保存的合成草稿" },
    }), 409);
    requireStatus(await request(childRecordsPath(childB), {
      method: "POST", cookie: accountB.cookie, expectedUserId: accountA.id, body: { text: originalText },
    }), 409);
    requireStatus(await request("/api/children", { method: "POST", cookie: accountB.cookie, body: { displayName: "無帳號前置" } }), 428);
    requireResult((await readChildren(accountB)).length === 1 && (await readRecords(accountB, childB)).length === 0, "ACCOUNT_SWITCH_LEAKED_INPUT");
  });

  await runCheck("SESSION_REVOCATION", async () => {
    signedOutCookie = accountA.cookie;
    const response = await request("/api/auth/sign-out", { method: "POST", cookie: signedOutCookie, body: {} });
    requireStatus(response, 200);
    requireStatus(await request("/api/workspaces", { cookie: signedOutCookie, origin: null }), 401);
    if (includeRecords) requireStatus(await request(childRecordsPath(childA), { cookie: signedOutCookie }), 401);
    requireStatus(await request(workspacePath(workspaceA), { cookie: signedOutCookie, origin: null }), 401);
    await signIn(accountA);
    await requireSession(accountA);
  });

  await runCheck("RESTART_PERSISTENCE", async () => {
    const restartCookie = accountA.cookie;
    await stopOwned(serverProcess);
    // Reuse the same generated secret and database URL across this restart.
    await startServer();
    await requireSession(accountA, restartCookie);
    await requireSession(accountB);
    requireSameWorkspace(readWorkspace(await request(workspacePath(workspaceA), { cookie: restartCookie, origin: null })), workspaceA);
    await requireWorkspaceList(accountA, [workspaceA]);
    await requireWorkspaceList(accountB, [workspaceB]);
    requireStatus(await request(workspacePath(workspaceA), { cookie: accountB.cookie }), 404);
    requireStatus(await request("/api/workspaces", { cookie: signedOutCookie, origin: null }), 401);
    if (includeRecords) {
      const children = await readChildren(accountA);
      const records = await readRecords(accountA, childA);
      requireResult(children.some((child) => child.id === childA.id), "CHILD_RESTART_MISMATCH");
      requireResult(records.length === 1 && records[0]?.id === recordA.id && records[0]?.text === originalText, "RECORD_RESTART_MISMATCH");
      requireStatus(await request(childRecordsPath(childA), { cookie: accountB.cookie }), 404);
    }
  });
}

const interrupt = () => interruption.abort();
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
let failure;
try {
  await verifyIntegration();
} catch (error) {
  failure = interruption.signal.aborted
    ? "INTERRUPTED"
    : error instanceof VerificationFailure ? error.code : "UNEXPECTED_FAILURE";
} finally {
  const cleanup = await Promise.allSettled([...ownedProcesses].map(stopOwned));
  if (cleanup.some((result) => result.status === "rejected")) failure = "OWNED_PROCESS_STOP_FAILED";
  if (interruption.signal.aborted && !failure) failure = "INTERRUPTED";
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  if (databaseTouched) console.log("[INFO] Test database rows retained; no database reset or data cleanup performed.");
}
if (failure) {
  console.error("[FAIL] " + currentCheck + ": " + failure);
  process.exitCode = failure === "INTERRUPTED" ? 130 : 1;
} else {
  console.log("[PASS] " + (includeRecords ? "S03-W01" : "S06-W03") + " integration acceptance: " + passedChecks + " checks.");
}

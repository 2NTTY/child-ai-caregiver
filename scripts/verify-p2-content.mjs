import { randomUUID, randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { verifyContent } from "./p2-acceptance-content.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
const origin = "http://127.0.0.1:3102";
const check = (value, code) => { if (!value) throw new Error(code); };

// Offline entry validation only: no service, credentials, database, or test execution.
if (process.argv.length === 3 && process.argv[2] === "--preview") {
  check(typeof verifyContent === "function", "content_entry_missing");
  console.log(JSON.stringify({ status: "prepared_not_executed", scenarios: 1,
    servicesStarted: 0, testsExecuted: 0, maximumBusinessHttp: 60 }));
} else {
  let server, timer, child, step = "preflight", requests = 0, healthReads = 0, completed;
  let ended = false;
  const abort = new AbortController();
  try {
    check(process.argv.length === 3 && process.argv[2] === "--approved-content", "content_approval_required");
    check(process.versions.node.startsWith("24."), "content_node24_required");
    const database = new URL(process.env.TEST_DATABASE_URL);
    check(["postgres:", "postgresql:"].includes(database.protocol)
      && ["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)
      && database.port === "5434" && database.pathname === "/yuban_s06_test"
      && !database.search && !database.hash, "content_synthetic_database_required");
    for (const [name, directory] of [["STORAGE_KEY_FILE", false], ["TEST_ATTACHMENTS_DIR", true]]) {
      check(isAbsolute(process.env[name] ?? ""), "content_protected_path_required");
      const info = await stat(process.env[name]);
      check(directory ? info.isDirectory() : info.isFile(), "content_protected_path_invalid");
    }
    // Never attach this scenario to a pre-existing process.
    const probe = createServer();
    await new Promise((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(3102, "127.0.0.1", () => probe.close(resolve));
    });
    const environment = { ...process.env, DATABASE_URL: database.toString(), NODE_ENV: "test",
      HOST: "127.0.0.1", PORT: "3102", SERVER_ORIGIN: origin, WEB_ORIGIN: origin,
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      ATTACHMENTS_DIR: process.env.TEST_ATTACHMENTS_DIR, P2_AGENT_ENABLED: "true",
      AI_ENABLED: "false", WEB_PUSH_ENABLED: "false", TELEGRAM_ENABLED: "false" };
    timer = setTimeout(() => abort.abort(), 120000);
    step = "server_start";
    server = spawn(process.execPath, ["server/index.ts"], {
      cwd: repository, env: environment, windowsHide: true, stdio: "ignore",
    });
    server.once("error", () => { ended = true; });
    server.once("exit", () => { ended = true; });
    let healthy = false;
    for (let index = 0; index < 20; index++) {
      check(!ended && !abort.signal.aborted, "content_server_start_failed");
      healthReads++;
      try {
        const response = await fetch(origin + "/api/health", { redirect: "error",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(1000)]) });
        healthy = response.ok;
        await response.body?.cancel();
      } catch {}
      if (healthy) break;
      await delay(500, undefined, { signal: abort.signal });
    }
    check(healthy && !ended, "content_server_unavailable");
    async function exchange(actor, path, body, expectedStatus = 200) {
      check(++requests <= 60 && !ended && !abort.signal.aborted, "content_request_budget");
      check(path.startsWith("/") && !path.startsWith("//"), "content_path_invalid");
      const response = await fetch(origin + "/api" + path, {
        method: body === undefined ? "GET" : "POST", redirect: "error",
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
        headers: { origin, ...(actor ? { cookie: actor.cookie, "x-expected-user-id": actor.id } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      check(response.status === expectedStatus, "content_response_status");
      const data = response.headers.get("content-type")?.startsWith("image/")
        ? Buffer.from(await response.arrayBuffer()) : await response.json();
      return { data, headers: response.headers };
    }
    const client = {
      request: async (actor, path, body, status) => (await exchange(actor, path, body, status)).data,
      write: async (actor, path, payload) => {
        const command = { path: "/api" + path, payload };
        const context = await client.request(actor, "/online/context", command);
        const receipt = await client.request(actor, "/online/submit", {
          ...command, operation: { ...context, deviceId: randomUUID(), opId: randomUUID() },
        });
        check(receipt.state === "confirmed" && receipt.result !== null, "content_mutation_unconfirmed");
        return receipt.result;
      },
    };
    step = "synthetic_setup";
    const people = [];
    for (let index = 0; index < 2; index++) {
      const email = "p2-content-" + randomUUID() + "@example.test";
      const signed = await exchange(null, "/auth/sign-up/email",
        { name: "合成內容成員 " + index, email, password: randomBytes(24).toString("hex") });
      people.push({ id: signed.data.user.id, email,
        cookie: signed.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") });
    }
    const [owner, caregiver] = people;
    child = (await client.write(owner, "/children", { displayName: "S16 合成內容孩子" })).child;
    const family = (await client.request(owner, "/families")).families.find(value => value.id === child.workspaceId);
    const invitation = await client.write(owner, "/families/" + child.workspaceId + "/invitations",
      { email: caregiver.email, role: "caregiver", expectedVersion: family.version });
    await client.write(caregiver, "/families/invitations/accept",
      { token: invitation.token, confirmWorkspaceId: child.workspaceId });
    // Valid one-pixel synthetic PNG for file round-trip only, never vision-quality evidence.
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    step = "content_flow";
    const result = await verifyContent({ client, owner, caregiver, child, now: new Date(),
      photo: { base64: bytes.toString("base64"), bytes: bytes.length, mimeType: "image/png",
        sha256: createHash("sha256").update(bytes).digest("hex") } });
    step = "new_child_cleanup";
    await client.write(owner, "/children/" + child.id + "/delete", { confirmChildId: child.id });
    completed = { status: "passed", checks: result.checks, businessHttp: requests, healthReads,
      accountsCreated: 2, childrenCreated: 1, createdChildDeleted: true,
      modelCalls: 0, notifications: 0, migrationsAppliedByEntry: 0 };
  } catch (error) {
    process.exitCode = 1;
    completed = { status: "failed", step, businessHttp: requests, healthReads,
      code: /^content_[a-z_]+$/.test(error?.message ?? "") ? error.message : "content_execution_failed",
      createdChildId: child?.id ?? null, retainedForInspection: Boolean(child),
      automaticRetry: false };
  } finally {
    clearTimeout(timer);
    abort.abort();
    if (server && !ended) {
      const closed = once(server, "exit");
      server.kill();
      await Promise.race([closed, delay(5000, undefined, { ref: false })]);
      if (!ended) { process.exitCode = 1; completed.status = "failed"; completed.stopFailed = true; }
    }
    console.log(JSON.stringify(completed));
  }
}

import { test, expect } from "@playwright/test";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const api = "http://localhost:3101", web = "http://localhost:8181", httpCap = 200, cleanupReserve = 6, storeCap = 15;
const fixturePath = fileURLToPath(new URL("../../scripts/int-domain-fixture.mjs", import.meta.url));
const check = (condition, message) => { if (!condition) throw new Error(message); };
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value);

// One connected zero-model case. W01/W02 isolation and unknown evidence is reused.
test("production domains read one real Care correction across pages without a model", async ({ context, page }, testInfo) => {
  check(process.env.INT_DOMAIN_BROWSER_APPROVED === "true", "INT-W03 bounded browser approval required");
  const owner = { email: "int-w03-" + randomUUID() + "@example.test", password: randomBytes(24).toString("hex"), id: null };
  const suffix = randomUUID().slice(0, 8), childName = "INT-W03 合成孩子 " + suffix;
  const originalText = "INT-W03 合成日常備註 " + suffix + "：今天換了藍色床單。";
  const correctedText = "INT-W03 合成日常備註 " + suffix + "：今天換了綠色床單。";
  let child = null, record = null, revision = null, requests = 0, storeCalls = 0, blockedRequests = 0, pageErrors = 0, capReached = false;
  let firstPageError = null;
  let phase = "setup", failedAt = null, flowSucceeded = false, childDeleted = false, cleanupFailure = null;
  let careConfirmed = false, crossPageConfirmed = false, tasksConfirmed = false, settingsConfirmed = false, fixtureFailure = null;
  const count = cleanup => { check(requests + 1 <= (cleanup ? httpCap : httpCap - cleanupReserve), "INT-W03 HTTP cap reached"); requests++; };
  const boundary = () => check(pageErrors === 0 && blockedRequests === 0 && !capReached && storeCalls <= storeCap, "Domain mount or bounded network check failed");
  const allowedApi = (path, method) => {
    if (method === "OPTIONS") return true;
    // Real mounted owners may read account/catalog metadata; no GET invokes a model or notification.
    if (method === "GET" && path.startsWith("/api/") && !path.startsWith("/api/children/")) return true;
    if (!child) return false;
    const prefix = "/api/children/" + child.id;
    if (method === "POST") return path === prefix + "/care/search";
    if (method !== "GET") return false;
    if (path.startsWith(prefix + "/") && !/\/(?:reply|extract|fetch|delete|revise|decide|cancel)$/u.test(path)) return true;
    return path.startsWith("/api/families/") && !/\/(?:accept|revoke|delete)$/u.test(path);
  };
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (["data:", "blob:"].includes(url.protocol)) { await route.continue(); return; }
    try { count(false); } catch { capReached = true; await route.abort("blockedbyclient"); return; }
    if (![api, web].includes(url.origin) || url.origin === api && !allowedApi(url.pathname, request.method())) {
      blockedRequests++; await route.abort("blockedbyclient"); return;
    }
    await route.continue();
  });
  await context.routeWebSocket("**/*", socket => {
    const url = new URL(socket.url());
    if (url.protocol !== "ws:" || url.hostname !== "localhost" || url.port !== "8181") {
      blockedRequests++; socket.close({ code: 1008, reason: "External network blocked" }); return;
    }
    try { count(false); } catch { capReached = true; socket.close({ code: 1008, reason: "HTTP cap reached" }); return; }
    socket.connectToServer();
  });
  page.on("pageerror", error => { pageErrors++; firstPageError ??= error.message.slice(0, 400); });
  const request = async (path, body, cleanup = false) => {
    count(cleanup);
    let response;
    try { response = await context.request.fetch(api + "/api" + path, { method: body === undefined ? "GET" : "POST", timeout: 10000,
      maxRetries: 0, maxRedirects: 0, headers: { origin: api, ...(owner.id ? { "x-expected-user-id": owner.id } : {}) },
      ...(body === undefined ? {} : { data: body }) }); } catch { throw new Error("Synthetic API request could not be completed"); }
    check(response.status() === 200, "Synthetic API response was not confirmed"); return response.json();
  };
  const write = async (path, payload, cleanup = false) => {
    check(path === "/children" && !cleanup || cleanup && child && path === "/children/" + child.id + "/delete", "Only this fixture child may be written through setup");
    const command = { path: "/api" + path, payload }, basis = await request("/online/context", command, cleanup);
    const receipt = await request("/online/submit", { ...command, operation: { ...basis, deviceId: randomUUID(), opId: randomUUID() } }, cleanup);
    check(receipt.state === "confirmed" && receipt.result, "Synthetic setup operation unconfirmed"); return receipt.result;
  };
  const fixture = input => new Promise((resolve, reject) => {
    const childProcess = spawn(process.execPath, [fixturePath], { env: { ...process.env, AI_ENABLED: "false", WEB_PUSH_ENABLED: "false",
      TELEGRAM_ENABLED: "false", GCP_PROJECT_ID: "", AGENT_DIAGNOSTICS: "false" }, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    let output = "", oversized = false, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; childProcess.kill(); }, 30000);
    childProcess.stdout.on("data", chunk => { output += chunk; if (Buffer.byteLength(output) > 16384) { oversized = true; childProcess.kill(); } });
    childProcess.on("error", () => { clearTimeout(timer); reject(new Error("Local fixture helper could not start")); });
    childProcess.on("close", code => {
      clearTimeout(timer);
      let value;
      try { value = JSON.parse(output); } catch { reject(new Error("Local fixture helper did not return bounded metadata")); return; }
      if (Number.isInteger(value.storeCalls)) storeCalls = value.storeCalls;
      if (code !== 0 || oversized || timedOut || value.ok !== true || value.networkAttempts !== 0 || storeCalls > storeCap) {
        fixtureFailure = { phase: value.phase ?? "fixture_boundary", runId: value.runId ?? null };
        reject(new Error("Local fixture helper failed; preserve this synthetic scene")); return;
      }
      resolve(value);
    });
    childProcess.stdin.on("error", () => {});
    childProcess.stdin.end(JSON.stringify({ ...input, userId: owner.id, childId: child.id, priorStoreCalls: storeCalls }));
  });
  const careResponse = version => {
    const pending = page.waitForResponse(async response => {
      if (new URL(response.url()).pathname !== "/api/children/" + child.id + "/care/search" || response.request().method() !== "POST" || response.status() !== 200) return false;
      try { const body = await response.json(); return body.records?.some(item => item.id === record.recordId && item.version === version); } catch { return false; }
    });
    // Preserve the first setup failure if the associated read never happens.
    void pending.catch(() => {});
    return pending;
  };
  const readResponse = path => {
    const pending = page.waitForResponse(response => new URL(response.url()).pathname === "/api" + path && response.request().method() === "GET");
    void pending.catch(() => {});
    return pending;
  };
  try {
    const signed = await request("/auth/sign-up/email", { email: owner.email, password: owner.password, name: "INT-W03 合成成員" });
    check(typeof signed.user?.id === "string", "Synthetic signup identity unavailable"); owner.id = signed.user.id;
    child = (await write("/children", { displayName: childName })).child;
    check(uuid(child?.id) && child.displayName === childName, "Exactly one synthetic child required");
    record = await fixture({ stage: "seed", text: originalText });
    check(uuid(record.recordId) && record.version === 1 && storeCalls === 1, "Exactly one fixture record required");
    phase = "care_version_one";
    const initialRead = careResponse(1), taskRead = readResponse("/children/" + child.id + "/tasks"), settingsRead = readResponse("/ai/settings");
    await page.goto(web + "/care");
    const first = await initialRead, firstBody = await first.json();
    check(firstBody.records.length === 1 && firstBody.records[0].text === originalText && firstBody.records[0].childId === child.id, "Care must read the one committed fixture record");
    await expect(page.getByRole("heading", { name: "記錄與核對", exact: true })).toBeVisible();
    await expect(page.getByText(originalText, { exact: true }).first()).toBeVisible();
    boundary();
    phase = "zero_model_correction";
    const changedRead = careResponse(2);
    revision = await fixture({ stage: "revise", recordId: record.recordId, text: correctedText });
    check(revision.recordId === record.recordId && revision.version === 2 && revision.confirmationBasis === "preauthorized_user_statement"
      && uuid(revision.receiptId) && uuid(revision.runId) && storeCalls === 8, "One preauthorized correction must retain the original record");
    const corrected = await changedRead, correctedBody = await corrected.json();
    check(correctedBody.records.length === 1 && correctedBody.records[0].id === record.recordId && correctedBody.records[0].version === 2
      && correctedBody.records[0].text === correctedText && correctedBody.records[0].confirmationBasis === "preauthorized_user_statement", "Care must read the committed version two");
    await expect(page.getByText(correctedText, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(originalText, { exact: true })).toHaveCount(0); careConfirmed = true;
    phase = "shared_owner_chat_context";
    await page.getByRole("link", { name: "與 Agent 對話", exact: true }).first().click();
    await expect(page).toHaveURL(web + "/chat");
    await page.getByRole("button", { name: "開啟資訊側欄", exact: true }).click();
    const rail = page.getByTestId("context-rail");
    await rail.getByRole("tab", { name: "照顧上下文", exact: true }).click();
    await expect(rail.getByRole("heading", { name: "已載入照護記錄", exact: true })).toBeVisible();
    await expect(rail.getByText(correctedText, { exact: false }).first()).toBeVisible();
    await expect(rail.getByText(originalText, { exact: false })).toHaveCount(0); crossPageConfirmed = true;
    boundary();
    await page.getByRole("link", { name: "記錄與核對", exact: true }).first().click();
    await expect(page).toHaveURL(web + "/care");
    await expect(page.getByText(correctedText, { exact: true }).first()).toBeVisible();
    phase = "tasks_read";
    await page.getByRole("link", { name: "待辦與預約", exact: true }).first().click();
    const taskResponse = await taskRead;
    check(taskResponse.status() === 200 && (await taskResponse.json()).items?.length === 0, "Task owner must read the actual empty fixture page");
    await expect(page.getByRole("heading", { name: "待辦與預約", exact: true })).toBeVisible();
    await expect(page.getByTestId("tasks-list").getByText(/已載入 0 項/u)).toBeVisible(); tasksConfirmed = true;
    phase = "settings_read";
    await page.getByRole("link", { name: "設定", exact: true }).first().click();
    const settingsResponse = await settingsRead;
    check(settingsResponse.status() === 200 && (await settingsResponse.json()).enabled === false, "Settings owner must read disabled model service from the real API");
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible();
    await expect(page.getByTestId("account-settings").getByRole("heading", { name: "登入與安全", exact: true })).toBeVisible();
    await expect(page.getByText(owner.email, { exact: true }).first()).toBeVisible(); settingsConfirmed = true;
    boundary();
    flowSucceeded = true;
  } catch (error) { failedAt = phase; throw error; }
  finally {
    if (flowSucceeded) try {
      await page.close();
      const result = await write("/children/" + child.id + "/delete", { confirmChildId: child.id }, true);
      check(result.deleted === true && result.childId === child.id, "Own-child cleanup must be confirmed"); childDeleted = true;
    } catch { cleanupFailure = "Own-child cleanup incomplete; retain resource metadata"; }
    await testInfo.attach("int-domain-boundary-metadata", { contentType: "application/json", body: Buffer.from(JSON.stringify({
      requestAttempts: requests, httpCap, cleanupReserve, storeCalls, storeCap, confirmedAccounts: owner.id ? 1 : 0, userId: owner.id,
      childId: child?.id ?? null, recordId: record?.recordId ?? null, version: revision?.version ?? record?.version ?? null,
      confirmationBasis: revision?.confirmationBasis ?? null, receiptId: revision?.receiptId ?? null, runId: revision?.runId ?? null,
      careConfirmed, crossPageConfirmed, tasksConfirmed, settingsConfirmed, flowSucceeded, childDeleted, scenarioRetained: !!child && !childDeleted,
      modelCalls: 0, queryEmbeddings: 0, notificationCalls: 0, blockedRequests, pageErrors, firstPageError, capReached, failedAt, fixtureFailure, cleanupFailure,
    })) });
    if (flowSucceeded) check(cleanupFailure === null, cleanupFailure ?? "Own-child cleanup failure");
  }
});

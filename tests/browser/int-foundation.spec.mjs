import { test, expect } from "@playwright/test";
import { randomUUID, randomBytes } from "node:crypto";

const api = "http://localhost:3101";
const web = "http://localhost:8181";
const httpCap = 100;
const cleanupReserve = 8;
const check = (condition, message) => { if (!condition) throw new Error(message); };

test("production login, original child operation, persistence and private projection", async ({ context, page, playwright }, testInfo) => {
  check(process.env.INT_BROWSER_APPROVED === "true", "INT-W01 browser approval required");
  const account = suffix => ({ email: "int-w01-" + randomUUID() + "@example.test", password: randomBytes(24).toString("hex"), name: "合成整合成員 " + suffix, id: null });
  const owner = account("一");
  const other = account("二");
  const childName = "INT 合成孩子 " + randomUUID().slice(0, 8);
  let requests = 0, blockedRequests = 0, capReached = false, confirmedAccounts = 0;
  let child = null, childDeleted = false, cleanupFailure = null, lost = false, submissions = 0, originalOpId = null;
  let originalLookup = false;
  let finishSubmission;
  const submissionFinished = new Promise(resolve => { finishSubmission = resolve; });
  const count = cleanup => {
    check(requests + 1 <= (cleanup ? httpCap : httpCap - cleanupReserve), "INT-W01 HTTP cap reached");
    requests += 1;
  };
  const allowed = value => {
    const url = new URL(value);
    return url.origin === api || url.origin === web || url.protocol === "data:" || url.protocol === "blob:";
  };

  await context.route("**/*", async route => {
    const request = route.request();
    if (!allowed(request.url())) { blockedRequests += 1; await route.abort("blockedbyclient"); return; }
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol)) {
      try { count(false); } catch { capReached = true; await route.abort("blockedbyclient"); return; }
    }
    if (url.origin === api && !/^\/api\/(?:auth\/(?:get-session|sign-up\/email|sign-in\/email|sign-out)|children(?:\/[A-Za-z0-9_-]+\/records)?|online\/(?:context|submit|operations\/[a-f0-9-]+))$/u.test(url.pathname)) {
      blockedRequests += 1; await route.abort("blockedbyclient"); return;
    }
    if (url.origin === api && url.pathname === "/api/online/operations/" + originalOpId) originalLookup = true;
    if (url.origin !== api || url.pathname !== "/api/online/submit") { await route.continue(); return; }
    const body = request.postDataJSON();
    if (body.path !== "/api/children") { await route.continue(); return; }
    submissions += 1;
    if (submissions !== 1) { finishSubmission("Duplicate child submission attempted"); await route.abort("blockedbyclient"); return; }
    originalOpId = body.operation.opId;
    try {
      const response = await route.fetch({ maxRetries: 0, maxRedirects: 0, timeout: 10000 });
      check(response.status() === 200, "Actual child write was not confirmed by the Server");
      const receipt = await response.json();
      // Retain only this run's resource identity for cleanup, before assertions.
      if (receipt.result?.child?.displayName === childName) child = receipt.result.child;
      check(receipt.state === "confirmed" && receipt.operation?.opId === originalOpId && child?.id, "Actual original child receipt was invalid");
      lost = true;
      await route.abort("failed");
      finishSubmission(null);
    } catch {
      await route.abort("failed");
      finishSubmission("Actual child response injection failed");
    }
  });
  await context.routeWebSocket("**/*", socket => {
    const url = new URL(socket.url());
    if (url.protocol !== "ws:" || url.hostname !== "localhost" || url.port !== "8181") {
      blockedRequests += 1; socket.close({ code: 1008, reason: "External network blocked" }); return;
    }
    try { count(false); } catch { capReached = true; socket.close({ code: 1008, reason: "HTTP cap reached" }); return; }
    socket.connectToServer();
  });

  const fillCredentials = async (person, signup) => {
    // Do not propagate Playwright fill logs containing runtime credentials.
    try {
      if (signup) await page.getByLabel("稱呼", { exact: true }).fill(person.name);
      await page.getByLabel("電郵地址", { exact: true }).fill(person.email);
      await page.getByLabel("密碼", { exact: true }).fill(person.password);
    } catch { throw new Error("Synthetic credential input failed"); }
  };
  const authenticate = async (person, signup) => {
    if (signup) await page.getByRole("tab", { name: "註冊帳戶", exact: true }).click();
    await fillCredentials(person, signup);
    const responsePromise = page.waitForResponse(response => response.url() === api + "/api/auth/" + (signup ? "sign-up/email" : "sign-in/email") && response.request().method() === "POST");
    await page.getByRole("button", { name: signup ? "建立帳戶" : "登入", exact: true }).click();
    const response = await responsePromise;
    check(response.status() === 200, "Synthetic UI authentication was not confirmed");
    if (signup) {
      const signed = await response.json();
      check(typeof signed.user?.id === "string", "Synthetic signup identity unavailable");
      person.id = signed.user.id; confirmedAccounts += 1;
    }
    await page.getByRole("button", { name: "開始使用引導", exact: true }).click();
    await expect(page.getByRole("heading", { name: "你的孩子", exact: true })).toBeVisible();
    await expect(page.getByText("目前沒有可存取的孩子；可以先建立第一位孩子。", { exact: true })).toBeVisible();
  };
  const logout = async () => {
    await page.getByRole("button", { name: "登出", exact: true }).click();
    await expect(page.getByRole("button", { name: "登入", exact: true })).toBeVisible();
  };

  try {
    await page.goto(web + "/login");
    await authenticate(other, true);
    await logout();
    await authenticate(owner, true);
    await page.getByLabel("孩子稱呼", { exact: true }).fill(childName);
    await page.getByRole("button", { name: "建立孩子", exact: true }).click();
    const injectionFailure = await submissionFinished;
    check(!injectionFailure && lost && child && originalOpId, injectionFailure ?? "Original child write response was not lost");
    await expect(page.getByText("尚未確認保存，結果未知。請先重新讀取；系統會查核原操作，再讓你重試同一項提交。", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "建立孩子", exact: true })).toBeDisabled();
    const childrenRead = page.waitForResponse(response => response.url() === api + "/api/children" && response.request().method() === "GET");
    await page.getByRole("button", { name: "查核原建立操作", exact: true }).click();
    const recovered = await childrenRead;
    check(recovered.status() === 200, "Recovered child read failed");
    const recoveredChildren = (await recovered.json()).children;
    check(Array.isArray(recoveredChildren) && recoveredChildren.length === 1 && recoveredChildren[0].id === child.id, "Original operation did not recover exactly one child");
    await expect(page.getByText("Server 已確認原來的建立操作；以下顯示目前仍可存取的孩子。", { exact: true })).toBeVisible();
    const childButton = page.getByRole("button", { name: childName + "（目前孩子）", exact: true });
    await expect(childButton).toBeVisible();
    check(submissions === 1 && originalLookup, "Recovery did not look up the original opId without another write");
    await page.reload();
    await expect(childButton).toBeVisible();
    await expect(childButton).toHaveCount(1);
    await logout();
    await authenticate(other, false);
    await expect(page.getByRole("button", { name: childName + "（目前孩子）", exact: true })).toHaveCount(0);
    await expect(page.getByText(childName, { exact: false })).toHaveCount(0);
    check(!capReached && blockedRequests === 0 && submissions === 1, "Unexpected network, HTTP cap or duplicate child write");
  } finally {
    let cleanup;
    try {
      if (child && owner.id) {
        cleanup = await playwright.request.newContext({ baseURL: api, timeout: 10000 });
        const request = async (path, body) => {
          count(true);
          const response = await cleanup.post("/api" + path, { data: body, maxRetries: 0, maxRedirects: 0,
            headers: { origin: api, ...(path.startsWith("/auth/") ? {} : { "x-expected-user-id": owner.id }) } });
          check(response.status() === 200, "Own-child cleanup API response was not confirmed");
          return response.json();
        };
        // Logout revoked the original session; authenticate only to remove our child.
        const signed = await request("/auth/sign-in/email", { email: owner.email, password: owner.password });
        check(signed.user?.id === owner.id, "Own-child cleanup identity mismatch");
        const command = { path: "/api/children/" + child.id + "/delete", payload: { confirmChildId: child.id } };
        const operationContext = await request("/online/context", command);
        const receipt = await request("/online/submit", { ...command, operation: { ...operationContext, deviceId: randomUUID(), opId: randomUUID() } });
        check(receipt.state === "confirmed" && receipt.result?.deleted === true && receipt.result?.childId === child.id, "Own-child cleanup receipt was invalid");
        childDeleted = true;
      }
    } catch { cleanupFailure = "Own-child cleanup failed; resource retained for review"; }
    finally {
      await cleanup?.dispose();
      await testInfo.attach("int-foundation-boundary-metadata", { contentType: "application/json", body: Buffer.from(JSON.stringify({
        requestAttempts: requests, httpCap, cleanupReserve, confirmedAccounts, childId: child?.id ?? null,
        childDeleted, originalOpId, childSubmissions: submissions, originalLookup, responseLost: lost,
        blockedRequests, capReached, cleanupFailure,
      })) });
    }
    check(cleanupFailure === null, cleanupFailure ?? "Own-child cleanup failure");
  }
});

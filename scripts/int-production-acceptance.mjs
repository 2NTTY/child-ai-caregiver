import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const origin = "https://ex-machina.eu.org";
const httpCap = 160, cleanupReserve = 6, totalTimeoutMs = 300000;
const localDir = "C:/Users/2NTTY/.codex/int-w07-local";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const check = (condition, code) => { if (!condition) fail(code); };
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value);

let runnerStage = "preflight";
async function main() {
  // These gates are set only after the primary reviews the deployed revision and budget.
  check(process.env.INT_W07_DEPLOYED_READY === "true", "deployed_ready_required");
  check(process.env.INT_W07_ACCEPTANCE_APPROVED === "true", "bounded_acceptance_approval_required");
  const deployedRevision = process.env.INT_W07_DEPLOYED_REVISION;
  const budgetUsd = Number(process.env.INT_W07_MODEL_BUDGET_USD);
  check(/^[a-f0-9]{7,40}$/u.test(deployedRevision ?? ""), "deployed_revision_required");
  check(Number.isFinite(budgetUsd) && budgetUsd > 0, "explicit_model_budget_required");
  check(process.platform === "win32", "protected_windows_retention_required");

  const dependencyRoot = process.env.INT_W07_PLAYWRIGHT_ROOT
    ?? resolve(root, "../../int-w06-documents-reports/孩子ai护工");
  const require = createRequire(join(dependencyRoot, "package.json"));
  const { chromium, expect } = require("@playwright/test");
  check(require("playwright/package.json").version === "1.63.0", "reviewed_playwright_version_required");
  const chromiumExecutable = "C:/Users/2NTTY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe";
  check(existsSync(chromiumExecutable), "chromium_headless_executable_missing");
  const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

  // Protect retention before creating any server resource. Credentials never reach stdout.
  mkdirSync(localDir, { recursive: true });
  check(realpathSync(localDir).toLowerCase() === resolve(localDir).toLowerCase(), "retention_path_mismatch");
  const aclCommand =
    "$ErrorActionPreference = 'Stop'; try { " +
    "$acceptancePath = $env:INT_W07_RETENTION_PATH; " +
    "$acceptanceSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User; " +
    "$acceptanceAcl = Get-Acl -LiteralPath $acceptancePath; " +
    "$acceptanceAcl.SetAccessRuleProtection($true, $false); " +
    "foreach ($acceptanceOldRule in @($acceptanceAcl.Access)) { $acceptanceAcl.RemoveAccessRuleSpecific($acceptanceOldRule) }; " +
    "$acceptanceRule = New-Object System.Security.AccessControl.FileSystemAccessRule($acceptanceSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'); " +
    "$acceptanceAcl.AddAccessRule($acceptanceRule); " +
    "Set-Acl -LiteralPath $acceptancePath -AclObject $acceptanceAcl; " +
    "$acceptanceCheck = Get-Acl -LiteralPath $acceptancePath; " +
    "if (-not $acceptanceCheck.AreAccessRulesProtected -or $acceptanceCheck.Access.Count -ne 1 -or $acceptanceCheck.Access[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $acceptanceSid.Value) { throw 'ACL verification failed' }; " +
    "[pscustomobject]@{ok=$true} | ConvertTo-Json -Compress " +
    "} catch { [pscustomobject]@{ok=$false;errorClass=$_.Exception.GetType().Name;errorId=$_.FullyQualifiedErrorId} | ConvertTo-Json -Compress; exit 1 }";
  runnerStage = "retention_acl";
  try {
    const aclOutput = execFileSync("C:/Users/2NTTY/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", aclCommand],
      { env: { ...process.env, INT_W07_RETENTION_PATH: localDir }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    check(JSON.parse(aclOutput).ok === true, "retention_acl_not_confirmed");
  } catch (error) {
    let diagnostic;
    try { diagnostic = JSON.parse(String(error.stdout)); } catch {}
    const errorClass = /^[A-Za-z][A-Za-z0-9]+$/u.test(diagnostic?.errorClass ?? "") ? diagnostic.errorClass : "NativeAclFailure";
    fail("retention_acl_" + errorClass);
  }

  runnerStage = "fixture_preparation";
  const runKey = randomUUID(), suffix = runKey.slice(0, 8);
  const recoveryPath = join(localDir, "int-w07-" + runKey + "-recovery.json");
  const evidencePath = join(localDir, "int-w07-" + runKey + "-evidence.json");
  const owner = { email: "int-w07-" + runKey + "@example.test", password: randomBytes(24).toString("hex"), id: null };
  const childName = "INT-W07 合成孩子 " + suffix;
  const recordStatement = "今天替孩子換了藍色床單。INT-W07 合成記錄 " + suffix;
  const userText = "這是合成驗收資料。請按本人已授權的日常備註類別，把「" + recordStatement + "」保存為一項普通照護記錄，只確認保存結果。";
  let phase = "startup", child = null, recordId = null, realRunId = null, counts = null;
  let requests = 0, blockedRequests = 0, replyAttempts = 0, messageWrites = 0, policyPosts = 0, pageErrors = 0;
  let childDeleted = false, flowSucceeded = false, retained = false;
  let receiptConfirmed = false, careConfirmed = false, homeChildConfirmed = false;
  let returnedCareConfirmed = false, historyConfirmed = false, logoutConfirmed = false;
  let browser, browserVersion = null, context, page, timer, failure = null;
  const operationIds = [], completedResponseReads = new Map();
  let firstBoundaryFailure = null, rejectBoundary;
  const boundaryFailure = new Promise((_, reject) => { rejectBoundary = reject; });
  void boundaryFailure.catch(() => {});
  const stop = code => {
    if (!firstBoundaryFailure) { firstBoundaryFailure = code; const error = new Error(code); error.code = code; rejectBoundary(error); }
  };
  const boundary = () => check(!firstBoundaryFailure && !pageErrors && !blockedRequests && replyAttempts <= 1, firstBoundaryFailure ?? "browser_boundary_failed");
  const count = cleanup => {
    if (requests >= (cleanup ? httpCap : httpCap - cleanupReserve)) { stop("http_cap_reached"); fail("http_cap_reached"); }
    requests++;
  };
  const retain = () => {
    writeFileSync(recoveryPath, JSON.stringify({ origin, runKey, owner, childId: child?.id ?? null,
      operationIds, realRunId, recordId, phase }, null, 2), { flag: "w", mode: 0o600 });
    retained = true;
  };
  const allowedBrowserApi = (url, method, body) => {
    if (method === "GET") {
      if (!url.pathname.startsWith("/api/children/")) return url.pathname.startsWith("/api/");
      return !!child && url.pathname.startsWith("/api/children/" + child.id + "/");
    }
    if (!child || method !== "POST") return false;
    const prefix = "/api/children/" + child.id;
    if (url.pathname === "/api/auth/sign-out") return phase === "logout";
    if (url.pathname === prefix + "/care/search") return true;
    if (url.pathname === "/api/online/context" || url.pathname === "/api/online/submit") {
      if (phase !== "one_agent_run" || body?.path !== prefix + "/messages" || body?.payload?.text !== userText) return false;
      if (url.pathname.endsWith("/submit")) return ++messageWrites === 1;
      return true;
    }
    if (new RegExp("^" + prefix + "/messages/[a-f0-9-]+/reply$", "u").test(url.pathname)) {
      if (phase !== "one_agent_run") return false;
      return ++replyAttempts === 1;
    }
    return false;
  };
  const request = async (path, body, cleanup = false) => {
    boundary();
    const ownPrefix = child ? "/children/" + child.id : null;
    check(["/auth/sign-up/email", "/auth/sign-in/email", "/auth/sign-out", "/online/context", "/online/submit"].includes(path)
      || ownPrefix && path === ownPrefix + "/agent/policy", "direct_api_path_not_authorized");
    if (path === "/auth/sign-up/email") check(phase === "signup" && !owner.id, "signup_scope_mismatch");
    if (path === "/auth/sign-in/email" || cleanup) check(phase === "cleanup" && flowSucceeded, "cleanup_scope_mismatch");
    count(cleanup);
    let response;
    try {
      response = await context.request.fetch(origin + "/api" + path, { method: body === undefined ? "GET" : "POST",
        timeout: 10000, maxRetries: 0, maxRedirects: 0,
        headers: { origin, ...(owner.id ? { "x-expected-user-id": owner.id } : {}) },
        ...(body === undefined ? {} : { data: body }) });
    } catch { fail("direct_api_transport_failed"); }
    check(response.status() === 200, "direct_api_status_" + response.status());
    try { return await response.json(); } catch { fail("direct_api_json_invalid"); }
  };
  const writeChild = async (path, payload, cleanup = false) => {
    check(path === "/children" && phase === "create_child" && !child
      || cleanup && child && path === "/children/" + child.id + "/delete" && payload.confirmChildId === child.id, "own_child_write_scope_mismatch");
    const command = { path: "/api" + path, payload }, basis = await request("/online/context", command, cleanup);
    const operation = { ...basis, deviceId: randomUUID(), opId: randomUUID() };
    operationIds.push(operation.opId); retain();
    const receipt = await request("/online/submit", { ...command, operation }, cleanup);
    check(receipt.state === "confirmed" && receipt.result, "own_child_operation_unconfirmed");
    return receipt.result;
  };
  const responseAt = (path, method = "GET", timeout = 15000) => {
    const pending = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api" + path && response.request().method() === method;
    }, { timeout });
    void pending.catch(() => {});
    return pending;
  };
  const readBody = async response => {
    check(response.status() === 200, "browser_api_status_" + response.status());
    const url = new URL(response.url());
    if (url.origin === origin && url.pathname.startsWith("/api/")) {
      let body;
      try { body = await response.json(); } catch { fail("browser_api_json_invalid"); }
      return body;
    }
    fail("browser_response_origin_mismatch");
  };
  const flow = async () => {
    browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable, timeout: 20000 });
    browserVersion = browser.version();
    context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: "block" });
    context.setDefaultTimeout(15000);
    await context.route("**/*", async route => {
      const outgoing = route.request(), url = new URL(outgoing.url());
      if (["data:", "blob:"].includes(url.protocol)) { await route.continue(); return; }
      try { count(false); } catch { await route.abort("blockedbyclient"); return; }
      let body = null;
      if (outgoing.method() === "POST") try { body = outgoing.postDataJSON(); } catch {}
      if (url.origin !== origin || firstBoundaryFailure
        || url.pathname.startsWith("/api/") && !allowedBrowserApi(url, outgoing.method(), body)
        || !url.pathname.startsWith("/api/") && outgoing.method() !== "GET") {
        blockedRequests++; stop("unexpected_browser_request"); await route.abort("blockedbyclient"); return;
      }
      await route.continue();
    });
    await context.routeWebSocket("**/*", socket => {
      blockedRequests++; stop("unexpected_websocket"); socket.close({ code: 1008, reason: "Acceptance boundary" });
    });
    page = await context.newPage();
    page.on("pageerror", () => { pageErrors++; stop("browser_page_error"); });
    page.on("response", response => {
      const url = new URL(response.url());
      if (url.origin !== origin || !url.pathname.startsWith("/api/")) return;
      if (response.status() >= 400) { stop("browser_api_status_" + response.status()); return; }
      const key = response.request().method() + " " + url.pathname + url.search;
      const read = response.json().catch(() => null);
      completedResponseReads.set(key, read);
    });

    phase = "signup";
    retain();
    const signed = await request("/auth/sign-up/email", { email: owner.email, password: owner.password, name: "INT-W07 合成成員" });
    check(typeof signed.user?.id === "string", "synthetic_identity_missing"); owner.id = signed.user.id; retain();
    phase = "create_child";
    child = (await writeChild("/children", { displayName: childName })).child;
    check(uuid(child?.id) && child.displayName === childName, "synthetic_child_invalid"); retain();
    phase = "ordinary_preauthorization";
    const policyPath = "/children/" + child.id + "/agent/policy";
    const initial = (await request(policyPath)).policy;
    check(initial?.version === 0 && initial.recordKinds.length === 0 && !initial.allowSelfTasks && !initial.allowPrivateNotes, "new_policy_not_disabled");
    const grant = { operationId: randomUUID(), expectedVersion: 0, recordKinds: ["note"], allowPrivateNotes: false,
      allowRecordCorrections: false, allowSelfTasks: false, reminderConsentVersion: null, reminderBindings: [], confirm: true, confirmShared: true };
    operationIds.push(grant.operationId); retain(); policyPosts++;
    const policy = (await request(policyPath, grant)).policy;
    check(policy?.version === 1 && policy.effective && policy.recordKinds.join() === "note"
      && !policy.allowPrivateNotes && !policy.allowRecordCorrections && !policy.allowSelfTasks
      && policy.reminderConsentVersion === null && policy.reminderBindings.length === 0, "ordinary_only_policy_failed");

    phase = "chat_mount";
    await page.goto(origin + "/chat", { waitUntil: "domcontentloaded", timeout: 30000 });
    await expect(page.getByText(childName, { exact: true }).first()).toBeVisible();
    const composer = page.getByLabel("撰寫對話問題", { exact: true });
    await expect(composer).toBeVisible(); boundary();
    phase = "one_agent_run";
    await composer.fill(userText);
    const replyResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/reply")
      && response.request().method() === "POST", { timeout: 100000 });
    void replyResponse.catch(() => {});
    await expect(page.getByRole("button", { name: "送出", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "送出", exact: true }).click();
    const reply = (await readBody(await replyResponse)).message;
    check(uuid(reply?.agentRunId) && reply.role === "model" && reply.childId === child.id && reply.text?.trim(), "saved_agent_reply_missing");
    realRunId = reply.agentRunId; retain(); boundary();

    phase = "receipt";
    const runRead = responseAt("/children/" + child.id + "/agent/runs/" + realRunId);
    await page.getByRole("button", { name: "查看這則回覆的來源與候選", exact: true }).click();
    const run = (await readBody(await runRead)).result;
    check(run?.runId === realRunId && run.status === "completed" && run.text === reply.text && run.countsKnown, "exact_completed_run_missing");
    counts = run.counts; retain();
    check(Number.isInteger(counts?.modelCalls) && counts.modelCalls >= 1 && counts.modelCalls <= 4 && counts.queryEmbeddings === 0, "generation_or_embedding_bound_failed");
    await expect(page.getByRole("heading", { name: "本次操作收據", exact: true })).toBeVisible();
    await expect(page.getByText("保存照護記錄 · 已保存", { exact: true })).toBeVisible();
    const receiptKey = "GET /api/children/" + child.id + "/agent/actions?runId=" + realRunId;
    const receiptRead = completedResponseReads.get(receiptKey);
    check(receiptRead, "mounted_receipt_response_missing");
    const receipts = (await receiptRead)?.receipts;
    check(Array.isArray(receipts) && receipts.length === 1 && receipts[0].kind === "save_record"
      && receipts[0].runId === realRunId && receipts[0].state === "saved"
      && receipts[0].resource.kind === "care_record" && receipts[0].resource.version === 1
      && receipts[0].notification === "not_authorized" && receipts[0].channels.length === 0, "single_receipt_boundary_failed");
    recordId = receipts[0].resource.id; check(uuid(recordId), "receipt_record_id_invalid"); retain();
    await expect(page.getByText("照護記錄：" + recordId + " · 版本 1", { exact: true })).toBeVisible();
    receiptConfirmed = true; boundary();

    phase = "care";
    const careRead = responseAt("/children/" + child.id + "/care/search", "POST");
    await page.getByRole("link", { name: "記錄與核對", exact: true }).first().click();
    await expect(page).toHaveURL(origin + "/care");
    const records = (await readBody(await careRead)).records;
    check(Array.isArray(records) && records.length === 1 && records[0].id === recordId && records[0].childId === child.id
      && records[0].version === 1 && records[0].details?.kind === "note"
      && records[0].authorUserId === owner.id && records[0].confirmationBasis === "preauthorized_user_statement"
      && records[0].text.includes("藍色床單") && records[0].text.includes(suffix), "receipt_linked_record_failed");
    const actualText = records[0].text;
    await expect(page.getByRole("heading", { name: "記錄與核對", exact: true })).toBeVisible();
    await expect(page.getByText(actualText, { exact: true }).first()).toBeVisible(); careConfirmed = true; boundary();
    phase = "home";
    await page.getByRole("link", { name: "今日", exact: true }).first().click();
    await expect(page).toHaveURL(origin + "/");
    await expect(page.getByText(childName, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "核對照顧記錄", exact: true })).toBeVisible(); homeChildConfirmed = true;
    phase = "return_care";
    await page.getByRole("button", { name: "核對照顧記錄", exact: true }).click();
    await expect(page).toHaveURL(origin + "/care");
    await expect(page.getByText(actualText, { exact: true }).first()).toBeVisible(); returnedCareConfirmed = true; boundary();

    phase = "reload_history";
    await page.getByRole("link", { name: "與 Agent 對話", exact: true }).first().click();
    await expect(page).toHaveURL(origin + "/chat");
    const historyRead = responseAt("/children/" + child.id + "/messages");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    const history = (await readBody(await historyRead)).messages;
    check(Array.isArray(history) && history.length === 2
      && history.some(item => item.role === "user" && item.id === reply.inReplyTo && item.text === userText && item.authorUserId === owner.id)
      && history.some(item => item.role === "model" && item.id === reply.id && item.agentRunId === realRunId && item.text === reply.text), "reload_history_mismatch");
    await expect(page.getByTestId("chat-timeline").getByText(userText, { exact: true })).toBeVisible();
    await expect(page.getByTestId("chat-timeline").getByText(reply.text, { exact: true })).toBeVisible(); historyConfirmed = true; boundary();

    phase = "logout";
    await page.getByRole("link", { name: "設定", exact: true }).first().click();
    await expect(page).toHaveURL(origin + "/settings");
    const signoutRead = responseAt("/auth/sign-out", "POST");
    await page.getByRole("button", { name: "登出本人帳戶", exact: true }).click();
    check((await signoutRead).status() === 200, "logout_response_failed");
    await expect(page).toHaveURL(origin + "/login");
    await expect(page.getByLabel("電郵地址", { exact: true })).toBeVisible();
    await expect(page.getByText(childName, { exact: false })).toHaveCount(0);
    await expect(page.getByText(userText, { exact: true })).toHaveCount(0);
    await expect(page.getByText(actualText, { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("chat-timeline")).toHaveCount(0); logoutConfirmed = true;
    check(replyAttempts === 1 && messageWrites === 1 && policyPosts === 1, "one_run_boundary_mismatch");
    boundary(); flowSucceeded = true;

    phase = "cleanup";
    await page.close(); page = null;
    const signin = await request("/auth/sign-in/email", { email: owner.email, password: owner.password }, true);
    check(signin.user?.id === owner.id, "cleanup_identity_mismatch");
    const deleted = await writeChild("/children/" + child.id + "/delete", { confirmChildId: child.id }, true);
    check(deleted.deleted === true && deleted.childId === child.id, "own_child_cleanup_unconfirmed"); childDeleted = true;
    await request("/auth/sign-out", {}, true);
    phase = "complete";
  };

  timer = setTimeout(() => stop("total_time_limit_reached"), totalTimeoutMs);
  try { await Promise.race([flow(), boundaryFailure]); }
  catch (error) { failure = { phase, code: typeof error.code === "string" ? error.code : "acceptance_assertion_failed" }; }
  finally {
    clearTimeout(timer);
    if (failure && retained) retain();
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    const evidence = { origin, sourceRevision, deployedRevision, runKey, passed: !failure && childDeleted,
      chromiumExecutable, browserVersion, priorPreflightFailures: [{ phase: "chromium_check", code: "full_chromium_executable_missing", serviceCalls: 0 }, { phase: "retention_acl", code: "native_acl_setup_unconfirmed", serviceCalls: 0 }, { phase: "retention_acl", code: "retention_acl_CommandNotFoundException", serviceCalls: 0 }],
      limits: { httpCap, cleanupReserve, totalTimeoutMs, agentRuns: 1, generationCalls: 4, expectedQueryEmbeddings: 0, approvedBudgetUsd: budgetUsd },
      requestAttempts: requests, blockedRequests, pageErrors, replyAttempts, messageWrites, policyPosts,
      userId: owner.id, childId: child?.id ?? null, realRunId, recordId, counts, operationIds,
      receiptConfirmed, careConfirmed, homeChildConfirmed, returnedCareConfirmed, historyConfirmed, logoutConfirmed,
      homeRecordBodyDisplayed: false, sharedOwnerEvidence: "source review and existing INT-W03 evidence",
      childDeleted, syntheticAccountPreserved: !!owner.id, fixtureRetained: !!owner.id && !childDeleted, failure,
      externalNotificationsAuthorized: false, traceSaved: false, screenshotSaved: false };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), { flag: "w", mode: 0o600 });
    if (!failure && childDeleted) { rmSync(recoveryPath); retained = false; }
    console.log(JSON.stringify({ ...evidence, evidencePath, ...(retained ? { protectedRecoveryRetained: true } : {}) }));
    if (failure || !childDeleted) process.exitCode = 1;
  }
}

main().catch(error => {
  console.log(JSON.stringify({ passed: false, phase: runnerStage, errorClass: error.constructor?.name ?? "Error",
    code: typeof error.code === "string" ? error.code : "runner_failure", resultState: "unknown" }));
  process.exitCode = 1;
});

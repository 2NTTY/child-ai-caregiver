import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { isAbsolute, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

// Run only after local PostgreSQL/Chromium Web acceptance has been approved.
// No browser download, database reset, screenshots, traces, or saved credentials.
const repositoryDirectory = fileURLToPath(new URL("../", import.meta.url));
const serverPort = 3101;
const webPort = 8181;
const serverOrigin = "http://localhost:" + serverPort;
const webOrigin = "http://localhost:" + webPort;
const requestTimeoutMs = 5_000;
const actionTimeoutMs = 10_000;
const totalTimeoutMs = 260_000;
// Some Windows antivirus installations inject this script into every HTTP page.
// It stays blocked; its presence is not an application dependency or a test failure.
const blockedEnvironmentOrigins = new Set(["http://me.kis.v2.scr.kaspersky-labs.com"]);
const ownedProcesses = new Set();
const interruption = new AbortController();
let configuration;
let serverProcess;
let webProcess;
let browser;
let browserClosing;
let currentCheck = "PREFLIGHT";
let passedChecks = 0;
let databaseTouched = false;
let nonLocalRequest = false;

const labels = {
  email: "電郵",
  password: "密碼",
  accountName: "你的稱呼",
  signUpMode: "註冊帳號",
  signUp: "建立帳號並登入",
  signInMode: "使用現有帳號",
  signIn: "登入",
  childName: "新孩子的稱呼",
  createChild: "確認建立孩子",
  recordText: /^為.+輸入文字記錄$/u,
  reviewRecord: "檢視並確認保存",
  confirmRecord: "確認保存到 Server",
  reloadRecords: "重新讀取記錄",
  signOut: "登出",
  discardAndSignOut: "確認捨棄未提交內容並登出",
};

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
  if (interruption.signal.aborted) {
    throw new VerificationFailure(interruption.signal.reason === "TOTAL_TIMEOUT" ? "TOTAL_TIMEOUT" : "INTERRUPTED");
  }
}

async function bounded(promise, timeoutMs, code) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new VerificationFailure(code)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function readConfiguration() {
  requireResult(Number(process.versions.node.split(".")[0]) === 24, "NODE_24_REQUIRED");
  const databaseUrl = process.env.TEST_DATABASE_URL;
  requireResult(typeof databaseUrl === "string" && databaseUrl.length > 0, "TEST_DATABASE_URL_REQUIRED");
  // Check raw delimiters too: URL.search/hash hide empty '?' and '#' suffixes.
  requireResult(/^postgres(?:ql)?:\/\//iu.test(databaseUrl)
    && !/[\s\u0000-\u001f\u007f?#\\]/u.test(databaseUrl), "LOCAL_TEST_DATABASE_REQUIRED");
  let database;
  let databaseName;
  try {
    database = new URL(databaseUrl);
    databaseName = decodeURIComponent(database.pathname.slice(1));
  } catch {
    throw new VerificationFailure("TEST_DATABASE_URL_INVALID");
  }
  requireResult(["postgres:", "postgresql:"].includes(database.protocol)
    && ["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)
    && database.username.length > 0
    && /^yuban_s06_test[A-Za-z0-9_]*$/u.test(databaseName)
    && databaseName.length <= 63 && !database.search && !database.hash
    && (!database.port || Number(database.port) > 0), "LOCAL_TEST_DATABASE_REQUIRED");

  const inheritedKeys = new Set([
    "PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC",
    "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "APPDATA",
  ]);
  const baseEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => inheritedKeys.has(name.toUpperCase())),
  );
  const executablePath = process.env.BROWSER_EXECUTABLE_PATH;
  const channel = process.env.BROWSER_CHANNEL ?? "msedge";
  requireResult(!executablePath || isAbsolute(executablePath), "BROWSER_EXECUTABLE_PATH_INVALID");
  requireResult(executablePath || ["msedge", "chrome", "chromium"].includes(channel), "BROWSER_CHANNEL_INVALID");
  return {
    baseEnvironment,
    executablePath,
    channel,
    serverEnvironment: {
      ...baseEnvironment,
      DATABASE_URL: databaseUrl,
      STORAGE_KEY_FILE: process.env.STORAGE_KEY_FILE,
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      SERVER_ORIGIN: serverOrigin,
      WEB_ORIGIN: webOrigin,
      HOST: "127.0.0.1",
      PORT: String(serverPort),
      NODE_ENV: "test",
    },
    webEnvironment: {
      ...baseEnvironment,
      EXPO_PUBLIC_API_BASE_URL: serverOrigin + "/api",
      SERVER_ORIGIN: serverOrigin,
      WEB_ORIGIN: webOrigin,
      HOST: "127.0.0.1",
      NODE_ENV: "development",
      CI: "1",
      BROWSER: "none",
      EXPO_NO_DOTENV: "1",
      EXPO_OFFLINE: "1",
      EXPO_NO_TELEMETRY: "1",
      EXPO_NO_TELEMETRY_DETACH: "1",
    },
  };
}

async function requireFreePort(port) {
  // Check both localhost address families before any migration or launch.
  for (const host of ["127.0.0.1", "::1"]) {
    checkInterruption();
    await new Promise((resolvePort, rejectPort) => {
      const probe = createServer();
      probe.once("error", (error) => {
        if (host === "::1" && ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code)) resolvePort();
        else rejectPort(new VerificationFailure("TEST_PORT_UNAVAILABLE"));
      });
      probe.listen({ host, port, exclusive: true }, () => {
        probe.close((error) => error
          ? rejectPort(new VerificationFailure("TEST_PORT_UNAVAILABLE")) : resolvePort());
      });
    });
  }
}

function spawnOwned(relativePath, args, environment) {
  checkInterruption();
  const child = spawn(process.execPath, [resolve(repositoryDirectory, relativePath), ...args], {
    cwd: repositoryDirectory,
    env: environment,
    windowsHide: true,
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
  owned.stopping ??= (async () => {
    // Only the ChildProcess created above is targeted; never kill by port/name.
    owned.child.kill("SIGTERM");
    if (await waitForExit(owned, 4_000, false)) return;
    owned.child.kill("SIGKILL");
    requireResult(await waitForExit(owned, 4_000, false), "OWNED_PROCESS_STOP_FAILED");
  })();
  return owned.stopping;
}

async function closeBrowser() {
  if (!browser) return;
  browserClosing ??= browser.close();
  await bounded(browserClosing, 8_000, "OWNED_BROWSER_STOP_FAILED");
}

async function readReadiness(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;
  try {
    response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.any([controller.signal, interruption.signal]),
    });
    if (response.status !== 200) return null;
    const text = await response.text();
    return text.length <= 4_096 ? text : null;
  } catch {
    checkInterruption();
    return null;
  } finally {
    // Abort includes body consumption; discarded responses cannot hold a socket.
    controller.abort();
    await response?.body?.cancel().catch(() => {});
    clearTimeout(timeout);
  }
}

async function waitUntilReady(owned, url, accepts, timeoutMs, code) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    checkInterruption();
    requireResult(owned.result === undefined, code);
    const value = await readReadiness(url);
    if (value !== null && accepts(value)) return;
    await delay(200);
  }
  throw new VerificationFailure(code);
}

async function runCheck(name, action) {
  currentCheck = name;
  checkInterruption();
  requireResult(!nonLocalRequest, "NON_LOCAL_BROWSER_REQUEST_BLOCKED");
  console.log("[RUN] " + name);
  await action();
  checkInterruption();
  requireResult(!nonLocalRequest, "NON_LOCAL_BROWSER_REQUEST_BLOCKED");
  requireResult(!serverProcess || serverProcess.result === undefined, "SERVER_EXITED");
  requireResult(!webProcess || webProcess.result === undefined, "WEB_SERVER_EXITED");
  passedChecks += 1;
  console.log("[PASS] " + name);
}

async function eventually(predicate, code, timeoutMs = actionTimeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    checkInterruption();
    if (await predicate()) return;
    await delay(100);
  }
  throw new VerificationFailure(code);
}

const button = (page, name) => page.getByRole("button", { name, exact: true });
const field = (page, name) => page.getByLabel(name, { exact: true });
const recordPath = (child) => "/api/children/" + encodeURIComponent(child.id) + "/records";

async function observeResponse(page, method, path, action, expectedStatus = 200) {
  const [response] = await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === serverOrigin && url.pathname === path && response.request().method() === method;
    }, { timeout: actionTimeoutMs }),
    action(),
  ]);
  requireResult(response.status() === expectedStatus, "BROWSER_HTTP_STATUS_MISMATCH");
  // A response body that stalls fails the run; final cleanup closes its context.
  return await bounded(response.json(), requestTimeoutMs, "BROWSER_RESPONSE_BODY_TIMEOUT");
}

async function requireValue(page, name, expected, code) {
  await eventually(async () => await field(page, name).inputValue() === expected, code);
}

async function requireRecord(page, text) {
  // Locator text matching normalizes whitespace; textContent must preserve it.
  await eventually(async () => (await renderedText(page, text)).includes(text), "ORIGINAL_TEXT_NOT_DISPLAYED");
}

async function renderedText(page, text) {
  // A controlled textarea may also have textContent; it is not a saved record.
  return await page.getByText(text, { exact: true }).evaluateAll((elements) => elements
    .filter((element) => !["INPUT", "TEXTAREA"].includes(element.tagName) && element.getClientRects().length > 0)
    .map((element) => element.textContent));
}

async function requireNoPrivateData(page, privateValues) {
  const clear = await page.evaluate((values) => {
    const normalize = (text) => text.replace(/\s+/gu, " ").trim();
    const visibleText = normalize(document.body.innerText);
    const inputs = [...document.querySelectorAll("input, textarea")].map((input) => input.value);
    return values.every((value) => !visibleText.includes(normalize(value)) && !inputs.includes(value));
  }, privateValues);
  requireResult(clear, "PREVIOUS_ACCOUNT_DATA_VISIBLE");
}

async function authenticate(page, account, signUp) {
  const mode = button(page, signUp ? labels.signUpMode : labels.signInMode);
  if (await mode.isEnabled()) await mode.click();
  if (signUp) await field(page, labels.accountName).fill(account.name);
  await field(page, labels.email).fill(account.email);
  await field(page, labels.password).fill(account.password);
  const data = await observeResponse(page, "POST", signUp ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email",
    () => button(page, signUp ? labels.signUp : labels.signIn).click());
  requireResult(typeof data?.user?.id === "string" && data.user.id.length > 0, "AUTH_RESPONSE_INVALID");
  if (account.id) requireResult(data.user.id === account.id, "ACCOUNT_IDENTITY_MISMATCH");
  else account.id = data.user.id;
  await button(page, labels.signOut).waitFor({ state: "visible" });
  await eventually(() => button(page, labels.createChild).isEnabled(), "CHILD_LIST_NOT_READY");
}

async function createChild(page, displayName) {
  await field(page, labels.childName).fill(displayName);
  const data = await observeResponse(page, "POST", "/api/children", () => button(page, labels.createChild).click(), 201);
  requireResult(typeof data?.child?.id === "string" && data.child.displayName === displayName.trim(), "CHILD_RESPONSE_INVALID");
  await requireValue(page, labels.childName, "", "CHILD_FORM_NOT_CLEARED");
  await eventually(() => field(page, labels.recordText).isVisible(), "RECORD_FORM_NOT_READY");
  return data.child;
}

async function selectChild(page, child) {
  const escapedName = child.displayName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const selected = button(page, new RegExp("^目前：" + escapedName + "(?:（有未保存內容）)?$", "u"));
  const target = await selected.count() > 0
    ? button(page, labels.reloadRecords)
    : button(page, new RegExp("^" + escapedName + "(?:（有未保存內容）)?$", "u"));
  const data = await observeResponse(page, "GET", recordPath(child), () => target.click());
  requireResult(Array.isArray(data?.records) && data.records.every((record) => record.childId === child.id), "CHILD_RECORDS_MIXED");
  await eventually(() => button(page, labels.reviewRecord).isEnabled(), "RECORD_LIST_NOT_READY");
  return data.records;
}

async function saveRecord(page, child, account, text) {
  await field(page, labels.recordText).fill(text);
  await button(page, labels.reviewRecord).click();
  await requireRecord(page, text);
  const data = await observeResponse(page, "POST", recordPath(child), () => button(page, labels.confirmRecord).click(), 201);
  const record = data?.record;
  requireResult(record?.text === text && record.childId === child.id && record.authorUserId === account.id
    && typeof record.id === "string" && Number.isFinite(Date.parse(record.createdAt)), "SAVED_RECORD_MISMATCH");
  await requireValue(page, labels.recordText, "", "CONFIRMED_FORM_NOT_CLEARED");
  await requireRecord(page, text);
  await eventually(() => page.getByText(/Server 已確認保存/u).isVisible(), "SAVE_CONFIRMATION_MISSING");
  return record;
}

async function signOut(page, discard = false) {
  if (discard) {
    await button(page, labels.signOut).click();
    await button(page, labels.discardAndSignOut).waitFor({ state: "visible" });
  }
  await observeResponse(page, "POST", "/api/auth/sign-out", () => button(page, discard ? labels.discardAndSignOut : labels.signOut).click());
  await field(page, labels.email).waitFor({ state: "visible" });
}

async function verifyWeb() {
  let chromium;
  await runCheck("PREFLIGHT", async () => {
    configuration = readConfiguration();
    const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
    requireResult(!modulePath || isAbsolute(modulePath), "PLAYWRIGHT_MODULE_PATH_INVALID");
    // Prevent optional Playwright diagnostics from printing request bodies/args.
    delete process.env.DEBUG;
    delete process.env.PWDEBUG;
    try {
      ({ chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright"));
      if (configuration.executablePath) await access(configuration.executablePath);
    } catch {
      throw new VerificationFailure("PLAYWRIGHT_OR_BROWSER_UNAVAILABLE");
    }
    requireResult(chromium && typeof chromium.launch === "function", "PLAYWRIGHT_UNAVAILABLE");
    await requireFreePort(serverPort);
    await requireFreePort(webPort);
  });

  await runCheck("MIGRATIONS", async () => {
    databaseTouched = true;
    const migration = spawnOwned("server/migrate.ts", [], configuration.serverEnvironment);
    const result = await waitForExit(migration, 45_000);
    requireResult(result, "MIGRATION_TIMEOUT");
    requireResult(!result.spawnFailed && result.code === 0, "MIGRATION_FAILED");
  });
  await runCheck("ENCRYPTED_STORAGE_UPGRADE", async () => {
    const upgrade = spawnOwned("scripts/encrypt-storage.mjs", ["--server-stopped"], configuration.serverEnvironment);
    const result = await waitForExit(upgrade, 60_000);
    requireResult(result && !result.spawnFailed && result.code === 0, "ENCRYPTION_UPGRADE_FAILED");
  });
  await runCheck("LOCAL_SERVICES", async () => {
    await requireFreePort(serverPort);
    await requireFreePort(webPort);
    serverProcess = spawnOwned("server/index.ts", [], configuration.serverEnvironment);
    await waitUntilReady(serverProcess, "http://127.0.0.1:" + serverPort + "/api/health", (text) => {
      try { return JSON.parse(text).status === "ok"; } catch { return false; }
    }, 20_000, "SERVER_NOT_READY");
    // One Metro worker avoids leaving a separately spawned transform pool.
    webProcess = spawnOwned("node_modules/expo/bin/cli", [
      "start", "--web", "--localhost", "--port", String(webPort), "--max-workers", "1",
    ], configuration.webEnvironment);
    await waitUntilReady(webProcess, webOrigin + "/status", (text) => text.includes("packager-status:running"), 45_000, "WEB_SERVER_NOT_READY");
  });

  let context;
  let page;
  let recordPosts = 0;
  let childPosts = 0;
  await runCheck("BROWSER_START", async () => {
    browser = await chromium.launch({
      headless: true,
      ...(configuration.executablePath ? { executablePath: configuration.executablePath } : { channel: configuration.channel }),
      env: configuration.baseEnvironment,
      timeout: 15_000,
    });
    context = await browser.newContext({ locale: "zh-HK", serviceWorkers: "block" });
    context.setDefaultTimeout(actionTimeoutMs);
    context.setDefaultNavigationTimeout(60_000);
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if ([serverOrigin, webOrigin].includes(url.origin)) await route.continue();
      else {
        if (!blockedEnvironmentOrigins.has(url.origin)) nonLocalRequest = true;
        console.info("[INFO] Blocked browser origin: " + url.origin);
        await route.abort("blockedbyclient");
      }
    });
    await context.routeWebSocket("**/*", (socket) => {
      if (new URL(socket.url()).origin === webOrigin.replace("http:", "ws:")) socket.connectToServer();
      else {
        nonLocalRequest = true;
        console.info("[INFO] Blocked socket origin: " + new URL(socket.url()).origin);
        socket.close();
      }
    });
    context.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== serverOrigin || request.method() !== "POST") return;
      if (/^\/api\/children\/[^/]+\/records$/u.test(url.pathname)) recordPosts += 1;
      if (url.pathname === "/api/children") childPosts += 1;
    });
    page = await context.newPage();
    await page.goto(webOrigin, { waitUntil: "domcontentloaded" });
    await field(page, labels.email).waitFor({ state: "visible", timeout: 60_000 });
  });

  const runId = randomUUID();
  const accounts = ["a", "b"].map((suffix) => ({
    email: "s03-web-" + runId + "-" + suffix + "@example.test",
    password: randomBytes(24).toString("base64url"),
    name: "S03 synthetic account " + suffix.toUpperCase(),
    id: undefined,
  }));
  const [accountA, accountB] = accounts;
  const originalText = "  合成記錄：下午約三點飲咗半杯水\n孩子話有啲攰，未量體溫。  ";
  const offlineText = "  合成斷線草稿：傍晚食咗約半碗粥。  ";
  const firstDraft = "合成第一位孩子的未提交草稿";
  const secondText = "合成第二位孩子的獨立記錄";
  let firstChild;
  let secondChild;
  let firstRecord;

  await runCheck("SIGN_UP_AND_CREATE_CHILD", async () => {
    await authenticate(page, accountA, true);
    firstChild = await createChild(page, "  合成小晴  ");
  });
  await runCheck("CONFIRMED_ORIGINAL_TEXT", async () => {
    firstRecord = await saveRecord(page, firstChild, accountA, originalText);
  });
  await runCheck("CLOSE_AND_REOPEN_FROM_SERVER", async () => {
    await page.close();
    page = await context.newPage();
    const data = await observeResponse(page, "GET", recordPath(firstChild),
      () => page.goto(webOrigin, { waitUntil: "domcontentloaded" }));
    requireResult(data?.records?.length === 1 && data.records[0].id === firstRecord.id
      && data.records[0].text === originalText, "REOPEN_PERSISTENCE_MISMATCH");
    await requireRecord(page, originalText);
  });
  await runCheck("SIGN_OUT_AND_SIGN_IN_RESTORE", async () => {
    await signOut(page);
    await requireNoPrivateData(page, [accountA.name, accountA.email, firstChild.displayName, originalText]);
    await authenticate(page, accountA, false);
    await requireRecord(page, originalText);
  });
  await runCheck("OFFLINE_FORM_AND_NO_FALSE_SAVE", async () => {
    await field(page, labels.recordText).fill(offlineText);
    await field(page, labels.childName).fill("合成未提交孩子稱呼");
    const writesBefore = { records: recordPosts, children: childPosts };
    await context.setOffline(true);
    await eventually(() => button(page, labels.reviewRecord).isDisabled(), "OFFLINE_RECORD_SUBMIT_ENABLED");
    await eventually(() => button(page, labels.createChild).isDisabled(), "OFFLINE_CHILD_SUBMIT_ENABLED");
    await requireValue(page, labels.recordText, offlineText, "OFFLINE_RECORD_DRAFT_LOST");
    await requireValue(page, labels.childName, "合成未提交孩子稱呼", "OFFLINE_CHILD_DRAFT_LOST");
    requireResult((await renderedText(page, offlineText)).length === 0, "OFFLINE_DRAFT_SHOWN_AS_SAVED");
    requireResult(!await page.getByText(/Server 已確認保存/u).isVisible(), "OFFLINE_FALSE_SAVE_CONFIRMATION");
    await delay(300);
    requireResult(recordPosts === writesBefore.records && childPosts === writesBefore.children, "OFFLINE_WRITE_ATTEMPTED");
  });
  await runCheck("ONLINE_READ_THEN_SAVE", async () => {
    await context.setOffline(false);
    const data = await observeResponse(page, "GET", recordPath(firstChild), () => button(page, labels.reloadRecords).click());
    requireResult(data?.records?.length === 1 && data.records[0].id === firstRecord.id, "OFFLINE_WRITE_REACHED_SERVER");
    await requireValue(page, labels.recordText, offlineText, "RECONNECT_DRAFT_LOST");
    await field(page, labels.childName).fill("");
    await saveRecord(page, firstChild, accountA, offlineText);
  });
  await runCheck("CHILD_DRAFT_AND_RECORD_ISOLATION", async () => {
    secondChild = await createChild(page, "合成小朗");
    requireResult(secondChild.id !== firstChild.id, "DISTINCT_CHILDREN_REQUIRED");
    await selectChild(page, firstChild);
    await field(page, labels.recordText).fill(firstDraft);
    const secondRecords = await selectChild(page, secondChild);
    requireResult(secondRecords.length === 0, "OTHER_CHILD_RECORDS_VISIBLE");
    await requireValue(page, labels.recordText, "", "DRAFT_MOVED_TO_OTHER_CHILD");
    await requireNoPrivateData(page, [originalText, offlineText, firstDraft]);
    await saveRecord(page, secondChild, accountA, secondText);
    const firstRecords = await selectChild(page, firstChild);
    requireResult(firstRecords.length === 2 && !firstRecords.some((record) => record.text === secondText), "CHILD_RECORDS_MIXED");
    await requireValue(page, labels.recordText, firstDraft, "CHILD_DRAFT_NOT_RESTORED");
    await requireRecord(page, originalText);
    await requireRecord(page, offlineText);
  });
  await runCheck("SIGN_OUT_AND_NEW_ACCOUNT_ISOLATION", async () => {
    const privateValues = [accountA.name, accountA.email, firstChild.displayName, secondChild.displayName, originalText, offlineText, firstDraft, secondText];
    await signOut(page, true);
    await requireNoPrivateData(page, privateValues);
    await authenticate(page, accountB, true);
    requireResult(accountB.id !== accountA.id, "DISTINCT_ACCOUNTS_REQUIRED");
    await page.getByText("尚未有孩子，請先建立。", { exact: true }).waitFor({ state: "visible" });
    await requireNoPrivateData(page, privateValues);
    const newChild = await createChild(page, "合成小欣");
    const records = await selectChild(page, newChild);
    requireResult(records.length === 0, "NEW_ACCOUNT_HAS_PRIVATE_RECORDS");
    await requireValue(page, labels.recordText, "", "NEW_ACCOUNT_HAS_PRIVATE_DRAFT");
    await requireNoPrivateData(page, privateValues);
  });
}

const interrupt = () => interruption.abort("INTERRUPTED");
const stopBrowserOnInterrupt = () => { void closeBrowser().catch(() => {}); };
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
interruption.signal.addEventListener("abort", stopBrowserOnInterrupt, { once: true });
const totalTimeout = setTimeout(() => interruption.abort("TOTAL_TIMEOUT"), totalTimeoutMs);
let failure;
try {
  await verifyWeb();
} catch (error) {
  failure = interruption.signal.aborted
    ? interruption.signal.reason === "TOTAL_TIMEOUT" ? "TOTAL_TIMEOUT" : "INTERRUPTED"
    : error instanceof VerificationFailure ? error.code
    : error?.name === "TimeoutError" ? "BROWSER_TIMEOUT" : "UNEXPECTED_FAILURE";
} finally {
  clearTimeout(totalTimeout);
  const cleanup = await Promise.allSettled([closeBrowser(), ...[...ownedProcesses].map(stopOwned)]);
  if (cleanup.some((result) => result.status === "rejected")) failure = "OWNED_PROCESS_STOP_FAILED";
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  interruption.signal.removeEventListener("abort", stopBrowserOnInterrupt);
  if (databaseTouched) console.log("[INFO] Synthetic database rows retained; no database reset or cleanup performed.");
}
if (failure) {
  console.error("[FAIL] " + currentCheck + ": " + failure);
  process.exitCode = failure === "INTERRUPTED" ? 130 : 1;
} else {
  console.log("[PASS] S03-W01 Web acceptance: " + passedChecks + " checks.");
}

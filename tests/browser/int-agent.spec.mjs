import { test, expect } from "@playwright/test";
import { randomUUID, randomBytes } from "node:crypto";

const api = "http://localhost:3101", web = "http://localhost:8181";
const httpCap = 80, cleanupReserve = 6;
const realAgent = process.env.INT_AGENT_REAL_RUN === "true";
const check = (condition, message) => { if (!condition) throw new Error(message); };
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value);

// One minimal connected case; real generation is explicitly opt-in.
test("production Agent policy, one ordinary instruction and actual saved resources", async ({ context, page }, testInfo) => {
  check(process.env.INT_AGENT_BROWSER_APPROVED === "true", "INT-W02 bounded browser approval required");
  check(!realAgent || process.env.INT_AGENT_MODEL_APPROVED === "true", "One real Agent run approval required");
  test.skip(!realAgent, "The representative path requires the explicitly approved real Agent run");
  const owner = { email: "int-w02-" + randomUUID() + "@example.test", password: randomBytes(24).toString("hex"), id: null };
  const suffix = randomUUID().slice(0, 8), childName = "INT-W02 合成孩子 " + suffix;
  const recordText = "INT-W02 合成日常備註 " + suffix + "：今天換了藍色床單。";
  const noteTitle = "INT-W02 合成私人備註 " + suffix, noteText = "我想下次整理綠色玩具盒。";
  const userText = `這些是合成驗收資料。請把「${recordText}」保存為日常備註；另外把「${noteText}」保存為只供本人查看的私人備註，標題是「${noteTitle}」。只需確認這兩項保存結果。`;
  let requests = 0, blockedRequests = 0, capReached = false, replyAttempts = 0, policyPosts = 0;
  let child = null, childDeleted = false, cleanupFailure = null, phase = "setup", failedAt = null, flowSucceeded = false;
  let realRunId = null, counts = null, receiptResources = [], recordContextConfirmed = false, actualRecordText = null, actualNote = null;
  const count = cleanup => {
    check(requests + 1 <= (cleanup ? httpCap : httpCap - cleanupReserve), "INT-W02 HTTP cap reached"); requests++;
  };
  const apiPath = (path, method) => {
    if (/^\/api\/(?:auth\/(?:get-session|sign-up\/email|sign-out)|children|ai\/(?:status|usage)|online\/(?:context|submit|operations\/[a-f0-9-]+))$/u.test(path)) return true;
    if (!child) return false;
    const prefix = "/api/children/" + child.id;
    if ([prefix + "/records", prefix + "/messages", prefix + "/agent/policy", prefix + "/agent/notes", prefix + "/agent/actions"].includes(path))
      return method === "GET" || method === "OPTIONS" || path === prefix + "/agent/policy" && method === "POST";
    if (new RegExp("^" + prefix + "/agent/runs/[a-f0-9-]+$", "u").test(path)) return method === "GET" || method === "OPTIONS";
    if (new RegExp("^" + prefix + "/messages/[a-f0-9-]+/reply$", "u").test(path)) return realAgent && (method === "POST" || method === "OPTIONS");
    return false;
  };
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (["data:", "blob:"].includes(url.protocol)) { await route.continue(); return; }
    if (url.origin !== api && url.origin !== web) { blockedRequests++; await route.abort("blockedbyclient"); return; }
    try { count(false); } catch { capReached = true; await route.abort("blockedbyclient"); return; }
    if (url.origin === api && !apiPath(url.pathname, request.method())) { blockedRequests++; await route.abort("blockedbyclient"); return; }
    if (url.origin === api && url.pathname.endsWith("/reply") && request.method() === "POST") {
      replyAttempts++; if (replyAttempts > 1) { blockedRequests++; await route.abort("blockedbyclient"); return; }
    }
    if (url.origin === api && url.pathname.endsWith("/agent/policy") && request.method() === "POST") policyPosts++;
    if (url.origin === api && url.pathname === "/api/online/submit") {
      const command = request.postDataJSON();
      if (command.path !== "/api/children/" + child.id + "/messages") { blockedRequests++; await route.abort("blockedbyclient"); return; }
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
  const request = async (path, body, cleanup = false) => {
    count(cleanup);
    let response;
    try {
      response = await context.request.fetch(api + "/api" + path, { method: body === undefined ? "GET" : "POST", timeout: 10000,
        maxRetries: 0, maxRedirects: 0, headers: { origin: api, ...(owner.id ? { "x-expected-user-id": owner.id } : {}) },
        ...(body === undefined ? {} : { data: body }) });
    } catch { throw new Error("Synthetic API request could not be completed"); }
    check(response.status() === 200, "Synthetic API response was not confirmed"); return response.json();
  };
  const write = async (path, payload, cleanup = false) => {
    const command = { path: "/api" + path, payload }, basis = await request("/online/context", command, cleanup);
    const receipt = await request("/online/submit", { ...command, operation: { ...basis, deviceId: randomUUID(), opId: randomUUID() } }, cleanup);
    check(receipt.state === "confirmed" && receipt.result, "Synthetic setup operation unconfirmed"); return receipt.result;
  };
  const responseAt = (path, method = "GET") => page.waitForResponse(response => new URL(response.url()).pathname === "/api" + path && response.request().method() === method);
  const openAuthorization = async () => {
    const toggle = page.getByRole("button", { name: "Agent 授權與記憶", exact: true });
    if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
    const response = responseAt("/children/" + child.id + "/agent/policy");
    await page.getByRole("button", { name: "讀取目前授權", exact: true }).click();
    const actual = await response; check(actual.status() === 200, "Current policy read failed"); return (await actual.json()).policy;
  };
  const openRecordsContext = async () => {
    const open = page.getByRole("button", { name: "開啟資訊側欄", exact: true });
    await open.click();
    const rail = page.getByTestId("context-rail");
    await rail.getByRole("tab", { name: "照顧上下文", exact: true }).click();
    await expect(rail.getByRole("heading", { name: "近期已保存記錄", exact: true })).toBeVisible();
    check(typeof actualRecordText === "string", "Receipt-linked record text required");
    await expect(rail.getByText(actualRecordText, { exact: false }).first()).toBeVisible();
  };
  try {
    // Authentication and one child are setup, not another acceptance matrix.
    const signed = await request("/auth/sign-up/email", { email: owner.email, password: owner.password, name: "INT-W02 合成成員" });
    check(typeof signed.user?.id === "string", "Synthetic signup identity unavailable"); owner.id = signed.user.id;
    child = (await write("/children", { displayName: childName })).child;
    check(uuid(child?.id) && child.displayName === childName, "Exactly one synthetic child required");
    await page.goto(web + "/chat");
    phase = "policy";
    const initial = await openAuthorization();
    check(initial.version === 0 && initial.recordKinds.length === 0 && !initial.allowPrivateNotes && !initial.allowSelfTasks, "New policy defaults must be disabled");
    await page.getByRole("checkbox", { name: "容許保存日常備註", exact: true }).click();
    await page.getByRole("checkbox", { name: "容許保存及修改本人私人備註", exact: true }).click();
    await expect(page.getByRole("button", { name: "確認保存授權", exact: true })).toBeDisabled();
    check(policyPosts === 0, "Toggles must not save grants");
    await page.getByRole("checkbox", { name: "我明確同意上述照護記錄及本人待辦按家庭權限共享", exact: true }).click();
    const savedResponse = responseAt("/children/" + child.id + "/agent/policy", "POST"), currentResponse = responseAt("/children/" + child.id + "/agent/policy");
    await page.getByRole("button", { name: "確認保存授權", exact: true }).click();
    check((await savedResponse).status() === 200 && (await currentResponse).status() === 200, "Saved policy must be followed by current GET");
    await expect(page.getByText("原保存已確認；以下是重新讀取的目前授權。", { exact: true })).toBeVisible();
    const persisted = (await (await currentResponse).json()).policy;
    check(persisted.version === 1 && persisted.effective && persisted.recordKinds.join() === "note" && persisted.allowPrivateNotes && !persisted.allowSelfTasks
      && persisted.reminderConsentVersion === null && persisted.reminderBindings.length === 0 && policyPosts === 1, "Explicit policy did not persist without notification authority");
    await expect(page.getByRole("checkbox", { name: "容許保存日常備註", exact: true })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "容許保存及修改本人私人備註", exact: true })).toBeChecked();
    phase = "one-real-agent-run";
    await page.getByLabel("撰寫對話問題", { exact: true }).fill(userText);
    const replyResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/reply") && response.request().method() === "POST", { timeout: 100000 });
    await expect(page.getByRole("button", { name: "送出", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "送出", exact: true }).click();
    const actualReply = await replyResponse; check(actualReply.status() === 200, "Actual Agent reply failed; no retry permitted");
    const reply = (await actualReply.json()).message;
    check(uuid(reply?.agentRunId) && reply.role === "model" && reply.childId === child.id && reply.text?.trim(), "Actual saved Agent reply required"); realRunId = reply.agentRunId;
    phase = "receipt-record-note";
    // Inspect the same real responses used by the existing disclosure; no duplicate run/receipt read.
    const runResponse = responseAt("/children/" + child.id + "/agent/runs/" + realRunId);
    const receiptResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/children/" + child.id + "/agent/actions" && url.searchParams.get("runId") === realRunId && response.request().method() === "GET";
    });
    await page.getByRole("button", { name: "查看這則回覆的來源與候選", exact: true }).click();
    const actualRun = await runResponse; check(actualRun.status() === 200, "Actual run read failed");
    const run = (await actualRun.json()).result;
    check(run?.runId === realRunId && run.text === reply.text && run.status === "completed" && run.countsKnown, "Exact real run result must match saved reply");
    counts = run.counts;
    check(counts.modelCalls >= 1 && counts.modelCalls <= 4 && counts.queryEmbeddings <= 2, "Approved one-run model bounds exceeded");
    const actualReceipts = await receiptResponse; check(actualReceipts.status() === 200, "Actual action receipt read failed");
    const receipts = (await actualReceipts.json()).receipts;
    check(receipts.length === 2 && receipts.some(item => item.kind === "save_record") && receipts.some(item => item.kind === "save_private_note")
      && receipts.every(item => item.runId === realRunId && item.notification === "not_authorized" && item.channels.length === 0), "Two actual ordinary-action receipts without notifications required");
    receiptResources = receipts.map(item => ({ kind: item.resource.kind, id: item.resource.id, version: item.resource.version }));
    await expect(page.getByRole("heading", { name: "本次操作收據", exact: true })).toBeVisible();
    for (const resource of receiptResources) await expect(page.getByText(new RegExp(resource.id)).first()).toBeVisible();
    await expect(page.getByText("沒有授權外部到期提示。", { exact: true }).first()).toBeVisible();
    const recordReceipt = receipts.find(item => item.kind === "save_record");
    const records = (await request("/children/" + child.id + "/records")).records;
    const linkedRecords = records.filter(item => item.id === recordReceipt.resource.id);
    check(recordReceipt.resource.kind === "care_record" && linkedRecords.length === 1 && linkedRecords[0].childId === child.id
      && typeof linkedRecords[0].text === "string" && linkedRecords[0].text.includes("藍色床單"), "One receipt-linked care record with the stated core content required");
    actualRecordText = linkedRecords[0].text;
    await openRecordsContext(); recordContextConfirmed = true;
    const notesResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/children/" + child.id + "/agent/notes" && response.request().method() === "GET");
    await page.getByRole("button", { name: "讀取私人備註", exact: true }).click();
    const actualNotes = await notesResponse; check(actualNotes.status() === 200, "Actual private note read failed");
    const notes = (await actualNotes.json()).notes.items, noteReceipt = receipts.find(item => item.kind === "save_private_note");
    const linkedNotes = notes.filter(item => item.id === noteReceipt.resource.id);
    check(noteReceipt.resource.kind === "private_note" && linkedNotes.length === 1 && linkedNotes[0].childId === child.id
      && linkedNotes[0].version === noteReceipt.resource.version && linkedNotes[0].title.includes("合成私人備註") && linkedNotes[0].title.includes(suffix)
      && linkedNotes[0].text.includes("整理") && linkedNotes[0].text.includes("綠色玩具盒") && linkedNotes[0].provenance === "user_statement"
      && linkedNotes[0].sourceMessageId === reply.inReplyTo, "Receipt-linked private user-statement note and original message source required");
    actualNote = linkedNotes[0];
    await expect(page.getByText(actualNote.title, { exact: true })).toBeVisible();
    await expect(page.getByText(actualNote.text, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("來源聊天：" + actualNote.sourceMessageId, { exact: true })).toBeVisible();
    check(!capReached && blockedRequests === 0 && replyAttempts === (realAgent ? 1 : 0), "Unexpected network, duplicate reply or HTTP cap reached");
    flowSucceeded = true;
  } catch (error) { failedAt = phase; throw error; }
  finally {
    try {
      if (flowSucceeded && child && owner.id) {
        const result = await write("/children/" + child.id + "/delete", { confirmChildId: child.id }, true);
        check(result.deleted === true && result.childId === child.id, "Own-child cleanup must be confirmed"); childDeleted = true;
      }
      if (owner.id) await request("/auth/sign-out", {}, true);
    } catch { cleanupFailure = "Synthetic cleanup or signout incomplete; review retained resource metadata"; }
    await testInfo.attach("int-agent-boundary-metadata", { contentType: "application/json", body: Buffer.from(JSON.stringify({
      requestAttempts: requests, httpCap, cleanupReserve, confirmedAccounts: owner.id ? 1 : 0, userId: owner.id, flowSucceeded, scenarioRetained: !!child && !childDeleted, childId: child?.id ?? null, childDeleted,
      realAgentEnabled: realAgent, replyAttempts, realRunId, counts, approvedLimits: { runs: 1, modelCalls: 4, queryEmbeddings: 2, budgetUsd: 0.10 },
      receiptResources, recordContextConfirmed,
      policyPosts, blockedRequests, capReached, failedAt, cleanupFailure,
    })) });
    if (flowSucceeded) check(cleanupFailure === null, cleanupFailure ?? "Own-child cleanup failure");
  }
});

// Resume only the remaining reads of the reviewed saved scene; no grants or generation.

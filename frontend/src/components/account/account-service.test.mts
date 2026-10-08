import assert from "node:assert/strict";
import { test } from "node:test";
import { AccountServiceOwner, parseAccountCallback } from "../../production/AccountServiceOwner.ts";
import { ProductionOwner } from "../../production/ProductionOwner.ts";
import { createAccountApi } from "../../../../src/client/account-api.ts";
import { createAccountAuthApi } from "../../../../src/client/account-auth-api.ts";
import { RecordsController } from "../../../../src/client/records-controller.ts";
import { ClientApiError, type RecordsApi } from "../../../../src/client/records-api.ts";
import type { ChatApi } from "../../../../src/client/chat-api.ts";
import { SERVICE_POLICY_VERSION } from "../../../../src/shared/account-service.ts";
const userA = { id: "a07-parent-a", name: "Synthetic", email: "synthetic@example.invalid" };
const userB = { ...userA, id: "a07-parent-b" };
const child = { id: "00000000-0000-4000-8000-000000000001", workspaceId: "00000000-0000-4000-8000-000000000002", displayName: "Synthetic child", createdAt: "2026-10-08T00:00:00Z", accessRole: "owner" as const };
const status = (id: string | null, acknowledged = false) => ({ enabled: true, registration: "invite", mailConfigured: true, policyVersion: SERVICE_POLICY_VERSION, notice: "Synthetic service notice",
  user: id ? { id, emailVerified: true, acknowledged, acknowledgementVersion: acknowledged ? SERVICE_POLICY_VERSION : null } : null });
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function records(getSession: RecordsApi["getSession"], listChildren: RecordsApi["listChildren"]): RecordsApi {
  return { getSession, listChildren, authenticate: async () => {}, signOut: async () => {}, listRecords: async () => ({ records: [], limit: 100 }),
    createChild: async () => { throw new Error("Unexpected write"); }, deleteChild: async () => { throw new Error("Unexpected write"); }, createRecord: async () => { throw new Error("Unexpected write"); } };
}
const chat = (): ChatApi => ({ getSession: async () => userA, listMessages: async () => ({ messages: [], limit: 100 }), getStatus: async () => true,
  getUsage: async () => ({ day: "2026-10-08", attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 }), saveMessage: async () => { throw new Error("Unexpected chat write"); }, requestReply: async () => { throw new Error("Unexpected model call"); } });

test("A07 account admission, native signup and callback reject stale identities", async () => {
  let currentUser = userA, childReads = 0, resolveStatus!: (value: Response) => void, resolveConsent!: (value: Response) => void;
  let deferStatus = true, deferConsent = false;
  const api = createAccountApi("/api", async (url, init) => {
    const id = new Headers(init?.headers).get("x-expected-user-id");
    if (String(url).endsWith("/acknowledgement")) {
      assert.equal(JSON.parse(init!.body as string).policyVersion, SERVICE_POLICY_VERSION);
      if (deferConsent) return new Promise<Response>(resolve => { resolveConsent = resolve; });
      return Response.json(status(id, true));
    }
    if (deferStatus) return new Promise<Response>(resolve => { resolveStatus = resolve; });
    return Response.json(status(id));
  });
  let resetCalls = 0;
  const authApi = createAccountAuthApi("/api", async () => { resetCalls++; return Response.json({ success: true }); });
  const owner = new ProductionOwner("/api", true, records(async () => currentUser, async () => { childReads++; return [child]; }), chat(), undefined, { api, authApi });
  try {
    await owner.controller.restoreSession();
    assert.equal(childReads, 0); assert.equal(owner.getSnapshot().scopeKey, null);
    resolveStatus(Response.json(status(userA.id))); await turn();
    assert.equal(owner.getSnapshot().account.gate, "consent"); assert.equal(childReads, 0);
    deferStatus = false;
    await owner.accountOwner.acknowledge(); await turn();
    assert.ok(owner.getSnapshot().scopeKey); assert.equal(childReads, 1);
    // A changed policy closes business scope before asking for renewed consent.
    await owner.accountOwner.loadStatus(); assert.equal(owner.getSnapshot().scopeKey, null);
    deferConsent = true;
    const staleConsent = owner.accountOwner.acknowledge();
    const parsed = parseAccountCallback("https://example.invalid/?account=reset&token=synthetic-reset-token&section=account")!;
    assert.equal(parsed.cleanUrl, "/?section=account"); owner.accountOwner.acceptCallback(parsed);
    assert.ok(!JSON.stringify(owner.getSnapshot().account).includes("synthetic-reset-token"));
    currentUser = userB; await owner.controller.restoreSession(); await turn();
    resolveConsent(Response.json(status(userA.id, true))); await staleConsent;
    assert.equal(owner.getSnapshot().account.userId, userB.id); assert.equal(owner.getSnapshot().account.gate, "consent");
    assert.equal(owner.getSnapshot().scopeKey, null); assert.equal(owner.getSnapshot().account.callback, null);
    await owner.accountOwner.resetPassword("Synthetic new password"); assert.equal(resetCalls, 0);
    assert.equal(parseAccountCallback("https://example.invalid/?account=reset&error=INVALID_TOKEN")?.kind, "invalid");
    assert.equal(parseAccountCallback("https://example.invalid/?account=verified")?.kind, "verified");
  } finally { owner.dispose(); }
  const signup = new RecordsController(records(async () => null, async () => []));
  try { await signup.restoreSession(); await signup.authenticate("signUp", { name: "Synthetic", email: userA.email, password: "Synthetic password" });
    assert.equal(signup.getSnapshot().auth, "signedOut"); assert.match(signup.getSnapshot().notice ?? "", /驗證指引/);
    const denied = records(async () => null, async () => []); denied.authenticate = async () => { throw new ClientApiError(403, "invitation_required"); };
    const invitation = new RecordsController(denied); await invitation.restoreSession(); await invitation.authenticate("signUp", { name: "Synthetic", email: userA.email, password: "Synthetic password" }); assert.match(invitation.getSnapshot().notice ?? "", /獲邀請/); invitation.dispose();
  } finally { signup.dispose(); }
  const unavailable = new AccountServiceOwner("/api", true, () => {}, () => {}, { legacyTrial: true, api: createAccountApi("/api", async () => new Response(null, { status: 503 })) });
  unavailable.syncContext(userA.id, true, "a:1"); await turn(); assert.equal(unavailable.getSnapshot().gate, "error"); unavailable.dispose();
});

test("A07 bounded download continues original pages and unknown erasure keeps its receipt", async () => {
  const scopeVersion = "a".repeat(64), token = "x".repeat(43); let originalOperation: string | null = null, deleteCalls = 0, checks = 0, pageReads = 0;
  let checkedState: "prepared" | "completed" = "prepared", completed = 0;
  const api = createAccountApi("/api", async (url, init) => {
    const value = new URL(String(url), "https://example.invalid"), id = new Headers(init?.headers).get("x-expected-user-id");
    if (value.pathname.endsWith("/deletion/prepare")) {
      const operationId = JSON.parse(init!.body as string).operationId as string; originalOperation ??= operationId; assert.equal(operationId, originalOperation);
      return Response.json({ operationId, state: "prepared", attachmentsPending: false, receiptToken: token, summary: { childCount: 1 }, expiresAt: "2099-01-01T00:00:00Z" });
    }
    if (value.pathname.endsWith("/account/delete")) {
      const body = JSON.parse(init!.body as string); assert.equal(body.operationId, originalOperation); assert.equal(body.receiptToken, token);
      if (++deleteCalls === 1) throw new TypeError("Synthetic response loss"); checkedState = "completed";
      return Response.json({ operationId: originalOperation, state: "completed", attachmentsPending: true });
    }
    if (value.pathname.includes("/account/deletion/")) { checks++; assert.equal(new Headers(init?.headers).get("x-erasure-receipt"), token); return Response.json({ operationId: originalOperation, state: checkedState, attachmentsPending: false }); }
    if (value.pathname.endsWith("/export")) {
      const section = value.searchParams.get("section")!; let items: unknown[] = [], nextCursor: string | null = null;
      if (section === "manifest") items = [{ format: "yuban-personal-data:1", sections: [{ section: "children", childScoped: false, required: true }, { section: "account", childScoped: false, required: true }] }];
      if (section === "account") { const position = Number(value.searchParams.get("cursor") ?? "0"); items = [{ position, text: "synthetic exported body" }]; pageReads++; nextCursor = position < 44 ? String(position + 1) : null; }
      return Response.json({ section, items, nextCursor, complete: !nextCursor, scopeVersion, notices: [] });
    }
    return Response.json(status(id, true));
  });
  const owner = new AccountServiceOwner("/api", true, () => { completed++; }, () => {}, { api });
  const files: { part: number; complete: boolean; pages: { section: string; items: { position?: number }[] }[] }[] = [];
  try {
    owner.syncContext(userA.id, true, "a:1"); await turn();
    await owner.downloadNextPart(() => { throw new Error("Synthetic download handoff failure"); });
    assert.equal(owner.getSnapshot().download.phase, "error"); const fetched = pageReads;
    await owner.downloadNextPart(text => { files.push(JSON.parse(text)); }); assert.equal(pageReads, fetched);
    assert.equal(owner.getSnapshot().download.phase, "partial");
    await owner.downloadNextPart(text => { files.push(JSON.parse(text)); });
    assert.equal(owner.getSnapshot().download.phase, "complete"); assert.equal(files.length, 2);
    const positions = files.flatMap(file => file.pages.filter(page => page.section === "account").flatMap(page => page.items.map(item => item.position)));
    assert.deepEqual(positions, Array.from({ length: 45 }, (_, index) => index)); assert.equal(files[0].complete, false); assert.equal(files[1].complete, true);
    assert.ok(!JSON.stringify(owner.getSnapshot()).includes("synthetic exported body"));
    await owner.prepareDeletion(); await owner.executeDeletion("Synthetic password", "永久刪除我的帳戶");
    assert.equal(owner.getSnapshot().deletion.phase, "unknown"); assert.equal(completed, 0);
    await owner.prepareDeletion(); await owner.cancelPreparedDeletion(); assert.equal(deleteCalls, 1);
    owner.syncContext(null, true, null); await owner.checkDeletion(); assert.equal(owner.getSnapshot().deletion.phase, "unknown");
    owner.syncContext(userB.id, true, "b:1"); await turn(); assert.equal(owner.getSnapshot().deletion.phase, "idle");
    const before = checks; await owner.checkDeletion(); assert.equal(checks, before);
    owner.syncContext(userA.id, true, "a:2"); await turn(); assert.equal(owner.getSnapshot().deletion.phase, "unknown");
    await owner.checkDeletion(); assert.equal(owner.getSnapshot().deletion.phase, "prepared"); assert.equal(owner.getSnapshot().deletion.childCount, 1);
    await owner.executeDeletion("Synthetic password", "永久刪除我的帳戶"); assert.equal(completed, 1); assert.equal(owner.getSnapshot().deletion.phase, "completed");
    assert.ok(!JSON.stringify(owner.getSnapshot()).includes(token)); assert.ok(!JSON.stringify(owner.getSnapshot()).includes("Synthetic password"));
  } finally { owner.dispose(); }
});

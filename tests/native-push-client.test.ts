import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createNativePushApi, NativePushApiError } from "../src/client/native-push-api.ts";
import * as push from "../src/shared/native-push.ts";

const binding = { id: "11111111-1111-4111-8111-111111111111", version: 1, tokenRevision: 1, status: "active" as const,
  label: "My device", createdAt: "2026-10-24T00:00:00Z", updatedAt: "2026-10-24T00:00:00Z" };
const iosBinding = { ...binding, platform: "ios" as const, provider: "apns" as const };
const delivery = { id: "22222222-2222-4222-8222-222222222222", bindingId: binding.id, status: "queued", reason: null,
  providerStatus: null, createdAt: binding.createdAt, attemptedAt: null, finishedAt: null };
const reference = { v: 1 as const, kind: "test" as const, bindingId: binding.id, bindingVersion: 1, deliveryId: delivery.id };
const data = { ...reference, v: "1", bindingVersion: "1" };
const baseStatus = { userId: "parent", available: true, workerEnabled: true, currentBindingId: binding.id,
  bindings: [binding], deliveries: [], testsRemaining: 3, nextTestAt: null };
const iosStatus = { ...baseStatus, bindings: [iosBinding], availablePlatforms: { android: true, ios: false } };

test("iOS v2 preserves a lost reply's original receipt while Android keeps strict v1 requests", async () => {
  const commands: any[] = [], reads: string[] = [], receipts = new Map<string, any>();
  let loseIosReply = true;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); reads.push(url.pathname);
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), "parent");
    if (url.pathname === "/api/online/context") return Response.json({
      workspaceId: "33333333-3333-4333-8333-333333333333", storageEpoch: "44444444-4444-4444-8444-444444444444" });
    if (url.pathname === "/api/online/submit") {
      const command = JSON.parse(String(init?.body)); commands.push(command);
      const v2 = command.path.startsWith("/api/native-push/v2/");
      const result = command.path.endsWith("/test") ? { delivery } : { binding: v2 ? iosBinding : binding };
      const receipt = { state: "confirmed", operation: command.operation, changeSeq: String(commands.length), statusCode: 200, result };
      receipts.set(command.operation.opId, receipt);
      if (v2 && loseIosReply) { loseIosReply = false; throw new Error("Synthetic lost reply"); }
      return Response.json(receipt);
    }
    if (url.pathname.startsWith("/api/online/operations/")) return Response.json(receipts.get(url.pathname.split("/").at(-1)!));
    if (url.pathname === "/api/native-push/v2") return Response.json(iosStatus);
    if (url.pathname === "/api/native-push") return Response.json(baseStatus);
    assert.equal(url.pathname, "/api/native-push/open");
    assert.deepEqual(JSON.parse(url.searchParams.get("reference")!), reference);
    return Response.json({ kind: "test", childId: null, taskId: null });
  };
  const signal = new AbortController().signal;
  const ios = createNativePushApi("https://synthetic.invalid", fetcher, { version: 2, platform: "ios" });
  const android = createNativePushApi("https://synthetic.invalid", fetcher);
  await assert.rejects(ios.register({ token: "AB".repeat(32), label: "iPhone" }, signal, "parent"));
  assert.equal(ios.hasPendingOnline(), true); assert.equal(android.hasPendingOnline(), false);
  assert.deepEqual(await android.register({ token: "synthetic-fcm-token-for-android", label: "Android" }, signal, "parent"), binding);
  assert.equal(ios.hasPendingOnline(), true);
  const submitted = commands.length, receipt = await ios.reconcilePending(signal, "parent");
  assert.equal(commands.length, submitted); assert.equal(ios.hasPendingOnline(), false);
  assert.ok(receipt?.state === "confirmed");
  assert.deepEqual(receipt.result, { binding: iosBinding });
  assert.deepEqual(receipt.operation, commands[0].operation);
  assert.equal(commands[0].path, "/api/native-push/v2/subscriptions");
  assert.equal(commands[0].payload.platform, "ios");
  assert.equal(commands[1].path, "/api/native-push/subscriptions");
  assert.equal("platform" in commands[1].payload, false);
  assert.deepEqual((await ios.status(signal, "parent")).availablePlatforms, { android: true, ios: false });
  assert.equal("availablePlatforms" in await android.status(signal, "parent"), false);
  assert.deepEqual(await ios.revoke(binding.id, 1, signal, "parent"), iosBinding);
  assert.deepEqual(await ios.test(binding.id, 1, signal, "parent"), delivery);
  assert.equal(commands[2].path, `/api/native-push/v2/subscriptions/${binding.id}/revoke`);
  assert.equal(commands[3].path, `/api/native-push/v2/subscriptions/${binding.id}/test`);
  assert.deepEqual(await ios.open(reference, signal, "parent"), { kind: "test", childId: null, taskId: null });
  assert.equal(reads.at(-1), "/api/native-push/open");
  const strictV1 = createNativePushApi("https://synthetic.invalid", async () => Response.json(iosStatus));
  await assert.rejects(strictV1.status(signal, "parent"), NativePushApiError);
});

function nativeAdapter(os: "ios" | "android") {
  let permission: any = { granted: false, canAskAgain: true, ...(os === "ios" ? { ios: { status: 0 } } : {}) };
  let token: any = { type: os, data: os === "ios" ? "AB".repeat(32) : "synthetic-fcm-token-for-android" };
  let handler: any, tokenListener: any, responseListener: any, removed = 0, tokenReads = 0, prompts = 0, cleared = 0;
  const calls: string[] = [];
  const notifications = {
    IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
    AndroidImportance: { DEFAULT: 3 }, AndroidNotificationVisibility: { PRIVATE: 0 }, DEFAULT_ACTION_IDENTIFIER: "default",
    setNotificationHandler(value: any) { handler = value; },
    async getPermissionsAsync() { calls.push("permission"); return permission; },
    async requestPermissionsAsync() { prompts++; calls.push("prompt"); return { ...permission, granted: true }; },
    async setNotificationChannelAsync() { calls.push("channel"); },
    async getDevicePushTokenAsync() { tokenReads++; calls.push("token"); return token; },
    addPushTokenListener(value: any) { tokenListener = value; return { remove() { removed++; } }; },
    addNotificationResponseReceivedListener(value: any) { responseListener = value; return { remove() { removed++; } }; },
    getLastNotificationResponse() { return { actionIdentifier: "default", notification: { request: { content: { data } } } }; },
    clearLastNotificationResponse() { cleared++; },
  };
  const source = readFileSync(new URL("../frontend/src/platform/native-push.native.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as any };
  new Function("require", "module", "exports", code)((name: string) => {
    if (name === "react-native") return { Platform: { OS: os } };
    if (name === "expo-notifications") return notifications;
    assert.equal(name, "../../../src/shared/native-push.ts"); return push;
  }, module, module.exports);
  return { api: module.exports, calls, get handler() { return handler; }, setPermission(value: any) { permission = value; },
    setToken(value: any) { token = value; }, rotate(value: any) { tokenListener(value); }, respond(value: any) { responseListener(value); },
    counts: () => ({ removed, tokenReads, prompts, cleared }) };
}

test("native permission, token rotation and fixed notification callbacks follow each OS without token recursion", async () => {
  for (const os of ["ios", "android"] as const) {
    const device = nativeAdapter(os), { api } = device;
    assert.equal(api.nativePushPlatform(), os); assert.equal(api.nativePushSupported(), true);
    assert.deepEqual(device.calls, []);
    assert.equal(await api.nativePushPermission(), "undetermined"); assert.equal(device.counts().prompts, 0);
    if (os === "ios") {
      device.setPermission({ granted: false, canAskAgain: false, ios: { status: 3 } });
      assert.equal(await api.nativePushPermission(), "granted");
    }
    const token = await api.requestNativePushToken();
    assert.equal(token, os === "ios" ? "ab".repeat(32) : "synthetic-fcm-token-for-android");
    assert.equal(device.counts().prompts, os === "ios" ? 0 : 1);
    assert.equal(device.calls.includes("channel"), os === "android");
    if (os === "android") assert.ok(device.calls.indexOf("channel") < device.calls.indexOf("prompt"));
    const tokens: string[] = [], opened: push.NativePushReference[] = [];
    const stop = api.listenNativePush({ tokenChanged: (value: string) => tokens.push(value), opened: (value: push.NativePushReference) => opened.push(value) });
    await Promise.resolve();
    assert.deepEqual(opened, [reference]);
    const tokenReads = device.counts().tokenReads;
    device.rotate({ type: os, data: os === "ios" ? "CD".repeat(32) : "synthetic-fcm-rotation-for-android" });
    device.rotate({ type: os === "ios" ? "android" : "ios", data: "AB".repeat(32) });
    if (os === "ios") device.rotate({ type: os, data: "invalid-apns-token" });
    assert.deepEqual(tokens, [os === "ios" ? "cd".repeat(32) : "synthetic-fcm-rotation-for-android"]);
    assert.equal(device.counts().tokenReads, tokenReads);
    device.respond({ actionIdentifier: "default", notification: { request: { content: { data } } } });
    device.respond({ actionIdentifier: "complete", notification: { request: { content: { data: { ...data, deliveryId: binding.id } } } } });
    assert.equal(opened.length, 1);
    assert.equal((await device.handler.handleNotification({ request: { content: { data } } })).shouldShowBanner, true);
    assert.equal((await device.handler.handleNotification({ request: { content: { data: { ...data, url: "https://invalid.test" } } } })).shouldShowBanner, false);
    api.clearNativePushOpen(); stop();
    device.rotate({ type: os, data: "EF".repeat(32) });
    assert.equal(tokens.length, 1); assert.equal(device.counts().removed, 2); assert.equal(device.counts().cleared, 1);
    if (os === "ios") {
      device.setPermission({ granted: false, canAskAgain: true, ios: { status: 1 } });
      assert.equal(await api.nativePushPermission(), "denied");
      await assert.rejects(api.requestNativePushToken(), /native_push_permission_denied/);
      assert.equal(device.counts().prompts, 0); assert.equal(device.counts().tokenReads, tokenReads);
      device.setPermission({ granted: false, canAskAgain: true, ios: { status: 0 } });
      device.setToken({ type: "android", data: "AB".repeat(32) });
      await assert.rejects(api.requestNativePushToken(), /native_push_token_invalid/);
      assert.equal(device.counts().prompts, 1);
    }
  }
});

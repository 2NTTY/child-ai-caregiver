import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import test from "node:test";
import type { PushPayload, WebPushSubscription } from "../src/shared/web-push.ts";

function keyPair(seed: number) {
  const key = createECDH("prime256v1");
  key.setPrivateKey(Buffer.alloc(32, seed));
  return { publicKey: key.getPublicKey().toString("base64url"), privateKey: key.getPrivateKey().toString("base64url") };
}
const config = { ...keyPair(1), subject: "mailto:push@example.test" };
const subscription: WebPushSubscription = { endpoint: "https://fcm.googleapis.com/fcm/send/synthetic-token",
  keys: { p256dh: keyPair(2).publicKey, auth: Buffer.alloc(16, 3).toString("base64url") }, expirationTime: null };
const payload: PushPayload = { v: 1, bindingId: "a4ac4d4e-4ce6-4b65-82ba-5482549336da", bindingVersion: 2,
  deliveryId: "b3ad5662-5557-4b9d-8c92-1f7a1b02f94f" };
interface CapturedRequest {
  url: URL; options: RequestOptions; body?: unknown; timeout?: number; destroyed: boolean; responseDestroyed: boolean;
}

test("web push gateway public boundaries with mocked DNS and HTTPS", async context => {
  let addresses = [{ address: "8.8.8.8", family: 4 }];
  let pendingLookup: Promise<typeof addresses> | undefined;
  const dnsCalls: unknown[][] = [], requests: CapturedRequest[] = [];
  let status: number | undefined = 201;
  let failure: "error" | "timeout" | null = null;
  const dnsModuleOptions = { cache: false, exports: { lookup: async (...args: unknown[]) => {
    dnsCalls.push(args); return pendingLookup ?? addresses;
  } } };
  context.mock.module("node:dns/promises", dnsModuleOptions);
  const httpsModuleOptions = { cache: false, exports: { request: (url: URL, options: RequestOptions, respond: (response: IncomingMessage) => void) => {
    const record: CapturedRequest = { url, options, destroyed: false, responseDestroyed: false };
    requests.push(record);
    const req = new EventEmitter();
    let onTimeout: (() => void) | undefined;
    const destroy = () => { record.destroyed = true; req.emit("error", new Error("synthetic transport error")); return req; };
    return Object.assign(req, {
      destroy,
      setTimeout(ms: number, callback: () => void) { record.timeout = ms; onTimeout = callback; return req; },
      end(body: unknown) {
        record.body = body;
        if (failure === "timeout") { onTimeout?.(); return req; }
        if (failure === "error") { destroy(); return req; }
        const response = Object.assign(new EventEmitter(), { statusCode: status,
          headers: { location: "https://example.test/redirect" },
          destroy() { record.responseDestroyed = true; return response; } });
        respond(response as IncomingMessage);
        return req;
      },
    });
  } } };
  context.mock.module("node:https", httpsModuleOptions);
  const { pushProvider, checkedSubscription, checkedVapid, readWebPushConfig, isPublicPushAddress, createWebPushGateway } =
    await import("../server/web-push-gateway.ts");

  await context.test("accepts only canonical public HTTPS provider endpoints", () => {
    assert.equal(pushProvider(subscription.endpoint), "fcm");
    assert.equal(pushProvider("https://updates.push.services.mozilla.com/wpush/v2/synthetic-token"), "mozilla");
    for (const endpoint of ["http://fcm.googleapis.com/token", "https://localhost/token", "https://127.0.0.1/token",
      "https://fcm.googleapis.com.evil.test/token", "https://fcm.googleapis.com:443/token", "https://user@fcm.googleapis.com/token",
      "https://fcm.googleapis.com/token#fragment", "https://FCM.googleapis.com/token", "https://fcm.googleapis.com/",
      subscription.endpoint + "\n", "https://fcm.googleapis.com\\token"]) assert.throws(() => pushProvider(endpoint), endpoint);
  });

  await context.test("requires canonical subscription keys, a valid P256 point and unexpired bounds", () => {
    assert.deepEqual(checkedSubscription(subscription), subscription);
    const expirationTime = Date.now() + 60000;
    assert.equal(checkedSubscription({ ...subscription, expirationTime }).expirationTime, expirationTime);
    const badPoint = Buffer.alloc(65); badPoint[0] = 4;
    for (const input of [
      { ...subscription, endpoint: "https://localhost/token" },
      { ...subscription, keys: { ...subscription.keys, p256dh: "A".repeat(87) } },
      { ...subscription, keys: { ...subscription.keys, p256dh: badPoint.toString("base64url") } },
      { ...subscription, keys: { ...subscription.keys, auth: "A".repeat(21) + "B" } },
      { ...subscription, keys: { ...subscription.keys, auth: subscription.keys.auth + "=" } },
      { ...subscription, expirationTime: Date.now() - 1 }, { ...subscription, expirationTime: 8640000000000001 },
      { ...subscription, extra: true }, { ...subscription, keys: { ...subscription.keys, extra: true } },
    ]) assert.throws(() => checkedSubscription(input));
  });

  await context.test("configuration is disabled by default and enabled VAPID keys must match", async () => {
    assert.equal(await readWebPushConfig({}), null);
    assert.equal(await readWebPushConfig({ WEB_PUSH_ENABLED: "false", WEB_PUSH_VAPID_FILE: "unused" }), null);
    for (const env of [{ WEB_PUSH_ENABLED: "TRUE" }, { WEB_PUSH_ENABLED: "true" }]) {
      await assert.rejects(readWebPushConfig(env), { message: "web_push_config_invalid" });
    }
    assert.deepEqual(checkedVapid(config), config);
    assert.deepEqual(checkedVapid({ ...config, subject: "https://example.test/push-contact" }), { ...config, subject: "https://example.test/push-contact" });
    for (const value of [{ ...config, publicKey: keyPair(2).publicKey }, { ...config, privateKey: "A".repeat(42) },
      { ...config, subject: "mailto:missing-at" }, { ...config, subject: "http://example.test" },
      { ...config, subject: "https://user@example.test" }, { ...config, subject: "https://example.test/#private" },
      { ...config, extra: true }]) assert.throws(() => checkedVapid(value));
  });

  await context.test("rejects private, reserved and non-IPv4 addresses", () => {
    for (const address of ["0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.1.2", "172.16.0.1", "172.31.255.254",
      "192.168.0.1", "100.64.0.1", "100.127.255.254", "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1",
      "203.0.113.1", "224.0.0.1", "255.255.255.255", "::1", "2001:4860:4860::8888", "not-an-address"]) {
      assert.equal(isPublicPushAddress(address), false, address);
    }
    for (const address of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "100.63.255.254", "100.128.0.1"]) {
      assert.equal(isPublicPushAddress(address), true, address);
    }
  });

  const gateway = createWebPushGateway(config);
  const send = (authorize = async () => true, input = subscription, signal = new AbortController().signal) =>
    gateway.send(input, payload, signal, authorize);
  await context.test("disabled, invalid, interrupted and revoked sends stop before an HTTPS request", async () => {
    const count = requests.length, lookups = dnsCalls.length;
    assert.deepEqual(await createWebPushGateway(null).send(subscription, payload, new AbortController().signal, async () => true),
      { status: "stopped", reason: "configuration_unavailable", providerStatus: null });
    assert.deepEqual(await send(undefined, { ...subscription, endpoint: "https://localhost/token" }),
      { status: "stopped", reason: "request_invalid", providerStatus: null });
    const controller = new AbortController(); controller.abort();
    assert.deepEqual(await send(undefined, subscription, controller.signal), { status: "stopped", reason: "worker_interrupted", providerStatus: null });
    assert.equal(dnsCalls.length, lookups);
    assert.deepEqual(await send(async () => false), { status: "stopped", reason: "revoked", providerStatus: null });
    assert.equal(requests.length, count);
  });

  await context.test("an empty or partly private DNS answer prevents authorization and HTTPS", async () => {
    const count = requests.length;
    let authorizations = 0;
    for (const answer of [[], [{ address: "127.0.0.1", family: 4 }],
      [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]]) {
      addresses = answer;
      assert.deepEqual(await send(async () => { authorizations++; return true; }),
        { status: "stopped", reason: "request_invalid", providerStatus: null });
    }
    assert.equal(authorizations, 0);
    assert.equal(requests.length, count);
    addresses = [{ address: "8.8.8.8", family: 4 }];
  });

  await context.test("the total deadline stops unresolved DNS before authorization or HTTPS", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let completeLookup: (answer: typeof addresses) => void = () => {};
    pendingLookup = new Promise(resolve => { completeLookup = resolve; });
    t.after(() => { pendingLookup = undefined; completeLookup(addresses); });
    const count = requests.length, lookups = dnsCalls.length;
    let authorizations = 0, settled = false;
    const sending = send(async () => { authorizations++; return true; });
    void sending.then(() => { settled = true; });
    assert.equal(dnsCalls.length, lookups + 1);
    t.mock.timers.tick(14999);
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(authorizations, 0);
    assert.equal(requests.length, count);
    t.mock.timers.tick(1);
    assert.deepEqual(await sending, { status: "stopped", reason: "worker_interrupted", providerStatus: null });
    completeLookup(addresses);
    await Promise.resolve();
    assert.equal(authorizations, 0);
    assert.equal(requests.length, count);
  });

  await context.test("sends one pinned encrypted request and reports provider status without redirect or retry", async () => {
    for (const [code, resultStatus, reason] of [
      [201, "accepted", null], [200, "rejected", "provider_rejected"], [302, "rejected", "provider_rejected"],
      [404, "rejected", "subscription_expired"], [410, "rejected", "subscription_expired"],
      [429, "rejected", "rate_limited"], [500, "rejected", "provider_rejected"],
    ] as const) {
      status = code;
      const count = requests.length;
      assert.deepEqual(await send(), { status: resultStatus, reason, providerStatus: code });
      assert.equal(requests.length, count + 1);
      const record = requests.at(-1)!;
      assert.equal(record.url.href, subscription.endpoint);
      assert.equal(record.options.method, "POST");
      assert.equal(record.options.family, 4);
      assert.equal(record.options.agent, false);
      assert.equal(record.responseDestroyed, true);
      assert.ok(Buffer.isBuffer(record.body));
      assert.equal(record.body.includes(Buffer.from(JSON.stringify(payload))), false);
      const pin = record.options.lookup as (host: string, options: object, callback: (error: Error | null, address: string, family: number) => void) => void;
      pin("ignored-host.test", {}, (error, address, family) => assert.deepEqual([error, address, family], [null, "8.8.8.8", 4]));
      assert.deepEqual(dnsCalls.at(-1), ["fcm.googleapis.com", { family: 4, all: true }]);
    }
  });

  await context.test("post-send errors, socket timeouts and missing response status remain unknown", async () => {
    for (const mode of ["error", "timeout", null] as const) {
      failure = mode; status = undefined;
      const count = requests.length;
      assert.deepEqual(await send(), { status: "unknown", reason: "transport_unknown", providerStatus: null });
      assert.equal(requests.length, count + 1);
      assert.ok(Buffer.isBuffer(requests.at(-1)!.body));
      if (mode === "timeout") assert.equal(requests.at(-1)!.destroyed, true);
    }
  });
});

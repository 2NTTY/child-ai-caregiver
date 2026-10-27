import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { connect, constants, type OutgoingHttpHeaders } from "node:http2";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApnsPushGateway, readApnsPushConfig } from "../server/apns-push-gateway.ts";
import { nativePushContent, parseNativePushData } from "../src/shared/native-push.ts";

class FakeStream extends EventEmitter {
  destroyed = false;
  body = "";
  closeCodes: number[] = [];
  onEnd: (stream: FakeStream) => void = () => {};
  end(body: string) { this.body = body; this.onEnd(this); }
  close(code: number) { this.closeCodes.push(code); this.destroyed = true; this.emit("close"); }
  respond(status: number, id: string, body = "") {
    this.emit("response", { ":status": status, "apns-id": id });
    if (body) this.emit("data", Buffer.from(body));
    this.emit("end");
  }
}

class FakeSession extends EventEmitter {
  destroyed = false;
  destroyCalls = 0;
  requests: { headers: OutgoingHttpHeaders; signal: AbortSignal; stream: FakeStream }[] = [];
  onEnd: (stream: FakeStream) => void = () => {};
  request(headers: OutgoingHttpHeaders, options: { signal: AbortSignal }) {
    const stream = new FakeStream();
    stream.onEnd = this.onEnd;
    this.requests.push({ headers, signal: options.signal, stream });
    return stream;
  }
  destroy() { this.destroyCalls++; this.destroyed = true; this.emit("close"); }
}

function fakeTransport(onEnd: (stream: FakeStream) => void, connected = true) {
  const calls: { authority: string; options: unknown; session: FakeSession }[] = [];
  const port = ((authority: string | URL, options: unknown) => {
    const session = new FakeSession(); session.onEnd = onEnd;
    calls.push({ authority: String(authority), options, session });
    if (connected) queueMicrotask(() => session.emit("connect"));
    return session;
  }) as unknown as typeof connect;
  return { port, calls, requests: () => calls.flatMap(call => call.session.requests) };
}

// The referenced watchdog keeps the process alive while the gateway's deadline is unref'ed.
async function withinDeadline<T>(operation: Promise<T>): Promise<T> {
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => reject(new Error("APNs total deadline did not settle")), 1000);
    })]);
  } finally { clearTimeout(watchdog); }
}

test("APNs signs and sends one Expo reference, preserves unknown outcomes and bounds every send stage", async () => {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const directory = await mkdtemp(join(tmpdir(), "yuyoufang-apns-test-"));
  const keyFile = join(directory, "synthetic-key.p8");
  try {
    await writeFile(keyFile, keys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    assert.equal(await readApnsPushConfig({}), null);
    const config = await readApnsPushConfig({ IOS_PUSH_ENABLED: "true", APNS_TEAM_ID: "TEAM000001",
      APNS_KEY_ID: "KEY0000001", APNS_BUNDLE_ID: "org.yuyoufang.app", APNS_ENVIRONMENT: "production",
      APNS_PRIVATE_KEY_FILE: keyFile });
    assert.ok(config);
    assert.deepEqual({ topic: config.topic, environment: config.environment },
      { topic: "org.yuyoufang.app", environment: "production" });

    const token = "AB".repeat(32);
    const reference = { v: 1 as const, kind: "test" as const, bindingId: "00000000-0000-4000-8000-000000000001",
      bindingVersion: 2, deliveryId: "00000000-0000-4000-8000-000000000002" };
    const signal = new AbortController().signal;
    const invalidatedAt = Date.now() - 1000;
    let mode = "accepted", authorityChecks = 0, authorityChecksAtPost = 0;
    const transport = fakeTransport(stream => {
      authorityChecksAtPost = authorityChecks;
      queueMicrotask(() => {
      if (mode === "incomplete") {
        stream.emit("response", { ":status": 200, "apns-id": reference.deliveryId });
        stream.emit("close");
      } else if (mode === "wrong-id") stream.respond(200, "00000000-0000-4000-8000-000000000099");
      else if (mode === "expired") stream.respond(410, reference.deliveryId, JSON.stringify({ reason: "Unregistered", timestamp: invalidatedAt }));
      else if (mode === "rejected") stream.respond(400, reference.deliveryId, JSON.stringify({ reason: "BadDeviceToken" }));
      else stream.respond(200, reference.deliveryId);
      });
    });
    const gateway = createApnsPushGateway(config, { connect: transport.port });
    const allowed = async () => { authorityChecks++; return true; };
    const before = Math.floor(Date.now() / 1000);
    const accepted = await gateway.send(token, reference, signal, allowed);
    assert.equal(accepted.status, "accepted"); assert.equal(accepted.providerStatus, 200);
    assert.equal(authorityChecks, 1); assert.equal(authorityChecksAtPost, 1);
    assert.equal(transport.requests().length, 1);
    const request = transport.requests()[0];
    assert.deepEqual(transport.calls[0].options, { settings: { enablePush: false } });
    assert.equal(transport.calls[0].authority, "https://api.push.apple.com");
    assert.equal(request.headers[":method"], "POST");
    assert.equal(request.headers[":path"], "/3/device/" + token.toLowerCase());
    assert.equal(request.headers["apns-topic"], config.topic);
    assert.equal(request.headers["apns-push-type"], "alert");
    assert.equal(request.headers["apns-priority"], "5");
    assert.equal(request.headers["apns-id"], reference.deliveryId);
    assert.equal(request.headers["apns-collapse-id"], reference.deliveryId);
    const jwt = String(request.headers.authorization).replace(/^bearer /u, "").split(".");
    assert.equal(jwt.length, 3);
    assert.deepEqual(JSON.parse(Buffer.from(jwt[0], "base64url").toString()), { alg: "ES256", kid: config.keyId });
    const claims = JSON.parse(Buffer.from(jwt[1], "base64url").toString());
    assert.equal(claims.iss, config.teamId);
    assert.ok(claims.iat >= before && claims.iat <= Math.floor(Date.now() / 1000));
    assert.equal(verify("sha256", Buffer.from(jwt[0] + "." + jwt[1]),
      { key: keys.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(jwt[2], "base64url")), true);
    const payload = JSON.parse(request.stream.body);
    assert.deepEqual(payload, { aps: { alert: { title: nativePushContent.test.title,
      body: "這是本人 iOS 通知測試，沒有孩子資料。" }, sound: "default" },
      body: { ...reference, v: "1", bindingVersion: "2" } });
    assert.deepEqual(parseNativePushData(payload.body), reference);
    assert.ok(accepted.message);
    assert.deepEqual({ title: accepted.message.title, body: accepted.message.body }, payload.aps.alert);
    assert.equal(accepted.message.contentVersion, "native-push-generic-v1");
    assert.ok(Date.parse(accepted.message.sentAt));

    mode = "wrong-id";
    assert.equal((await gateway.send(token, reference, signal, allowed)).status, "unknown");
    assert.equal(transport.requests().length, 2);
    mode = "incomplete";
    const incomplete = await gateway.send(token, reference, signal, allowed);
    assert.equal(incomplete.status, "unknown"); assert.equal(incomplete.message, undefined);
    assert.equal(transport.requests().length, 3);
    mode = "expired";
    assert.deepEqual(await gateway.send(token, reference, signal, allowed),
      { status: "rejected", reason: "subscription_expired", providerStatus: 410, apnsInvalidatedAt: invalidatedAt });
    assert.equal(transport.requests().length, 4);
    mode = "rejected";
    assert.deepEqual(await gateway.send(token, reference, signal, allowed),
      { status: "rejected", reason: "provider_rejected", providerStatus: 400 });
    assert.equal(transport.requests().length, 5);
    assert.deepEqual(await gateway.send(token, reference, signal, async () => false),
      { status: "stopped", reason: "revoked", providerStatus: null });
    const cancelled = new AbortController();
    assert.deepEqual(await gateway.send(token, reference, cancelled.signal, async () => { cancelled.abort(); return true; }),
      { status: "stopped", reason: "worker_interrupted", providerStatus: null });
    assert.equal(transport.requests().length, 5);
    const sessionsBeforeCancel = transport.calls.length;
    assert.equal((await gateway.send(token, reference, cancelled.signal, allowed)).reason, "worker_interrupted");
    assert.equal(transport.calls.length, sessionsBeforeCancel);
    assert.ok(transport.calls.every(call => call.authority === "https://api.push.apple.com" && call.session.destroyCalls === 1));
    assert.ok(transport.requests().every(sent => sent.stream.destroyed && sent.stream.closeCodes.length === 1));

    const interrupted = new AbortController();
    const lost = fakeTransport(() => interrupted.abort());
    const unknown = await createApnsPushGateway(config, { connect: lost.port }).send(token, reference, interrupted.signal, allowed);
    assert.deepEqual(unknown, { status: "unknown", reason: "transport_unknown", providerStatus: null });
    assert.equal(lost.calls.length, 1); assert.equal(lost.requests().length, 1);
    assert.equal(lost.calls[0].session.destroyCalls, 1);
    assert.deepEqual(lost.requests()[0].stream.closeCodes, [constants.NGHTTP2_CANCEL]);

    const hangingConnect = fakeTransport(() => {}, false);
    const connecting = await withinDeadline(createApnsPushGateway(config, { connect: hangingConnect.port, deadlineMs: 20 })
      .send(token, reference, signal, allowed));
    assert.equal(connecting.reason, "worker_interrupted"); assert.equal(connecting.status, "stopped");
    assert.equal(hangingConnect.calls.length, 1); assert.equal(hangingConnect.requests().length, 0);
    assert.equal(hangingConnect.calls[0].session.destroyCalls, 1);
    const hangingAuthority = fakeTransport(() => {});
    const authorizing = await withinDeadline(createApnsPushGateway(config, { connect: hangingAuthority.port, deadlineMs: 20 })
      .send(token, reference, signal, () => new Promise<boolean>(() => {})));
    assert.equal(authorizing.reason, "worker_interrupted"); assert.equal(authorizing.status, "stopped");
    assert.equal(hangingAuthority.calls.length, 1); assert.equal(hangingAuthority.requests().length, 0);
    assert.equal(hangingAuthority.calls[0].session.destroyCalls, 1);
  } finally { await unlink(keyFile).catch(() => {}); await rmdir(directory); }
});

test('APNs rejects malformed 410 timestamps without treating the token as invalid or the send as accepted', async () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const config = { topic: 'org.yuyoufang.app', environment: 'sandbox' as const,
    teamId: 'TEAM000001', keyId: 'KEY0000001', privateKey };
  const reference = { v: 1 as const, kind: 'test' as const, bindingId: '00000000-0000-4000-8000-000000000001',
    bindingVersion: 1, deliveryId: '00000000-0000-4000-8000-000000000002' };
  for (const timestamp of [undefined, null, '1234567890000', -1, 1.5, 8_640_000_000_000_001, Infinity]) {
    const transport = fakeTransport(stream => queueMicrotask(() => stream.respond(410, reference.deliveryId,
      JSON.stringify({ reason: 'Unregistered', timestamp }))));
    const result = await createApnsPushGateway(config, { connect: transport.port })
      .send('ab'.repeat(32), reference, new AbortController().signal, async () => true);
    assert.deepEqual(result, { status: 'rejected', reason: 'provider_rejected', providerStatus: 410 });
    assert.equal(transport.requests().length, 1);
  }
});

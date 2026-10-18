import test from "node:test";
import assert from "node:assert/strict";
import { createNativePushGateway, readNativePushConfig } from "../server/native-push-gateway.ts";
import { ANDROID_PUSH_PACKAGE, parseNativePushData } from "../src/shared/native-push.ts";

test("Android FCM sends one fixed reference, rechecks authority and never retries an unknown result", async () => {
  const config = { projectId: "synthetic-push" }, token = "synthetic-device-token-only";
  const reference = { v: 1 as const, kind: "care" as const, bindingId: "00000000-0000-4000-8000-000000000001", bindingVersion: 2,
    deliveryId: "00000000-0000-4000-8000-000000000002" };
  const wire = { ...reference, v: "1", bindingVersion: "2" };
  assert.deepEqual(parseNativePushData(wire), reference);
  assert.equal(parseNativePushData({ ...wire, url: "https://untrusted.invalid" }), null);
  let calls = 0, valid = true, mode = "accepted", checked = false;
  const gateway = createNativePushGateway(config, { accessToken: async () => { checked = false; return "synthetic-credential"; },
    fetch: (async (url, init) => {
      calls++; assert.equal(checked, true); assert.equal(String(url), "https://fcm.googleapis.com/v1/projects/synthetic-push/messages:send");
      assert.equal(init?.redirect, "error"); const body = JSON.parse(String(init?.body));
      assert.equal(body.message.token, token); assert.equal(body.message.android.restricted_package_name, ANDROID_PUSH_PACKAGE);
      assert.deepEqual(Object.keys(body.message.data).sort(), ["bindingId", "bindingVersion", "deliveryId", "kind", "v"]);
      assert.equal(body.message.notification.body, "請開啟育有方查看實際事項。收到提示不代表照護事項完成。");
      if (mode === "unknown") throw new Error("Lost response after send");
      if (mode === "expired") return Response.json({ error: { details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] } }, { status: 404 });
      return Response.json({ name: "projects/synthetic-push/messages/synthetic-message" });
    }) as typeof fetch });
  const allowed = async () => { checked = true; return valid; }, signal = new AbortController().signal;
  assert.equal(readNativePushConfig({}), null);
  assert.equal((await gateway.send(token, reference, signal, allowed)).status, "accepted"); assert.equal(calls, 1);
  valid = false; assert.equal((await gateway.send(token, reference, signal, allowed)).reason, "revoked"); assert.equal(calls, 1);
  valid = true; mode = "unknown"; assert.equal((await gateway.send(token, reference, signal, allowed)).status, "unknown"); assert.equal(calls, 2);
  mode = "expired"; assert.equal((await gateway.send(token, reference, signal, allowed)).reason, "subscription_expired"); assert.equal(calls, 3);
  const aborted = new AbortController(); aborted.abort();
  assert.equal((await gateway.send(token, reference, aborted.signal, allowed)).status, "stopped"); assert.equal(calls, 3);
  const extra = { ...reference, childName: "must never be sent" };
  assert.equal((await gateway.send(token, extra, signal, allowed)).reason, "request_invalid"); assert.equal(calls, 3);
});

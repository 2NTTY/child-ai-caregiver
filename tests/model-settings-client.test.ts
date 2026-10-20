import assert from "node:assert/strict";
import test from "node:test";
import { createModelSettingsApi, ModelSettingsApiError, readModelSettingsRecovery } from "../src/client/model-settings-api.ts";
import { PERSONAL_MODEL, type ModelSettingsCommand } from "../src/shared/model-settings.ts";

const settings = { version: 2, mode: "personal", provider: "gemini", model: PERSONAL_MODEL,
  keyConfigured: true, backgroundEnabled: false, dailyLimit: 100, maxModelCalls: 8, maxQueryEmbeddings: 4, updatedAt: "2026-09-30T00:00:00.000Z" };
const usage = { day: "2026-09-30", attempts: 1, inputTokens: 10, outputTokens: 2, cachedTokens: 0, unknownUsageAttempts: 0 };
const view = { settings, enabled: true, platformAvailable: true, personalAvailable: true, personalGlobalLimit: 500,
  usage: { platform: { ...usage, billingSource: "platform" }, personal: { ...usage, attempts: 0, billingSource: "personal" } } };
const signal = () => new AbortController().signal;
const command = (): ModelSettingsCommand => ({ expectedVersion: 1, mode: "personal", apiKey: "synthetic-private-key",
  backgroundEnabled: false, dailyLimit: 100, maxModelCalls: 8, maxQueryEmbeddings: 4, consent: true });

test("model settings use direct account-bound requests and allowlist secret-free responses", async () => {
  const paths: string[] = [];
  const api = createModelSettingsApi("https://example.test/api/", async (input, init) => {
    const url = String(input); paths.push(url);
    assert.equal(url.includes("synthetic-private-key"), false);
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), "alice");
    if (init?.method === "GET") { assert.equal(init.body, undefined); return Response.json(view); }
    const body = JSON.parse(String(init?.body));
    if (url.endsWith("/check")) {
      assert.deepEqual(body, { expectedVersion: 2 });
      return Response.json({ version: 2, status: "accessible", scope: "model_metadata_only" });
    }
    const { opId, ...safe } = body;
    assert.match(opId, /^[a-f0-9-]{36}$/); assert.deepEqual(safe, command());
    return Response.json(settings);
  });
  assert.deepEqual(await api.save({ ...command(), extraField: "not forwarded" } as ModelSettingsCommand, signal(), "alice"), settings);
  assert.deepEqual(await api.read(signal(), "alice"), view);
  assert.equal((await api.check(2, signal(), "alice")).scope, "model_metadata_only");
  assert.deepEqual(paths, ["https://example.test/api/ai/settings", "https://example.test/api/ai/settings", "https://example.test/api/ai/settings/check"]);

  const leaked = createModelSettingsApi("/api", async () => Response.json({ ...view, settings: { ...settings, apiKey: "private" } }));
  await assert.rejects(leaked.read(signal(), "alice"), error => error instanceof ModelSettingsApiError && !error.message.includes("private"));
});

test("an unknown model settings save never replays or retains a key for subsequent reads", async () => {
  const methods: string[] = [];
  const api = createModelSettingsApi("/api", async (input, init) => {
    methods.push(String(init?.method));
    if (init?.method === "POST") throw new Error("synthetic-private-key provider error");
    assert.equal(String(input).includes("synthetic-private-key"), false);
    assert.equal(init?.body, undefined);
    assert.equal(new Headers(init?.headers).has("x-operation-id"), false);
    return Response.json(view);
  });
  await assert.rejects(api.save(command(), signal(), "alice"), error =>
    error instanceof ModelSettingsApiError && error.unknownResult && error.code === null && !error.message.includes("synthetic-private-key"));
  assert.deepEqual(methods, ["POST"]);
  await api.read(signal(), "alice");
  assert.deepEqual(methods, ["POST", "GET"]);
});

test("model settings errors expose only known codes and aborted late responses cannot confirm saves", async () => {
  const uncertain = createModelSettingsApi("/api", async () => Response.json({ error: { code: "unavailable" } }, { status: 503 }));
  await assert.rejects(uncertain.save(command(), signal(), "alice"), error => error instanceof ModelSettingsApiError && error.unknownResult);
  const rejected = createModelSettingsApi("/api", async () =>
    Response.json({ error: { code: "version_conflict", message: "synthetic-private-key" } }, { status: 409 }));
  await assert.rejects(rejected.save(command(), signal(), "alice"), error => error instanceof ModelSettingsApiError
    && error.code === "version_conflict" && error.status === 409 && !error.unknownResult && !error.message.includes("synthetic-private-key"));
  const controller = new AbortController();
  let resolve: (value: Response) => void = () => {};
  const late = createModelSettingsApi("/api", () => new Promise<Response>(done => { resolve = done; }));
  const saving = late.save(command(), controller.signal, "alice");
  controller.abort(); resolve(Response.json(settings));
  await assert.rejects(saving, error => error instanceof ModelSettingsApiError && error.unknownResult);
});

test("settings recovery keeps a missing in-flight receipt unknown and never resends the key", async () => {
  let original: { opId: string; expectedVersion: number } | null = null;
  let phase = "pending", posts = 0;
  const api = createModelSettingsApi("/api", async (input, init) => {
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), "alice");
    if (init?.method === "POST") {
      posts++;
      const body = JSON.parse(String(init.body));
      original = { opId: body.opId, expectedVersion: body.expectedVersion };
      throw new Error("synthetic lost response");
    }
    assert.equal(init?.body, undefined);
    if (String(input).includes("/operations/")) {
      assert.equal(String(input).endsWith(original!.opId), true);
      return Response.json(phase === "confirmed" ? { opId: original!.opId, settings } : null);
    }
    return Response.json({ ...view, settings: { ...settings, version: phase === "pending" ? 1 : 2 } });
  });
  await assert.rejects(api.save(command(), signal(), "alice"), error => error instanceof ModelSettingsApiError
    && error.operationId === original?.opId && error.unknownResult);
  assert.ok(original);
  assert.equal((await readModelSettingsRecovery(api, original, signal(), "alice")).outcome, "unknown");
  phase = "confirmed";
  const recovered = await readModelSettingsRecovery(api, original, signal(), "alice");
  assert.equal(recovered.outcome, "confirmed");
  assert.equal(recovered.snapshot.settings.version, 2);
  assert.equal(JSON.stringify(recovered).includes(command().apiKey!), false);
  phase = "superseded";
  assert.equal((await readModelSettingsRecovery(api, original, signal(), "alice")).outcome, "superseded");
  assert.equal(posts, 1);
});

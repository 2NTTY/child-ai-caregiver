import assert from "node:assert/strict";
import test from "node:test";
import { createModelSettingsApi, ModelSettingsApiError, readModelSettingsRecovery } from "../src/client/model-settings-api.ts";
import { MODEL_SETTINGS_V3_MEDIA_TYPE, PERSONAL_MODEL, type ModelSettingsCommand } from "../src/shared/model-settings.ts";

const settings = { version: 2, mode: "personal", provider: "gemini", model: PERSONAL_MODEL,
  keyConfigured: true, backgroundEnabled: false, dailyLimit: 100, maxModelCalls: 8, maxQueryEmbeddings: 4, updatedAt: "2026-09-30T00:00:00.000Z" };
const usage = { day: "2026-09-30", attempts: 1, inputTokens: 10, outputTokens: 2, cachedTokens: 0, unknownUsageAttempts: 0 };
const view = { settings, enabled: true, platformAvailable: true, personalAvailable: true, personalGlobalLimit: 500,
  usage: { platform: { ...usage, billingSource: "platform" }, personal: { ...usage, attempts: 0, billingSource: "personal" } } };
const signal = () => new AbortController().signal;
const command = (): ModelSettingsCommand => ({ expectedVersion: 1, mode: "personal", apiKey: "synthetic-private-key",
  backgroundEnabled: false, dailyLimit: 100, maxModelCalls: 8, maxQueryEmbeddings: 4, consent: true });
const compatibleSettings = { ...settings, provider: "openai-compatible", model: "provider/chat-model",
  baseUrl: "https://provider.example/v1", embeddingKeyConfigured: true };
const compatibleCommand = (): ModelSettingsCommand => ({ ...command(), provider: "openai-compatible",
  model: compatibleSettings.model, baseUrl: compatibleSettings.baseUrl, embeddingApiKey: "synthetic-embedding-key" });

test("model settings use direct account-bound requests and allowlist secret-free responses", async () => {
  const paths: string[] = [];
  const api = createModelSettingsApi("https://example.test/api/", async (input, init) => {
    const url = String(input); paths.push(url);
    assert.equal(url.includes("synthetic-private-key"), false);
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("Accept"), MODEL_SETTINGS_V3_MEDIA_TYPE);
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

  for (const secretField of ["apiKey", "embeddingApiKey"]) {
    const leaked = createModelSettingsApi("/api", async () => Response.json({ ...view, settings: { ...compatibleSettings, [secretField]: "private" } }));
    await assert.rejects(leaked.read(signal(), "alice"), error => error instanceof ModelSettingsApiError && !error.message.includes("private"));
  }
});

test("v3 compatible settings send both keys once and serialize independent key removal", async () => {
  const opId = "84069425-f130-4cf5-9ee9-0d290b1a9bb2";
  const removeOpId = "fca94bb1-a8e7-4b5c-9402-b7fe1ce7630a";
  let saves = 0;
  const api = createModelSettingsApi("/api", async (input, init) => {
    assert.equal(String(input), "/api/ai/settings");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Accept"), MODEL_SETTINGS_V3_MEDIA_TYPE);
    assert.equal(headers.get("x-expected-user-id"), "alice");
    assert.equal(JSON.stringify([...headers]).includes("synthetic-"), false);
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    const body = JSON.parse(String(init?.body));
    saves++;
    if (saves === 1) {
      assert.deepEqual(body, { ...compatibleCommand(), opId, removeEmbeddingKey: false });
      return Response.json(compatibleSettings);
    }
    assert.deepEqual(body, { opId: removeOpId, expectedVersion: 2, mode: "personal", provider: "openai-compatible",
      model: compatibleSettings.model, baseUrl: compatibleSettings.baseUrl, removeKey: true, removeEmbeddingKey: true,
      backgroundEnabled: false, dailyLimit: 100, maxModelCalls: 8, maxQueryEmbeddings: 4, consent: true });
    return Response.json({ ...compatibleSettings, version: 3, keyConfigured: false, embeddingKeyConfigured: false });
  });
  assert.deepEqual(await api.save({ ...compatibleCommand(), opId, removeEmbeddingKey: false }, signal(), "alice"), compatibleSettings);
  const removed = await api.save({ ...compatibleCommand(), opId: removeOpId, expectedVersion: 2, apiKey: undefined, embeddingApiKey: undefined,
    removeKey: true, removeEmbeddingKey: true }, signal(), "alice");
  assert.equal(removed.keyConfigured, false);
  assert.equal(removed.embeddingKeyConfigured, false);
  assert.equal(saves, 2);
});

test("compatible local catalogs and unsupported metadata do not prevent direct model saves", async () => {
  const paths: string[] = [];
  const catalog = { version: 2, provider: "openai-compatible", scope: "model_metadata_only", status: "not_checked",
    truncated: false, models: [], embedding: { model: "gemini-embedding-001", dimensions: 1024, status: "not_checked" } };
  const api = createModelSettingsApi("/api", async (input, init) => {
    const url = String(input); paths.push(url);
    assert.equal(new Headers(init?.headers).get("Accept"), MODEL_SETTINGS_V3_MEDIA_TYPE);
    if (url.endsWith("/models?provider=openai-compatible")) {
      assert.equal(init?.method, "GET");
      assert.equal(init?.body, undefined);
      return Response.json(catalog);
    }
    if (url.endsWith("/models") || url.endsWith("/check")) {
      assert.deepEqual(JSON.parse(String(init?.body)), { expectedVersion: 2 });
      return Response.json(url.endsWith("/models") ? { ...catalog, status: "unavailable", reason: "metadata_unsupported" }
        : { version: 2, status: "unavailable", scope: "model_metadata_only", reason: "metadata_unsupported" });
    }
    assert.equal(JSON.parse(String(init?.body)).model, compatibleSettings.model);
    return Response.json({ ...compatibleSettings, version: 3 });
  });
  assert.deepEqual(await api.catalog(2, false, signal(), "alice", "openai-compatible"), catalog);
  assert.equal((await api.catalog(2, true, signal(), "alice")).reason, "metadata_unsupported");
  assert.equal((await api.check(2, signal(), "alice")).reason, "metadata_unsupported");
  assert.equal((await api.save({ ...compatibleCommand(), expectedVersion: 2 }, signal(), "alice")).version, 3);
  assert.deepEqual(paths, ["/api/ai/settings/models?provider=openai-compatible", "/api/ai/settings/models", "/api/ai/settings/check", "/api/ai/settings"]);
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

test("v3 settings recovery keeps the original operation and never resends either key", async () => {
  let original: { opId: string; expectedVersion: number } | null = null;
  let phase = "pending", posts = 0;
  const api = createModelSettingsApi("/api", async (input, init) => {
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), "alice");
    assert.equal(new Headers(init?.headers).get("Accept"), MODEL_SETTINGS_V3_MEDIA_TYPE);
    if (init?.method === "POST") {
      posts++;
      const body = JSON.parse(String(init.body));
      assert.equal(body.apiKey, compatibleCommand().apiKey);
      assert.equal(body.embeddingApiKey, compatibleCommand().embeddingApiKey);
      original = { opId: body.opId, expectedVersion: body.expectedVersion };
      throw new Error("synthetic lost response");
    }
    assert.equal(init?.body, undefined);
    assert.equal(String(input).includes("synthetic-"), false);
    if (String(input).includes("/operations/")) {
      assert.equal(String(input).endsWith(original!.opId), true);
      return Response.json(phase === "confirmed" ? { opId: original!.opId, settings: compatibleSettings } : null);
    }
    return Response.json({ ...view, settings: { ...compatibleSettings, version: phase === "pending" ? 1 : 2 } });
  });
  await assert.rejects(api.save(compatibleCommand(), signal(), "alice"), error => error instanceof ModelSettingsApiError
    && error.operationId === original?.opId && error.unknownResult);
  assert.ok(original);
  assert.equal((await readModelSettingsRecovery(api, original, signal(), "alice")).outcome, "unknown");
  phase = "confirmed";
  const recovered = await readModelSettingsRecovery(api, original, signal(), "alice");
  assert.equal(recovered.outcome, "confirmed");
  assert.equal(recovered.snapshot.settings.version, 2);
  assert.deepEqual(recovered.snapshot.settings, compatibleSettings);
  assert.equal(JSON.stringify(recovered).includes(compatibleCommand().apiKey!), false);
  assert.equal(JSON.stringify(recovered).includes(compatibleCommand().embeddingApiKey!), false);
  phase = "superseded";
  assert.equal((await readModelSettingsRecovery(api, original, signal(), "alice")).outcome, "superseded");
  assert.equal(posts, 1);
});

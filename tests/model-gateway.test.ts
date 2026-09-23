import assert from "node:assert/strict";
import test from "node:test";
import { readAiConfig } from "../server/ai-config.ts";
import { AiFailure, ProviderFailure, createModelGateway } from "../server/model-gateway.ts";
import type { ModelProvider } from "../server/model-gateway.ts";
import type { AttemptRecord } from "../server/ai-usage.ts";

const input = { systemInstruction: "Synthetic instruction", messages: [{ role: "user" as const, text: "Synthetic question" }] };
const answer = { text: "Synthetic answer", usage: { inputTokens: 5, outputTokens: 3, cachedTokens: null } };
function setup(provider: ModelProvider, overrides = {}) {
  const recorded: AttemptRecord[] = [];
  let reservations = 0;
  const gateway = createModelGateway({
    config: { ...readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }), ...overrides },
    provider,
    usage: { reserve: async () => { reservations++; return true; }, record: async item => { recorded.push(item); } },
  });
  return { gateway, recorded, reservations: () => reservations };
}
const yes = async () => true;
test("denied authorization, disabled AI and invalid input never reserve or call a provider", async () => {
  let calls = 0;
  const provider = { generate: async () => { calls++; return answer; } };
  const enabled = setup(provider);
  await assert.rejects(enabled.gateway.generate("owner", "child", input, async () => false), { code: "unauthorized" });
  await assert.rejects(enabled.gateway.generate("owner", "child", { ...input, messages: [] }, yes), { code: "invalid_input" });
  const disabled = setup(provider, { enabled: false });
  await assert.rejects(disabled.gateway.generate("owner", "child", input, yes), { code: "ai_disabled" });
  assert.equal(calls, 0);
  assert.equal(enabled.reservations() + disabled.reservations(), 0);
});
test("exhausted durable quota fails closed before provider execution", async () => {
  const gateway = createModelGateway({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    provider: { generate: async () => { throw new Error("Must not call"); } },
    usage: { reserve: async () => false, record: async () => { throw new Error("Must not record a call"); } },
  });
  await assert.rejects(gateway.generate("owner", "child", input, yes), { code: "ai_quota_exceeded" });
});
test("successful generation returns the reply and records metadata without prompt or reply text", async () => {
  const s = setup({ generate: async () => answer });
  assert.deepEqual(await s.gateway.generate("owner", "child", input, yes), answer);
  assert.equal(s.reservations(), 1);
  assert.equal(s.recorded[0]?.outcome, "succeeded");
  assert.equal(s.recorded[0]?.cachedTokens, null);
  assert.doesNotMatch(JSON.stringify(s.recorded), /Synthetic (question|answer|instruction)/);
});
test("only an explicit rate limit receives one bounded retry and each attempt consumes quota", async () => {
  let calls = 0;
  const s = setup({ generate: async () => { if (++calls === 1) throw new ProviderFailure("rate_limited"); return answer; } });
  await s.gateway.generate("owner", "child", input, yes);
  assert.equal(calls, 2);
  assert.equal(s.reservations(), 2);
  assert.deepEqual(s.recorded.map(row => row.outcome), ["rate_limited", "succeeded"]);
});
test("unknown provider failures are sanitized and never retried", async () => {
  let calls = 0;
  const s = setup({ generate: async () => { calls++; throw new Error("secret-synthetic-provider-body"); } });
  await assert.rejects(s.gateway.generate("owner", "child", input, yes), error => {
    assert.ok(error instanceof AiFailure);
    assert.equal(error.code, "ai_unavailable");
    assert.doesNotMatch(String(error), /secret-synthetic/);
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(s.recorded[0]?.outcome, "unavailable");
});
test("timeouts abort the provider, do not retry, and release the account concurrency slot", async () => {
  let signal: AbortSignal | undefined;
  const s = setup({ generate: async (_, options) => { signal = options.signal; return new Promise(() => {}); } }, { timeoutMs: 10 });
  await assert.rejects(s.gateway.generate("owner", "child", input, yes), { code: "ai_timeout" });
  assert.equal(signal?.aborted, true);
  await assert.rejects(s.gateway.generate("owner", "child", input, yes), { code: "ai_timeout" });
  assert.equal(s.reservations(), 2);
});
test("concurrent requests from one account are rejected and revocation prevents returning a reply", async () => {
  let finish: ((value: typeof answer) => void) | undefined;
  let entered: (() => void) | undefined;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const s = setup({ generate: async () => { entered!(); return new Promise(resolve => { finish = resolve; }); } });
  let allowed = true;
  const pending = s.gateway.generate("owner", "child", input, async () => allowed);
  await started;
  await assert.rejects(s.gateway.generate("owner", "child", input, yes), { code: "ai_busy" });
  allowed = false;
  finish!(answer);
  await assert.rejects(pending, { code: "unauthorized" });
  assert.equal(s.recorded[0]?.outcome, "unauthorized");
});
test("invalid model output is rejected without returning provider data", async () => {
  const s = setup({ generate: async () => ({ ...answer, text: "" }) });
  await assert.rejects(s.gateway.generate("owner", "child", input, yes), { code: "ai_unavailable" });
  assert.equal(s.recorded[0]?.outcome, "invalid_response");
});
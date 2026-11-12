import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { AGENT_OUTPUT_LIMITS } from "../src/shared/agent-run-limits.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { clearLocalFirestoreAgentAdmission, createFirestoreAgentAdmission } from "../server/firestore-agent-admission.ts";
import { localAgentAiEnvironment } from "../server/local-agent-config.ts";
import { readLocalAgentModel } from "../server/local-agent-model.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { firestoreDomainFixture } from "./helpers/firestore-domain-memory.ts";

test("local agent ai environment preserves production defaults and forwards explicit overrides", () => {
  const prod = readAiConfig({});
  assert.equal(prod.dailyUserAttempts, 20);
  assert.equal(prod.dailyGlobalAttempts, 100);
  assert.equal(prod.maxOutputTokens, 1024);

  const localEnv = localAgentAiEnvironment({});
  assert.deepEqual(localEnv, {
    AI_MAX_OUTPUT_TOKENS: String(AGENT_OUTPUT_LIMITS.default),
  });

  const local = readLocalAgentModel({
    NODE_ENV: "development",
    YUYF_LOCAL_DEVELOPMENT: "1",
    AI_ENABLED: "true",
    GCP_PROJECT_ID: "demo-yuyf-12345678",
    LOCAL_MODEL_PROVIDER: "gemini",
    LOCAL_MODEL_API_KEY: "synthetic-key",
    GEMINI_MODEL: "gemini-3.1-flash-lite",
    ...localEnv,
  });
  assert.equal(local.modelConfig.dailyUserAttempts, prod.dailyUserAttempts);
  assert.equal(local.modelConfig.dailyGlobalAttempts, prod.dailyGlobalAttempts);
  assert.equal(local.modelConfig.maxOutputTokens, AGENT_OUTPUT_LIMITS.default);

  const overridden = localAgentAiEnvironment({
    AI_DAILY_USER_ATTEMPTS: "45",
    AI_CHAT_DELIVERY_REVIEW_MODEL_CALLS: "6",
  }, { maxOutputTokens: 8192 });
  assert.equal(overridden.AI_DAILY_USER_ATTEMPTS, "45");
  assert.equal(overridden.AI_MAX_OUTPUT_TOKENS, "8192");
  assert.equal(overridden.AI_CHAT_DELIVERY_REVIEW_MODEL_CALLS, "6");
});

test("clear local firestore agent admission rejects non-local envs and drops stale local leases", async () => {
  const fake = firestoreDomainFixture();
  const admissionOptions = {
    database: fake.database,
    cipher: createStorageCipher(Buffer.alloc(32, 31)),
    projectId: "demo-local-admission",
    namespace: "local_agent",
  };
  await assert.rejects(() => clearLocalFirestoreAgentAdmission(admissionOptions, { NODE_ENV: "production" }));

  const admission = createFirestoreAgentAdmission(admissionOptions);
  const held = await admission.acquire({ runId: randomUUID(), userId: "parent-1", deadlineAtMs: Date.now() + 300_000 });
  assert.ok(held);
  assert.equal(await admission.acquire({ runId: randomUUID(), userId: "parent-1", deadlineAtMs: Date.now() + 300_000 }), null);

  const localEnv = {
    NODE_ENV: "development", YUYF_LOCAL_DEVELOPMENT: "1", HOST: "127.0.0.1", PORT: "33050",
    SERVER_ORIGIN: "http://127.0.0.1:33050", WEB_ORIGIN: "http://127.0.0.1:33050",
    GCP_PROJECT_ID: "demo-local-admission", FIREBASE_DATABASE_ID: "(default)", FIREBASE_NAMESPACE: "local_agent",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:33052", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:33053",
    FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:33054", STORAGE_EMULATOR_HOST: "http://127.0.0.1:33054",
    FIREBASE_PHOTO_BUCKET: "demo-local-admission-private", FIREBASE_ERASURE_BUCKET: "demo-local-admission-journal",
    WEB_PUSH_ENABLED: "false", ANDROID_PUSH_ENABLED: "false", TELEGRAM_ENABLED: "false", FIREBASE_AUTH_EMAIL_ENABLED: "false",
  };
  await clearLocalFirestoreAgentAdmission(admissionOptions, localEnv);
  assert.equal(await held.authorize(), false);
  const reacquired = await admission.acquire({ runId: randomUUID(), userId: "parent-1", deadlineAtMs: Date.now() + 300_000 });
  assert.ok(reacquired);
  await reacquired.release();
});

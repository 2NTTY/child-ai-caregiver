import assert from "node:assert/strict";
import test from "node:test";
import { readAiConfig } from "../server/ai-config.ts";

test("AI configuration defaults to a disabled server-only setup", () => {
  assert.deepEqual(readAiConfig({}), {
    enabled: false,
    project: "",
    location: "global",
    model: "gemini-3.1-flash-lite",
    dailyUserAttempts: 20,
    dailyGlobalAttempts: 100,
    maxAttempts: 2,
    timeoutMs: 30000,
    maxInputCharacters: 10000,
    maxOutputTokens: 1024,
  });
  assert.equal(readAiConfig({ GCP_PROJECT_ID: "" }).project, "");
});

test("AI configuration accepts safe identifiers and numeric boundaries", () => {
  assert.deepEqual(readAiConfig({
    AI_ENABLED: "true",
    GCP_PROJECT_ID: "care-project-123",
    VERTEX_LOCATION: "asia-east1",
    GEMINI_MODEL: "gemini-2.5-flash",
    AI_DAILY_USER_ATTEMPTS: "1",
    AI_DAILY_GLOBAL_ATTEMPTS: "10000",
    AI_MAX_ATTEMPTS: "1",
    AI_TIMEOUT_MS: "60000",
    AI_MAX_INPUT_CHARACTERS: "20000",
    AI_MAX_OUTPUT_TOKENS: "4096",
  }), {
    enabled: true,
    project: "care-project-123",
    location: "asia-east1",
    model: "gemini-2.5-flash",
    dailyUserAttempts: 1,
    dailyGlobalAttempts: 10000,
    maxAttempts: 1,
    timeoutMs: 60000,
    maxInputCharacters: 20000,
    maxOutputTokens: 4096,
  });
});

test("AI configuration requires a valid project when enabled", () => {
  assert.throws(() => readAiConfig({ AI_ENABLED: "true" }), { message: "Invalid GCP_PROJECT_ID configuration" });
  for (const project of ["short", "Uppercase-project", "-invalid-project", "invalid-project-", "project/path", "https://example.com/project", "care-project\n"]) {
    assert.throws(() => readAiConfig({ GCP_PROJECT_ID: project }), { message: "Invalid GCP_PROJECT_ID configuration" });
  }
});

test("AI configuration rejects ambiguous booleans and unsafe URL components", () => {
  for (const value of ["TRUE", "1", "yes", " false", "false\n", ""]) {
    assert.throws(() => readAiConfig({ AI_ENABLED: value }), { message: "Invalid AI_ENABLED configuration" });
  }
  for (const value of ["https://example.com", "global/../other", "global?key=secret", "us-central1\n", "us-central1%2fother"]) {
    assert.throws(() => readAiConfig({ VERTEX_LOCATION: value }), { message: "Invalid VERTEX_LOCATION configuration" });
  }
  for (const value of ["https://example.com/model", "gemini/other", "gemini?key=secret", "gemini..flash", "gemini-3.1-flash-lite\u007f"]) {
    assert.throws(() => readAiConfig({ GEMINI_MODEL: value }), { message: "Invalid GEMINI_MODEL configuration" });
  }
});

test("AI configuration enforces integer ranges without leaking values", () => {
  const invalid: Record<string, string[]> = {
    AI_DAILY_USER_ATTEMPTS: ["0", "1001"],
    AI_DAILY_GLOBAL_ATTEMPTS: ["0", "10001"],
    AI_MAX_ATTEMPTS: ["0", "3"],
    AI_TIMEOUT_MS: ["999", "60001"],
    AI_MAX_INPUT_CHARACTERS: ["0", "20001"],
    AI_MAX_OUTPUT_TOKENS: ["0", "4097"],
  };
  for (const [key, values] of Object.entries(invalid)) {
    for (const value of [...values, "1.5", "1e3", "01", " 1", "1\n", "https://private.example/secret"]) {
      assert.throws(() => readAiConfig({ [key]: value }), { message: `Invalid ${key} configuration` });
    }
  }
});

test("AI configuration accepts documented multi-region locations", () => {
  for (const location of ["global", "us", "eu"]) assert.equal(readAiConfig({ VERTEX_LOCATION: location }).location, location);
});

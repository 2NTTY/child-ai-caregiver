import { AGENT_INTERACTIVE_INPUT } from "./agent-budget.ts";

import { resolveModelThinkingLevel } from "./model-thinking.ts";
import type { AgentThinkingLevel } from "./model-thinking.ts";
export type { AgentThinkingLevel } from "./model-thinking.ts";

export interface AiConfig {
  enabled: boolean;
  project: string;
  location: string;
  model: string;
  dailyUserAttempts: number;
  dailyGlobalAttempts: number;
  personalDailyGlobalAttempts?: number;
  maxAttempts: number;
  /** Server-resolved Agent retry policy; undefined keeps legacy callers single-attempt. */
  agentMaxRetries?: number;
  timeoutMs: number;
  maxInputCharacters: number;
  agentMaxInputCharacters?: number;
  agentThinkingLevel?: AgentThinkingLevel;
  maxOutputTokens: number;
}

function invalidConfig(key: string): never {
  throw new Error(`Invalid ${key} configuration`);
}

function readBoolean(value: string | undefined, key: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  return invalidConfig(key);
}

function readIdentifier(value: string | undefined, key: string, fallback: string, pattern: RegExp, maxLength: number): string {
  const result = value === undefined ? fallback : value;
  if (typeof result !== "string" || result.length > maxLength || !pattern.test(result)) invalidConfig(key);
  return result;
}

function readInteger(value: string | undefined, key: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) invalidConfig(key);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) invalidConfig(key);
  return result;
}

export function readAiConfig(env: Record<string, string | undefined>): AiConfig {
  const enabled = readBoolean(env.AI_ENABLED, "AI_ENABLED", false);
  const project = env.GCP_PROJECT_ID === undefined || env.GCP_PROJECT_ID === ""
    ? ""
    : readIdentifier(env.GCP_PROJECT_ID, "GCP_PROJECT_ID", "", /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u, 30);
  if (enabled && !project) invalidConfig("GCP_PROJECT_ID");

  const model = readIdentifier(env.GEMINI_MODEL, "GEMINI_MODEL", "gemini-3.1-flash-lite", /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u, 128);

  return {
    enabled,
    project,
    location: readIdentifier(env.VERTEX_LOCATION, "VERTEX_LOCATION", "global", /^(?:global|us|eu|[a-z]+(?:-[a-z]+)+[0-9])$/u, 64),
    model,
    dailyUserAttempts: readInteger(env.AI_DAILY_USER_ATTEMPTS, "AI_DAILY_USER_ATTEMPTS", 20, 1, 1000),
    dailyGlobalAttempts: readInteger(env.AI_DAILY_GLOBAL_ATTEMPTS, "AI_DAILY_GLOBAL_ATTEMPTS", 100, 1, 10000),
    personalDailyGlobalAttempts: readInteger(env.AI_PERSONAL_DAILY_GLOBAL_ATTEMPTS, "AI_PERSONAL_DAILY_GLOBAL_ATTEMPTS", 1000, 1, 10000),
    maxAttempts: readInteger(env.AI_MAX_ATTEMPTS, "AI_MAX_ATTEMPTS", 2, 1, 2),
    timeoutMs: readInteger(env.AI_TIMEOUT_MS, "AI_TIMEOUT_MS", 90000, 1000, 180000),
    maxInputCharacters: readInteger(env.AI_MAX_INPUT_CHARACTERS, "AI_MAX_INPUT_CHARACTERS", 10000, 1, 20000),
    agentMaxInputCharacters: readInteger(env.AI_AGENT_MAX_INPUT_CHARACTERS, "AI_AGENT_MAX_INPUT_CHARACTERS",
      AGENT_INTERACTIVE_INPUT.default, AGENT_INTERACTIVE_INPUT.min, AGENT_INTERACTIVE_INPUT.max),
    agentThinkingLevel: resolveModelThinkingLevel(model, env.AI_AGENT_THINKING_LEVEL),
    maxOutputTokens: readInteger(env.AI_MAX_OUTPUT_TOKENS, "AI_MAX_OUTPUT_TOKENS", 1024, 1, 4096),
  };
}

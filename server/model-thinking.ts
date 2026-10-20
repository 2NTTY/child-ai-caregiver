import { ThinkingLevel, type ThinkingConfig } from "@google/genai";

export type AgentThinkingLevel = "minimal" | "low" | "medium" | "high";

/** Gemini 2.5 uses token budgets; level enums are only sent to the existing Gemini 3 adapters. */
export function nativePersonalThinkingConfig(model: string): ThinkingConfig | undefined {
  if (model === 'gemini-2.5-pro') return { thinkingBudget: -1 };
  if (model === 'gemini-2.5-flash' || model === 'gemini-2.5-flash-lite') return { thinkingBudget: 0 };
  if (model === 'gemini-3.1-flash-lite' || model === 'gemini-3.8-flash') {
    return { thinkingLevel: nativeModelThinkingLevel(model) };
  }
  // New models use provider defaults instead of inheriting an incompatible optional parameter.
  return undefined;
}

export function resolveModelThinkingLevel(model: string, value: unknown = undefined): AgentThinkingLevel {
  // Only this exact model has a verified minimum different from the existing default.
  const level = value === undefined ? (model === "gemini-3.8-flash" ? "low" : "minimal") : value;
  if (model === "gemini-3.8-flash" && level === "minimal") {
    throw new Error("Invalid AI_AGENT_THINKING_LEVEL configuration");
  }
  switch (level) {
    case "minimal": return "minimal";
    case "low": return "low";
    case "medium": return "medium";
    case "high": return "high";
    default: throw new Error("Invalid AI_AGENT_THINKING_LEVEL configuration");
  }
}

export function nativeModelThinkingLevel(model: string, value: unknown = undefined): ThinkingLevel {
  switch (resolveModelThinkingLevel(model, value)) {
    case "minimal": return ThinkingLevel.MINIMAL;
    case "low": return ThinkingLevel.LOW;
    case "medium": return ThinkingLevel.MEDIUM;
    case "high": return ThinkingLevel.HIGH;
  }
}

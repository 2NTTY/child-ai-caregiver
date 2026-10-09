import { ThinkingLevel } from "@google/genai";

export type AgentThinkingLevel = "minimal" | "low" | "medium" | "high";

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

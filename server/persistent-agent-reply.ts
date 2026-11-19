import type { ProductAgent } from "./product-agent.ts";

/** A persistent transcript and run store cannot serve temporary conversations. */
export function bindPersistentAgent(agent: ProductAgent): ProductAgent {
  return {
    ...agent,
    async reply(...args: Parameters<ProductAgent["reply"]>) {
      const mode = args[6]?.conversationMode ?? "assistant";
      if (mode !== "assistant" && mode !== "chat_only") return null;
      return agent.reply(...args);
    },
  };
}

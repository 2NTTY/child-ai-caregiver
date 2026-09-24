import { randomUUID } from "node:crypto";
import { FunctionTool, InMemorySessionService, LlmAgent, Runner, StreamingMode, createEvent, setLogger } from "@google/adk";
import { z } from "zod";
import type { AiConfig } from "./ai-config.ts";
import type { AiUsageStore } from "./ai-usage.ts";
import { AGENT_LIMITS, AgentBudget, AgentStopped } from "./agent-budget.ts";
import type { AgentStopReason } from "./agent-budget.ts";
import { AgentGatewayModel } from "./agent-model-gateway.ts";
import type { AgentModelProvider } from "./agent-model-gateway.ts";
import { loadAgentPrompt } from "./agent-prompt.ts";

// The application owns metadata-only observability. ADK's default spans/logs may contain bodies.
process.env.ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS = "false";
setLogger(null);

export interface AgentScope {
  userId: string; workspaceId: string; childId: string; authorizationVersion: string; dataVersion: string;
}
export interface AgentToolResult {
  status: "succeeded" | "rejected" | "conflict" | "failed" | "unknown";
  reference?: string;
  data?: Record<string, unknown>;
}
export interface AgentTool {
  name: string;
  description: string;
  parameters: z.ZodObject;
  authorize: (args: Record<string, unknown>, scope: Readonly<AgentScope>) => Promise<boolean>;
  execute: (args: Record<string, unknown>, context: { scope: Readonly<AgentScope>; runId: string; callId: string; signal: AbortSignal }) => Promise<AgentToolResult>;
}
export interface AgentRunInput {
  scope: AgentScope;
  trigger: { kind: "interactive" | "worker"; reference: string };
  recipeId: string;
  messages: { role: "user" | "model"; text: string }[];
  tools: AgentTool[];
  authorize: () => Promise<boolean>;
  signal?: AbortSignal;
}
export interface AgentRunResult {
  runId: string;
  status: "completed" | "stopped";
  stopReason?: AgentStopReason;
  text: string | null;
  tools: { name: string; callId: string; status: AgentToolResult["status"]; reference?: string }[];
  counts: { modelCalls: number; toolCalls: number; queryEmbeddings: number };
}

/** Internal server entry only. HTTP bodies cannot supply scope, recipes, handlers or authorization. */
export function createAgentRuntime(options: {
  config: AiConfig;
  usage: Pick<AiUsageStore, "reserve" | "record">;
  provider: AgentModelProvider;
}) {
  const activeUsers = new Set<string>();
  return {
    async run(input: AgentRunInput): Promise<AgentRunResult> {
      const runId = randomUUID();
      const budget = new AgentBudget(input.signal);
      const result: AgentRunResult = { runId, status: "stopped", text: null, tools: [], counts: budget.counts };
      const scope = Object.freeze({ ...input.scope });
      let acquired = false;
      let toolFailure: AgentStopped | undefined;
      try {
        await budget.wait(async () => {
          if (!await input.authorize()) throw new AgentStopped("unauthorized");
          budget.check();
          if (!options.config.enabled || activeUsers.has(scope.userId) || activeUsers.size >= 4) throw new AgentStopped("unavailable");
          activeUsers.add(scope.userId);
          acquired = true;
          if (!input.messages.length || input.messages.at(-1)?.role !== "user"
            || input.messages.some(message => !message.text.trim() || /[\u0000\uD800-\uDFFF]/u.test(message.text))) throw new AgentStopped("invalid_response");
          const definitions = new Map(input.tools.map(tool => [tool.name, tool]));
          if (definitions.size !== input.tools.length || input.tools.some(tool => !/^[a-z][a-z0-9_]{0,63}$/u.test(tool.name))) throw new AgentStopped("invalid_tool");
          const prompt = await loadAgentPrompt(input.recipeId, "tool_cycle", ["run", "scope", "conversation", "capabilities"]);
          budget.check();
          const tools = input.tools.map(tool => new FunctionTool({ name: tool.name, description: tool.description,
            parameters: tool.parameters.strict(), execute: async (args, context) => {
              budget.check();
              const callId = context?.functionCallId ?? "";
              const progress: AgentRunResult["tools"][number] = { name: tool.name, callId, status: "unknown" };
              result.tools.push(progress);
              try {
                const response = await budget.wait(() => tool.execute(args, { scope, runId, callId, signal: budget.signal }));
                if (!["succeeded", "rejected", "conflict", "failed", "unknown"].includes(response.status)) throw new Error("Invalid tool result");
                progress.status = response.status;
                if (response.reference) progress.reference = response.reference;
                return response;
              } catch {
                // A thrown/aborted handler may already have acted. Do not invite an automatic retry.
                progress.status = "unknown";
                return { status: "unknown" };
              }
            } }));
          const model = new AgentGatewayModel({ ...options, budget, userId: scope.userId, childId: scope.childId, authorize: input.authorize });
          const agent = new LlmAgent({ name: "yuban_agent", model,
            instruction: `${prompt.text}\n\nServer runtime metadata:\n${JSON.stringify({ runId, scope, trigger: input.trigger,
              now: new Date().toISOString(), timeZone: "Asia/Hong_Kong", locale: "zh-HK", packVersion: prompt.packVersion,
              recipeId: prompt.recipeId, capabilities: tools.map(tool => tool.name), limits: AGENT_LIMITS })}`,
            tools,
            beforeToolCallback: async ({ tool, args, context }) => {
              budget.check();
              const definition = definitions.get(tool.name);
              const parsed = definition?.parameters.strict().safeParse(args);
              let response: AgentToolResult | undefined;
              if (!parsed?.success) response = { status: "rejected" };
              else if (!await budget.wait(input.authorize)
                || !await budget.wait(() => definition!.authorize(parsed.data, scope))) response = { status: "rejected" };
              if (response) result.tools.push({ name: tool.name, callId: context.functionCallId ?? "", status: response.status });
              budget.check();
              return response ? { ...response } : undefined;
            },
            afterToolCallback: ({ response }) => {
              if (response.status === "unknown") {
                toolFailure = new AgentStopped("tool_unknown");
                throw toolFailure;
              }
              return undefined;
            },
          });
          const sessionService = new InMemorySessionService();
          const appName = "yuban_hk";
          const session = await sessionService.createSession({ appName, userId: scope.userId, sessionId: runId });
          for (const message of input.messages.slice(0, -1)) {
            await sessionService.appendEvent({ session, event: createEvent({ invocationId: runId,
              author: message.role === "user" ? "user" : agent.name, content: { role: message.role, parts: [{ text: message.text }] } }) });
          }
          const runner = new Runner({ appName, agent, sessionService });
          try {
            for await (const event of runner.runAsync({ userId: scope.userId, sessionId: runId,
              newMessage: { role: "user", parts: [{ text: input.messages.at(-1)!.text }] }, abortSignal: budget.signal,
              runConfig: { maxLlmCalls: AGENT_LIMITS.modelCalls, streamingMode: StreamingMode.NONE, saveInputBlobsAsArtifacts: false } })) {
              budget.check();
              if (event.errorCode) throw model.failure ?? new AgentStopped(budget.counts.modelCalls >= AGENT_LIMITS.modelCalls ? "model_limit" : "unavailable");
              if (event.content?.role === "model" && !event.content.parts?.some(part => part.functionCall)) {
                const text = event.content.parts?.filter(part => !part.thought && typeof part.text === "string").map(part => part.text).join("");
                if (text?.trim()) result.text = text;
              }
            }
            if (!await budget.wait(input.authorize)) throw new AgentStopped("unauthorized");
            if (!result.text) throw new AgentStopped("invalid_response");
            result.status = "completed";
          } finally {
            await sessionService.deleteSession({ appName, userId: scope.userId, sessionId: runId });
          }
        });
      } catch (error) {
        result.status = "stopped";
        result.stopReason = toolFailure?.reason ?? (error instanceof AgentStopped ? error.reason
          : error instanceof Error && /LlmCallsLimit/u.test(error.name) ? "model_limit" : "unavailable");
        result.text = null;
        // On an expired/cancelled run no fresh authorization check can be guaranteed.
        if (result.stopReason === "unauthorized" || budget.signal.aborted) result.tools = [];
        else {
          try {
            if (!await budget.wait(input.authorize)) { result.stopReason = "unauthorized"; result.tools = []; }
          } catch { result.tools = []; }
        }
      } finally {
        budget.close();
        if (acquired) activeUsers.delete(scope.userId);
        result.counts = budget.counts;
      }
      // Only verified tool progress survives a failed final generation; never execute result text.
      return structuredClone(result);
    },
  };
}

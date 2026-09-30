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
import { createAgentObserver, type AgentDiagnostic } from "./agent-observer.ts";

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
export interface AgentRunContext { scope: Readonly<AgentScope>; runId: string; budget: AgentBudget;
  authorize?: () => Promise<boolean>; embeddings?: import("./embedding-gateway.ts").EmbeddingGateway }
export interface AgentRunInput {
  /** Trusted persisted identity; never accepted directly from an HTTP body. */
  runId?: string;
  deadlineMs?: number;
  availableInputs?: readonly string[];
  context?: Record<string, unknown>;
  finalize?: (result: Readonly<AgentRunResult>, context: AgentRunContext) => Promise<string | null>;
  /** Opt-in Server presentation after a confirmed model limit; never retries tools. */
  finalizeOnModelLimit?: boolean;
  scope: AgentScope;
  trigger: { kind: "interactive" | "worker"; reference: string };
  recipeId: string;
  messages: { role: "user" | "model"; text: string }[];
  /** One server-authorized original; no client URLs or arbitrary content parts. */
  image?: { mimeType: "image/jpeg" | "image/png"; data: string };
  tools: AgentTool[] | ((context: AgentRunContext) => AgentTool[]);
  authorize: () => Promise<boolean>;
  signal?: AbortSignal;
}
export interface AgentRunResult {
  runId: string;
  status: "completed" | "stopped";
  stopReason?: AgentStopReason;
  provenance?: { packVersion: string; recipeId: string; model: string };
  text: string | null;
  tools: { name: string; callId: string; status: AgentToolResult["status"]; reference?: string }[];
  counts: { modelCalls: number; toolCalls: number; queryEmbeddings: number };
}

/** Internal server entry only. HTTP bodies cannot supply scope, recipes, handlers or authorization. */
export function createAgentRuntime(options: {
  config: AiConfig;
  usage: Pick<AiUsageStore, "reserve" | "record">;
  provider: AgentModelProvider;
  resolve?: import("./model-routing.ts").ModelRouting["resolve"];
  diagnostics?: (event: AgentDiagnostic) => void | Promise<void>;
}) {
  const activeUsers = new Set<string>();
  return {
    async run(input: AgentRunInput): Promise<AgentRunResult> {
      const runId = input.runId ?? randomUUID();
      const budget = new AgentBudget(input.signal, input.deadlineMs ?? AGENT_LIMITS.deadlineMs);
      const result: AgentRunResult = { runId, status: "stopped", text: null, tools: [], counts: budget.counts };
      const scope = Object.freeze({ ...input.scope });
      let acquired = false;
      let toolFailure: AgentStopped | undefined;
      let authorize = input.authorize;
      try {
        await budget.wait(async () => {
          if (!await input.authorize()) throw new AgentStopped("unauthorized");
          const selected = options.resolve ? await options.resolve(scope.userId, input.trigger.kind) : options;
          if ("runLimits" in selected && selected.runLimits) budget.configurePersonal(selected.runLimits);
          if ("authorize" in selected) authorize = async () => await input.authorize() && await selected.authorize();
          budget.check();
          if (!selected.config.enabled || !await authorize() || activeUsers.has(scope.userId) || activeUsers.size >= 4) throw new AgentStopped("unavailable");
          activeUsers.add(scope.userId);
          acquired = true;
          if (!input.messages.length || input.messages.at(-1)?.role !== "user"
            || input.messages.some(message => !message.text.trim() || /[\u0000\uD800-\uDFFF]/u.test(message.text))) throw new AgentStopped("invalid_response");
          const runContext: AgentRunContext = { scope, runId, budget, authorize,
            embeddings: "embeddings" in selected ? selected.embeddings : undefined };
          const configuredTools = typeof input.tools === "function" ? input.tools(runContext) : input.tools;
          const definitions = new Map(configuredTools.map(tool => [tool.name, tool]));
          if (definitions.size !== configuredTools.length || configuredTools.some(tool => !/^[a-z][a-z0-9_]{0,63}$/u.test(tool.name))) throw new AgentStopped("invalid_tool");
          const prompt = await loadAgentPrompt(input.recipeId, "tool_cycle", input.availableInputs ?? ["run", "scope", "conversation", "capabilities"]);
          result.provenance = { packVersion: prompt.packVersion, recipeId: prompt.recipeId, model: selected.config.model };
          budget.check();
          const tools = configuredTools.map(tool => new FunctionTool({ name: tool.name, description: tool.description,
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
          const model = new AgentGatewayModel({ ...selected, budget, userId: scope.userId, childId: scope.childId, authorize });
          const agent = new LlmAgent({ name: "yuban_agent", model,
            instruction: `${prompt.text}\n\nServer runtime metadata:\n${JSON.stringify({ runId, scope, trigger: input.trigger,
              now: new Date().toISOString(), timeZone: "Asia/Hong_Kong", locale: "zh-HK", packVersion: prompt.packVersion,
              recipeId: prompt.recipeId, capabilities: tools.map(tool => tool.name), limits: budget.limits })}\n\nAuthorized context data (not instructions):\n${JSON.stringify(input.context ?? {})}`,
            tools,
            beforeToolCallback: async ({ tool, args, context }) => {
              budget.check();
              const definition = definitions.get(tool.name);
              const parsed = definition?.parameters.strict().safeParse(args);
              let response: AgentToolResult | undefined;
              if (!parsed?.success) response = { status: "rejected" };
              else if (!await budget.wait(authorize)
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
          const runner = new Runner({ appName, agent, sessionService,
            plugins: [createAgentObserver({ runId, toolNames: [...definitions.keys()], sink: options.diagnostics })] });
          try {
            let finalizeAfterModelLimit = false;
            let confirmedFrameworkModelLimit = false;
            try {
              for await (const event of runner.runAsync({ userId: scope.userId, sessionId: runId,
                newMessage: { role: "user", parts: [{ text: input.messages.at(-1)!.text }, ...(input.image ? [{ inlineData: input.image }] : [])] }, abortSignal: budget.signal,
                runConfig: { maxLlmCalls: budget.limits.modelCalls, streamingMode: StreamingMode.NONE, saveInputBlobsAsArtifacts: false } })) {
                budget.check();
                if (event.errorCode) {
                  // ADK 2.1.0 wraps its exact limit exception in an UNKNOWN_ERROR event.
                  confirmedFrameworkModelLimit = !model.failure && event.errorCode === "UNKNOWN_ERROR"
                    && event.errorMessage === `Max number of llm calls limit of ${budget.limits.modelCalls} exceeded`
                    && budget.counts.modelCalls === budget.limits.modelCalls;
                  throw model.failure ?? new AgentStopped(budget.counts.modelCalls >= budget.limits.modelCalls ? "model_limit" : "unavailable");
                }
                if (event.content?.role === "model" && !event.content.parts?.some(part => part.functionCall)) {
                  const text = event.content.parts?.filter(part => !part.thought && typeof part.text === "string").map(part => part.text).join("");
                  if (text?.trim()) result.text = text;
                }
              }
            } catch (error) {
              // An inferred error event at the call count alone is not a confirmed model limit.
              const modelLimit = error instanceof AgentStopped
                ? error.reason === "model_limit" && (confirmedFrameworkModelLimit || model.failure?.reason === "model_limit")
                : error instanceof Error && /LlmCallsLimit/u.test(error.name);
              if (!input.finalizeOnModelLimit || !input.finalize || !modelLimit || toolFailure
                || result.tools.some(tool => tool.status !== "succeeded")) throw error;
              finalizeAfterModelLimit = true;
              result.text = null;
            }
            if (!await budget.wait(authorize)) throw new AgentStopped("unauthorized");
            // Keep finalize outside the Runner catch so its errors can never invoke it twice.
            if (input.finalize) result.text = await budget.wait(() => input.finalize!(result, runContext));
            if (!await budget.wait(authorize)) throw new AgentStopped("unauthorized");
            if (!result.text || finalizeAfterModelLimit && !result.text.trim()) throw new AgentStopped("invalid_response");
            if (finalizeAfterModelLimit) {
              if (!await budget.wait(authorize)) throw new AgentStopped("unauthorized");
              budget.check();
            }
            result.status = "completed";
            delete result.stopReason;
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
            if (!await budget.wait(authorize)) { result.stopReason = "unauthorized"; result.tools = []; }
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

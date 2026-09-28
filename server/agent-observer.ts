import { BasePlugin } from "@google/adk";

export type AgentDiagnostic = Readonly<{
  runId: string;
  phase: "run_start" | "run_end" | "model_start" | "model_end" | "tool_start" | "tool_end" | "tool_error" | "model_error";
  tool?: string;
  elapsedMs: number;
  outcome?: "succeeded" | "rejected" | "conflict" | "failed" | "unknown";
}>;

type AgentObserverOptions = {
  runId: string;
  toolNames: readonly string[];
  sink?: (event: AgentDiagnostic) => void | Promise<void>;
};

function knownOutcome(status: unknown): AgentDiagnostic["outcome"] {
  switch (status) {
    case "succeeded":
    case "rejected":
    case "conflict":
    case "failed":
    case "unknown":
      return status;
    default:
      return undefined;
  }
}

class MetadataAgentObserver extends BasePlugin {
  private readonly runId: string;
  private readonly toolNames: ReadonlySet<string>;
  private readonly sink: AgentObserverOptions["sink"];
  private runStartedAt = performance.now();

  constructor(options: AgentObserverOptions) {
    super("agent_observer");
    this.runId = options.runId;
    this.toolNames = new Set(options.toolNames);
    this.sink = options.sink;
  }

  private emit(phase: AgentDiagnostic["phase"], toolName?: string, outcome?: AgentDiagnostic["outcome"]): void {
    if (!this.sink) return;
    const tool = toolName !== undefined && this.toolNames.has(toolName) ? toolName : undefined;
    // All phase timestamps are elapsed milliseconds since run_start.
    const elapsed = performance.now() - this.runStartedAt;
    const event: AgentDiagnostic = {
      runId: this.runId,
      phase,
      elapsedMs: Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0,
      ...(tool !== undefined ? { tool } : {}),
      ...(outcome !== undefined ? { outcome } : {}),
    };
    try {
      void Promise.resolve(this.sink(event)).catch(() => {});
    } catch {
      // Diagnostic failures must not change the agent's control flow.
    }
  }

  override async beforeRunCallback(_params: Parameters<BasePlugin["beforeRunCallback"]>[0]): Promise<undefined> {
    this.runStartedAt = performance.now();
    this.emit("run_start");
    return undefined;
  }

  override async afterRunCallback(_params: Parameters<BasePlugin["afterRunCallback"]>[0]): Promise<undefined> {
    this.emit("run_end");
    return undefined;
  }

  override async beforeModelCallback(_params: Parameters<BasePlugin["beforeModelCallback"]>[0]): Promise<undefined> {
    this.emit("model_start");
    return undefined;
  }

  override async afterModelCallback(_params: Parameters<BasePlugin["afterModelCallback"]>[0]): Promise<undefined> {
    this.emit("model_end");
    return undefined;
  }

  override async onModelErrorCallback(_params: Parameters<BasePlugin["onModelErrorCallback"]>[0]): Promise<undefined> {
    this.emit("model_error");
    return undefined;
  }

  override async beforeToolCallback({ tool }: Parameters<BasePlugin["beforeToolCallback"]>[0]): Promise<undefined> {
    this.emit("tool_start", tool.name);
    return undefined;
  }

  override async afterToolCallback({ tool, result }: Parameters<BasePlugin["afterToolCallback"]>[0]): Promise<undefined> {
    this.emit("tool_end", tool.name, knownOutcome(result.status));
    return undefined;
  }

  override async onToolErrorCallback({ tool }: Parameters<BasePlugin["onToolErrorCallback"]>[0]): Promise<undefined> {
    this.emit("tool_error", tool.name);
    return undefined;
  }
}

export function createAgentObserver(options: AgentObserverOptions): BasePlugin {
  return new MetadataAgentObserver(options);
}

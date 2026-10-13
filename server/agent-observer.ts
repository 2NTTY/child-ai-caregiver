import { BasePlugin } from "@google/adk";
import { taskParameterDiagnosticHints, type TaskParameterDiagnosticHint } from "./task-parameter-hints.ts";

type ToolRejectionStage = "schema" | "authorization" | "execution";
type ToolRejectionCode = "invalid_parameters" | "not_authorized" | "unknown"
  | "invalid_input" | "invalid_assignee" | "agent_run_expired" | "confirmation_requires_interactive_scope"
  | "invalid_citation" | "citation_required" | "citation_limit" | "use_citation_ids" | "not_found"
  | "version_conflict" | "operation_conflict" | "agent_proposal_limit" | "agent_scope_changed" | "agent_source_mismatch"
  | "confirmation_expired" | "confirmation_scope_changed" | "work_cancelled" | "source_changed" | "document_changed";

export type AgentDiagnostic = Readonly<{
  runId: string;
  phase: "run_start" | "run_end" | "model_start" | "model_end" | "tool_start" | "tool_end" | "tool_error" | "model_error" | "tool_rejection";
  tool?: string;
  elapsedMs: number;
  outcome?: "succeeded" | "rejected" | "conflict" | "failed" | "unknown";
  stage?: ToolRejectionStage;
  code?: ToolRejectionCode;
  hints?: readonly TaskParameterDiagnosticHint[];
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

function rejectionCode(tool: string, stage: ToolRejectionStage, code: unknown): ToolRejectionCode {
  if (stage === "schema") return "invalid_parameters";
  if (stage === "authorization") return "not_authorized";
  if (tool === "propose_task") {
    const allowed = ["invalid_input", "invalid_assignee", "agent_run_expired", "confirmation_requires_interactive_scope",
      "version_conflict", "operation_conflict", "agent_proposal_limit", "agent_scope_changed", "agent_source_mismatch"] as const;
    return allowed.find(value => value === code) ?? "unknown";
  }
  if (tool === "present_answer") return ["invalid_input", "invalid_citation", "citation_required", "citation_limit", "use_citation_ids"].find(value => value === code) as ToolRejectionCode ?? "unknown";
  if (tool === "read_family_documents") return ["invalid_input", "not_found", "version_conflict"].find(value => value === code) as ToolRejectionCode ?? "unknown";
  if (tool === "request_confirmation" || tool === "propose_family_document_change") return ["invalid_input", "not_found", "version_conflict",
    "agent_scope_changed", "confirmation_expired", "confirmation_scope_changed", "work_cancelled", "source_changed", "document_changed"].find(value => value === code) as ToolRejectionCode ?? "unknown";
  return "unknown";
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

  private emit(phase: AgentDiagnostic["phase"], toolName?: string, outcome?: AgentDiagnostic["outcome"], rejection?: {
    stage: ToolRejectionStage; code?: unknown; hints?: unknown;
  }): void {
    if (!this.sink) return;
    const tool = toolName !== undefined && this.toolNames.has(toolName) ? toolName : undefined;
    const stage = tool !== undefined && phase === "tool_rejection"
      && (rejection?.stage === "schema" || rejection?.stage === "authorization" || rejection?.stage === "execution") ? rejection.stage : undefined;
    if (phase === "tool_rejection" && stage === undefined) return;
    const hints = tool === "propose_task" && stage === "schema" ? taskParameterDiagnosticHints(rejection?.hints) : [];
    // All phase timestamps are elapsed milliseconds since run_start.
    const elapsed = performance.now() - this.runStartedAt;
    const event: AgentDiagnostic = {
      runId: this.runId,
      phase,
      elapsedMs: Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0,
      ...(tool !== undefined ? { tool } : {}),
      ...(outcome !== undefined ? { outcome } : {}),
      ...(stage !== undefined ? { stage, code: rejectionCode(tool!, stage, rejection?.code) } : {}),
      ...(hints.length ? { hints } : {}),
    };
    try {
      void Promise.resolve(this.sink(event)).catch(() => {});
    } catch {
      // Diagnostic failures must not change the agent's control flow.
    }
  }

  recordToolRejection(toolName: string, stage: ToolRejectionStage, result: {
    status: unknown; data?: { code?: unknown; hints?: unknown };
  }): void {
    if (!this.sink || !this.toolNames.has(toolName)) return;
    try {
      const outcome = knownOutcome(result.status);
      if (!outcome || outcome === "succeeded") return;
      // The sink boundary rebuilds every field from its fixed allowlists.
      this.emit("tool_rejection", toolName, outcome, { stage,
        code: stage === "execution" && ["propose_task", "present_answer", "read_family_documents", "request_confirmation", "propose_family_document_change"].includes(toolName) ? result.data?.code : undefined,
        hints: stage === "schema" && toolName === "propose_task" ? result.data?.hints : undefined });
    } catch {
      // Malformed diagnostic metadata must not affect a tool's business result.
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

export function createAgentObserver(options: AgentObserverOptions): MetadataAgentObserver {
  return new MetadataAgentObserver(options);
}

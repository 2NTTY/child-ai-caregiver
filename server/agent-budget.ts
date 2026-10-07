import { PERSONAL_RUN_LIMITS } from "../src/shared/model-settings.ts";

export const AGENT_LIMITS = Object.freeze({ modelCalls: 4, toolCalls: 8, queryEmbeddings: 2,
  deadlineMs: 90000, outputTokens: 1024, inputCharacters: 32000 });

export type AgentStopReason = "cancelled" | "deadline" | "model_limit" | "tool_limit" | "embedding_limit"
  | "input_limit" | "unauthorized" | "quota_exceeded" | "unavailable" | "invalid_response" | "invalid_tool" | "tool_unknown";
export class AgentStopped extends Error {
  readonly reason: AgentStopReason;
  constructor(reason: AgentStopReason) { super(reason); this.reason = reason; }
}

export class AgentBudget {
  readonly signal: AbortSignal;
  private readonly used = { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 };
  private configured = false;
  private responseCharacters: number | null = null;
  private selectedLimits: { [K in keyof typeof AGENT_LIMITS]: number } = { ...AGENT_LIMITS };
  private readonly expiresAt: number;
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly parent?: AbortSignal;
  private readonly onAbort = () => this.controller.abort(new AgentStopped("cancelled"));

  constructor(parent?: AbortSignal, deadlineMs: number = AGENT_LIMITS.deadlineMs) {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > AGENT_LIMITS.deadlineMs) throw new Error("Invalid agent deadline");
    this.parent = parent;
    this.expiresAt = Date.now() + deadlineMs;
    this.signal = this.controller.signal;
    if (parent?.aborted) this.onAbort();
    else parent?.addEventListener("abort", this.onAbort, { once: true });
    this.timer = setTimeout(() => this.controller.abort(new AgentStopped("deadline")), deadlineMs);
  }

  check() {
    if (!this.signal.aborted && Date.now() >= this.expiresAt) this.controller.abort(new AgentStopped("deadline"));
    if (this.signal.aborted) throw this.signal.reason;
  }
  get counts() { return { ...this.used }; }
  get limits() { return { ...this.selectedLimits }; }
  /** Latest complete request plus the model's native response; leave room for the next tool/presentation turn. */
  prepareToolResponseBudget(requestCharacters: number, modelContentCharacters: number) {
    this.responseCharacters = Math.max(0, AGENT_LIMITS.inputCharacters - requestCharacters - modelContentCharacters - 4096);
  }
  get toolResponseCharacters() { return this.responseCharacters ?? 8000; }
  accountToolResponse(characters: number) {
    if (this.responseCharacters !== null) this.responseCharacters = Math.max(0, this.responseCharacters - characters);
  }
  /** Only the Server-resolved, versioned personal settings may raise the default counts. */
  configurePersonal(limits: { modelCalls: number; queryEmbeddings: number }) {
    if (this.configured || Object.values(this.used).some(count => count !== 0)) throw new Error("Agent limits already selected");
    for (const key of ["modelCalls", "queryEmbeddings"] as const) {
      const value = limits[key], range = PERSONAL_RUN_LIMITS[key];
      if (!Number.isSafeInteger(value) || value < range.min || value > range.max) throw new Error("Invalid personal agent limits");
    }
    this.selectedLimits = { ...AGENT_LIMITS, ...limits };
    this.configured = true;
  }
  take(kind: keyof AgentBudget["counts"], amount = 1) {
    this.check();
    if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("Invalid attempt count");
    if (this.used[kind] + amount > this.selectedLimits[kind]) {
      throw new AgentStopped(kind === "modelCalls" ? "model_limit" : kind === "toolCalls" ? "tool_limit" : "embedding_limit");
    }
    this.used[kind] += amount;
  }
  async wait<T>(operation: () => Promise<T>): Promise<T> {
    this.check();
    let abort: (() => void) | undefined;
    try {
      return await Promise.race([operation(), new Promise<never>((_, reject) => {
        abort = () => reject(this.signal.reason);
        this.signal.addEventListener("abort", abort, { once: true });
        if (this.signal.aborted) abort();
      })]);
    } finally {
      if (abort) this.signal.removeEventListener("abort", abort);
    }
  }
  close() {
    clearTimeout(this.timer);
    this.parent?.removeEventListener("abort", this.onAbort);
    if (!this.signal.aborted) this.controller.abort(new AgentStopped("cancelled"));
  }
}

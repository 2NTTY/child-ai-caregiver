import { createHash } from "node:crypto";
import type { ModelProviderStopReason } from "../src/shared/agent-stop-message.ts";
import { canonical } from "./firestore-session-codec.ts";
import { RootBudgetError, type BudgetAttempt, type DurableRootBudget, type RootBudgetContext, type RootBudgetSnapshot } from "./durable-root-budget.ts";
import { AGENT_RUN_LIMITS } from '../src/shared/agent-run-limits.ts';
import { PERSONAL_RUN_LIMITS } from "../src/shared/model-settings.ts";

export const AGENT_LIMITS = Object.freeze({ modelCalls: 4, toolCalls: AGENT_RUN_LIMITS.toolCalls.default, queryEmbeddings: 2,
  deadlineMs: AGENT_RUN_LIMITS.deadlineSeconds.default * 1000, outputTokens: 1024, inputCharacters: 32000 });
// Platform policy is separate from legacy/fixed and personal run profiles.
export const PLATFORM_AGENT_RUN_LIMITS = Object.freeze({ modelCalls: AGENT_RUN_LIMITS.modelCalls.default, queryEmbeddings: AGENT_RUN_LIMITS.queryEmbeddings.default });
/**
 * P3-M01 keeps this per-run ceiling at 4 and does not raise daily quotas.
 * Chat-delivery review spends one remaining model call on the same root budget.
 * A draft that has already used every call stays unfinished; it does not open
 * another run. The P3 proposal of 6 is opt-in only: see
 * AI_CHAT_DELIVERY_REVIEW_MODEL_CALLS. A bound personal or platform limit,
 * including the production default of 4, is not overridden.
 */
export const CHAT_DELIVERY_REVIEW_MODEL_CALLS = Object.freeze({ current: 4, proposal: 6 });
export const AGENT_INTERACTIVE_INPUT = Object.freeze({ default: 64000, min: 32000, max: 64000 });
export const AGENT_TOOL_RESPONSE_RESERVE = 4096;

export type AgentRunLimits = Readonly<{ modelCalls: number; queryEmbeddings: number; toolCalls?: number; deadlineMs?: number }>;
/** Copy only the existing bounded counts from trusted Server configuration. */
export function freezeAgentRunLimits(limits: AgentRunLimits): AgentRunLimits {
  const selected = { modelCalls: limits?.modelCalls, queryEmbeddings: limits?.queryEmbeddings };
  for (const key of ["modelCalls", "queryEmbeddings"] as const) {
    const value = selected[key], range = PERSONAL_RUN_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < range.min || value > range.max) throw new Error("Invalid agent run limits");
  }
  const extended: { modelCalls: number; queryEmbeddings: number; toolCalls?: number; deadlineMs?: number } = selected;
  if (limits.toolCalls !== undefined) {
    if (!Number.isSafeInteger(limits.toolCalls) || limits.toolCalls < AGENT_RUN_LIMITS.toolCalls.min || limits.toolCalls > AGENT_RUN_LIMITS.toolCalls.max) throw new Error("Invalid agent tool limit");
    extended.toolCalls = limits.toolCalls;
  }
  if (limits.deadlineMs !== undefined) {
    if (!Number.isSafeInteger(limits.deadlineMs) || limits.deadlineMs < AGENT_RUN_LIMITS.deadlineSeconds.min * 1000 || limits.deadlineMs > AGENT_RUN_LIMITS.deadlineSeconds.max * 1000) throw new Error("Invalid agent deadline limit");
    extended.deadlineMs = limits.deadlineMs;
  }
  return Object.freeze(extended);
}

export type AgentStopReason = ModelProviderStopReason | "cancelled" | "deadline" | "model_limit" | "tool_limit" | "embedding_limit"
  | "input_limit" | "unauthorized" | "quota_exceeded" | "busy" | "unavailable" | "invalid_response" | "invalid_tool" | "tool_unknown"
  | "delivery_review_incomplete" | "compose_review_incomplete";
export class AgentStopped extends Error {
  readonly reason: AgentStopReason;
  constructor(reason: AgentStopReason) { super(reason); this.reason = reason; }
}

/** Hash only the fixed outgoing request; no request body is stored in the budget. */
export const agentBudgetFingerprint = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

export interface AgentDurableBudget {
  adapter: DurableRootBudget;
  context: RootBudgetContext;
  /** Optional shared non-SQL model/query daily quota. Never refunds root reservations. */
  dailyUsage?: import("./durable-ai-usage.ts").DurableAiUsage;
  /** Fixed, trusted settings only. Dynamic personal routing is not wired in this slice. */
  runLimits?: AgentRunLimits;
}

export class AgentBudget {
  readonly signal: AbortSignal;
  private readonly used = { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 };
  private configured = false;
  hasPersonalLimits(): boolean { return this.configured; }
  private inputConfigured = false;
  private responseCharacters: number | null = null;
  private selectedLimits: { [K in keyof typeof AGENT_LIMITS]: number } = { ...AGENT_LIMITS };
  private expiresAt: number;
  private readonly startedAt = Date.now();
  get deadlineAtMs(): number { return this.expiresAt; }
  private durableBudget?: AgentDurableBudget;
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout>;
  private readonly parent?: AbortSignal;
  private readonly onAbort = () => this.controller.abort(new AgentStopped("cancelled"));

  constructor(parent?: AbortSignal, deadlineMs: number = AGENT_LIMITS.deadlineMs, deadlineAtMs?: number) {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > AGENT_LIMITS.deadlineMs) throw new Error("Invalid agent deadline");
    this.parent = parent;
    if (deadlineAtMs !== undefined && (!Number.isSafeInteger(deadlineAtMs) || deadlineAtMs < 1)) throw new Error("Invalid absolute agent deadline");
    this.expiresAt = Math.min(this.startedAt + deadlineMs, deadlineAtMs ?? Infinity);
    this.signal = this.controller.signal;
    if (parent?.aborted) this.onAbort();
    else parent?.addEventListener("abort", this.onAbort, { once: true });
    this.timer = setTimeout(() => this.controller.abort(new AgentStopped("deadline")), Math.max(0, this.expiresAt - Date.now()));
  }

  check() {
    if (!this.signal.aborted && Date.now() >= this.expiresAt) this.controller.abort(new AgentStopped("deadline"));
    if (this.signal.aborted) throw this.signal.reason;
  }
  get durable() { return this.durableBudget !== undefined; }
  /** Trusted per-call metadata after the retriever has obtained the original root permit. */
  queryEmbeddingDailyUsage(attemptKey: string) {
    const durable = this.durableBudget;
    if (!durable?.dailyUsage) return undefined;
    if (!attemptKey.startsWith('embedding:')) throw new AgentStopped('unavailable');
    return { adapter: durable.dailyUsage, context: durable.context, attemptKey, revalidate: () => this.checkDurable() };
  }
  get remainingModelCalls() { return this.selectedLimits.modelCalls - this.used.modelCalls; }
  private applySnapshot(snapshot: RootBudgetSnapshot) {
    const context = this.durableBudget!.context;
    if (snapshot.generation !== context.generation || snapshot.deadlineAtMs !== context.binding.deadlineAtMs
      || canonical(snapshot.limits) !== canonical(context.binding.limits)) throw new AgentStopped("unavailable");
    for (const key of ["modelCalls", "toolCalls", "queryEmbeddings"] as const) {
      if (!Number.isSafeInteger(snapshot.used[key]) || snapshot.used[key] < 0 || snapshot.used[key] > this.selectedLimits[key]) throw new AgentStopped("unavailable");
      // Parallel callbacks may acknowledge older snapshots after a newer one.
      this.used[key] = Math.max(this.used[key], snapshot.used[key]);
    }
    if (snapshot.status !== "active") throw new AgentStopped(snapshot.status === "expired" ? "deadline" : "unavailable");
    this.check();
  }
  async initializeDurable(durable: AgentDurableBudget) {
    if (this.durableBudget || Object.values(this.used).some(value => value !== 0)) throw new AgentStopped("unavailable");
    this.durableBudget = durable;
    try { this.applySnapshot(await this.wait(() => durable.adapter.open(durable.context))); }
    catch (error) { throw this.durableFailure(error); }
  }
  private durableFailure(error: unknown, kind?: BudgetAttempt["kind"]): AgentStopped {
    if (error instanceof AgentStopped) return error;
    if (error instanceof RootBudgetError && error.code === "deadline_exceeded") return new AgentStopped("deadline");
    if (error instanceof RootBudgetError && error.code === "budget_exhausted") return new AgentStopped(
      kind === "model" ? "model_limit" : kind === "tool_batch" ? "tool_limit" : "embedding_limit");
    return new AgentStopped("unavailable");
  }
  async checkDurable() {
    this.check();
    if (!this.durableBudget) return;
    const { adapter, context } = this.durableBudget;
    try { this.applySnapshot(await this.wait(() => adapter.read(context))); }
    catch (error) { throw this.durableFailure(error); }
  }
  async admit(attempt: BudgetAttempt) {
    this.check();
    if (!this.durableBudget || !attempt.key) throw new AgentStopped("unavailable");
    const { adapter, context } = this.durableBudget;
    try {
      const admission = await this.wait(() => adapter.reserve(context, attempt));
      this.applySnapshot(admission.snapshot);
      if (admission.decision !== "execute") throw new AgentStopped("unavailable");
    } catch (error) {
      // A lost acknowledgement can have committed. Read counters only, never retry execution.
      try { this.applySnapshot(await this.wait(() => adapter.read(context))); } catch { /* Keep the original refusal. */ }
      throw this.durableFailure(error, attempt.kind);
    }
  }
  /** Request-local guidance; includes the upcoming generation, before its reservation. */
  planningSnapshot(hasTerminalTool: boolean) {
    this.check();
    const remaining = {
      modelCallsIncludingThisCall: this.remainingModelCalls,
      toolCalls: this.selectedLimits.toolCalls - this.used.toolCalls,
      queryEmbeddings: this.selectedLimits.queryEmbeddings - this.used.queryEmbeddings,
      timeMs: Math.max(0, this.expiresAt - Date.now()),
    };
    return { usedBeforeThisCall: this.counts, remaining,
      phase: remaining.modelCallsIncludingThisCall <= 1 || remaining.timeMs <= 15000
        || hasTerminalTool && remaining.toolCalls <= 1 ? "finish" as const : "work" as const,
      reserveForFinish: { modelCalls: 1, toolCalls: hasTerminalTool ? 1 : 0 },
      nonTerminalToolCallsAvailable: Math.max(0, remaining.toolCalls - (hasTerminalTool ? 1 : 0)),
    };
  }
  get counts() { return { ...this.used }; }
  get limits() { return { ...this.selectedLimits }; }
  /** Only Server configuration selects the interactive input ceiling; workers keep the base limit. */
  configureInputCharacters(value: number) {
    if (this.inputConfigured || Object.values(this.used).some(count => count !== 0)
      || !Number.isSafeInteger(value) || value < AGENT_INTERACTIVE_INPUT.min || value > AGENT_INTERACTIVE_INPUT.max)
      throw new Error("Invalid agent input limit");
    this.inputConfigured = true;
    this.selectedLimits = { ...this.selectedLimits, inputCharacters: value };
  }
  /** Latest complete request plus the model's native response; leave room for the next tool/presentation turn. */
  prepareToolResponseBudget(requestCharacters: number, modelContentCharacters: number, capabilityGrowthCharacters = 0) {
    if (!Number.isSafeInteger(capabilityGrowthCharacters) || capabilityGrowthCharacters < 0) throw new Error("Invalid capability growth reserve");
    this.responseCharacters = Math.max(0, this.selectedLimits.inputCharacters - requestCharacters - modelContentCharacters - AGENT_TOOL_RESPONSE_RESERVE - capabilityGrowthCharacters);
  }
  get toolResponseCharacters() { return this.responseCharacters ?? 8000; }
  accountToolResponse(characters: number) {
    if (this.responseCharacters !== null) this.responseCharacters = Math.max(0, this.responseCharacters - characters);
  }
  /** Server-resolved personal settings or an explicitly fixed trusted profile; never model/request args. */
  configurePersonal(limits: AgentRunLimits) {
    if (this.configured || Object.values(this.used).some(count => count !== 0)) throw new Error("Agent limits already selected");
    this.selectedLimits = { ...this.selectedLimits, ...freezeAgentRunLimits(limits) };
    if (limits.deadlineMs !== undefined) {
      this.expiresAt = Math.min(this.expiresAt, this.startedAt + limits.deadlineMs);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.controller.abort(new AgentStopped("deadline")), Math.max(0, this.expiresAt - Date.now()));
    }
    this.configured = true;
  }
  take(kind: keyof AgentBudget["counts"], amount = 1) {
    this.check();
    if (this.durableBudget) throw new AgentStopped("unavailable");
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

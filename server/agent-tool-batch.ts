import type { AgentScope, AgentTool, AgentToolResult } from "./agent-runtime.ts";
import { AgentStopped, type AgentBudget, type AgentStopReason } from "./agent-budget.ts";

export interface ReadToolBatchPolicy {
  /** Maximum number of read-only tool calls executing simultaneously. */
  maxConcurrent?: number;
  /** Maximum read-only calls admitted from one contiguous model batch; overflow items fail closed individually. */
  maxBatchSize?: number;
  /** Per-item wall-clock timeout in milliseconds within the run deadline. */
  itemTimeoutMs?: number;
}

export const DEFAULT_READ_TOOL_BATCH_POLICY: Required<ReadToolBatchPolicy> = Object.freeze({
  maxConcurrent: 3,
  maxBatchSize: 6,
  itemTimeoutMs: 8000,
});

export interface NormalizedReadBatchPolicy {
  readonly maxConcurrent: number;
  readonly maxBatchSize: number;
  readonly itemTimeoutMs: number;
}

export function normalizeReadBatchPolicy(policy?: ReadToolBatchPolicy): NormalizedReadBatchPolicy {
  const maxConcurrent = policy?.maxConcurrent ?? DEFAULT_READ_TOOL_BATCH_POLICY.maxConcurrent;
  const maxBatchSize = policy?.maxBatchSize ?? DEFAULT_READ_TOOL_BATCH_POLICY.maxBatchSize;
  const itemTimeoutMs = policy?.itemTimeoutMs ?? DEFAULT_READ_TOOL_BATCH_POLICY.itemTimeoutMs;
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 6) {
    throw new Error("Invalid read tool maxConcurrent limit");
  }
  if (!Number.isSafeInteger(maxBatchSize) || maxBatchSize < 1 || maxBatchSize > 12) {
    throw new Error("Invalid read tool maxBatchSize limit");
  }
  if (!Number.isSafeInteger(itemTimeoutMs) || itemTimeoutMs < 1) {
    throw new Error("Invalid read tool itemTimeoutMs limit");
  }
  return Object.freeze({ maxConcurrent, maxBatchSize, itemTimeoutMs });
}

export function isBatchableReadTool(tool: AgentTool | undefined): tool is AgentTool {
  return Boolean(tool && tool.effect === "read" && !tool.terminal && tool.name !== "show_official_help");
}

export interface BatchCallDescriptor {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface BatchSliceItem {
  index: number;
  callId: string;
  tool: AgentTool;
  args: Record<string, unknown>;
}

export function collectContiguousReadSlice(
  calls: readonly BatchCallDescriptor[],
  startIndex: number,
  definitions: ReadonlyMap<string, AgentTool>,
): BatchSliceItem[] {
  const items: BatchSliceItem[] = [];
  for (let index = startIndex; index < calls.length; index++) {
    const call = calls[index];
    const tool = definitions.get(call.name);
    if (!isBatchableReadTool(tool)) break;
    items.push({ index, callId: call.id, tool, args: call.args });
  }
  return items;
}

export interface BatchCallOutcome {
  callId: string;
  name: string;
  rejectionStage?: "schema" | "authorization";
  response: AgentToolResult;
  timedOut?: boolean;
  fromBatchCap?: boolean;
}

export type BatchReadSettlement = Readonly<{
  status: AgentToolResult["status"];
  faultCode?: "read_timeout" | "read_unavailable" | "embedding_limit";
  stopReason?: AgentStopReason;
}>;

class ReadItemTimeoutError extends Error {
  constructor() { super("read_timeout"); }
}

/**
 * Execute a contiguous slice of read-only tool calls with bounded concurrency,
 * per-item timeout/error isolation, batch-cap enforcement, and immediate stop on
 * cancellation or authorization revocation.
 */
export async function runReadToolBatch(options: {
  slice: readonly BatchSliceItem[];
  policy: NormalizedReadBatchPolicy;
  scope: Readonly<AgentScope>;
  budget: AgentBudget;
  authorize: () => Promise<boolean>;
  checkDurable?: () => Promise<void>;
  /** Called only at dispatch; the returned observer receives the scheduler's final decision. */
  onDispatch?: (toolName: string, callId: string) => (settlement: BatchReadSettlement) => void;
  executeItem: (item: BatchSliceItem, parsedArgs: Record<string, unknown>, signal: AbortSignal) => Promise<AgentToolResult>;
}): Promise<{ outcomes: Map<string, BatchCallOutcome>; peakConcurrent: number }> {
  const { slice, policy, scope, budget, authorize, checkDurable, executeItem } = options;
  const outcomes = new Map<string, BatchCallOutcome>();
  const batchController = new AbortController();
  const onBudgetAbort = () => batchController.abort(budget.signal.reason ?? new AgentStopped("cancelled"));
  if (budget.signal.aborted) onBudgetAbort();
  else budget.signal.addEventListener("abort", onBudgetAbort, { once: true });

  let fatalError: unknown;
  let peakConcurrent = 0;

  try {
    const eligible = slice.slice(0, policy.maxBatchSize);
    for (const overflow of slice.slice(policy.maxBatchSize)) {
      outcomes.set(overflow.callId, {
        callId: overflow.callId,
        name: overflow.tool.name,
        fromBatchCap: true,
        response: {
          status: "rejected",
          data: {
            code: "batch_limit_exceeded",
            maxBatchSize: policy.maxBatchSize,
            nextAction: "Use the already returned read results within the remaining budget before issuing further reads.",
          },
        },
      });
    }

    type QueuedItem = { item: BatchSliceItem; parsedArgs: Record<string, unknown> };
    const queue: QueuedItem[] = [];
    for (const item of eligible) {
      const parsed = item.tool.parameters.strict().safeParse(item.args);
      if (!parsed.success) {
        const hints = item.tool.parameterErrorHints?.(parsed.error.issues);
        outcomes.set(item.callId, {
          callId: item.callId,
          name: item.tool.name,
          rejectionStage: "schema",
          response: {
            status: "rejected",
            data: {
              code: "invalid_parameters",
              nextAction: "Use the declared tool parameter shape. No operation was executed; correct the arguments within the remaining run budget.",
              ...(hints?.length ? { hints } : {}),
            },
          },
        });
        continue;
      }
      queue.push({ item, parsedArgs: parsed.data });
    }

    let cursor = 0;
    let inFlight = 0;
    const workerCount = Math.min(policy.maxConcurrent, queue.length);

    const abortFatal = (reason: unknown) => {
      if (fatalError === undefined) fatalError = reason;
      batchController.abort(reason);
    };

    const runWorker = async () => {
      while (cursor < queue.length && !batchController.signal.aborted) {
        try {
          budget.check();
          if (checkDurable) await checkDurable();
          if (!await budget.wait(authorize)) {
            abortFatal(new AgentStopped("unauthorized"));
            return;
          }
        } catch (error) {
          abortFatal(error);
          return;
        }
        if (batchController.signal.aborted) return;

        const next = queue[cursor++];
        if (!next) return;
        const { item, parsedArgs } = next;

        let itemAuthorized = false;
        try {
          itemAuthorized = await budget.wait(() => item.tool.authorize(parsedArgs, scope));
        } catch (error) {
          abortFatal(error);
          return;
        }
        // A sibling may have stopped the batch while this independent permit was pending.
        if (batchController.signal.aborted) return;
        budget.check();
        if (!itemAuthorized) {
          outcomes.set(item.callId, {
            callId: item.callId,
            name: item.tool.name,
            rejectionStage: "authorization",
            response: {
              status: "rejected",
              data: {
                code: "not_authorized",
                nextAction: "Stop this operation. Do not retry with another identity or resource.",
              },
            },
          });
          continue;
        }

        const itemController = new AbortController();
        const remainingRunMs = Math.max(1, budget.deadlineAtMs - Date.now());
        const itemDeadlineMs = Math.min(policy.itemTimeoutMs, remainingRunMs);
        const timer = setTimeout(() => itemController.abort(new ReadItemTimeoutError()), itemDeadlineMs);
        const combinedSignal = AbortSignal.any([budget.signal, batchController.signal, itemController.signal]);

        inFlight += 1;
        if (inFlight > peakConcurrent) peakConcurrent = inFlight;

        let finish: ReturnType<NonNullable<typeof options.onDispatch>> | undefined;
        let faultCode: BatchReadSettlement["faultCode"];
        // The batch signal synchronously mirrors the original budget and also
        // stops every sibling. Settle once even while a post-read permit is pending.
        const settle = (data: BatchReadSettlement) => {
          const callback = finish;
          finish = undefined;
          try { callback?.(data); } catch { /* Observation only. */ }
        };
        const onSpanAbort = () => settle({ status: "failed", stopReason:
          batchController.signal.reason instanceof AgentStopped ? batchController.signal.reason.reason : "unavailable" });
        try {
          try { finish = options.onDispatch?.(item.tool.name, item.callId); } catch { /* Observation only. */ }
          batchController.signal.addEventListener("abort", onSpanAbort, { once: true });
          if (batchController.signal.aborted) { onSpanAbort(); return; }
          const execution = executeItem(item, parsedArgs, combinedSignal);
          // Prevent unhandled rejection if item timeout or batch abort settles the race first.
          execution.catch(() => {});
          const response = await new Promise<AgentToolResult>((resolve, reject) => {
            if (combinedSignal.aborted) {
              reject(itemController.signal.aborted ? new ReadItemTimeoutError() : (combinedSignal.reason ?? new AgentStopped("cancelled")));
              return;
            }
            const onAbort = () => {
              reject(itemController.signal.aborted ? new ReadItemTimeoutError() : (combinedSignal.reason ?? new AgentStopped("cancelled")));
            };
            combinedSignal.addEventListener("abort", onAbort, { once: true });
            execution.then(
              value => { combinedSignal.removeEventListener("abort", onAbort); resolve(value); },
              err => { combinedSignal.removeEventListener("abort", onAbort); reject(err); },
            );
          });

          if (!["succeeded", "rejected", "conflict", "failed", "unknown"].includes(response.status)) {
            throw new Error("Invalid tool result");
          }
          budget.check();
          if (!await budget.wait(authorize)) {
            abortFatal(new AgentStopped("unauthorized"));
            return;
          }
          if (batchController.signal.aborted) return;
          budget.check();
          outcomes.set(item.callId, { callId: item.callId, name: item.tool.name, response });
        } catch (error) {
          if (batchController.signal.aborted || budget.signal.aborted) {
            abortFatal(error instanceof AgentStopped ? error : budget.signal.reason ?? batchController.signal.reason);
            return;
          }
          if (error instanceof AgentStopped && error.reason !== "embedding_limit") {
            abortFatal(error);
            return;
          }
          try {
            if (!await budget.wait(authorize)) {
              abortFatal(new AgentStopped("unauthorized"));
              return;
            }
            if (batchController.signal.aborted) return;
            budget.check();
          } catch (authError) {
            abortFatal(authError instanceof AgentStopped ? authError : new AgentStopped("unavailable"));
            return;
          }
          const timedOut = error instanceof ReadItemTimeoutError || itemController.signal.aborted;
          const isEmbeddingLimit = error instanceof AgentStopped && error.reason === "embedding_limit";
          faultCode = isEmbeddingLimit ? "embedding_limit" : timedOut ? "read_timeout" : "read_unavailable";
          outcomes.set(item.callId, {
            callId: item.callId,
            name: item.tool.name,
            timedOut,
            response: {
              status: isEmbeddingLimit ? "rejected" : "failed",
              data: {
                code: faultCode,
                recovery: "bounded_read",
                nextAction: isEmbeddingLimit
                  ? "Query embedding budget limit reached; keep already succeeded reads and summarize or conclude within remaining budget."
                  : timedOut
                    ? "This read item timed out; keep any succeeded reads and only retry this item if essential within remaining budget."
                    : "This read failed, not an empty result. Keep any succeeded reads and use a relevant read within the remaining budget or state the limitation.",
              },
            },
          });
        } finally {
          // Observe the raced/authorized result, never a late resolution from the detached handler.
          const result = outcomes.get(item.callId);
          batchController.signal.removeEventListener("abort", onSpanAbort);
          settle({ status: result?.response.status ?? "failed",
            ...(faultCode ? { faultCode } : {}),
            ...(!result ? { stopReason: fatalError instanceof AgentStopped ? fatalError.reason : "unavailable" } : {}) });
          clearTimeout(timer);
          inFlight -= 1;
        }
      }
    };

    if (workerCount > 0) {
      await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    }
    if (fatalError !== undefined) throw fatalError;
    budget.check();
    if (!await budget.wait(authorize)) throw new AgentStopped("unauthorized");

    return { outcomes, peakConcurrent };
  } finally {
    budget.signal.removeEventListener("abort", onBudgetAbort);
  }
}

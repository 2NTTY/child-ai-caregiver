import { z } from "zod";
import { waitForTelemetry } from "./agent-telemetry-wait.ts";
import { AGENT_HIGH_WATERMARK_DEFAULTS, roundConsumptionReserve } from "../src/shared/agent-run-limits.ts";

export const AGENT_HIGH_WATERMARK_SCOPE = Object.freeze({
  ownerUserId: "system:agent-high-watermark",
  workspaceId: "00000000-0000-0000-0000-000000000000",
  childId: "00000000-0000-0000-0000-000000000000",
  storageEpoch: "00000000-0000-0000-0000-000000000000",
});

export const agentHighWatermarkDocSchema = z.object({
  samples: z.array(z.object({
    sampleId: z.string().min(1).max(128).optional(),
    runCategory: z.string().min(1).max(64),
    usedModelCalls: z.number().int().nonnegative(),
    hardModelCalls: z.number().int().positive(),
    usedToolCalls: z.number().int().nonnegative().optional(),
    hardToolCalls: z.number().int().positive().optional(),
    usedQueryEmbeddings: z.number().int().nonnegative().optional(),
    hardQueryEmbeddings: z.number().int().positive().optional(),
    repeatedCallSignature: z.string().min(1).max(200).optional(),
  }).strict()).max(100),
}).strict();

export interface HighWatermarkSample {
  sampleId?: string;
  runCategory: string;
  usedModelCalls: number;
  hardModelCalls: number;
  usedToolCalls?: number;
  hardToolCalls?: number;
  usedQueryEmbeddings?: number;
  hardQueryEmbeddings?: number;
  repeatedCallSignature?: string;
}

/** Atomically append/deduplicate a utilization sample within the bounded category sliding window. */
export function mergeHighWatermarkSamples(
  existing: readonly HighWatermarkSample[],
  incoming: HighWatermarkSample,
  windowSize: number = AGENT_HIGH_WATERMARK_DEFAULTS.windowSize,
): HighWatermarkSample[] {
  const bound = Math.max(1, Math.floor(windowSize));
  const sameCategory = existing.filter(sample => sample.runCategory === incoming.runCategory);
  if (incoming.sampleId && sameCategory.some(sample => sample.sampleId === incoming.sampleId)) {
    return sameCategory.slice(-bound);
  }
  return [...sameCategory, incoming].slice(-bound);
}

export interface HighWatermarkPolicyOptions {
  windowSize?: number;
  thresholdRatio?: number;
  minHighRuns?: number;
  consecutiveHighStreak?: number;
  repeatedSignatureStreak?: number;
}

export type HighWatermarkRecommendedAction =
  | "none"
  | "review_soft_ratio"
  | "tighten_or_compact"
  | "stop_loop_early";

export interface HighWatermarkEvaluation {
  category: string;
  triggered: boolean;
  windowCount: number;
  highWatermarkCount: number;
  highWatermarkRatio: number;
  consecutiveHighStreak: number;
  loopDetected: boolean;
  triggeredDimensions: ("modelCalls" | "toolCalls" | "queryEmbeddings")[];
  recommendedAction: HighWatermarkRecommendedAction;
  persisted?: boolean;
  persistenceDegraded?: boolean;
}

function isDimensionHigh(used: number | undefined, hard: number | undefined, ratio: number): boolean {
  if (typeof used !== "number" || typeof hard !== "number" || !Number.isFinite(used) || !Number.isFinite(hard) || hard <= 0) {
    return false;
  }
  return used >= roundConsumptionReserve(hard * ratio, 1);
}

/**
 * Evaluate sustained high-watermark usage within a sliding window for a run category,
 * plus consecutive high runs and repeated-signature loop patterns for early protection.
 */
export function evaluateSustainedHighWatermark(
  samples: readonly HighWatermarkSample[],
  runCategory: string,
  options?: HighWatermarkPolicyOptions,
): HighWatermarkEvaluation {
  const windowSize = Math.max(1, Math.floor(options?.windowSize ?? AGENT_HIGH_WATERMARK_DEFAULTS.windowSize));
  const thresholdRatio = options?.thresholdRatio ?? AGENT_HIGH_WATERMARK_DEFAULTS.thresholdRatio;
  const minHighRuns = Math.max(1, Math.floor(options?.minHighRuns ?? AGENT_HIGH_WATERMARK_DEFAULTS.minHighRuns));
  const consecutiveTarget = Math.max(1, Math.floor(options?.consecutiveHighStreak ?? AGENT_HIGH_WATERMARK_DEFAULTS.consecutiveHighStreak));
  const repetitionTarget = Math.max(2, Math.floor(options?.repeatedSignatureStreak ?? AGENT_HIGH_WATERMARK_DEFAULTS.repeatedSignatureStreak));

  const recent = samples.filter(sample => sample.runCategory === runCategory).slice(-windowSize);
  const triggeredDimensions = new Set<"modelCalls" | "toolCalls" | "queryEmbeddings">();
  let highWatermarkCount = 0;
  let consecutiveHighStreak = 0;
  let signatureStreak = 0;
  let lastSignature: string | undefined;
  let loopDetected = false;

  for (const sample of recent) {
    const modelHigh = isDimensionHigh(sample.usedModelCalls, sample.hardModelCalls, thresholdRatio);
    const toolHigh = isDimensionHigh(sample.usedToolCalls, sample.hardToolCalls, thresholdRatio);
    const embedHigh = isDimensionHigh(sample.usedQueryEmbeddings, sample.hardQueryEmbeddings, thresholdRatio);
    if (modelHigh) triggeredDimensions.add("modelCalls");
    if (toolHigh) triggeredDimensions.add("toolCalls");
    if (embedHigh) triggeredDimensions.add("queryEmbeddings");

    if (modelHigh || toolHigh || embedHigh) {
      highWatermarkCount++;
      consecutiveHighStreak++;
    } else {
      consecutiveHighStreak = 0;
    }

    if (sample.repeatedCallSignature && sample.repeatedCallSignature === lastSignature) {
      signatureStreak++;
      if (signatureStreak >= repetitionTarget) loopDetected = true;
    } else {
      lastSignature = sample.repeatedCallSignature;
      signatureStreak = sample.repeatedCallSignature ? 1 : 0;
    }
  }

  const windowCount = recent.length;
  const highWatermarkRatio = windowCount > 0 ? highWatermarkCount / windowCount : 0;
  const sustainedWindowHit = highWatermarkCount >= minHighRuns;
  const consecutiveHit = consecutiveHighStreak >= consecutiveTarget;
  const triggered = loopDetected || sustainedWindowHit || consecutiveHit;

  const recommendedAction: HighWatermarkRecommendedAction = loopDetected
    ? "stop_loop_early"
    : sustainedWindowHit
      ? "tighten_or_compact"
      : consecutiveHit
        ? "review_soft_ratio"
        : "none";

  return {
    category: runCategory,
    triggered,
    windowCount,
    highWatermarkCount,
    highWatermarkRatio,
    consecutiveHighStreak,
    loopDetected,
    triggeredDimensions: [...triggeredDimensions],
    recommendedAction,
  };
}

export type AgentRunUtilizationSample = HighWatermarkSample;
export type HighWatermarkAlert = HighWatermarkEvaluation;

export interface HighWatermarkPersistenceErrorInfo {
  category: string;
  stage: "load" | "persist";
  error: unknown;
}

export interface HighWatermarkPersistenceStatus {
  status: "idle" | "persisted" | "degraded";
  lastFailureStage?: "load" | "persist";
  lastFailureMessage?: string;
  failureCount: number;
}

export interface HighWatermarkMonitorOptions {
  windowSize?: number;
  highWatermarkRatio?: number;
  thresholdRatio?: number;
  minHighRuns?: number;
  consecutiveHighRuns?: number;
  consecutiveHighStreak?: number;
  repeatedSignatureStreak?: number;
  loadWindow?: (runCategory: string) => Promise<readonly AgentRunUtilizationSample[]> | readonly AgentRunUtilizationSample[];
  persistWindow?: (runCategory: string, samples: readonly AgentRunUtilizationSample[]) => Promise<void> | void;
  appendDurableSample?: (sample: AgentRunUtilizationSample, windowSize: number) => Promise<readonly AgentRunUtilizationSample[]>;
  onPersistenceError?: (info: HighWatermarkPersistenceErrorInfo) => Promise<void> | void;
}

export interface HighWatermarkMonitor {
  recordSample(sample: AgentRunUtilizationSample): Promise<HighWatermarkAlert>;
  evaluateCategory(runCategory: string): Promise<HighWatermarkAlert>;
  persistenceStatus(runCategory: string): HighWatermarkPersistenceStatus;
}

/**
 * Stateful sliding-window monitor backed by durable transactional append or shared load/persist hooks.
 * Serializes updates per category so concurrent or alternating instances never clobber prior samples.
 */
export function createHighWatermarkMonitor(options: HighWatermarkMonitorOptions = {}): HighWatermarkMonitor {
  const windowSize = options.windowSize ?? AGENT_HIGH_WATERMARK_DEFAULTS.windowSize;
  const cachedByCategory = new Map<string, AgentRunUtilizationSample[]>();
  const pendingByCategory = new Map<string, Promise<unknown>>();
  // Legacy hooks replace a whole window. A waiting timeout cannot cancel that write;
  // keep its fence until actual settlement so a late replacement cannot clobber a successor.
  const pendingLegacyWrites = new Map<string, Promise<void>>();
  const statusByCategory = new Map<string, HighWatermarkPersistenceStatus>();

  const thresholdRatio = options.thresholdRatio ?? options.highWatermarkRatio;
  const consecutiveHighStreak = options.consecutiveHighStreak ?? options.consecutiveHighRuns;
  const evalOptions: HighWatermarkPolicyOptions = {
    windowSize,
    ...(thresholdRatio !== undefined ? { thresholdRatio } : {}),
    ...(options.minHighRuns !== undefined ? { minHighRuns: options.minHighRuns } : {}),
    ...(consecutiveHighStreak !== undefined ? { consecutiveHighStreak } : {}),
    ...(options.repeatedSignatureStreak !== undefined ? { repeatedSignatureStreak: options.repeatedSignatureStreak } : {}),
  };

  function getStatus(runCategory: string): HighWatermarkPersistenceStatus {
    return statusByCategory.get(runCategory) ?? { status: "idle", failureCount: 0 };
  }

  function markPersisted(runCategory: string) {
    const prev = getStatus(runCategory);
    statusByCategory.set(runCategory, { ...prev, status: "persisted" });
  }

  async function recordPersistenceFailure(stage: "load" | "persist", runCategory: string, error: unknown) {
    const prev = getStatus(runCategory);
    const message = error instanceof Error ? error.message : String(error);
    statusByCategory.set(runCategory, {
      status: "degraded",
      lastFailureStage: stage,
      lastFailureMessage: message,
      failureCount: prev.failureCount + 1,
    });
    if (options.onPersistenceError) {
      try { await waitForTelemetry(() => options.onPersistenceError!({ category: runCategory, stage, error })); } catch { /* Observer error stays isolated. */ }
    }
  }

  async function readFreshWindow(runCategory: string): Promise<{ samples: AgentRunUtilizationSample[]; loadFailed: boolean }> {
    if (!options.loadWindow) {
      return { samples: [...(cachedByCategory.get(runCategory) ?? [])], loadFailed: false };
    }
    try {
      const loaded = await waitForTelemetry(() => options.loadWindow!(runCategory));
      const bounded = [...loaded].filter(s => s.runCategory === runCategory).slice(-windowSize);
      cachedByCategory.set(runCategory, bounded);
      return { samples: bounded, loadFailed: false };
    } catch (error) {
      await recordPersistenceFailure("load", runCategory, error);
      return { samples: [...(cachedByCategory.get(runCategory) ?? [])], loadFailed: true };
    }
  }

  function serialize<T>(runCategory: string, task: () => Promise<T>): Promise<T> {
    const previous = pendingByCategory.get(runCategory) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    pendingByCategory.set(runCategory, next);
    return next;
  }

  return {
    recordSample(sample) {
      return serialize(sample.runCategory, async () => {
        let updated: AgentRunUtilizationSample[];
        let loadFailed = false;
        let persistFailed = false;
        if (options.appendDurableSample) {
          try {
            const committed = await waitForTelemetry(() => options.appendDurableSample!(sample, windowSize));
            updated = [...committed].filter(s => s.runCategory === sample.runCategory).slice(-windowSize);
            cachedByCategory.set(sample.runCategory, updated);
            markPersisted(sample.runCategory);
          } catch (error) {
            persistFailed = true;
            await recordPersistenceFailure("persist", sample.runCategory, error);
            updated = mergeHighWatermarkSamples(cachedByCategory.get(sample.runCategory) ?? [], sample, windowSize);
            cachedByCategory.set(sample.runCategory, updated);
          }
        } else {
          const read = await readFreshWindow(sample.runCategory);
          loadFailed = read.loadFailed;
          updated = mergeHighWatermarkSamples(read.samples, sample, windowSize);
          cachedByCategory.set(sample.runCategory, updated);
          if (options.persistWindow) {
            try {
              if (pendingLegacyWrites.has(sample.runCategory)) {
                throw new Error("Previous telemetry window write is still unsettled");
              }
              const write = Promise.resolve().then(() => options.persistWindow!(sample.runCategory, updated));
              pendingLegacyWrites.set(sample.runCategory, write);
              const release = () => {
                if (pendingLegacyWrites.get(sample.runCategory) === write) pendingLegacyWrites.delete(sample.runCategory);
              };
              // Observe both outcomes even after the waiting deadline; do not retry an uncertain write.
              void write.then(release, release);
              await waitForTelemetry(() => write);
              if (!loadFailed) markPersisted(sample.runCategory);
            } catch (error) {
              persistFailed = true;
              await recordPersistenceFailure("persist", sample.runCategory, error);
            }
          } else if (!loadFailed) {
            markPersisted(sample.runCategory);
          }
        }
        const evaluation = evaluateSustainedHighWatermark(updated, sample.runCategory, evalOptions);
        const persisted = !loadFailed && !persistFailed;
        return { ...evaluation, persisted, persistenceDegraded: !persisted };
      });
    },
    evaluateCategory(runCategory) {
      return serialize(runCategory, async () => {
        const read = await readFreshWindow(runCategory);
        const evaluation = evaluateSustainedHighWatermark(read.samples, runCategory, evalOptions);
        const status = getStatus(runCategory);
        const degraded = read.loadFailed || status.status === "degraded";
        return { ...evaluation, persisted: !degraded, persistenceDegraded: degraded };
      });
    },
    persistenceStatus(runCategory) {
      return { ...getStatus(runCategory) };
    },
  };
}

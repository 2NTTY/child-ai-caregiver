import { AGENT_HIGH_WATERMARK_DEFAULTS, roundConsumptionReserve } from "../src/shared/agent-run-limits.ts";

export interface HighWatermarkSample {
  runCategory: string;
  usedModelCalls: number;
  hardModelCalls: number;
  usedToolCalls?: number;
  hardToolCalls?: number;
  usedQueryEmbeddings?: number;
  hardQueryEmbeddings?: number;
  repeatedCallSignature?: string;
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

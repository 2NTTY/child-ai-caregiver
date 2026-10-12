import type { BinaryLike } from 'node:crypto';
import type { GenerateContentResponseUsageMetadata } from '@google/genai';

/** Offline checkpoint helpers. These declarations grant no live execution authority. */
export function sha256(value: BinaryLike): string;
export function newOfflineLedger(): {
  schemaVersion: number; ledgerId: string;
  baseline: { generationCalls: number; estimatedUsd: number; description: string };
  events: unknown[];
};
export function openLedger(filename: string, options: {
  expectedSha256?: string; runId: string; caseId: string; offline?: boolean;
}): {
  reserve(): true;
  response(usage: GenerateContentResponseUsageMetadata): void;
  unknown(category?: string): void;
  outcome(outcome: string): void;
  finish(status: string): void;
  snapshot(): { generationCallsReserved: number; additionalCallsReserved: number;
    historicalEstimatedUsd: number; uncertain: boolean; checkpointSha256: string };
  close(): void;
};

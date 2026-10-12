/** Public configuration used by the existing offline fixture, not a live budget. */
export const DOCUMENT_BATCH: Readonly<{
  scenarioId: string; model: string; project: string; location: string; serviceTier: string;
  sdkVersion: string; roots: readonly string[]; rootCaps: readonly number[]; modelCalls: number;
  toolCallsPerRoot: number; inputTokens: number; outputTokens: number; candidateCount: number;
  attempts: number; queryEmbeddings: number; reservedMicroUsd: number;
  conditionalEstimateMicroUsd: number; pricingStatus: string; rootDeadlineMs: number; batchDeadlineMs: number;
}>;
export function offlineLegacyFingerprint(document: unknown): string;

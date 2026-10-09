import type { AttemptOutcome, TokenUsage, AiDailyUsage } from './ai-usage.ts';
import type { ModelBillingSource } from '../src/shared/model-settings.ts';

/** Fixed by the trusted runtime after root admission, never supplied by HTTP/model input. */
export interface DurableAiUsageRequest {
  rootRunId: string;
  attemptKey: string;
  /** Hash of the original complete root binding and generation. */
  bindingFingerprint: string;
  requestFingerprint: string;
  userId: string;
  childId: string;
  model: string;
  deadlineAtMs: number;
  userLimit: number;
  globalLimit: number;
}
export interface DurableAiUsageRecord extends TokenUsage {
  outcome: AttemptOutcome;
  durationMs: number;
}
export interface DurableAiUsageReceipt {
  /** UTC day of the original committed reservation, including after midnight. */
  day: string;
  reservedAtMs: number;
  /** Null is unknown/unrecorded; it is never permission to repeat the provider request. */
  record: DurableAiUsageRecord | null;
}
export type DurableAiUsageAdmission = { decision: 'execute' | 'lookup'; receipt: DurableAiUsageReceipt }
  | { decision: 'quota_exceeded' };
export interface DurableAiUsage {
  readonly billingSource: ModelBillingSource;
  reserve(request: DurableAiUsageRequest): Promise<DurableAiUsageAdmission>;
  read(request: DurableAiUsageRequest): Promise<DurableAiUsageReceipt | null>;
  /** Accounting only: may settle late, never resumes a root or grants dispatch. */
  record(request: DurableAiUsageRequest, record: DurableAiUsageRecord): Promise<DurableAiUsageReceipt>;
  getForUser(userId: string): Promise<AiDailyUsage>;
}
export class DurableAiUsageError extends Error {
  readonly code: string;
  constructor(code: string) { super('AI usage request rejected'); this.name = 'DurableAiUsageError'; this.code = code; }
}

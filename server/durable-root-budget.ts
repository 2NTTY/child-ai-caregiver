import { AGENT_RUN_LIMITS } from '../src/shared/agent-run-limits.ts';

/** Server-owned execution attempts, not token billing or business-effect receipts. */
export interface RootBudgetLimits { modelCalls: number; toolCalls: number; queryEmbeddings: number; }
/** Validation ceilings shared by runtime and persistent budget envelopes. */
export const MAX_ROOT_BUDGET_LIMITS: Readonly<RootBudgetLimits> = Object.freeze({ modelCalls: AGENT_RUN_LIMITS.modelCalls.max, toolCalls: AGENT_RUN_LIMITS.toolCalls.max, queryEmbeddings: AGENT_RUN_LIMITS.queryEmbeddings.max });
export const DEFAULT_ROOT_BUDGET_LIMITS: Readonly<RootBudgetLimits> = Object.freeze({ modelCalls: 4, toolCalls: 8, queryEmbeddings: 2 });
export interface RootBudgetBinding {
  rootRunId: string;
  ownerId: string;
  workspaceId: string;
  childId: string;
  authorizationVersion: string;
  storageEpoch: string;
  trigger: { kind: string; reference: string };
  workflowVersion: string;
  promptPackVersion: string;
  settingsVersion: string;
  billingVersion: string;
  limits: RootBudgetLimits;
  /** The original absolute server wall-clock deadline; never extended on reopen. */
  deadlineAtMs: number;
}
export interface RootBudgetContext { binding: RootBudgetBinding; generation: number; }
/** Supplied by the already durable acceptance chain, never a new invocation ordinal. */
export type BudgetAttempt = { key: string; fingerprint: string } & (
  { kind: 'model'; units: 1 } | { kind: 'embedding'; units: 1 } | { kind: 'tool_batch'; units: number }
);
/** A reference is not proof that a business effect committed or can still be read. */
export type BudgetSettlement = { status: 'known'; reference: string } | { status: 'unknown' };
export type BudgetAttemptSnapshot = BudgetAttempt & { outcome: { status: 'reserved' } | BudgetSettlement };
export interface RootBudgetSnapshot {
  generation: number;
  deadlineAtMs: number;
  limits: RootBudgetLimits;
  used: RootBudgetLimits;
  status: 'active' | 'stopped' | 'expired';
  attempts: BudgetAttemptSnapshot[];
}
export interface BudgetAdmission {
  /** Only a newly committed reservation returns execute. A duplicate is lookup-only. */
  decision: 'execute' | 'lookup';
  attempt: BudgetAttemptSnapshot;
  snapshot: RootBudgetSnapshot;
}
export class RootBudgetError extends Error {
  readonly code: string;
  constructor(code: string) { super('Root budget request rejected'); this.name = 'RootBudgetError'; this.code = code; }
}
export interface DurableRootBudget {
  open(context: RootBudgetContext): Promise<RootBudgetSnapshot>;
  read(context: RootBudgetContext): Promise<RootBudgetSnapshot>;
  reserve(context: RootBudgetContext, attempt: BudgetAttempt): Promise<BudgetAdmission>;
  settle(context: RootBudgetContext, attempt: BudgetAttempt, result: BudgetSettlement): Promise<RootBudgetSnapshot>;
  stop(context: RootBudgetContext): Promise<RootBudgetSnapshot>;
}

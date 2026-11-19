import type { ProductAgentResult } from '../src/shared/product-agent.ts';

/** List metadata only. Reading a result still requires opening its original run. */
export function backgroundActivityEntry(runId: string, createdAt: string, recipeId: string, status: ProductAgentResult['status']) {
  const activityKind = recipeId === 'memory-refresh' ? 'memory_refresh'
    : recipeId === 'product-work-followup' ? 'work_followup' : 'background';
  return { runId, createdAt, activityKind, status };
}

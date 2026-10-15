import { z } from 'zod';
import type { FirestoreMemoryStore } from './firestore-memory.ts';
import type { ProductAgentStore } from './product-agent-store.ts';
import type { createAgentRuntime } from './agent-runtime.ts';
import type { ProductAgentResult } from '../src/shared/product-agent.ts';
import { AgentStopped } from './agent-budget.ts';

/** Private, one-generation maintenance using the same claimed Runner, billing and finish transaction as chat. */
export function createPrivateSummaryMaintenance(options: { memory: FirestoreMemoryStore; store: ProductAgentStore;
  runtime: ReturnType<typeof createAgentRuntime> }) {
  return async (input: { userId: string; childId: string; reference: string; authorize: () => Promise<boolean>; signal?: AbortSignal }) => {
    if (!await input.authorize()) return { state: 'stopped' as const };
    const batch = await options.memory.prepareMaintenance(input.userId, input.childId);
    if (!batch) return { state: 'completed' as const, more: false };
    if (batch.unavailableReason || !batch.messages.length) return { state: 'stopped' as const, stopReason: 'input_limit' };
    const claim = await options.store.claim(input.userId, input.childId, { kind: 'worker', reference: input.reference }, 'memory-refresh');
    if (!claim) return { state: 'stopped' as const };
    if (!claim.created) {
      const result = await options.store.get(input.userId, input.childId, claim.runId);
      return { state: result?.status === 'completed' ? 'completed' as const : result?.status === 'stopped' ? 'stopped' as const : 'unknown' as const,
        more: result?.status === 'completed' ? !!await options.memory.prepareMaintenance(input.userId, input.childId) : false, stopReason: result?.stopReason };
    }
    let text: string | undefined;
    const authorize = async () => await input.authorize() && await options.store.authorize(claim.scope, claim.runId);
    const result = await options.runtime.run({ runId: claim.runId, claimedRun: claim, scope: claim.scope,
      trigger: { kind: 'worker', reference: input.reference }, recipeId: 'memory-refresh', deadlineAtMs: Date.parse(claim.expiresAt),
      availableInputs: ['run', 'scope', 'conversation', 'context', 'evidence', 'capabilities', 'outputContract'],
      context: { purpose: 'private_incremental_summary', outputContract: 'Call stage_private_summary once. It is staged, not a fact, user confirmation or action.',
        coverage: { messageIds: batch.messages.map(message => message.id), moreUncovered: batch.moreUncovered, repairOf: batch.repairOf ?? null },
        currentSources: batch.currentSources ?? [] },
      messages: [{ role: 'user', text: JSON.stringify({ sourceMessages: batch.messages, instruction: 'Summarize only this supplied batch. Current source corrections override obsolete statements. Do not carry over a previous summary or invent completed actions.' }) }],
      authorize, signal: input.signal, finalizeOnModelLimit: true,
      tools: [{ name: 'stage_private_summary', description: '把本批原文整理為簡短私人歷史摘要；保留時間、來源與不確定性。更正依 currentSources，不重用已失效內容。只暫存，Server 核對後保存。',
        terminal: true, parameters: z.object({ text: z.string().trim().min(1).max(1500) }), authorize,
        async execute(args) { text = String(args.text); return { status: 'succeeded', data: { staged: true, saved: false } }; } }],
      finalize: async () => { if (!text) throw new AgentStopped('invalid_response'); return { outcome: 'no_action' }; },
    });
    const value: ProductAgentResult = { runId: result.runId, provenance: result.provenance ?? null, status: result.status,
      stopReason: result.stopReason ?? null, ...(result.status === 'completed' ? { outcome: 'no_action' as const } : {}),
      text: '', citations: [], privateSourceCitations: [], retrievalMode: 'not_used', proposals: [], countsKnown: true, counts: result.counts,
      tools: result.tools.map(({ name, status, reference }) => ({ name, status, ...(reference ? { reference } : {}) })) };
    if (!await input.authorize()) return { state: 'stopped' as const };
    const saved = await options.store.finish(claim.scope, value, result.status === 'completed' && text ? {
      previousVersion: batch.previousVersion, basis: batch.basis, text, coveredMessageIds: batch.messages.map(message => message.id),
      ...(batch.repairOf ? { repairOf: batch.repairOf } : {}),
    } : undefined);
    if (!saved) return { state: 'unknown' as const };
    const uncertain = result.counts.modelCalls > 0 && ['unavailable', 'deadline', 'cancelled'].includes(result.stopReason ?? '');
    return { state: uncertain ? 'unknown' as const : result.status === 'completed' ? 'completed' as const : result.status === 'stopped' ? 'stopped' as const : 'unknown' as const,
      more: result.status === 'completed' ? !!await options.memory.prepareMaintenance(input.userId, input.childId) : false,
      stopReason: result.stopReason };
  };
}

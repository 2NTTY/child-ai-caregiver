import { z } from 'zod';
import type { FirestoreMemoryStore } from './firestore-memory.ts';
import type { ProductAgentStore } from './product-agent-store.ts';
import type { AgentInitialTextInput, AgentRuntimePort } from './agent-runtime.ts';
import type { ProductAgentResult } from '../src/shared/product-agent.ts';
import type { SummaryInput } from '../src/shared/memory.ts';
import { AgentStopped } from './agent-budget.ts';
import { splitMessageIntoSafeChunks } from './summary-window-helper.ts';

/** Private, one-generation maintenance using the same claimed Runner, billing and finish transaction as chat. */
export function createPrivateSummaryMaintenance(options: { memory: FirestoreMemoryStore; store: ProductAgentStore;
  runtime: AgentRuntimePort }) {
  return async (input: { userId: string; childId: string; reference: string; authorize: () => Promise<boolean>; signal?: AbortSignal }) => {
    if (!await input.authorize()) return { state: 'stopped' as const };
    const prepared = await options.memory.prepareMaintenance(input.userId, input.childId);
    if (!prepared) return { state: 'completed' as const, more: false };
    const candidates = [prepared, ...prepared.alternatives ?? []];
    let batch: SummaryInput = prepared;
    if (batch.unavailableReason || !batch.messages.length) return { state: 'stopped' as const, stopReason: 'input_limit' };
    const claim = await options.store.claim(input.userId, input.childId, { kind: 'worker', reference: input.reference }, 'memory-refresh');
    if (!claim) return { state: 'stopped' as const };
    if (!claim.created) {
      const result = await options.store.get(input.userId, input.childId, claim.runId);
      return { state: result?.status === 'completed' ? 'completed' as const : result?.status === 'stopped' ? 'stopped' as const : 'unknown' as const,
        more: result?.status === 'completed' ? !!await options.memory.prepareMaintenance(input.userId, input.childId) : false, stopReason: result?.stopReason };
    }
    let messages = batch.messages;
    const payload = (): AgentInitialTextInput => ({
      context: { purpose: 'private_incremental_summary', outputContract: 'Call stage_private_summary once. It is staged, not a fact, user confirmation or action.',
        coverage: { messageIds: messages.map(message => message.id),
          moreUncovered: batch.moreUncovered || messages.length < batch.messages.length || (batch.part ? !batch.part.isLast : false),
          repairOf: batch.repairOf ?? null,
          ...(batch.part ? { part: batch.part } : {}) },
        currentSources: batch.currentSources ?? [] },
      text: JSON.stringify({
        sourceMessages: messages,
        ...(batch.part?.cumulativeSummary ? { previousAccumulatedSummary: batch.part.cumulativeSummary } : {}),
        instruction: batch.part
          ? (batch.part.cumulativeSummary
              ? `Incorporate this segment (part ${batch.part.index + 1} of ${batch.part.total}) of the message into the previousAccumulatedSummary provided above. Produce an updated, comprehensive summary reflecting all parts seen so far. This is a partial message slice; do not assume the conversation is finished or infer missing text. Current source corrections override obsolete statements.`
              : `Summarize this segment (part ${batch.part.index + 1} of ${batch.part.total}) of the supplied batch. This is a partial message slice; do not assume the conversation is finished or infer missing text. Current source corrections override obsolete statements. Do not carry over a previous summary or invent completed actions.`)
          : 'Summarize only this supplied batch. Current source corrections override obsolete statements. Do not carry over a previous summary or invent completed actions.',
      }),
    });
    const initial = payload();
    let text: string | undefined;
    const authorize = async () => await input.authorize() && await options.store.authorize(claim.scope, claim.runId);
    const result = await options.runtime.run({ runId: claim.runId, claimedRun: claim, scope: claim.scope,
      trigger: { kind: 'worker', reference: input.reference }, recipeId: 'memory-refresh', deadlineAtMs: Date.parse(claim.expiresAt),
      availableInputs: ['run', 'scope', 'conversation', 'context', 'evidence', 'capabilities', 'outputContract'],
      context: initial.context, messages: [{ role: 'user', text: initial.text }],
      fitInitialInput: fits => {
        // Repairs are atomic: every original message and every current correction is required.
        // Fresh work may shrink only to an ordered whole-message prefix, never skip its first item.
        for (const candidate of candidates) {
          if (candidate.unavailableReason || !candidate.messages.length) continue;
          batch = candidate; messages = batch.messages;
          while (!fits(payload()) && !batch.repairOf && messages.length > 1) messages = messages.slice(0, -1);
          if (!fits(payload()) && !batch.repairOf && messages.length === 1 && !batch.part) {
            const chunks = splitMessageIntoSafeChunks(messages[0]);
            if (chunks.length > 1) {
              const chunk0 = chunks[0];
              batch = {
                ...batch,
                part: {
                  messageId: messages[0].id,
                  index: 0,
                  total: chunks.length,
                  isLast: false,
                  sourceHash: chunk0.sourceHash,
                  startOffset: chunk0.startOffset,
                  endOffset: chunk0.endOffset,
                },
              };
              messages = [chunk0];
            }
          }
          const selected = payload();
          if (fits(selected)) return selected;
        }
        // Unfit repairs stay pending, but cannot starve another complete repair or new prefix.
        throw new AgentStopped('input_limit');
      },
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
      previousVersion: batch.previousVersion, basis: batch.basis, text, coveredMessageIds: messages.map(message => message.id),
      ...(batch.repairOf ? { repairOf: batch.repairOf } : {}),
      ...(batch.part ? { part: batch.part } : {}),
    } : undefined);
    if (!saved) return { state: 'unknown' as const };
    const uncertain = result.counts.modelCalls > 0 && ['unavailable', 'deadline', 'cancelled'].includes(result.stopReason ?? '');
    return { state: uncertain ? 'unknown' as const : result.status === 'completed' ? 'completed' as const : result.status === 'stopped' ? 'stopped' as const : 'unknown' as const,
      more: result.status === 'completed' ? !!await options.memory.prepareMaintenance(input.userId, input.childId) : false,
      stopReason: result.stopReason };
  };
}

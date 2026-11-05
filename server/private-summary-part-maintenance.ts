import type { FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { FirestoreMemoryStore } from './firestore-memory.ts';
import type { AgentInitialTextInput, AgentRuntimePort } from './agent-runtime.ts';
import type { createFirestorePrivateSummaryWork } from './firestore-private-summary-work.ts';
import type { SummaryEffectReceipt, SummaryPartPlan, SummaryResolvedSource } from './private-summary-work.ts';
import { createFirestoreAuthority, FirestoreAuthorityError } from './firestore-authority.ts';
import { AgentStopped, agentBudgetFingerprint } from './agent-budget.ts';
import type { FirestoreRootBudget } from './firestore-root-budget.ts';
import { nativeSettlementWindow, NativeSettlementTimeout } from './agent-native-settlement.ts';
import { fitSummaryFragment, type SummaryFragmentInput } from './private-summary-fragments.ts';
import { privateSummaryMarker, privateSummaryStageSchema, SUMMARY_PART_TEXT_MAX } from './private-summary-terminal.ts';
import type { ProductAgentResult } from '../src/shared/product-agent.ts';

/** Trusted opt-in composition only. No production entrypoint constructs this service. */
export function createPrivateSummaryPartMaintenance(options: FirestoreDomainOptions & {
  serverClock?: () => number;
  memory: FirestoreMemoryStore; work: ReturnType<typeof createFirestorePrivateSummaryWork>; runtime: AgentRuntimePort;
  /** The same trusted database/project/namespace and clock as runtime and verifier. Never a request-selected adapter. */
  root: Pick<FirestoreRootBudget, 'stop'>;
}) {
  if (!options.root || typeof options.root.stop !== 'function') throw new Error('Original private-summary root settlement adapter required');
  const authority = createFirestoreAuthority(options), now = options.serverClock ?? Date.now;
  return async (input: { userId: string; childId: string; workId: string; reference: string;
    /** Current scope/worker settlement authority, not the original execution lease. authorizePart separately gates dispatch. */
    authorize: () => Promise<boolean>; signal?: AbortSignal }): Promise<{
      state: 'completed' | 'unknown' | 'stopped'; receipt: SummaryEffectReceipt | null;
    }> => {
    if (!await input.authorize()) return { state: 'stopped', receipt: null };
    const claimed = await options.work.claimPart(input.userId, input.childId, input.workId, input.reference);
    if (claimed.decision === 'blocked') return { state: 'stopped', receipt: null };
    const effect = () => options.work.readEffect(input.userId, input.childId, claimed.attempt.id);
    const resultFor = (receipt: SummaryEffectReceipt | null) => ({ state: receipt === null ? 'unknown' as const
      : receipt.kind === 'no_effect' || receipt.kind === 'superseded' && receipt.reason !== 'already_covered'
        ? 'stopped' as const : 'completed' as const, receipt });
    if (claimed.decision !== 'execute') {
      const settle = nativeSettlementWindow();
      try {
        const saved = await settle(effect);
        if (saved) return resultFor(saved);
        // Replay only settles original evidence. It cannot open a new root or model.
        const recover = () => options.work.recoverTerminal({ scope: claimed.claim.scope,
          runId: claimed.claim.runId, attemptId: claimed.attempt.id });
        const recovered = await settle(recover), context = claimed.attempt.rootContext;
        if (recovered.state === 'unknown' && context && now() >= context.binding.deadlineAtMs) {
          // A dead process may have saved its terminal before reaching finally.
          // Only the original expired admission can be tightened. Live duplicates,
          // blocked authority and malformed evidence never enter this path.
          const frozen = await settle(() => options.root.stop(context));
          if (frozen.status !== 'stopped' || frozen.generation !== context.generation
            || frozen.deadlineAtMs !== context.binding.deadlineAtMs
            || agentBudgetFingerprint(frozen.limits) !== agentBudgetFingerprint(context.binding.limits))
            throw new AgentStopped('unavailable');
          return resultFor((await settle(recover)).receipt);
        }
        return resultFor(recovered.receipt);
      } catch (error) {
        if (error instanceof NativeSettlementTimeout) return resultFor(null);
        throw error;
      }
    }
    const view = await options.work.readState(input.userId, input.childId, input.workId);
    const source = await authority.runTransaction(input.userId, input.childId, b => options.memory.revalidateSource(b, view.revision));
    if (source.kind !== 'eligible') return { state: 'stopped', receipt: null };
    const unitIndex = view.work.chain.next.unitIndex, resolved = source.resolvedSources[unitIndex];
    if (!resolved) return { state: 'stopped', receipt: null };
    const { claim, attempt } = claimed;
    const authorize = async () => await input.authorize() && await options.work.authorizePart(claim.scope, claim.runId, attempt.id);
    let selected: SummaryFragmentInput | null = null, outputTextLimit: number | null = null, staged: string | null = null;
    let fixedPlan: SummaryPartPlan | null = null, confirmedReceipt: SummaryEffectReceipt | null = null;
    let confirmedAuthorityFailure: FirestoreAuthorityError | null = null;
    const payload = (fragment: SummaryFragmentInput, metadata: SummaryResolvedSource['modelMetadata'], limit: number,
      worstFuture = false): AgentInitialTextInput => ({ text: JSON.stringify({ purpose: 'private_summary_part/v1',
        binding: worstFuture ? { ...attempt.binding, step: Number.MAX_SAFE_INTEGER, attempt: Number.MAX_SAFE_INTEGER } : attempt.binding,
        fragment, metadata, outputTextLimit: limit,
        instruction: 'Fold only this contiguous source fragment into the technical accumulator. Preserve source attribution, uncertainty and unfinished actions. A partial JSON correction is not a complete object; later correction units override older claims. Call stage_private_summary once with text within outputTextLimit UTF-16 units. No business or external action is authorized.' }) });
    await options.runtime.run({ runId: claim.runId, claimedRun: claim, scope: claim.scope,
      trigger: { kind: 'worker', reference: input.reference }, recipeId: 'memory-refresh', deadlineAtMs: Date.parse(claim.expiresAt),
      messages: [{ role: 'user', text: privateSummaryMarker(attempt.binding, view.work.manifestHash) }],
      availableInputs: ['run', 'scope', 'conversation', 'context', 'evidence', 'capabilities', 'outputContract'],
      fitInitialInput(fits, continuationFits) {
        if (!continuationFits) throw new AgentStopped('input_limit');
        // Bound every future minimal fragment, not just the cheap first scalar or today's ordinal.
        // U+0001 is a well-formed non-NUL scalar with maximal JSON escaping per UTF-16 unit.
        const canContinue = (limit: number) => source.resolvedSources.slice(unitIndex).every((value, index) => continuationFits(payload({
          source: value.source, range: { unitIndex: unitIndex + index, startUtf16: value.source.utf16Length,
            endUtf16: value.source.utf16Length, metadataOnly: false }, text: '\u0001', sourceComplete: false,
          accumulator: '\u0001'.repeat(limit),
        }, value.modelMetadata, limit, true)));
        let low = 1, high = SUMMARY_PART_TEXT_MAX, maximum = 0;
        while (low <= high) { const middle = low + Math.floor((high - low) / 2);
          if (canContinue(middle)) { maximum = middle; low = middle + 1; } else high = middle - 1; }
        if (!maximum) throw new AgentStopped('input_limit');
        outputTextLimit = maximum;
        selected = fitSummaryFragment({ unitIndex, source: resolved.source, sourceText: resolved.sourceText,
          startUtf16: view.work.chain.next.offsetUtf16, accumulator: view.work.accumulator?.text ?? null,
          fits: fragment => fits(payload(fragment, resolved.modelMetadata, maximum)) });
        if (!selected) throw new AgentStopped('input_limit');
        return payload(selected, resolved.modelMetadata, maximum);
      },
      privateSummaryAdmission: {
        bindRoot: context => options.work.bindRootContext(claim.scope, claim.runId, attempt.id, context),
        async reserveModel(value) {
          if (!selected || outputTextLimit === null) throw new AgentStopped('input_limit');
          const plan: SummaryPartPlan = { binding: attempt.binding, manifestHash: view.work.manifestHash,
            range: selected.range, priorAccumulatorHash: view.work.chain.accumulatorHash,
            requestFingerprint: value.requestFingerprint, outputTextLimit };
          const decision = await options.work.reservePart({ scope: claim.scope, runId: claim.runId, attemptId: attempt.id,
            plan, modelAttemptKey: value.modelAttemptKey, originalDailyRequest: value.originalDailyRequest });
          if (decision === 'execute') fixedPlan = plan;
          return decision;
        },
        reserveToolBatch: value => options.work.reserveToolBatch({ scope: claim.scope, runId: claim.runId, attemptId: attempt.id, ...value }),
        revalidate: authorize,
      },
      privateSummaryTerminal: {
        readEffect: effect,
        onReceipt(receipt) { confirmedReceipt = receipt; },
        onFailure(error) { if (error instanceof FirestoreAuthorityError) confirmedAuthorityFailure = error; },
        async commit(result) {
          const value: ProductAgentResult = { runId: result.runId, provenance: result.provenance ?? null, status: result.status,
            stopReason: result.stopReason ?? null, ...(result.status === 'completed' ? { outcome: 'no_action' as const } : {}),
            text: '', citations: [], privateSourceCitations: [], retrievalMode: 'not_used', proposals: [], countsKnown: true, counts: result.counts,
            tools: result.tools.map(({ name, status, reference }) => ({ name, status, ...(reference ? { reference } : {}) })) };
          return options.work.finishPart({ scope: claim.scope, runId: claim.runId, attemptId: attempt.id, result: value, text: staged });
        },
      },
      authorize, signal: input.signal,
      tools: [{ name: 'stage_private_summary', description: 'Stage only the private technical fold of this source fragment. The supplied outputTextLimit is binding; this is not published coverage or a confirmed fact.',
        terminal: true, parameters: privateSummaryStageSchema(() => fixedPlan?.outputTextLimit ?? null), authorize,
        async execute(args) {
          const parsed = privateSummaryStageSchema(() => fixedPlan?.outputTextLimit ?? null).strict().parse(args);
          staged = parsed.text; return { status: 'succeeded', data: { staged: true, saved: false } };
        } }],
      finalize: async () => { if (!staged) throw new AgentStopped('invalid_response'); return { outcome: 'no_action' }; },
    });
    // Runner completion is not a coverage receipt, including after a stop or lost commit ACK.
    if (confirmedAuthorityFailure) throw confirmedAuthorityFailure;
    return resultFor(confirmedReceipt);
  };
}

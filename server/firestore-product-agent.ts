import { createChatFileAgentReader } from './chat-file-agent.ts';
import { createFirestoreVoiceTranscripts } from './firestore-voice-transcripts.ts';
import { createVoiceTranscription } from './voice-transcription.ts';
import type { AgentDiagnostic } from './agent-observer.ts';
import { createPrivateSummaryMaintenance } from './private-summary-maintenance.ts';
import { createFirestorePrivateSummaryScan } from './firestore-private-summary-scan.ts';
import { preparePrivateSummarySuppressedSource } from './firestore-private-summary-suppressed.ts';
import { readSummaryFastOwnedUnknown } from './firestore-private-summary-ownership.ts';
import { readFirestoreBackgroundClaim } from './firestore-background-work.ts';
import { parseSummaryBackgroundBasis, summaryLineageRecordSchema, type SummaryFastSource } from './private-summary-work.ts';
import { readContextBasis } from './firestore-context-basis.ts';
import { firestoreDomainHash } from './firestore-domain-data.ts';
import type { FirestoreAuthorityTransaction as SummaryBinding } from './firestore-authority.ts';
import type { SummaryInput } from '../src/shared/memory.ts';
import { createPrivateSummaryPartMaintenance } from './private-summary-part-maintenance.ts';
import { createFirestorePrivateSummaryWork, type SummaryWorkPolicyPort } from './firestore-private-summary-work.ts';
import { randomUUID } from 'node:crypto';
import { createPrivateSummaryTerminalVerifier, createPrivateSummaryFastNoDispatchVerifier } from './private-summary-terminal.ts';
import { FirestoreAiUsage } from './firestore-ai-usage.ts';
import { authorizePrivateSummaryFastEntry, readPrivateSummaryLegacyAdmission } from './firestore-private-summary-cutover.ts';
import { FirestoreDomainData } from './firestore-domain-data.ts';
import { createFirestoreAuthority } from './firestore-authority.ts';
import { readFile } from 'node:fs/promises';
import type { AiConfig } from './ai-config.ts';
import type { FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { FirestoreChatStore } from './firestore-chat.ts';
import type { FirestoreCareStore } from './firestore-care.ts';
import type { FirestoreMemoryStore } from './firestore-memory.ts';
import type { FirestoreOnlineStore } from './firestore-online.ts';
import type { FirestoreKnowledgeStore } from './firestore-knowledge.ts';
import { createFirestoreProductAgentStore } from './firestore-product-agent-store.ts';
import { createFirestoreModelRouting, requireDurableUsage } from './firestore-model-routing.ts';
import { FirestoreSessionService } from './firestore-session-service.ts';
import { FirestoreRootBudget } from './firestore-root-budget.ts';
import { createFirestoreAgentAdmission } from './firestore-agent-admission.ts';
import { createAgentRuntime, type AgentRunResult } from './agent-runtime.ts';
import { claimedRunAssembly } from './agent-run-assembly.ts';
import { createProductAgent } from './product-agent.ts';
import { createKnowledgeRetriever } from './knowledge-retriever.ts';
import { AgentStopped } from './agent-budget.ts';
import { domainReject } from './firestore-domain-data.ts';
import type { AgentModelProvider } from './agent-model-gateway.ts';
import type { FamilyDocumentStore } from './family-document-store.ts';
import type { FirestoreSharedInputStore } from './firestore-shared-inputs.ts';

/** Original product Agent, with only its persistence, routing and admission assembly replaced. */
import type { FirestoreGrowthStore } from "./firestore-growth.ts";
import type { FirestoreConcernStore } from "./firestore-concerns.ts";

import type { FirestoreAgentRunOptions } from "./firestore-agent-runs.ts";
import type { FirestoreContact } from './firestore-contact.ts';

export async function createFirestoreProductAgent(options: FirestoreDomainOptions & {
  photos?: import('./firestore-photos.ts').FirestorePhotoStore;
  files?: import("./firestore-chat-files.ts").FirestoreChatFilesStore;
  voices?: import("./firestore-voice.ts").FirestoreVoiceStore;
  config: AiConfig; chat: FirestoreChatStore; care: FirestoreCareStore; memory: FirestoreMemoryStore;
  online: FirestoreOnlineStore; knowledge?: FirestoreKnowledgeStore;
  documents?: FamilyDocumentStore;
  summary?: Pick<import("./care-summary-store.ts").CareSummaryStore, "get">;
  authorizeWorker?: FirestoreAgentRunOptions['authorizeWorker'];
  contact?: FirestoreContact;
  sources?: FirestoreSharedInputStore; concerns?: FirestoreConcernStore; growth?: FirestoreGrowthStore;
  /** Trusted constructor seam for a bounded scripted Runner check; never HTTP-selected. */
  platformProvider?: AgentModelProvider;
  /** Trusted local credential adapter; all normal routing, budgets and business services still apply. */
  platformProviders?: import('./firestore-model-routing.ts').PlatformProviderFactory;
  /** Trusted work policy only. Existing per-dispatch limits never supply missing cumulative grants. */
  summaryWorkPolicy?: SummaryWorkPolicyPort;
  diagnostics?: (event: AgentDiagnostic) => void | Promise<void>;
}) {
  const manifest = JSON.parse(await readFile(new URL('../prompts/manifest.json', import.meta.url), 'utf8')) as { version?: unknown };
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(manifest.version)) throw new Error('Invalid prompt manifest');
  const promptPackVersion = manifest.version;
  const routing = createFirestoreModelRouting(options, options.config, options.platformProviders);
  const voiceTranscripts = options.voices ? createFirestoreVoiceTranscripts({ ...options, voices: options.voices }) : undefined;
  const services = createFirestoreProductAgentStore({ ...options, transcripts: voiceTranscripts, readInteractiveRunSeconds: routing.readInteractiveRunSeconds, async validateKnowledge(binding, sourceId) {
    if (!options.knowledge) domainReject('knowledge_not_ready', 503);
    await options.knowledge.validatePublishedSource(binding.transaction, sourceId);
  }, async continuationKnowledge(b, ids) {
    if (!ids.length) return [];
    if (!options.knowledge) domainReject('knowledge_not_ready', 503);
    return options.knowledge.continuationSources(b.transaction, ids);
  } });
  const nativeSessionService = new FirestoreSessionService({ ...options, namespace: options.namespace + '_adk' });
  const rootBudget = new FirestoreRootBudget({ ...options, namespace: options.namespace + '_root_budget' });
  const admission = createFirestoreAgentAdmission(options);
  const runtime: ReturnType<typeof createAgentRuntime> = {
    async run(input): Promise<AgentRunResult> {
      let instance: ReturnType<typeof createAgentRuntime>, authorize: () => Promise<boolean>;
      try {
        const selected = await routing.resolve(input.scope.userId, input.trigger.kind);
        const limits = ['memory-refresh', 'voice-transcription'].includes(input.recipeId) ? { ...selected.runLimits, modelCalls: Math.min(1, selected.runLimits.modelCalls) } : selected.runLimits;
        const provider = selected.billingSource === 'platform' ? options.platformProvider ?? selected.provider : selected.provider;
        // Selection is immutable within this root. Changing settings invalidates its authorization.
        const durable = claimedRunAssembly(selected.config, { nativeSessionService, rootBudget, dailyUsage: selected.dailyUsage,
          provider, profile: { config: selected.config, workflowVersion: 'firestore-product-v1', promptPackVersion,
            settingsVersion: 'firestore:' + selected.settingsVersion, billingVersion: selected.billingSource + ':v1',
            billingSource: selected.billingSource, runLimits: limits } }, undefined, true, true, true);
        instance = createAgentRuntime({ config: selected.config, usage: requireDurableUsage, provider,
          chatDeliveryReviewModelCalls: selected.config.chatDeliveryReviewModelCalls,
          nativeSessionService, bindDurableRun: durable.bindDurableRun, boundRunLimits: limits,          admission, embeddings: selected.embeddings, diagnostics: event => {
            // The observer builds a fixed metadata allowlist; no arguments, content or errors are logged.
            if (event.phase === 'tool_rejection' || event.phase === 'model_error' || event.phase === 'tool_error')
              console.warn(JSON.stringify({ event: 'agent_diagnostic', ...event }));
            return options.diagnostics?.(event);
          } });
        authorize = async () => await input.authorize() && await selected.authorize();
      } catch (error) {
        return { runId: input.runId!, status: 'stopped', stopReason: error instanceof AgentStopped ? error.reason : 'unavailable',
          text: null, tools: [], counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 } };
      }
      return instance.run({ ...input, authorize });
    },
  };
  const knowledge = createKnowledgeRetriever(options.knowledge ?? { async candidates() { domainReject('knowledge_not_ready', 503); } },
    { async embed() { throw new AgentStopped('unavailable'); } });
  const agent = createProductAgent({ runtime, store: services.store, mixed:{runs:services.runs,online:options.online}, actions: services.actions, photos: options.photos, voices: options.voices, readChatFile: options.files ? createChatFileAgentReader(options.files) : undefined,
    chat: options.chat, memory: options.memory, summary: options.summary, tasks: options.online.tasks, documents: options.documents, sources: options.sources, concerns: options.concerns, growth: options.growth, contact: options.contact, knowledge });
  const transcribeVoice = voiceTranscripts && options.voices ? createVoiceTranscription({ store: voiceTranscripts, voices: options.voices, runtime }) : undefined;
  // Cold settlement reads the original billing source, not today's selected settings.
  const summaryDaily = {
    platform: new FirestoreAiUsage({ ...options, namespace: options.namespace + '_ai_usage', billingSource: 'platform' }),
    personal: new FirestoreAiUsage({ ...options, namespace: options.namespace + '_ai_usage', billingSource: 'personal' }),
  };
  const summaryData = new FirestoreDomainData(options), summaryAuthority = createFirestoreAuthority(options);
  const summaryPolicy = options.summaryWorkPolicy ? { ...options.summaryWorkPolicy,
    readLegacyAdmission: (binding: Parameters<SummaryWorkPolicyPort['readLegacyAdmission']>[0], input: Parameters<SummaryWorkPolicyPort['readLegacyAdmission']>[1]) =>
      readPrivateSummaryLegacyAdmission(summaryData, binding, input) } : undefined;
  const summaryWork = createFirestorePrivateSummaryWork({ ...options, memory: options.memory, runs: services.runs,
    policy: summaryPolicy, fastNoDispatchVerifier: createPrivateSummaryFastNoDispatchVerifier({ root: rootBudget, sessions: nativeSessionService }), terminalVerifier: { verify(binding, input) {
      return createPrivateSummaryTerminalVerifier({ root: rootBudget,
        daily: summaryDaily[input.grantRecord.grant.billingSource], sessions: nativeSessionService }).verify(binding, input);
    } } });
  const runSummaryPart = createPrivateSummaryPartMaintenance({ ...options, memory: options.memory,
    work: summaryWork, runtime, root: rootBudget });
  const maintainSummaryPart = (input: Parameters<typeof runSummaryPart>[0]) => runSummaryPart({ ...input,
    authorize: async () => await input.authorize() && await summaryAuthority.runTransaction(input.userId, input.childId,
      async b => (await summaryWork.readEntryGate(b)).kind === 'durable') });
  const transferFast = async (userId: string, childId: string, reference: string, target: { kind: 'next_fresh' } | { kind: 'repair_batch'; summaryId: string }) => {
    const result = await summaryWork.start(userId, childId, target, { reference });
    return result.kind === 'created' || result.kind === 'lookup';
  };
  const summaryScan = createFirestorePrivateSummaryScan({ ...options, memory: options.memory });
  type ScanSelection = { kind: 'candidate'; value: SummaryInput } | { kind: 'work'; workId: string };
  const eligibleWork = async (b: SummaryBinding, workId: string): Promise<ScanSelection | null> => {
    const { work } = await summaryWork.readStateIn(b, workId);
    if (work.authorizationVersion !== b.authorizationVersion || work.workerGeneration !== b.generation) return null;
    return work.activeAttemptId !== null && ['executing', 'unknown'].includes(work.state)
      || ['invalidated', 'suppressed'].includes(work.state)
      || work.state === 'completed' && work.completionWake?.scheduling.kind === 'pending_schedule'
      ? { kind: 'work', workId } : null;
  };
  const selectCandidate = async (b: SummaryBinding, source: Extract<SummaryFastSource, { kind: 'eligible' }>): Promise<ScanSelection | null> => {
    for (let index = 0; index < source.lineageKeys.length; index++) {
      const key = source.lineageKeys[index], row = await b.transaction.get(summaryData.ref('private_summary_works', 'private-summary-lineage', key));
      if (!row.exists) continue;
      const pointer = summaryData.open('private-summary-lineage', key, b.scope, summaryLineageRecordSchema, row);
      if (pointer.id !== key || pointer.version !== row.get('recordVersion') || firestoreDomainHash(pointer.scope) !== firestoreDomainHash(b.scope)
        || Object.entries(summaryData.tags(b.scope)).some(([name, value]) => row.get(name) !== value)) domainReject('private_summary_binding', 500);
      if (pointer.authorizationVersion !== b.authorizationVersion || pointer.workerGeneration !== b.generation) return null;
      if (index > 0 && !source.input.repairOf) {
        const prefix = await options.memory.readFastSource(b, { kind: 'fresh_prefix', firstMessageId: source.input.messages[0].id, messageCount: index });
        return prefix.kind === 'eligible' ? selectCandidate(b, prefix) : null;
      }
      if (pointer.owner.kind === 'work') return eligibleWork(b, pointer.owner.workId);
      if (pointer.owner.accounting.state !== 'no_dispatch') return null;
      // The actual transfer still revalidates the original source/root/certificate in T0.
      return { kind: 'candidate', value: source.input };
    }
    return { kind: 'candidate', value: source.input };
  };
  async function serviceOriginalWork(userId: string, childId: string, workId: string) {
    const { work } = await summaryWork.readState(userId, childId, workId);
    const scope = await summaryAuthority.runTransaction(userId, childId, async b => services.runs.current(b));
    if (work.activeAttemptId !== null && ['executing', 'unknown'].includes(work.state)) {
      const attempt = await summaryWork.readAttempt(userId, childId, work.activeAttemptId);
      const recovered = await summaryWork.recoverTerminal({ scope, runId: attempt.runId, attemptId: attempt.id });
      if (recovered.state === 'unknown' && attempt.rootContext && Date.now() >= attempt.rootContext.binding.deadlineAtMs) {
        await rootBudget.stop(attempt.rootContext);
        await summaryWork.recoverTerminal({ scope, runId: attempt.runId, attemptId: attempt.id });
      }
    } else if (work.state === 'invalidated' || work.state === 'suppressed') {
      await summaryWork.refreshSource({ scope, workId, expectedVersion: work.version });
    } else if (work.state === 'completed' && work.completionWake?.scheduling.kind === 'pending_schedule') {
      await summaryWork.scheduleCompletionWake(userId, childId, workId);
    }
  }
  const runSummary = createPrivateSummaryMaintenance({ memory: options.memory, store: services.store, runtime,
    async prepareInput(input) {
      const selected = await summaryAuthority.runTransaction(input.userId, input.childId, async b => {
        const gate = await summaryWork.readEntryGate(b);
        if (gate.kind !== 'durable') return { kind: gate.kind === 'legacy' ? 'legacy' as const : 'blocked' as const };
        const lease = await readFirestoreBackgroundClaim(summaryData, b, input.reference);
        const basis = lease && parseSummaryBackgroundBasis(lease.basis), context = await readContextBasis(summaryData, b);
        if (!lease || lease.kind !== 'memory-refresh' || lease.resourceId !== b.scope.childId || basis?.kind !== 'scope'
          || context.value.summaryBlocked || !context.value.summaryPending || context.value.summaryRequest !== basis.request) return { kind: 'blocked' as const };
        const suppressionCommits: (() => void)[] = [];
        const suppress = async (source: Extract<SummaryFastSource, { kind: 'suppressed' }>) => {
          const prepared = await preparePrivateSummarySuppressedSource(summaryData, b, source);
          if (prepared.kind === 'blocked') return false;
          suppressionCommits.push(prepared.commit); return true;
        };
        const scan = await summaryScan.prepare<ScanSelection>(b, {
          async readFresh() {
            const fresh = await options.memory.readFreshMaintenance(b); if (!fresh) return null;
            const source = await options.memory.readFastSource(b, { kind: 'fresh_prefix', firstMessageId: fresh.messages[0].id, messageCount: fresh.messages.length });
            if (source.kind === 'suppressed') await suppress(source);
            return source.kind === 'eligible' ? selectCandidate(b, source) : null;
          },
          async readRepair(summaryId) {
            const source = await options.memory.readFastSource(b, { kind: 'repair_batch', summaryId });
            if (source.kind === 'no_work' || source.kind === 'already_covered') return { kind: 'resolved' as const };
            if (source.kind === 'suppressed') return { kind: await suppress(source) ? 'resolved' as const : 'blocked' as const };
            if (source.kind !== 'eligible') return { kind: 'blocked' as const };
            const value = await selectCandidate(b, source);
            return value ? { kind: 'candidate' as const, value } : { kind: 'blocked' as const };
          },
          readWork: work => eligibleWork(b, work.id),
        });
        for (const commit of suppressionCommits) commit();
        scan.commit();
        return scan.selected ?? { kind: scan.scan.cycle.state === 'complete' ? 'complete' as const : 'pending' as const };
      });
      if (selected.kind !== 'work') return selected;
      await serviceOriginalWork(input.userId, input.childId, selected.workId);
      return { kind: 'pending' };
    },
    isLineagedUnknown: claim => summaryAuthority.runTransaction(claim.scope.userId, claim.scope.childId,
      b => readSummaryFastOwnedUnknown(summaryData, b, claim.trigger!.reference)),
    async prepareClaim(input) {
      const prepared = await summaryAuthority.runTransaction(input.userId, input.childId, async b => {
        const gate = await summaryWork.readEntryGate(b);
        if (gate.kind === 'blocked') return { kind: 'blocked' as const };
        if (gate.kind === 'legacy') {
          const value = await services.runs.prepareClaim(b, { trigger: { kind: 'worker', reference: input.reference },
            recipeId: 'memory-refresh', candidateRunId: randomUUID() });
          value.commit(); return { kind: 'legacy' as const, claim: value.claim };
        }
        const value = await services.runs.prepareFastProbeClaim(b, { reference: input.reference, candidate: input.candidate, candidateRunId: randomUUID() });
        if (value.kind === 'claimed') value.commit();
        return value;
      });
      if (prepared.kind === 'legacy') return { kind: 'claim', claim: prepared.claim };
      if (prepared.kind === 'blocked') {
        if ('workId' in prepared && prepared.workId || 'runId' in prepared && prepared.runId) {
          const target = input.candidate.repairOf ? { kind: 'repair_batch' as const, summaryId: input.candidate.repairOf } : { kind: 'next_fresh' as const };
          if (await transferFast(input.userId, input.childId, input.reference, target)) return { kind: 'pending' };
        }
        return { kind: 'blocked' };
      }
      const claim = prepared.claim;
      const certificate = async (mode: 'commit' | 'lookup') => (await summaryWork.commitFastNoDispatch(input.userId, input.childId, claim.runId, mode)).kind === 'verified';
      return { kind: 'claim', claim, fast: {
        bindRoot: context => summaryWork.bindFastRoot(input.userId, input.childId, claim.runId, context),
        commitNoDispatch: () => certificate('commit'), readNoDispatch: () => certificate('lookup'),
      } };
    },
    async transferAfterProbe(claim, reference) {
      const run = await summaryAuthority.runTransaction(claim.scope.userId, claim.scope.childId, b => services.runs.read(b, claim.runId));
      if (!run.summaryFast?.noDispatch) return false;
      const target = run.summaryFast.target.kind === 'fresh_message' ? { kind: 'next_fresh' as const }
        : { kind: 'repair_batch' as const, summaryId: run.summaryFast.target.repairOf };
      return transferFast(claim.scope.userId, claim.scope.childId, reference, target);
    },
    admitSelected: (claim, reference, selected) => summaryAuthority.runTransaction(claim.scope.userId, claim.scope.childId,
      b => authorizePrivateSummaryFastEntry(summaryData, b, { memory: options.memory, runs: services.runs, work: summaryWork },
        { runId: claim.runId, reference, selected })) });
  const maintainSummary = (input: Parameters<typeof runSummary>[0]) => runSummary({ ...input,
    authorize: async () => await input.authorize() && await summaryAuthority.runTransaction(input.userId, input.childId,
      async b => (await summaryWork.readEntryGate(b)).kind !== 'blocked') });
  const summarySessions = { prepareContentErasure: nativeSessionService.prepareContentErasure.bind(nativeSessionService) };
  return { ...services, routing, runtime, agent, voiceTranscripts, transcribeVoice, summaryWork, maintainSummaryPart, summarySessions,
    maintainSummary, summaryScan };
}

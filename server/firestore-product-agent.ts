import { createChatFileAgentReader } from './chat-file-agent.ts';
import { createFirestoreVoiceTranscripts } from './firestore-voice-transcripts.ts';
import { createVoiceTranscription } from './voice-transcription.ts';
import type { AgentDiagnostic } from './agent-observer.ts';
import { createPrivateSummaryMaintenance } from './private-summary-maintenance.ts';
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
  const agent = createProductAgent({ runtime, store: services.store, actions: services.actions, photos: options.photos, voices: options.voices, readChatFile: options.files ? createChatFileAgentReader(options.files) : undefined,
    chat: options.chat, memory: options.memory, summary: options.summary, tasks: options.online.tasks, documents: options.documents, sources: options.sources, concerns: options.concerns, growth: options.growth, contact: options.contact, knowledge });
  const transcribeVoice = voiceTranscripts && options.voices ? createVoiceTranscription({ store: voiceTranscripts, voices: options.voices, runtime }) : undefined;
  return { ...services, routing, runtime, agent, voiceTranscripts, transcribeVoice, maintainSummary: createPrivateSummaryMaintenance({ memory: options.memory, store: services.store, runtime }) };
}

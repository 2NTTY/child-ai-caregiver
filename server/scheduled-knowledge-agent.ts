import { createFirestoreKnowledgeWork } from './firestore-knowledge-work.ts';
import { publicMaintenanceWatch } from './knowledge-source-catalog.ts';
import type { SourceFetcher } from './knowledge-refresh-types.ts';
import { backgroundKnowledgeOperationFingerprint } from './background-knowledge-maintenance.ts';
import { createFirestoreKnowledgeMaintenance, knowledgeOperationId } from './firestore-knowledge-maintenance.ts';
import type { FirestoreModelRouting } from './firestore-model-routing.ts';
import { firestoreDomainHash } from './firestore-domain-data.ts';
import { observationHash } from './knowledge-observation.ts';
import { fetchKnowledgeSource } from './knowledge-source-fetch.ts';

/** Only the operator selects the payer. The named account must also opt in with its own current settings. */
export function createScheduledKnowledgeAgent(options: Omit<Parameters<typeof createFirestoreKnowledgeMaintenance>[0],
  'credentialBinding' | 'fetch' | 'sponsor'> & {
  payer?: string;
  sourceIds: readonly string[];
  fetch?: SourceFetcher;
  routing: Pick<FirestoreModelRouting, 'resolve'>;
  currentAuth(uid: string): Promise<{ userId: string; disabled: boolean; emailVerified: boolean }>;
}) {
  if (options.payer === undefined) return undefined;
  const uid = /^user:([^\s\x00-\x1f]{1,128})$/u.exec(options.payer)?.[1];
  if (!uid && options.payer !== 'platform') throw new Error('Invalid AI_KNOWLEDGE_MAINTENANCE_PAYER');
  const binding = firestoreDomainHash(['knowledge-agent-payer/1', options.payer]);
  const fetch = options.fetch ?? fetchKnowledgeSource;
  const accepts = (id: string) => options.sourceIds.includes(id) && Boolean(publicMaintenanceWatch(id));
  const work = createFirestoreKnowledgeWork(options);
  const runner = createFirestoreKnowledgeMaintenance({ ...options, credentialBinding: binding, fetch,
    ...(uid ? { sponsor: { userId: uid, routing: options.routing, async identityActive() {
      const identity = await options.currentAuth(uid);
      return identity.userId === uid && identity.emailVerified && !identity.disabled;
    } } } : {}) });
  return { binding, accepts,
    async run(watchId: string, revision: string, slot: string, workerGeneration: string, signal: AbortSignal) {
      if (!accepts(watchId) || !options.config.backgroundKnowledgeLiveFetch) return { state: 'stopped' as const };
      const slotKey = backgroundKnowledgeOperationFingerprint({ watchId, revision, slot, workerGeneration });
      const publishMode = options.config.backgroundKnowledgeLivePublish ? 'live' as const : 'dry_run' as const;
      const job = { watchId, revision, workerGeneration };
      const request = { watchId, workerGeneration, publishMode };
      // A pre-upgrade delivery of the original HTML watch may already have a fetch or a model receipt.
      const legacyPage = watchId === 'fhs-solid-food' && await work.inspect({ ...request, operationFingerprint: slotKey });
      const checkId = knowledgeOperationId(legacyPage ? 'knowledge-observation/1' : 'knowledge-scheduled-check/1', slotKey);
      const check = await options.refresh.process(job, checkId, fetch, signal, slot);
      if (!['changed', 'unchanged', 'already_recorded'].includes(check.status))
        return { state: check.status === 'unknown' ? 'unknown' as const : 'stopped' as const };
      const pin = await options.refresh.resumeCheck(job, checkId, true);
      if (pin?.status !== 'ok' || pin.items.length !== 1 || !pin.firstObservedAt) return { state: 'stopped' as const };
      const hash = observationHash(pin.items[0]!);
      const edition = await options.knowledge.publishedEdition(watchId);
      if (edition && !edition.enabled) return { state: 'stopped' as const };
      if (edition?.observationHash === hash) return { state: edition.current ? 'completed' as const : 'stopped' as const };

      // fetchedAt belongs to the continuous observation: it survives another poll
      // but changes when an earlier body returns after an intervening version.
      let operationFingerprint = firestoreDomainHash(['knowledge-scheduled-edition/2', watchId,
        revision, binding, publishMode, hash, pin.firstObservedAt]);
      if (legacyPage) operationFingerprint = slotKey;
      if (watchId === 'fhs-feeding-booklet-en') {
        const legacyKey = firestoreDomainHash(['knowledge-native-edition/1', watchId, revision, binding, hash]);
        const prior = await work.inspect({ ...request, operationFingerprint: legacyKey });
        if (prior && !prior.receipt && !prior.result?.published) operationFingerprint = legacyKey;
      }
      const result = await runner.start({ ...request, operationFingerprint }, signal, revision, checkId);
      if (result.status === 'in_progress' || result.code === 'operation_claim_busy')
        return { state: 'deferred' as const, nextAt: new Date(Date.now() + 60_000).toISOString() };
      if (result.code === 'knowledge_embedding_daily_admission' || result.code === 'knowledge_model_daily_admission') {
        const now = new Date();
        const nextAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
        return { state: 'deferred' as const, nextAt };
      }
      const status = result.status === 'already_recorded' ? result.code : result.status;
      if (result.published || status === 'unchanged' || status === 'dry_run_ready')
        return { state: 'completed' as const };
      return { state: result.code?.includes('unknown') || status === 'unavailable' ? 'unknown' as const : 'stopped' as const };
    } };
}

import { M03_INITIAL_WATCH_IDS } from '../src/shared/background-knowledge-maintenance.ts';
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
  routing: Pick<FirestoreModelRouting, 'resolve'>;
  currentAuth(uid: string): Promise<{ userId: string; disabled: boolean; emailVerified: boolean }>;
}) {
  if (options.payer === undefined) return undefined;
  const uid = /^user:([^\s\x00-\x1f]{1,128})$/u.exec(options.payer)?.[1];
  if (!uid && options.payer !== 'platform') throw new Error('Invalid AI_KNOWLEDGE_MAINTENANCE_PAYER');
  const binding = firestoreDomainHash(['knowledge-agent-payer/1', options.payer]);
  const runner = createFirestoreKnowledgeMaintenance({ ...options, credentialBinding: binding, fetch: fetchKnowledgeSource,
    ...(uid ? { sponsor: { userId: uid, routing: options.routing, async identityActive() {
      const identity = await options.currentAuth(uid);
      return identity.userId === uid && identity.emailVerified && !identity.disabled;
    } } } : {}) });
  return { binding, accepts: (id: string) => M03_INITIAL_WATCH_IDS.some(watch => watch === id),
    async run(watchId: string, revision: string, slot: string, workerGeneration: string, signal: AbortSignal) {
      let operationFingerprint = backgroundKnowledgeOperationFingerprint({ watchId, revision, slot, workerGeneration });
      let recordedCheckId: string | undefined;
      if (watchId === 'fhs-feeding-booklet-en') {
        recordedCheckId = knowledgeOperationId('knowledge-scheduled-check/1', operationFingerprint);
        const job = { watchId, revision, workerGeneration };
        const check = await options.refresh.process(job, recordedCheckId, fetchKnowledgeSource, signal, slot);
        if (!['changed', 'unchanged', 'already_recorded'].includes(check.status))
          return { state: check.status === 'unknown' ? 'unknown' as const : 'stopped' as const };
        const pin = await options.refresh.resumeCheck(job, recordedCheckId);
        if (pin?.status !== 'ok' || pin.items.length !== 1) return { state: 'stopped' as const };
        // Polls and restarts resume the same version and payer. A semantic hold or unknown charge
        // cannot acquire fresh generation allowance simply because the next weekly slot opened.
        operationFingerprint = firestoreDomainHash(["knowledge-native-edition/1", watchId, revision, binding, observationHash(pin.items[0]!)]);
      }
      const result = await runner.start({ watchId, workerGeneration, operationFingerprint,
        publishMode: options.config.backgroundKnowledgeLivePublish ? 'live' : 'dry_run' }, signal, revision, recordedCheckId);
      if (result.code === 'knowledge_window_pending') return { state:'deferred' as const, nextAt:new Date(Date.now()+60000).toISOString() };
      if (result.code === 'knowledge_embedding_daily_admission' || result.code === 'knowledge_model_daily_admission') {
        const now = new Date();
        const nextAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
        return { state: 'deferred' as const, nextAt };
      }
      const status = result.status === 'already_recorded' ? result.code : result.status;
      if (result.published || status === 'unchanged' || status === 'dry_run_ready' || status === 'candidate_held' && watchId !== 'fhs-feeding-booklet-en')
        return { state: 'completed' as const };
      return { state: result.code?.includes('unknown') || status === 'unavailable' ? 'unknown' as const : 'stopped' as const };
    } };
}

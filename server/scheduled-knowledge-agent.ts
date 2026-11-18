import { M03_INITIAL_WATCH_IDS } from '../src/shared/background-knowledge-maintenance.ts';
import { backgroundKnowledgeOperationFingerprint } from './background-knowledge-maintenance.ts';
import { createFirestoreKnowledgeMaintenance } from './firestore-knowledge-maintenance.ts';
import type { FirestoreModelRouting } from './firestore-model-routing.ts';
import { firestoreDomainHash } from './firestore-domain-data.ts';
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
      const operationFingerprint = backgroundKnowledgeOperationFingerprint({ watchId, revision, slot, workerGeneration });
      const result = await runner.start({ watchId, workerGeneration, operationFingerprint,
        publishMode: options.config.backgroundKnowledgeLivePublish ? 'live' : 'dry_run' }, signal, revision);
      const status = result.status === 'already_recorded' ? result.code : result.status;
      if (result.published || status === 'unchanged' || status === 'dry_run_ready' || status === 'candidate_held')
        return { state: 'completed' as const };
      return { state: result.code?.includes('unknown') || status === 'unavailable' ? 'unknown' as const : 'stopped' as const };
    } };
}

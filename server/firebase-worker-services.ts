import { readContextBasis, settleSummaryRequest } from './firestore-context-basis.ts';
import { FirestoreDomainData, firestoreDomainHash } from './firestore-domain-data.ts';
import { createFirestoreTaskDispatcher, type FirestoreTaskDispatcherOptions } from './firestore-task-dispatcher.ts';
import { createFirestoreBackgroundQueue, firestoreBackgroundReference, type BackgroundTransport } from './firestore-background-work.ts';
import { concernAgentContext } from './concern-context.ts';
import { createFirestoreBackgroundMaintenance } from './firestore-background-maintenance.ts';
import type { openFirebaseRuntime } from './firebase-runtime.ts';

/** Identical business consumers for cloud delivery and the loopback-only local dispatcher. */
export function createFirebaseWorkerServices(runtime: Awaited<ReturnType<typeof openFirebaseRuntime>>,
  delivery: FirestoreTaskDispatcherOptions['delivery'], backgroundDelivery: BackgroundTransport, controller: AbortController) {
  const { config, database, cipher, authority } = runtime;
    const options = { database, cipher, projectId: config.projectId, namespace: config.namespace,
      enabled: config.taskWorkerEnabled, currentAuth: runtime.currentAuth };
    const worker = runtime.reminders;
    const dispatcher = createFirestoreTaskDispatcher({ ...options, delivery });
    const maintenance = createFirestoreBackgroundMaintenance({ ...options, knowledge: runtime.knowledgeRefresh,
      journal: runtime.journal, photos: runtime.photos, voices: runtime.voices, files: runtime.files, avatars: runtime.avatarCleanup, erasures: runtime.erasures, cleanup: runtime.erasureCleanup });
    const background = createFirestoreBackgroundQueue({ ...options, readControl: tx => authority.readControl(tx),
      transport: backgroundDelivery, signal: controller.signal,
      async execute(job, signal) {
        if (['knowledge-check', 'photo-cleanup', 'voice-cleanup', 'file-cleanup', 'avatar-cleanup', 'scope-erasure'].includes(job.kind)) return maintenance.process(job, signal);
        const validIdentity = async () => {
          if (signal.aborted) return false;
          const current = await runtime.currentAuth(job.scope.ownerUserId);
          return !current.disabled && current.emailVerified && !!current.email;
        };
        if (!await validIdentity()) return { state: 'stopped' };
        if (job.kind === 'voice-transcription') {
          if (!runtime.product.transcribeVoice) throw new Error('Voice transcription not connected');
          return runtime.product.transcribeVoice(job, validIdentity, signal);
        }
        if (job.kind === 'memory-refresh') {
          const data = new FirestoreDomainData(options);
          const authorize = async () => await validIdentity() && await authority.runTransaction(job.scope.ownerUserId, job.scope.childId, async b => {
            const current = await readContextBasis(data, b);
            return b.generation === job.generation && b.authorizationVersion === job.authorizationVersion
              && firestoreDomainHash(b.scope) === firestoreDomainHash(job.scope) && current.value.summaryPending === true
              && !current.value.summaryBlocked && String(current.value.summaryRequest) === job.basis;
          });
          const result = await runtime.product.maintainSummary({ userId: job.scope.ownerUserId, childId: job.scope.childId,
            reference: firestoreBackgroundReference(job), authorize, signal }).catch(() => ({ state: 'unknown' as const, more: false }));
          await authority.runTransaction(job.scope.ownerUserId, job.scope.childId, async b => {
            if (b.generation !== job.generation || b.authorizationVersion !== job.authorizationVersion || firestoreDomainHash(b.scope) !== firestoreDomainHash(job.scope)) return;
            await settleSummaryRequest(data, b, Number(job.basis),
              result.state === 'unknown' ? 'unknown' : result.state === 'completed' ? result.more ? 'more' : 'complete' : 'deferred', firestoreBackgroundReference(job));
          });
          return { state: result.state };
        }
        if (job.kind === 'native-push') return runtime.nativePush.process(job, signal);
        if (job.kind === 'push') return runtime.push.process(job, signal);
        if (job.kind === 'telegram') return runtime.telegram.process(job, signal);
        if (job.kind === 'contact') return runtime.contact.process(job, signal);
        if (job.kind === 'child-change') { await runtime.growth.evaluate(job); return maintenance.childChange(job); }
        if (job.kind === 'document-refresh') return runtime.documents.processRefresh(job);
        if (job.kind === 'work-check') return runtime.product.continuation.check(job);
        const continuation = job.kind === 'work-continuation' ? await authority.runTransaction(job.scope.ownerUserId, job.scope.childId,
          b => runtime.product.continuation.input(b, job)) : null;
        const concern = job.kind === 'concern' ? await runtime.concerns.beginBackground(job) : null;
        const attention = job.kind === 'growth' ? await runtime.growth.backgroundInput(job) : null;
        const task = job.kind === 'task-agent' ? await authority.runTransaction(job.scope.ownerUserId, job.scope.childId,
          b => runtime.taskEvents.input(b, job)) : null;
        if (!['concern', 'growth', 'task-agent', 'work-continuation'].includes(job.kind)) throw new Error('Product background consumer not connected');
        if (!concern && !attention && !task && !continuation) {
          if (job.kind === 'work-continuation') return runtime.product.continuation.finish(job);
          return { state: 'stopped' };
        }
        const reference = firestoreBackgroundReference(job);
        const authorize = async () => await validIdentity() && await authority.runTransaction(job.scope.ownerUserId, job.scope.childId,
          async b => continuation ? !!await runtime.product.continuation.input(b, job) : concern ? runtime.concerns.authorizeBackground(b, job) : task
            ? !!await runtime.taskEvents.input(b, job) && await runtime.growth.taskAllowedIn(b, job.resourceId) : runtime.growth.authorizeBackground(b, job));
        try {
          const result = await runtime.product.agent.background({ userId: job.scope.ownerUserId, childId: job.scope.childId, reference,
            context: continuation ?? (concern ? { eventType: 'concern_followup', concern: concernAgentContext(concern) }
              : task ?? { eventType: 'growth_attention', attention, policy: 'Server-reviewed applicability; no medical rule generation, task execution or external notification' }),
            authorize, signal });
          if (concern) return runtime.concerns.finishBackground(job);
          if (continuation) return runtime.product.continuation.finish(job);
          return { state: result?.status === 'completed' ? 'completed' : result?.status === 'stopped' ? 'stopped' : 'unknown' };
        } catch {
          // Canonical run receipts determine recovery. Never create another run after a lost final response.
          if (concern) return runtime.concerns.finishBackground(job);
          if (continuation) return runtime.product.continuation.finish(job);
          return { state: 'unknown' };
        }
      } });
  return { worker, dispatcher, maintenance, background };
}

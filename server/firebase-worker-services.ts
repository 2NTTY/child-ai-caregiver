import { readSummaryFastOwnedUnknown } from './firestore-private-summary-ownership.ts';
import { readContextBasis, settleSummaryRequest } from './firestore-context-basis.ts';
import { FirestoreDomainData, firestoreDomainHash } from './firestore-domain-data.ts';
import { createFirestoreTaskDispatcher, type FirestoreTaskDispatcherOptions } from './firestore-task-dispatcher.ts';
import { createFirestoreBackgroundQueue, firestoreBackgroundReference, readFirestoreBackgroundClaim, type BackgroundTransport } from './firestore-background-work.ts';
import { parseSummaryBackgroundBasis } from './private-summary-work.ts';
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
    const maintenance = createFirestoreBackgroundMaintenance({ ...options, knowledge: runtime.knowledgeRefresh,proactiveEvents:runtime.proactiveEvents,
      journal: runtime.journal, summarySessions: runtime.product?.summarySessions,
      photos: runtime.photos, voices: runtime.voices, files: runtime.files, avatars: runtime.avatarCleanup, handover: runtime.handover, handoverUploads: runtime.handoverUploads, erasures: runtime.erasures, cleanup: runtime.erasureCleanup });
    const background = createFirestoreBackgroundQueue({ ...options, readControl: tx => authority.readControl(tx),
      transport: backgroundDelivery, signal: controller.signal,
      async execute(job, signal) {
        if (job.kind === 'knowledge-index-batch') {
          const uid = runtime.configuredAdminUid;
          if (!uid || !runtime.knowledgeIndexes || job.authorizationVersion !== firestoreDomainHash(uid)) return { state: 'stopped' };
          const current = await runtime.currentAuth(uid);
          return runtime.knowledgeIndexes.process(job, signal, current.userId === uid && current.emailVerified && !current.disabled && !!current.email);
        }
        if (job.kind === 'handover-upload-cleanup') return job.scope.ownerUserId === 'system:task-dispatch'
          ? maintenance.process(job, signal) : runtime.handoverUploads.cleanup(job.scope, job.resourceId, signal);
        if (job.kind === 'handover-cleanup') return job.scope.ownerUserId === 'system:task-dispatch'
          ? maintenance.process(job, signal) : runtime.handover.cleanup(job.scope, job.resourceId, signal);
        if (['knowledge-check', 'photo-cleanup', 'voice-cleanup', 'file-cleanup', 'avatar-cleanup', 'scope-erasure'].includes(job.kind)) return maintenance.process(job, signal);
        const validIdentity = async () => {
          if (signal.aborted) return false;
          const current = await runtime.currentAuth(job.scope.ownerUserId);
          return !current.disabled && current.emailVerified && !!current.email;
        };
        if (!await validIdentity()) return { state: 'stopped' };
        if (job.kind === 'proactive-day') return authority.runTransaction(job.scope.ownerUserId,job.scope.childId,
          b => runtime.proactive.daily(b,job,new Date().toISOString()));
        if (job.kind === 'proactive-assessment') {
          const load = () => authority.runTransaction(job.scope.ownerUserId,job.scope.childId,b=>runtime.proactive.input(b,job));
          const choice = await load();
          if (!choice) return {state:'stopped'};
          const reference = firestoreBackgroundReference(job);
          const result = await runtime.product.agent.background({userId:job.scope.ownerUserId,childId:job.scope.childId,reference,
            context:{eventType:choice.eventType,householdChanged:choice.householdChanged,householdChanges:choice.householdChanges,
              householdChangesComplete:choice.householdChangesComplete,publicEvents:choice.publicEvents,
              ...(choice.reason?{observation:choice.reason}:{})},
            authorize:async()=>await validIdentity() && !!await load(),signal});
          return authority.runTransaction(job.scope.ownerUserId,job.scope.childId,async b=>{
            const run = await runtime.product.runs.originalRun(b,'worker',reference);
            if (!result || !run) return { state: 'unknown' as const };
            if (run.id!==result.runId || run.workerGeneration!==b.generation ||
              !runtime.product.runs.matches(b,runtime.product.runs.current(b),run) || !await currentSources(b,result))
              return {state:'stopped' as const};
            return runtime.proactive.settle(b,job,result);
          });
        }
        if (job.kind === 'handover-export') return runtime.handover.processExport(job, signal);
        if (job.kind === 'handover-import') return runtime.handoverImports.process(job, signal);
        if (job.kind === 'voice-transcription') {
          if (!runtime.product.transcribeVoice) throw new Error('Voice transcription not connected');
          return runtime.product.transcribeVoice(job, validIdentity, signal);
        }
        if (job.kind === 'memory-refresh') {
          const data = new FirestoreDomainData(options), basis = parseSummaryBackgroundBasis(job.basis);
          if (!basis) return { state: 'stopped' };
          const reference = firestoreBackgroundReference(job);
          if (basis.kind === 'part') {
            const authorize = async () => await validIdentity() && await authority.runTransaction(job.scope.ownerUserId, job.scope.childId, async b =>
              (await runtime.product.summaryWork.readEntryGate(b)).kind === 'durable'
                && await runtime.product.summaryWork.authorizeBackgroundPart(b, reference));
            if (!await authorize()) return { state: 'stopped' };
            const result = await runtime.product.maintainSummaryPart({ userId: job.scope.ownerUserId, childId: job.scope.childId,
              workId: basis.binding.workId, reference, authorize, signal }).catch(() => ({ state: 'unknown' as const }));
            return { state: result.state };
          }
          if (basis.kind === 'completion') {
            // A completion is a canonical scope hint, never a grant or an acknowledgement of coverage.
            const accepted = await authority.runTransaction(job.scope.ownerUserId, job.scope.childId, async b => {
              const live = await readFirestoreBackgroundClaim(data, b, reference);
              if (!live || live.resourceId !== b.scope.childId || live.basis !== job.basis
                || (await runtime.product.summaryWork.readEntryGate(b)).kind !== 'durable') return false;
              const current = await readContextBasis(data, b);
              if (!Number.isSafeInteger(current.value.summaryRequest) || current.value.summaryBlocked) return false;
              await settleSummaryRequest(data, b, current.value.summaryRequest!, 'more');
              return true;
            });
            return { state: accepted ? 'completed' : 'stopped' };
          }
          const authorize = async () => await validIdentity() && await authority.runTransaction(job.scope.ownerUserId, job.scope.childId, async b => {
            const current = await readContextBasis(data, b);
            const gate = await runtime.product.summaryWork.readEntryGate(b);
            return b.generation === job.generation && b.authorizationVersion === job.authorizationVersion
              && firestoreDomainHash(b.scope) === firestoreDomainHash(job.scope) && current.value.summaryPending === true
              && gate.kind !== 'blocked' && !current.value.summaryBlocked && current.value.summaryRequest === basis.request;
          });
          if (!await authorize()) return { state: 'stopped' };
          const result = await runtime.product.maintainSummary({ userId: job.scope.ownerUserId, childId: job.scope.childId,
            reference, authorize, signal }).catch(() => ({ state: 'unknown' as const, more: false }));
          const settledState = await authority.runTransaction(job.scope.ownerUserId, job.scope.childId, async b => {
            if (b.generation !== job.generation || b.authorizationVersion !== job.authorizationVersion || firestoreDomainHash(b.scope) !== firestoreDomainHash(job.scope)) return 'stopped' as const;
            if ('lineagedUnknown' in result && result.lineagedUnknown === true) {
              // The earlier check is only a routing hint. Clearing the scope barrier
              // requires the complete original ownership proof in this same transaction.
              const mapped = await readSummaryFastOwnedUnknown(data, b, reference);
              await settleSummaryRequest(data, b, basis.request, mapped ? 'more' : 'unknown', reference);
              return mapped ? 'completed' as const : 'unknown' as const;
            }
            if (result.state === 'completed' && !result.more && (await runtime.product.summaryWork.readEntryGate(b)).kind === 'durable') {
              const clear = await runtime.product.summaryScan.prepareClearPending(b, basis.request);
              if (clear.canClear) clear.commit();
              else await settleSummaryRequest(data, b, basis.request, 'more', reference);
              return result.state;
            }
            await settleSummaryRequest(data, b, basis.request,
              result.state === 'unknown' ? 'unknown' : result.state === 'completed' ? result.more ? 'more' : 'complete' : 'deferred', reference);
            return result.state;
          });
          return { state: settledState };
        }
        if (job.kind === 'native-push') return runtime.nativePush.process(job, signal);
        if (job.kind === 'push') return runtime.push.process(job, signal);
        if (job.kind === 'telegram') return runtime.telegram.process(job, signal);
        if (job.kind === 'contact') return runtime.contact.process(job, signal);
        if (job.kind === 'child-change') {
          const evaluated = await runtime.growth.evaluate(job);
          return evaluated.state === 'deferred' ? evaluated : maintenance.childChange(job);
        }
        if (job.kind === 'document-refresh') return runtime.documents.processRefresh(job);
        if (job.kind === 'work-check') return runtime.product.continuation.check(job);
        const continuation = job.kind === 'work-continuation' ? await authority.runTransaction(job.scope.ownerUserId, job.scope.childId,
          b => runtime.product.continuation.input(b, job)) : null;
        const concern = job.kind === 'concern' ? await runtime.concerns.beginBackground(job) : null;
        let attention: Awaited<ReturnType<typeof runtime.growth.backgroundInput>> = null;
        try { if (job.kind === 'growth') attention = await runtime.growth.backgroundInput(job); }
        catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'growth_import_pending')
            return { state: 'deferred', nextAt: new Date(Date.now() + 30_000).toISOString() };
          throw error;
        }
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
          if (continuation) {
            if (result?.status==='completed' && result.outcome!=='no_action' && result.text.trim() && await validIdentity()) {
              await authority.runTransaction(job.scope.ownerUserId,job.scope.childId,async b=>{
                const run = await runtime.product.runs.originalRun(b,'worker',reference);
                if (!run || run.id!==result.runId || run.workerGeneration!==b.generation || !runtime.product.runs.matches(b,runtime.product.runs.current(b),run)
                  || !(await runtime.proactive.read(b)).enabled || !await runtime.product.continuation.input(b,job)
                  || !await currentSources(b,result)) return;
                await runtime.chat.contactParent(b,{opId:reference,origin:'followup',runId:run.id,text:result.text});
              });
            }
            return runtime.product.continuation.finish(job);
          }
          return { state: result?.status === 'completed' ? 'completed' : result?.status === 'stopped' ? 'stopped' : 'unknown' };
        } catch {
          // Canonical run receipts determine recovery. Never create another run after a lost final response.
          if (concern) return runtime.concerns.finishBackground(job);
          if (continuation) {
            const delivered = await authority.runTransaction(job.scope.ownerUserId, job.scope.childId,
              b => runtime.chat.getContact(b, 'followup', reference));
            if (delivered) return runtime.product.continuation.finish(job);
          }
          return { state: 'unknown' };
        }
      } });
  async function currentSources(b:import('./firestore-authority.ts').FirestoreAuthorityTransaction,result:import('../src/shared/product-agent.ts').ProductAgentResult) {
    for (const citation of result.citations) {
      const [active] = await runtime.knowledge?.continuationSources(b.transaction,[citation.sourceId]) ?? [];
      if (!active?.available || active.versionId!==citation.versionId || active.hash!==citation.versionHash) return false;
    }
    return true;
  }
  return { worker, dispatcher, maintenance, background };
}

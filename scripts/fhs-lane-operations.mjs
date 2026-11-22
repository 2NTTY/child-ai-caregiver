import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openFirebasePersistence } from '../server/firebase-persistence.ts';
import { createKnowledgeSourceFetcher } from '../server/knowledge-source-fetch.ts';
import { matchesFhsPdfObservation, openFhsPdfReads, resolveFhsPdfObservation } from './fhs-pdf-reads.ts';
import { createFirestoreKnowledgeRefresh } from '../server/firestore-knowledge-refresh.ts';
import { createFirestoreKnowledgeWork } from '../server/firestore-knowledge-work.ts';
import { createFirestoreKnowledgeStore } from '../server/firestore-knowledge.ts';
import { cloudKnowledgeOriginalBucket } from '../server/firestore-knowledge-originals.ts';
import { knowledgeOperationId } from '../server/firestore-knowledge-maintenance.ts';
import { platformSourceWatches } from '../server/knowledge-source-catalog.ts';
import { platformMaterials } from '../server/platform-materials.ts';
import { campaign, campaignCredentials } from '../server/knowledge-campaign-budget.ts';
import { knowledgeReviewHash } from '../server/knowledge-review-assessment.ts';
import { observationHash } from '../server/knowledge-observation.ts';
import { bindReviewedWindow } from '../server/fhs-reviewed-window.ts';
import { manualPublicationPin } from '../server/fhs-manual-publication.ts';
import { bindFirstDispatch, firstDispatchScopeHash, firstDispatchWorkId } from '../server/fhs-undispatched-original.ts';
import { retainedDraftWorkId } from '../server/knowledge-retained-draft.ts';

export function classifyLaneOperation(source, check, saved, active, tickets) {
  if ((!saved && (tickets.length || active)) || tickets.some(t => t.state !== 'settled' && !t.operationFingerprint))
    return { state: 'reconciliation_required', code: 'fhs_lane_unbound_or_unsettled_charge' };
  if (!check) return saved ? { state: 'reconciliation_required', code: 'fhs_lane_original_check_missing' } : { state: 'awaiting_observation' };
  if (!matchesFhsPdfObservation(source, check)) {
    if (saved || active) return { state: 'reconciliation_required', code: 'fhs_lane_original_check_changed' };
    if (check.status === 'ok' || check.pdfEditionReview || check.status === 'unavailable')
      return { state: 'held', code: 'fhs_lane_frozen_original_unavailable', observedSha256: check.items?.[0]?.extraction?.contentHash
        ?? check.pdfEditionReview?.sha256 ?? null, httpStatus: check.httpStatus ?? null };
    return { state: 'source_blocked', code: 'fhs_lane_original_check_failed', reason: check.reason ?? null };
  }
  const hash = observationHash(check.items[0]);
  if (saved?.receipt || active || saved?.result?.published) {
    if (saved?.result?.published && saved.result.observationHash === hash && saved.receipt?.state === 'committed'
      && saved.receipt.observationHash === hash && saved.prepared?.review.decision === 'approve_candidate'
      && active?.enabled && active.current && active.observationHash === hash && active.versionHash === saved.prepared.versionHash)
      return { state: 'published', versionId: active.versionId, versionHash: active.versionHash, observationHash: hash };
    return { state: 'reconciliation_required', code: 'fhs_lane_publication_mismatch' };
  }
  if (saved?.result) {
    if (saved.result.status === 'candidate_held' && saved.result.observationHash === hash && saved.result.code)
      return { state: 'held', code: saved.result.code, observationHash: hash };
    return { state: 'source_blocked', code: saved.result.code ?? saved.result.status, observationHash: hash };
  }
  if (tickets.some(t => t.state !== 'settled')) return { state: 'source_blocked', code: 'fhs_lane_dispatch_reserved', observationHash: hash };
  if (saved?.lease && saved.lease.untilMs > Date.now()) return { state: 'source_blocked', code: 'fhs_lane_work_leased', untilMs: saved.lease.untilMs };
  return { state: 'ready', started: Boolean(saved), observationHash: hash, quotaDay: saved?.waitingForQuotaDay ?? null };
}

export function createLaneOperations(persistence, fetchSource, lane, physicalPage) {
  const { database, config, cipher, authority } = persistence;
  const domain = { database, cipher, projectId: config.projectId, namespace: config.namespace, readControl: tx => authority.readControl(tx) };
  const refresh = createFirestoreKnowledgeRefresh({ ...domain, definitions: platformSourceWatches,
    originalBucket: cloudKnowledgeOriginalBucket(config.projectId, config.photoBucket) });
  const work = createFirestoreKnowledgeWork(domain);
  const knowledge = createFirestoreKnowledgeStore({ ...domain, sourceIds: config.knowledgeSourceIds, platformMaterials, observations: refresh.gate });
  const ledger = database.collection(config.namespace + '_knowledge_campaigns').doc(campaign);
  const attempts = ledger.collection('attempts');
  const bindingRef = id => ledger.collection('publicationBindings').doc(id);
  const sameBinding = (pin, source, operation) => pin.lane === lane && pin.sourceId === source.sourceId && pin.sha256 === source.sha256
    && pin.pages === source.pages && pin.operationFingerprint === operation;

  async function inspect(source) {
    const id = source.sourceId;
    const [[job], active, charges, bound] = await Promise.all([refresh.jobs(id), knowledge.publishedEdition(id),
      attempts.where('sourceId', '==', id).get(), bindingRef(id).get()]);
    const tickets = charges.docs.map(doc => ({ id: doc.id, kind: doc.get('kind'), state: doc.get('state'),
      operationFingerprint: doc.get('operationFingerprint') ?? null, cost: doc.get('cost') ?? null }));
    const pin = bound.data();
    if (!job) {
      if (physicalPage) throw Error('knowledge_print_page_not_commissioned');
      const registered = await database.runTransaction(tx => refresh.gate.read(tx, id), { readOnly: true });
      const state = registered || tickets.length || active || pin ? 'reconciliation_required' : 'unregistered';
      return { state, operationFingerprint: pin?.operationFingerprint ?? null, tickets, ...(state === 'unregistered' ? {} : { code: 'fhs_lane_registration_unavailable' }) };
    }
    const operationFingerprint = knowledgeReviewHash([campaignCredentials, id, job.data.revision, job.data.workerGeneration]);
    if (pin && !sameBinding(pin, source, operationFingerprint) || tickets.some(t => t.operationFingerprint && t.operationFingerprint !== operationFingerprint))
      return { state: 'reconciliation_required', code: 'fhs_lane_operation_changed', operationFingerprint: pin?.operationFingerprint ?? null, tickets };
    const request = { watchId: id, operationFingerprint, workerGeneration: job.data.workerGeneration, publishMode: 'live' };
    const [{ checkId, snapshot: check }, saved] = await Promise.all([
      resolveFhsPdfObservation(refresh, job.data, operationFingerprint, source),
      work.inspect(request),
    ]);
    let operation = classifyLaneOperation(source, check, saved, active, tickets);
    const revision = pin && matchesFhsPdfObservation(source, check)
      && bindReviewedWindow(manualPublicationPin(id),operationFingerprint,saved);
    let repair;
    const firstDispatch = pin && matchesFhsPdfObservation(source,check) && bindFirstDispatch(manualPublicationPin(id),operationFingerprint,saved,physicalPage);
    if (physicalPage && (!firstDispatch || firstDispatch.observation !== observationHash(check.items[0])))
      throw Error('knowledge_print_page_not_commissioned');
    if (firstDispatch && firstDispatch.observation===observationHash(check.items[0])) {
      const deliveryOperation=firstDispatchWorkId(operationFingerprint);
      const child=await work.inspect({...request,operationFingerprint:deliveryOperation});
      repair={deliveryOperation,originalCode:saved.result.code,deliveryModelCalls:child?.budget.modelCalls ?? 0,...(physicalPage ? {physicalPage} : {})};
      if (child?.firstDispatchFrom===operationFingerprint && child.firstDispatchScopeHash===firstDispatchScopeHash(firstDispatch))
        operation=physicalPage && tickets.some(t=>t.state!=='settled')
          ? {state:'source_blocked',code:'fhs_lane_dispatch_reserved',observationHash:firstDispatch.observation}
          : classifyLaneOperation(source,check,child,active,tickets);
      else if (!child && !active && !tickets.length) operation={state:'ready',started:true,observationHash:firstDispatch.observation};
      else operation={state:'reconciliation_required',code:'fhs_lane_unbound_or_unsettled_charge'};
    }
    if (!physicalPage && revision && observationHash(check.items[0]) === revision.observationHash) {
      const deliveryOperation = retainedDraftWorkId(operationFingerprint);
      const child = await work.inspect({...request,operationFingerprint:deliveryOperation});
      repair = {deliveryOperation, originalCode:saved.result.code, deliveryModelCalls:child?.budget.modelCalls ?? 0};
      if (child) {
        operation = classifyLaneOperation(source,check,child,active,tickets);
        const provenance = child.prepared?.provenance.retainedDraft;
        if (child.prepared && (provenance?.priorWork !== operationFingerprint || provenance.revisionHash !== knowledgeReviewHash(revision.registration)))
          operation = {state:'reconciliation_required',code:'fhs_lane_publication_mismatch'};
      } else if (!active && tickets.every(t => t.state === 'settled')) {
        operation = {state:'ready',started:true,observationHash:revision.observationHash};
      } else {
        operation = {state:'reconciliation_required',code:'fhs_lane_unbound_or_unsettled_charge'};
      }
    }
    return { ...operation, ...repair, operationFingerprint,
      pinned: Boolean(pin), checkId, revision: job.data.revision, workerGeneration: job.data.workerGeneration, modelCalls: saved?.budget.modelCalls ?? 0, tickets };
  }

  async function prepare(source, prior) {
    const id = source.sourceId;
    if (prior.state === 'unregistered') await refresh.register(id, 'fhs-initial-20261120', true);
    const [job] = await refresh.jobs(id);
    if (!job) throw Error('fhs_lane_registration_unavailable');
    const operation = knowledgeReviewHash([campaignCredentials, id, job.data.revision, job.data.workerGeneration]);
    if (prior.operationFingerprint && operation !== prior.operationFingerprint) throw Error('fhs_lane_operation_changed');
    await database.runTransaction(async tx => {
      const address = bindingRef(id);
      const [bound, budget] = await tx.getAll(address, ledger);
      const [registered, control] = await Promise.all([refresh.gate.read(tx, id), authority.readControl(tx)]);
      if (!budget.exists || !registered?.watch.manualOnly || !registered.watch.enabled || !registered.catalogMatches
        || !control.enabled || control.generation !== job.data.workerGeneration || registered.watch.revision !== job.data.revision)
        throw Error('fhs_lane_registration_changed');
      if (bound.exists) {
        if (!sameBinding(bound.data(), source, operation)) throw Error('fhs_lane_operation_changed');
      } else tx.create(address, { lane, sourceId: id, sha256: source.sha256, pages: source.pages, operationFingerprint: operation,
        revision: job.data.revision, workerGeneration: job.data.workerGeneration });
    });
    if (prior.state === 'ready') return inspect(source);
    const checkId = knowledgeOperationId('knowledge-observation/1', operation);
    const checked = await refresh.process(job.data, checkId, async (definition, signal) => {
      const fetched = await fetchSource(definition, signal);
      if (fetched.status !== 'ok') return fetched;
      if (!fetched.original || !matchesFhsPdfObservation(source, fetched)
        || createHash('sha256').update(fetched.original.bytes).digest('hex') !== source.sha256)
        return { status: 'failed', reason: 'response' };
      return fetched;
    }, new AbortController().signal);
    const after = await inspect(source);
    if (after.operationFingerprint !== operation) throw Error('fhs_lane_operation_changed');
    if (after.state === 'awaiting_observation') return { ...after, state: 'source_blocked', code: 'fhs_lane_original_check_incomplete', checkStatus: checked.status };
    return after;
  }
  return { inspect, prepare };
}

export async function openLaneRuntime(lane, action, physicalPage) {
  const p = await openFirebasePersistence(process.env);
  try {
    if (p.config.projectId !== 'ai-caregivers-for-children') throw Error('knowledge_campaign_environment_mismatch');
    const dir = process.env.FHS_CAMPAIGN_PDF_READS, index = process.env.FHS_CAMPAIGN_PDF_READS_SHA256;
    if (Boolean(dir) !== Boolean(index)) throw Error('fhs_pdf_reads_configuration');
    const fetch = createKnowledgeSourceFetcher({ ...(dir && action !== 'status' ? { pdfReader: await openFhsPdfReads(dir, index) } : {}) });
    const child = fileURLToPath(new URL('./fhs-initial-campaign.mjs', import.meta.url));
    return {
      ...createLaneOperations(p, fetch, lane, physicalPage),
      report(source, receipt) { console.log(JSON.stringify({ lane, sourceId: source.sourceId, sha256: source.sha256, pages: source.pages, ...receipt })); },
      dispatch(source, original, started) {
        const command = started ? ['resume-approved', source.sourceId, original] : ['publish-approved', source.sourceId];
        const result = spawnSync(process.execPath, [child, ...command], { stdio: 'inherit', env: { ...process.env,
          FHS_CAMPAIGN_LANE: lane, FHS_CAMPAIGN_ORIGINAL_OPERATION: original } });
        return result.status ?? 1;
      },
      close: () => p.close(),
    };
  } catch (error) { await p.close(); throw error; }
}

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openFirebasePersistence } from '../server/firebase-persistence.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { AgentBudget } from '../server/agent-budget.ts';
import { AgentGatewayModel, createVertexAgentProvider, originalKnowledgePdf } from '../server/agent-model-gateway.ts';
import { createFirestoreAdmin } from '../server/firestore-admin.ts';
import { FirestoreAiUsage, KNOWLEDGE_PUBLICATION_PAYER } from '../server/firestore-ai-usage.ts';
import { createFirestoreKnowledgeStore } from '../server/firestore-knowledge.ts';
import { createFirestoreKnowledgeRefresh,parseKnowledgeObservation } from '../server/firestore-knowledge-refresh.ts';
import { cloudKnowledgeOriginalBucket } from '../server/firestore-knowledge-originals.ts';
import { createFirestoreKnowledgeWork } from '../server/firestore-knowledge-work.ts';
import { requireDurableUsage } from '../server/firestore-model-routing.ts';
import { FirestoreRootBudget } from '../server/firestore-root-budget.ts';
import { bindFirstDispatch, firstDispatchWorkId } from '../server/fhs-undispatched-original.ts';
import { manualPublicationPin } from '../server/fhs-manual-publication.ts';
import { campaign, campaignCredentials, campaignModel, createKnowledgeCampaignBudget, matchesCampaignPublicationBinding } from '../server/knowledge-campaign-budget.ts';
import { sourceVersionHash } from '../server/knowledge-inputs.ts';
import { knowledgeReviewHash,knowledgeOperationId } from '../server/knowledge-review-assessment.ts';
import { observationHash } from '../server/knowledge-observation.ts';
import { observeKnowledgeLeaflet } from '../server/knowledge-source-fetch.ts';
import { verifiedOralExcerpts } from '../server/fhs-verified-oral-excerpts.ts';
import { KNOWLEDGE_LEXICAL_BUCKETS, KNOWLEDGE_LEXICAL_BATCH } from '../server/knowledge-lexical-index.ts';
import { platformSourceWatches } from '../server/knowledge-source-catalog.ts';
import { platformMaterials } from '../server/platform-materials.ts';
import { printedCorrection, copyPrintedPages, checkPrintedTranscription, makePrintedCorrectionRequest, correctedPrintedEdition } from './fhs-printed-correction.mjs';

const [action,sourceId,versionId,original,confirmation,...extra] = process.argv.slice(2);
if (!['status','review','restore'].includes(action) || sourceId !== printedCorrection.sourceId || !/^[a-f0-9]{64}$/u.test(original ?? '')
  || !/^[0-9a-f-]{36}$/u.test(versionId ?? '') || extra.length || (action === 'status' ? confirmation !== undefined : confirmation !== '--operator-confirmed'))
  throw Error('Use status|review|restore SOURCE WITHDRAWN_VERSION ORIGINAL [--operator-confirmed]');

const p = await openFirebasePersistence(process.env);
try {
  const {database,cipher,config,authority} = p;
  assert.equal(config.projectId,'ai-caregivers-for-children');
  assert.equal(config.namespace,'yuban_authority');
  assert.equal(config.databaseId,'yuban-firebase-20261011');
  assert.equal(process.env.AI_KNOWLEDGE_MAINTENANCE_PAYER,'platform');
  assert.ok(!process.env.FIRESTORE_EMULATOR_HOST);
  const domain = {...config,database,cipher,readControl:tx=>authority.readControl(tx)};
  const refresh = createFirestoreKnowledgeRefresh({...domain,definitions:platformSourceWatches,
    originalBucket:cloudKnowledgeOriginalBucket(config.projectId,config.photoBucket)});
  const knowledge = createFirestoreKnowledgeStore({...domain,sourceIds:config.knowledgeSourceIds,platformMaterials,observations:refresh.gate});
  const work = createFirestoreKnowledgeWork(domain), campaignBudget = createKnowledgeCampaignBudget(database,config.namespace);
  const [job] = await refresh.jobs(sourceId), pin = manualPublicationPin(sourceId);
  assert.equal(pin?.sha256,printedCorrection.pdfHash);
  assert.equal(pin.pages,printedCorrection.totalPages);
  const {workerGeneration,revision} = job.data;
  const priorRequest = {watchId:sourceId,operationFingerprint:original,workerGeneration,publishMode:'live'};
  assert.equal(original,knowledgeReviewHash([campaignCredentials,sourceId,revision,workerGeneration]));
  const parent = await work.inspect(priorRequest), grant = bindFirstDispatch(pin,original,parent);
  const first = firstDispatchWorkId(original), prior = await work.inspect({...priorRequest,operationFingerprint:first});
  assert.ok(grant && prior?.firstDispatchFrom === original && prior.result?.published && prior.receipt && prior.prepared);
  const prev = prior.prepared, pdf = prev.provenance.nativePdf;
  assert.equal(prev.assessment.decision,'approve');
  assert.equal(prev.review.modelReviewCompleted,true);
  assert.equal(pdf.contentHash,pin.sha256);
  assert.ok(prev.provenance.organizeAttemptKey !== prev.provenance.reviewAttemptKey);
  for (const reading of [pdf.organize,pdf.review]) {
    assert.equal(reading.unreadablePages.length,0);
    assert.deepEqual(reading.pages.map(p=>p.page),Array.from({length:pin.pages},(_,i)=>i+1));
  }
  const commission = database.collection(config.namespace+'_knowledge_campaigns').doc(campaign).collection('publicationBindings').doc(sourceId);
  const sourceRef = database.collection(config.namespace+'_knowledge_sources').doc(sourceId);
  const sample = parseKnowledgeObservation(verifiedOralExcerpts(job.definition,pin.sha256,pin.pages,prev.source.title,prev.source.sourceDateText ?? null));
  const sampleHash = observationHash(sample);
  async function checkOrigin(tx, acceptableObservations=[grant.observation], correctedHash) {
    const [{base,selected},flag,stored,head] = await Promise.all([knowledge.platformEditions(sourceId,versionId,tx),authority.readControl(tx),tx.get(commission),tx.get(sourceRef)]);
    assert.ok(flag.enabled && flag.generation === workerGeneration && matchesCampaignPublicationBinding(stored.data(),pin,original,revision,workerGeneration));
    assert.ok(selected.state === 'withdrawn' && selected.versionId === versionId && selected.versionHash === prev.versionHash);
    assert.equal(sourceVersionHash(selected.source),prev.versionHash);
    assert.ok(acceptableObservations.includes(selected.observationHash));
    if (correctedHash && head.get('enabled') === true && base?.versionHash === correctedHash && base.state === 'reviewed') {
      assert.equal(base.observationHash,sampleHash);
      return 'restored';
    }
    assert.ok(head.get('enabled') === false && head.get('activeVersionId') === versionId);
    return 'withdrawn';
  }
  if (action === 'review') await database.runTransaction(tx=>checkOrigin(tx),{readOnly:true});
  const sourceBytes = await refresh.originals.readPdf(sourceId,pin.sha256);
  const packet = await copyPrintedPages(sourceBytes);
  // A changed prompt or proposed excerpt cannot allocate another revision for this edition.
  const operationFingerprint = knowledgeReviewHash(['fhs-printed-correction/1',original,first,versionId,prev.versionHash]);
  const request = {...priorRequest,operationFingerprint};
  const input = makePrintedCorrectionRequest(operationFingerprint,packet.hash);
  const stage = {system:input.system,user:input.user,attemptKey:input.attemptKey};
  let saved = await work.inspectPrintedStage(request,stage);
  if (!saved && action === 'review') {
    const ai = readAiConfig(process.env), policy = createFirestoreAdmin(domain,ai), current = await policy.readPolicy();
    assert.ok(ai.enabled && ai.backgroundKnowledgeMaintenanceEnabled && ai.backgroundKnowledgeLiveFetch && ai.backgroundKnowledgeLivePublish && current.enabled);
    assert.equal(ai.project,config.projectId); assert.equal(ai.location,'global');
    const settings = {...ai,model:campaignModel,agentThinkingLevel:'low',maxOutputTokens:1024,maxAttempts:1,agentMaxRetries:0,
      dailyUserAttempts:current.dailyUserAttempts,dailyGlobalAttempts:current.dailyGlobalAttempts,timeoutMs:Math.min(ai.timeoutMs,current.modelRequestSeconds*1000)};
    const limits = {modelCalls:1,toolCalls:1,queryEmbeddings:1,deadlineMs:Math.min(300000,current.maxRunSeconds*1000)};
    const daily = new FirestoreAiUsage({...domain,namespace:config.namespace+'_ai_usage',billingSource:'platform',manualPublication:pin});
    const capacity = async tx => await campaignBudget.hasGenerationCapacity(tx,settings.maxOutputTokens)
      && daily.modelCapacity(tx,KNOWLEDGE_PUBLICATION_PAYER,settings.dailyUserAttempts,settings.dailyGlobalAttempts);
    const lease = randomUUID(), configuration = knowledgeReviewHash([operationFingerprint,printedCorrection,input.attemptKey,current.version,campaignModel]);
    const session = await work.bind(request,lease,configuration,{modelCalls:1,deadlineMs:limits.deadlineMs},undefined,capacity);
    const claim = await session.ports.claimOperation(operationFingerprint,lease,session.deadlineAtMs);
    if (claim.status !== 'claimed') throw Error('fhs_printed_review_busy_or_closed');
    try {
      await session.completeText(stage,async rootRunId => {
        const authorize = async () => {
          const settings = await policy.readPolicy();
          return settings.enabled && settings.version === current.version && await session.authorize();
        };
        const meter = campaignBudget.meter({sourceId,operationFingerprint:original,async assertLease(tx){
          await session.assertLease(tx);await checkOrigin(tx);
        }},settings.maxOutputTokens);
        const empty = '00000000-0000-0000-0000-000000000000';
        const context = {generation:1,binding:{rootRunId,ownerId:KNOWLEDGE_PUBLICATION_PAYER,workspaceId:empty,childId:empty,
          authorizationVersion:revision,storageEpoch:workerGeneration,trigger:{kind:'knowledge-maintenance',reference:sourceId},
          workflowVersion:'knowledge-maintenance/1',promptPackVersion:'fhs-printed-correction/1',settingsVersion:String(current.version),
          billingVersion:campaignCredentials,limits:{modelCalls:1,toolCalls:1,queryEmbeddings:1},deadlineAtMs:session.deadlineAtMs}};
        const root = new FirestoreRootBudget({...domain,namespace:config.namespace+'_knowledge_budget'});
        const budget = new AgentBudget(undefined,limits.deadlineMs,session.deadlineAtMs);
        try {
          budget.configurePersonal(limits);
          await budget.initializeDurable({adapter:root,context,dailyUsage:daily,runLimits:limits});
          const gateway = new AgentGatewayModel({config:settings,budget,provider:meter.generation(createVertexAgentProvider(settings),input.attemptKey),
            usage:requireDurableUsage,userId:KNOWLEDGE_PUBLICATION_PAYER,childId:empty,authorize,durableDailyUsage:{adapter:daily,context}});
          return await gateway.completeText({...input,pdf:originalKnowledgePdf(packet.pdf,packet.hash,true)});
        } finally {budget.close();}
      },capacity);
    } finally {await session.ports.releaseOperation(operationFingerprint,lease);}
    saved = await work.inspectPrintedStage(request,stage);
  }
  const result = {sourceId,versionId,original,first,operationFingerprint,packetHash:packet.hash,stageHash:knowledgeReviewHash(input.attemptKey),
    state:saved?.state ?? 'not_started'};
  if (saved?.state === 'ready') {
    try {
      const quotes = checkPrintedTranscription(JSON.parse(saved.text));
      result.verified = quotes.map((q,i)=>({page:printedCorrection.passages[i].page,quoteHash:knowledgeReviewHash(q)}));
    } catch (error) {
      result.outcome = 'held';
      result.reason = /^fhs_printed_transcription_mismatch_page_\d+$/u.test(error.message) ? error.message : 'fhs_printed_output_invalid';
      process.exitCode = 2;
    }
  }
  if (action === 'status') {
    const checkedHash = result.verified && correctedPrintedEdition(prev,versionId,sample,sampleHash,
      checkPrintedTranscription(JSON.parse(saved.text))).versionHash;
    await database.runTransaction(tx=>checkOrigin(tx,[grant.observation,sampleHash],checkedHash),{readOnly:true});
  }
  if (action === 'restore') {
    assert.ok(result.verified && saved?.state === 'ready','An independently verified stage is required');
    const ai = readAiConfig(process.env), policy = await createFirestoreAdmin(domain,ai).readPolicy();
    assert.ok(ai.backgroundKnowledgeMaintenanceEnabled && ai.backgroundKnowledgeLivePublish && policy.enabled);
    const quotes = checkPrintedTranscription(JSON.parse(saved.text));
    const candidate = correctedPrintedEdition(prev,versionId,sample,sampleHash,quotes);
    const allowed = [grant.observation,sampleHash];
    const baseline = await database.runTransaction(tx=>checkOrigin(tx,allowed,candidate.versionHash),{readOnly:true});
    if (baseline === 'withdrawn') {
      const checkId = knowledgeOperationId('fhs-verified-printed-observation/1',operationFingerprint);
      const observed = await refresh.process(job.data,checkId,async (definition,signal)=>{
        assert.equal(definition.url,prev.source.url);
        const result = await observeKnowledgeLeaflet(definition,sourceBytes,prev.source.title,prev.source.sourceDateText ?? null,
          'catalogue-pdf-original/1',signal);
        assert.ok(result.status === 'ok' && result.readMethod === 'fhs-independent-printed-excerpts/1');
        assert.equal(observationHash(parseKnowledgeObservation(result.items[0])),sampleHash);
        return result;
      },AbortSignal.timeout(80000),undefined,async tx=>{await checkOrigin(tx,allowed)});
      assert.ok(['changed','unchanged','already_recorded'].includes(observed.status));
      const guard = async tx=>{await checkOrigin(tx,[sampleHash]);};
      const edition = await knowledge.importSource(candidate.source,guard);
      assert.equal(edition.hash,candidate.versionHash);
      assert.notEqual(edition.versionId,versionId);
      assert.equal((await knowledge.review(edition.versionId,edition.hash,'fhs-independent-print-review',candidate.assessment,
        {sourceId,contentHash:sampleHash},guard)).status,'reviewed');
      assert.deepEqual(await knowledge.missingDocuments(edition.versionId),[]);
      let index;
      for (let n=0; n<Math.ceil(KNOWLEDGE_LEXICAL_BUCKETS/KNOWLEDGE_LEXICAL_BATCH); n++) {
        index = await knowledge.prepareSearch(edition.versionId,edition.hash,guard);
        if (index.complete) break;
      }
      assert.ok(index?.complete);
      await knowledge.publish(edition.versionId,edition.hash,undefined,{syncReviewedObservation:true,async prepare(tx,publishing){
        await guard(tx);
        assert.ok(publishing.previousVersionId === versionId && !publishing.sourceEnabled && publishing.observationHash === sampleHash);
        return ()=>{};
      }});
    }
    const published = await knowledge.publishedEdition(sourceId);
    assert.ok(published?.enabled && published.current && published.versionHash === candidate.versionHash && published.observationHash === sampleHash);
    result.restoration = {versionId:published.versionId,versionHash:published.versionHash,observationHash:sampleHash};
  }
  console.log(JSON.stringify(result));
} finally {await p.close();}

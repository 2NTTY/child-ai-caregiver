import { ZodError } from 'zod';
import { prepareKnowledgeMaintenance } from '../server/background-knowledge-model.ts';
import { assertScriptBaseline, assertScriptObservation, publisherScriptWork, scriptEditionWorkId, recordedScriptReviewStage, verifiedScriptReading } from '../server/fhs-script-edition.ts';
import { GROWTH_RULES } from '../server/growth-rules.ts';
import { knowledgeOperationId, knowledgeReviewHash } from '../server/knowledge-review-assessment.ts';
import { embeddingForChunk } from '../server/knowledge-inputs.ts';
import { operatorEmbeddingRequest } from '../server/firestore-embedding-usage.ts';
import { rejectedScriptEmbedding } from '../server/fhs-script-embedding-receipt.ts';
import { normalizeRecordedComparison, recordedCommunicationComparison, recordedExplanationKey } from '../server/fhs-script-comparison-stage.ts';
import { recordedBcgReview } from '../server/fhs-web-reading.ts';
import { observationHash } from '../server/knowledge-observation.ts';

/** Replay the original public review locally. Only structural diagnostics leave the operator process. */
export async function inspectFailedScriptReview({ script, chapter, request, job, definition, checkId, refresh, work, knowledge, normalize = false }) {
  const pin = chapter ? recordedBcgReview : recordedScriptReviewStage(script.sourceId);
  if (chapter && (chapter.sourceId !== pin.sourceId || normalize)) return undefined;
  const comparison = request.operationFingerprint === recordedCommunicationComparison.work && script?.sourceId === recordedCommunicationComparison.sourceId;
  if (!pin || !comparison && request.operationFingerprint !== pin.operationFingerprint) return undefined;
  let saved = chapter ? await work.inspectBcgReview(request) : comparison ? undefined : await work.inspectScriptReview(request);
  const receipt = { stageHash: comparison?recordedCommunicationComparison.stageHash:pin.stageHash,
    requestHash: comparison?null:pin.requestHash, state:saved?.state, modelCalls:0 };
  if (saved && saved.state !== 'ready') return { ...receipt, retainedText: false };
  const verified = await refresh.resumeCheck(job.data, checkId);
  const baseline = await knowledge.publishedEdition(pin.sourceId);
  if (chapter) {
    if (baseline || definition.id !== chapter.sourceId || verified?.status !== 'ok' || verified.items.length !== 1
      || verified.items[0].url !== chapter.url || observationHash(verified.items[0]) !== pin.observationHash)
      throw Error('knowledge_web_chapter_review_binding');
  } else {
    assertScriptObservation(script, definition, verified);
    assertScriptBaseline(script, baseline);
  }
  const { observation } = await refresh.inspect(pin.sourceId);
  if (observation?.contentHash !== pin.observationHash) throw Error('knowledge_script_review_stage_binding');
  const scriptRevision = script && await verifiedScriptReading(script, operationFingerprint => work.inspect({ ...request, operationFingerprint }),
    request.operationFingerprint,operationFingerprint=>work.inspectScriptReview({...request,operationFingerprint}));
  let matched = false, reviewedText, facts;
  try {
    const result = await prepareKnowledgeMaintenance({
      candidate: { watchId: pin.sourceId, observed: verified.items[0], definition, observationHash: pin.observationHash,
        previousObservationHash: baseline?.observationHash ?? null },
      baseline, fetchedAt: observation.fetchedAt, growthRules: GROWTH_RULES, explicitAgeScope: !chapter, scriptRevision, webOriginal:chapter,
      replayCommunication: comparison && normalize,
      completeText: async ({system, user, attemptKey, role}) => {
        if (matched || role !== 'knowledge_review' || attemptKey !== 'knowledge-review:' + knowledgeReviewHash({system, user}))
          throw Error('knowledge_script_review_stage_binding');
        // The deployed prompt modules used LF. A Windows checkout may contain CRLF.
        const recordedSystem = system.replace(/\r\n/gu, '\n');
        const recordedKey='knowledge-review:'+knowledgeReviewHash({system:recordedSystem,user});
        const bound={system:recordedSystem,user,attemptKey:recordedKey};
        if (knowledgeReviewHash(recordedKey) !== receipt.stageHash || !comparison && knowledgeReviewHash(bound) !== pin.requestHash)
          throw Error('knowledge_script_review_stage_binding');
        if (comparison) {
          saved=await work.inspectCommunicationComparison(request,bound);
          receipt.requestHash=knowledgeReviewHash(bound);receipt.state=saved.state;
        }
        matched = true;
        if (saved.state !== 'ready') throw Error('knowledge_script_stage_text_unavailable');
        facts = JSON.parse(user).sourceComparison?.facts;
        reviewedText = comparison && normalize ? normalizeRecordedComparison(saved.text,user) : saved.text;
        if (chapter) {
          receipt.responseHash = knowledgeReviewHash(reviewedText);
          receipt.responseCharacters = reviewedText.length;
        }
        return reviewedText;
      },
    });
    if (!matched) throw Error('knowledge_script_review_stage_binding');
    let preservedExplanation;
    if (comparison && normalize) {
      const full = JSON.parse(saved.text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/u,'$1')).changes[recordedExplanationKey].explanation;
      if (full !== result.assessment.changes.find(change => change.key === recordedExplanationKey)?.explanation)
        throw Error('knowledge_script_explanation_changed');
      preservedExplanation = {key:recordedExplanationKey,characters:full.length,hash:knowledgeReviewHash(full)};
    }
    return { ...receipt, retainedText: true, validation: 'valid', decision: result.review.decision, versionHash: result.versionHash,
      ...(chapter ? { reviewNotes:result.review.notes } : {}), preservedExplanation };
  } catch (error) {
    if (!matched) throw error;
    if (saved?.state !== 'ready') return {...receipt,retainedText:false};
    if (error instanceof ZodError) {
      const parsed=JSON.parse(reviewedText.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/u,'$1'));
      const labels=['new','removed','changed','unchanged','approve','hold'];
      const issues=error.issues.map(issue=>{
        const value=issue.path.reduce((row,k)=>row?.[k],parsed);
        const fact=issue.path[0]==='changes' ? facts?.[issue.path[1]] : undefined;
        const classification=typeof value==='object' && value ? value.meaning : value;
        return {path:issue.path.join('.'),code:issue.code,
          ...(Array.isArray(issue.keys)?{extraFields:issue.keys.filter(k=>/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/u.test(k))}:{}),
          ...(labels.includes(classification)?{received:classification}:{}),
          ...(Array.isArray(issue.values)?{expected:issue.values.filter(v=>labels.includes(v))}:{}),
          ...(fact===null || labels.includes(fact)?{structuralFact:fact}:{}),
          ...(typeof issue.maximum==='number'?{maximum:issue.maximum}:{}),...(typeof issue.minimum==='number'?{minimum:issue.minimum}:{}),
          ...(issue.code==='too_big' && typeof value==='string'?{characters:value.length}: {})};
      });
      return {...receipt,retainedText:true,validation:'invalid',issues,
        ...(chapter && ['approve','hold'].includes(parsed?.decision) ? {unvalidatedDecision:parsed.decision} : {})};
    }
    if (/^knowledge_[a-z_]{1,100}$/u.test(error?.message))
      return { ...receipt, retainedText: true, validation: 'invalid', reason: error.message };
    throw error;
  }
}

/** Match the original campaign reservation to its independently recorded daily embedding result. */
export async function inspectReservedScriptEmbedding({script, work, reservations, usage, policy}) {
  if (script.sourceId !== 'fhs-20000' || !reservations.length) return undefined;
  const pin = rejectedScriptEmbedding;
  const ticket = reservations.find(r => r.kind === 'embedding' && r.stageHash === pin.stageHash && r.operationFingerprint === scriptEditionWorkId(script));
  if (ticket?.at !== pin.at || ticket.ceiling !== pin.ceiling) throw Error('knowledge_script_embedding_receipt_binding');
  return readOriginalScriptEmbedding({script,work,policy,read:request=>usage.read(request)});
}
export async function readOriginalScriptEmbedding({script,work,policy,read}) {
  const {stageHash,versionHash,chunkKey,at} = rejectedScriptEmbedding;
  if (script.sourceId !== rejectedScriptEmbedding.sourceId || script.observationHash !== rejectedScriptEmbedding.observationHash
    || work?.request.operationFingerprint !== publisherScriptWork(script) || work.prepared?.versionHash !== versionHash
    || work.prepared.review.decision !== 'approve_candidate' || work.receipt) throw Error('knowledge_script_embedding_receipt_binding');
  const source = work.prepared.source;
  const chunk = source.chunks.find(c => c.key === chunkKey);
  const document = chunk && embeddingForChunk(source.title,chunk);
  if (!document || knowledgeReviewHash(document.hash) !== stageHash) throw Error('knowledge_script_embedding_receipt_binding');
  const operationId = knowledgeOperationId('knowledge-embedding/1', knowledgeReviewHash([work.request.operationFingerprint,document.hash]));
  const actor = {kind:'corpus_maintenance',actorId:'operator:knowledge-maintenance',operationId};
  const request = operatorEmbeddingRequest(actor,1,work.deadlineAtMs,Math.min(policy.dailyUserAttempts,policy.dailyGlobalAttempts),policy.dailyGlobalAttempts,script);
  const result = await read(request);
  return { stageHash, documentHash:document.hash, operationId, versionHash, ticketAt:at,
    reservedAtMs:result?.reservedAtMs ?? null, record:result?.record ?? null };
}

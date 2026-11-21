import { ZodError } from 'zod';
import { prepareKnowledgeMaintenance } from '../server/background-knowledge-model.ts';
import { assertScriptBaseline, assertScriptObservation, publisherScriptWork, scriptEditionWorkId, recordedScriptReviewStage, verifiedScriptReading } from '../server/fhs-script-edition.ts';
import { GROWTH_RULES } from '../server/growth-rules.ts';
import { knowledgeOperationId, knowledgeReviewHash } from '../server/knowledge-review-assessment.ts';
import { embeddingForChunk } from '../server/knowledge-inputs.ts';
import { operatorEmbeddingRequest } from '../server/firestore-embedding-usage.ts';
import { rejectedScriptEmbedding } from '../server/fhs-script-embedding-receipt.ts';

/** Replay the original public review locally. Only structural diagnostics leave the operator process. */
export async function inspectFailedScriptReview({ script, request, job, definition, checkId, refresh, work, knowledge }) {
  const pin = recordedScriptReviewStage(script.sourceId);
  if (!pin || request.operationFingerprint !== pin.operationFingerprint) return undefined;
  const saved = await work.inspectScriptReview(request);
  const receipt = { stageHash: pin.stageHash, requestHash: pin.requestHash, state: saved.state, modelCalls: 0 };
  if (saved.state !== 'ready') return { ...receipt, retainedText: false };
  const verified = await refresh.resumeCheck(job.data, checkId);
  assertScriptObservation(script, definition, verified);
  const baseline = await knowledge.publishedEdition(script.sourceId);
  assertScriptBaseline(script, baseline);
  const { observation } = await refresh.inspect(script.sourceId);
  if (observation?.contentHash !== pin.observationHash) throw Error('knowledge_script_review_stage_binding');
  const scriptRevision = await verifiedScriptReading(script, operationFingerprint => work.inspect({ ...request, operationFingerprint }),pin.operationFingerprint);
  let matched = false;
  try {
    const result = await prepareKnowledgeMaintenance({
      candidate: { watchId: script.sourceId, observed: verified.items[0], definition, observationHash: pin.observationHash,
        previousObservationHash: baseline?.observationHash ?? null },
      baseline, fetchedAt: observation.fetchedAt, growthRules: GROWTH_RULES, explicitAgeScope: true, scriptRevision,
      completeText: async ({system, user, attemptKey, role}) => {
        if (matched || role !== 'knowledge_review' || attemptKey !== 'knowledge-review:' + knowledgeReviewHash({system, user}))
          throw Error('knowledge_script_review_stage_binding');
        // The deployed prompt modules used LF. A Windows checkout may contain CRLF.
        const recordedSystem = system.replace(/\r\n/gu, '\n');
        if ('knowledge-review:' + knowledgeReviewHash({system:recordedSystem,user}) !== pin.attemptKey
          || knowledgeReviewHash({system:recordedSystem,user,attemptKey:pin.attemptKey}) !== pin.requestHash)
          throw Error('knowledge_script_review_stage_binding');
        matched = true;
        return saved.text;
      },
    });
    if (!matched) throw Error('knowledge_script_review_stage_binding');
    return { ...receipt, retainedText: true, validation: 'valid', decision: result.review.decision, versionHash: result.versionHash };
  } catch (error) {
    if (!matched) throw error;
    if (error instanceof ZodError) return { ...receipt, retainedText: true, validation: 'invalid', issues: error.issues.map(issue => ({
      path: issue.path.join('.'), code: issue.code, ...(typeof issue.maximum === 'number' ? { maximum: issue.maximum } : {}),
      ...(typeof issue.minimum === 'number' ? { minimum: issue.minimum } : {}),
    })) };
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

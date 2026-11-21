import { ZodError } from 'zod';
import { prepareKnowledgeMaintenance } from '../server/background-knowledge-model.ts';
import { assertScriptBaseline, assertScriptObservation, recordedScriptReviewStage, verifiedScriptReading } from '../server/fhs-script-edition.ts';
import { GROWTH_RULES } from '../server/growth-rules.ts';
import { knowledgeReviewHash } from '../server/knowledge-review-assessment.ts';

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
  const scriptRevision = await verifiedScriptReading(script, operationFingerprint => work.inspect({ ...request, operationFingerprint }));
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

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { BackgroundKnowledgeRunRequest, BackgroundKnowledgeRunResult } from '../src/shared/background-knowledge-maintenance.ts';
import { manualPublicationPin, type ManualPublicationPin } from './fhs-manual-publication.ts';
import { knowledgeReviewHash } from './knowledge-review-assessment.ts';

const commitments = z.record(z.string(),z.string().regex(/^[a-f0-9]{64}$/u)).parse(JSON.parse(
  readFileSync(new URL('../knowledge/fhs-undispatched-originals.json',import.meta.url),'utf8')));

type OriginalWork = {request:BackgroundKnowledgeRunRequest; result:BackgroundKnowledgeRunResult|null; budget:{modelCalls:number};
  lease:unknown; receipt:unknown; preparedHash:string|null; waitingForQuotaDay?:string; firstDispatchFrom?:string};

export type FirstDispatch = {original:string; observation:string};
export const firstDispatchWorkId = (original:string) => knowledgeReviewHash(['fhs-first-dispatch/1',original]);
export const hasUndispatchedOriginal = (sourceId:string) => Object.hasOwn(commitments,sourceId);

export function isUndispatchedParent(work:OriginalWork|null, request:BackgroundKnowledgeRunRequest, observation:string) {
  return Boolean(work && !work.lease && !work.receipt && !work.preparedHash && !work.firstDispatchFrom && !work.waitingForQuotaDay
    && work.budget.modelCalls===1 && work.result?.status==='candidate_held' && work.result.code==='unavailable'
    && !work.result.published && work.result.watchId===request.watchId && work.result.observationHash===observation
    && request.publishMode==='live' && knowledgeReviewHash(work.request)===knowledgeReviewHash(request));
}

/** Public commitments bind only the commissioned originals whose private admission history was verified. */
export function bindFirstDispatch(pin:ManualPublicationPin|undefined, original:string, work:OriginalWork|null): FirstDispatch|undefined {
  const observation=work?.result?.observationHash;
  if (!pin || pin.resumeOnly || manualPublicationPin(pin.sourceId)!==pin || !work || !observation
    || work.request.watchId!==pin.sourceId || work.request.operationFingerprint!==original
    || !isUndispatchedParent(work,work.request,observation)) return;
  if (commitments[pin.sourceId]===knowledgeReviewHash(['fhs-verified-no-dispatch/1',pin.lane,pin.sourceId,pin.sha256,pin.pages,original,observation]))
    return {original,observation};
}

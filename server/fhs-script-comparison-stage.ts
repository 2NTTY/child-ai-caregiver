import { knowledgeReviewHash } from './knowledge-review-assessment.ts';
// The provider has already settled this public comparison. Reconstruct its request before reading its sealed response.
export const recordedCommunicationComparison = Object.freeze({
  sourceId:'fhs-12196', observationHash:'90318c3a2becb2cab6bc36ebb3ce6c76ec7044bba219f23ad436eac3618b9772',
  work:'b3a35ffdb2c443f3b2713542054382d0015f95656e833220ee44efc8809665bc',
  stageHash:'26ca4883045046fc7b725c419c63c5ae68841e3cfe4ed94906854fdce402df22',
});
export const communicationReplayWork = knowledgeReviewHash(['fhs-recorded-comparison/1', recordedCommunicationComparison]);

/** Drop a repeated structural label only when it exactly equals the independently recomputed fact. */
export function normalizeRecordedComparison(text: string, user: string) {
  const raw = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/u, '$1');
  const result = JSON.parse(raw);
  const facts = JSON.parse(user).sourceComparison?.facts;
  if (!facts || !result?.changes || typeof result.changes !== 'object') return text;
  let changed = false;
  for (const [key, fact] of Object.entries(facts)) {
    const entry = result.changes[key];
    if (['new', 'removed', 'unchanged'].includes(String(fact)) && entry?.meaning === fact) {
      delete entry.meaning;
      changed = true;
    }
  }
  return changed ? JSON.stringify(result) : text;
}

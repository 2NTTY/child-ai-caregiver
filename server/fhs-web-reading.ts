import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { chapterReadingSchema } from './knowledge-web-chapter.ts';
import { knowledgeReviewHash } from './knowledge-review-assessment.ts';

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const registration = z.object({
  sourceId: z.string(), url: z.url(), operationFingerprint: digest, observationHash: digest,
  code: z.enum(['knowledge_review_failed','knowledge_age_one_sided']), reason: z.string().min(1),
  chapterReading: z.strictObject({ audiences: z.array(z.string().min(1).max(80)).min(1),
    priorReview: digest.nullable(), chapter: chapterReadingSchema }),
});
export type CommissionedWebChapter = Readonly<z.infer<typeof registration>>;
const manifest = JSON.parse(readFileSync(new URL('../knowledge/fhs-initial-recovery.json', import.meta.url),'utf8'));
const registered = new Map<string, CommissionedWebChapter>();
for (const row of manifest.entries) {
  if (!row.chapterReading) continue;
  const pin = Object.freeze(registration.parse(row));
  if (manifest.campaign !== 'fhs-child-initial-20261120' || registered.has(pin.sourceId))
    throw Error('knowledge_web_chapter_manifest');
  registered.set(pin.sourceId, pin);
}
export const commissionedWebChapter = (id: string) => registered.get(id);
export const webChapterWorkId = (pin: CommissionedWebChapter) =>
  knowledgeReviewHash(['fhs-publisher-web-chapter/1', pin.operationFingerprint, pin.observationHash]);

// The settled independent review of the BCG article, as identified in the family catalogue receipt.
export const recordedBcgReview = Object.freeze({
  sourceId: 'fhs-481', code: 'knowledge_review_failed',
  observationHash: '2ebebce84a6c9fad0a5b27345aaffa8ba4dd256e6783f6e5748b6c131fe6e5ff',
  operationFingerprint: '7acf97ab245e93bb44cc7784b2afb403d312abb4405a6d8072244bb1c669e943',
  attemptKey: 'knowledge-review:18c024f9287f8ca554fd4ec4a4f54577a792f1fd3c167627ad7ace3c4f71d51f',
  stageHash: '7bffe8bb2503a351f6811b37487da8f6dc5cc61c4a7888eaf52419753f59bed5',
  requestHash: '8ca0ab0f9f1bbae0e00f629b5486e1d286e1f9cc588192744b9fa09d419dd387',
});

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

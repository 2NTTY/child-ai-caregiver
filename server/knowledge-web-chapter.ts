import { createHash } from 'node:crypto';
import { z } from 'zod';
import { knowledgeReviewHash } from './knowledge-review-assessment.ts';
import type { KnowledgeChunkInput } from '../src/shared/knowledge.ts';

export const chapterReadingSchema = z.strictObject({
  textSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  headings: z.array(z.string().min(1)).min(1).max(32),
  finalSentence: z.string().min(1),
});
export type ChapterReading = z.infer<typeof chapterReadingSchema>;

/** Preserve the publisher's intervening spaces so concatenation recovers the exact observation. */
export function chapterOriginalUnits(text: string, chapter: ChapterReading) {
  if (createHash('sha256').update(text).digest('hex') !== chapter.textSha256 || !text.endsWith(chapter.finalSentence))
    throw Error('knowledge_web_chapter_original_changed');
  const starts = chapter.headings.map(heading => text.indexOf(heading));
  if (starts[0] !== 0 || starts.some((at, i) => at < 0 || (i > 0 && at <= starts[i - 1]!)))
    throw Error('knowledge_web_chapter_headings_changed');
  return starts.map((start, i) => {
    const originalText = text.slice(start, starts[i + 1]);
    return { id: 'p0-' + knowledgeReviewHash(['publisher-chapter/1', originalText]).slice(0, 20),
      heading: chapter.headings[i]!, originalText, page: null, pageEnd: null };
  });
}

export function checkChapterReading(text: string, chapter: ChapterReading,
  chunks: readonly KnowledgeChunkInput[], audiences: readonly string[]) {
  const units = chapterOriginalUnits(text, chapter);
  if (units.length !== chunks.length || units.some((unit, i) => {
    const chunk = chunks[i]!;
    return chunk.key !== unit.id || chunk.section !== unit.heading || chunk.originalText !== unit.originalText
      || chunk.text !== unit.originalText || chunk.sourceExcerpt !== [...unit.originalText.trim()].slice(0, 150).join('')
      || chunk.scriptPassage || chunk.applicability.use !== 'original_lookup' || chunk.applicability.ageBasis !== 'publisher'
      || chunk.applicability.minAgeMonths !== null || chunk.applicability.maxAgeMonths !== null
      || JSON.stringify(chunk.applicability.publisherAudiences) !== JSON.stringify(audiences);
  })) throw Error('knowledge_web_chapter_readback_mismatch');
}

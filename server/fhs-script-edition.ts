import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { observationHash, observedPassageText } from './knowledge-observation.ts';
import type { ObservedContent, SourceFetchResult, SourceWatchDefinition } from './knowledge-refresh-types.ts';
import type { KnowledgeChunkInput } from '../src/shared/knowledge.ts';
import { embeddingForChunk } from './knowledge-inputs.ts';
import { knowledgeReviewHash } from './knowledge-review-assessment.ts';

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const schema = z.strictObject({sourceId: z.string().regex(/^fhs-\d+$/u), observationHash: digest,
  baselineId: z.uuid().nullable(), baselineHash: digest.nullable(), chunkCount: z.int().min(1).max(19)
}).refine(pin => (pin.baselineId === null) === (pin.baselineHash === null));
export type ScriptEdition = Readonly<z.infer<typeof schema>>;
const pins = z.array(schema).length(22).parse(JSON.parse(readFileSync(new URL('../knowledge/fhs-script-editions.json', import.meta.url), 'utf8')));
const approved = new Map(pins.map(pin => [pin.sourceId, Object.freeze(pin)]));
if (approved.size !== pins.length) throw Error('knowledge_script_edition_duplicate');

export function approvedScriptEdition(sourceId: string) {
  return approved.get(sourceId);
}

// The same edition has one paid work identity even after a restart or watch re-registration.
export function scriptEditionWorkId(pin: ScriptEdition) {
  return knowledgeReviewHash(['fhs-official-script-edition/1', pin.sourceId, pin.observationHash]);
}

export function assertScriptObservation(pin: ScriptEdition, definition: SourceWatchDefinition, fetched: SourceFetchResult | null) {
  if (approved.get(definition.id) !== pin || definition.kind !== 'page' || definition.audience !== 'public_noncommercial'
    || fetched?.status !== 'ok' || fetched.items.length !== 1 || !fetched.items[0]?.scripts?.length
    || fetched.items[0].url !== definition.url || observationHash(fetched.items[0]) !== pin.observationHash)
    throw Error('knowledge_script_edition_observation_changed');
}

export function assertScriptBaseline(pin: ScriptEdition, edition: { enabled: boolean; versionId: string; versionHash: string } | null) {
  if (edition && !edition.enabled || (edition?.versionId ?? null) !== pin.baselineId || (edition?.versionHash ?? null) !== pin.baselineHash)
    throw Error('knowledge_script_edition_baseline_changed');
}

export function scriptEditionCoverage(observed: ObservedContent,
  source: { title: string; chunks: readonly Pick<KnowledgeChunkInput, 'key' | 'scriptPassage' | 'originalText' | 'sourceExcerpt' | 'text' | 'section'>[] },
  embeddings: readonly { chunkKey: string; inputHash: string }[] = []) {
  const vectors = new Map(embeddings.map(row => [row.chunkKey, row.inputHash]));
  return (observed.scripts ?? []).map(script => {
    let next = 1;
    const chunks = source.chunks.filter(chunk => chunk.scriptPassage?.url === script.page.transcriptUrl)
      .sort((a, b) => a.scriptPassage!.firstParagraph - b.scriptPassage!.firstParagraph);
    const ranges = chunks.map(chunk => {
      const passage = chunk.scriptPassage!;
      const original = observedPassageText(observed, passage);
      if (!original || chunk.originalText !== original || passage.firstParagraph !== next || passage.lastParagraph < next
        || knowledgeReviewHash(original) !== passage.originalHash) throw Error('knowledge_script_edition_original_incomplete');
      next = passage.lastParagraph + 1;
      const input = embeddingForChunk(source.title, chunk);
      const vector = vectors.get(chunk.key);
      if (vector && vector !== input.hash) throw Error('knowledge_script_edition_vector_changed');
      return { first: passage.firstParagraph, last: passage.lastParagraph, originalHash: passage.originalHash,
        chunkKey: chunk.key, vectorizedFullText: Boolean(vector), excerptCharacters: [...(chunk.sourceExcerpt ?? '')].length };
    });
    if (next !== script.paragraphs.length + 1) throw Error('knowledge_script_edition_original_incomplete');
    return { url: script.page.transcriptUrl, paragraphs: script.paragraphs.length, ranges };
  });
}

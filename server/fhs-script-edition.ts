import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { observationHash, observedPassageText } from './knowledge-observation.ts';
import type { ObservedContent, SourceFetchResult, SourceWatchDefinition } from './knowledge-refresh-types.ts';
import type { KnowledgeChunkInput } from '../src/shared/knowledge.ts';
import { embeddingForChunk } from './knowledge-inputs.ts';
import { knowledgeReviewHash } from './knowledge-review-assessment.ts';
import { ageExampleRegistration } from './knowledge-age-examples.ts';
import { rejectedScriptEmbedding } from './fhs-script-embedding-receipt.ts';

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

const heldSchema = z.strictObject({ sourceId:schema.shape.sourceId, observationHash:digest, operationFingerprint:digest,
  reason:z.enum(['knowledge_age_uncertain','knowledge_age_one_sided','model_output_limit','review_hold']), candidateVersionHash:digest.nullable() });
const revisions = new Map(z.array(heldSchema).parse(JSON.parse(readFileSync(new URL('../knowledge/fhs-held-script-editions.json', import.meta.url),'utf8')))
  .map(pin => [pin.sourceId,Object.freeze(pin)]));
export function heldScriptRevision(pin: ScriptEdition) {
  const row = revisions.get(pin.sourceId);
  if (!row || approvedScriptEdition(pin.sourceId) !== pin || row.observationHash !== pin.observationHash
    || row.operationFingerprint !== scriptEditionWorkId(pin)) throw Error('knowledge_script_revision_not_commissioned');
  return row;
}
export function scriptRevisionWorkId(pin: ScriptEdition) {
  return knowledgeReviewHash(['fhs-official-script-reading/1',heldScriptRevision(pin)]);
}
const publisherScope = z.strictObject({sourceId:schema.shape.sourceId,
  previousCode:z.enum(['input_limit','knowledge_review_failed','review_hold']).nullable(),previousVersionHash:digest.nullable(),
  audiences:z.array(z.strictObject({title:z.string().min(1).optional(),audience:z.string().min(1).max(240)})),
  amendUnits:z.array(z.string().regex(/^p0-[a-f0-9]{20}$/u)).optional()});
const publisherScopes = new Map(z.array(publisherScope).parse(JSON.parse(readFileSync(new URL('../knowledge/fhs-publisher-script-editions.json',import.meta.url),'utf8')))
  .map(row=>[row.sourceId,row]));
export function publisherScriptWork(pin:ScriptEdition) {
  const previous=scriptRevisionWorkId(pin), scope=publisherScopes.get(pin.sourceId);
  return scope ? knowledgeReviewHash(['fhs-publisher-script-reading/1',previous,scope]) : previous;
}
const lookupReview = z.strictObject({sourceId:schema.shape.sourceId,priorVersionHash:digest,amendUnits:publisherScope.shape.amendUnits,
  upperBound:z.strictObject({audience:z.string().min(1),beforeMonths:z.int().positive().max(120)}).optional()});
const lookupReviews=new Map(z.array(lookupReview).parse(JSON.parse(readFileSync(new URL('../knowledge/fhs-script-lookup-reviews.json',import.meta.url),'utf8')))
  .map(row=>[row.sourceId,row]));
export function lookupScriptWork(pin:ScriptEdition) {
  const publisher=publisherScriptWork(pin), lookup=lookupReviews.get(pin.sourceId);
  return lookup?knowledgeReviewHash(['fhs-script-reading-access/1',publisher,lookup]):publisher;
}
const exampleEdition = z.strictObject({sourceId:schema.shape.sourceId,observationHash:digest,priorWork:digest,
  priorVersionHash:digest,examples:z.array(ageExampleRegistration).min(1)});
const exampleEditions = z.array(exampleEdition).parse(JSON.parse(readFileSync(
  new URL('../knowledge/fhs-script-age-examples.json',import.meta.url),'utf8')));
export function currentScriptReadingWork(pin:ScriptEdition) {
  const previous = lookupScriptWork(pin), edition = exampleEditions.find(row => row.sourceId === pin.sourceId);
  const repair = stageRepairs.find(row => row.sourceId === pin.sourceId);
  if (repair) {
    const stage = recordedScriptReviewStage(pin.sourceId);
    if (!stage || repair.priorWork !== previous || stage.operationFingerprint !== previous) throw Error('knowledge_script_review_stage_binding');
    return knowledgeReviewHash(['fhs-script-comparison-repair/1', stage, repair]);
  }
  if (pin.sourceId === rejectedScriptEmbedding.sourceId) {
    if (previous !== rejectedScriptEmbedding.priorWork || pin.observationHash !== rejectedScriptEmbedding.observationHash)
      throw Error('knowledge_script_embedding_receipt_binding');
    return knowledgeReviewHash(['fhs-script-index-repair/1', rejectedScriptEmbedding]);
  }
  if (!edition) return previous;
  if (edition.priorWork !== previous || edition.observationHash !== pin.observationHash) throw Error('knowledge_script_age_example_binding');
  return knowledgeReviewHash(['fhs-script-reading-examples/1',edition]);
}
const failedReviewStage = z.strictObject({
  sourceId: schema.shape.sourceId, observationHash: digest, operationFingerprint: digest,
  attemptKey: z.string().regex(/^knowledge-review:[0-9a-f]{64}$/u), requestHash: digest, stageHash: digest,
  code: z.enum(['invalid_response', 'knowledge_review_failed']),
});
const stageReceipts = z.array(failedReviewStage).parse(JSON.parse(readFileSync(
  new URL('../knowledge/fhs-script-review-stages.json', import.meta.url), 'utf8')));
const repairSchema = z.strictObject({ sourceId:schema.shape.sourceId,priorWork:digest,stage:z.enum(['ready','unknown']),
  amendUnits:publisherScope.shape.amendUnits,examples:z.array(ageExampleRegistration).min(1).optional() });
const stageRepairs = z.array(repairSchema).parse(JSON.parse(readFileSync(
  new URL('../knowledge/fhs-script-review-repairs.json',import.meta.url),'utf8')));
export function recordedScriptReviewStage(sourceId: string) {
  const row = stageReceipts.find(entry => entry.sourceId === sourceId);
  if (!row) return null;
  const pin = approvedScriptEdition(sourceId);
  if (!pin || pin.observationHash !== row.observationHash || lookupScriptWork(pin) !== row.operationFingerprint
    || knowledgeReviewHash(row.attemptKey) !== row.stageHash) throw Error('knowledge_script_review_stage_binding');
  return row;
}
type RecordedHold = Parameters<typeof verifyHeldScript>[1];
type StageReading = {state:string;text:string|null};
export async function verifiedScriptReading(pin:ScriptEdition,inspect:(fingerprint:string)=>Promise<RecordedHold>,
  workId=currentScriptReadingWork(pin),readStage?:(fingerprint:string)=>Promise<StageReading>) {
  const original=verifyHeldScript(pin,await inspect(scriptEditionWorkId(pin))),scope=publisherScopes.get(pin.sourceId);
  if(!scope)return original;
  const previous=await inspect(scriptRevisionWorkId(pin));
  if(scope.previousCode===null ? previous!==null : !previous || previous.receipt || previous.lease ||
    previous.result?.status!=='candidate_held' || previous.result.code!==scope.previousCode ||
    previous.result.observationHash!==pin.observationHash || (previous.prepared?.versionHash??null)!==scope.previousVersionHash ||
    (scope.previousCode==='review_hold' ? previous.prepared?.review.decision!=='hold_candidate' : Boolean(previous.prepared)))
    throw Error('knowledge_script_publisher_predecessor_changed');
  const lookup=lookupReviews.get(pin.sourceId);
  const publisher=lookup?await inspect(publisherScriptWork(pin)):null;
  if(lookup && (!publisher || publisher.receipt || publisher.lease || publisher.result?.status!=='candidate_held'
    || publisher.result.code!=='review_hold' || publisher.result.observationHash!==pin.observationHash
    || publisher.prepared?.versionHash!==lookup.priorVersionHash || publisher.prepared.review.decision!=='hold_candidate'))
    throw Error('knowledge_script_lookup_predecessor_changed');
  const repaired = workId !== lookupScriptWork(pin);
  if (repaired && currentScriptReadingWork(pin) !== workId) throw Error('knowledge_script_age_example_binding');
  const edition = repaired ? exampleEditions.find(row => row.sourceId === pin.sourceId) : undefined;
  const repair = repaired ? stageRepairs.find(row => row.sourceId === pin.sourceId) : undefined;
  const embedding = repaired && pin.sourceId === rejectedScriptEmbedding.sourceId ? rejectedScriptEmbedding : undefined;
  const prior = edition ? await inspect(edition.priorWork) : null;
  if (edition && (!prior || prior.lease || prior.receipt || prior.result?.status !== 'candidate_held' || prior.result.code !== 'review_hold'
    || prior.result.observationHash !== pin.observationHash || prior.prepared?.versionHash !== edition.priorVersionHash
    || prior.prepared.review.decision !== 'hold_candidate')) throw Error('knowledge_script_age_example_predecessor_changed');
  const notes = [...original.notes,...(previous?.prepared?.review.notes??[]),...(publisher?.prepared?.review.notes??[]),...(prior?.prepared?.review.notes??[])];
  if (repair) {
    const stage = await readStage?.(repair.priorWork);
    if (stage?.state !== repair.stage || (stage.state === 'ready') !== Boolean(stage.text)) throw Error('knowledge_script_review_stage_binding');
    if (stage.text) {
      const raw = stage.text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/u,'$1');
      const report = JSON.parse(raw);
      // A structurally invalid assessment is background evidence for a new independent reader.
      notes.push(JSON.stringify({priorAssessment:'unvalidated',decision:report.decision,reason:report.decisionReason,
        checks:report.checks,disputedComparison:report.changes?.[repair.amendUnits![0]!]}));
    }
  }
  if (embedding) {
    const approved = await inspect(embedding.priorWork);
    if (!approved || approved.receipt || approved.result || approved.prepared?.versionHash !== embedding.versionHash
      || approved.prepared.review.decision !== 'approve_candidate') throw Error('knowledge_script_embedding_receipt_binding');
    notes.push('The previous independent review approved the original publication. Check the new non-film retrieval text, the complete unchanged original and all film passages.');
  }
  const examples = edition?.examples ?? repair?.examples;
  return {...original,notes,
    ...(previous?{previousReading:{work:scriptRevisionWorkId(pin),reason:scope.previousCode,version:scope.previousVersionHash}}:{}),
    ...(lookup?{priorPublisherReview:{work:publisherScriptWork(pin),versionHash:lookup.priorVersionHash}}:{}),
    publisherScope:{audiences:scope.audiences.map(label=>lookup?.upperBound?.audience===label.audience?{...label,beforeMonths:lookup.upperBound.beforeMonths}:label),
      amendUnits:[...(scope.amendUnits??[]),...(lookup?.amendUnits??[]),...(repair?.amendUnits??[]),...(embedding?[embedding.chunkKey]:[])],
      ...(lookup||embedding?{exclusiveLookup:true as const}:{}),...(examples?{ageExamples:examples}:{}),
      ...(repair?{sourceComparison:true as const}:{})}};
}
export function verifyHeldScript(pin: ScriptEdition, original: {
  receipt:unknown; lease:unknown; result?:{status:string;code?:string|null;observationHash?:string|null}|null;
  prepared?:{versionHash:string;review:{decision:string;notes:readonly string[]}}|null;
} | null) {
  const row = heldScriptRevision(pin);
  if (!original || original.receipt || original.lease || original.result?.status !== 'candidate_held'
    || original.result.code !== row.reason || original.result.observationHash !== pin.observationHash
    || (original.prepared?.versionHash ?? null) !== row.candidateVersionHash
    || (row.reason === 'review_hold' ? original.prepared?.review.decision !== 'hold_candidate' : Boolean(original.prepared)))
    throw Error('knowledge_script_revision_original_changed');
  return { priorWork:row.operationFingerprint,reason:row.reason,notes:original.prepared?.review.notes ?? [] };
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

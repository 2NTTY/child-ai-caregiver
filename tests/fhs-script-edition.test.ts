import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { approvedScriptEdition, assertScriptBaseline, assertScriptObservation, scriptEditionCoverage, scriptEditionWorkId } from '../server/fhs-script-edition.ts';
import { embeddingForChunk } from '../server/knowledge-inputs.ts';
import { platformSourceWatches } from '../server/knowledge-source-catalog.ts';
import { knowledgeReviewHash } from '../server/knowledge-review-assessment.ts';
import type { ObservedContent } from '../server/knowledge-refresh-types.ts';

test('only the 22 observed public webpages have a commissioned script work identity', () => {
  const evidence = JSON.parse(readFileSync(new URL('../artifacts/verification/FHS_SCRIPT_COVERAGE_20261121.json', import.meta.url), 'utf8'));
  const eligible = platformSourceWatches.filter(w => approvedScriptEdition(w.id));
  assert.equal(eligible.length, 22);
  const work = new Set<string>();
  for (const definition of eligible) {
    const pin = approvedScriptEdition(definition.id)!;
    const row = evidence.materials[definition.id];
    assert.equal(definition.kind, 'page');
    assert.equal(definition.url, row.url);
    assert.deepEqual(pin, {sourceId: definition.id, observationHash: row.currentObservationHash,
      baselineId: row.activeWebVersion, baselineHash: row.activeWebVersionHash, chunkCount: row.allInputChunks});
    assert.ok(Object.isFrozen(pin));
    assert.throws(() => assertScriptObservation(pin, definition, {status:'ok', items:[]}), /observation_changed/u);
    assert.throws(() => assertScriptBaseline(pin, {versionId:'changed',versionHash:pin.observationHash,enabled:true}), /baseline_changed/u);
    if (pin.baselineId) assert.throws(() => assertScriptBaseline(pin, null), /baseline_changed/u);
    else assert.doesNotThrow(() => assertScriptBaseline(pin, null));
    work.add(scriptEditionWorkId(pin));
  }
  assert.equal(work.size, 22);
  assert.equal(approvedScriptEdition('pdf-780e4c1676a794ee6e89c6db'), undefined);
});

test('readback distinguishes archived paragraphs from vectors and rejects excerpts substituted for originals', () => {
  const url = 'https://www.fhs.gov.hk/tc_chi/mulit_med/000002.html', title = 'Example';
  const observed: ObservedContent = {url,title,text:'Parent',sourceDateText:null,sourcePublishedAt:null, sourceUpdatedAt:null,
    scripts:[{page:{url,title,transcriptUrl:url+'#transcript'},paragraphs:['First paragraph.','Second paragraph.']}]};
  const chunks = observed.scripts![0]!.paragraphs.map((originalText, index) => ({
    key:'p'+index, section:title,text:'Summary',originalText,sourceExcerpt:originalText.slice(0,5),scriptPassage:{
      url:url+'#transcript',title,firstParagraph:index+1,lastParagraph:index+1,originalHash:knowledgeReviewHash(originalText)},
  }));
  const source = {title,chunks};
  const first = source.chunks[0]!;
  const vector = {chunkKey:first.key,inputHash:embeddingForChunk(title,first).hash};
  assert.deepEqual(scriptEditionCoverage(observed,source,[vector])[0]!.ranges.map(r => r.vectorizedFullText),[true,false]);
  assert.throws(() => scriptEditionCoverage(observed,source,[{...vector,inputHash:'changed'}]),/vector_changed/u);
  assert.throws(() => scriptEditionCoverage(observed,{...source,chunks:[first]}),/original_incomplete/u);
  assert.throws(() => scriptEditionCoverage(observed,{...source,chunks:[{...first,originalText:'First'},source.chunks[1]!]}),/original_incomplete/u);
});

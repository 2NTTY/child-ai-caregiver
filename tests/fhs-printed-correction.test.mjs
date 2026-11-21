import assert from 'node:assert/strict';
import test from 'node:test';
import { verifiedOralExcerpts, oralPrint } from '../server/fhs-verified-oral-excerpts.ts';
import { platformSourceWatches } from '../server/knowledge-source-catalog.ts';
import { observeKnowledgeLeaflet } from '../server/knowledge-source-fetch.ts';
import { knowledgeReviewHash } from '../server/knowledge-review-assessment.ts';
import { printedCorrection, checkPrintedTranscription, makePrintedCorrectionRequest } from '../scripts/fhs-printed-correction.mjs';

test('only the independently read edition supplies the four incomplete printed excerpts', async () => {
  const watch = platformSourceWatches.find(w => w.id === oralPrint.sourceId);
  const sample = verifiedOralExcerpts(watch,oralPrint.pdfHash,18,watch.title,null);
  assert.equal(sample.extraction.complete,false);
  assert.deepEqual(sample.pages.map(p=>p.page),[1,6,12,15]);
  assert.equal(sample.text,sample.pages.map(p=>p.text).join('\n\n'));
  assert.equal(verifiedOralExcerpts({...watch,url:watch.url+'2'},oralPrint.pdfHash,18,watch.title,null),undefined);
  assert.equal(verifiedOralExcerpts(watch,oralPrint.pdfHash,17,watch.title,null),undefined);
  const changed = await observeKnowledgeLeaflet(watch,Buffer.from('changed print'),watch.title,null,'catalogue-pdf-original/1',
    new AbortController().signal,async ()=>({fileHash:'1'.repeat(64),totalPages:18,pages:[{page:1,text:'',status:'unreadable'}],nextPage:null}));
  assert.equal(changed.items[0].nativeWindowMethod,'native-pdf-window/1');
  const request = makePrintedCorrectionRequest('a'.repeat(64),printedCorrection.packetHash);
  assert.equal(knowledgeReviewHash(request.attemptKey),'a2b2d2e5949a17f15326efb0b77efe182de2d77830d00d56df1bcdb22c88f652');
});

test('four independent page transcriptions must match the entire registered print, including punctuation', () => {
  const request = makePrintedCorrectionRequest('a'.repeat(64), 'b'.repeat(64));
  const reply = Object.fromEntries(printedCorrection.passages.map(p => ['page' + p.page, p.quote]));
  for (const row of printedCorrection.passages) assert.ok(!request.user.includes(row.quote));
  assert.deepEqual(checkPrintedTranscription(reply), printedCorrection.passages.map(p => p.quote));
  assert.deepEqual(checkPrintedTranscription({...reply,page12:reply.page12.replace('，','，\n')}), Object.values(reply));
  for (const bad of [{...reply,page15:reply.page15.slice(0,-1)}, {...reply,page6:reply.page15}, {...reply,other:'text'}]) {
    assert.throws(() => checkPrintedTranscription(bad));
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { printedCorrection, checkPrintedTranscription, makePrintedCorrectionRequest } from '../scripts/fhs-printed-correction.mjs';

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

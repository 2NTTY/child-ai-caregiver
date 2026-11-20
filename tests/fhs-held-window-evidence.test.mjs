import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectHeldWindowQuotes, readRecordedWindowQuotes } from '../scripts/fhs-held-window-evidence.mjs';

const range = { first: 1, last: 4, ranges: [{ first: 1, last: 4 }] };
const draft = { ranges: { 'pages-1-4': { quotePage: 3, quote: 'Organizer excerpt', originalKind: 'page_transcription', text: 'Unrelated draft text' } } };
const review = { decision: 'approve', ranges: { 'pages-1-4': { supported: true, originalQuote: 'Reviewer excerpt', reason: 'Unrelated notes' } } };
const requests = ['knowledge_organize', 'knowledge_review'].map(role => ({ role, attemptKey: role, system: 'fixed', user: 'request' }));
const replay = async complete => {
  await complete(requests[0]);
  await complete(requests[1]);
  assert.fail('The inspection must stop before assembling a candidate');
};

test('lookup returns the two independently recorded excerpts without the rest of either stage', async () => {
  const evidence = await readRecordedWindowQuotes(range, replay, async input => JSON.stringify(input.role === 'knowledge_organize' ? draft : review));
  assert.deepEqual(evidence, [{ first: 1, last: 4, organizerPage: 3, kind: 'page_transcription',
    organizerExcerpt: 'Organizer excerpt', reviewerExcerpt: 'Reviewer excerpt', supported: true }]);
});

test('a missing or reordered stage cannot be presented as a pair', async () => {
  await assert.rejects(readRecordedWindowQuotes(range, async complete => { await complete(requests[0]); }, async () => JSON.stringify(draft)), /stage_pair/);
  await assert.rejects(readRecordedWindowQuotes(range, async complete => { await complete(requests[1]); }, async () => JSON.stringify(review)), /stage_pair/);
  await assert.rejects(readRecordedWindowQuotes(range, replay, async () => { throw Error('saved_request_changed'); }), /saved_request_changed/);
});

test('another lane or a changed publication binding stops before reading model stages', async () => {
  const sourceId = 'pdf-fixture', original = 'a'.repeat(64);
  const scope = { domain: {}, pin: { sourceId, lane: 'C1' }, definition: { id: sourceId, kind: 'pdf', audience: 'public_noncommercial',
    url: 'https://www.fhs.gov.hk/fixture.pdf' }, job: { watchId: sourceId }, original, saved: { windowed: true,
    request: { watchId: sourceId, operationFingerprint: original, publishMode: 'live' },
    result: { status: 'candidate_held', code: 'knowledge_window_quote_mismatch' } } };
  await assert.rejects(inspectHeldWindowQuotes(scope), /fhs_evidence_scope/);
  const ref = { collection: () => ref, doc: () => ref, get: async () => ({ data: () => ({ operationFingerprint: 'wrong' }) }) };
  await assert.rejects(inspectHeldWindowQuotes({ ...scope, pin: { ...scope.pin, lane: 'C2' }, domain: { database: ref } }), /fhs_evidence_operation_changed/);
});

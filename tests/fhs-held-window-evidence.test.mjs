import assert from 'node:assert/strict';
import test from 'node:test';
import { canInspectHeldWindow, inspectHeldWindowEvidence, readRecordedShapeFailure, readRecordedWindowQuotes, verifySettledWindowStage } from '../scripts/fhs-held-window-evidence.mjs';
import { campaignTicketId } from '../server/knowledge-campaign-budget.ts';
import { knowledgeReviewHash } from '../server/knowledge-review-assessment.ts';
import { z } from 'zod';

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

test('C3 inspects only a first-window citation hold after both original readings', () => {
  const pin = { lane: 'C3' };
  const saved = { windowed: true, budget: { modelCalls: 2 }, result: { status: 'candidate_held', code: 'knowledge_window_quote_mismatch' } };
  assert.equal(canInspectHeldWindow(pin, saved), true);
  for (const calls of [0, 1, 3, 4]) assert.equal(canInspectHeldWindow(pin, { ...saved, budget: { modelCalls: calls } }), false);
  for (const code of ['knowledge_review_failed', 'knowledge_window_review_held', 'age_one_sided', 'unavailable'])
    assert.equal(canInspectHeldWindow(pin, { ...saved, result: { ...saved.result, code } }), false);
  for (const changed of [{ windowed: false }, { result: { status: 'published', code: saved.result.code } }])
    assert.equal(canInspectHeldWindow(pin, { ...saved, ...changed }), false);
  assert.equal(canInspectHeldWindow({ lane: 'C1' }, saved), false);
  assert.equal(canInspectHeldWindow({ lane: 'C2' }, { ...saved, result: { ...saved.result, code: 'knowledge_review_failed' } }), true);
});

test('each C3 reading requires its own original settled generation with output', async () => {
  const sourceId = 'pdf-example', operationFingerprint = 'a'.repeat(64), key = 'first-window:organize';
  const stageHash = knowledgeReviewHash(key);
  const id = campaignTicketId('generation', sourceId, operationFingerprint, stageHash);
  const settled = { sourceId, operationFingerprint, stageHash, kind: 'generation', state: 'settled', outputTokens: 115 };
  let row = settled;
  const attempts = { doc: requested => ({ get: async () => ({ data: () => requested === id ? row : undefined }) }) };
  await verifySettledWindowStage(attempts, sourceId, operationFingerprint, key);
  await assert.rejects(verifySettledWindowStage(attempts, sourceId, operationFingerprint, 'first-window:review'), /generation_unconfirmed/);
  for (const change of [{ state: 'reserved' }, { outputTokens: 0 }, { rejection: {} }, { kind: 'embedding' },
    { operationFingerprint: 'b'.repeat(64) }, { sourceId: 'other' }, { stageHash: 'c'.repeat(64) }]) {
    row = { ...settled, ...change };
    await assert.rejects(verifySettledWindowStage(attempts, sourceId, operationFingerprint, key), /generation_unconfirmed/);
  }
});

test('another lane or a changed publication binding stops before reading model stages', async () => {
  const sourceId = 'pdf-fixture', original = 'a'.repeat(64);
  const scope = { domain: {}, pin: { sourceId, lane: 'C1' }, definition: { id: sourceId, kind: 'pdf', audience: 'public_noncommercial',
    url: 'https://www.fhs.gov.hk/fixture.pdf' }, job: { watchId: sourceId }, original, saved: { windowed: true,
    request: { watchId: sourceId, operationFingerprint: original, publishMode: 'live' },
    result: { status: 'candidate_held', code: 'knowledge_window_quote_mismatch' } } };
  await assert.rejects(inspectHeldWindowEvidence(scope), /fhs_evidence_scope/);
  const ref = { collection: () => ref, doc: () => ref, get: async () => ({ data: () => ({ operationFingerprint: 'wrong' }) }) };
  await assert.rejects(inspectHeldWindowEvidence({ ...scope, pin: { ...scope.pin, lane: 'C2' }, domain: { database: ref } }), /fhs_evidence_operation_changed/);
});

test('a sealed schema failure reports its field and measured size while keeping response text private', async () => {
  const parse = async complete => z.object({ reason: z.string().max(4) }).parse(JSON.parse(await complete(requests[0])));
  const result = await readRecordedShapeFailure(parse, async () => JSON.stringify({ reason: 'a synthetic reason' }));
  assert.deepEqual(result, { role: 'knowledge_organize', state: 'schema_rejected',
    issues: [{ path: ['reason'], code: 'too_big', maximum: 4, length: 18 }] });
  await assert.rejects(readRecordedShapeFailure(parse, async () => { throw Error('fhs_evidence_stage_changed'); }), /stage_changed/);
});

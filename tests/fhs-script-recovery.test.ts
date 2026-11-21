import assert from 'node:assert/strict';
import test from 'node:test';
import { scriptReadingContract } from '../server/knowledge-script-reading.ts';
import { approvedScriptEdition, heldScriptRevision, scriptRevisionWorkId, verifyHeldScript } from '../server/fhs-script-edition.ts';

test('a held script keeps its one-sided publisher wording as searchable original text', () => {
  const unit = { id: 'p0-12345678901234567890', originalText: '六個月以後。按原文所列條件閱讀。', scriptPassage: { title: '起步篇' } };
  const reading = scriptReadingContract([unit], '原教材');
  const [chunk] = reading.parse({ u1: { audience: 'lookup', conditions: ['六個月以後'], topics: ['feeding'] } });
  assert.equal(chunk!.unitId, unit.id);
  assert.equal(chunk!.text, unit.originalText);
  assert.equal(chunk!.treatment?.kind, 'overview');
  assert.equal(chunk!.applicability.use, 'original_lookup');
  assert.ok(chunk!.applicability.conditions.includes('六個月以後'));
  assert.throws(() => reading.parse({ u1: { audience: 'lookup', conditions: ['直至三歲'], topics: ['feeding'] } }), /scope_quote/u);
});

test('only the original settled hold can commission the corresponding correction', () => {
  const pin=approvedScriptEdition('fhs-12196')!, entry=heldScriptRevision(pin);
  const original={lease:null,receipt:null,result:{status:'candidate_held',code:entry.reason,observationHash:pin.observationHash},
    prepared:{versionHash:entry.candidateVersionHash!,review:{decision:'hold_candidate',notes:['Retain the original restriction.']}}};
  assert.deepEqual(verifyHeldScript(pin,original).notes,original.prepared.review.notes);
  assert.notEqual(scriptRevisionWorkId(pin),entry.operationFingerprint);
  assert.throws(()=>verifyHeldScript(pin,{...original,receipt:{state:'committed'}}),/original_changed/u);
  assert.throws(()=>verifyHeldScript(pin,{...original,prepared:null}),/original_changed/u);
  assert.throws(()=>scriptRevisionWorkId(approvedScriptEdition('fhs-30119')!),/not_commissioned/u);
});

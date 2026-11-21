import assert from 'node:assert/strict';
import test from 'node:test';
import { compactPublisherReview, publisherScriptReading, scriptReadingContract } from '../server/knowledge-script-reading.ts';
import { approvedScriptEdition, currentScriptReadingWork, heldScriptRevision, scriptEditionWorkId, scriptRevisionWorkId, verifiedScriptReading, verifyHeldScript } from '../server/fhs-script-edition.ts';

test('a publisher audience remains visible without creating age endpoints or advice eligibility', () => {
  const unit = {id:'p0-12345678901234567890',originalText:'家長可參考原文。',scriptPassage:{title:'情緒導航（學前兒童篇）'}};
  const [chunk]=publisherScriptReading([unit],'官方教材',[{title:unit.scriptPassage.title,audience:'學前兒童'}]);
  assert.equal(chunk!.applicability.ageBasis,'publisher');
  assert.deepEqual(chunk!.applicability.publisherAudiences,['學前兒童']);
  assert.equal(chunk!.applicability.minAgeMonths,null);
  assert.equal(chunk!.applicability.maxAgeMonths,null);
  assert.equal(chunk!.applicability.use,'original_lookup');
  assert.throws(()=>publisherScriptReading([unit],'官方教材',[{title:unit.scriptPassage.title,audience:'3至6歲'}]),/audience_evidence/u);
  assert.throws(()=>publisherScriptReading([unit],'官方教材',[{title:'另一套學前影片',audience:'學前'}]),/audience_evidence/u);
});

test('the previous reading and its review stay bound to the new publisher edition', async () => {
  const pin=approvedScriptEdition('fhs-14842')!,parent=heldScriptRevision(pin);
  const first={receipt:null,lease:null,prepared:null,result:{status:'candidate_held',code:parent.reason,observationHash:pin.observationHash}};
  const prior={...first,result:{...first.result,code:'review_hold'},prepared:{versionHash:'35fabd9fc0ca870ad83dc2c876a83efe066cd756356d5a54f4b53e67b7dc94d4',
    review:{decision:'hold_candidate',notes:['Original audience was lost.']}}};
  const read=(id:string)=>Promise.resolve(id===scriptEditionWorkId(pin)?first:prior);
  assert.notEqual(currentScriptReadingWork(pin),scriptRevisionWorkId(pin));
  const scope=await verifiedScriptReading(pin,read);
  assert.deepEqual(scope.notes,prior.prepared.review.notes);
  assert.ok('publisherScope' in scope && scope.publisherScope.audiences[0]?.audience==='學前兒童');
  await assert.rejects(verifiedScriptReading(pin,id=>id===scriptEditionWorkId(pin)?read(id):Promise.resolve({...prior,receipt:{state:'unknown'}})),/predecessor_changed/u);
});

test('the independent reader can reconstruct complete originals and quotations from compact references', () => {
  const original='學前兒童。🎈'.repeat(60), quote=original.slice(12,155);
  const source={first:original,second:{full:original,quote},quotes:[quote,'short']};
  const packed=compactPublisherReview(source,[original]);
  const restored=JSON.parse(JSON.stringify(packed),(_,v)=>typeof v==='object'&&v&&Object.hasOwn(v,'textRef')
    ? packed.repeatedText[v.textRef].slice(v.start,v.end):v);
  delete restored.repeatedText;
  assert.deepEqual(restored,source);
});

test('a held script keeps its one-sided publisher wording as searchable original text', () => {
  const unit = { id: 'p0-12345678901234567890', originalText: '六個月以後。按原文所列條件閱讀。', scriptPassage: { title: '起步篇' } };
  const reading = scriptReadingContract([unit], '原教材');
  assert.equal(Object.entries(reading.inputs[0]!.wording).filter(([k]) => /^s\d+$/u.test(k)).map(([,v])=>v).join(''),unit.originalText);
  const [chunk] = reading.parse({ u1: { audience: 'lookup', conditions: ['s1'], topics: ['feeding'] } });
  assert.equal(chunk!.unitId, unit.id);
  assert.equal(chunk!.text, unit.originalText);
  assert.equal(chunk!.treatment?.kind, 'overview');
  assert.equal(chunk!.applicability.use, 'original_lookup');
  assert.ok(chunk!.applicability.conditions.includes('六個月以後。'));
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

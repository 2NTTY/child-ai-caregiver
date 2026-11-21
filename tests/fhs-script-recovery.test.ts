import assert from 'node:assert/strict';
import test from 'node:test';
import { compactPublisherReview, publisherScriptReading, scriptReadingContract } from '../server/knowledge-script-reading.ts';
import { approvedScriptEdition, currentScriptReadingWork, heldScriptRevision, publisherScriptWork, scriptEditionWorkId, scriptRevisionWorkId, verifiedScriptReading, verifyHeldScript } from '../server/fhs-script-edition.ts';
import { ageExampleRegistration, bindPublisherAgeExamples } from '../server/knowledge-age-examples.ts';

test('scene ages and table rows retain their own quoted passage, numeral and publisher unit', () => {
  const age = ageExampleRegistration.parse({scope:{scriptTitle:'家居安全'},age:{wording:'3歲',unit:'years',form:'age',values:[3]}});
  const unit = {id:'scene',originalText:'前段。\n相片：兒子(5歲)和女兒(3歲)跟爸爸說再見。',scriptPassage:{title:'家居安全',firstParagraph:10}};
  const [scene] = publisherScriptReading([unit],'安全',[],'',true,[age]);
  assert.equal(scene!.applicability.use,'original_lookup');
  assert.equal(scene!.applicability.minAgeMonths,null);
  assert.equal(scene!.applicability.maxAgeMonths,null);
  const [example] = scene!.applicability.ageExamples!;
  assert.equal(example!.paragraph,11);
  assert.equal(unit.originalText.slice(example!.start,example!.start+example!.quote.length),example!.quote);
  assert.ok(example!.quote.includes('女兒(3歲)'));
  const table = ageExampleRegistration.parse({scope:{unitKey:'table'},age:{wording:'3-4歲',unit:'years',form:'range',values:[3,4]},
    quote:'3-4歲 約 10-13 小時'});
  const bound = bindPublisherAgeExamples([{id:'table',originalText:'1-2歲 約11-14小時 3-4歲 約 10-13 小時'}],[table]);
  assert.equal(bound.get('table')![0]!.quote,'3-4歲 約 10-13 小時');
  assert.throws(()=>bindPublisherAgeExamples([unit],[table]),/example_missing/u);
  assert.throws(()=>bindPublisherAgeExamples([{...unit,originalText:'女兒(13歲)。'}],[age]),/example_missing/u);
  assert.throws(()=>ageExampleRegistration.parse({...age,age:{...age.age,values:[36]}}));
});

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
  const earlierPublisher={...prior,prepared:{versionHash:'6dabeeb2530c16751befbb7f66437da0f45f463f494356e70913d7bba71dd27e',
    review:{decision:'hold_candidate',notes:['Ordinary care search still returned these words.']}}};
  const read=(id:string)=>Promise.resolve(id===scriptEditionWorkId(pin)?first:id===publisherScriptWork(pin)?earlierPublisher:prior);
  assert.notEqual(currentScriptReadingWork(pin),scriptRevisionWorkId(pin));
  const scope=await verifiedScriptReading(pin,read);
  assert.deepEqual(scope.notes,[...prior.prepared.review.notes,...earlierPublisher.prepared.review.notes]);
  assert.ok('publisherScope' in scope && scope.publisherScope.audiences[0]?.audience==='學前兒童');
  await assert.rejects(verifiedScriptReading(pin,id=>id===scriptEditionWorkId(pin)?read(id):Promise.resolve({...prior,receipt:{state:'unknown'}})),/predecessor_changed/u);
  await assert.rejects(verifiedScriptReading(pin,id=>id===publisherScriptWork(pin)?Promise.resolve(null):read(id)),/lookup_predecessor_changed/u);
});

test('an explicit upper age bound retains the source wording and leaves the lower bound unknown',()=>{
  const [reading]=publisherScriptReading([{id:'part',originalText:'給兩歲前幼兒的父母'}],'親子溝通',
    [{audience:'給兩歲前幼兒的父母',beforeMonths:24}],'給兩歲前幼兒的父母',true);
  assert.equal(reading!.applicability.maxAgeMonths,24);assert.equal(reading!.applicability.maxAgeMonthsExclusive,true);
  assert.equal(reading!.applicability.minAgeMonths,null);
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

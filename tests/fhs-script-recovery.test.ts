import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { chapterOriginalUnits, checkChapterReading } from '../server/knowledge-web-chapter.ts';
import { compactPublisherReview, publisherScriptReading, scriptReadingContract } from '../server/knowledge-script-reading.ts';
import { approvedScriptEdition, currentScriptReadingWork, heldScriptRevision, publisherScriptWork, scriptEditionWorkId, scriptRevisionWorkId, verifiedScriptReading, verifyHeldScript } from '../server/fhs-script-edition.ts';
import { ageExampleRegistration, bindPublisherAgeExamples } from '../server/knowledge-age-examples.ts';
import { procedureReadingPreview } from '../server/knowledge-procedure-reading.ts';
import type { KnowledgeEvidence, KnowledgeFilter } from '../src/shared/knowledge.ts';

test('a chapter keeps every character and the whole last sentence on its own published section', () => {
  const text = '學前階段 ' + '甲'.repeat(2980) + ' 調整獎賞 可逐步調整。最終保留完整末句。';
  const chapter = {textSha256:createHash('sha256').update(text).digest('hex'),headings:['學前階段','調整獎賞'],finalSentence:'最終保留完整末句。'};
  const units = chapterOriginalUnits(text,chapter);
  assert.equal(units.map(unit=>unit.originalText).join(''),text);
  const audiences = ['學前階段'];
  const chunks = publisherScriptReading(units,'學前階段',[{audience:'學前階段'}],text,true,[],'official-material')
    .map((row,i)=>({...row,key:row.unitId,originalText:units[i]!.originalText,sourceExcerpt:row.text.trim().slice(0,150)}));
  checkChapterReading(text,chapter,chunks,audiences);
  assert.equal(chunks[1]!.text,units[1]!.originalText);
  assert.throws(()=>checkChapterReading(text.slice(0,-1),chapter,chunks,audiences),/original_changed/u);
  assert.throws(()=>checkChapterReading(text,chapter,chunks.slice(0,1),audiences),/readback_mismatch/u);
  assert.throws(()=>checkChapterReading(text,chapter,chunks,['三歲']),/readback_mismatch/u);
});

test('the commissioned procedure labels resolve to the paid production operation in every locale', () => {
  assert.equal(currentScriptReadingWork(approvedScriptEdition('fhs-30092')!),'8ed6a70e97a40c02b2ba951822f03bfb5b470bcd97c5b1f1240e570fe4791509');
});

test('instruction previews keep the matched action and show both publisher groups at their shared boundary',()=>{
  const originalText='先閱讀使用說明。\n一歲以下的孩子看甲組；一歲以上的孩子看乙組。兩組均須留意說明。';
  const unit={id:'p0-12345678901234567890',originalText,scriptPassage:{title:'分組',firstParagraph:1}};
  const registrations=[['一歲以下','upper','upper_group'],['一歲以上','lower','lower_group']].map(([wording,form,procedure])=>
    ageExampleRegistration.parse({scope:{scriptTitle:'分組'},age:{wording,unit:'years',form,values:[1]},procedure}));
  const [draft]=publisherScriptReading([unit],'分組',[],'',true,registrations);
  const chunk={...draft,originalText,sourceExcerpt:originalText} as unknown as KnowledgeEvidence;
  const filter:KnowledgeFilter={purpose:'read_originals',classification:'official_guidance',region:'HK',topics:[],age:null,ageMatch:'contained'};
  function read(months:number|null) {return procedureReadingPreview(chunk,{...filter,age:months===null?null:{basis:'actual',minMonths:months,maxMonths:months}});}
  assert.equal(chunk.applicability.ageBasis,'per_instruction');
  assert.deepEqual(read(3).applicability.ageExamples?.map(e=>e.procedure?.months),[12]);
  assert.ok(read(3).text.includes('甲組')&&!read(3).text.includes('乙組'));
  assert.ok(read(17).text.includes('乙組')&&!read(17).text.includes('甲組'));
  assert.ok(read(17).text.includes('兩組均須留意說明。'));
  assert.equal(read(12).applicability.ageExamples?.length,2);
  assert.equal(read(null).applicability.ageExamples?.length,2);
  assert.equal(chunk.originalText,originalText);
});

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hasReviewedWindowSource, registeredReviewedWindow, retainWindowPassage, reviseWindowRegion } from '../server/fhs-reviewed-window.ts';
import { manualPublicationPin } from '../server/fhs-manual-publication.ts';
import { planKnowledgePdfWindows, readKnowledgePdfWindow } from '../server/knowledge-pdf-windows.ts';
import { SOURCE_WATCHES } from '../server/knowledge-source-catalog.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
test('a C3 citation registration is bound to the assigned original and its held observation', () => {
  const sourceId = 'pdf-65148c48ab4b294035fb977a';
  const original = '0e53006aae167996589f71ee76fdec69efd5235e0f2a2d41b903c40e2100c580';
  const observation = 'd7293e06acc48fe60fbdfdc1cc1b699fbfc77da75ca1fd8f7ea401d06fb77d5a';
  const pin = manualPublicationPin(sourceId)!;
  const registration = registeredReviewedWindow(pin, original, observation);
  assert(hasReviewedWindowSource(sourceId));
  assert(registration?.action === 'retain_window_quotes');
  assert.deepEqual(registration.passages.map(p => p.page), [2,3,4,5,6,7,8]);
  assert.equal(registeredReviewedWindow({...pin, lane:'C2'}, original, observation), undefined);
  assert.equal(registeredReviewedWindow(pin, original, sha('other observation')), undefined);
  assert.equal(registeredReviewedWindow(pin, sha('other operation'), observation), undefined);
  assert.equal(hasReviewedWindowSource('pdf-b061777e96a27e5124285ba5'), false);
});

test('published passages require the complete registered selection in each original reading and its physical page', () => {
  const excerpt = 'Read the label.';
  const selection = {page:2, organizerStart:4, reviewerStart:6, length:excerpt.length, sha256:sha(excerpt), proof:'text_layer' as const,
    layerStart:7, layerLength:excerpt.length, originalKind:'page_transcription' as const};
  const layer = {page:2, status:'text' as const, text:'First. '+excerpt};
  const select = (r = selection, review = 'Next. '+excerpt, page = layer) =>
    retainWindowPassage(r, 'page_transcription', 'Hi. '+excerpt, review, page);
  assert.deepEqual(select(), {quote:excerpt,kind:'text_layer'});
  assert.throws(() => select({...selection, reviewerStart:0}));
  assert.throws(() => select(selection,'Next. Read a label.'));
  assert.throws(() => select(selection, undefined, {...layer,page:3}));
  assert.throws(() => select({...selection,layerStart:0}));
});
test('only the registered Hong Kong region spelling changes before a new independent review', () => {
  const draft = {ranges:{'pages-1-1':null, 'pages-2-2':{text:'Keep this restriction.', applicability:{region:'香港',minAgeMonths:24}}}};
  const edited = reviseWindowRegion(structuredClone(draft), [2]);
  assert.deepEqual(edited, {ranges:{'pages-1-1':null, 'pages-2-2':{text:'Keep this restriction.',applicability:{region:'HK',minAgeMonths:24}}}});
  assert.throws(() => reviseWindowRegion(structuredClone(draft), [1]));
  assert.throws(() => reviseWindowRegion(edited, [2]));
});

test('a commissioned replay preserves qualified material and checks independent support before selecting its citation', async () => {
  const definition = SOURCE_WATCHES.find(row => row.leafletPage)!;
  const bytes = Buffer.from('%PDF-1.7 fixture');
  const parent = createHash('sha256').update(bytes).digest('hex');
  const candidate = {watchId:definition.id,definition,observationHash:'1'.repeat(64),previousObservationHash:null,
    observed:{url:definition.url,title:'Fixture',text:'',sourcePublishedAt:null,sourceUpdatedAt:null,sourceDateText:null,
      extraction:{format:'text_pdf' as const,contentHash:parent,totalPages:2,complete:false,pageStart:1,pageEnd:2}}};
  const pages = {page1:{status:'navigation',reason:'Cover.'},page2:{status:'content',reason:'Printed example.'}};
  const quote = 'The printed sentence.', unit = {section:'Panel',text:'The approved material with its exception.',keywords:['fixture'],
    quotePage:2,quote:'A. '+quote,originalKind:'page_transcription',
    applicability:{region:'HK',ageBasis:'actual',minAgeMonths:36,maxAgeMonths:60,topics:['care'],conditions:['Only with adult supervision.']}};
  const selection = {page:2, originalKind:'page_transcription' as const, organizerStart:3, reviewerStart:0, length:quote.length,
    sha256:sha(quote), proof:'printed' as const};
  const revision = {action:'retain_window_quotes' as const,sourceId:definition.id,sha256:parent,pages:2,bindingHash:'a'.repeat(64),passages:[selection]};
  let supported = true;
  const args: Parameters<typeof readKnowledgePdfWindow>[0] = {candidate,range:planKnowledgePdfWindows(2,2)[0]!,baseline:null,sliceHash:parent,bytes,
    textLayers:[{page:1,status:'empty',text:''},{page:2,status:'text',text:'Separate readable footer.'}],explicitAgeScope:true,reviewedWindow:revision,
    async completeText({role,user}) {
      if (role === 'knowledge_organize') return JSON.stringify({pages,ranges:{'pages-1-1':null,'pages-2-2':unit}});
      const passage = JSON.parse(user).candidate['pages-2-2'];
      assert.equal(passage.text,unit.text);
      assert.deepEqual(passage.applicability,unit.applicability);
      assert.equal(Object.hasOwn(passage,'quote'),false);
      return JSON.stringify({pages,decision:'approve',checks:Object.fromEntries(['age','numbersAndUnits','timing','conditions','exceptions','prohibitions','withdrawal']
        .map(key => [key,'Checked against the original.'])),ranges:{'pages-1-1':{supported:true,originalQuote:'',reason:'Cover.'},
          'pages-2-2':{supported,originalQuote:quote+' Another sentence.',reason:'Read independently.'}}});
    }};
  const read = await readKnowledgePdfWindow(args);
  assert.equal(read.chunks[0]?.sourceExcerpt,quote);
  assert.equal(read.chunks[0]?.text,unit.text);
  assert.equal(read.originalLocations['pages-2-2']?.kind,'page_transcription');
  assert.ok(read.registeredRequests?.reviewerRequestHash);
  await assert.rejects(readKnowledgePdfWindow({...args,reviewedWindow:undefined}),{code:'knowledge_window_quote_mismatch'});
  supported = false;
  await assert.rejects(readKnowledgePdfWindow(args),{code:'knowledge_window_review_held'});
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { confirmOriginalGenerations, verifyFhsPdfPages, readFhsDelivery } from '../scripts/fhs-publication-receipt.mjs';
import { PDF_WINDOW_METHOD, planKnowledgePdfWindows } from '../server/knowledge-pdf-windows.ts';
import { knowledgeReviewHash } from '../server/knowledge-review-assessment.ts';
import { campaignTicketId } from '../server/knowledge-campaign-budget.ts';

const sha = value => createHash('sha256').update(value).digest('hex');
const blob = Buffer.from('official test file');
const digest = sha(blob);
const chunk = { key: 'part', sourceExcerpt: 'the complete quote', pageStart: 1, pageEnd: 2, excerptPage: 2 };
const metadata = { sourceId: 'pdf-test', versionId: 'version', versionHash: 'version-hash', url: 'https://example.test/file.pdf' };
const identities = [{ key: 'part', chunkId: 'chunk', contentHash: 'chunk-hash' }];
const source = { ...metadata, extraction: { contentHash: digest, totalPages: 2 }, chunks: [chunk] };

test('the same undecoded glyph marker in a stored quote and its page cannot verify a citation', async () => {
  const quote = 'printed \ufffd passage';
  const result = await verifyFhsPdfPages(metadata, {...source, chunks:[{...chunk,sourceExcerpt:quote}]},
    identities, [], {sha256:digest, pages:2, bytes:blob.length}, pagePorts(quote));
  assert.equal(result.pages[0].proof, 'unreadable_excerpt');
});

function pagePorts(secondPage = 'the complete quote') {
  return {
    async resolve(identity) {
      assert.equal(identity.chunkId, 'chunk');
      assert.equal(identity.contentHash, 'chunk-hash');
      return { sourceId: metadata.sourceId, sha256: digest, url: metadata.url };
    },
    async readOriginal() { return blob; },
    async extract() { return { fileHash: digest, totalPages: 2, pages: [
      {page:1, status:'text', text:'cover'}, {page:2, status:secondPage ? 'text' : 'empty', text:secondPage},
    ] }; },
  };
}

test('the family opening page, complete excerpt, resolver and exact bytes are checked together', async () => {
  const result = await verifyFhsPdfPages(metadata, source, identities, [], {sha256:digest, pages:2, bytes:blob.length}, pagePorts('the complete\nquote'));
  assert.equal(result.pages[0].page, 2);
  assert.equal(result.pages[0].proof, 'text_layout_whitespace');
  const missing = await verifyFhsPdfPages(metadata, source, identities, [], {sha256:digest, pages:2, bytes:blob.length}, pagePorts('other text'));
  assert.equal(missing.pages[0].proof, 'excerpt_not_on_opening_page');
  await assert.rejects(verifyFhsPdfPages(metadata, source, identities, [], {sha256:digest, pages:2, bytes:blob.length},
    {...pagePorts(), async readOriginal() { return Buffer.from('substituted bytes'); }}), /original_mismatch/);
});

test('a textless page needs the saved independent readings and the exact approved excerpt', async () => {
  const scanned = {...chunk, originalKind:'page_transcription'};
  const page = {page:2,status:'content'};
  const window = {parentHash:digest, first:1, last:2, organizeKey:'organizer', reviewKey:'reviewer',
    originalLocations:{part:{physicalPage:2,kind:'page_transcription'}}, chunks:[scanned], pages:[page], organizePages:[page]};
  const verify = windows => verifyFhsPdfPages(metadata, {...source,chunks:[scanned]}, identities, windows,
    {sha256:digest, pages:2, bytes:blob.length}, pagePorts(''));
  assert.equal((await verify([window])).pages[0].proof, 'recorded_independent_transcription');
  assert.equal((await verify([{...window,reviewKey:window.organizeKey}])).pages[0].proof, 'independent_page_evidence_missing');
});

test('a legacy excerpt may cross a page break only when it starts on the family opening page', async () => {
  const verify = excerpt => verifyFhsPdfPages(metadata, { ...source, chunks: [{ ...chunk, excerptPage: 1, sourceExcerpt: excerpt }] },
    identities, [], { sha256: digest, pages: 2, bytes: blob.length }, pagePorts('detail on page two'));
  const span = (await verify('cover detail on')).pages[0];
  assert.equal(span.proof, 'text_across_pages');
  assert.equal(span.throughPage, 2);
  assert.equal((await verify('detail on page two')).pages[0].proof, 'excerpt_not_on_opening_page');
});

test('a separate active edition cannot turn a held operation into a publication', async () => {
  const row = await readFhsDelivery({sourceId:'pdf-test',originalOperation:'a'.repeat(64)}, {
    originalOperation:'a'.repeat(64), pin:{url:metadata.url, sha256:digest, pages:2}, inspect:async()=>({budget:{modelCalls:1},
      result:{status:'candidate_held',code:'review_hold',review:{decision:'hold_candidate',notes:['Age scope needs review']}}}),
    active:async()=>({versionId:'unrelated-live-edition'}),
  });
  assert.equal(row.outcome, 'candidate_held');
  assert.equal(row.otherActiveVersionId, 'unrelated-live-edition');
  assert.equal(row.originalPdf.sha256, digest);
  assert.deepEqual(row.reviewNotes, ['Age scope needs review']);
  assert.equal(row.card, undefined);
  await assert.rejects(readFhsDelivery({sourceId:'pdf-test',originalOperation:'b'.repeat(64)}, {
    originalOperation:'a'.repeat(64),
  }),/operation_binding/);
});

test('a published receipt binds the committed observation, family edition and every required vector', async t => {
  const input = { sourceId: metadata.sourceId, originalOperation: sha('operation') };
  const observationHash = sha('observation');
  const work = { budget: { modelCalls: 2 }, receipt: { state: 'committed', observationHash },
    result: { status: 'published', published: true, observationHash },
    prepared: { versionHash: metadata.versionHash, provenance: { windows: [] },
      review: { observationHash, modelReviewCompleted: true, decision: 'approve_candidate' } } };
  const edition = { ...metadata, source, chunkIdentities: identities, observationHash, current: true, enabled: true };
  const archive = { source, versionHash: metadata.versionHash, embeddings: [{ chunkKey: chunk.key }] };
  const ports = { ...pagePorts(), originalOperation: input.originalOperation,
    pin: { url: metadata.url, sha256: digest, bytes: blob.length, pages: 2 }, inspect: async () => work, active: async () => edition,
    familyCard: async () => ({ ...metadata, seriesId: 'series', enabled: true }), exportEdition: async () => archive };
  const result = await readFhsDelivery(input, ports);
  assert.equal(result.readback, 'verified');
  assert.equal(result.vectors.exported, 1);
  assert.equal(result.pdf.pages[0].proof, 'text_exact');
  await t.test('a 36-page edition binds every window to two settled original readings', async () => {
    const totalPages = 36;
    const windows = planKnowledgePdfWindows(totalPages, 6).map(({ first, last, firstRead, lastRead }) => {
      const pages = Array.from({ length: last - first + 1 }, (_, i) => ({ page: first + i, status: 'content', reason: 'review on original page' }));
      return { parentHash: digest, method: PDF_WINDOW_METHOD, first, last, firstRead, lastRead, sliceHash: sha('slice ' + first),
        pages, organizePages: pages.map(p => ({...p, reason:'organizer on original page'})),
        organizeKey:'knowledge-window-organize:' + sha('organize ' + first), reviewKey:'knowledge-window-review:' + sha('review ' + first) };
    });
    const provenance = { windows, organizeAttemptKey: 'window-set:' + knowledgeReviewHash(windows.map(w => w.organizeKey)),
      reviewAttemptKey: 'window-set:' + knowledgeReviewHash(windows.map(w => w.reviewKey)) };
    const longSource = { ...source, extraction: { ...source.extraction, totalPages } };
    const expectedKeys = windows.flatMap(w => [w.organizeKey, w.reviewKey]);
    const tickets = new Map(expectedKeys.map(key => {
      const stageHash = knowledgeReviewHash(key), sourceId = input.sourceId, operationFingerprint = input.originalOperation;
      return [campaignTicketId('generation',sourceId,operationFingerprint,stageHash),
        {kind:'generation',state:'settled',sourceId,operationFingerprint,stageHash,outputTokens:300}];
    }));
    const attempts = {doc: id => ({id}), firestore: {getAll: async (...refs) => {
      const options = refs.pop();
      assert(options.fieldMask.includes('outputTokens'));
      return refs.map(({id}) => ({id, data:() => tickets.get(id)}));
    }}};
    const read = (proof = provenance, delivery = input) => readFhsDelivery(delivery,
      { ...ports, pin: { ...ports.pin, pages: totalPages }, active: async () => ({ ...edition, source: longSource }),
        extract: async (...args) => ({ ...await ports.extract(...args), totalPages }),
        exportEdition: async () => ({ ...archive, source: longSource }), verifyRepair: async () => true,
        inspect: async () => ({ ...work, windowed: true, prepared: { ...work.prepared, provenance: proof } }),
        confirmOriginalGenerations: (id, original, stages) => confirmOriginalGenerations(attempts, id, original, stages) });
    const { pdf } = await read();
    assert.deepEqual(pdf.recordedWindowReadings.map(w => [w.first, w.last, w.firstRead, w.lastRead]), [[1,14,1,15],[15,28,14,29],[29,36,28,36]]);
    assert.deepEqual(pdf.recordedWindowReadings.flatMap(w => w.physicalPages), Array.from({length:36}, (_,i) => i+1));
    for (const [i, w] of pdf.recordedWindowReadings.entries()) {
      assert.equal(w.sliceHash, windows[i].sliceHash);
      assert.deepEqual(w.organize, {stageHash: knowledgeReviewHash(windows[i].organizeKey), pageFindingsSha256: knowledgeReviewHash(windows[i].organizePages)});
      assert.deepEqual(w.review, {stageHash: knowledgeReviewHash(windows[i].reviewKey), pageFindingsSha256: knowledgeReviewHash(windows[i].pages)});
    }
    assert(!JSON.stringify(pdf.recordedWindowReadings).includes('on original page'));
    for (const changed of [
      {...provenance, windows: windows.slice(0,2)},
      {...provenance, windows: windows.map((w,i) => i === 1 ? {...w, firstRead: 15} : w)},
      {...provenance, windows: windows.map((w,i) => i === 2 ? {...w, parentHash:sha('other')} : w)},
      {...provenance, windows: windows.map((w,i) => i === 0 ? {...w, pages:w.pages.slice(1)} : w)},
      {...provenance, windows: windows.map((w,i) => i === 1 ? {...w, organizePages:w.organizePages.map(p => ({...p,status:'unreadable'}))} : w)},
      {...provenance, organizeAttemptKey:provenance.reviewAttemptKey},
      {...provenance, retainedDraft:{priorWork:'earlier'}},
    ]) assert.equal((await read(changed)).pdf.recordedWindowReadings, undefined);
    assert.equal((await read(provenance,{...input,deliveryOperation:sha('repair')})).pdf.recordedWindowReadings, undefined);
    const [lastId, lastTicket] = [...tickets].at(-1);
    for (const replacement of [{...lastTicket,state:'reserved'}, {...lastTicket,outputTokens:0}, {...lastTicket,sourceId:'another-source'},
      {...lastTicket,operationFingerprint:sha('other operation')}, {...lastTicket,rejection:{httpStatus:504}}, undefined]) {
      tickets.set(lastId,replacement);
      const receipt = await read();
      assert.equal(receipt.readback, 'verified');
      assert.equal(receipt.pdf.recordedWindowReadings, undefined);
    }
  });
  await t.test('long whole-PDF receipts identify the original organizer and reviewer and every physical page', async () => {
    const totalPages = 24;
    const findings = Array.from({length: totalPages}, (_, i) => ({page: i + 1, finding: 'Checked page ' + (i + 1)}));
    const coverage = { pages: findings, unreadablePages: [] };
    const provenance = { organizeAttemptKey: 'knowledge-organize:' + sha('organizer'), reviewAttemptKey: 'knowledge-review:' + sha('reviewer'),
      nativePdf: { contentHash: digest, organize: coverage, review: { ...coverage, pages: findings.map(f => ({ ...f, finding: `Independent check ${f.page}` })) } } };
    const longSource = { ...source, extraction: { ...source.extraction, totalPages } };
    const longPorts = { ...ports, pin: { ...ports.pin, pages: totalPages },
      active: async () => ({ ...edition, source: longSource }), exportEdition: async () => ({ ...archive, source: longSource }),
      extract: async (...args) => ({ ...await ports.extract(...args), totalPages }),
      inspect: async () => ({ ...work, prepared: { ...work.prepared, provenance } }) };
    const longReceipt = await readFhsDelivery(input, longPorts);
    assert.deepEqual(longReceipt.pdf.recordedReadings.organize.physicalPages, findings.map(f => f.page));
    assert.deepEqual(longReceipt.pdf.recordedReadings.review.physicalPages, findings.map(f => f.page));
    assert.equal(longReceipt.pdf.recordedReadings.organize.stageHash, sha(JSON.stringify(provenance.organizeAttemptKey)));
    assert.equal(longReceipt.pdf.recordedReadings.review.stageHash, sha(JSON.stringify(provenance.reviewAttemptKey)));
    assert.notEqual(longReceipt.pdf.recordedReadings.organize.pageFindingsSha256, longReceipt.pdf.recordedReadings.review.pageFindingsSha256);
    assert(!JSON.stringify(longReceipt.pdf.recordedReadings).includes('Checked page'));
    for (const change of [
      { reviewAttemptKey: provenance.organizeAttemptKey },
      { retainedDraft: { priorWork: 'other' } },
      { nativePdf: { ...provenance.nativePdf, contentHash: sha('another original') } },
      { nativePdf: { ...provenance.nativePdf, review: { ...coverage, pages: [...findings.slice(0,-1),findings[0]] } } },
      { nativePdf: { ...provenance.nativePdf, review: { ...coverage, unreadablePages: [3] } } },
    ]) {
      const partial = await readFhsDelivery(input, { ...longPorts, inspect: async () =>
        ({ ...work, prepared: { ...work.prepared, provenance: { ...provenance, ...change } } }) });
      assert.equal(partial.pdf.recordedReadings, undefined);
    }
    const repaired = await readFhsDelivery({ ...input, deliveryOperation: sha('repair') }, { ...longPorts, verifyRepair: async () => true });
    assert.equal(repaired.pdf.recordedReadings, undefined);
  });
  await assert.rejects(readFhsDelivery(input, { ...ports, inspect: async () => ({ ...work, receipt: null }) }), /publication_mismatch/);
  await assert.rejects(readFhsDelivery(input, { ...ports, exportEdition: async () => ({ ...archive, embeddings: [] }) }), /export_mismatch/);
  assert.equal((await readFhsDelivery(input, { ...ports, active: async () => ({ ...edition, current: false }) })).readback, 'edition_not_current');
  let catalogReads = 0;
  const changed = await readFhsDelivery(input, { ...ports, familyCard: async () => ++catalogReads === 1 ? ports.familyCard() : undefined });
  assert.equal(changed.readback, 'edition_not_current');
  await assert.rejects(readFhsDelivery({ ...input, deliveryOperation: sha('unrelated') }, {
    ...ports, verifyRepair: async () => false,
  }), /repair_binding/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { verifyFhsPdfPages, readFhsDelivery } from '../scripts/fhs-publication-receipt.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const blob = Buffer.from('official test file');
const digest = sha(blob);
const chunk = { key: 'part', sourceExcerpt: 'the complete quote', pageStart: 1, pageEnd: 2, excerptPage: 2 };
const metadata = { sourceId: 'pdf-test', versionId: 'version', versionHash: 'version-hash', url: 'https://example.test/file.pdf' };
const identities = [{ key: 'part', chunkId: 'chunk', contentHash: 'chunk-hash' }];
const source = { ...metadata, extraction: { contentHash: digest, totalPages: 2 }, chunks: [chunk] };

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
    originalOperation:'a'.repeat(64), pin:{url:metadata.url}, inspect:async()=>({budget:{modelCalls:1},result:{status:'candidate_held',code:'review_hold'}}),
    active:async()=>({versionId:'unrelated-live-edition'}),
  });
  assert.equal(row.outcome, 'candidate_held');
  assert.equal(row.otherActiveVersionId, 'unrelated-live-edition');
  assert.equal(row.card, undefined);
  await assert.rejects(readFhsDelivery({sourceId:'pdf-test',originalOperation:'b'.repeat(64)}, {
    originalOperation:'a'.repeat(64),
  }),/operation_binding/);
});

test('a published receipt binds the committed observation, family edition and every required vector', async () => {
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
  await assert.rejects(readFhsDelivery(input, { ...ports, inspect: async () => ({ ...work, receipt: null }) }), /publication_mismatch/);
  await assert.rejects(readFhsDelivery(input, { ...ports, exportEdition: async () => ({ ...archive, embeddings: [] }) }), /export_mismatch/);
  assert.equal((await readFhsDelivery(input, { ...ports, active: async () => ({ ...edition, current: false }) })).readback, 'edition_not_current');
  await assert.rejects(readFhsDelivery({ ...input, deliveryOperation: sha('unrelated') }, {
    ...ports, verifyRepair: async () => false,
  }), /repair_binding/);
});

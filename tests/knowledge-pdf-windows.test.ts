import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { planKnowledgePdfWindows, readKnowledgePdfWindow } from "../server/knowledge-pdf-windows.ts";
import { knowledgeReviewHash } from "../server/knowledge-review-assessment.ts";
import type { RetainedTranscription } from "../server/knowledge-retained-draft.ts";
import { checkKnowledgeObservation } from "../server/knowledge-observation.ts";
import { parseKnowledgeSource } from "../server/knowledge-inputs.ts";
import { SOURCE_WATCHES } from "../server/knowledge-source-catalog.ts";
test("native windows cover the full source once and attach adjacent pages within the original allowance", () => {
  const plan = planKnowledgePdfWindows(33, 6);
  assert.deepEqual(plan.map(w => [w.first, w.last, w.firstRead, w.lastRead]), [[1, 14, 1, 15], [15, 28, 14, 29], [29, 33, 28, 33]]);
  const indexedRanges = plan.flatMap(w => w.ranges);
  assert.ok(indexedRanges.length <= 32);
  assert.deepEqual(indexedRanges.flatMap(r => Array.from({ length: r.last - r.first + 1 }, (_, i) => r.first + i)), Array.from({ length: 33 }, (_, i) => i + 1));
  assert.throws(() => planKnowledgePdfWindows(33, 5), { code: "knowledge_window_model_budget_required" });
});
test("a textless figure stays bound to its original PDF and cannot create a fabricated quotation", () => {
  const registered = SOURCE_WATCHES.find(s => s.id === "fhs-feeding-booklet-en")!;
  const extraction = { format: "text_pdf" as const, contentHash: "a".repeat(64), totalPages: 1, pageStart: 1, pageEnd: 1, complete: true };
  const figure = {
    key: "pages-1-1", section: "Diagram", sourceExcerpt: "", text: "Supported visual summary", originalKind: "visual_page",
    pageStart: 1, pageEnd: 1, keywords: ["figure"], applicability: { region: "HK", ageBasis: "any", minAgeMonths: null, maxAgeMonths: null, topics: ["care"], conditions: [] }
  };
  const header = {
    sourceId: registered.id, url: registered.url, title: "Fixture", publisher: registered.publisher,
    classification: registered.classification, sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null,
    fetchedAt: "2026-01-01T00:00:00.000Z", termsUrl: registered.termsUrl, extraction
  };
  const source = parseKnowledgeSource({ ...header, chunks: [figure] });
  assert.equal(source.chunks[0]?.originalText, undefined);
  assert.equal(parseKnowledgeSource({ ...header, chunks: [{ ...figure, excerptPage: 1 }] }).chunks[0]?.excerptPage, 1);
  assert.throws(() => parseKnowledgeSource({ ...header, chunks: [{ ...figure, excerptPage: 2 }] }));
  assert.throws(() => parseKnowledgeSource({ ...header, chunks: [{ ...figure, originalText: "Invented text" }] }));
  assert.throws(() => parseKnowledgeSource({ ...header, chunks: [{ ...figure, originalKind: undefined }] }));
  const observed = {
    url: registered.url, content_hash: "b".repeat(64), unavailable: false,
    document: {
      url: registered.url, title: header.title, text: "", sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null,
      nativeWindowMethod: "native-pdf-window/1" as const, extraction: { ...extraction, complete: false }
    }
  };
  assert.throws(() => checkKnowledgeObservation(source, { definition: registered, enabled: true }, observed, observed.content_hash), /window_review_required/u);
});

test('a retained poster cites the complete printed passage at both registered transcript offsets', async () => {
  const bytes = Buffer.from('%PDF-1.7 single-page fixture'), sliceHash = createHash('sha256').update(bytes).digest('hex');
  const definition = SOURCE_WATCHES.find(d => d.leafletPage)!;
  const observed = {url:definition.url, title:'Fixture poster', text:'', sourcePublishedAt:null, sourceUpdatedAt:null, sourceDateText:null,
    extraction:{format:'text_pdf' as const, totalPages:1, contentHash:sliceHash, complete:false, pageStart:1, pageEnd:1}};
  const candidate = {watchId:definition.id, definition, observed, observationHash:'b'.repeat(64), previousObservationHash:null};
  const requestHashes: string[] = [], pages = {page1:{status:'content', reason:'Read from the printed panel.'}};
  const excerpt = 'Wash before use.', organized = 'Label. ' + excerpt, checked = 'Top panel. ' + excerpt + ' Bottom panel.';
  let approved = true;
  const args: Parameters<typeof readKnowledgePdfWindow>[0] = {candidate, baseline:null, bytes, sliceHash,
    range:planKnowledgePdfWindows(1,2)[0]!, textLayers:[{page:1, status:'empty', text:''}], explicitAgeScope:true,
    async completeText({role, system, user, attemptKey}) {
      requestHashes.push(knowledgeReviewHash({system, user, attemptKey}));
      if (role === 'knowledge_organize') return JSON.stringify({pages, ranges:{'pages-1-1':{
        section:'Panel', text:'Read the label before use.', keywords:['label'], quotePage:1, quote:organized, originalKind:'page_transcription',
        applicability:{region:'HK', ageBasis:'any', minAgeMonths:null, maxAgeMonths:null, topics:['care'], conditions:[]}
      }}});
      assert.equal(Object.hasOwn(JSON.parse(user).candidate['pages-1-1'], 'quote'), false);
      return JSON.stringify({pages, ranges:{'pages-1-1':{supported:true, originalQuote:checked, reason:'Read independently.'}},
        decision:approved ? 'approve' : 'hold', checks:Object.fromEntries(['age','numbersAndUnits','timing','conditions','exceptions','prohibitions','withdrawal'].map(key=>[key,'Checked against the full page.']))});
    }};
  await assert.rejects(readKnowledgePdfWindow(args), {code:'knowledge_window_quote_mismatch'});
  const revision: RetainedTranscription = {action:'retain_pdf_transcription', pages:1, sourceId:definition.id, observationHash:candidate.observationHash,
    sha256:sliceHash, sliceHash, operationFingerprint:'a'.repeat(64), sections:['Upper panel'], reason:'Both readings transcribed this complete sentence.',
    organizerRequestHash:requestHashes[0]!, reviewerRequestHash:requestHashes[1]!, excerpt, organizerStart:organized.indexOf(excerpt), reviewerStart:checked.indexOf(excerpt)};
  const read = (changes: Partial<RetainedTranscription> = {}) => readKnowledgePdfWindow({...args, retainedTranscription:{...revision,...changes}});
  const result = await read();
  assert.equal(result.chunks[0]?.originalText, excerpt);
  assert.deepEqual(result.originalLocations['pages-1-1'], {physicalPage:1, kind:'page_transcription'});
  await assert.rejects(read({reviewerStart:0}), {code:'knowledge_window_quote_mismatch'});
  await assert.rejects(read({excerpt:'Wash after use.'}), {code:'knowledge_window_quote_mismatch'});
  await assert.rejects(read({reviewerRequestHash:'0'.repeat(64)}), {code:'knowledge_retained_transcription_binding'});
  approved = false;
  await assert.rejects(read(), {code:'knowledge_window_review_held'});
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import React from "react";
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";
import { extractKnowledgePdf } from "../server/knowledge-pdf.ts";
import type { PDFPageProxy } from "pdfjs-dist";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { repairPdfGlyphs } from "../server/knowledge-pdf-glyphs.ts";
import { readablePdfQuote } from "../server/knowledge-pdf-quotes.ts";
import { physicalPdfQuote } from "../server/knowledge-pdf-physical-quote.ts";
import { checkKnowledgeObservation } from "../server/knowledge-observation.ts";
import { parseKnowledgeSource } from "../server/knowledge-inputs.ts";
import { SOURCE_WATCHES } from "../server/knowledge-source-catalog.ts";

test("a grouped PDF opens the exact physical quote without discarding the rest of the reviewed range", () => {
  const pages = [{page:1, text:"Cover", status:"text" as const}, {page:2, text:"Second page presents the complete printed passage.", status:"text" as const}];
  const joined = pages.map(p => p.text).join("\n\n");
  const quote = physicalPdfQuote(joined, pages);
  assert.deepEqual(physicalPdfQuote(joined, undefined), readablePdfQuote(joined));
  assert.deepEqual(quote, {sourceExcerpt:pages[1]!.text, originalText:joined, excerptPage:2});
  assert.deepEqual(physicalPdfQuote(joined, pages, 'complete printed passage'), {
    originalText:joined, sourceExcerpt:'complete printed passage', excerptPage:2
  });
  assert.deepEqual(physicalPdfQuote(joined, pages, 'Cover'), {originalText:joined, sourceExcerpt:'Cover'});
  const definition = SOURCE_WATCHES.find(d => d.leafletPage)!;
  const extraction = {format:'text_pdf' as const, contentHash:'a'.repeat(64), totalPages:2, pageStart:1, pageEnd:2, complete:true};
  const header = {sourceId:definition.id, url:definition.url, title:'Fixture', publisher:definition.publisher, classification:definition.classification,
    termsUrl:definition.termsUrl, fetchedAt:'2026-01-01T00:00:00.000Z', sourceDateText:null, sourcePublishedAt:null, sourceUpdatedAt:null, extraction};
  const chunk = {key:'range', section:'Example', text:'Reviewed range', keywords:['example'], pageStart:1, pageEnd:2,
    applicability:{region:'HK', ageBasis:'any', minAgeMonths:null, maxAgeMonths:null, topics:['example'], conditions:[]}, ...quote};
  const pin = {url:definition.url, content_hash:'b'.repeat(64), unavailable:false, document:{
    url:definition.url, title:'Fixture', text:joined, sourceDateText:null, sourcePublishedAt:null, sourceUpdatedAt:null, extraction, pages}};
  const watch = {enabled:true, definition};
  checkKnowledgeObservation(parseKnowledgeSource({...header, chunks:[chunk]}), watch, pin, pin.content_hash);
  assert.throws(() => checkKnowledgeObservation(parseKnowledgeSource({...header, chunks:[{...chunk, excerptPage:1}]}),
    watch, pin, pin.content_hash), /knowledge_pdf_original_page_mismatch/u);
});

test("official PDF extraction keeps file-bound continuation and refuses page-number-only text", async () => {
  const pdf = await renderToBuffer(React.createElement(Document, {},
    React.createElement(Page, {}, React.createElement(Text, {}, "First official page contains usable guidance.")),
    React.createElement(Page, {}, React.createElement(Text, {}, "Second official page contains further guidance.")),
    React.createElement(Page, {}, React.createElement(Text, {}, "4")),
  ));
  const originalHash = createHash("sha256").update(pdf).digest("hex");
  const first = await extractKnowledgePdf(pdf, { pageLimit: 1 });
  assert.equal(first.fileHash, originalHash);
  assert.equal(first.totalPages, 3);
  assert.equal(first.startPage, 1);
  assert.deepEqual(first.pages, [{ page: 1, text: "First official page contains usable guidance.", status: "text" }]);
  assert.equal(first.nextPage, 2);
  assert.equal(first.complete, false);
  assert.equal(first.extractionQuality, "requires_review");
  const continuation = await extractKnowledgePdf(pdf, { startPage: first.nextPage!, expectedHash: first.fileHash });
  assert.equal(continuation.fileHash, originalHash);
  assert.equal(continuation.startPage, 2);
  assert.deepEqual(continuation.pages, [
    { page: 2, text: "Second official page contains further guidance.", status: "text" },
    { page: 3, text: "", status: "unreadable" },
  ]);
  assert.equal(continuation.nextPage, null);
  assert.equal(continuation.complete, false);
  assert.equal(continuation.extractionQuality, "requires_review");
  assert.equal(createHash("sha256").update(pdf).digest("hex"), originalHash);
  await assert.rejects(extractKnowledgePdf(pdf, { startPage: 2, expectedHash: "0".repeat(64) }),
    { message: "knowledge_pdf_hash_mismatch" });
});

test("a broken Unicode map can recover a quantity from its exact embedded outline", async () => {
  const glyph = (unicode: string, originalCharCode: number, fontChar = unicode) =>
    ({ unicode, originalCharCode, fontChar, isInFont: true });
  const objects = new Map<string, unknown>([
    ["simple", { data: true, name: "AAAAAA+Example", composite: false }],
    ["composite", { data: true, name: "BBBBBB+Example", composite: true }],
    ["simple_path_8", { path: new Float32Array([1, 2, 8]) }],
    ["composite_path_digit", { path: new Float32Array([1, 2, 8]) }],
    ["composite_path_unknown", { path: new Float32Array([1, 2, 9]) }],
  ]);
  const page = { commonObjs: objects, async getOperatorList() {
    return { fnArray: [OPS.setFont, OPS.showText, OPS.setFont, OPS.showText],
      argsArray: [["simple"], [[glyph("8", 56)]], ["composite"], [[glyph("\u0012", 18, "digit"),
        glyph("0", 19), glyph(";", 7), glyph("\u0013", 19, "unknown")]]] };
  } } as unknown as PDFPageProxy;
  const items = [{ str: "\u00120;\u0013", fontName: "composite", hasEOL: true }];
  await repairPdfGlyphs([{ page, items }]);
  assert.equal(items[0]!.str, "80;\ufffd");
  const quote = readablePdfQuote("Previous line\n" + items[0]!.str + "\nA reliable contiguous passage.");
  assert.equal(quote.originalText, "A reliable contiguous passage.");
  assert.equal(quote.originalKind, "page_excerpt");
  assert.throws(() => readablePdfQuote(items[0]!.str), /no_reliable_quote/u);
});

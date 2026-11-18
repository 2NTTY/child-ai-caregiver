import assert from "node:assert/strict";
import test from "node:test";
import { planKnowledgePdfWindows } from "../server/knowledge-pdf-windows.ts";
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

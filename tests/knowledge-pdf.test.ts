import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import React from "react";
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";
import { extractKnowledgePdf } from "../server/knowledge-pdf.ts";

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

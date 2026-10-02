import assert from "node:assert/strict";
import test from "node:test";
import { sourceComposerDefaults, sourceComposerSchema, sourceCreateProjection, sourceRecordSchema, sourceConfirmationProjection, validSourceExcerpt } from "./source-form.ts";

const catalogue = [{ id: "preview-fhs-source", url: "https://www.fhs.gov.hk/", publisher: "Synthetic source" }];
const draft = { ...sourceComposerDefaults, sourceLabel: "  自備材料  ", sourceUrl: "https://example.com/notes", sourceDateText: "  九月下旬，日期待核對  ", sourceNotes: "  由我提供  ", text: "  大約九點多入睡。\n仍须核對。  " };
const record = { text: "  已由家長核對的記錄  ", kind: "measurement", rawValue: "  大約十四  ", unit: "  kg  ", approximate: true, timeRaw: "  昨晚九點多  " };

test("Source creation preserves raw supplied material and rejects unsafe or over-limit fields without truncating", () => {
  const schema = sourceComposerSchema(catalogue);
  const value = sourceCreateProjection(schema.parse(draft));
  for (const field of ["sourceLabel", "sourceUrl", "sourceDateText", "sourceNotes", "text"]) assert.equal(value[field], draft[field]);
  for (const url of ["http://example.com", "https://name:password@example.com", "not a URL"]) assert.equal(schema.safeParse({ ...draft, sourceUrl: url }).success, false);
  assert.equal(schema.safeParse({ ...draft, text: "", sourceUrl: "" }).success, false);
  assert.equal(schema.safeParse({ ...draft, text: "", sourceUrl: "https://example.com" }).success, true);
  const long = { ...draft, text: "a".repeat(10001) }; assert.equal(schema.safeParse(long).success, false); assert.equal(long.text.length, 10001);
});
test("Public sources use only the supplied catalogue and never submit hidden private drafts", () => {
  const schema = sourceComposerSchema(catalogue);
  const publicDraft = { ...draft, kind: "public_source", sourceId: catalogue[0].id, text: "a".repeat(10001), sourceNotes: "private" };
  assert.deepEqual(sourceCreateProjection(schema.parse(publicDraft)), { kind: "public_source", sourceId: catalogue[0].id });
  assert.equal(schema.safeParse({ ...publicDraft, sourceId: "unlisted" }).success, false);
  assert.equal(schema.safeParse({ ...draft, kind: "paste", text: "  " }).success, false);
});
test("Reference notes discard fact details while child records require a separate relationship confirmation", () => {
  const input = { version: 7, sourceLabel: draft.sourceLabel };
  const reference = sourceConfirmationProjection(record, input, "reference", false);
  assert.equal(reference.values.text, record.text); assert.equal(reference.values.source, draft.sourceLabel); assert.equal(reference.values.details.kind, "note");
  assert.equal(reference.values.details.quantity, null); assert.deepEqual(reference.values.details.eventTime, { rawText: "", at: null, timeZone: "Asia/Hong_Kong", precision: "unknown" });
  assert.equal(reference.confirmChildFact, false);
  assert.throws(() => sourceConfirmationProjection(record, input, "family_record", false), /explicitly confirmed/);
  const family = sourceConfirmationProjection(sourceRecordSchema("family_record").parse(record), input, "family_record", true);
  assert.deepEqual(family.values.details.quantity, { rawValue: record.rawValue, unit: record.unit, precision: "approximate" });
  assert.equal(family.values.details.eventTime.rawText, record.timeRaw); assert.equal(family.values.details.eventTime.at, null);
  assert.equal(sourceRecordSchema("reference").safeParse({ ...record, unit: "" }).success, true);
  assert.equal(sourceRecordSchema("family_record").safeParse({ ...record, unit: "" }).success, false);
});
test("Model excerpts must be a nonblank exact contiguous segment; long bodies are not automatically shortened", () => {
  const text = "a".repeat(12000) + "\n  已保存的原文  ";
  assert.equal(validSourceExcerpt(text, text), false); assert.equal(validSourceExcerpt(text, "a".repeat(10000)), true);
  assert.equal(validSourceExcerpt(text, "\n  已保存的原文  "), true); assert.equal(validSourceExcerpt(text, "a已保存的原文"), false); assert.equal(validSourceExcerpt(text, "  "), false);
});

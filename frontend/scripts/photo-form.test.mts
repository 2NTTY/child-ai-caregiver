import assert from "node:assert/strict";
import test from "node:test";
import { photoConfirmationProjection, photoDraftSchema } from "../src/components/photos/photo-form.ts";

const fields = { kind: "sleep" as const, text: "  晚上約九點休息。  ", rawValue: "約 1", unit: " 小時 ", approximate: true, timeRaw: " 昨晚 " };
test("photo confirmation preserves raw wording and leaves uncertain time unparsed", () => {
  const parsed = photoDraftSchema.parse(fields);
  const value = photoConfirmationProjection(parsed, " 由我提供 ");
  assert.equal(value.text, fields.text); assert.equal(value.source, " 由我提供 ");
  assert.deepEqual(value.details.quantity, { rawValue: fields.rawValue, unit: fields.unit, precision: "approximate" });
  assert.deepEqual(value.details.eventTime, { rawText: fields.timeRaw, at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" });
});
test("photo quantity requires a complete pair, including whitespace-only input", () => {
  assert.equal(photoDraftSchema.safeParse({ ...fields, unit: "" }).success, false);
  assert.equal(photoDraftSchema.safeParse({ ...fields, rawValue: " ", unit: " " }).success, false);
  const blank = photoDraftSchema.parse({ ...fields, rawValue: "", unit: "", timeRaw: "" });
  const value = photoConfirmationProjection(blank, "Parent");
  assert.equal(value.details.quantity, null); assert.equal(value.details.eventTime.precision, "unknown");
});
test("photo text uses its own 5000-character limit and never invents a time", () => {
  assert.equal(photoDraftSchema.safeParse({ ...fields, text: " " }).success, false);
  assert.equal(photoDraftSchema.safeParse({ ...fields, text: "x".repeat(5001) }).success, false);
  const parsed = photoDraftSchema.parse({ ...fields, approximate: false });
  assert.equal(photoConfirmationProjection(parsed, "Parent").details.eventTime.precision, "unknown");
});

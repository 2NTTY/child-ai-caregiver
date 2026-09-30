import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCare } from "../server/care-summary-policy.ts";
import type { CareDetails, CareRecord } from "../src/shared/care.ts";

function record(id: string, details: CareDetails, version = 1): CareRecord {
  return {
    id, childId: "synthetic-child", authorUserId: "synthetic-caregiver", version,
    text: "Synthetic original note: an unconfirmed 9 mL is not a quantity.",
    details, source: "Synthetic caregiver log " + id,
    confirmedBy: "synthetic-caregiver", confirmedAt: "2026-09-28T04:00:00Z",
    reason: "Synthetic confirmed revision", createdAt: "2026-09-28T03:00:00Z",
  };
}

test("care summary uses event-local days, separates unknown time and preserves decimal totals and sources", () => {
  const first = record("first", {
    kind: "feeding", quantity: { rawValue: "0.1", unit: "ml", precision: "exact" },
    eventTime: { rawText: "Midnight", at: "2026-09-27T16:00:00Z", timeZone: "UTC", precision: "exact" },
  }, 3);
  const second = record("second", {
    kind: "feeding", quantity: { rawValue: "0.2", unit: "毫升", precision: "approximate" },
    eventTime: { rawText: "About late evening", at: "2026-09-28T15:59:59Z", timeZone: "UTC", precision: "approximate" },
  }, 4);
  const before = record("before", {
    kind: "feeding", quantity: { rawValue: "9", unit: "mL", precision: "exact" },
    eventTime: { rawText: "Previous local day", at: "2026-09-27T15:59:59Z", timeZone: "UTC", precision: "exact" },
  });
  const after = record("after", {
    kind: "feeding", quantity: { rawValue: "7", unit: "mL", precision: "exact" },
    eventTime: { rawText: "Next local day", at: "2026-09-28T16:00:00Z", timeZone: "UTC", precision: "exact" },
  });
  const unknown = record("unknown", {
    kind: "sleep", quantity: { rawValue: "15", unit: "min", precision: "approximate" },
    eventTime: { rawText: "Earlier", at: null, timeZone: "Asia/Hong_Kong", precision: "unknown" },
  });
  const raw = record("raw", {
    kind: "feeding", quantity: { rawValue: "約半杯", unit: "mL", precision: "approximate" },
    eventTime: { rawText: "Noon", at: "2026-09-28T04:00:00Z", timeZone: "Asia/Hong_Kong", precision: "exact" },
  });
  const withoutQuantity = record("without-quantity", {
    kind: "diaper", quantity: null,
    eventTime: { rawText: "Noon", at: "2026-09-28T04:00:00Z", timeZone: "Asia/Hong_Kong", precision: "exact" },
  });
  const records = [before, first, second, unknown, after, raw, withoutQuantity];
  const original = structuredClone(records);
  const summary = summarizeCare(records, { startDay: "2026-09-28", period: "day", timeZone: "Asia/Hong_Kong" });

  assert.equal(summary.endDayExclusive, "2026-09-29");
  assert.deepEqual(summary.counts, { note: 0, feeding: 3, sleep: 0, diaper: 1, temperature: 0, measurement: 0, appointment: 0 });
  assert.deepEqual(summary.metrics, [{
    kind: "feeding", unit: "mL", samples: 2, approximate: 1,
    total: "0.3", min: "0.1", max: "0.2", recordIds: ["first", "second"],
  }]);
  assert.deepEqual(summary.missing, {
    unknownEventTime: 1, invalidQuantities: 1, emptyKinds: ["note", "sleep", "temperature", "measurement", "appointment"],
  });
  assert.deepEqual(summary.records, [original[1], original[2], original[5], original[6]]);
  assert.equal(summary.records[0], first);
  assert.deepEqual(records, original);
});
